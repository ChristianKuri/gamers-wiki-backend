/**
 * Scout Agent
 *
 * Responsible for gathering comprehensive research about a game through
 * multiple search queries and generating briefings for other agents.
 */

import type { LanguageModel } from 'ai';

import { createPrefixedLogger, type Logger } from '../../../utils/logger';
import {
  buildScoutQueries,
  getScoutCategorySystemPrompt,
  getScoutCategoryUserPrompt,
  getScoutOverviewSystemPrompt,
  getScoutOverviewUserPrompt,
  getScoutRecentSystemPrompt,
  getScoutRecentUserPrompt,
  type ScoutPromptContext,
} from '../prompts';
import {
  deduplicateQueries,
  processSearchResults,
  ResearchPoolBuilder,
} from '../research-pool';
import type {
  CategorizedSearchResult,
  GameArticleContext,
  ResearchPool,
  ScoutOutput,
  SearchFunction,
} from '../types';

// ============================================================================
// Configuration
// ============================================================================

export const SCOUT_CONFIG = {
  MAX_SNIPPET_LENGTH: 800,
  MAX_SNIPPETS: 10,
  OVERVIEW_SEARCH_RESULTS: 8,
  CATEGORY_SEARCH_RESULTS: 6,
  RECENT_SEARCH_RESULTS: 5,
  MAX_CATEGORY_SEARCHES: 2,
  OVERVIEW_SEARCH_DEPTH: 'advanced' as const,
  CATEGORY_SEARCH_DEPTH: 'advanced' as const,
  RECENT_SEARCH_DEPTH: 'basic' as const,
  TEMPERATURE: 0.2,
  RESULTS_PER_SEARCH_CONTEXT: 5,
  KEY_FINDINGS_LIMIT: 3,
  RECENT_RESULTS_LIMIT: 3,
  RECENT_CONTENT_LENGTH: 300,
  MIN_SOURCES_WARNING: 5,
  MIN_QUERIES_WARNING: 3,
  MIN_OVERVIEW_LENGTH: 50,
};

// ============================================================================
// Types
// ============================================================================

export interface ScoutDeps {
  readonly search: SearchFunction;
  readonly generateText: typeof import('ai').generateText;
  readonly model: LanguageModel;
  readonly logger?: Logger;
}

export type SupportedLocale = 'en' | 'es';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Executes a search and processes results into a CategorizedSearchResult.
 */
async function executeSearch(
  search: SearchFunction,
  query: string,
  category: CategorizedSearchResult['category'],
  options: { searchDepth: 'basic' | 'advanced'; maxResults: number }
): Promise<CategorizedSearchResult> {
  const result = await search(query, {
    searchDepth: options.searchDepth,
    maxResults: options.maxResults,
    includeAnswer: true,
    includeRawContent: false,
  });

  return processSearchResults(query, category, result);
}

/**
 * Builds search context string from search results.
 */
function buildSearchContext(results: readonly CategorizedSearchResult[]): string {
  return results
    .map((search) => {
      const snippets = search.results
        .slice(0, SCOUT_CONFIG.RESULTS_PER_SEARCH_CONTEXT)
        .map(
          (r) =>
            `  - ${r.title} (${r.url})\n    ${r.content.slice(0, SCOUT_CONFIG.MAX_SNIPPET_LENGTH)}`
        )
        .join('\n');

      return `Query: "${search.query}"
Category: ${search.category}
AI Summary: ${search.answer || '(none)'}
Results:
${snippets}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Builds category context string from category-specific findings.
 */
function buildCategoryContext(findings: readonly CategorizedSearchResult[]): string {
  return findings
    .map(
      (search) =>
        `Query: "${search.query}"\nSummary: ${search.answer || '(none)'}\nKey findings: ${search.results
          .slice(0, SCOUT_CONFIG.KEY_FINDINGS_LIMIT)
          .map((r) => r.title)
          .join('; ')}`
    )
    .join('\n\n');
}

/**
 * Builds recent developments context string.
 */
function buildRecentContext(findings: readonly CategorizedSearchResult[]): string {
  return findings
    .flatMap((search) => search.results.slice(0, SCOUT_CONFIG.RECENT_RESULTS_LIMIT))
    .map((r) => `- ${r.title}: ${r.content.slice(0, SCOUT_CONFIG.RECENT_CONTENT_LENGTH)}`)
    .join('\n');
}

/**
 * Builds the full context document combining all briefings.
 */
function buildFullContext(
  context: GameArticleContext,
  overviewBriefing: string,
  categoryBriefing: string,
  recentBriefing: string
): string {
  return `=== OVERVIEW ===
${overviewBriefing}

=== CATEGORY INSIGHTS ===
${categoryBriefing}

=== RECENT DEVELOPMENTS ===
${recentBriefing}

=== METADATA ===
Game: ${context.gameName}
Developer: ${context.developer || 'unknown'}
Publisher: ${context.publisher || 'unknown'}
Release: ${context.releaseDate || 'unknown'}
Genres: ${context.genres?.join(', ') || 'unknown'}
Platforms: ${context.platforms?.join(', ') || 'unknown'}
${context.igdbDescription ? `\nIGDB: ${context.igdbDescription}` : ''}
${context.instruction ? `\nUser Directive: ${context.instruction}` : ''}`;
}

// ============================================================================
// Main Scout Function
// ============================================================================

/**
 * Runs the Scout agent to gather research about a game.
 *
 * @param context - Game context for research
 * @param locale - Target locale for briefings
 * @param deps - Dependencies (search, generateText, model)
 * @returns Scout output with briefings and research pool
 */
export async function runScout(
  context: GameArticleContext,
  locale: SupportedLocale,
  deps: ScoutDeps
): Promise<ScoutOutput> {
  const log = deps.logger ?? createPrefixedLogger('[Scout]');
  const localeInstruction = locale === 'es' ? 'Write in Spanish.' : 'Write in English.';

  // Build search queries
  const queries = buildScoutQueries(context);
  const dedupedCategoryQueries = deduplicateQueries(queries.category);

  log.debug(`Executing parallel searches: overview + ${dedupedCategoryQueries.length} category + recent`);

  // ===== PARALLEL SEARCH PHASE =====
  const searchPromises = [
    executeSearch(deps.search, queries.overview, 'overview', {
      searchDepth: SCOUT_CONFIG.OVERVIEW_SEARCH_DEPTH,
      maxResults: SCOUT_CONFIG.OVERVIEW_SEARCH_RESULTS,
    }),
    ...dedupedCategoryQueries.slice(0, SCOUT_CONFIG.MAX_CATEGORY_SEARCHES).map((query) =>
      executeSearch(deps.search, query, 'category-specific', {
        searchDepth: SCOUT_CONFIG.CATEGORY_SEARCH_DEPTH,
        maxResults: SCOUT_CONFIG.CATEGORY_SEARCH_RESULTS,
      })
    ),
    executeSearch(deps.search, queries.recent, 'recent', {
      searchDepth: SCOUT_CONFIG.RECENT_SEARCH_DEPTH,
      maxResults: SCOUT_CONFIG.RECENT_SEARCH_RESULTS,
    }),
  ];

  const searchResults = await Promise.all(searchPromises);

  // Process results: first is overview, last is recent, middle are category
  const overviewSearch = searchResults[0];
  const recentSearch = searchResults[searchResults.length - 1];
  const categorySearches = searchResults.slice(1, -1);

  // Build research pool
  const poolBuilder = new ResearchPoolBuilder()
    .add(overviewSearch)
    .addAll(categorySearches)
    .add(recentSearch);

  const researchPool = poolBuilder.build();

  // ===== BRIEFING GENERATION PHASE =====
  const allSearchResults = [
    ...researchPool.scoutFindings.overview,
    ...researchPool.scoutFindings.categorySpecific,
    ...researchPool.scoutFindings.recent,
  ];

  const searchContext = buildSearchContext(allSearchResults);
  const categoryContext = buildCategoryContext(researchPool.scoutFindings.categorySpecific);
  const recentContext = buildRecentContext(researchPool.scoutFindings.recent);

  const promptContext: ScoutPromptContext = {
    gameName: context.gameName,
    releaseDate: context.releaseDate,
    genres: context.genres,
    platforms: context.platforms,
    developer: context.developer,
    publisher: context.publisher,
    igdbDescription: context.igdbDescription,
    instruction: context.instruction,
    localeInstruction,
    searchContext,
    categoryContext,
    recentContext,
  };

  log.debug('Generating briefings in parallel...');

  // Run all briefing generations in parallel
  const [overviewResult, categoryResult, recentResult] = await Promise.all([
    deps.generateText({
      model: deps.model,
      temperature: SCOUT_CONFIG.TEMPERATURE,
      system: getScoutOverviewSystemPrompt(localeInstruction),
      prompt: getScoutOverviewUserPrompt(promptContext),
    }),
    deps.generateText({
      model: deps.model,
      temperature: SCOUT_CONFIG.TEMPERATURE,
      system: getScoutCategorySystemPrompt(localeInstruction),
      prompt: getScoutCategoryUserPrompt(context.gameName, context.instruction, categoryContext),
    }),
    deps.generateText({
      model: deps.model,
      temperature: SCOUT_CONFIG.TEMPERATURE,
      system: getScoutRecentSystemPrompt(localeInstruction),
      prompt: getScoutRecentUserPrompt(context.gameName, recentContext),
    }),
  ]);

  const overviewBriefing = overviewResult.text.trim();
  const categoryBriefing = categoryResult.text.trim();
  const recentBriefing = recentResult.text.trim();

  // ===== VALIDATION =====
  if (poolBuilder.urlCount < SCOUT_CONFIG.MIN_SOURCES_WARNING) {
    log.warn(
      `Found only ${poolBuilder.urlCount} sources for "${context.gameName}" ` +
        `(minimum recommended: ${SCOUT_CONFIG.MIN_SOURCES_WARNING}). Article quality may be limited.`
    );
  }

  if (poolBuilder.queryCount < SCOUT_CONFIG.MIN_QUERIES_WARNING) {
    log.warn(
      `Only ${poolBuilder.queryCount} unique queries executed for "${context.gameName}" ` +
        `(minimum recommended: ${SCOUT_CONFIG.MIN_QUERIES_WARNING}). Research depth may be limited.`
    );
  }

  if (!overviewBriefing || overviewBriefing.length < SCOUT_CONFIG.MIN_OVERVIEW_LENGTH) {
    throw new Error(
      `Scout failed to generate meaningful overview briefing for "${context.gameName}". ` +
        `Generated briefing was ${overviewBriefing.length} characters. ` +
        `This may indicate poor search results or API issues.`
    );
  }

  // Check for failed searches
  const failedSearches = Array.from(researchPool.queryCache.values()).filter(
    (r) => r.results.length === 0
  );

  if (failedSearches.length > 0) {
    log.warn(
      `${failedSearches.length} search(es) returned no results: ` +
        failedSearches.map((s) => `"${s.query}"`).join(', ')
    );
  }

  const fullContext = buildFullContext(context, overviewBriefing, categoryBriefing, recentBriefing);

  return {
    briefing: {
      overview: overviewBriefing,
      categoryInsights: categoryBriefing,
      recentDevelopments: recentBriefing,
      fullContext,
    },
    researchPool,
    sourceUrls: Array.from(researchPool.allUrls),
  };
}

