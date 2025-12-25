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
import {
  addTokenUsage,
  ArticleGenerationError,
  createEmptyTokenUsage,
  type CategorizedSearchResult,
  type GameArticleContext,
  type ResearchConfidence,
  type ResearchPool,
  type ScoutOutput,
  type SearchFunction,
  type TokenUsage,
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
  /** Optional temperature override (default: SCOUT_CONFIG.TEMPERATURE) */
  readonly temperature?: number;
}

// ============================================================================
// Exported Helper Functions (for testing)
// ============================================================================

/**
 * Options for executing a search operation.
 */
export interface ExecuteSearchOptions {
  readonly searchDepth: 'basic' | 'advanced';
  readonly maxResults: number;
  readonly signal?: AbortSignal;
}

/**
 * Executes a search with retry logic and processes results into a CategorizedSearchResult.
 * Exported for unit testing.
 *
 * @param search - Search function to use
 * @param query - Query string
 * @param category - Category to assign to results
 * @param options - Search options (depth, max results, signal)
 * @returns Processed search results
 */
export async function executeSearch(
  search: SearchFunction,
  query: string,
  category: CategorizedSearchResult['category'],
  options: ExecuteSearchOptions
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
 * Exported for unit testing.
 *
 * @param results - Array of categorized search results
 * @param config - Optional config overrides for snippet settings
 * @returns Formatted search context string
 */
export function buildSearchContext(
  results: readonly CategorizedSearchResult[],
  config: { resultsPerContext?: number; maxSnippetLength?: number } = {}
): string {
  const resultsPerContext = config.resultsPerContext ?? SCOUT_CONFIG.RESULTS_PER_SEARCH_CONTEXT;
  const maxSnippetLength = config.maxSnippetLength ?? SCOUT_CONFIG.MAX_SNIPPET_LENGTH;

  return results
    .map((search) => {
      const snippets = search.results
        .slice(0, resultsPerContext)
        .map(
          (r) =>
            `  - ${r.title} (${r.url})\n    ${r.content.slice(0, maxSnippetLength)}`
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
 * Exported for unit testing.
 *
 * @param findings - Array of category-specific search results
 * @param keyFindingsLimit - Max number of key findings to include (default from config)
 * @returns Formatted category context string
 */
export function buildCategoryContext(
  findings: readonly CategorizedSearchResult[],
  keyFindingsLimit: number = SCOUT_CONFIG.KEY_FINDINGS_LIMIT
): string {
  return findings
    .map(
      (search) =>
        `Query: "${search.query}"\nSummary: ${search.answer || '(none)'}\nKey findings: ${search.results
          .slice(0, keyFindingsLimit)
          .map((r) => r.title)
          .join('; ')}`
    )
    .join('\n\n');
}

/**
 * Builds recent developments context string.
 * Exported for unit testing.
 *
 * @param findings - Array of recent search results
 * @param config - Optional config overrides for limits
 * @returns Formatted recent developments string
 */
export function buildRecentContext(
  findings: readonly CategorizedSearchResult[],
  config: { recentResultsLimit?: number; recentContentLength?: number } = {}
): string {
  const recentResultsLimit = config.recentResultsLimit ?? SCOUT_CONFIG.RECENT_RESULTS_LIMIT;
  const recentContentLength = config.recentContentLength ?? SCOUT_CONFIG.RECENT_CONTENT_LENGTH;

  return findings
    .flatMap((search) => search.results.slice(0, recentResultsLimit))
    .map((r) => `- ${r.title}: ${r.content.slice(0, recentContentLength)}`)
    .join('\n');
}

/**
 * Builds the full context document combining all briefings.
 * Exported for unit testing.
 *
 * @param context - Game article context
 * @param overviewBriefing - Overview briefing text
 * @param categoryBriefing - Category insights text
 * @param recentBriefing - Recent developments text
 * @returns Formatted full context document
 */
export function buildFullContext(
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

/**
 * Validates Scout output and logs warnings.
 * Exported for unit testing.
 *
 * @param overviewBriefing - The overview briefing to validate
 * @param poolBuilder - Research pool builder with stats
 * @param researchPool - Built research pool
 * @param gameName - Game name for error messages
 * @param log - Logger instance
 * @throws ArticleGenerationError if validation fails
 */
export function validateScoutOutput(
  overviewBriefing: string,
  poolBuilder: ResearchPoolBuilder,
  researchPool: ResearchPool,
  gameName: string,
  log: Logger
): void {
  if (poolBuilder.urlCount < SCOUT_CONFIG.MIN_SOURCES_WARNING) {
    log.warn(
      `Found only ${poolBuilder.urlCount} sources for "${gameName}" ` +
        `(minimum recommended: ${SCOUT_CONFIG.MIN_SOURCES_WARNING}). Article quality may be limited.`
    );
  }

  if (poolBuilder.queryCount < SCOUT_CONFIG.MIN_QUERIES_WARNING) {
    log.warn(
      `Only ${poolBuilder.queryCount} unique queries executed for "${gameName}" ` +
        `(minimum recommended: ${SCOUT_CONFIG.MIN_QUERIES_WARNING}). Research depth may be limited.`
    );
  }

  if (!overviewBriefing || overviewBriefing.length < SCOUT_CONFIG.MIN_OVERVIEW_LENGTH) {
    throw new ArticleGenerationError(
      'SCOUT_FAILED',
      `Scout failed to generate meaningful overview briefing for "${gameName}". ` +
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
}

/**
 * Calculates research confidence based on source count and briefing quality.
 * Exported for unit testing.
 *
 * @param sourceCount - Number of unique sources found
 * @param queryCount - Number of unique queries executed
 * @param overviewLength - Length of the overview briefing
 * @returns Confidence level ('high', 'medium', or 'low')
 */
export function calculateResearchConfidence(
  sourceCount: number,
  queryCount: number,
  overviewLength: number
): ResearchConfidence {
  // Thresholds for confidence levels
  const HIGH_SOURCE_THRESHOLD = SCOUT_CONFIG.MIN_SOURCES_WARNING * 2; // 10 sources
  const HIGH_QUERY_THRESHOLD = SCOUT_CONFIG.MIN_QUERIES_WARNING * 2; // 6 queries
  const HIGH_OVERVIEW_THRESHOLD = SCOUT_CONFIG.MIN_OVERVIEW_LENGTH * 4; // 200 chars

  const MEDIUM_SOURCE_THRESHOLD = SCOUT_CONFIG.MIN_SOURCES_WARNING; // 5 sources
  const MEDIUM_QUERY_THRESHOLD = SCOUT_CONFIG.MIN_QUERIES_WARNING; // 3 queries
  const MEDIUM_OVERVIEW_THRESHOLD = SCOUT_CONFIG.MIN_OVERVIEW_LENGTH; // 50 chars

  // Score each dimension
  let score = 0;

  if (sourceCount >= HIGH_SOURCE_THRESHOLD) score += 2;
  else if (sourceCount >= MEDIUM_SOURCE_THRESHOLD) score += 1;

  if (queryCount >= HIGH_QUERY_THRESHOLD) score += 2;
  else if (queryCount >= MEDIUM_QUERY_THRESHOLD) score += 1;

  if (overviewLength >= HIGH_OVERVIEW_THRESHOLD) score += 2;
  else if (overviewLength >= MEDIUM_OVERVIEW_THRESHOLD) score += 1;

  // Map score to confidence level (max score = 6)
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

/**
 * Assembles the final ScoutOutput from components.
 * Exported for unit testing.
 *
 * @param overviewBriefing - Overview briefing text
 * @param categoryBriefing - Category insights text
 * @param recentBriefing - Recent developments text
 * @param fullContext - Full context document
 * @param researchPool - Built research pool
 * @param tokenUsage - Aggregated token usage from LLM calls
 * @param confidence - Research confidence level
 * @returns Complete ScoutOutput
 */
export function assembleScoutOutput(
  overviewBriefing: string,
  categoryBriefing: string,
  recentBriefing: string,
  fullContext: string,
  researchPool: ResearchPool,
  tokenUsage: TokenUsage,
  confidence: ResearchConfidence
): ScoutOutput {
  return {
    briefing: {
      overview: overviewBriefing,
      categoryInsights: categoryBriefing,
      recentDevelopments: recentBriefing,
      fullContext,
    },
    researchPool,
    sourceUrls: Array.from(researchPool.allUrls),
    tokenUsage,
    confidence,
  };
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
  const temperature = deps.temperature ?? SCOUT_CONFIG.TEMPERATURE;
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
            temperature,
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
            temperature,
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
            temperature,
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

  // ===== AGGREGATE TOKEN USAGE =====
  // AI SDK v4 uses inputTokens/outputTokens instead of promptTokens/completionTokens
  let tokenUsage = createEmptyTokenUsage();
  for (const result of [overviewResult, categoryResult, recentResult]) {
    if (result.usage) {
      tokenUsage = addTokenUsage(tokenUsage, {
        input: result.usage.inputTokens ?? 0,
        output: result.usage.outputTokens ?? 0,
      });
    }
  }

  // ===== VALIDATION =====
  validateScoutOutput(overviewBriefing, poolBuilder, researchPool, context.gameName, log);

  // ===== CALCULATE CONFIDENCE =====
  const confidence = calculateResearchConfidence(
    poolBuilder.urlCount,
    poolBuilder.queryCount,
    overviewBriefing.length
  );

  if (confidence === 'low') {
    log.warn(
      `Research confidence is LOW for "${context.gameName}". ` +
        `Article quality may be compromised. Consider reviewing sources manually.`
    );
  }

  // ===== ASSEMBLE OUTPUT =====
  const fullContext = buildFullContext(context, overviewBriefing, categoryBriefing, recentBriefing);
  return assembleScoutOutput(overviewBriefing, categoryBriefing, recentBriefing, fullContext, researchPool, tokenUsage, confidence);
}

