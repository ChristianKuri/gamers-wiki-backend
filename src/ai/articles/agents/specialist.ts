/**
 * Specialist Agent
 *
 * Responsible for writing article sections based on research and Editor's plan.
 * Executes additional research queries and produces final markdown content.
 */

import type { LanguageModel } from 'ai';

import { createPrefixedLogger, type Logger } from '../../../utils/logger';
import type { ArticlePlan, ArticleSectionPlan } from '../article-plan';
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
  SupportedLocale,
} from '../types';

// ============================================================================
// Configuration
// ============================================================================

export const SPECIALIST_CONFIG = {
  SNIPPET_LENGTH: 280,
  TOP_RESULTS_PER_QUERY: 3,
  CONTEXT_TAIL_LENGTH: 500,
  MIN_PARAGRAPHS: 2,
  MAX_PARAGRAPHS: 5,
  MAX_SCOUT_OVERVIEW_LENGTH: 2500,
  RESEARCH_CONTEXT_PER_RESULT: 600,
  THIN_RESEARCH_THRESHOLD: 500,
  TEMPERATURE: 0.6,
  RESULTS_PER_RESEARCH_CONTEXT: 5,
  MAX_OUTPUT_TOKENS_PER_SECTION: 1500,
  SEARCH_DEPTH: 'advanced' as const,
  MAX_SEARCH_RESULTS: 5,
  MAX_SOURCES: 25,
  RATE_LIMIT_DELAY_MS: 300,
};

// ============================================================================
// Types
// ============================================================================

export interface SpecialistDeps {
  readonly search: SearchFunction;
  readonly generateText: typeof import('ai').generateText;
  readonly model: LanguageModel;
  readonly logger?: Logger;
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

  // Execute new queries with rate limiting
  for (let i = 0; i < newQueries.length; i++) {
    const query = newQueries[i];
    const result = await search(query, {
      searchDepth: SPECIALIST_CONFIG.SEARCH_DEPTH,
      maxResults: SPECIALIST_CONFIG.MAX_SEARCH_RESULTS,
      includeAnswer: true,
    });

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

// ============================================================================
// Main Specialist Function
// ============================================================================

/**
 * Runs the Specialist agent to write article sections.
 *
 * @param context - Game context
 * @param locale - Target locale
 * @param scoutOutput - Research from Scout agent
 * @param plan - Article plan from Editor agent
 * @param deps - Dependencies (search, generateText, model)
 * @returns Written markdown, sources, and final research pool
 */
export async function runSpecialist(
  context: GameArticleContext,
  locale: SupportedLocale,
  scoutOutput: ScoutOutput,
  plan: ArticlePlan,
  deps: SpecialistDeps
): Promise<SpecialistOutput> {
  const log = deps.logger ?? createPrefixedLogger('[Specialist]');
  const localeInstruction = locale === 'es' ? 'Write in Spanish.' : 'Write in English.';
  const categoryToneGuide = getCategoryToneGuide(plan.categorySlug);

  // ===== BATCH RESEARCH PHASE =====
  log.info('Starting batch research for all sections...');
  const enrichedPool = await batchResearchForSections(
    plan,
    scoutOutput.researchPool,
    deps.search,
    log
  );

  // ===== SECTION WRITING PHASE =====
  let markdown = `# ${plan.title}\n\n`;
  let previousContext = '';

  for (let i = 0; i < plan.sections.length; i++) {
    const section = plan.sections[i];
    const isFirst = i === 0;
    const isLast = i === plan.sections.length - 1;

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
      sectionIndex: i,
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

    log.debug(`Writing section ${i + 1}/${plan.sections.length}: ${section.headline}`);

    const { text } = await deps.generateText({
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
    });

    const sectionText = text.trim();
    markdown += `## ${section.headline}\n\n${sectionText}\n\n`;
    previousContext = sectionText.slice(-SPECIALIST_CONFIG.CONTEXT_TAIL_LENGTH);
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

