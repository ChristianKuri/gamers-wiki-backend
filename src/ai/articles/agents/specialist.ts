/**
 * Specialist Agent
 *
 * Responsible for writing article sections based on research and Editor's plan.
 * Executes additional research queries and produces final markdown content.
 */

import type { LanguageModel } from 'ai';

import { createPrefixedLogger, type Logger } from '../../../utils/logger';
import type { ArticlePlan, ArticleSectionPlan } from '../article-plan';
import { SPECIALIST_CONFIG } from '../config';
import { sleep, withRetry } from '../retry';
import {
  buildResearchContext,
  getCategoryToneGuide,
  getSpecialistSectionUserPrompt,
  getSpecialistSystemPrompt,
  type SpecialistSectionContext,
} from '../prompts';
import {
  deduplicateQueries,
  extractResearchForQueries,
  processSearchResults,
  ResearchPoolBuilder,
} from '../research-pool';
import {
  addTokenUsage,
  createEmptyTokenUsage,
  type CategorizedSearchResult,
  type GameArticleContext,
  type ResearchPool,
  type ResearchProgressCallback,
  type ScoutOutput,
  type SearchFunction,
  type SectionProgressCallback,
  type TokenUsage,
} from '../types';

// Re-export config for backwards compatibility
export { SPECIALIST_CONFIG } from '../config';

// ============================================================================
// Types
// ============================================================================

export interface SpecialistDeps {
  readonly search: SearchFunction;
  readonly generateText: typeof import('ai').generateText;
  readonly model: LanguageModel;
  readonly logger?: Logger;
  /** Optional callback for reporting section writing progress */
  readonly onSectionProgress?: SectionProgressCallback;
  /** Optional callback for reporting batch research progress */
  readonly onResearchProgress?: ResearchProgressCallback;
  /**
   * If true, writes sections in parallel instead of sequentially.
   * Faster but loses narrative flow between sections.
   * Best suited for "list" category articles where sections are independent.
   * Default: false
   */
  readonly parallelSections?: boolean;
  /** Optional AbortSignal for cancellation support */
  readonly signal?: AbortSignal;
  /** Optional temperature override (default: SPECIALIST_CONFIG.TEMPERATURE) */
  readonly temperature?: number;
}

export interface SpecialistOutput {
  readonly markdown: string;
  readonly sources: readonly string[];
  readonly researchPool: ResearchPool;
  /** Token usage for Specialist phase LLM calls */
  readonly tokenUsage: TokenUsage;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Result from a single search operation.
 */
interface SingleSearchResult {
  readonly query: string;
  readonly result: ReturnType<typeof processSearchResults>;
  readonly success: true;
}

/**
 * Result when a search operation fails but is recoverable.
 */
interface FailedSearchResult {
  readonly query: string;
  readonly error: string;
  readonly success: false;
}

type SearchOperationResult = SingleSearchResult | FailedSearchResult;

/**
 * Executes a single search with retry logic.
 * Separated for use in parallel execution.
 *
 * @param search - Search function to use
 * @param query - Query string
 * @param signal - Optional abort signal
 * @param log - Logger for warnings
 * @param gracefulDegradation - If true, returns null on failure instead of throwing
 * @returns Search result or null if graceful degradation is enabled and search fails
 */
async function executeSingleSearch(
  search: SearchFunction,
  query: string,
  signal?: AbortSignal,
  log?: Logger,
  gracefulDegradation = false
): Promise<SearchOperationResult> {
  try {
    const result = await withRetry(
      () =>
        search(query, {
          searchDepth: SPECIALIST_CONFIG.SEARCH_DEPTH,
          maxResults: SPECIALIST_CONFIG.MAX_SEARCH_RESULTS,
          includeAnswer: true,
        }),
      { context: `Specialist search: "${query.slice(0, 50)}..."`, signal }
    );

    return {
      query,
      result: processSearchResults(query, 'section-specific', result),
      success: true,
    };
  } catch (error) {
    // Re-throw if cancelled - we don't want to gracefully degrade cancellation
    if (signal?.aborted) {
      throw error;
    }

    // If graceful degradation is enabled, return failure info instead of throwing
    if (gracefulDegradation) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log?.warn(`Search failed for "${query}": ${errorMessage}`);
      return {
        query,
        error: errorMessage,
        success: false,
      };
    }

    throw error;
  }
}

/**
 * Result from batch research execution.
 */
interface BatchResearchResult {
  readonly pool: ResearchPool;
  readonly successCount: number;
  readonly failureCount: number;
  readonly failedQueries: readonly string[];
}

/**
 * Options for batch research execution.
 */
interface BatchResearchOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: ResearchProgressCallback;
}

/**
 * Executes batch research for all sections with controlled parallelism.
 * Uses configurable concurrency to balance speed vs API rate limits.
 * Supports graceful degradation - failed searches are logged and skipped.
 *
 * @param plan - Article plan with section queries
 * @param existingPool - Research pool from Scout phase
 * @param search - Search function
 * @param log - Logger instance
 * @param options - Optional signal and progress callback
 * @returns Enriched research pool with execution stats
 */
async function batchResearchForSections(
  plan: ArticlePlan,
  existingPool: ResearchPool,
  search: SearchFunction,
  log: Logger,
  options?: BatchResearchOptions
): Promise<BatchResearchResult> {
  const { signal, onProgress } = options ?? {};
  // Collect ALL research queries from all sections
  const allQueries = plan.sections.flatMap((section) => section.researchQueries);

  // Filter out queries that already exist in pool
  const poolBuilder = new ResearchPoolBuilder(existingPool);
  const newQueriesRaw = allQueries.filter((query) => !poolBuilder.has(query));

  // Deduplicate remaining queries across sections
  const newQueries = deduplicateQueries(newQueriesRaw);

  if (newQueries.length === 0) {
    log.debug('All research queries already satisfied by Scout research');
    return {
      pool: existingPool,
      successCount: 0,
      failureCount: 0,
      failedQueries: [],
    };
  }

  const alreadySatisfiedCount = allQueries.length - newQueriesRaw.length;
  const duplicatesRemovedCount = newQueriesRaw.length - newQueries.length;
  const concurrency = SPECIALIST_CONFIG.BATCH_CONCURRENCY;
  const batchDelay = SPECIALIST_CONFIG.BATCH_DELAY_MS;

  log.info(
    `Executing ${newQueries.length} new research queries with concurrency ${concurrency} ` +
      `(${alreadySatisfiedCount} already in pool` +
      (duplicatesRemovedCount > 0 ? `, ${duplicatesRemovedCount} duplicate(s) removed` : '') +
      `)`
  );

  let successCount = 0;
  const failedQueries: string[] = [];
  let completedQueries = 0;

  // Report initial progress
  onProgress?.(0, newQueries.length);

  // Process queries in batches with controlled concurrency
  for (let batchStart = 0; batchStart < newQueries.length; batchStart += concurrency) {
    // Check for cancellation before each batch
    if (signal?.aborted) {
      throw new Error('Batch research cancelled');
    }

    const batchEnd = Math.min(batchStart + concurrency, newQueries.length);
    const batch = newQueries.slice(batchStart, batchEnd);

    log.debug(
      `Processing batch ${Math.floor(batchStart / concurrency) + 1}/${Math.ceil(newQueries.length / concurrency)}: ` +
        `queries ${batchStart + 1}-${batchEnd} of ${newQueries.length}`
    );

    // Execute batch in parallel with graceful degradation
    const batchResults = await Promise.all(
      batch.map((query) => executeSingleSearch(search, query, signal, log, true))
    );

    // Add successful results to pool, track failures
    for (const searchResult of batchResults) {
      if (searchResult.success) {
        poolBuilder.add(searchResult.result);
        successCount++;
      } else {
        failedQueries.push(searchResult.query);
      }
    }

    // Report progress after each batch
    completedQueries += batch.length;
    onProgress?.(completedQueries, newQueries.length);

    // Add delay between batches (but not after the last batch)
    if (batchDelay > 0 && batchEnd < newQueries.length) {
      await sleep(batchDelay);
    }
  }

  if (failedQueries.length > 0) {
    log.warn(
      `${failedQueries.length} of ${newQueries.length} research queries failed. ` +
        `Article may have reduced coverage for some sections.`
    );
  }

  return {
    pool: poolBuilder.build(),
    successCount,
    failureCount: failedQueries.length,
    failedQueries,
  };
}

/**
 * Extracts research relevant to a specific section.
 */
function extractSectionResearch(
  section: ArticleSectionPlan,
  pool: ResearchPool
): CategorizedSearchResult[] {
  return extractResearchForQueries(section.researchQueries, pool, true);
}

/**
 * Calculates research content length for thin-research detection.
 */
function calculateResearchContentLength(research: readonly CategorizedSearchResult[]): number {
  return research.flatMap((r) => r.results).reduce((sum, result) => sum + result.content.length, 0);
}

/**
 * Formats sources section for markdown.
 */
function formatSources(urls: readonly string[]): string {
  if (urls.length === 0) return '';
  return ['## Sources', ...urls.map((u) => `- ${u}`), ''].join('\n');
}

/**
 * Ensures unique strings up to a maximum count.
 */
function ensureUniqueStrings(values: readonly string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const trimmed = v.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Result from writing a single section.
 */
interface WriteSectionResult {
  readonly text: string;
  readonly tokenUsage: TokenUsage;
}

/**
 * Writes a single section using the Specialist agent.
 * Extracted to enable parallel section writing.
 */
async function writeSection(
  context: GameArticleContext,
  scoutOutput: ScoutOutput,
  plan: ArticlePlan,
  section: ArticleSectionPlan,
  sectionIndex: number,
  enrichedPool: ResearchPool,
  deps: Pick<SpecialistDeps, 'generateText' | 'model' | 'logger' | 'signal' | 'temperature'>,
  previousContext: string
): Promise<WriteSectionResult> {
  const log = deps.logger ?? createPrefixedLogger('[Specialist]');
  const temperature = deps.temperature ?? SPECIALIST_CONFIG.TEMPERATURE;
  const localeInstruction = 'Write in English.';
  const categoryToneGuide = getCategoryToneGuide(plan.categorySlug);

  const isFirst = sectionIndex === 0;
  const isLast = sectionIndex === plan.sections.length - 1;

  // Extract relevant research from pool
  const sectionResearch = extractSectionResearch(section, enrichedPool);
  const researchContentLength = calculateResearchContentLength(sectionResearch);
  const isThinResearch = researchContentLength < SPECIALIST_CONFIG.THIN_RESEARCH_THRESHOLD;

  // Guard: Check if we have any meaningful research
  const hasAnyResearch = sectionResearch.some((r) => r.results.length > 0);
  if (!hasAnyResearch && !scoutOutput.briefing.overview) {
    log.warn(
      `Section "${section.headline}" has no research and no Scout overview - quality may be compromised`
    );
  }

  // Build research context
  const researchContext = buildResearchContext(
    sectionResearch,
    SPECIALIST_CONFIG.RESULTS_PER_RESEARCH_CONTEXT,
    SPECIALIST_CONFIG.RESEARCH_CONTEXT_PER_RESULT
  );

  const sectionContext: SpecialistSectionContext = {
    sectionIndex,
    totalSections: plan.sections.length,
    headline: section.headline,
    goal: section.goal,
    isFirst,
    isLast,
    previousContext,
    researchContext,
    scoutOverview: scoutOutput.briefing.overview,
    categoryInsights: scoutOutput.briefing.categoryInsights,
    isThinResearch,
    researchContentLength,
  };

  log.debug(`Writing section ${sectionIndex + 1}/${plan.sections.length}: ${section.headline}`);

  const { text, usage } = await withRetry(
    () =>
      deps.generateText({
        model: deps.model,
        temperature,
        maxOutputTokens: SPECIALIST_CONFIG.MAX_OUTPUT_TOKENS_PER_SECTION,
        system: getSpecialistSystemPrompt(localeInstruction, categoryToneGuide),
        prompt: getSpecialistSectionUserPrompt(
          sectionContext,
          plan,
          context.gameName,
          SPECIALIST_CONFIG.MAX_SCOUT_OVERVIEW_LENGTH,
          SPECIALIST_CONFIG.MIN_PARAGRAPHS,
          SPECIALIST_CONFIG.MAX_PARAGRAPHS
        ),
      }),
    { context: `Specialist section "${section.headline}"`, signal: deps.signal }
  );

  // AI SDK v4 uses inputTokens/outputTokens instead of promptTokens/completionTokens
  const tokenUsage: TokenUsage = usage
    ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
    : createEmptyTokenUsage();

  return { text: text.trim(), tokenUsage };
}

// ============================================================================
// Main Specialist Function
// ============================================================================

/**
 * Runs the Specialist agent to write article sections.
 * Articles are always written in English.
 *
 * Supports two modes:
 * - Sequential (default): Sections are written in order, each receiving context from the previous.
 *   This maintains narrative flow but is slower.
 * - Parallel (parallelSections: true): Sections are written simultaneously.
 *   Faster but sections are independent. Best for "lists" category articles.
 *
 * @param context - Game context
 * @param scoutOutput - Research from Scout agent
 * @param plan - Article plan from Editor agent
 * @param deps - Dependencies (search, generateText, model, onSectionProgress, parallelSections)
 * @returns Written markdown, sources, and final research pool
 */
export async function runSpecialist(
  context: GameArticleContext,
  scoutOutput: ScoutOutput,
  plan: ArticlePlan,
  deps: SpecialistDeps
): Promise<SpecialistOutput> {
  const log = deps.logger ?? createPrefixedLogger('[Specialist]');
  const parallelSections = deps.parallelSections ?? false;
  const { signal } = deps;

  // ===== BATCH RESEARCH PHASE =====
  log.info('Starting batch research for all sections...');
  const { pool: enrichedPool, successCount, failureCount } = await batchResearchForSections(
    plan,
    scoutOutput.researchPool,
    deps.search,
    log,
    { signal, onProgress: deps.onResearchProgress }
  );

  if (successCount > 0 || failureCount > 0) {
    log.info(`Batch research complete: ${successCount} successful, ${failureCount} failed`);
  }

  // ===== SECTION WRITING PHASE =====
  let sectionTexts: string[];
  let totalTokenUsage = createEmptyTokenUsage();

  // Shared deps for writeSection calls
  const writeDeps = {
    generateText: deps.generateText,
    model: deps.model,
    logger: deps.logger,
    signal,
    temperature: deps.temperature,
  };

  if (parallelSections) {
    // Parallel mode: Write all sections simultaneously
    log.info(`Writing ${plan.sections.length} sections in PARALLEL mode...`);

    // Report initial progress for all sections
    deps.onSectionProgress?.(0, plan.sections.length, 'Starting parallel write');

    const sectionPromises = plan.sections.map((section, i) =>
      writeSection(
        context,
        scoutOutput,
        plan,
        section,
        i,
        enrichedPool,
        writeDeps,
        '' // No previous context in parallel mode
      ).then((result) => {
        // Report progress as each section completes
        deps.onSectionProgress?.(i + 1, plan.sections.length, section.headline);
        return result;
      })
    );

    const sectionResults = await Promise.all(sectionPromises);
    sectionTexts = sectionResults.map((r) => r.text);

    // Aggregate token usage from all sections
    for (const result of sectionResults) {
      totalTokenUsage = addTokenUsage(totalTokenUsage, result.tokenUsage);
    }
  } else {
    // Sequential mode: Write sections in order with context flow
    log.info(`Writing ${plan.sections.length} sections in SEQUENTIAL mode...`);
    sectionTexts = [];
    let previousContext = '';

    for (let i = 0; i < plan.sections.length; i++) {
      const section = plan.sections[i];

      // Report progress before writing each section
      deps.onSectionProgress?.(i + 1, plan.sections.length, section.headline);

      const result = await writeSection(
        context,
        scoutOutput,
        plan,
        section,
        i,
        enrichedPool,
        writeDeps,
        previousContext
      );

      sectionTexts.push(result.text);
      totalTokenUsage = addTokenUsage(totalTokenUsage, result.tokenUsage);
      previousContext = result.text.slice(-SPECIALIST_CONFIG.CONTEXT_TAIL_LENGTH);
    }
  }

  // ===== ASSEMBLE MARKDOWN =====
  let markdown = `# ${plan.title}\n\n`;
  for (let i = 0; i < plan.sections.length; i++) {
    const section = plan.sections[i];
    markdown += `## ${section.headline}\n\n${sectionTexts[i]}\n\n`;
  }

  // Collect all sources from research pool
  const allSources = Array.from(enrichedPool.allUrls);
  const finalUrls = ensureUniqueStrings(allSources, SPECIALIST_CONFIG.MAX_SOURCES);
  markdown += formatSources(finalUrls);

  return {
    markdown: markdown.trim() + '\n',
    sources: finalUrls,
    researchPool: enrichedPool,
    tokenUsage: totalTokenUsage,
  };
}

