/**
 * Scout Agent
 *
 * Responsible for gathering comprehensive research about a game through
 * multiple search queries and generating briefings for other agents.
 *
 * Uses two search strategies:
 * - Tavily: Keyword-based web search for factual queries (overview, recent news)
 * - Exa: Neural/semantic search for "how does X work" queries (guides only)
 *
 * Optionally integrates with the Cleaner agent to clean raw content before
 * passing to downstream agents (Editor, Specialist).
 */

import type { LanguageModel } from 'ai';

import { createPrefixedLogger, type Logger } from '../../../utils/logger';
import { exaSearch, isExaConfigured, type ExaSearchOptions } from '../../tools/exa';
import { SCOUT_CONFIG } from '../config';
import { withRetry } from '../retry';
import {
  buildExaQueriesForGuides,
  buildScoutQueries,
  detectArticleIntent,
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
  processSearchResultsWithCleaning,
  ResearchPoolBuilder,
  type CleaningDeps,
} from '../research-pool';
import {
  addExaSearchCost,
  addTavilySearch,
  addTokenUsage,
  ArticleGenerationError,
  createEmptySearchApiCosts,
  createEmptyTokenUsage,
  createTokenUsageFromResult,
  type CategorizedSearchResult,
  type GameArticleContext,
  type ResearchConfidence,
  type ResearchPool,
  type ScoutOutput,
  type SearchApiCosts,
  type SearchFunction,
  type SearchSource,
  type TokenUsage,
} from '../types';

// Re-export config for backwards compatibility
export { SCOUT_CONFIG } from '../config';

// ============================================================================
// Types
// ============================================================================

/**
 * Extended search result that includes cleaning token usage.
 * Used to track LLM costs from content cleaning operations.
 */
export interface ScoutSearchResult {
  /** The categorized search result */
  readonly result: CategorizedSearchResult;
  /** Token usage from cleaning operations (if any) */
  readonly cleaningTokenUsage: TokenUsage;
}

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
  /**
   * Optional cleaning dependencies.
   * When provided, search results are cleaned by the Cleaner agent
   * and cached in the database for future reuse.
   */
  readonly cleaningDeps?: CleaningDeps;
}

// ============================================================================
// Exported Helper Functions (for testing)
// ============================================================================

/**
 * Options for executing a Tavily search operation.
 */
export interface ExecuteSearchOptions {
  readonly searchDepth: 'basic' | 'advanced';
  readonly maxResults: number;
  readonly signal?: AbortSignal;
  /** Optional cleaning dependencies for content cleaning and caching */
  readonly cleaningDeps?: CleaningDeps;
}

/**
 * Options for executing an Exa search operation.
 */
export interface ExecuteExaSearchOptions {
  readonly numResults?: number;
  /** Search type override. Default: 'neural' (from exa.ts) - 4x faster than 'deep', same cost */
  readonly type?: 'deep' | 'auto' | 'neural' | 'keyword' | 'fast';
  /** Additional query variations for better coverage (deep search feature) */
  readonly additionalQueries?: readonly string[];
  readonly includeDomains?: readonly string[];
  readonly signal?: AbortSignal;
  /** Optional cleaning dependencies for content cleaning and caching */
  readonly cleaningDeps?: CleaningDeps;
}

/**
 * Executes a Tavily search with retry logic and processes results into a CategorizedSearchResult.
 * Optionally cleans content using the Cleaner agent when cleaningDeps is provided.
 * Exported for unit testing.
 *
 * @param search - Search function to use
 * @param query - Query string
 * @param category - Category to assign to results
 * @param options - Search options (depth, max results, signal, cleaningDeps)
 * @returns Processed search results with cleaning token usage
 */
export async function executeSearch(
  search: SearchFunction,
  query: string,
  category: CategorizedSearchResult['category'],
  options: ExecuteSearchOptions
): Promise<ScoutSearchResult> {
  const result = await withRetry(
    () =>
      search(query, {
        searchDepth: options.searchDepth,
        maxResults: options.maxResults,
        includeAnswer: true,
        // Request raw content for cleaning (full page text)
        includeRawContent: Boolean(options.cleaningDeps),
        // Exclude YouTube - video pages have no useful text content
        excludeDomains: [...SCOUT_CONFIG.EXA_EXCLUDE_DOMAINS],
      }),
    { context: `Scout search (${category}): "${query.slice(0, 40)}..."`, signal: options.signal }
  );

  // If cleaning deps provided, clean and cache the content
  if (options.cleaningDeps) {
    const cleaningResult = await processSearchResultsWithCleaning(
      query,
      category,
      result,
      'tavily',
      result.costUsd,
      options.cleaningDeps
    );
    return {
      result: cleaningResult.result,
      cleaningTokenUsage: cleaningResult.cleaningTokenUsage,
    };
  }

  // Pass through cost from Tavily response if available
  return {
    result: processSearchResults(query, category, result, 'tavily', result.costUsd),
    cleaningTokenUsage: createEmptyTokenUsage(),
  };
}

/**
 * Executes an Exa deep search with retry logic.
 * Uses 'deep' search type for comprehensive results with query expansion.
 * Optionally cleans content using the Cleaner agent when cleaningDeps is provided.
 * Exported for unit testing.
 *
 * @param query - Semantic query string (natural language works best)
 * @param category - Category to assign to results
 * @param options - Exa search options (including optional cleaningDeps)
 * @returns Processed search results with cleaning token usage
 */
export async function executeExaSearch(
  query: string,
  category: CategorizedSearchResult['category'],
  options: ExecuteExaSearchOptions = {}
): Promise<ScoutSearchResult> {
  const exaOptions: ExaSearchOptions = {
    numResults: options.numResults ?? SCOUT_CONFIG.CATEGORY_SEARCH_RESULTS,
    // Use default from exa.ts (neural) - 4x faster, same cost
    // Only override if explicitly specified in options
    ...(options.type ? { type: options.type } : {}),
    useAutoprompt: true,
    // Summary disabled - adds 8-16s latency, use full content instead
    includeSummary: SCOUT_CONFIG.EXA_INCLUDE_SUMMARY,
    // Exclude YouTube - video pages have no useful text content
    excludeDomains: [...SCOUT_CONFIG.EXA_EXCLUDE_DOMAINS],
    // Additional query variations for better coverage (deep search feature)
    ...(options.additionalQueries && options.additionalQueries.length > 0
      ? { additionalQueries: options.additionalQueries }
      : {}),
    ...(options.includeDomains && options.includeDomains.length > 0
      ? { includeDomains: options.includeDomains }
      : {}),
  };

  const result = await withRetry(
    () => exaSearch(query, exaOptions),
    { context: `Scout Exa search (${category}): "${query.slice(0, 40)}..."`, signal: options.signal }
  );

  // Extract cost from Exa response (if available)
  const costUsd = result.costDollars?.total;

  // Build raw results for processing
  const rawResults = {
    answer: null,
    results: result.results.map((r) => ({
      title: r.title,
      url: r.url,
      // Keep full content for top results
      content: r.content ?? '',
      // Keep summary for efficient context (query-aware)
      summary: r.summary,
      score: r.score,
    })),
  };

  // If cleaning deps provided, clean and cache the content
  if (options.cleaningDeps) {
    const cleaningResult = await processSearchResultsWithCleaning(
      query,
      category,
      rawResults,
      'exa',
      costUsd,
      options.cleaningDeps
    );
    return {
      result: cleaningResult.result,
      cleaningTokenUsage: cleaningResult.cleaningTokenUsage,
    };
  }

  // Convert Exa response to CategorizedSearchResult format
  // Preserve both content AND summary for hybrid approach
  return {
    result: processSearchResults(query, category, rawResults, 'exa' as SearchSource, costUsd),
    cleaningTokenUsage: createEmptyTokenUsage(),
  };
}

/**
 * Gets the display content for a search result using hybrid approach.
 * Top N results get full content, remaining get summary (if available).
 *
 * @param result - The search result item
 * @param index - Position in results (0-based)
 * @param fullTextCount - Number of top results to show full text
 * @param maxSnippetLength - Maximum length for content snippets
 * @returns Content string to display
 */
function getHybridContent(
  result: { content: string; summary?: string },
  index: number,
  fullTextCount: number,
  maxSnippetLength: number
): string {
  // Top N results: use full content (for maximum detail)
  if (index < fullTextCount) {
    return result.content.slice(0, maxSnippetLength);
  }
  // Remaining results: prefer summary (more efficient, query-aware)
  if (result.summary) {
    return result.summary.slice(0, maxSnippetLength);
  }
  // Fallback to content if no summary
  return result.content.slice(0, maxSnippetLength);
}

/**
 * Builds search context string from search results.
 * Uses hybrid approach: top N results get full text, rest get summaries.
 * Exported for unit testing.
 *
 * @param results - Array of categorized search results
 * @param config - Optional config overrides for snippet settings
 * @returns Formatted search context string
 */
export function buildSearchContext(
  results: readonly CategorizedSearchResult[],
  config: {
    resultsPerContext?: number;
    maxSnippetLength?: number;
    fullTextCount?: number;
  } = {}
): string {
  const resultsPerContext = config.resultsPerContext ?? SCOUT_CONFIG.RESULTS_PER_SEARCH_CONTEXT;
  const maxSnippetLength = config.maxSnippetLength ?? SCOUT_CONFIG.MAX_SNIPPET_LENGTH;
  const fullTextCount = config.fullTextCount ?? SCOUT_CONFIG.FULL_TEXT_RESULTS_COUNT;

  return results
    .map((search) => {
      const snippets = search.results
        .slice(0, resultsPerContext)
        .map((r, index) => {
          const displayContent = getHybridContent(r, index, fullTextCount, maxSnippetLength);
          const contentLabel = index < fullTextCount ? '[FULL]' : (r.summary ? '[SUMMARY]' : '[CONTENT]');
          return `  - ${r.title} (${r.url}) ${contentLabel}\n    ${displayContent}`;
        })
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
 * @param searchApiCosts - Aggregated search API costs
 * @param cleaningTokenUsage - Optional cleaning token usage (tracked separately)
 * @returns Complete ScoutOutput
 */
export function assembleScoutOutput(
  overviewBriefing: string,
  categoryBriefing: string,
  recentBriefing: string,
  fullContext: string,
  researchPool: ResearchPool,
  tokenUsage: TokenUsage,
  confidence: ResearchConfidence,
  searchApiCosts: SearchApiCosts,
  cleaningTokenUsage?: TokenUsage
): ScoutOutput {
  const output: ScoutOutput = {
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
    searchApiCosts,
  };

  // Only include cleaningTokenUsage if there was actual cleaning
  if (cleaningTokenUsage && (cleaningTokenUsage.input > 0 || cleaningTokenUsage.output > 0)) {
    return { ...output, cleaningTokenUsage };
  }

  return output;
}

// ============================================================================
// Main Scout Function
// ============================================================================

/**
 * Runs the Scout agent to gather research about a game.
 * Research and briefings are always generated in English.
 *
 * For guide articles, uses both Tavily (keyword search) and Exa (semantic search)
 * to get comprehensive research coverage.
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

  // Resolve effective category for prompt tailoring
  // If not explicitly provided, try to detect from instruction
  let effectiveCategorySlug = context.categorySlug;
  if (!effectiveCategorySlug) {
    const intent = detectArticleIntent(context.instruction);
    if (intent !== 'general') {
      effectiveCategorySlug = intent;
    }
    // If generic, we default to guides logic inside the prompt functions or null here
  }

  // Build search queries (Tavily keyword-based)
  const queries = buildScoutQueries(context);
  const dedupedCategoryQueries = deduplicateQueries(queries.category);
  const categoryQueriesToExecute = dedupedCategoryQueries.slice(0, SCOUT_CONFIG.MAX_CATEGORY_SEARCHES);

  // Build Exa queries for guides (semantic/neural search)
  const exaConfig = buildExaQueriesForGuides(context);
  const useExa = exaConfig && isExaConfigured();

  // Log Exa availability
  if (exaConfig && !isExaConfigured()) {
    log.debug('Exa API not configured (EXA_API_KEY missing) - skipping semantic search');
  }

  // Calculate total searches
  const tavilySearchCount = 1 + categoryQueriesToExecute.length + 1; // overview + category + recent
  const exaSearchCount = useExa ? exaConfig.semantic.length : 0;
  const totalSearches = tavilySearchCount + exaSearchCount;

  if (useExa) {
    log.debug(
      `Executing ${totalSearches} parallel searches: ` +
        `${tavilySearchCount} Tavily (overview + ${categoryQueriesToExecute.length} category + recent) + ` +
        `${exaSearchCount} Exa (semantic)`
    );
    log.debug(`Exa semantic queries: ${exaConfig.semantic.map((q) => `"${q.slice(0, 50)}..."`).join(', ')}`);
  } else {
    log.debug(
      `Executing ${totalSearches} parallel searches: ${tavilySearchCount} Tavily (overview + ${categoryQueriesToExecute.length} category + recent)`
    );
  }

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

  // Log cleaning status
  const { cleaningDeps } = deps;
  if (cleaningDeps) {
    log.debug('Content cleaning enabled - search results will be cleaned and cached');
  }

  // ===== PARALLEL SEARCH PHASE =====
  // Tavily searches (keyword-based)
  const tavilyPromises: Promise<ScoutSearchResult>[] = [
    trackSearchProgress(
      executeSearch(deps.search, queries.overview, 'overview', {
        searchDepth: SCOUT_CONFIG.OVERVIEW_SEARCH_DEPTH,
        maxResults: SCOUT_CONFIG.OVERVIEW_SEARCH_RESULTS,
        signal,
        cleaningDeps,
      })
    ),
    ...categoryQueriesToExecute.map((query) =>
      trackSearchProgress(
        executeSearch(deps.search, query, 'category-specific', {
          searchDepth: SCOUT_CONFIG.CATEGORY_SEARCH_DEPTH,
          maxResults: SCOUT_CONFIG.CATEGORY_SEARCH_RESULTS,
          signal,
          cleaningDeps,
        })
      )
    ),
    trackSearchProgress(
      executeSearch(deps.search, queries.recent, 'recent', {
        searchDepth: SCOUT_CONFIG.RECENT_SEARCH_DEPTH,
        maxResults: SCOUT_CONFIG.RECENT_SEARCH_RESULTS,
        signal,
        cleaningDeps,
      })
    ),
  ];

  // Exa searches (semantic/neural) - only for guides
  const exaPromises: Promise<ScoutSearchResult>[] = useExa
    ? exaConfig.semantic.map((query) =>
        trackSearchProgress(
          executeExaSearch(query, 'category-specific', {
            numResults: SCOUT_CONFIG.EXA_SEARCH_RESULTS,
            // Uses default from exa.ts (neural) - 4x faster, same cost
            signal,
            cleaningDeps,
          })
        )
      )
    : [];

  // Execute all searches in parallel
  const [tavilyResults, exaResults] = await Promise.all([
    Promise.all(tavilyPromises),
    Promise.all(exaPromises),
  ]);

  // Process Tavily results: first is overview, last is recent, middle are category
  const overviewSearch = tavilyResults[0].result;
  const recentSearch = tavilyResults[tavilyResults.length - 1].result;
  const tavilyCategorySearches = tavilyResults.slice(1, -1).map((r) => r.result);

  // Combine category searches from both sources
  const allCategorySearches = [...tavilyCategorySearches, ...exaResults.map((r) => r.result)];

  // Build research pool
  const poolBuilder = new ResearchPoolBuilder()
    .add(overviewSearch)
    .addAll(allCategorySearches)
    .add(recentSearch);

  const researchPool = poolBuilder.build();

  // ===== AGGREGATE CLEANING TOKEN USAGE =====
  // Cleaning token usage includes actual LLM costs from OpenRouter
  let cleaningTokenUsage = createEmptyTokenUsage();
  for (const searchResult of [...tavilyResults, ...exaResults]) {
    cleaningTokenUsage = addTokenUsage(cleaningTokenUsage, searchResult.cleaningTokenUsage);
  }

  if (cleaningTokenUsage.input > 0 || cleaningTokenUsage.output > 0) {
    const cleaningCost = cleaningTokenUsage.actualCostUsd?.toFixed(4) ?? 'N/A';
    log.debug(
      `Content cleaning: ${cleaningTokenUsage.input} input / ${cleaningTokenUsage.output} output tokens, $${cleaningCost} cost`
    );
  }

  // ===== AGGREGATE SEARCH API COSTS =====
  let searchApiCosts = createEmptySearchApiCosts();

  // Track Tavily searches with actual costs from API response
  for (const searchResult of tavilyResults) {
    const costUsd = searchResult.result.costUsd;
    if (costUsd !== undefined) {
      // Use actual cost from API response
      searchApiCosts = addTavilySearch(searchApiCosts, {
        credits: 1, // Tavily basic search = 1 credit
        costUsd,
      });
    } else {
      // Fallback to estimate if cost not available
      searchApiCosts = addTavilySearch(searchApiCosts);
    }
  }

  // Track Exa searches (actual cost from API)
  for (const searchResult of exaResults) {
    const costUsd = searchResult.result.costUsd;
    if (costUsd !== undefined) {
      searchApiCosts = addExaSearchCost(searchApiCosts, { costUsd });
    } else {
      // Exa search without cost info - estimate based on search type
      // Deep search: $0.015, Neural: $0.005
      searchApiCosts = addExaSearchCost(searchApiCosts, { costUsd: 0.015 });
    }
  }

  // Log Exa usage metrics if enabled
  if (useExa) {
    if (exaResults.length > 0) {
      const exaUrlCount = exaResults.reduce((sum, r) => sum + r.result.results.length, 0);
      const successfulQueries = exaResults.filter((r) => r.result.results.length > 0).length;
      const successRate = ((successfulQueries / exaResults.length) * 100).toFixed(1);
      const exaCost = searchApiCosts.exaCostUsd.toFixed(4);
      log.debug(
        `Exa API: ${exaUrlCount} sources from ${exaResults.length} queries ` +
          `(${successfulQueries}/${exaResults.length} successful, ${successRate}% success rate, $${exaCost} cost)`
      );
    } else {
      log.debug('Exa API: No results returned from semantic queries');
    }
  }

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
            system: getScoutOverviewSystemPrompt(localeInstruction, effectiveCategorySlug),
            prompt: getScoutOverviewUserPrompt(promptContext, effectiveCategorySlug),
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
            system: getScoutCategorySystemPrompt(localeInstruction, effectiveCategorySlug),
            prompt: getScoutCategoryUserPrompt(context.gameName, context.instruction, categoryContext, effectiveCategorySlug),
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
            system: getScoutRecentSystemPrompt(localeInstruction, effectiveCategorySlug),
            prompt: getScoutRecentUserPrompt(context.gameName, recentContext, effectiveCategorySlug, context.instruction),
          }),
        { context: 'Scout recent briefing', signal }
      )
    ),
  ]);

  const overviewBriefing = overviewResult.text.trim();
  const categoryBriefing = categoryResult.text.trim();
  const recentBriefing = recentResult.text.trim();

  // ===== AGGREGATE TOKEN USAGE =====
  // Use createTokenUsageFromResult to capture both tokens and actual cost from OpenRouter
  // Note: cleaningTokenUsage is tracked separately for cost visibility
  let tokenUsage = createEmptyTokenUsage();
  for (const result of [overviewResult, categoryResult, recentResult]) {
    tokenUsage = addTokenUsage(tokenUsage, createTokenUsageFromResult(result));
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
  return assembleScoutOutput(
    overviewBriefing,
    categoryBriefing,
    recentBriefing,
    fullContext,
    researchPool,
    tokenUsage,
    confidence,
    searchApiCosts,
    cleaningTokenUsage
  );
}

