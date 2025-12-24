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
import { withRetry } from '../retry';
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
import type {
  CategorizedSearchResult,
  GameArticleContext,
  ResearchPool,
  ScoutOutput,
  SearchFunction,
  SectionProgressCallback,
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
  /**
   * If true, writes sections in parallel instead of sequentially.
   * Faster but loses narrative flow between sections.
   * Best suited for "list" category articles where sections are independent.
   * Default: false
   */
  readonly parallelSections?: boolean;
}

export interface SpecialistOutput {
  readonly markdown: string;
  readonly sources: readonly string[];
  readonly researchPool: ResearchPool;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Executes batch research for all sections, deduplicating against existing pool.
 */
async function batchResearchForSections(
  plan: ArticlePlan,
  existingPool: ResearchPool,
  search: SearchFunction,
  log: Logger
): Promise<ResearchPool> {
  // Collect ALL research queries from all sections
  const allQueries = plan.sections.flatMap((section) => section.researchQueries);

  // Filter out queries that already exist in pool
  const poolBuilder = new ResearchPoolBuilder(existingPool);
  const newQueriesRaw = allQueries.filter((query) => !poolBuilder.has(query));

  // Deduplicate remaining queries across sections
  const newQueries = deduplicateQueries(newQueriesRaw);

  if (newQueries.length === 0) {
    log.debug('All research queries already satisfied by Scout research');
    return existingPool;
  }

  const alreadySatisfiedCount = allQueries.length - newQueriesRaw.length;
  const duplicatesRemovedCount = newQueriesRaw.length - newQueries.length;
  log.info(
    `Executing ${newQueries.length} new research queries ` +
      `(${alreadySatisfiedCount} already in pool` +
      (duplicatesRemovedCount > 0 ? `, ${duplicatesRemovedCount} duplicate(s) removed` : '') +
      `)`
  );

  // Execute new queries with rate limiting and retry logic
  for (let i = 0; i < newQueries.length; i++) {
    const query = newQueries[i];
    const result = await withRetry(
      () =>
        search(query, {
          searchDepth: SPECIALIST_CONFIG.SEARCH_DEPTH,
          maxResults: SPECIALIST_CONFIG.MAX_SEARCH_RESULTS,
          includeAnswer: true,
        }),
      { context: `Specialist search: "${query.slice(0, 50)}..."` }
    );

    const categorized = processSearchResults(query, 'section-specific', result);
    poolBuilder.add(categorized);

    // Rate limit between queries (but not after the last one)
    if (SPECIALIST_CONFIG.RATE_LIMIT_DELAY_MS > 0 && i < newQueries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, SPECIALIST_CONFIG.RATE_LIMIT_DELAY_MS));
    }
  }

  return poolBuilder.build();
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
  deps: Pick<SpecialistDeps, 'generateText' | 'model' | 'logger'>,
  previousContext: string
): Promise<string> {
  const log = deps.logger ?? createPrefixedLogger('[Specialist]');
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

  const { text } = await withRetry(
    () =>
      deps.generateText({
        model: deps.model,
        temperature: SPECIALIST_CONFIG.TEMPERATURE,
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
    { context: `Specialist section "${section.headline}"` }
  );

  return text.trim();
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

  // ===== BATCH RESEARCH PHASE =====
  log.info('Starting batch research for all sections...');
  const enrichedPool = await batchResearchForSections(
    plan,
    scoutOutput.researchPool,
    deps.search,
    log
  );

  // ===== SECTION WRITING PHASE =====
  let sectionTexts: string[];

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
        { generateText: deps.generateText, model: deps.model, logger: deps.logger },
        '' // No previous context in parallel mode
      ).then((text) => {
        // Report progress as each section completes
        deps.onSectionProgress?.(i + 1, plan.sections.length, section.headline);
        return text;
      })
    );

    sectionTexts = await Promise.all(sectionPromises);
  } else {
    // Sequential mode: Write sections in order with context flow
    log.info(`Writing ${plan.sections.length} sections in SEQUENTIAL mode...`);
    sectionTexts = [];
    let previousContext = '';

    for (let i = 0; i < plan.sections.length; i++) {
      const section = plan.sections[i];

      // Report progress before writing each section
      deps.onSectionProgress?.(i + 1, plan.sections.length, section.headline);

      const sectionText = await writeSection(
        context,
        scoutOutput,
        plan,
        section,
        i,
        enrichedPool,
        { generateText: deps.generateText, model: deps.model, logger: deps.logger },
        previousContext
      );

      sectionTexts.push(sectionText);
      previousContext = sectionText.slice(-SPECIALIST_CONFIG.CONTEXT_TAIL_LENGTH);
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
  };
}

