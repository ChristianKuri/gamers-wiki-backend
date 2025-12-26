/**
 * Specialist Agent
 *
 * Responsible for writing article sections based on research and Editor's plan.
 * Executes additional research queries and produces final markdown content.
 *
 * For guide articles, uses both Tavily (keyword search) and Exa (semantic search)
 * to get comprehensive section-specific research.
 */

import type { LanguageModel } from 'ai';

import { createPrefixedLogger, type Logger } from '../../../utils/logger';
import { exaSearch, isExaConfigured, type ExaSearchOptions } from '../../tools/exa';
import type { ArticlePlan, ArticleSectionPlan } from '../article-plan';
import { SPECIALIST_CONFIG, WORD_COUNT_CONSTRAINTS } from '../config';
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
  buildCrossReferenceContext,
  createInitialSectionWriteState,
  updateSectionWriteState,
  type SectionWriteState,
} from '../section-context';
import {
  addTokenUsage,
  createEmptyTokenUsage,
  type CategorizedSearchResult,
  type GameArticleContext,
  type ResearchPool,
  type ResearchProgressCallback,
  type ScoutOutput,
  type SearchFunction,
  type SearchSource,
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
  /**
   * Target word count for the article.
   * Used to dynamically adjust paragraph counts per section.
   */
  readonly targetWordCount?: number;
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
 * Executes a single Tavily search with retry logic.
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
      result: processSearchResults(query, 'section-specific', result, 'tavily'),
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
 * Executes a single Exa semantic search with retry logic.
 * Best for "how to" and meaning-based queries in guide articles.
 *
 * @param query - Semantic query string (natural language works best)
 * @param signal - Optional abort signal
 * @param log - Logger for warnings
 * @param gracefulDegradation - If true, returns failure info instead of throwing
 * @returns Search result
 */
async function executeSingleExaSearch(
  query: string,
  signal?: AbortSignal,
  log?: Logger,
  gracefulDegradation = false
): Promise<SearchOperationResult> {
  try {
    const exaOptions: ExaSearchOptions = {
      numResults: SPECIALIST_CONFIG.MAX_SEARCH_RESULTS,
      type: 'neural',
      useAutoprompt: true,
    };

    const result = await withRetry(
      () => exaSearch(query, exaOptions),
      { context: `Specialist Exa search: "${query.slice(0, 50)}..."`, signal }
    );

    return {
      query,
      result: processSearchResults(
        query,
        'section-specific',
        {
          answer: null,
          results: result.results.map((r) => ({
            title: r.title,
            url: r.url,
            content: r.content,
            score: r.score,
          })),
        },
        'exa' as SearchSource
      ),
      success: true,
    };
  } catch (error) {
    // Re-throw if cancelled
    if (signal?.aborted) {
      throw error;
    }

    if (gracefulDegradation) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log?.warn(`Exa search failed for "${query}": ${errorMessage}`);
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
 * Determines if a query is suited for Exa semantic search.
 * Guide-specific "how to" queries work best with Exa's neural search.
 *
 * @param query - The search query
 * @returns true if the query should use Exa
 */
function isSemanticQuery(query: string): boolean {
  const lowerQuery = query.toLowerCase();

  // "How to" and explanation queries are ideal for Exa
  if (
    lowerQuery.includes('how to') ||
    lowerQuery.includes('how does') ||
    lowerQuery.includes('best way to') ||
    lowerQuery.includes('tips for') ||
    lowerQuery.includes('strategies for') ||
    lowerQuery.includes('guide to')
  ) {
    return true;
  }

  // Questions about mechanics and systems
  if (
    lowerQuery.includes('what is the') ||
    lowerQuery.includes('explain') ||
    lowerQuery.includes('understanding')
  ) {
    return true;
  }

  return false;
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
  /** If true, use Exa for semantic queries (guide articles) */
  readonly useExaForSemanticQueries?: boolean;
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
  const { signal, onProgress, useExaForSemanticQueries } = options ?? {};
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

  // Determine if we should use Exa for semantic queries (only for guides with Exa configured)
  const useExa = useExaForSemanticQueries && isExaConfigured();

  // Log Exa availability
  if (useExaForSemanticQueries && !isExaConfigured()) {
    log.debug('Exa API not configured (EXA_API_KEY missing) - using Tavily for all queries');
  }

  // Partition queries into Tavily (keyword) and Exa (semantic) if Exa is enabled
  let tavilyQueries: string[];
  let exaQueries: string[];

  if (useExa) {
    tavilyQueries = [];
    exaQueries = [];
    for (const query of newQueries) {
      if (isSemanticQuery(query)) {
        exaQueries.push(query);
      } else {
        tavilyQueries.push(query);
      }
    }
    log.debug(
      `Query distribution: ${tavilyQueries.length} Tavily (keyword) + ${exaQueries.length} Exa (semantic)`
    );
    if (exaQueries.length > 0) {
      log.debug(`Exa semantic queries: ${exaQueries.slice(0, 3).map((q) => `"${q.slice(0, 50)}..."`).join(', ')}${exaQueries.length > 3 ? ` (+${exaQueries.length - 3} more)` : ''}`);
    }
  } else {
    tavilyQueries = newQueries;
    exaQueries = [];
  }

  const alreadySatisfiedCount = allQueries.length - newQueriesRaw.length;
  const duplicatesRemovedCount = newQueriesRaw.length - newQueries.length;
  const concurrency = SPECIALIST_CONFIG.BATCH_CONCURRENCY;
  const batchDelay = SPECIALIST_CONFIG.BATCH_DELAY_MS;

  log.info(
    `Executing ${newQueries.length} new research queries with concurrency ${concurrency} ` +
      `(${alreadySatisfiedCount} already in pool` +
      (duplicatesRemovedCount > 0 ? `, ${duplicatesRemovedCount} duplicate(s) removed` : '') +
      (useExa ? `, using Exa for ${exaQueries.length} semantic queries` : '') +
      `)`
  );

  let successCount = 0;
  const failedQueries: string[] = [];
  let completedQueries = 0;
  const totalQueries = tavilyQueries.length + exaQueries.length;

  // Report initial progress
  onProgress?.(0, totalQueries);

  // Helper to process a batch of queries
  const processBatch = async (
    batch: string[],
    executeFunc: (query: string) => Promise<SearchOperationResult>
  ): Promise<void> => {
    const batchResults = await Promise.all(batch.map(executeFunc));

    for (const searchResult of batchResults) {
      if (searchResult.success) {
        poolBuilder.add(searchResult.result);
        successCount++;
      } else {
        failedQueries.push(searchResult.query);
      }
    }

    completedQueries += batch.length;
    onProgress?.(completedQueries, totalQueries);
  };

  // Process Tavily queries in batches with controlled concurrency
  for (let batchStart = 0; batchStart < tavilyQueries.length; batchStart += concurrency) {
    if (signal?.aborted) {
      throw new Error('Batch research cancelled');
    }

    const batchEnd = Math.min(batchStart + concurrency, tavilyQueries.length);
    const batch = tavilyQueries.slice(batchStart, batchEnd);

    log.debug(
      `Processing Tavily batch ${Math.floor(batchStart / concurrency) + 1}/${Math.ceil(tavilyQueries.length / concurrency)}: ` +
        `queries ${batchStart + 1}-${batchEnd} of ${tavilyQueries.length}`
    );

    await processBatch(batch, (query) => executeSingleSearch(search, query, signal, log, true));

    if (batchDelay > 0 && batchEnd < tavilyQueries.length) {
      await sleep(batchDelay);
    }
  }

  // Process Exa queries in batches (if any)
  for (let batchStart = 0; batchStart < exaQueries.length; batchStart += concurrency) {
    if (signal?.aborted) {
      throw new Error('Batch research cancelled');
    }

    const batchEnd = Math.min(batchStart + concurrency, exaQueries.length);
    const batch = exaQueries.slice(batchStart, batchEnd);

    log.debug(
      `Processing Exa batch ${Math.floor(batchStart / concurrency) + 1}/${Math.ceil(exaQueries.length / concurrency)}: ` +
        `queries ${batchStart + 1}-${batchEnd} of ${exaQueries.length}`
    );

    await processBatch(batch, (query) => executeSingleExaSearch(query, signal, log, true));

    if (batchDelay > 0 && batchEnd < exaQueries.length) {
      await sleep(batchDelay);
    }
  }

  // Log Exa usage metrics if Exa was used
  if (useExa && exaQueries.length > 0) {
    // Count successful Exa queries (those that added results to pool)
    // Note: We can't easily track this without modifying processBatch, but we log the attempt
    const exaAttempts = exaQueries.length;
    log.debug(`Exa API: Attempted ${exaAttempts} semantic queries for section-specific research`);
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
 * Calculates dynamic paragraph counts based on target word count and section count.
 * Uses WORD_COUNT_CONSTRAINTS.WORDS_PER_PARAGRAPH as the baseline.
 *
 * @param targetWordCount - Target word count for the entire article
 * @param sectionCount - Number of sections in the article
 * @returns Object with minParagraphs and maxParagraphs
 */
function calculateDynamicParagraphCounts(
  targetWordCount: number | undefined,
  sectionCount: number
): { minParagraphs: number; maxParagraphs: number } {
  if (!targetWordCount) {
    // Use default config values
    return {
      minParagraphs: SPECIALIST_CONFIG.MIN_PARAGRAPHS,
      maxParagraphs: SPECIALIST_CONFIG.MAX_PARAGRAPHS,
    };
  }

  const targetWordsPerSection = targetWordCount / sectionCount;
  const wordsPerParagraph = WORD_COUNT_CONSTRAINTS.WORDS_PER_PARAGRAPH;

  // Calculate paragraph range based on target words per section
  // Allow some flexibility with min/max using configured offsets
  const idealParagraphs = Math.round(targetWordsPerSection / wordsPerParagraph);
  const minParagraphs = Math.max(
    WORD_COUNT_CONSTRAINTS.MIN_PARAGRAPHS_FLOOR,
    idealParagraphs - WORD_COUNT_CONSTRAINTS.PARAGRAPH_RANGE_LOWER_OFFSET
  );
  const maxParagraphs = Math.min(
    WORD_COUNT_CONSTRAINTS.MAX_PARAGRAPHS_CEILING,
    idealParagraphs + WORD_COUNT_CONSTRAINTS.PARAGRAPH_RANGE_UPPER_OFFSET
  );

  return { minParagraphs, maxParagraphs };
}

/**
 * Result from writing a single section.
 */
interface WriteSectionResult {
  readonly text: string;
  readonly tokenUsage: TokenUsage;
}

/**
 * Options for writing a single section.
 */
interface WriteSectionOptions {
  readonly minParagraphs: number;
  readonly maxParagraphs: number;
  /** Required elements to include in the checklist (only for last section) */
  readonly requiredElements?: readonly string[];
  /** Cross-reference context from previous sections (sequential mode only) */
  readonly crossReferenceContext?: string;
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
  previousContext: string,
  options: WriteSectionOptions
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

  // Only pass required elements to the last section for final verification
  const requiredElementsForSection = isLast ? options.requiredElements : undefined;

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
    requiredElements: requiredElementsForSection,
    crossReferenceContext: options.crossReferenceContext,
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
          options.minParagraphs,
          options.maxParagraphs
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
  // Use Exa for semantic queries in guide articles
  const useExaForSemanticQueries = plan.categorySlug === 'guides';
  log.info('Starting batch research for all sections...');
  const { pool: enrichedPool, successCount, failureCount } = await batchResearchForSections(
    plan,
    scoutOutput.researchPool,
    deps.search,
    log,
    { signal, onProgress: deps.onResearchProgress, useExaForSemanticQueries }
  );

  if (successCount > 0 || failureCount > 0) {
    log.info(`Batch research complete: ${successCount} successful, ${failureCount} failed`);
  }

  // ===== CALCULATE DYNAMIC PARAGRAPH COUNTS =====
  const targetWordCount = deps.targetWordCount ?? context.targetWordCount;
  const { minParagraphs, maxParagraphs } = calculateDynamicParagraphCounts(
    targetWordCount,
    plan.sections.length
  );

  if (targetWordCount) {
    log.debug(
      `Dynamic paragraph range: ${minParagraphs}-${maxParagraphs} ` +
        `(targeting ~${targetWordCount} words across ${plan.sections.length} sections)`
    );
  }

  // Build write options with dynamic paragraph counts and required elements
  const writeOptions: WriteSectionOptions = {
    minParagraphs,
    maxParagraphs,
    requiredElements: plan.requiredElements,
  };

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
        '', // No previous context in parallel mode
        writeOptions
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
    // Sequential mode: Write sections in order with context flow and cross-section awareness
    log.info(`Writing ${plan.sections.length} sections in SEQUENTIAL mode with cross-section awareness...`);
    sectionTexts = [];
    let previousContext = '';
    let sectionWriteState: SectionWriteState = createInitialSectionWriteState();

    for (let i = 0; i < plan.sections.length; i++) {
      const section = plan.sections[i];

      // Report progress before writing each section
      deps.onSectionProgress?.(i + 1, plan.sections.length, section.headline);

      // Build cross-reference context from previous sections (only for guides)
      const crossReferenceContext =
        plan.categorySlug === 'guides'
          ? buildCrossReferenceContext(sectionWriteState)
          : undefined;

      const result = await writeSection(
        context,
        scoutOutput,
        plan,
        section,
        i,
        enrichedPool,
        writeDeps,
        previousContext,
        { ...writeOptions, crossReferenceContext }
      );

      sectionTexts.push(result.text);
      totalTokenUsage = addTokenUsage(totalTokenUsage, result.tokenUsage);
      previousContext = result.text.slice(-SPECIALIST_CONFIG.CONTEXT_TAIL_LENGTH);

      // Update section write state for cross-section awareness (guides only)
      if (plan.categorySlug === 'guides') {
        sectionWriteState = updateSectionWriteState(
          sectionWriteState,
          result.text,
          section.headline
        );
        log.debug(
          `Cross-section tracking: ${sectionWriteState.coveredTopics.size} topics, ` +
            `${sectionWriteState.definedTerms.size} defined terms after section "${section.headline}"`
        );
      }
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

