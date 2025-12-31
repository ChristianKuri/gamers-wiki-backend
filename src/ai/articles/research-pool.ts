/**
 * Research Pool Management
 *
 * Manages the collection of research results from Scout and Specialist agents.
 * Uses a builder pattern internally for efficient mutation, returning immutable
 * snapshots at boundaries.
 *
 * Optionally integrates with the Cleaner agent to clean raw content and cache
 * results in Strapi for future reuse.
 */

import type { Core } from '@strapi/strapi';
import type { LanguageModel } from 'ai';

import { CLEANER_CONFIG } from './config';
import type { Logger } from '../../utils/logger';
import {
  addTokenUsage,
  createEmptyTokenUsage,
  type CategorizedSearchResult,
  type CleanedSource,
  type RawSourceInput,
  type ResearchPool,
  type SearchCategory,
  type SearchResultItem,
  type SearchSource,
  type TokenUsage,
} from './types';

// ============================================================================
// Query Normalization
// ============================================================================

/**
 * Normalizes a query string for deduplication.
 */
export function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

// ============================================================================
// URL Normalization
// ============================================================================

/**
 * Normalizes a URL for deduplication and validation.
 * Returns null for invalid or non-http(s) URLs.
 */
export function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Extract domain from URL.
 */
export function extractDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ============================================================================
// Pre-Filter: Quick Relevance Check (before LLM cleaning)
// ============================================================================

/**
 * Patterns that indicate obviously non-gaming content.
 * These are checked against URL and title to skip LLM cleaning.
 */
const OBVIOUSLY_IRRELEVANT_PATTERNS = [
  // Adult content
  /\bporn\b/i,
  /\bxxx\b/i,
  /\badult\b/i,
  /\bnsfw\b/i,
  /xhamster/i,
  /pornhub/i,
  /xvideos/i,
  // Shopping/commerce (non-gaming)
  /\bamazon\.com\/(?!.*game)/i,
  /\bebay\.com/i,
  /\baliexpress/i,
  // Social media / forums (low-quality user content)
  /\breddit\.com/i,
  /twitter\.com\/\w+$/i,
  /facebook\.com\/\w+$/i,
  /instagram\.com\/\w+$/i,
  /fextralife\.com\/forums/i, // Fextralife forums (wiki subdomains are fine)
  // Programming/tech docs (unless it's game dev)
  /docs\.python\.org/i,
  /docs\.oracle\.com/i,
  /flask\.palletsprojects/i,
  /django\.readthedocs/i,
  /\bstackoverflow\.com/i,
  // Interior design, real estate, etc
  /\bhouzz\.com/i,
  /\bzillow\.com/i,
  /\brealtor\.com/i,
  /\bcoohom\.com/i,
];

/**
 * Check if a source is obviously irrelevant based on URL and title.
 * This is a cheap pre-filter to avoid wasting LLM tokens.
 * 
 * @param url - Source URL
 * @param title - Source title
 * @returns Object with isIrrelevant flag and reason if true
 */
export function quickRelevanceCheck(
  url: string,
  title: string
): { isIrrelevant: boolean; reason?: string } {
  const combined = `${url} ${title}`.toLowerCase();

  for (const pattern of OBVIOUSLY_IRRELEVANT_PATTERNS) {
    if (pattern.test(combined)) {
      return {
        isIrrelevant: true,
        reason: `Matched pattern: ${pattern.source}`,
      };
    }
  }

  return { isIrrelevant: false };
}

/**
 * Pre-filter result for a source.
 */
export interface PreFilterResult {
  readonly source: RawSourceInput;
  readonly shouldClean: boolean;
  readonly skipReason?: string;
}

/**
 * Pre-filter sources before sending to LLM cleaner.
 * Checks:
 * 1. Quick pattern-based relevance (no LLM needed)
 * 2. Domain reputation from database (if available)
 * 
 * @param sources - Raw sources to check
 * @param strapi - Strapi instance for DB lookups
 * @param logger - Optional logger
 * @returns Filtered sources with reasons
 */
export async function preFilterSources(
  sources: readonly RawSourceInput[],
  strapi: Core.Strapi,
  logger?: Logger
): Promise<{
  toClean: RawSourceInput[];
  skipped: Array<{ source: RawSourceInput; reason: string }>;
}> {
  const toClean: RawSourceInput[] = [];
  const skipped: Array<{ source: RawSourceInput; reason: string }> = [];

  // Get known bad domains from DB
  const knex = strapi.db.connection;
  const badDomains = new Set<string>();

  try {
    const results = await knex('domain_qualities')
      .where('is_excluded', true)
      .orWhere('avg_quality_score', '<', CLEANER_CONFIG.MIN_QUALITY_FOR_RESULTS)
      .orWhere('avg_relevance_score', '<', CLEANER_CONFIG.AUTO_EXCLUDE_RELEVANCE_THRESHOLD)
      .select('domain');

    for (const row of results) {
      badDomains.add((row as { domain: string }).domain);
    }
  } catch (err) {
    // If DB query fails, continue without domain filtering
    logger?.debug?.(`Pre-filter: Could not load domain quality data: ${err}`);
  }

  for (const source of sources) {
    const domain = extractDomainFromUrl(source.url);

    // Check 1: Quick pattern-based relevance
    const relevanceCheck = quickRelevanceCheck(source.url, source.title);
    if (relevanceCheck.isIrrelevant) {
      skipped.push({
        source,
        reason: `Quick filter: ${relevanceCheck.reason}`,
      });
      continue;
    }

    // Check 2: Known bad domain
    if (badDomains.has(domain)) {
      skipped.push({
        source,
        reason: `Known bad domain: ${domain}`,
      });
      continue;
    }

    toClean.push(source);
  }

  if (skipped.length > 0) {
    logger?.info?.(
      `Pre-filtered ${skipped.length} source(s) before cleaning: ` +
        skipped.map((s) => `${extractDomainFromUrl(s.source.url)} (${s.reason.slice(0, 30)})`).join(', ')
    );
  }

  return { toClean, skipped };
}

// ============================================================================
// Research Pool Builder
// ============================================================================

/**
 * Internal mutable state for the builder.
 */
interface MutableResearchPool {
  scoutFindings: {
    overview: CategorizedSearchResult[];
    categorySpecific: CategorizedSearchResult[];
    recent: CategorizedSearchResult[];
  };
  allUrls: Set<string>;
  queryCache: Map<string, CategorizedSearchResult>;
}

/**
 * Builder for constructing a ResearchPool efficiently.
 *
 * Uses mutable state internally for performance during construction,
 * then produces an immutable snapshot via `build()`.
 *
 * @example
 * const pool = new ResearchPoolBuilder()
 *   .add(overviewResult)
 *   .add(categoryResult)
 *   .build();
 */
export class ResearchPoolBuilder {
  private readonly pool: MutableResearchPool;

  constructor(initialPool?: ResearchPool) {
    if (initialPool) {
      this.pool = {
        scoutFindings: {
          overview: [...initialPool.scoutFindings.overview],
          categorySpecific: [...initialPool.scoutFindings.categorySpecific],
          recent: [...initialPool.scoutFindings.recent],
        },
        allUrls: new Set(initialPool.allUrls),
        queryCache: new Map(initialPool.queryCache),
      };
    } else {
      this.pool = {
        scoutFindings: {
          overview: [],
          categorySpecific: [],
          recent: [],
        },
        allUrls: new Set(),
        queryCache: new Map(),
      };
    }
  }

  /**
   * Adds a categorized search result to the pool.
   * Skips duplicate queries (based on normalized query string).
   *
   * @param result - The search result to add
   * @returns this for chaining
   */
  add(result: CategorizedSearchResult): this {
    const normalizedQuery = normalizeQuery(result.query);

    // Skip duplicate queries
    if (this.pool.queryCache.has(normalizedQuery)) {
      return this;
    }

    // Add normalized URLs to tracking (prevents duplicates with trailing slashes, etc.)
    for (const r of result.results) {
      const normalized = normalizeUrl(r.url);
      if (normalized) {
        this.pool.allUrls.add(normalized);
      }
    }

    // Add to appropriate category
    switch (result.category) {
      case 'overview':
        this.pool.scoutFindings.overview.push(result);
        break;
      case 'category-specific':
        this.pool.scoutFindings.categorySpecific.push(result);
        break;
      case 'recent':
        this.pool.scoutFindings.recent.push(result);
        break;
      case 'section-specific':
        // Section-specific results go into queryCache but not scoutFindings
        break;
    }

    // Add to query cache
    this.pool.queryCache.set(normalizedQuery, result);

    return this;
  }

  /**
   * Adds multiple results to the pool.
   *
   * @param results - Array of search results to add
   * @returns this for chaining
   */
  addAll(results: readonly CategorizedSearchResult[]): this {
    for (const result of results) {
      this.add(result);
    }
    return this;
  }

  /**
   * Checks if a query already exists in the pool.
   *
   * @param query - The query string to check
   * @returns true if query exists
   */
  has(query: string): boolean {
    return this.pool.queryCache.has(normalizeQuery(query));
  }

  /**
   * Finds a result by query string.
   *
   * @param query - The query string to find
   * @returns The result if found, null otherwise
   */
  find(query: string): CategorizedSearchResult | null {
    return this.pool.queryCache.get(normalizeQuery(query)) ?? null;
  }

  /**
   * Gets the current count of unique URLs.
   */
  get urlCount(): number {
    return this.pool.allUrls.size;
  }

  /**
   * Gets the current count of unique queries.
   */
  get queryCount(): number {
    return this.pool.queryCache.size;
  }

  /**
   * Builds a ResearchPool snapshot from the current state.
   *
   * **Note on immutability:** This method creates a shallow copy of arrays
   * and collections, with top-level arrays frozen via `Object.freeze()`.
   * However, the objects inside arrays (CategorizedSearchResult) and the
   * Set/Map collections themselves are not deep-frozen.
   *
   * Immutability is enforced by convention and TypeScript's `readonly` types
   * rather than runtime guarantees. This is intentional:
   * - Deep freezing has performance overhead
   * - TypeScript's readonly types provide compile-time safety
   * - All code in this module treats pools as immutable
   *
   * Do not mutate the returned pool or its contents.
   *
   * @returns A snapshot of the research pool (treat as immutable)
   */
  build(): ResearchPool {
    return {
      scoutFindings: {
        overview: Object.freeze([...this.pool.scoutFindings.overview]),
        categorySpecific: Object.freeze([...this.pool.scoutFindings.categorySpecific]),
        recent: Object.freeze([...this.pool.scoutFindings.recent]),
      },
      allUrls: new Set(this.pool.allUrls),
      queryCache: new Map(this.pool.queryCache),
    };
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Creates an empty research pool.
 */
export function createEmptyResearchPool(): ResearchPool {
  return new ResearchPoolBuilder().build();
}

/**
 * Deduplicates an array of queries, preserving order.
 *
 * @param queries - Array of query strings
 * @returns Deduplicated array
 */
export function deduplicateQueries(queries: readonly string[]): string[] {
  const seen = new Set<string>();
  return queries.filter((query) => {
    const normalized = normalizeQuery(query);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

/**
 * Collects all unique URLs from a research pool.
 *
 * @param pool - The research pool
 * @returns Array of unique URLs
 */
export function collectUrls(pool: ResearchPool): string[] {
  return Array.from(pool.allUrls);
}

/**
 * Extracts research relevant to a section based on its queries.
 *
 * @param queries - The section's research queries
 * @param pool - The research pool to search
 * @param includeOverview - Whether to include Scout overview findings
 * @returns Array of matching research results
 */
export function extractResearchForQueries(
  queries: readonly string[],
  pool: ResearchPool,
  includeOverview = true
): CategorizedSearchResult[] {
  const results: CategorizedSearchResult[] = [];

  for (const query of queries) {
    const found = pool.queryCache.get(normalizeQuery(query));
    if (found) {
      results.push(found);
    }
  }

  // Include overview findings if requested
  if (includeOverview) {
    results.push(...pool.scoutFindings.overview);
  }

  return results;
}

// ============================================================================
// Search Result Processing
// ============================================================================

/**
 * Raw result item from search API.
 */
interface RawSearchResultItem {
  readonly title: string;
  readonly url: string;
  /** Default snippet (~800c for Tavily basic) */
  readonly content?: string;
  /**
   * Full page content (Tavily with include_raw_content='markdown').
   * A/B testing Dec 2024: 23,666c avg vs 840c default snippet - 28x more content for FREE!
   */
  readonly raw_content?: string;
  /** AI-generated summary (Exa only) */
  readonly summary?: string;
  readonly score?: number;
}

/**
 * Processes raw search results into a CategorizedSearchResult.
 *
 * @param query - The search query
 * @param category - The category for this search
 * @param rawResults - Raw results from search API
 * @param searchSource - The search API used ('tavily' or 'exa'), defaults to 'tavily'
 * @param costUsd - Optional cost in USD for this search (from Exa API response)
 * @returns Processed categorized result
 */
export function processSearchResults(
  query: string,
  category: SearchCategory,
  rawResults: {
    answer?: string | null;
    results: readonly RawSearchResultItem[];
  },
  searchSource: SearchSource = 'tavily',
  costUsd?: number
): CategorizedSearchResult {
  const processedResults: SearchResultItem[] = rawResults.results
    .map((r) => {
      const normalized = normalizeUrl(r.url);
      if (!normalized) return null;
      return {
        title: r.title,
        url: normalized,
        // Prefer raw_content (full page) over content (snippet) when available
        // A/B test Dec 2024: raw_content gives 23,666c avg vs 840c snippet
        content: r.raw_content ?? r.content ?? '',
        // Preserve summary if available (Exa only)
        ...(r.summary ? { summary: r.summary } : {}),
        ...(typeof r.score === 'number' ? { score: r.score } : {}),
      };
    })
    .filter((r): r is SearchResultItem => r !== null);

  return {
    query,
    answer: rawResults.answer ?? null,
    results: processedResults,
    category,
    timestamp: Date.now(),
    searchSource,
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

// ============================================================================
// Content Cleaning Integration
// ============================================================================

/**
 * Dependencies for content cleaning during research processing.
 * When provided, enables cleaning of raw content and caching in Strapi.
 */
export interface CleaningDeps {
  /** Strapi instance for cache operations */
  readonly strapi: Core.Strapi;
  /** AI SDK generateObject function */
  readonly generateObject: typeof import('ai').generateObject;
  /** Language model for cleaning */
  readonly model: LanguageModel;
  /** Logger instance */
  readonly logger?: Logger;
  /** AbortSignal for cancellation */
  readonly signal?: AbortSignal;
  /**
   * Pre-fetched excluded domains (static + database).
   * If not provided, only static exclusions are used at search time.
   * Call getAllExcludedDomains(strapi) to populate this.
   * @deprecated Use tavilyExcludedDomains and exaExcludedDomains for per-engine exclusions
   */
  readonly excludedDomains?: readonly string[];
  /**
   * Pre-fetched excluded domains for Tavily searches.
   * Includes global exclusions + Tavily-specific scrape failure exclusions.
   * Call getAllExcludedDomainsForEngine(strapi, 'tavily') to populate this.
   */
  readonly tavilyExcludedDomains?: readonly string[];
  /**
   * Pre-fetched excluded domains for Exa searches.
   * Includes global exclusions + Exa-specific scrape failure exclusions.
   * Call getAllExcludedDomainsForEngine(strapi, 'exa') to populate this.
   */
  readonly exaExcludedDomains?: readonly string[];
  /**
   * Override minimum relevance score for filtering.
   * Default: CLEANER_CONFIG.MIN_RELEVANCE_FOR_RESULTS (70)
   * Use lower values (e.g., 50) for searches that include tangential content
   * like gaming gear, hardware reviews, esports, etc.
   */
  readonly minRelevanceOverride?: number;
  /**
   * Override minimum quality score for filtering.
   * Default: CLEANER_CONFIG.MIN_QUALITY_FOR_RESULTS (35)
   */
  readonly minQualityOverride?: number;
  /** Game name for relevance scoring */
  readonly gameName?: string;
  /** Game document ID for linking sources */
  readonly gameDocumentId?: string | null;
  /** Article topic/title for pre-filter relevance scoring */
  readonly articleTopic?: string;
}

/**
 * A source that was filtered out due to low quality or relevance.
 */
export interface FilteredSource {
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
  /** Search provider that returned this source */
  readonly searchSource?: 'tavily' | 'exa';
  /** Stage where filtering happened */
  readonly filterStage?: 'programmatic' | 'pre_filter' | 'full_clean' | 'post_clean';
  /** Length of cleaned content in characters (if available) */
  readonly cleanedCharCount?: number;
}

/**
 * Result of processing search results with cleaning.
 */
export interface CleanedSearchProcessingResult {
  /** The categorized search result with potentially cleaned content */
  readonly result: CategorizedSearchResult;
  /** Number of cache hits */
  readonly cacheHits: number;
  /** Number of cache misses (newly cleaned) */
  readonly cacheMisses: number;
  /** Number of cleaning failures */
  readonly cleaningFailures: number;
  /** Token usage from cleaning operations (LLM calls) */
  readonly cleaningTokenUsage: TokenUsage;
  /** Sources filtered out due to low quality or relevance */
  readonly filteredSources: readonly FilteredSource[];
}

/**
 * Processes search results with optional content cleaning.
 *
 * When cleaningDeps is provided:
 * 1. Checks cache for all URLs
 * 2. Cleans uncached URLs in parallel
 * 3. Stores cleaned results in Strapi
 * 4. Returns CategorizedSearchResult with cleaned content
 *
 * When cleaningDeps is not provided, behaves like processSearchResults.
 *
 * @param query - The search query
 * @param category - The category for this search
 * @param rawResults - Raw results from search API
 * @param searchSource - The search API used
 * @param costUsd - Optional cost in USD
 * @param cleaningDeps - Optional cleaning dependencies (enables cleaning when provided)
 * @returns Processed result with cleaning stats
 */
export async function processSearchResultsWithCleaning(
  query: string,
  category: SearchCategory,
  rawResults: {
    answer?: string | null;
    results: readonly {
      title: string;
      url: string;
      content?: string;
      raw_content?: string;
      summary?: string;
      score?: number;
    }[];
  },
  searchSource: SearchSource = 'tavily',
  costUsd?: number,
  cleaningDeps?: CleaningDeps
): Promise<CleanedSearchProcessingResult> {
  // If no cleaning deps, just process normally
  if (!cleaningDeps) {
    return {
      result: processSearchResults(query, category, rawResults, searchSource, costUsd),
      cacheHits: 0,
      cacheMisses: 0,
      cleaningFailures: 0,
      cleaningTokenUsage: createEmptyTokenUsage(),
      filteredSources: [],
    };
  }

  // Lazy import to avoid circular dependencies
  const { cleanSourcesBatch } = await import('./agents/cleaner');
  const { checkSourceCache, storeCleanedSources } = await import('./source-cache');

  const { strapi, generateObject, model, logger, signal, gameName, gameDocumentId, minRelevanceOverride, minQualityOverride, articleTopic } = cleaningDeps;

  // Use overrides if provided, otherwise fall back to config defaults
  const minRelevance = minRelevanceOverride ?? CLEANER_CONFIG.MIN_RELEVANCE_FOR_RESULTS;
  const minQuality = minQualityOverride ?? CLEANER_CONFIG.MIN_QUALITY_FOR_RESULTS;

  // Build raw source inputs
  const rawSources: RawSourceInput[] = rawResults.results
    .map((r) => {
      const normalized = normalizeUrl(r.url);
      if (!normalized) return null;
      return {
        url: normalized,
        title: r.title,
        content: r.raw_content ?? r.content ?? '',
        searchSource,
      };
    })
    .filter((r): r is RawSourceInput => r !== null);

  if (rawSources.length === 0) {
    return {
      result: processSearchResults(query, category, rawResults, searchSource, costUsd),
      cacheHits: 0,
      cacheMisses: 0,
      cleaningFailures: 0,
      cleaningTokenUsage: createEmptyTokenUsage(),
      filteredSources: [],
    };
  }

  // Check cache for all URLs
  const cacheResults = await checkSourceCache(strapi, rawSources);

  // Get excluded domains from cleaningDeps (includes both static and DB exclusions)
  const excludedDomainsSet = new Set(cleaningDeps.excludedDomains ?? []);

  // Track filtered sources for logging and result tracking (declare early for exclusion filter)
  const filteredSources: FilteredSource[] = [];

  // Track URLs that are scrape failure retries (need special handling after cleaning)
  const scrapeFailureRetryUrls = new Set<string>();
  // Track URLs that need reprocessing (legacy data with NULL relevance)
  const needsReprocessingUrls = new Set<string>();

  // Filter out cache hits from now-excluded domains (domains may have been added to exclusion list after caching)
  // Also handle scrape failure "natural retries" - if cached as failure but raw content now sufficient
  // Also handle legacy data that needs reprocessing (NULL relevance)
  const validHits = cacheResults.filter((r) => {
    if (!r.hit) return false;
    const domain = extractDomainFromUrl(r.url);
    
    // Check if this is a scrape failure that might now succeed
    // The cached record has scrapeSucceeded field indicating previous failure
    if (r.cached && !r.cached.scrapeSucceeded) {
      // Find the corresponding raw source to check if content is now sufficient
      const rawSource = rawSources.find(s => normalizeUrl(s.url) === normalizeUrl(r.url));
      if (rawSource && rawSource.content.length > CLEANER_CONFIG.MIN_CONTENT_LENGTH) {
        // Content is now sufficient - treat as a miss to retry cleaning
        logger?.info?.(`Natural retry: ${domain} previously failed but now has ${rawSource.content.length} chars`);
        scrapeFailureRetryUrls.add(r.url);
        return false; // Remove from hits, will be added to misses
      }
      // Content still insufficient - keep as "hit" (a known failure)
      return true;
    }
    
    // Check if this is legacy data that needs reprocessing (NULL relevance)
    if (r.cached && r.cached.needsReprocessing) {
      // Find the corresponding raw source to re-clean
      const rawSource = rawSources.find(s => normalizeUrl(s.url) === normalizeUrl(r.url));
      if (rawSource && rawSource.content.length > CLEANER_CONFIG.MIN_CONTENT_LENGTH) {
        // Have raw content - treat as miss to re-clean and calculate relevance
        logger?.info?.(`Reprocessing legacy: ${domain} has NULL relevance, re-cleaning to calculate scores`);
        needsReprocessingUrls.add(r.url);
        return false; // Remove from hits, will be added to misses
      }
      // No raw content available - keep as hit, will use cached quality (relevance defaults to 0)
      // This shouldn't filter it out because MIN_RELEVANCE check handles this
      return true;
    }
    
    if (excludedDomainsSet.has(domain)) {
      // Log and track excluded cached sources
      filteredSources.push({
        url: r.url,
        domain,
        title: r.cached?.title ?? 'Unknown',
        qualityScore: r.cached?.qualityScore ?? 0,
        relevanceScore: r.cached?.relevanceScore ?? 0,
        reason: 'excluded_domain',
        details: `Cached source from now-excluded domain: ${domain}`,
        query,
        searchSource,
        filterStage: 'programmatic',
        ...(r.cached?.cleanedContent ? { cleanedCharCount: r.cached.cleanedContent.length } : {}),
      });
      return false;
    }
    return true;
  });

  // Separate valid cache hits and misses
  // Include scrape failure retries and legacy reprocessing as misses (they need to be re-cleaned)
  const hits = validHits;
  const misses = cacheResults.filter((r) => {
    // Standard miss (not in cache)
    if (!r.hit && r.raw) return true;
    // Scrape failure retry (was in cache as failure, now has content)
    if (scrapeFailureRetryUrls.has(r.url)) {
      // Find and attach the raw source
      const rawSource = rawSources.find(s => normalizeUrl(s.url) === normalizeUrl(r.url));
      if (rawSource) {
        // Mutate to add raw (safe since we're building new results)
        (r as { raw?: RawSourceInput }).raw = rawSource;
        return true;
      }
    }
    // Legacy data needing reprocessing (NULL relevance)
    if (needsReprocessingUrls.has(r.url)) {
      // Find and attach the raw source
      const rawSource = rawSources.find(s => normalizeUrl(s.url) === normalizeUrl(r.url));
      if (rawSource) {
        (r as { raw?: RawSourceInput }).raw = rawSource;
        return true;
      }
    }
    return false;
  });

  // Log cache status (include excluded count if any)
  const cleanerEnabled = CLEANER_CONFIG.ENABLED;
  const excludedCacheCount = cacheResults.filter((r) => r.hit).length - hits.length;
  
  if (hits.length > 0 || misses.length > 0 || excludedCacheCount > 0) {
    let logMsg = `Source cache: ${hits.length} hits, ${misses.length} misses for "${query.slice(0, 40)}..."`;
    if (excludedCacheCount > 0) {
      logMsg += ` (${excludedCacheCount} cached sources from excluded domains skipped)`;
    }
    if (!cleanerEnabled) {
      logMsg += ' (cleaner disabled, using raw content for misses)';
    }
    logger?.info?.(logMsg);
  }

  // Clean uncached sources (only if cleaner is enabled)
  let cleanedSources: CleanedSource[] = [];
  let cleaningFailures = 0;
  let cleaningTokenUsage: TokenUsage = createEmptyTokenUsage();

  if (misses.length > 0 && cleanerEnabled) {
    const allMissedSources = misses.map((m) => m.raw!);

    // Step 1: Filter out scrape failures (content too short)
    const validContentSources = allMissedSources.filter(
      (s) => s.content.length > CLEANER_CONFIG.MIN_CONTENT_LENGTH
    );
    const scrapeFailures = allMissedSources.filter(
      (s) => s.content.length <= CLEANER_CONFIG.MIN_CONTENT_LENGTH
    );

    if (scrapeFailures.length > 0) {
      logger?.info?.(
        `Skipping ${scrapeFailures.length} source(s) with content ≤ ${CLEANER_CONFIG.MIN_CONTENT_LENGTH} chars (scrape failures)`
      );

      // Add scrape failures to filtered sources for tracking
      for (const s of scrapeFailures) {
        filteredSources.push({
          url: s.url,
          domain: extractDomainFromUrl(s.url),
          title: s.title,
          qualityScore: 0,
          relevanceScore: null, // Unknown - couldn't evaluate content
          reason: 'scrape_failure',
          details: `Content too short: ${s.content.length} chars (min: ${CLEANER_CONFIG.MIN_CONTENT_LENGTH})`,
          query,
          searchSource: s.searchSource,
          filterStage: 'programmatic',
        });
      }

      // Store scrape failures to track domains and prevent re-processing
      const { storeScrapeFailures } = await import('./source-cache');
      storeScrapeFailures(
        strapi,
        scrapeFailures.map((s) => ({
          url: s.url,
          title: s.title,
          originalContentLength: s.content.length,
          searchSource: s.searchSource,
        }))
      ).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logger?.warn?.(`Failed to store scrape failures: ${message}`);
      });
    }

    // Step 2: Pre-filter by domain reputation and quick pattern matching (FREE)
    // This skips obviously irrelevant content without any LLM call
    const programmaticPreFilter = await preFilterSources(validContentSources, strapi, logger);

    // Log programmatic pre-filtered sources
    if (programmaticPreFilter.skipped.length > 0) {
      for (const { source, reason } of programmaticPreFilter.skipped) {
        filteredSources.push({
          url: source.url,
          domain: extractDomainFromUrl(source.url),
          title: source.title,
          qualityScore: 0,
          relevanceScore: null, // Unknown - skipped before evaluation
          reason: 'pre_filtered',
          details: `Programmatic: ${reason}`,
          query,
          searchSource,
          filterStage: 'programmatic',
        });
      }
    }

    // Step 3: LLM pre-filter using title + 500 char snippet (CHEAP)
    // Checks if content is relevant to video games AND the specific article
    let sourcesAfterPreFilter = programmaticPreFilter.toClean;

    if (CLEANER_CONFIG.PREFILTER_ENABLED && programmaticPreFilter.toClean.length > 0) {
      const { preFilterSourcesBatch } = await import('./agents/cleaner');
      const llmPreFilterResult = await preFilterSourcesBatch(programmaticPreFilter.toClean, {
        generateObject,
        model,
        logger,
        signal,
        gameName,
        articleTopic,
      });

      // Track pre-filter token usage
      cleaningTokenUsage = addTokenUsage(cleaningTokenUsage, llmPreFilterResult.tokenUsage);

      // Store pre-filter results for irrelevant sources (for domain quality tracking)
      if (llmPreFilterResult.irrelevant.length > 0) {
        const { storePreFilterResults } = await import('./source-cache');
        storePreFilterResults(
          strapi,
          llmPreFilterResult.irrelevant.map(({ source, relevanceToGaming, relevanceToArticle, reason }) => ({
            url: source.url,
            domain: extractDomainFromUrl(source.url),
            title: source.title,
            relevanceToGaming,
            relevanceToArticle,
            reason,
            contentType: llmPreFilterResult.results.find((r) => r.url === source.url)?.contentType ?? 'unknown',
            searchSource: source.searchSource,
            originalContentLength: source.content.length,
          }))
        ).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          logger?.warn?.(`Failed to store pre-filter results: ${message}`);
        });

        // Add to filtered sources list for metadata
        for (const { source, relevanceToGaming, relevanceToArticle, reason } of llmPreFilterResult.irrelevant) {
          filteredSources.push({
            url: source.url,
            domain: extractDomainFromUrl(source.url),
            title: source.title,
            qualityScore: 0, // Unknown - not cleaned
            relevanceScore: relevanceToGaming,
            reason: 'pre_filtered',
            details: `Gaming: ${relevanceToGaming}/100, Article: ${relevanceToArticle}/100 - ${reason}`,
            query,
            searchSource: source.searchSource,
            filterStage: 'pre_filter',
          });
        }
      }

      sourcesAfterPreFilter = llmPreFilterResult.relevant;
    } else if (!CLEANER_CONFIG.PREFILTER_ENABLED) {
      logger?.debug?.('LLM pre-filter disabled, skipping to full cleaning');
    }

    // Step 4: Full cleaning of remaining sources
    const cleanResult = await cleanSourcesBatch(sourcesAfterPreFilter, {
      generateObject,
      model,
      logger,
      signal,
      gameName,
    });
    cleanedSources = cleanResult.sources;
    cleaningTokenUsage = addTokenUsage(cleaningTokenUsage, cleanResult.tokenUsage);

    // Cleaning failures = sources that went through full cleaning but failed
    cleaningFailures = sourcesAfterPreFilter.length - cleanedSources.length;

    // Store cleaned sources in DB (fire-and-forget is OK here)
    if (cleanedSources.length > 0) {
      // Separate retry sources, reprocessed sources, and new sources
      const retrySources = cleanedSources.filter(s => scrapeFailureRetryUrls.has(s.url));
      const reprocessedSources = cleanedSources.filter(s => needsReprocessingUrls.has(s.url));
      const newSources = cleanedSources.filter(s => 
        !scrapeFailureRetryUrls.has(s.url) && !needsReprocessingUrls.has(s.url)
      );
      
      // Update retry sources (previously failed, now succeeded)
      if (retrySources.length > 0) {
        const { updateScrapeFailureToSuccess } = await import('./source-cache');
        for (const source of retrySources) {
          updateScrapeFailureToSuccess(strapi, source.url, source).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            logger?.warn?.(`Failed to update scrape failure to success ${source.url}: ${message}`);
          });
        }
        logger?.info?.(`Updated ${retrySources.length} scrape failure(s) to success`);
      }
      
      // Update reprocessed sources (legacy data with NULL relevance)
      if (reprocessedSources.length > 0) {
        const { updateLegacySourceRelevance } = await import('./source-cache');
        for (const source of reprocessedSources) {
          updateLegacySourceRelevance(strapi, source.url, source).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            logger?.warn?.(`Failed to update legacy source relevance ${source.url}: ${message}`);
          });
        }
        logger?.info?.(`Updated ${reprocessedSources.length} legacy source(s) with relevance scores`);
      }
      
      // Store new sources normally
      if (newSources.length > 0) {
        storeCleanedSources(strapi, newSources, gameDocumentId).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          logger?.warn?.(`Failed to store cleaned sources: ${message}`);
        });
      }
    }
  } else if (misses.length > 0 && !cleanerEnabled) {
    // Log that we're skipping cleaning
    logger?.debug?.(`Skipping cleaning for ${misses.length} sources (cleaner disabled)`);
  }

  // Build lookup maps for merging
  // Extend CleanedSource with scrapeSucceeded for cache hits
  type CleanedSourceWithScrapeStatus = CleanedSource & { scrapeSucceeded?: boolean };
  const cachedByUrl = new Map<string, CleanedSourceWithScrapeStatus>();
  for (const hit of hits) {
    if (hit.cached) {
      // Include scrapeSucceeded from cache result for filtering
      cachedByUrl.set(hit.url, {
        ...hit.cached,
        scrapeSucceeded: hit.cached.scrapeSucceeded,
      });
    }
  }

  const cleanedByUrl = new Map<string, CleanedSourceWithScrapeStatus>();
  for (const cleaned of cleanedSources) {
    cleanedByUrl.set(cleaned.url, {
      ...cleaned,
      scrapeSucceeded: true, // Newly cleaned sources always succeeded
    });
  }

  // Build final result items, using cleaned content when available
  // Filter out sources with low relevance OR low quality
  const processedResults: SearchResultItem[] = rawResults.results
    .map((r) => {
      const normalized = normalizeUrl(r.url);
      if (!normalized) return null;

      // Check if we have cleaned content for this URL
      const cached = cachedByUrl.get(normalized);
      const cleaned = cleanedByUrl.get(normalized);
      const cleanedSource = cached || cleaned;

      if (cleanedSource) {
        // Skip scrape failures - they have no useful content
        if (!cleanedSource.scrapeSucceeded) {
          // Already tracked in filtered sources during cache processing
          return null;
        }
        
        // Check relevance score - filter out irrelevant content
        // Handle null relevanceScore (legacy data) - default to passing
        const relevanceScore = cleanedSource.relevanceScore ?? 100;
        if (relevanceScore < minRelevance) {
          filteredSources.push({
            url: normalized,
            domain: cleanedSource.domain,
            title: r.title,
            qualityScore: cleanedSource.qualityScore ?? 0,
            relevanceScore: cleanedSource.relevanceScore,
            reason: 'low_relevance',
            details: `Relevance ${relevanceScore}/100 < min ${minRelevance}`,
            query,
            searchSource: cleanedSource.searchSource,
            filterStage: 'post_clean',
            cleanedCharCount: cleanedSource.cleanedContent.length,
          });
          return null;
        }

        // Check quality score - filter out low-quality content
        // Handle null qualityScore (legacy data) - default to passing
        const qualityScore = cleanedSource.qualityScore ?? 100;
        if (qualityScore < minQuality) {
          filteredSources.push({
            url: normalized,
            domain: cleanedSource.domain,
            title: r.title,
            qualityScore: cleanedSource.qualityScore ?? 0,
            relevanceScore: cleanedSource.relevanceScore,
            reason: 'low_quality',
            details: `Quality ${qualityScore}/100 < min ${minQuality}`,
            query,
            searchSource: cleanedSource.searchSource,
            filterStage: 'post_clean',
            cleanedCharCount: cleanedSource.cleanedContent.length,
          });
          return null;
        }

        // Use cleaned content
        return {
          title: r.title,
          url: normalized,
          content: cleanedSource.cleanedContent,
          ...(r.summary ? { summary: r.summary } : {}),
          ...(typeof r.score === 'number' ? { score: r.score } : {}),
          qualityScore: cleanedSource.qualityScore,
          relevanceScore: cleanedSource.relevanceScore,
        };
      }

      // Fallback to raw content (no relevance/quality check - haven't cleaned it)
      return {
        title: r.title,
        url: normalized,
        content: r.raw_content ?? r.content ?? '',
        ...(r.summary ? { summary: r.summary } : {}),
        ...(typeof r.score === 'number' ? { score: r.score } : {}),
      };
    })
    .filter((r): r is SearchResultItem => r !== null);

  // Log filtered sources if any
  if (filteredSources.length > 0) {
    const byReason = {
      low_relevance: filteredSources.filter((s) => s.reason === 'low_relevance'),
      low_quality: filteredSources.filter((s) => s.reason === 'low_quality'),
    };
    
    const parts: string[] = [];
    if (byReason.low_relevance.length > 0) {
      parts.push(`${byReason.low_relevance.length} low-relevance`);
    }
    if (byReason.low_quality.length > 0) {
      parts.push(`${byReason.low_quality.length} low-quality`);
    }
    
    logger?.info?.(
      `Filtered ${filteredSources.length} source(s) for "${query.slice(0, 40)}..." (${parts.join(', ')}): ` +
      filteredSources.map((s) => {
        // Show "scrape failed" instead of confusing Q:0/R:null for scrape failures
        if (s.reason === 'scrape_failure') {
          return `${s.domain} [scrape failed]`;
        }
        return `${s.domain} [Q:${s.qualityScore}/R:${s.relevanceScore ?? 'unknown'}]`;
      }).join(', ')
    );
  }

  return {
    result: {
      query,
      answer: rawResults.answer ?? null,
      results: processedResults,
      category,
      timestamp: Date.now(),
      searchSource,
      ...(costUsd !== undefined ? { costUsd } : {}),
    },
    cacheHits: hits.length,
    cacheMisses: misses.length,
    cleaningFailures,
    cleaningTokenUsage,
    filteredSources,
  };
}

