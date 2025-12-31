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
  generateOptimizedQueries,
  generateFallbackQueries,
  type QueryOptimizerDeps,
} from '../query-optimizer';
import { withRetry } from '../retry';
import {
  buildExaQueriesForGuides,
  buildScoutQueries,
  detectArticleIntent,
  getScoutCategorySystemPrompt,
  getScoutCategoryUserPrompt,
  getScoutOverviewSystemPrompt,
  getScoutOverviewUserPrompt,
  getScoutSupplementarySystemPrompt,
  getScoutSupplementaryUserPrompt,
  type QuerySlot,
  type QuerySlotCategory,
  type ScoutPromptContext,
} from '../prompts';
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
  type DuplicateUrlInfo,
  type FilteredSourceSummary,
  type GameArticleContext,
  type ResearchConfidence,
  type ResearchPool,
  type ScoutOutput,
  type SearchApiCosts,
  type SearchFunction,
  type SearchQueryStats,
  type SearchSource,
  type TokenUsage,
} from '../types';

// Re-export config for backwards compatibility
export { SCOUT_CONFIG } from '../config';

/**
 * Maps a QuerySlotCategory to a CategorizedSearchResult category.
 * This allows flexible slot categories while maintaining backwards compatibility
 * with the existing result structure.
 */
function mapSlotCategoryToResultCategory(slotCategory: QuerySlotCategory): CategorizedSearchResult['category'] {
  switch (slotCategory) {
    case 'overview':
      return 'overview';
    case 'category-specific':
    case 'tips':
    case 'meta':
    case 'critic':
      return 'category-specific';
    case 'recent':
      return 'recent';
    default:
      return 'category-specific';
  }
}

/**
 * Gets a human-readable label for the supplementary section based on category.
 */
function getSupplementaryLabel(category: QuerySlotCategory | undefined): string {
  switch (category) {
    case 'tips':
      return 'TIPS & TRICKS';
    case 'recent':
      return 'RECENT DEVELOPMENTS';
    case 'meta':
      return 'META CHANGES';
    case 'critic':
      return 'CRITIC OPINIONS';
    default:
      return 'SUPPLEMENTARY RESEARCH';
  }
}

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
  /** Token usage from cleaning operations (if any) */
  readonly cleaningTokenUsage: TokenUsage;
  /** Sources filtered out due to low quality or relevance */
  readonly filteredSources: readonly FilteredSourceSummary[];
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
  /**
   * Optional generateObject for query optimization.
   * When provided along with SCOUT_CONFIG.QUERY_OPTIMIZATION_ENABLED,
   * uses LLM to generate optimized search queries based on article intent.
   */
  readonly generateObject?: typeof import('ai').generateObject;
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

  const result = await withRetry(
    () =>
      search(query, {
        searchDepth,
        maxResults,
        includeAnswer: true,
        // Request raw content for cleaning (full page text)
        includeRawContent: Boolean(options.cleaningDeps),
        excludeDomains,
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
      filteredSources: cleaningResult.filteredSources,
    };
  }

  // Pass through cost from Tavily response if available
  return {
    result: processSearchResults(query, category, result, 'tavily', result.costUsd),
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
      cleaningTokenUsage: cleaningResult.cleaningTokenUsage,
      filteredSources: cleaningResult.filteredSources,
    };
  }

  // Convert Exa response to CategorizedSearchResult format
  // Preserve both content AND summary for hybrid approach
  return {
    result: processSearchResults(query, category, rawResults, 'exa' as SearchSource, costUsd),
    cleaningTokenUsage: createEmptyTokenUsage(),
    filteredSources: [],
  };
}

/**
 * Gets the display content for a search result.
 * Always uses full content.
 *
 * @param result - The search result item
 * @param maxSnippetLength - Maximum length for content snippets
 * @returns Content string to display
 */
function getSourceContent(
  result: { content: string },
  maxSnippetLength: number
): string {
  return result.content.slice(0, maxSnippetLength);
}

/**
 * Builds search context string from search results.
 * Always uses full content for all results.
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
  } = {}
): string {
  const resultsPerContext = config.resultsPerContext ?? SCOUT_CONFIG.RESULTS_PER_SEARCH_CONTEXT;
  const maxSnippetLength = config.maxSnippetLength ?? SCOUT_CONFIG.MAX_SNIPPET_LENGTH;

  return results
    .map((search) => {
      const snippets = search.results
        .slice(0, resultsPerContext)
        .map((r) => {
          const displayContent = getSourceContent(r, maxSnippetLength);
          return `  - ${r.title} (${r.url})\n    ${displayContent}`;
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
 * Config options for buildSupplementaryContext / buildRecentContext.
 * Supports both new and legacy parameter names for backwards compatibility.
 */
export interface SupplementaryContextConfig {
  /** Number of results to include per search (new name) */
  readonly resultsLimit?: number;
  /** Max content length per item (new name) */
  readonly contentLength?: number;
  /** @deprecated Use resultsLimit instead */
  readonly recentResultsLimit?: number;
  /** @deprecated Use contentLength instead */
  readonly recentContentLength?: number;
}

/**
 * Builds supplementary context string (tips, recent, meta, etc.).
 * Exported for unit testing.
 *
 * @param findings - Array of supplementary search results
 * @param config - Optional config overrides for limits
 * @returns Formatted supplementary context string
 */
export function buildSupplementaryContext(
  findings: readonly CategorizedSearchResult[],
  config: SupplementaryContextConfig = {}
): string {
  // Support both new and legacy parameter names
  const resultsLimit = config.resultsLimit ?? config.recentResultsLimit ?? SCOUT_CONFIG.SUPPLEMENTARY_RESULTS_LIMIT;
  const contentLength = config.contentLength ?? config.recentContentLength ?? SCOUT_CONFIG.SUPPLEMENTARY_CONTENT_LENGTH;

  return findings
    .flatMap((search) => search.results.slice(0, resultsLimit))
    .map((r) => `- ${r.title}: ${r.content.slice(0, contentLength)}`)
    .join('\n');
}

// Backwards compatibility alias
export const buildRecentContext = buildSupplementaryContext;

/**
 * Builds the full context document combining all briefings.
 * Exported for unit testing.
 *
 * @param context - Game article context
 * @param overviewBriefing - Overview briefing text
 * @param categoryBriefing - Category insights text
 * @param supplementaryBriefing - Supplementary briefing text (tips/recent/meta)
 * @param supplementaryLabel - Label for supplementary section (e.g., "TIPS & TRICKS", "RECENT DEVELOPMENTS")
 * @returns Formatted full context document
 */
export function buildFullContext(
  context: GameArticleContext,
  overviewBriefing: string,
  categoryBriefing: string,
  supplementaryBriefing: string,
  supplementaryLabel: string = 'SUPPLEMENTARY RESEARCH'
): string {
  return `=== OVERVIEW ===
${overviewBriefing}

=== CATEGORY INSIGHTS ===
${categoryBriefing}

=== ${supplementaryLabel} ===
${supplementaryBriefing}

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
 * Options for assembling ScoutOutput.
 */
export interface AssembleScoutOutputOptions {
  readonly cleaningTokenUsage?: TokenUsage;
  readonly filteredSources?: readonly FilteredSourceSummary[];
  readonly duplicatedUrls?: readonly DuplicateUrlInfo[];
  readonly queryStats?: readonly SearchQueryStats[];
}

/**
 * Assembles the final ScoutOutput from components.
 * Exported for unit testing.
 *
 * @param overviewBriefing - Overview briefing text
 * @param categoryBriefing - Category insights text
 * @param supplementaryBriefing - Supplementary briefing text (tips/recent/meta)
 * @param fullContext - Full context document
 * @param researchPool - Built research pool
 * @param tokenUsage - Aggregated token usage from LLM calls
 * @param confidence - Research confidence level
 * @param searchApiCosts - Aggregated search API costs
 * @param options - Optional additional data (cleaning usage, filtered sources, duplicates)
 * @returns Complete ScoutOutput
 */
export function assembleScoutOutput(
  overviewBriefing: string,
  categoryBriefing: string,
  supplementaryBriefing: string,
  fullContext: string,
  researchPool: ResearchPool,
  tokenUsage: TokenUsage,
  confidence: ResearchConfidence,
  searchApiCosts: SearchApiCosts,
  options: AssembleScoutOutputOptions = {}
): ScoutOutput {
  const { cleaningTokenUsage, filteredSources = [], duplicatedUrls, queryStats } = options;

  const output: ScoutOutput = {
    briefing: {
      overview: overviewBriefing,
      categoryInsights: categoryBriefing,
      // Keep 'recentDevelopments' for backwards compatibility in ScoutOutput type
      // This now contains tips/recent/meta depending on article type
      recentDevelopments: supplementaryBriefing,
      fullContext,
    },
    researchPool,
    sourceUrls: Array.from(researchPool.allUrls),
    tokenUsage,
    confidence,
    searchApiCosts,
    filteredSources,
    // Include duplicate info if any duplicates were found
    ...(duplicatedUrls && duplicatedUrls.length > 0 ? { duplicatedUrls } : {}),
    // Include query stats if available
    ...(queryStats && queryStats.length > 0 ? { queryStats } : {}),
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

  // Determine article type for query optimization
  const articleType = effectiveCategorySlug ?? 'guide';

  // ===== QUERY OPTIMIZATION PHASE =====
  // Use LLM to generate optimized queries based on intent
  let optimizedQueries: { tavily: readonly string[]; exa: readonly string[] } | null = null;
  let queryOptimizationTokenUsage: TokenUsage = createEmptyTokenUsage();

  if (SCOUT_CONFIG.QUERY_OPTIMIZATION_ENABLED && deps.generateObject) {
    try {
      log.info('Optimizing search queries with LLM...');
      const optimizerDeps: QueryOptimizerDeps = {
        generateObject: deps.generateObject,
        model: deps.model,
        logger: log,
        signal,
      };
      const optimizationResult = await generateOptimizedQueries(context, articleType, optimizerDeps);
      optimizedQueries = optimizationResult.queries;
      queryOptimizationTokenUsage = optimizationResult.tokenUsage;
      log.info(`Query optimization complete (${queryOptimizationTokenUsage.input + queryOptimizationTokenUsage.output} tokens)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`Query optimization failed, using fallback templates: ${message}`);
      // Fall through to use template-based queries
    }
  }

  // Build search queries - use optimized if available, otherwise templates
  let slots: readonly QuerySlot[];
  let exaQueries: readonly string[];

  if (optimizedQueries) {
    // Use LLM-optimized queries
    const categories: QuerySlotCategory[] = ['overview', 'category-specific', 'tips'];
    slots = optimizedQueries.tavily.map((query, i) => ({
      query,
      category: categories[i] ?? 'category-specific',
      maxResults: 10,
      searchDepth: i === 0 ? 'advanced' as const : 'basic' as const,
    }));
    exaQueries = optimizedQueries.exa;
  } else {
    // Use template-based queries (fallback)
    const queryConfig = buildScoutQueries(context);
    slots = queryConfig.slots;
    const exaConfig = buildExaQueriesForGuides(context);
    exaQueries = exaConfig?.semantic ?? [];
  }

  // Check if Exa is available
  const useExa = exaQueries.length > 0 && isExaConfigured();

  // Log Exa availability
  if (exaQueries.length > 0 && !isExaConfigured()) {
    log.debug('Exa API not configured (EXA_API_KEY missing) - skipping semantic search');
  }

  // Calculate total searches
  const tavilySearchCount = slots.length;
  const exaSearchCount = useExa ? exaQueries.length : 0;
  const totalSearches = tavilySearchCount + exaSearchCount;

  // Log slot categories for debugging
  const slotCategories = slots.map((s) => s.category).join(', ');
  if (useExa) {
    log.debug(
      `Executing ${totalSearches} parallel searches: ` +
        `${tavilySearchCount} Tavily (${slotCategories}) + ` +
        `${exaSearchCount} Exa (semantic)`
    );
    log.debug(`Exa semantic queries: ${exaQueries.map((q) => `"${q.slice(0, 50)}..."`).join(', ')}`);
  } else {
    log.debug(
      `Executing ${totalSearches} parallel searches: ${tavilySearchCount} Tavily (${slotCategories})`
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

  // Create duplicate tracker to track URLs across all queries
  const duplicateTracker = new DuplicateTracker();

  // Enhance cleaningDeps with duplicate tracker
  const cleaningDepsWithTracker: CleaningDeps | undefined = cleaningDeps
    ? { ...cleaningDeps, duplicateTracker, phase: 'scout' }
    : undefined;

  // ===== PARALLEL SEARCH PHASE =====
  // Execute all Tavily searches from slots in parallel
  const tavilyPromises: Promise<ScoutSearchResult>[] = slots.map((slot) =>
    trackSearchProgress(
      executeSearch(deps.search, slot.query, mapSlotCategoryToResultCategory(slot.category), {
        searchDepth: slot.searchDepth,
        maxResults: slot.maxResults,
        signal,
        cleaningDeps: cleaningDepsWithTracker,
      })
    )
  );

  // Exa searches (semantic/neural) - uses LLM-optimized or template queries
  const exaPromises: Promise<ScoutSearchResult>[] = useExa
    ? exaQueries.map((query) =>
        trackSearchProgress(
          executeExaSearch(query, 'category-specific', {
            numResults: SCOUT_CONFIG.EXA_SEARCH_RESULTS,
            // Uses default from exa.ts (neural) - 4x faster, same cost
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

  // Organize results by slot category
  const resultsByCategory = new Map<QuerySlotCategory, CategorizedSearchResult[]>();
  slots.forEach((slot, index) => {
    const existing = resultsByCategory.get(slot.category) ?? [];
    existing.push(tavilyResults[index].result);
    resultsByCategory.set(slot.category, existing);
  });

  // Add Exa results to category-specific
  if (exaResults.length > 0) {
    const categorySpecific = resultsByCategory.get('category-specific') ?? [];
    categorySpecific.push(...exaResults.map((r) => r.result));
    resultsByCategory.set('category-specific', categorySpecific);
  }

  // Extract results by category type
  const overviewResults = resultsByCategory.get('overview') ?? [];
  const categorySpecificResults = resultsByCategory.get('category-specific') ?? [];
  // Supplementary = tips, recent, meta, critic (whichever is present)
  const supplementaryResults = [
    ...(resultsByCategory.get('tips') ?? []),
    ...(resultsByCategory.get('recent') ?? []),
    ...(resultsByCategory.get('meta') ?? []),
    ...(resultsByCategory.get('critic') ?? []),
  ];

  // Determine supplementary label based on what categories were used
  const supplementaryCategory = slots.find((s) => ['tips', 'recent', 'meta', 'critic'].includes(s.category))?.category;
  const supplementaryLabel = getSupplementaryLabel(supplementaryCategory);

  // Build research pool from all results
  const poolBuilder = new ResearchPoolBuilder();
  for (const result of overviewResults) {
    poolBuilder.add(result);
  }
  for (const result of categorySpecificResults) {
    poolBuilder.add(result);
  }
  for (const result of supplementaryResults) {
    poolBuilder.add(result);
  }

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

  // ===== AGGREGATE FILTERED SOURCES =====
  // Collect all sources that were filtered out due to low quality or relevance
  const allFilteredSources: FilteredSourceSummary[] = [];
  for (const searchResult of [...tavilyResults, ...exaResults]) {
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
    ...overviewResults,
    ...categorySpecificResults,
    ...supplementaryResults,
  ];

  const searchContext = buildSearchContext(allSearchResults);
  const categoryContext = buildCategoryContext(categorySpecificResults);
  const supplementaryContext = buildSupplementaryContext(supplementaryResults);

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
    supplementaryContext,
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
  const [overviewResult, categoryResult, supplementaryResult] = await Promise.all([
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
            system: getScoutSupplementarySystemPrompt(localeInstruction, effectiveCategorySlug),
            prompt: getScoutSupplementaryUserPrompt(context.gameName, supplementaryContext, effectiveCategorySlug, context.instruction),
          }),
        { context: `Scout ${supplementaryLabel.toLowerCase()} briefing`, signal }
      )
    ),
  ]);

  const overviewBriefing = overviewResult.text.trim();
  const categoryBriefing = categoryResult.text.trim();
  const supplementaryBriefing = supplementaryResult.text.trim();

  // ===== AGGREGATE TOKEN USAGE =====
  // Use createTokenUsageFromResult to capture both tokens and actual cost from OpenRouter
  // Note: cleaningTokenUsage is tracked separately for cost visibility
  let tokenUsage = createEmptyTokenUsage();

  // Include query optimization tokens (if LLM was used)
  tokenUsage = addTokenUsage(tokenUsage, queryOptimizationTokenUsage);

  for (const result of [overviewResult, categoryResult, supplementaryResult]) {
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
  const fullContext = buildFullContext(context, overviewBriefing, categoryBriefing, supplementaryBriefing, supplementaryLabel);

  // Extract duplicate tracking info
  const duplicatedUrls = duplicateTracker.getDuplicates();
  const queryStats = duplicateTracker.getQueryStats();

  // Log duplicate summary if any found
  if (duplicatedUrls.length > 0) {
    log.debug(
      `Duplicate tracking: ${duplicatedUrls.length} URLs appeared in multiple queries, ` +
        `${queryStats.reduce((sum, s) => sum + s.duplicates, 0)} total duplicates removed`
    );
  }

  return assembleScoutOutput(
    overviewBriefing,
    categoryBriefing,
    supplementaryBriefing,
    fullContext,
    researchPool,
    tokenUsage,
    confidence,
    searchApiCosts,
    {
      cleaningTokenUsage,
      filteredSources: allFilteredSources,
      duplicatedUrls,
      queryStats,
    }
  );
}

