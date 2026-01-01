/**
 * Article Generation Types
 *
 * Shared types for the multi-agent article generation system.
 * Articles are always generated in English; translation to other languages is a separate process.
 */

import type { ArticleCategorySlug, ArticlePlan } from './article-plan';

// ============================================================================
// Phase Constants
// ============================================================================

/**
 * All phases of article generation as a const array.
 * Used to derive the ArticleGenerationPhase type.
 */
export const ARTICLE_GENERATION_PHASES = ['scout', 'editor', 'specialist', 'reviewer', 'validation'] as const;

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for article generation failures.
 * Each code corresponds to a specific phase or validation step.
 */
export type ArticleGenerationErrorCode =
  | 'CONFIG_ERROR'
  | 'CONTEXT_INVALID'
  | 'SCOUT_FAILED'
  | 'EDITOR_FAILED'
  | 'SPECIALIST_FAILED'
  | 'VALIDATION_FAILED'
  | 'TIMEOUT'
  | 'CANCELLED';

/**
 * Custom error class for article generation failures.
 * Provides structured error information for programmatic handling.
 *
 * @example
 * try {
 *   await generateGameArticleDraft(context);
 * } catch (error) {
 *   if (error instanceof ArticleGenerationError) {
 *     switch (error.code) {
 *       case 'SCOUT_FAILED':
 *         // Handle research failure
 *         break;
 *       case 'VALIDATION_FAILED':
 *         // Handle validation failure
 *         break;
 *     }
 *   }
 * }
 */
export class ArticleGenerationError extends Error {
  readonly name = 'ArticleGenerationError';

  constructor(
    readonly code: ArticleGenerationErrorCode,
    message: string,
    readonly cause?: Error
  ) {
    super(message);
    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ArticleGenerationError);
    }
  }
}

/**
 * Type guard to check if an error is an ArticleGenerationError.
 */
export function isArticleGenerationError(error: unknown): error is ArticleGenerationError {
  return error instanceof ArticleGenerationError;
}

// ============================================================================
// Search Result Types
// ============================================================================

/**
 * A single search result item from Tavily or similar search API.
 */
export interface SearchResultItem {
  readonly title: string;
  readonly url: string;
  /**
   * Full text content (may be truncated based on API settings).
   * For Exa: raw page content up to textMaxCharacters.
   * For Tavily: extracted page content.
   */
  readonly content: string;
  /**
   * AI-generated summary (if available).
   * For Exa: query-aware summary from Gemini Flash.
   * For Tavily: not available (use content).
   * @see https://docs.exa.ai/reference/contents-retrieval#summary-summary-true
   */
  readonly summary?: string;
  /**
   * Detailed summary with specific facts, numbers, and names (from Cleaner).
   * Available when content has been cleaned and summarized.
   */
  readonly detailedSummary?: string;
  /**
   * Key facts extracted as bullet points (from Cleaner).
   * Available when content has been cleaned and summarized.
   */
  readonly keyFacts?: readonly string[];
  /**
   * Specific data points: stats, dates, names, numbers (from Cleaner).
   * Available when content has been cleaned and summarized.
   */
  readonly dataPoints?: readonly string[];
  readonly score?: number;
  /** Quality score (0-100) from cleaner, if cleaned */
  readonly qualityScore?: number;
  /** Relevance score (0-100) from cleaner, if cleaned */
  readonly relevanceScore?: number;
  /** Whether this content was retrieved from cache (true) or newly cleaned (false) */
  readonly wasCached?: boolean;
}

/**
 * Category of a search result, indicating its source/purpose.
 */
export type SearchCategory = 'overview' | 'category-specific' | 'recent' | 'section-specific';

/**
 * Source of a search result, indicating which search API was used.
 */
export type SearchSource = 'tavily' | 'exa';

/**
 * A categorized search result with metadata.
 */
export interface CategorizedSearchResult {
  readonly query: string;
  readonly answer: string | null;
  readonly results: readonly SearchResultItem[];
  readonly category: SearchCategory;
  readonly timestamp: number;
  /**
   * The search API used to obtain this result.
   * - 'tavily': Keyword-based web search (factual queries)
   * - 'exa': Neural/semantic search (meaning-based queries)
   * Defaults to 'tavily' for backwards compatibility if not specified.
   */
  readonly searchSource?: SearchSource;
  /**
   * Actual cost in USD for this search (from Exa API response).
   * Only populated for Exa searches where the API returns costDollars.
   */
  readonly costUsd?: number;
}

// ============================================================================
// Research Pool Types
// ============================================================================

/**
 * Immutable research pool containing all gathered research.
 */
export interface ResearchPool {
  readonly scoutFindings: {
    readonly overview: readonly CategorizedSearchResult[];
    readonly categorySpecific: readonly CategorizedSearchResult[];
    readonly recent: readonly CategorizedSearchResult[];
  };
  readonly allUrls: ReadonlySet<string>;
  readonly queryCache: ReadonlyMap<string, CategorizedSearchResult>;
}

// ============================================================================
// Scout Agent Types
// ============================================================================

/**
 * Confidence level for research quality.
 * Used by downstream agents to adjust behavior when research is limited.
 */
export type ResearchConfidence = 'high' | 'medium' | 'low';

/**
 * Output from the Scout agent containing research briefings and sources.
 */
export interface ScoutOutput {
  /**
   * Query plan from Phase 1 (includes draft title).
   */
  readonly queryPlan: QueryPlan;
  
  /**
   * Discovery check result from Phase 0.
   * Shows whether discovery was needed and why.
   */
  readonly discoveryCheck: DiscoveryCheck;
  
  /**
   * Discovery query result (if discovery was executed).
   * Contains the search result from the discovery query.
   */
  readonly discoveryResult?: CategorizedSearchResult;
  
  /**
   * Per-query briefings for the Editor agent.
   * Cross-source synthesis with patterns and gaps.
   */
  readonly queryBriefings: readonly QueryBriefing[];
  
  /**
   * Detailed per-source summaries for the Specialist agent.
   * Rich, specific content for writing with specificity.
   */
  readonly sourceSummaries?: readonly SourceSummary[];
  
  readonly researchPool: ResearchPool;
  readonly sourceUrls: readonly string[];
  /** Token usage for Scout query planning LLM calls */
  readonly queryPlanningTokenUsage: TokenUsage;
  /** Token usage for Scout briefing generation LLM calls */
  readonly briefingTokenUsage: TokenUsage;
  /** Combined token usage for Scout phase (queryPlanning + briefing) - for backwards compat */
  readonly tokenUsage: TokenUsage;
  /**
   * Token usage for content cleaning with sub-phase breakdown.
   * Only present when cleaning is enabled and content was cleaned.
   */
  readonly cleaningTokenUsage?: CleanerTokenUsage;
  /**
   * Confidence level based on research quality.
   * - 'high': Good source count and briefing quality
   * - 'medium': Some concerns but usable
   * - 'low': Limited research, article quality may be compromised
   */
  readonly confidence: ResearchConfidence;
  /**
   * Search API costs aggregated from all searches.
   * Exa costs are actual (from API), Tavily costs are estimated.
   */
  readonly searchApiCosts: SearchApiCosts;
  /**
   * Sources filtered out due to low quality or relevance.
   * Tracked for transparency and debugging.
   */
  readonly filteredSources: readonly FilteredSourceSummary[];
  /**
   * URLs that appeared in multiple search queries.
   * Tracks where duplicates were found and which query "kept" the result.
   */
  readonly duplicatedUrls?: readonly DuplicateUrlInfo[];
  /**
   * Per-query statistics showing received vs used results.
   * Helps understand where results were lost to deduplication or filtering.
   */
  readonly queryStats?: readonly SearchQueryStats[];
  /**
   * The best source (highest quality + relevance) from each search query.
   * Used by the Editor to see actual content when planning the article.
   */
  readonly topSourcesPerQuery?: readonly TopSourceForQuery[];
}

// ============================================================================
// Scout Query Planning Types (Phase 0 & 1)
// ============================================================================

/**
 * Reason why the Scout needs a discovery query.
 */
export type DiscoveryReason =
  | 'unknown_game'    // Don't know enough about the game itself
  | 'specific_topic'  // Know game, but need depth on specific topic
  | 'recent_changes'  // Need to check for patches/updates
  | 'none';           // Have sufficient knowledge to plan queries

/**
 * Result of the discovery check (Phase 0).
 * Scout evaluates if it needs initial research before planning queries.
 */
export interface DiscoveryCheck {
  /** Whether discovery is needed */
  readonly needsDiscovery: boolean;
  /** Why discovery is needed */
  readonly discoveryReason: DiscoveryReason;
  /** The discovery query to execute (if needsDiscovery) */
  readonly discoveryQuery?: string;
  /** Which engine to use for discovery (default: tavily) */
  readonly discoveryEngine?: SearchSource;
}

/**
 * A single planned query with engine selection and expected findings.
 */
export interface PlannedQuery {
  /** The search query string */
  readonly query: string;
  /** Which search engine to use */
  readonly engine: SearchSource;
  /** Why this query is needed */
  readonly purpose: string;
  /** What information this query should provide */
  readonly expectedFindings: readonly string[];
}

/**
 * Complete query plan output from the Scout Query Planner (Phase 1).
 */
export interface QueryPlan {
  /** Working title for the article */
  readonly draftTitle: string;
  /** Strategic queries to execute (3-6) */
  readonly queries: readonly PlannedQuery[];
}

/**
 * Per-query briefing for the Editor agent (synthesized from multiple sources).
 * Contains cross-source synthesis and patterns.
 */
export interface QueryBriefing {
  /** The search query this briefing is for */
  readonly query: string;
  /** Which engine was used */
  readonly engine: SearchSource;
  /** Why this query was executed */
  readonly purpose: string;
  /** LLM-synthesized findings from multiple sources */
  readonly findings: string;
  /** Aggregated key facts from sources */
  readonly keyFacts: readonly string[];
  /** What information was NOT found (gaps) */
  readonly gaps: readonly string[];
  /** Number of sources used for this briefing */
  readonly sourceCount: number;
}

/**
 * Content type classification for source summaries.
 */
export type SourceContentType =
  | 'guide'
  | 'wiki'
  | 'news'
  | 'review'
  | 'forum'
  | 'official'
  | 'other';

/**
 * Detailed per-source summary for the Specialist agent.
 * Rich, specific content for writing with specificity.
 */
export interface SourceSummary {
  /** URL of the source */
  readonly url: string;
  /** Title of the source page */
  readonly title: string;
  /** Detailed summary with specific facts, numbers, names */
  readonly detailedSummary: string;
  /** Key facts extracted (bullet points) */
  readonly keyFacts: readonly string[];
  /** What type of content this is */
  readonly contentType: SourceContentType;
  /** Specific data points (stats, dates, names) */
  readonly dataPoints: readonly string[];
  /** Which query found this source */
  readonly query: string;
  /** Quality score from cleaner (0-100) */
  readonly qualityScore: number;
  /** Relevance score from cleaner (0-100) */
  readonly relevanceScore: number;
}

// ============================================================================
// Top Sources Per Query (for Editor context)
// ============================================================================

/**
 * The best source from a single search query, selected by quality + relevance.
 * Used to give the Editor agent detailed context for planning.
 */
export interface TopSourceForQuery {
  /** The search query this source came from */
  readonly query: string;
  /** The search engine used (tavily or exa) */
  readonly searchSource: SearchSource;
  /** Title of the source page */
  readonly title: string;
  /** URL of the source */
  readonly url: string;
  /** The cleaned content from this source */
  readonly content: string;
  /** Quality score (0-100) */
  readonly qualityScore: number;
  /** Relevance score (0-100) */
  readonly relevanceScore: number;
  /** Combined score used for selection (quality + relevance) */
  readonly combinedScore: number;
}

// ============================================================================
// Duplicate Tracking Types
// ============================================================================

/**
 * Information about a URL that appeared in multiple search queries.
 */
export interface DuplicateUrlInfo {
  /** The duplicated URL */
  readonly url: string;
  /** Domain extracted from URL */
  readonly domain: string;
  /** The first query that returned this URL (kept) */
  readonly firstSeenIn: {
    readonly query: string;
    readonly engine: SearchSource;
  };
  /** Subsequent queries that also returned this URL (duplicates) */
  readonly alsoDuplicatedIn: readonly {
    readonly query: string;
    readonly engine: SearchSource;
  }[];
}

/**
 * Statistics for a single search query.
 * Shows how results were filtered/deduplicated.
 */
export interface SearchQueryStats {
  /** The search query */
  readonly query: string;
  /** Search engine used */
  readonly engine: SearchSource;
  /** Phase (scout or specialist) */
  readonly phase: 'scout' | 'specialist';
  /** Number of results returned by the search engine */
  readonly received: number;
  /** Number of results removed as duplicates (already seen in earlier queries) */
  readonly duplicates: number;
  /** Number of results filtered (scrape failures, low quality, low relevance, etc.) */
  readonly filtered: number;
  /** Final number of usable results */
  readonly used: number;
}

// ============================================================================
// Context Types
// ============================================================================

/**
 * Context required to generate a game article.
 *
 * @property gameName - The game's display name (required)
 * @property gameSlug - URL-friendly slug for the game
 * @property releaseDate - ISO date string of release
 * @property genres - Array of genre names
 * @property platforms - Array of platform names
 * @property developer - Primary developer name
 * @property publisher - Primary publisher name
 * @property igdbDescription - Description from IGDB
 * @property instruction - User directive for article focus
 * @property categoryHints - Preferred article categories to consider
 * @property targetWordCount - Target word count for the article (category defaults apply if not specified)
 */
export interface GameArticleContext {
  readonly gameName: string;
  readonly gameSlug?: string | null;
  /**
   * Strapi document ID of the game entity.
   * Used for linking cleaned sources to the game in the database.
   */
  readonly gameDocumentId?: string | null;
  readonly releaseDate?: string | null;
  readonly genres?: readonly string[];
  readonly platforms?: readonly string[];
  readonly developer?: string | null;
  readonly publisher?: string | null;
  readonly igdbDescription?: string | null;
  readonly instruction?: string | null;
  /**
   * Explicitly requested article category.
   * If provided, this overrides intent detection and forces the article type.
   */
  readonly categorySlug?: ArticleCategorySlug;
  readonly categoryHints?: readonly CategoryHint[];
  /**
   * Target word count for the article.
   * If not specified, category-specific defaults from WORD_COUNT_DEFAULTS apply.
   * Must be between WORD_COUNT_CONSTRAINTS.MIN_WORD_COUNT and MAX_WORD_COUNT.
   */
  readonly targetWordCount?: number;
}

/**
 * A hint for article category selection.
 */
export interface CategoryHint {
  readonly slug: ArticleCategorySlug;
  readonly systemPrompt?: string | null;
}

// ============================================================================
// Token Usage Types
// ============================================================================

/**
 * Token usage for a single LLM call or phase.
 */
export interface TokenUsage {
  /** Number of input (prompt) tokens */
  readonly input: number;
  /** Number of output (completion) tokens */
  readonly output: number;
  /**
   * Actual cost in USD from OpenRouter.
   * Captured from providerMetadata.openrouter.usage.cost.
   * This is the real cost, not an estimate from token counts.
   */
  readonly actualCostUsd?: number;
}

/**
 * Token usage with sub-phase breakdown for Scout.
 */
export interface ScoutTokenUsage {
  /** Query planning LLM calls (generating search queries) */
  readonly queryPlanning: TokenUsage;
  /** Briefing generation LLM calls (synthesizing research into briefings) */
  readonly briefing: TokenUsage;
  /** Total Scout token usage (queryPlanning + briefing) */
  readonly total: TokenUsage;
}

/**
 * Token usage with sub-phase breakdown for Cleaner.
 */
export interface CleanerTokenUsage {
  /** Pre-filter LLM calls (quick relevance check on snippets) */
  readonly prefilter: TokenUsage;
  /** Extraction LLM calls (full content cleaning and summary generation) */
  readonly extraction: TokenUsage;
  /** Total Cleaner token usage (prefilter + extraction) */
  readonly total: TokenUsage;
}

/**
 * Aggregated token usage across all phases with sub-phase breakdowns.
 */
export interface AggregatedTokenUsage {
  /** Scout token usage with queryPlanning vs briefing breakdown */
  readonly scout: ScoutTokenUsage;
  readonly editor: TokenUsage;
  readonly specialist: TokenUsage;
  /** Reviewer token usage (may be empty if reviewer was disabled) */
  readonly reviewer?: TokenUsage;
  /** Fixer token usage (separate from reviewer for cost visibility) */
  readonly fixer?: TokenUsage;
  /**
   * Cleaner token usage with prefilter vs extraction breakdown.
   * May be empty if cleaning was disabled or no content was cleaned.
   */
  readonly cleaner?: CleanerTokenUsage;
  readonly total: TokenUsage;
  /**
   * Actual total LLM cost in USD from OpenRouter.
   * Sum of actualCostUsd from all phases.
   * Replaces the old estimatedCostUsd which was calculated from token counts.
   */
  readonly actualCostUsd?: number;
  /**
   * @deprecated Use actualCostUsd instead. Kept for backwards compatibility.
   */
  readonly estimatedCostUsd?: number;
}

/**
 * Search API cost from Exa.
 * Captured from Exa API response costDollars field.
 */
export interface ExaSearchCost {
  /** Cost in USD for this search */
  readonly costUsd: number;
  /** Search type used (affects pricing) */
  readonly searchType?: 'neural' | 'deep';
}

/**
 * Search API cost from Tavily.
 * Captured from Tavily API response usage.credits field.
 * Cost: $0.008 per credit (basic=1, advanced=2)
 */
export interface TavilySearchCost {
  /** Number of credits used for this search */
  readonly credits: number;
  /** Cost in USD for this search (credits × $0.008) */
  readonly costUsd: number;
}

/** Tavily cost per credit in USD */
export const TAVILY_COST_PER_CREDIT = 0.008;

/**
 * Aggregated search API costs across all phases.
 * Tracks actual costs from both Exa and Tavily API responses.
 */
export interface SearchApiCosts {
  /** Total search API cost in USD */
  readonly totalUsd: number;
  /** Number of Exa searches performed */
  readonly exaSearchCount: number;
  /** Number of Tavily searches performed */
  readonly tavilySearchCount: number;
  /** Total cost from Exa (from API responses) */
  readonly exaCostUsd: number;
  /** Total cost from Tavily (from API responses, or estimated if not available) */
  readonly tavilyCostUsd: number;
  /** Total Tavily credits used (from API responses) */
  readonly tavilyCredits: number;
}

/**
 * Creates an empty search API costs object.
 */
export function createEmptySearchApiCosts(): SearchApiCosts {
  return {
    totalUsd: 0,
    exaSearchCount: 0,
    tavilySearchCount: 0,
    exaCostUsd: 0,
    tavilyCostUsd: 0,
    tavilyCredits: 0,
  };
}

/**
 * Adds an Exa search cost to the aggregate.
 */
export function addExaSearchCost(
  costs: SearchApiCosts,
  exaCost: ExaSearchCost
): SearchApiCosts {
  return {
    ...costs,
    exaSearchCount: costs.exaSearchCount + 1,
    exaCostUsd: costs.exaCostUsd + exaCost.costUsd,
    totalUsd: costs.totalUsd + exaCost.costUsd,
  };
}

/**
 * Adds a Tavily search cost to the aggregate.
 * Uses actual credits from API response, or estimates if not available.
 *
 * @param tavilyCost - Cost info from Tavily API, or undefined for estimate
 */
export function addTavilySearch(
  costs: SearchApiCosts,
  tavilyCost?: TavilySearchCost
): SearchApiCosts {
  // If we have actual cost from API, use it
  if (tavilyCost) {
    return {
      ...costs,
      tavilySearchCount: costs.tavilySearchCount + 1,
      tavilyCredits: costs.tavilyCredits + tavilyCost.credits,
      tavilyCostUsd: costs.tavilyCostUsd + tavilyCost.costUsd,
      totalUsd: costs.totalUsd + tavilyCost.costUsd,
    };
  }

  // Fallback: estimate 1 credit for basic search
  const estimatedCost = TAVILY_COST_PER_CREDIT;
  return {
    ...costs,
    tavilySearchCount: costs.tavilySearchCount + 1,
    tavilyCredits: costs.tavilyCredits + 1,
    tavilyCostUsd: costs.tavilyCostUsd + estimatedCost,
    totalUsd: costs.totalUsd + estimatedCost,
  };
}

// ============================================================================
// Source Content Usage Tracking
// ============================================================================

/**
 * Content type used for a source in the LLM context.
 * Always 'full' - we always use full content from sources.
 */
export type ContentType = 'full';

/**
 * Tracking of which content type was used for a single source.
 */
export interface SourceUsageItem {
  readonly url: string;
  readonly title: string;
  /** Which content type was used in the LLM context (always 'full') */
  readonly contentType: ContentType;
  /** Phase where this source was used */
  readonly phase: 'scout' | 'specialist';
  /** Section headline (for specialist phase) */
  readonly section?: string;
  /** Search query that returned this source */
  readonly query: string;
  /** Which search API returned this source (exa or tavily) */
  readonly searchSource?: SearchSource;
  /** Quality score (0-100) from cleaner */
  readonly qualityScore?: number;
  /** Relevance score (0-100) from cleaner */
  readonly relevanceScore?: number;
  /** Length of cleaned content in characters */
  readonly cleanedCharCount?: number;
  /** Whether this content was retrieved from cache (true) or newly cleaned (false) */
  readonly wasCached?: boolean;
}

/**
 * Aggregated tracking of source content usage across all phases.
 */
export interface SourceContentUsage {
  /** All sources with their content type usage */
  readonly sources: readonly SourceUsageItem[];
  /** Summary counts */
  readonly counts: {
    readonly total: number;
  };
}

/**
 * Creates an empty source content usage tracker.
 */
export function createEmptySourceContentUsage(): SourceContentUsage {
  return {
    sources: [],
    counts: {
      total: 0,
    },
  };
}

/**
 * Adds source usage items to the tracker.
 */
export function addSourceUsage(
  usage: SourceContentUsage,
  items: readonly SourceUsageItem[]
): SourceContentUsage {
  return {
    sources: [...usage.sources, ...items],
    counts: {
      total: usage.counts.total + items.length,
    },
  };
}

/**
 * Extracts source usage items from Scout's research pool.
 * Converts the research pool's CategorizedSearchResults into SourceUsageItems.
 */
export function extractScoutSourceUsage(researchPool: ResearchPool): readonly SourceUsageItem[] {
  const sources: SourceUsageItem[] = [];
  const seenUrls = new Set<string>();

  // Helper to process a list of categorized results
  const processResults = (results: readonly CategorizedSearchResult[]) => {
    for (const categorized of results) {
      for (const result of categorized.results) {
        // Deduplicate by URL
        if (seenUrls.has(result.url)) continue;
        seenUrls.add(result.url);

        sources.push({
          url: result.url,
          title: result.title,
          contentType: 'full',
          phase: 'scout',
          query: categorized.query,
          searchSource: categorized.searchSource ?? 'tavily',
          // Include quality/relevance scores if available (from cleaned sources)
          ...(result.qualityScore !== undefined ? { qualityScore: result.qualityScore } : {}),
          ...(result.relevanceScore !== undefined ? { relevanceScore: result.relevanceScore } : {}),
          // Include cleaned content length
          cleanedCharCount: result.content.length,
          // Include cache status if available
          ...(result.wasCached !== undefined ? { wasCached: result.wasCached } : {}),
        });
      }
    }
  };

  // Process all Scout findings
  processResults(researchPool.scoutFindings.overview);
  processResults(researchPool.scoutFindings.categorySpecific);
  processResults(researchPool.scoutFindings.recent);

  return sources;
}

/**
 * Creates an empty token usage object.
 */
export function createEmptyTokenUsage(): TokenUsage {
  return { input: 0, output: 0 };
}

/**
 * Adds two token usage objects together.
 * Also aggregates actualCostUsd if present.
 */
export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  // Sum actual costs if either has one
  const aCost = a.actualCostUsd ?? 0;
  const bCost = b.actualCostUsd ?? 0;
  const hasCost = a.actualCostUsd !== undefined || b.actualCostUsd !== undefined;

  return {
    input: a.input + b.input,
    output: a.output + b.output,
    ...(hasCost ? { actualCostUsd: aCost + bCost } : {}),
  };
}

/**
 * Extracts actual cost from OpenRouter provider metadata.
 * The @openrouter/ai-sdk-provider returns cost in providerMetadata.openrouter.usage.cost
 *
 * @param result - The result from generateText or generateObject
 * @returns The actual cost in USD, or undefined if not available
 */
export function extractOpenRouterCost(result: {
  providerMetadata?: Record<string, unknown>;
}): number | undefined {
  const openrouterMeta = result.providerMetadata?.openrouter as Record<string, unknown> | undefined;
  const usage = openrouterMeta?.usage as Record<string, unknown> | undefined;
  const cost = usage?.cost;
  return typeof cost === 'number' ? cost : undefined;
}

/**
 * Creates a TokenUsage object from an AI SDK result.
 * Extracts both token counts and actual cost from OpenRouter.
 *
 * @param result - The result from generateText or generateObject
 * @returns TokenUsage with input, output, and actualCostUsd
 */
export function createTokenUsageFromResult(result: {
  usage?: { inputTokens?: number; outputTokens?: number };
  providerMetadata?: Record<string, unknown>;
}): TokenUsage {
  return {
    input: result.usage?.inputTokens ?? 0,
    output: result.usage?.outputTokens ?? 0,
    actualCostUsd: extractOpenRouterCost(result),
  };
}

// ============================================================================
// Draft Types
// ============================================================================

/**
 * Metadata about the article generation process.
 */
export interface ArticleGenerationMetadata {
  /** ISO timestamp when generation completed */
  readonly generatedAt: string;
  /** Total generation time in milliseconds */
  readonly totalDurationMs: number;
  /** Duration of each phase in milliseconds */
  readonly phaseDurations: {
    readonly scout: number;
    readonly editor: number;
    readonly specialist: number;
    /** Reviewer phase duration (0 if reviewer was disabled) */
    readonly reviewer: number;
    readonly validation: number;
    /** Fixer phase duration (0 if no fixes were needed) */
    readonly fixer?: number;
  };
  /** Number of search queries executed */
  readonly queriesExecuted: number;
  /** Number of unique sources collected */
  readonly sourcesCollected: number;
  /** Token usage by phase (optional - may not be available if API doesn't report it) */
  readonly tokenUsage?: AggregatedTokenUsage;
  /**
   * Search API costs from Tavily and Exa.
   * Exa costs are actual (from API response), Tavily costs are estimated.
   */
  readonly searchApiCosts?: SearchApiCosts;
  /**
   * Total estimated cost for article generation in USD.
   * Combines LLM token costs + Search API costs.
   */
  readonly totalEstimatedCostUsd?: number;
  /**
   * Tracking of which content type was used for each source.
   * Shows whether full text or summary was used in the LLM context.
   */
  readonly sourceContentUsage?: SourceContentUsage;
  /** Correlation ID for log tracing */
  readonly correlationId: string;
  /** Research confidence level from Scout phase */
  readonly researchConfidence: ResearchConfidence;
  /** Recovery metadata (present when any retries or fixes were applied) */
  readonly recovery?: RecoveryMetadata;
  /**
   * Sources filtered out due to low quality or relevance.
   * Tracked for transparency and debugging.
   */
  readonly filteredSources?: readonly FilteredSourceSummary[];
  /**
   * URLs that appeared in multiple search queries.
   * Tracks where duplicates were found and which query "kept" the result.
   */
  readonly duplicatedUrls?: readonly DuplicateUrlInfo[];
  /**
   * Per-query statistics showing received vs used results.
   * Helps understand where results were lost to deduplication or filtering.
   */
  readonly queryStats?: readonly SearchQueryStats[];
  /**
   * Query briefings generated by Scout.
   * Contains per-query synthesis of findings for debugging/analysis.
   */
  readonly queryBriefings?: readonly QueryBriefing[];
}

/**
 * Summary of a filtered source for metadata tracking.
 */
export interface FilteredSourceSummary {
  readonly url: string;
  readonly domain: string;
  readonly title: string;
  readonly qualityScore: number;
  /** Relevance score (0-100), or null if unknown (e.g., scrape failures) */
  readonly relevanceScore: number | null;
  /** Reason for filtering */
  readonly reason: 'low_relevance' | 'low_quality' | 'excluded_domain' | 'pre_filtered' | 'scrape_failure';
  /** Human-readable details */
  readonly details: string;
  /** Search query that returned this source */
  readonly query?: string;
  /** Phase where this source was filtered (scout or specialist) */
  readonly phase?: 'scout' | 'specialist';
  /** Search provider that returned this source */
  readonly searchSource?: 'tavily' | 'exa';
  /** Stage where filtering happened */
  readonly filterStage?: 'programmatic' | 'pre_filter' | 'full_clean' | 'post_clean';
  /** Length of cleaned content in characters (if available) */
  readonly cleanedCharCount?: number;
}

/**
 * A single issue identified by the Reviewer agent.
 * Imported here to avoid circular dependency with reviewer.ts.
 */
export interface ReviewIssue {
  readonly severity: 'critical' | 'major' | 'minor';
  readonly category: 'checklist' | 'structure' | 'redundancy' | 'coverage' | 'factual' | 'style' | 'seo';
  /** Section headline or "title", "excerpt", etc. */
  readonly location?: string;
  readonly message: string;
  readonly suggestion?: string;
  /**
   * Recommended fix strategy for autonomous recovery.
   * - inline_insert: Surgical insertion of words/clauses (e.g., "at Lookout Landing")
   * - direct_edit: Minor text replacement (clichés, typos)
   * - regenerate: Rewrite entire section
   * - add_section: Create new section for coverage gaps
   * - expand: Add ONE focused paragraph to existing section
   * - no_action: Minor issue, skip fixing
   */
  readonly fixStrategy: FixStrategy;
  /**
   * Specific instruction for the Fixer agent.
   * For direct_edit: what text to find and what to replace with
   * For regenerate: feedback on what went wrong and what to improve
   * For add_section: topic and key points to cover
   * For expand: what aspects need more depth
   */
  readonly fixInstruction?: string;
}

/**
 * A generated article draft ready for review/publishing.
 */
export interface GameArticleDraft {
  readonly title: string;
  readonly categorySlug: ArticleCategorySlug;
  readonly excerpt: string;
  readonly tags: readonly string[];
  readonly markdown: string;
  readonly sources: readonly string[];
  readonly plan: ArticlePlan;
  readonly models: {
    readonly scout: string;
    readonly editor: string;
    readonly specialist: string;
    /** Reviewer model (may be undefined if reviewer was disabled) */
    readonly reviewer?: string;
    /** Cleaner model (may be undefined if cleaner was disabled) */
    readonly cleaner?: string;
  };
  /** Generation metadata for debugging and analytics */
  readonly metadata: ArticleGenerationMetadata;
  /**
   * Issues identified by the Reviewer agent after all fixes.
   * Empty array if reviewer was disabled or no issues found.
   * These are the REMAINING issues that could not be fixed.
   */
  readonly reviewerIssues?: readonly ReviewIssue[];
  /**
   * Issues found during the INITIAL review before any fixes.
   * Only present if some issues were fixed (i.e., different from reviewerIssues).
   * Use this to see the complete history of what was found and fixed.
   */
  readonly reviewerInitialIssues?: readonly ReviewIssue[];
  /** Whether the Reviewer approved the article */
  readonly reviewerApproved?: boolean;
}

// ============================================================================
// Progress Callback Types
// ============================================================================

/** Phases of article generation, derived from ARTICLE_GENERATION_PHASES constant */
export type ArticleGenerationPhase = (typeof ARTICLE_GENERATION_PHASES)[number];

/**
 * Progress callback for monitoring article generation.
 *
 * @param phase - Current phase of generation
 * @param progress - Progress percentage (0-100) within the phase
 * @param message - Optional status message
 */
export type ArticleProgressCallback = (
  phase: ArticleGenerationPhase,
  progress: number,
  message?: string
) => void;

/**
 * Callback for monitoring section writing progress within the Specialist phase.
 *
 * @param current - Current section number (1-indexed)
 * @param total - Total number of sections
 * @param headline - Headline of the section being written
 */
export type SectionProgressCallback = (current: number, total: number, headline: string) => void;

/**
 * Callback for monitoring batch research progress within the Specialist phase.
 *
 * @param completed - Number of completed queries
 * @param total - Total number of queries to execute
 */
export type ResearchProgressCallback = (completed: number, total: number) => void;

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Severity level for validation issues.
 */
export type ValidationSeverity = 'error' | 'warning';

/**
 * A validation issue found during draft validation.
 */
export interface ValidationIssue {
  readonly severity: ValidationSeverity;
  readonly message: string;
}

// ============================================================================
// Fixer Types (Autonomous Article Recovery)
// ============================================================================

/**
 * Available fix strategies for the autonomous Fixer.
 *
 * - inline_insert: Surgical insertion of words/clauses into existing sentences (e.g., adding location context)
 * - direct_edit: Minor text replacement (clichés, typos, style fixes)
 * - regenerate: Rewrite entire section with feedback
 * - add_section: Create new section for coverage gaps
 * - expand: Add ONE focused paragraph to existing section (preserves existing content)
 * - batch: Multiple issues fixed in a single pass (internal, used when >1 issue per section)
 * - no_action: Minor issue that doesn't warrant a fix
 */
export type FixStrategy =
  | 'inline_insert'
  | 'direct_edit'
  | 'regenerate'
  | 'add_section'
  | 'expand'
  | 'batch'
  | 'no_action';

/**
 * Record of a fix that was applied during article recovery.
 */
export interface FixApplied {
  /** Which Fixer iteration this fix was applied in (1-indexed) */
  readonly iteration: number;
  /** The strategy used to fix the issue */
  readonly strategy: FixStrategy;
  /** Target of the fix: section headline or "global" for article-wide fixes */
  readonly target: string;
  /** Reason the fix was applied (from Reviewer issue message) */
  readonly reason: string;
  /** Whether the fix was successfully applied */
  readonly success: boolean;
}

/**
 * Record of a plan that was rejected during validation.
 * Used for debugging and comparing original vs final plans.
 */
export interface RejectedPlan {
  /** The plan that was rejected */
  readonly plan: ArticlePlan;
  /** Validation errors that caused rejection */
  readonly validationErrors: readonly string[];
  /** Timestamp when rejection occurred */
  readonly timestamp: string;
}

/**
 * Metadata about recovery attempts during article generation.
 * Tracks all retries and fixes applied to produce the final article.
 * Includes original content for comparison with final output.
 */
export interface RecoveryMetadata {
  /** Number of times the Editor phase was retried due to plan validation failures */
  readonly planRetries: number;
  /** Map of section headline to retry count for sections that failed during Specialist phase */
  readonly sectionRetries: Record<string, number>;
  /** Number of Fixer loop iterations (0 if no fixes were needed) */
  readonly fixerIterations: number;
  /** List of all fixes applied during recovery */
  readonly fixesApplied: readonly FixApplied[];
  /**
   * Plans that were rejected during validation, with their errors.
   * Allows comparison of original plan structure vs final plan.
   * Only present if planRetries > 0.
   */
  readonly rejectedPlans?: readonly RejectedPlan[];
  /**
   * Original markdown content before Fixer modifications.
   * Allows comparison of before/after content.
   * Only present if fixerIterations > 0.
   */
  readonly originalMarkdown?: string;
  /**
   * Markdown content after each Fixer iteration.
   * Allows tracking incremental improvements.
   * Only present if fixerIterations > 1.
   */
  readonly markdownHistory?: readonly string[];
  /**
   * Honest metrics about recovery outcomes (not just operations).
   * Only present if fixerIterations > 0.
   */
  readonly outcomeMetrics?: FixerOutcomeMetrics;
}

/**
 * Honest metrics about fixer outcomes.
 * Distinguishes between operations performed vs actual outcomes.
 */
export interface FixerOutcomeMetrics {
  /** Number of fix operations attempted (sections worked on) */
  readonly operationsAttempted: number;
  /** Number of fix operations that changed the markdown */
  readonly operationsSucceeded: number;
  /** Issues by severity BEFORE fixing started */
  readonly issuesBefore: IssueSeverityCounts;
  /** Issues by severity AFTER fixing completed */
  readonly issuesAfter: IssueSeverityCounts;
  /** Net change in issue counts (negative = improvement) */
  readonly netChange: IssueSeverityCounts;
  /** Whether the reviewer approved the final article */
  readonly reviewerApproved: boolean;
  /** 
   * Note about issue tracking: Issues may change between reviews.
   * A fix may resolve one issue but the reviewer may identify new issues.
   * "operationsSucceeded" means markdown changed, NOT that specific issues were resolved.
   */
  readonly note: string;
}

/**
 * Issue counts by severity level.
 */
export interface IssueSeverityCounts {
  readonly critical: number;
  readonly major: number;
  readonly minor: number;
  readonly total: number;
}

// ============================================================================
// Dependency Injection Types
// ============================================================================

/**
 * Result from search function, includes optional cost tracking.
 */
export interface SearchFunctionResult {
  readonly query: string;
  readonly answer: string | null;
  readonly results: readonly { title: string; url: string; content?: string; score?: number }[];
  /** Cost in USD for this search (from Tavily API response) */
  readonly costUsd?: number;
  /** Credits used for this search (from Tavily API response) */
  readonly credits?: number;
}

/**
 * Search function type for dependency injection.
 */
export type SearchFunction = (
  query: string,
  options?: {
    searchDepth?: 'basic' | 'advanced';
    maxResults?: number;
    includeAnswer?: boolean;
    includeRawContent?: boolean;
    /** Domains to exclude (e.g., YouTube for no text content) */
    excludeDomains?: readonly string[];
  }
) => Promise<SearchFunctionResult>;

// ============================================================================
// Clock Abstraction (for testability)
// ============================================================================

/**
 * Clock interface for time-related operations.
 * Enables deterministic testing by allowing time to be mocked.
 *
 * @example
 * // Production usage (default)
 * const clock = systemClock;
 * const now = clock.now();
 *
 * @example
 * // Test usage
 * const mockClock: Clock = { now: () => 1234567890000 };
 */
export interface Clock {
  /** Returns current timestamp in milliseconds (like Date.now()) */
  now(): number;
}

/**
 * Default clock implementation using system time.
 */
export const systemClock: Clock = {
  now: () => Date.now(),
};

/**
 * Creates a mock clock for testing with a fixed or advancing time.
 *
 * @param initialTime - Starting timestamp in milliseconds
 * @param autoAdvance - If provided, advances time by this many ms on each call
 * @returns A Clock instance for testing
 *
 * @example
 * // Fixed time
 * const clock = createMockClock(1000000);
 * clock.now(); // 1000000
 * clock.now(); // 1000000
 *
 * @example
 * // Auto-advancing time (100ms per call)
 * const clock = createMockClock(1000000, 100);
 * clock.now(); // 1000000
 * clock.now(); // 1000100
 * clock.now(); // 1000200
 */
export function createMockClock(initialTime: number, autoAdvance?: number): Clock {
  let currentTime = initialTime;
  return {
    now: () => {
      const time = currentTime;
      if (autoAdvance !== undefined) {
        currentTime += autoAdvance;
      }
      return time;
    },
  };
}

// ============================================================================
// Cleaner Agent Types
// ============================================================================

/**
 * Quality tier for domains based on average score.
 * This is an enum because it maps to specific score thresholds.
 */
export type DomainTier = 'excellent' | 'good' | 'average' | 'poor' | 'excluded';

/**
 * Raw source input before cleaning.
 */
export interface RawSourceInput {
  readonly url: string;
  readonly title: string;
  readonly content: string;
  readonly searchSource: SearchSource;
  /**
   * Optional clean snippet for pre-filtering (Tavily's extracted content).
   * Tavily provides ~800c clean snippet that's better for pre-filtering
   * than taking the first N chars of raw_content (which may have navigation).
   */
  readonly snippet?: string;
}

/**
 * Cleaned source output from the Cleaner agent.
 */
export interface CleanedSource {
  readonly url: string;
  readonly domain: string;
  readonly title: string;
  /** Short summary for quick reference (1-2 sentences) */
  readonly summary: string | null;
  /** Detailed summary with specific facts, numbers, and names (paragraph form) */
  readonly detailedSummary: string | null;
  /** Key facts extracted as bullet points */
  readonly keyFacts: readonly string[] | null;
  /** Specific data points: stats, dates, names, numbers */
  readonly dataPoints: readonly string[] | null;
  readonly cleanedContent: string;
  readonly originalContentLength: number;
  /** Content quality score (0-100): structure, depth, authority */
  readonly qualityScore: number;
  /**
   * Relevance to gaming score (0-100): Is this about games/gaming?
   * Content can be high quality but low relevance (e.g., Python docs).
   * Only content with high relevance should be used for game articles.
   */
  readonly relevanceScore: number;
  readonly qualityNotes: string;
  /** AI-determined content type (e.g., "wiki", "guide", "forum", "news article", etc.) */
  readonly contentType: string;
  readonly junkRatio: number;
  readonly searchSource: SearchSource;
}

/**
 * Cached source content from checkSourceCache.
 * Extends CleanedSource with scrapeSucceeded for detecting scrape failures.
 */
export interface CachedSourceContent extends CleanedSource {
  /** Whether scraping succeeded (content > MIN_CONTENT_LENGTH chars) */
  readonly scrapeSucceeded: boolean;
  /** 
   * Whether this cached entry needs reprocessing (legacy data with NULL relevance).
   * If true, the entry has valid cleanedContent but missing relevance score.
   * Caller should re-clean to calculate proper relevance.
   */
  readonly needsReprocessing: boolean;
}

/**
 * Cache check result for a single URL.
 */
export interface CacheCheckResult {
  readonly url: string;
  readonly hit: boolean;
  /** Cached content (may be a scrape failure if scrapeSucceeded is false) */
  readonly cached?: CachedSourceContent;
  readonly raw?: RawSourceInput;
}

/**
 * Stored source content from database.
 */
export interface StoredSourceContent {
  readonly id: number;
  readonly documentId: string;
  readonly url: string;
  readonly domain: string;
  readonly title: string;
  /** Short summary for quick reference (1-2 sentences) */
  readonly summary: string | null;
  /** Detailed summary with specific facts, numbers, and names (paragraph form) */
  readonly detailedSummary: string | null;
  /** Key facts extracted as bullet points */
  readonly keyFacts: readonly string[] | null;
  /** Specific data points: stats, dates, names, numbers */
  readonly dataPoints: readonly string[] | null;
  readonly cleanedContent: string;
  readonly originalContentLength: number;
  /** Quality score (0-100), null for scrape failures */
  readonly qualityScore: number | null;
  /** Relevance to gaming score (0-100), null for scrape failures */
  readonly relevanceScore: number | null;
  readonly qualityNotes: string | null;
  /** AI-determined content type */
  readonly contentType: string;
  readonly junkRatio: number;
  readonly accessCount: number;
  readonly lastAccessedAt: string | null;
  readonly searchSource: SearchSource;
  /** Whether scraping succeeded (content > MIN_CONTENT_LENGTH chars) */
  readonly scrapeSucceeded: boolean;
}

/**
 * Stored domain quality from database.
 */
export interface StoredDomainQuality {
  readonly id: number;
  readonly documentId: string;
  readonly domain: string;
  readonly avgQualityScore: number;
  /** Average relevance to gaming (0-100) */
  readonly avgRelevanceScore: number;
  readonly totalSources: number;
  readonly tier: DomainTier;
  /** Global exclusion (low quality or low relevance) */
  readonly isExcluded: boolean;
  readonly excludeReason: string | null;
  /** AI-inferred domain type */
  readonly domainType: string;
  /** Total scrape attempts via Tavily */
  readonly tavilyAttempts: number;
  /** Scrape failures via Tavily */
  readonly tavilyScrapeFailures: number;
  /** Total scrape attempts via Exa */
  readonly exaAttempts: number;
  /** Scrape failures via Exa */
  readonly exaScrapeFailures: number;
  /** Per-engine exclusion for Tavily (scrape failure rate exceeded) */
  readonly isExcludedTavily: boolean;
  /** Per-engine exclusion for Exa (scrape failure rate exceeded) */
  readonly isExcludedExa: boolean;
  /** Reason for Tavily exclusion */
  readonly tavilyExcludeReason: string | null;
  /** Reason for Exa exclusion */
  readonly exaExcludeReason: string | null;
}

/**
 * Dependencies for the Cleaner agent.
 */
export interface CleanerDeps {
  readonly generateObject: typeof import('ai').generateObject;
  readonly model: import('ai').LanguageModel;
  readonly logger?: import('../../utils/logger').Logger;
  readonly signal?: AbortSignal;
  /** Game name for relevance scoring context */
  readonly gameName?: string;
}

/**
 * Options for cleaning sources.
 */
export interface CleanSourcesOptions {
  /** Game name for relevance scoring context */
  readonly gameName?: string;
  /** Game document ID for linking cleaned sources */
  readonly gameDocumentId?: string | null;
}

/**
 * Result of cleaning a single source.
 */
export interface CleanSingleSourceResult {
  /** Cleaned source or null if cleaning failed */
  readonly source: CleanedSource | null;
  /** Token usage for this cleaning operation */
  readonly tokenUsage: TokenUsage;
}

/**
 * Result of cleaning multiple sources.
 */
export interface CleanSourcesResult {
  /** All sources (cached + newly cleaned) */
  readonly sources: readonly CleanedSource[];
  /** Number of cache hits */
  readonly cacheHits: number;
  /** Number of cache misses (newly cleaned) */
  readonly cacheMisses: number;
  /** Total time for cleaning in ms */
  readonly durationMs: number;
  /** Aggregated token usage from all cleaning LLM calls */
  readonly tokenUsage: TokenUsage;
}

/**
 * Cleaner agent output schema for LLM.
 */
export interface CleanerLLMOutput {
  readonly cleanedContent: string;
  /** Short 1-2 sentence summary for quick reference */
  readonly summary: string;
  /** Detailed summary with specific facts, numbers, and names (paragraph form) */
  readonly detailedSummary: string;
  /** Key facts extracted as bullet points (3-7 items) */
  readonly keyFacts: readonly string[];
  /** Specific data points: stats, dates, names, numbers (3-10 items) */
  readonly dataPoints: readonly string[];
  /** Content quality score (0-100): depth, structure, authority */
  readonly qualityScore: number;
  /** Gaming relevance score (0-100): Is this about video games? */
  readonly relevanceScore: number;
  readonly qualityNotes: string;
  /** AI-determined content type (free-form, e.g., "wiki article", "strategy guide", "forum discussion") */
  readonly contentType: string;
}

