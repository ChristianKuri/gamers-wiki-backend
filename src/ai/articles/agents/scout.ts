/**
 * Scout Agent
 *
 * Responsible for gathering comprehensive research about a game through
 * multiple search queries and generating briefings for other agents.
 *
 * Uses two search strategies:
 * - Tavily: Keyword-based web search for factual queries (overview, category-specific, tips/recent/meta)
 * - Exa: Neural/semantic search for "how does X work" queries (guides only)
 *
 * Query structure is flexible and defined per article type:
 * - Guides: overview + category + tips
 * - News: overview + category + recent
 * - Reviews: overview + category + recent
 * - Lists: overview + category + meta
 *
 * Optionally integrates with the Cleaner agent to clean raw content before
 * passing to downstream agents (Editor, Specialist).
 */

import type { LanguageModel } from 'ai';

import { createPrefixedLogger, type Logger } from '../../../utils/logger';
import { exaSearch, isExaConfigured, type ExaSearchOptions } from '../../tools/exa';
import { SCOUT_CONFIG } from '../config';
import {
  runScoutQueryPlanner,
  generateFallbackQueryPlan,
  type ScoutQueryPlannerDeps,
  type ScoutQueryPlannerResult,
} from '../query-optimizer';
import { withRetry } from '../retry';
import { detectArticleIntent } from '../prompts';
import {
  DuplicateTracker,
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
  type CleanerTokenUsage,
  type DiscoveryCheck,
  type DuplicateUrlInfo,
  type FilteredSourceSummary,
  type GameArticleContext,
  type QueryPlan,
  type ResearchConfidence,
  type ResearchPool,
  type ScoutOutput,
  type SearchApiCosts,
  type SearchFunction,
  type SearchQueryStats,
  type SearchSource,
  type SourceSummary,
  type TokenUsage,
  type TopSourceForQuery,
} from '../types';

// Re-export config for backwards compatibility
export { SCOUT_CONFIG } from '../config';

// ============================================================================
// Types
// ============================================================================

/**
 * Extended search result that includes cleaning token usage and filtered sources.
 * Used to track LLM costs from content cleaning operations and quality filtering.
 */
export interface ScoutSearchResult {
  /** The categorized search result */
  readonly result: CategorizedSearchResult;
  /** Token usage from pre-filter LLM calls (quick relevance check) */
  readonly prefilterTokenUsage: TokenUsage;
  /** Token usage from extraction LLM calls (full cleaning) */
  readonly extractionTokenUsage: TokenUsage;
  /** Combined token usage from all cleaning operations (for backwards compat) */
  readonly cleaningTokenUsage: TokenUsage;
  /** Sources filtered out due to low quality or relevance */
  readonly filteredSources: readonly FilteredSourceSummary[];
}

/**
 * Callback for monitoring Scout agent progress.
 *
 * @param step - Current step type ('search')
 * @param current - Number of completed items in this step
 * @param total - Total number of items in this step
 */
export type ScoutProgressCallback = (
  step: 'search',
  current: number,
  total: number
) => void;

export interface ScoutDeps {
  readonly search: SearchFunction;
  /**
   * Required generateText for core functionality and optional query optimization.
   * When SCOUT_CONFIG.QUERY_OPTIMIZATION_ENABLED is true,
   * uses LLM to generate optimized search queries based on article intent.
   */
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
  readonly searchDepth?: 'basic' | 'advanced';
  readonly maxResults?: number;
  readonly signal?: AbortSignal;
  /** Optional cleaning dependencies for content cleaning and caching */
  readonly cleaningDeps?: CleaningDeps;
  /** Enable image search (for image phase). Default: true */
  readonly includeImages?: boolean;
  /** Include image descriptions (requires includeImages). Default: true */
  readonly includeImageDescriptions?: boolean;
}

/** Default search depth for slots that don't specify one */
const DEFAULT_SEARCH_DEPTH = 'basic' as const;
/** Default max results for slots that don't specify one */
const DEFAULT_MAX_RESULTS = 10;

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
  const searchDepth = options.searchDepth ?? DEFAULT_SEARCH_DEPTH;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;

  // Use Tavily-specific exclusions if available (includes engine-specific scrape failures),
  // fallback to generic excludedDomains, then to static config list
  const excludeDomains = options.cleaningDeps?.tavilyExcludedDomains 
    ?? options.cleaningDeps?.excludedDomains 
    ?? [...SCOUT_CONFIG.EXA_EXCLUDE_DOMAINS];

  // Default to including images for the image phase
  const includeImages = options.includeImages ?? true;
  const includeImageDescriptions = options.includeImageDescriptions ?? true;

  const result = await withRetry(
    () =>
      search(query, {
        searchDepth,
        maxResults,
        includeAnswer: true,
        // Request raw content for cleaning (full page text)
        includeRawContent: Boolean(options.cleaningDeps),
        excludeDomains,
        // Enable image search with descriptions for the image phase
        includeImages,
        includeImageDescriptions: includeImages && includeImageDescriptions,
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
      prefilterTokenUsage: cleaningResult.prefilterTokenUsage,
      extractionTokenUsage: cleaningResult.extractionTokenUsage,
      cleaningTokenUsage: cleaningResult.cleaningTokenUsage,
      filteredSources: cleaningResult.filteredSources,
    };
  }

  // Pass through cost from Tavily response if available
  return {
    result: processSearchResults(query, category, result, 'tavily', result.costUsd),
    prefilterTokenUsage: createEmptyTokenUsage(),
    extractionTokenUsage: createEmptyTokenUsage(),
    cleaningTokenUsage: createEmptyTokenUsage(),
    filteredSources: [],
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
  // Use Exa-specific exclusions if available (includes engine-specific scrape failures),
  // fallback to generic excludedDomains, then to static config list
  const excludeDomains = options.cleaningDeps?.exaExcludedDomains 
    ?? options.cleaningDeps?.excludedDomains 
    ?? [...SCOUT_CONFIG.EXA_EXCLUDE_DOMAINS];

  const exaOptions: ExaSearchOptions = {
    numResults: options.numResults ?? SCOUT_CONFIG.CATEGORY_SEARCH_RESULTS,
    // Use default from exa.ts (neural) - 4x faster, same cost
    // Only override if explicitly specified in options
    ...(options.type ? { type: options.type } : {}),
    useAutoprompt: true,
    // Summary disabled - adds 8-16s latency, use full content instead
    includeSummary: SCOUT_CONFIG.EXA_INCLUDE_SUMMARY,
    excludeDomains,
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
      prefilterTokenUsage: cleaningResult.prefilterTokenUsage,
      extractionTokenUsage: cleaningResult.extractionTokenUsage,
      cleaningTokenUsage: cleaningResult.cleaningTokenUsage,
      filteredSources: cleaningResult.filteredSources,
    };
  }

  // Convert Exa response to CategorizedSearchResult format
  // Preserve both content AND summary for hybrid approach
  return {
    result: processSearchResults(query, category, rawResults, 'exa' as SearchSource, costUsd),
    prefilterTokenUsage: createEmptyTokenUsage(),
    extractionTokenUsage: createEmptyTokenUsage(),
    cleaningTokenUsage: createEmptyTokenUsage(),
    filteredSources: [],
  };
}

// ============================================================================
// Source Summaries Extraction
// ============================================================================

/**
 * Safely parse JSON array field that may be a string or already parsed.
 */
function safeParseJsonArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Extracts the top source summaries from all search results.
 * Returns sources sorted by (qualityScore + relevanceScore), limited to maxSources.
 * 
 * This replaces the queryBriefings LLM step - directly uses Cleaner's output
 * (detailedSummary, keyFacts, dataPoints) without additional LLM synthesis.
 * 
 * @param allResults - All categorized search results from the Scout phase
 * @param maxSources - Maximum number of sources to include (default: 15)
 * @returns Array of source summaries, sorted by quality + relevance
 */
export function extractSourceSummaries(
  allResults: readonly CategorizedSearchResult[],
  maxSources: number = 15
): SourceSummary[] {
  const sourceSummaries: SourceSummary[] = [];
  const seenUrls = new Set<string>();

  for (const result of allResults) {
    for (const item of result.results) {
      // Skip duplicates
      if (seenUrls.has(item.url)) continue;
      seenUrls.add(item.url);

      // Skip sources without quality/relevance scores or detailed summary
      if (
        item.qualityScore === undefined ||
        item.relevanceScore === undefined ||
        !item.detailedSummary
      ) {
        continue;
      }

      // Parse keyFacts and dataPoints (may be JSON strings)
      const keyFacts = safeParseJsonArray(item.keyFacts);
      const dataPoints = safeParseJsonArray(item.dataPoints);

      sourceSummaries.push({
        url: item.url,
        title: item.title,
        detailedSummary: item.detailedSummary,
        keyFacts,
        contentType: 'guide', // Default to 'guide', could be improved with Cleaner contentType
        dataPoints,
        query: result.query,
        qualityScore: item.qualityScore,
        relevanceScore: item.relevanceScore,
      });
    }
  }

  // Sort by combined score (quality + relevance) descending
  sourceSummaries.sort(
    (a, b) => (b.qualityScore + b.relevanceScore) - (a.qualityScore + a.relevanceScore)
  );

  // Limit to maxSources
  return sourceSummaries.slice(0, maxSources);
}

// ============================================================================
// Validation and Confidence
// ============================================================================

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
  // Sources: HIGH = 2x medium threshold, MEDIUM = config value
  const HIGH_SOURCE_THRESHOLD = SCOUT_CONFIG.MIN_SOURCES_FOR_MEDIUM * 2; // 10 sources
  const MEDIUM_SOURCE_THRESHOLD = SCOUT_CONFIG.MIN_SOURCES_FOR_MEDIUM;   // 5 sources

  // Queries: HIGH = max queries, MEDIUM = half of max
  const HIGH_QUERY_THRESHOLD = SCOUT_CONFIG.MAX_QUERIES;                      // 4 queries
  const MEDIUM_QUERY_THRESHOLD = Math.ceil(SCOUT_CONFIG.MAX_QUERIES / 2);     // 2 queries

  // Overview: HIGH = 4x min, MEDIUM = min
  const HIGH_OVERVIEW_THRESHOLD = SCOUT_CONFIG.MIN_OVERVIEW_LENGTH * 4; // 200 chars
  const MEDIUM_OVERVIEW_THRESHOLD = SCOUT_CONFIG.MIN_OVERVIEW_LENGTH;   // 50 chars

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
 * Extracts the best source (highest quality + relevance) from each search query.
 * Used to give the Editor detailed context for planning.
 *
 * @param allResults - All categorized search results from the Scout phase
 * @returns Array of top sources, one per query
 */
export function extractTopSourcesPerQuery(
  allResults: readonly CategorizedSearchResult[]
): TopSourceForQuery[] {
  const topSources: TopSourceForQuery[] = [];

  for (const result of allResults) {
    // Find the best source in this query's results
    let bestSource: TopSourceForQuery | null = null;
    let bestScore = -1;

    for (const item of result.results) {
      // Skip sources without quality/relevance scores (not cleaned)
      if (item.qualityScore === undefined || item.relevanceScore === undefined) {
        continue;
      }

      // Skip sources with no/minimal content
      if (!item.content || item.content.length < 100) {
        continue;
      }

      const combinedScore = item.qualityScore + item.relevanceScore;
      if (combinedScore > bestScore) {
        bestScore = combinedScore;
        bestSource = {
          query: result.query,
          searchSource: result.searchSource ?? 'tavily',
          title: item.title,
          url: item.url,
          content: item.content,
          qualityScore: item.qualityScore,
          relevanceScore: item.relevanceScore,
          combinedScore,
        };
      }
    }

    // Only include if we found a valid source
    if (bestSource) {
      topSources.push(bestSource);
    }
  }

  return topSources;
}

/**
 * Options for assembling ScoutOutput.
 */
export interface AssembleScoutOutputOptions {
  /** Cleaning token usage with prefilter/extraction breakdown */
  readonly cleaningTokenUsage?: CleanerTokenUsage;
  readonly filteredSources?: readonly FilteredSourceSummary[];
  readonly duplicatedUrls?: readonly DuplicateUrlInfo[];
  readonly queryStats?: readonly SearchQueryStats[];
  readonly topSourcesPerQuery?: readonly TopSourceForQuery[];
  readonly discoveryResult?: CategorizedSearchResult;
  readonly sourceSummaries?: readonly SourceSummary[];
}

/**
 * Assembles the final ScoutOutput from components.
 * Exported for unit testing.
 *
 * @param queryPlan - Query plan from the Scout Query Planner
 * @param discoveryCheck - Discovery check result
 * @param researchPool - Built research pool
 * @param queryPlanningTokenUsage - Token usage from query planning LLM calls
 * @param confidence - Research confidence level
 * @param searchApiCosts - Aggregated search API costs
 * @param options - Optional additional data (cleaning usage, filtered sources, duplicates)
 * @returns Complete ScoutOutput
 */
export function assembleScoutOutput(
  queryPlan: QueryPlan,
  discoveryCheck: DiscoveryCheck,
  researchPool: ResearchPool,
  queryPlanningTokenUsage: TokenUsage,
  confidence: ResearchConfidence,
  searchApiCosts: SearchApiCosts,
  options: AssembleScoutOutputOptions = {}
): ScoutOutput {
  const { 
    cleaningTokenUsage, 
    filteredSources = [], 
    duplicatedUrls, 
    queryStats, 
    topSourcesPerQuery,
    discoveryResult,
    sourceSummaries,
  } = options;

  const output: ScoutOutput = {
    queryPlan,
    discoveryCheck,
    ...(discoveryResult ? { discoveryResult } : {}),
    ...(sourceSummaries && sourceSummaries.length > 0 ? { sourceSummaries } : {}),
    researchPool,
    sourceUrls: Array.from(researchPool.allUrls),
    queryPlanningTokenUsage,
    tokenUsage: queryPlanningTokenUsage,
    confidence,
    searchApiCosts,
    filteredSources,
    ...(duplicatedUrls && duplicatedUrls.length > 0 ? { duplicatedUrls } : {}),
    ...(queryStats && queryStats.length > 0 ? { queryStats } : {}),
    ...(topSourcesPerQuery && topSourcesPerQuery.length > 0 ? { topSourcesPerQuery } : {}),
  };

  // Only include cleaningTokenUsage if there was actual cleaning
  if (cleaningTokenUsage && (cleaningTokenUsage.total.input > 0 || cleaningTokenUsage.total.output > 0)) {
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

  // ===== SETUP CLEANING DEPS =====
  // Create duplicate tracker and cleaning deps early so they can be used for discovery query too
  const duplicateTracker = new DuplicateTracker();
  const { cleaningDeps } = deps;
  const cleaningDepsWithTracker: CleaningDeps | undefined = cleaningDeps
    ? { ...cleaningDeps, duplicateTracker, phase: 'scout' }
    : undefined;

  if (cleaningDeps) {
    log.debug('Content cleaning enabled - search results will be cleaned and cached');
  }

  // ===== QUERY PLANNING PHASE (New Scout Query Planner) =====
  let queryPlanResult: ScoutQueryPlannerResult | null = null;
  let queryPlan: QueryPlan;
  let discoveryCheck: DiscoveryCheck | undefined;
  let discoveryResult: CategorizedSearchResult | undefined;
  let discoverySearchResult: ScoutSearchResult | undefined;
  let queryPlanningTokenUsage: TokenUsage = createEmptyTokenUsage();

  if (SCOUT_CONFIG.QUERY_OPTIMIZATION_ENABLED) {
    try {
      log.info('Running Scout Query Planner...');
      const plannerDeps: ScoutQueryPlannerDeps = {
        generateText: deps.generateText,
        model: deps.model,
        logger: log,
        signal,
      };
      
      // Phase 0: Discovery check
      queryPlanResult = await runScoutQueryPlanner(context, plannerDeps);
      discoveryCheck = queryPlanResult.discoveryCheck;
      queryPlanningTokenUsage = addTokenUsage(queryPlanningTokenUsage, queryPlanResult.tokenUsage);
      
      // If discovery is needed, execute the discovery query first
      if (discoveryCheck.needsDiscovery && discoveryCheck.discoveryQuery) {
        log.info(`Discovery needed (${discoveryCheck.discoveryReason}): executing discovery query...`);
        
        const discoveryEngine = discoveryCheck.discoveryEngine ?? 'tavily';
        
        if (discoveryEngine === 'exa' && isExaConfigured()) {
          discoverySearchResult = await executeExaSearch(
            discoveryCheck.discoveryQuery,
            'overview',
            { numResults: 5, signal, cleaningDeps: cleaningDepsWithTracker }
          );
        } else {
          discoverySearchResult = await executeSearch(
            deps.search,
            discoveryCheck.discoveryQuery,
            'overview',
            { searchDepth: 'advanced', maxResults: 10, signal, cleaningDeps: cleaningDepsWithTracker }
          );
        }
        
        discoveryResult = discoverySearchResult.result;
        
        // Build discovery context from results
        const discoveryContext = discoveryResult.results
          .slice(0, 3)
          .map(r => `- ${r.title}: ${r.content.slice(0, 500)}`)
          .join('\n');
        
        log.info(`Discovery found ${discoveryResult.results.length} sources. Re-planning queries...`);
        
        // Re-run query planning with discovery context
        const replanResult = await runScoutQueryPlanner(context, plannerDeps, discoveryContext);
        queryPlanningTokenUsage = addTokenUsage(queryPlanningTokenUsage, replanResult.tokenUsage);
        queryPlan = replanResult.queryPlan;
      } else {
        queryPlan = queryPlanResult.queryPlan;
      }
      
      log.info(`Query plan: "${queryPlan.draftTitle}" with ${queryPlan.queries.length} queries`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`Query planner failed, using fallback: ${message}`);
      queryPlan = generateFallbackQueryPlan(context);
    }
  } else {
    // Fallback when query optimization is disabled
    queryPlan = generateFallbackQueryPlan(context);
  }

  // Separate queries by engine
  const tavilyQueries = queryPlan.queries.filter(q => q.engine === 'tavily');
  const exaQueries = queryPlan.queries.filter(q => q.engine === 'exa');
  
  // Check if Exa is available
  const useExa = exaQueries.length > 0 && isExaConfigured();

  // Log Exa availability
  if (exaQueries.length > 0 && !isExaConfigured()) {
    log.debug('Exa API not configured (EXA_API_KEY missing) - skipping semantic search');
  }

  // Calculate total searches
  const tavilySearchCount = tavilyQueries.length;
  const exaSearchCount = useExa ? exaQueries.length : 0;
  const totalSearches = tavilySearchCount + exaSearchCount;

  // Log planned queries
  if (useExa) {
    log.debug(
      `Executing ${totalSearches} parallel searches: ` +
        `${tavilySearchCount} Tavily + ${exaSearchCount} Exa`
    );
  } else {
    log.debug(`Executing ${totalSearches} parallel searches: ${tavilySearchCount} Tavily`);
  }
  
  for (const q of queryPlan.queries) {
    const engineIcon = q.engine === 'exa' ? '🔍' : '📍';
    log.debug(`  ${engineIcon} [${q.engine}] ${q.query.slice(0, 60)}...`);
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

  // ===== PARALLEL SEARCH PHASE =====
  // Execute all Tavily searches from planned queries
  const tavilyPromises: Promise<ScoutSearchResult>[] = tavilyQueries.map((planned, index) =>
    trackSearchProgress(
      executeSearch(deps.search, planned.query, index === 0 ? 'overview' : 'category-specific', {
        searchDepth: index === 0 ? 'advanced' : 'basic',
        maxResults: 10,
        signal,
        cleaningDeps: cleaningDepsWithTracker,
      })
    )
  );

  // Exa searches (semantic/neural) - from planned queries
  const exaPromises: Promise<ScoutSearchResult>[] = useExa
    ? exaQueries.map((planned) =>
        trackSearchProgress(
          executeExaSearch(planned.query, 'category-specific', {
            numResults: SCOUT_CONFIG.EXA_SEARCH_RESULTS,
            signal,
            cleaningDeps: cleaningDepsWithTracker,
          })
        )
      )
    : [];

  // Execute all searches in parallel
  const [tavilyResults, exaResults] = await Promise.all([
    Promise.all(tavilyPromises),
    Promise.all(exaPromises),
  ]);

  // Combine all results for research pool (including discovery if available)
  const allResults: CategorizedSearchResult[] = [
    // Include discovery results first (if available) - these are cleaned and cached like other queries
    ...(discoveryResult ? [discoveryResult] : []),
    ...tavilyResults.map(r => r.result),
    ...exaResults.map(r => r.result),
  ];

  // Build research pool from all results
  const poolBuilder = new ResearchPoolBuilder();
  for (const result of allResults) {
    poolBuilder.add(result);
  }

  const researchPool = poolBuilder.build();

  // ===== AGGREGATE CLEANING TOKEN USAGE =====
  // Track prefilter and extraction separately for cost visibility
  // Include discovery search result if it was executed and cleaned
  const allSearchResults: ScoutSearchResult[] = [
    ...(discoverySearchResult ? [discoverySearchResult] : []),
    ...tavilyResults,
    ...exaResults,
  ];
  
  let prefilterTokenUsage = createEmptyTokenUsage();
  let extractionTokenUsage = createEmptyTokenUsage();
  for (const searchResult of allSearchResults) {
    prefilterTokenUsage = addTokenUsage(prefilterTokenUsage, searchResult.prefilterTokenUsage);
    extractionTokenUsage = addTokenUsage(extractionTokenUsage, searchResult.extractionTokenUsage);
  }

  // Build CleanerTokenUsage structure with sub-phase breakdown
  const cleanerTotal = addTokenUsage(prefilterTokenUsage, extractionTokenUsage);
  const cleaningTokenUsage: CleanerTokenUsage | undefined = 
    (cleanerTotal.input > 0 || cleanerTotal.output > 0) 
      ? {
          prefilter: prefilterTokenUsage,
          extraction: extractionTokenUsage,
          total: cleanerTotal,
        }
      : undefined;

  if (cleaningTokenUsage) {
    const cleaningCost = cleaningTokenUsage.total.actualCostUsd?.toFixed(4) ?? 'N/A';
    log.debug(
      `Content cleaning: ${cleaningTokenUsage.total.input} input / ${cleaningTokenUsage.total.output} output tokens, $${cleaningCost} cost ` +
      `(prefilter: $${prefilterTokenUsage.actualCostUsd?.toFixed(4) ?? '0'}, extraction: $${extractionTokenUsage.actualCostUsd?.toFixed(4) ?? '0'})`
    );
  }

  // ===== AGGREGATE FILTERED SOURCES =====
  // Collect all sources that were filtered out due to low quality or relevance
  const allFilteredSources: FilteredSourceSummary[] = [];
  for (const searchResult of allSearchResults) {
    allFilteredSources.push(...searchResult.filteredSources);
  }

  if (allFilteredSources.length > 0) {
    const byReason = {
      lowRelevance: allFilteredSources.filter((s) => s.reason === 'low_relevance').length,
      lowQuality: allFilteredSources.filter((s) => s.reason === 'low_quality').length,
    };
    log.info(
      `Filtered ${allFilteredSources.length} source(s): ${byReason.lowRelevance} low-relevance, ${byReason.lowQuality} low-quality`
    );
  }

  // ===== AGGREGATE SEARCH API COSTS =====
  let searchApiCosts = createEmptySearchApiCosts();

  // Track discovery search cost (if executed)
  if (discoverySearchResult) {
    const discoveryEngine = discoveryCheck?.discoveryEngine ?? 'tavily';
    const costUsd = discoverySearchResult.result.costUsd;
    
    if (discoveryEngine === 'exa') {
      searchApiCosts = addExaSearchCost(searchApiCosts, { costUsd: costUsd ?? 0.015 });
    } else {
      if (costUsd !== undefined) {
        searchApiCosts = addTavilySearch(searchApiCosts, { credits: 1, costUsd });
      } else {
        searchApiCosts = addTavilySearch(searchApiCosts);
      }
    }
  }

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

  // ===== SOURCE SUMMARIES EXTRACTION =====
  // Extract top source summaries directly from Cleaner's output
  // This replaces the old queryBriefings LLM step - saves ~$0.07/article and ~20s
  log.info('Extracting source summaries from cleaned content...');
  const sourceSummaries = extractSourceSummaries(allResults, 15);
  log.info(`Extracted ${sourceSummaries.length} source summaries (top by quality + relevance)`);

  // ===== CALCULATE CONFIDENCE =====
  // Calculate based on source count, query count, and source summaries quality
  // Use total summary length instead of briefing length (summaries are more comprehensive)
  const totalSummaryLength = sourceSummaries.reduce((sum, s) => sum + s.detailedSummary.length, 0);
  const confidence = calculateResearchConfidence(
    poolBuilder.urlCount,
    poolBuilder.queryCount,
    totalSummaryLength
  );

  if (confidence === 'low') {
    log.warn(
      `Research confidence is LOW for "${context.gameName}". ` +
        `Article quality may be compromised. Consider reviewing sources manually.`
    );
  }

  // ===== EXTRACT TRACKING INFO =====
  const duplicatedUrls = duplicateTracker.getDuplicates();
  const queryStats = duplicateTracker.getQueryStats();

  if (duplicatedUrls.length > 0) {
    log.debug(
      `Duplicate tracking: ${duplicatedUrls.length} URLs appeared in multiple queries, ` +
        `${queryStats.reduce((sum, s) => sum + s.duplicates, 0)} total duplicates removed`
    );
  }

  // Extract top source from each query for Editor context
  const combinedSearchResults = [...tavilyResults, ...exaResults].map((r) => r.result);
  const topSourcesPerQuery = extractTopSourcesPerQuery(combinedSearchResults);
  if (topSourcesPerQuery.length > 0) {
    log.debug(`Extracted ${topSourcesPerQuery.length} top sources for Editor context`);
  }

  // ===== ASSEMBLE OUTPUT =====
  return assembleScoutOutput(
    queryPlan,
    discoveryCheck,
    researchPool,
    queryPlanningTokenUsage,
    confidence,
    searchApiCosts,
    {
      cleaningTokenUsage,
      filteredSources: allFilteredSources,
      duplicatedUrls,
      queryStats,
      topSourcesPerQuery,
      discoveryResult,
      sourceSummaries,
    }
  );
}

