/**
 * Scout Agent
 *
 * Responsible for gathering comprehensive research about a game through
 * multiple search queries and generating briefings for other agents.
 */

import type { LanguageModel } from 'ai';

import { createPrefixedLogger, type Logger } from '../../../utils/logger';
import { SCOUT_CONFIG } from '../config';
import { withRetry } from '../retry';
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

// Re-export config for backwards compatibility
export { SCOUT_CONFIG } from '../config';

// ============================================================================
// Types
// ============================================================================

/**
 * Callback for monitoring Scout agent progress.
 *
 * @param step - Current step type ('search' or 'briefing')
 * @param current - Number of completed items in this step
 * @param total - Total number of items in this step
 */
export type ScoutProgressCallback = (
  step: 'search' | 'briefing',
  current: number,
  total: number
) => void;

export interface ScoutDeps {
  readonly search: SearchFunction;
  readonly generateText: typeof import('ai').generateText;
  readonly model: LanguageModel;
  readonly logger?: Logger;
  /** Optional AbortSignal for cancellation support */
  readonly signal?: AbortSignal;
  /** Optional callback for reporting granular progress */
  readonly onProgress?: ScoutProgressCallback;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Executes a search with retry logic and processes results into a CategorizedSearchResult.
 */
async function executeSearch(
  search: SearchFunction,
  query: string,
  category: CategorizedSearchResult['category'],
  options: { searchDepth: 'basic' | 'advanced'; maxResults: number; signal?: AbortSignal }
): Promise<CategorizedSearchResult> {
  const result = await withRetry(
    () =>
      search(query, {
        searchDepth: options.searchDepth,
        maxResults: options.maxResults,
        includeAnswer: true,
        includeRawContent: false,
      }),
    { context: `Scout search (${category}): "${query.slice(0, 40)}..."`, signal: options.signal }
  );

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
 * Research and briefings are always generated in English.
 *
 * @param context - Game context for research
 * @param deps - Dependencies (search, generateText, model)
 * @returns Scout output with briefings and research pool
 */
export async function runScout(
  context: GameArticleContext,
  deps: ScoutDeps
): Promise<ScoutOutput> {
  const log = deps.logger ?? createPrefixedLogger('[Scout]');
  const { signal } = deps;
  const localeInstruction = 'Write in English.';

  // Build search queries
  const queries = buildScoutQueries(context);
  const dedupedCategoryQueries = deduplicateQueries(queries.category);

  const categoryQueriesToExecute = dedupedCategoryQueries.slice(0, SCOUT_CONFIG.MAX_CATEGORY_SEARCHES);
  const totalSearches = 1 + categoryQueriesToExecute.length + 1; // overview + category + recent

  log.debug(`Executing ${totalSearches} parallel searches: overview + ${categoryQueriesToExecute.length} category + recent`);

  // Track search completions for progress reporting
  let completedSearches = 0;
  const trackSearchProgress = <T>(promise: Promise<T>): Promise<T> =>
    promise.then((result) => {
      completedSearches++;
      deps.onProgress?.('search', completedSearches, totalSearches);
      return result;
    });

  // Report initial progress
  deps.onProgress?.('search', 0, totalSearches);

  // ===== PARALLEL SEARCH PHASE =====
  const searchPromises = [
    trackSearchProgress(
      executeSearch(deps.search, queries.overview, 'overview', {
        searchDepth: SCOUT_CONFIG.OVERVIEW_SEARCH_DEPTH,
        maxResults: SCOUT_CONFIG.OVERVIEW_SEARCH_RESULTS,
        signal,
      })
    ),
    ...categoryQueriesToExecute.map((query) =>
      trackSearchProgress(
        executeSearch(deps.search, query, 'category-specific', {
          searchDepth: SCOUT_CONFIG.CATEGORY_SEARCH_DEPTH,
          maxResults: SCOUT_CONFIG.CATEGORY_SEARCH_RESULTS,
          signal,
        })
      )
    ),
    trackSearchProgress(
      executeSearch(deps.search, queries.recent, 'recent', {
        searchDepth: SCOUT_CONFIG.RECENT_SEARCH_DEPTH,
        maxResults: SCOUT_CONFIG.RECENT_SEARCH_RESULTS,
        signal,
      })
    ),
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

  // Track briefing completions for progress reporting
  const totalBriefings = 3;
  let completedBriefings = 0;
  const trackBriefingProgress = <T>(promise: Promise<T>): Promise<T> =>
    promise.then((result) => {
      completedBriefings++;
      deps.onProgress?.('briefing', completedBriefings, totalBriefings);
      return result;
    });

  // Report initial progress
  deps.onProgress?.('briefing', 0, totalBriefings);

  // Run all briefing generations in parallel with retry logic
  const [overviewResult, categoryResult, recentResult] = await Promise.all([
    trackBriefingProgress(
      withRetry(
        () =>
          deps.generateText({
            model: deps.model,
            temperature: SCOUT_CONFIG.TEMPERATURE,
            system: getScoutOverviewSystemPrompt(localeInstruction),
            prompt: getScoutOverviewUserPrompt(promptContext),
          }),
        { context: 'Scout overview briefing', signal }
      )
    ),
    trackBriefingProgress(
      withRetry(
        () =>
          deps.generateText({
            model: deps.model,
            temperature: SCOUT_CONFIG.TEMPERATURE,
            system: getScoutCategorySystemPrompt(localeInstruction),
            prompt: getScoutCategoryUserPrompt(context.gameName, context.instruction, categoryContext),
          }),
        { context: 'Scout category briefing', signal }
      )
    ),
    trackBriefingProgress(
      withRetry(
        () =>
          deps.generateText({
            model: deps.model,
            temperature: SCOUT_CONFIG.TEMPERATURE,
            system: getScoutRecentSystemPrompt(localeInstruction),
            prompt: getScoutRecentUserPrompt(context.gameName, recentContext),
          }),
        { context: 'Scout recent briefing', signal }
      )
    ),
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

