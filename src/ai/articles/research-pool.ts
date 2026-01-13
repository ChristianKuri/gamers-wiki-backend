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
  type DuplicateUrlInfo,
  type RawSourceInput,
  type ResearchPool,
  type SearchCategory,
  type SearchQueryStats,
  type SearchResultImage,
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
// Duplicate Tracking
// ============================================================================

/**
 * Internal record of where a URL was first seen.
 */
interface UrlFirstSeen {
  readonly query: string;
  readonly engine: SearchSource;
}

/**
 * Tracks duplicate URLs across multiple search queries.
 * Thread-safe for use across parallel searches.
 */
export class DuplicateTracker {
  /** Map of normalized URL -> first occurrence info */
  private readonly firstSeen = new Map<string, UrlFirstSeen>();
  /** Map of normalized URL -> list of duplicate occurrences */
  private readonly duplicates = new Map<string, { query: string; engine: SearchSource }[]>();
  /** Map of query -> stats */
  private readonly queryStats = new Map<string, {
    engine: SearchSource;
    phase: 'scout' | 'specialist';
    received: number;
    duplicates: number;
    filtered: number;
  }>();

  /**
   * Records a URL from a search query.
   * @returns true if this is the first time seeing this URL, false if duplicate
   */
  recordUrl(url: string, query: string, engine: SearchSource): boolean {
    const normalized = normalizeUrl(url);
    if (!normalized) return false;

    if (this.firstSeen.has(normalized)) {
      // Duplicate - record where it was duplicated
      const existing = this.duplicates.get(normalized) ?? [];
      existing.push({ query, engine });
      this.duplicates.set(normalized, existing);
      return false;
    }

    // First occurrence
    this.firstSeen.set(normalized, { query, engine });
    return true;
  }

  /**
   * Initializes stats for a query before processing results.
   */
  initQueryStats(query: string, engine: SearchSource, phase: 'scout' | 'specialist', received: number): void {
    this.queryStats.set(query, { engine, phase, received, duplicates: 0, filtered: 0 });
  }

  /**
   * Increments the duplicate count for a query.
   */
  incrementDuplicates(query: string): void {
    const stats = this.queryStats.get(query);
    if (stats) {
      this.queryStats.set(query, { ...stats, duplicates: stats.duplicates + 1 });
    }
  }

  /**
   * Increments the filtered count for a query.
   */
  incrementFiltered(query: string): void {
    const stats = this.queryStats.get(query);
    if (stats) {
      this.queryStats.set(query, { ...stats, filtered: stats.filtered + 1 });
    }
  }

  /**
   * Gets all duplicated URLs with their occurrence info.
   */
  getDuplicates(): readonly DuplicateUrlInfo[] {
    const result: DuplicateUrlInfo[] = [];
    for (const [url, dupes] of this.duplicates) {
      const firstSeen = this.firstSeen.get(url);
      if (!firstSeen || dupes.length === 0) continue;

      result.push({
        url,
        domain: extractDomainFromUrl(url),
        firstSeenIn: firstSeen,
        alsoDuplicatedIn: dupes,
      });
    }
    return result;
  }

  /**
   * Gets query statistics.
   */
  getQueryStats(): readonly SearchQueryStats[] {
    const result: SearchQueryStats[] = [];
    for (const [query, stats] of this.queryStats) {
      result.push({
        query,
        engine: stats.engine,
        phase: stats.phase,
        received: stats.received,
        duplicates: stats.duplicates,
        filtered: stats.filtered,
        used: stats.received - stats.duplicates - stats.filtered,
      });
    }
    return result;
  }

  /**
   * Checks if a URL has been seen before.
   */
  hasSeen(url: string): boolean {
    const normalized = normalizeUrl(url);
    return normalized ? this.firstSeen.has(normalized) : false;
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

  // Track domains with different exclusion reasons
  const knex = strapi.db.connection;
  const manuallyExcludedDomains = new Set<string>();
  const lowRelevanceDomains = new Set<string>(); // Requires 3+ samples
  const lowQualityDomains = new Set<string>();   // Requires 5+ samples
  const hardToScrapeTavily = new Set<string>();
  const hardToScrapeExa = new Set<string>();

  try {
    // Query all domain quality data in one go
    const domainData = await knex('domain_qualities')
      .select(
        'domain',
        'is_excluded',
        'is_excluded_tavily',
        'is_excluded_exa',
        'avg_quality_score',
        'avg_relevance_score',
        'total_sources',
        'tavily_attempts',
        'tavily_scrape_failures',
        'exa_attempts',
        'exa_scrape_failures'
      );

    for (const row of domainData) {
      const domain = row.domain as string;
      
      // Check 1: Manually excluded
      if (row.is_excluded) {
        manuallyExcludedDomains.add(domain);
        continue;
      }
      
      // Check 2: Per-engine scrape failure exclusion (>70% failure rate with 10+ attempts)
      if (row.is_excluded_tavily) {
        hardToScrapeTavily.add(domain);
      }
      if (row.is_excluded_exa) {
        hardToScrapeExa.add(domain);
      }
      
      // Only evaluate quality/relevance if has successful cleanings
      const successfulCleanings = 
        (row.tavily_attempts - row.tavily_scrape_failures) + 
        (row.exa_attempts - row.exa_scrape_failures);
      
      if (successfulCleanings === 0) {
        continue; // Scores are meaningless without successful cleanings
      }
      
      // Check 3: Low relevance (requires 3+ samples - domain-wide, won't improve)
      if (
        row.total_sources >= CLEANER_CONFIG.AUTO_EXCLUDE_RELEVANCE_MIN_SAMPLES &&
        parseFloat(row.avg_relevance_score) < CLEANER_CONFIG.AUTO_EXCLUDE_RELEVANCE_THRESHOLD
      ) {
        lowRelevanceDomains.add(domain);
      }
      
      // Check 4: Low quality (requires 5+ samples - quality varies per page)
      if (
        row.total_sources >= CLEANER_CONFIG.AUTO_EXCLUDE_QUALITY_MIN_SAMPLES &&
        parseFloat(row.avg_quality_score) < CLEANER_CONFIG.MIN_QUALITY_FOR_RESULTS
      ) {
        lowQualityDomains.add(domain);
      }
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

    // Check 2: Manually excluded domain
    if (manuallyExcludedDomains.has(domain)) {
      skipped.push({
        source,
        reason: `Manually excluded domain: ${domain}`,
      });
      continue;
    }

    // Check 3: Per-engine scrape failure exclusion (hard to scrape)
    if (source.searchSource === 'tavily' && hardToScrapeTavily.has(domain)) {
      skipped.push({
        source,
        reason: `Hard to scrape domain (Tavily): ${domain}`,
      });
      continue;
    }
    if (source.searchSource === 'exa' && hardToScrapeExa.has(domain)) {
      skipped.push({
        source,
        reason: `Hard to scrape domain (Exa): ${domain}`,
      });
      continue;
    }

    // Check 4: Low relevance domain (requires 3+ samples - checked first)
    if (lowRelevanceDomains.has(domain)) {
      skipped.push({
        source,
        reason: `Low relevance domain: ${domain}`,
      });
      continue;
    }

    // Check 5: Low quality domain (requires 5+ samples)
    if (lowQualityDomains.has(domain)) {
      skipped.push({
        source,
        reason: `Low quality domain: ${domain}`,
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
  /** Representative image for the result (Exa only) */
  readonly image?: string;
  /** Images extracted from the page (Exa with extras.imageLinks) */
  readonly imageLinks?: readonly string[];
}

/**
 * Image from a search response.
 */
interface RawSearchImage {
  readonly url: string;
  readonly description?: string;
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
    /** Query-level images (Tavily with include_images) */
    images?: readonly RawSearchImage[];
  },
  searchSource: SearchSource = 'tavily',
  costUsd?: number
): CategorizedSearchResult {
  const processedResults: SearchResultItem[] = rawResults.results
    .map((r): SearchResultItem | null => {
      const normalized = normalizeUrl(r.url);
      if (!normalized) return null;

      // Collect per-result images (Exa's image and imageLinks)
      const resultImages: readonly SearchResultImage[] = [
        ...(r.image ? [{ url: r.image }] : []),
        ...(r.imageLinks ?? []).map((imgUrl) => ({ url: imgUrl })),
      ];

      return {
        title: r.title,
        url: normalized,
        // Prefer raw_content (full page) over content (snippet) when available
        // A/B test Dec 2024: raw_content gives 23,666c avg vs 840c snippet
        content: r.raw_content ?? r.content ?? '',
        // Preserve summary if available (Exa only)
        ...(r.summary ? { summary: r.summary } : {}),
        ...(typeof r.score === 'number' ? { score: r.score } : {}),
        // Include images if any found
        ...(resultImages.length > 0 ? { images: resultImages } : {}),
      };
    })
    .filter((r): r is SearchResultItem => r !== null);

  // Convert query-level images (from Tavily)
  const queryImages = rawResults.images?.map((img) => ({
    url: img.url,
    ...(img.description ? { description: img.description } : {}),
  }));

  return {
    query,
    answer: rawResults.answer ?? null,
    results: processedResults,
    // Include query-level images if present
    ...(queryImages && queryImages.length > 0 ? { images: queryImages } : {}),
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
  /** 
   * Language model for content cleaning (junk removal, content extraction).
   * Used in step 1 of two-step cleaning.
   * @default 'google/gemini-2.5-flash-lite'
   */
  readonly model: LanguageModel;
  /**
   * Language model for summarization (summary, key facts, data points extraction).
   * Used in step 2 of two-step cleaning.
   * If not provided, falls back to the main `model`.
   * @default 'google/gemini-2.5-flash-lite'
   */
  readonly summarizerModel?: LanguageModel;
  /**
   * Optional separate model for pre-filtering.
   * Pre-filter is a simple classification task (gaming relevance + article relevance),
   * so a faster/cheaper model can be used without sacrificing quality.
   * If not provided, falls back to the main `model`.
   * @example Use 'google/gemini-2.5-flash-lite' for fast/cheap pre-filtering
   */
  readonly prefilterModel?: LanguageModel;
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
  /**
   * Shared duplicate tracker across all search queries.
   * When provided, tracks which URLs appear in multiple queries.
   */
  readonly duplicateTracker?: DuplicateTracker;
  /**
   * Current phase for tracking purposes.
   * Default: 'scout'
   */
  readonly phase?: 'scout' | 'specialist';
}

/**
 * A source that was filtered out due to low quality or relevance.
 */
export interface FilteredSource {
  readonly url: string;
  readonly domain: string;
  readonly title: string;
  /** Quality score (0-100), or null if not evaluated (programmatic filters) */
  readonly qualityScore: number | null;
  /** Relevance score (0-100), or null if unknown (e.g., scrape failures, programmatic filters) */
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
  /** Token usage from pre-filter LLM calls (quick relevance check) */
  readonly prefilterTokenUsage: TokenUsage;
  /** Token usage from extraction LLM calls (full cleaning) */
  readonly extractionTokenUsage: TokenUsage;
  /** Combined token usage from all cleaning operations (prefilter + extraction) */
  readonly cleaningTokenUsage: TokenUsage;
  /** Sources filtered out due to low quality or relevance */
  readonly filteredSources: readonly FilteredSource[];
}

/**
 * Result of checking whether a cache result should be treated as a miss.
 */
export interface CacheBypassCheckResult {
  /** Whether this result should be treated as a miss (needs cleaning) */
  shouldBypass: boolean;
  /** The raw source to attach, if found */
  rawSource?: RawSourceInput;
  /** Reason for bypass decision (for debugging) */
  reason: 'not_cache_hit' | 'excluded_domain' | 'scrape_failure_retry' | 'legacy_reprocessing' | 'cache_disabled' | 'no_raw_content' | 'use_cache';
}

/**
 * Determines if a cache result should be bypassed and treated as a miss.
 * Encapsulates the complex cache bypass logic for clarity and testability.
 *
 * Exported for testing purposes.
 */
export function shouldBypassCacheResult(
  cacheResult: { hit: boolean; url: string; cached?: { scrapeSucceeded?: boolean } | null },
  rawSources: readonly RawSourceInput[],
  excludedDomainsSet: Set<string>,
  cacheEnabled: boolean,
  scrapeFailureRetryUrls: Set<string>,
  needsReprocessingUrls: Set<string>
): CacheBypassCheckResult {
  // Standard miss (not in cache) - always needs cleaning
  if (!cacheResult.hit) {
    return { shouldBypass: true, reason: 'not_cache_hit' };
  }

  // Check excluded domains first
  const domain = extractDomainFromUrl(cacheResult.url);
  if (excludedDomainsSet.has(domain)) {
    return { shouldBypass: false, reason: 'excluded_domain' };
  }

  // Find raw source for potential re-cleaning
  const rawSource = rawSources.find(s => normalizeUrl(s.url) === normalizeUrl(cacheResult.url));

  // Cache bypass mode - treat all non-excluded hits as misses
  if (!cacheEnabled) {
    // Check if it's a persistent scrape failure (no raw content even now)
    if (cacheResult.cached && !cacheResult.cached.scrapeSucceeded && 
        (!rawSource || rawSource.content.length <= CLEANER_CONFIG.MIN_CONTENT_LENGTH)) {
      return { shouldBypass: false, reason: 'scrape_failure_retry' };
    }
    
    if (rawSource) {
      return { shouldBypass: true, rawSource, reason: 'cache_disabled' };
    }
    return { shouldBypass: false, reason: 'no_raw_content' };
  }

  // Scrape failure retry (was in cache as failure, now has content)
  if (scrapeFailureRetryUrls.has(cacheResult.url) && rawSource) {
    return { shouldBypass: true, rawSource, reason: 'scrape_failure_retry' };
  }

  // Legacy data needing reprocessing (NULL relevance)
  if (needsReprocessingUrls.has(cacheResult.url) && rawSource) {
    return { shouldBypass: true, rawSource, reason: 'legacy_reprocessing' };
  }

  // Normal cache hit - use cached data
  return { shouldBypass: false, reason: 'use_cache' };
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
      /** Representative image (Exa only) */
      image?: string;
      /** Images from the page (Exa with extras.imageLinks) */
      imageLinks?: readonly string[];
    }[];
    /** Query-level images (Tavily with include_images) */
    images?: readonly RawSearchImage[];
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
      prefilterTokenUsage: createEmptyTokenUsage(),
      extractionTokenUsage: createEmptyTokenUsage(),
      cleaningTokenUsage: createEmptyTokenUsage(),
      filteredSources: [],
    };
  }

  // Lazy import to avoid circular dependencies
  const { cleanSourcesBatch } = await import('./agents/cleaner');
  const { checkSourceCache, storeCleanedSources } = await import('./source-cache');

  const { strapi, generateObject, model, prefilterModel, logger, signal, gameName, gameDocumentId, minRelevanceOverride, minQualityOverride, articleTopic, duplicateTracker, phase = 'scout' } = cleaningDeps;

  // Use overrides if provided, otherwise fall back to config defaults
  const minRelevance = minRelevanceOverride ?? CLEANER_CONFIG.MIN_RELEVANCE_FOR_RESULTS;
  const minQuality = minQualityOverride ?? CLEANER_CONFIG.MIN_QUALITY_FOR_RESULTS;

  // Initialize query stats if tracking duplicates
  const receivedCount = rawResults.results.length;
  duplicateTracker?.initQueryStats(query, searchSource, phase, receivedCount);

  // Build raw source inputs, filtering out duplicates if tracker provided
  const rawSources: RawSourceInput[] = rawResults.results
    .map((r) => {
      const normalized = normalizeUrl(r.url);
      if (!normalized) return null;

      // Check for duplicates against previous queries
      if (duplicateTracker) {
        const isFirstSeen = duplicateTracker.recordUrl(normalized, query, searchSource);
        if (!isFirstSeen) {
          // This URL was already seen in a previous query - skip it
          duplicateTracker.incrementDuplicates(query);
          return null;
        }
      }

      return {
        url: normalized,
        title: r.title,
        content: r.raw_content ?? r.content ?? '',
        searchSource,
        // Preserve Tavily's clean snippet for pre-filtering (if raw_content was used)
        // Tavily's content (~800c) is a clean extracted summary, better than slicing raw_content
        ...(r.raw_content && r.content ? { snippet: r.content } : {}),
      };
    })
    .filter((r): r is RawSourceInput => r !== null);

  if (rawSources.length === 0) {
    return {
      result: processSearchResults(query, category, rawResults, searchSource, costUsd),
      cacheHits: 0,
      cacheMisses: 0,
      cleaningFailures: 0,
      prefilterTokenUsage: createEmptyTokenUsage(),
      extractionTokenUsage: createEmptyTokenUsage(),
      cleaningTokenUsage: createEmptyTokenUsage(),
      filteredSources: [],
    };
  }

  // Check cache for all URLs (unless cache is disabled)
  // When cache is disabled, we still check to get metadata like scrape failures,
  // but we treat all as misses so content gets re-cleaned with latest prompts
  const cacheResults = await checkSourceCache(strapi, rawSources);
  const cacheEnabled = CLEANER_CONFIG.CACHE_ENABLED;
  if (!cacheEnabled) {
    logger?.info?.(`[Cleaner] Cache bypass enabled - will re-clean all sources`);
  }

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
      // Content still insufficient - track as filtered and keep as "hit" (won't be processed)
      const rawLength = rawSource?.content.length ?? 0;
      filteredSources.push({
        url: r.url,
        domain,
        title: r.cached.title ?? 'Unknown',
        qualityScore: null, // Not evaluated - scrape failure
        relevanceScore: null,
        reason: 'scrape_failure',
        details: `Scrape failed again: ${rawLength} chars (min: ${CLEANER_CONFIG.MIN_CONTENT_LENGTH})`,
        query,
        searchSource,
        filterStage: 'programmatic',
      });
      duplicateTracker?.incrementFiltered(query);
      return true; // Keep as hit so it's not retried as a miss
    }
    
    // Check if this is legacy data that needs reprocessing (missing relevance or detailedSummary)
    if (r.cached && r.cached.needsReprocessing) {
      // Find the corresponding raw source to re-clean
      const rawSource = rawSources.find(s => normalizeUrl(s.url) === normalizeUrl(r.url));
      if (rawSource && rawSource.content.length > CLEANER_CONFIG.MIN_CONTENT_LENGTH) {
        // Have raw content - treat as miss to re-clean and calculate relevance/summaries
        const reason = r.cached.relevanceScore === null 
          ? 'missing relevance score' 
          : 'missing detailedSummary';
        logger?.debug?.(`Reprocessing legacy cache: ${domain} (${reason})`);
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
        qualityScore: r.cached?.qualityScore ?? null, // Use cached score if available
        relevanceScore: r.cached?.relevanceScore ?? null,
        reason: 'excluded_domain',
        details: `Cached source from now-excluded domain: ${domain}`,
        query,
        searchSource,
        filterStage: 'programmatic',
        ...(r.cached?.cleanedContent ? { cleanedCharCount: r.cached.cleanedContent.length } : {}),
      });
      duplicateTracker?.incrementFiltered(query);
      return false;
    }
    return true;
  });

  // Separate valid cache hits and misses using the helper function
  // Include scrape failure retries and legacy reprocessing as misses (they need to be re-cleaned)
  // When cache is disabled, treat ALL sources as misses (bypass cache reads)
  const hits = cacheEnabled ? validHits : [];
  const misses = cacheResults.filter((r) => {
    // Standard miss (not in cache) with raw content available
    if (!r.hit && r.raw) return true;
    
    // Use helper for complex bypass logic
    const bypassCheck = shouldBypassCacheResult(
      r,
      rawSources,
      excludedDomainsSet,
      cacheEnabled,
      scrapeFailureRetryUrls,
      needsReprocessingUrls
    );
    
    if (bypassCheck.shouldBypass && bypassCheck.rawSource) {
      // Attach raw source so it can be re-cleaned
      (r as { raw?: RawSourceInput }).raw = bypassCheck.rawSource;
      return true;
    }
    
    return false;
  });

  // Log cache status (include excluded count if any)
  const cleanerEnabled = CLEANER_CONFIG.ENABLED;
  const excludedCacheCount = cacheResults.filter((r) => r.hit).length - (cacheEnabled ? hits.length : 0);
  const bypassedCacheCount = !cacheEnabled ? cacheResults.filter((r) => r.hit).length : 0;
  
  if (hits.length > 0 || misses.length > 0 || excludedCacheCount > 0 || bypassedCacheCount > 0) {
    let logMsg = `Source cache: ${hits.length} hits, ${misses.length} misses for "${query.slice(0, 40)}..."`;
    if (bypassedCacheCount > 0) {
      logMsg += ` (${bypassedCacheCount} cache entries bypassed for re-cleaning)`;
    }
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
  // Track prefilter and extraction token usages separately for cost visibility
  let prefilterTokenUsage: TokenUsage = createEmptyTokenUsage();
  let extractionTokenUsage: TokenUsage = createEmptyTokenUsage();

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
          qualityScore: null, // Not evaluated - scrape failure
          relevanceScore: null, // Unknown - couldn't evaluate content
          reason: 'scrape_failure',
          details: `Content too short: ${s.content.length} chars (min: ${CLEANER_CONFIG.MIN_CONTENT_LENGTH})`,
          query,
          searchSource: s.searchSource,
          filterStage: 'programmatic',
        });
        duplicateTracker?.incrementFiltered(query);
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
          qualityScore: null, // Not evaluated - programmatic filter
          relevanceScore: null, // Unknown - skipped before evaluation
          reason: 'pre_filtered',
          details: `Programmatic: ${reason}`,
          query,
          searchSource,
          filterStage: 'programmatic',
        });
        duplicateTracker?.incrementFiltered(query);
      }
    }

    // Step 3: LLM pre-filter using title + 500 char snippet (CHEAP)
    // Checks if content is relevant to video games AND the specific article
    let sourcesAfterPreFilter = programmaticPreFilter.toClean;

    if (CLEANER_CONFIG.PREFILTER_ENABLED && programmaticPreFilter.toClean.length > 0) {
      const { preFilterSourcesBatch } = await import('./agents/cleaner');
      // Use dedicated prefilter model if provided, otherwise fall back to cleaner model
      const preFilterModelToUse = prefilterModel ?? model;
      const llmPreFilterResult = await preFilterSourcesBatch(programmaticPreFilter.toClean, {
        generateObject,
        model: preFilterModelToUse,
        logger,
        signal,
        gameName,
        articleTopic,
      });

      // Track pre-filter token usage separately
      prefilterTokenUsage = addTokenUsage(prefilterTokenUsage, llmPreFilterResult.tokenUsage);

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
            qualityScore: null, // Not evaluated - pre-filter (only relevance checked)
            relevanceScore: relevanceToGaming,
            reason: 'pre_filtered',
            details: `Gaming: ${relevanceToGaming}/100, Article: ${relevanceToArticle}/100 - ${reason}`,
            query,
            searchSource: source.searchSource,
            filterStage: 'pre_filter',
          });
          duplicateTracker?.incrementFiltered(query);
        }
      }

      sourcesAfterPreFilter = llmPreFilterResult.relevant;
    } else if (!CLEANER_CONFIG.PREFILTER_ENABLED) {
      logger?.debug?.('LLM pre-filter disabled, skipping to full cleaning');
    }

    // Step 4: Full cleaning of remaining sources (two-step if summarizerModel provided)
    const cleanResult = await cleanSourcesBatch(sourcesAfterPreFilter, {
      generateObject,
      model,
      summarizerModel: cleaningDeps.summarizerModel,
      logger,
      signal,
      gameName,
    });
    cleanedSources = cleanResult.sources;
    // Track extraction token usage separately
    extractionTokenUsage = addTokenUsage(extractionTokenUsage, cleanResult.tokenUsage);

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
      
      // Update reprocessed sources (missing relevance OR missing detailedSummary)
      if (reprocessedSources.length > 0) {
        const { updateReprocessedSource } = await import('./source-cache');
        for (const source of reprocessedSources) {
          updateReprocessedSource(strapi, source.url, source).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            logger?.warn?.(`Failed to update reprocessed source ${source.url}: ${message}`);
          });
        }
        logger?.info?.(`Updated ${reprocessedSources.length} reprocessed source(s)`);
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
      // Track whether content was from cache or newly cleaned
      const wasCached = cached !== undefined;

      if (cleanedSource) {
        // Skip scrape failures - they have no useful content
        // (Already tracked in filtered sources during cache hit processing)
        if (cleanedSource.scrapeSucceeded === false) {
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
          duplicateTracker?.incrementFiltered(query);
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
          duplicateTracker?.incrementFiltered(query);
          return null;
        }

        // Collect per-result images (Exa's image and imageLinks) - preserve for image pipeline
        const rawImages: SearchResultImage[] = [
          ...(r.image ? [{ url: r.image }] : []),
          ...(r.imageLinks ?? []).map((imgUrl) => ({ url: imgUrl })),
        ];
        
        // Add images extracted from cleaned content (with context)
        // These have better descriptions because the cleaner preserved them with alt text
        // Note: Capping is done in extractImagesFromSource during extraction
        const sourceImages = cleanedSource.images ?? [];
        
        // Create SearchResultImage versions for backward compatibility
        const sourceImagesAsSearchResult: SearchResultImage[] = sourceImages
          .map((img) => ({
            url: img.url,
            // Build rich description from extracted context
            description: [
              img.nearestHeader ? `[${img.nearestHeader}]` : null,
              img.description,
            ].filter(Boolean).join(' '),
          }));
        
        // Dedupe by URL (prefer source images as they have better descriptions)
        const seenUrls = new Set<string>();
        const resultImages: readonly SearchResultImage[] = [
          ...sourceImagesAsSearchResult.filter((img) => {
            if (seenUrls.has(img.url)) return false;
            seenUrls.add(img.url);
            return true;
          }),
          ...rawImages.filter((img) => {
            if (seenUrls.has(img.url)) return false;
            seenUrls.add(img.url);
            return true;
          }),
        ];

        // Use cleaned content
        return {
          title: r.title,
          url: normalized,
          content: cleanedSource.cleanedContent,
          ...(r.summary ? { summary: r.summary } : {}),
          // Include detailed summary fields if available (from cleaner or cache)
          ...(cleanedSource.detailedSummary ? { detailedSummary: cleanedSource.detailedSummary } : {}),
          ...(cleanedSource.keyFacts && cleanedSource.keyFacts.length > 0 ? { keyFacts: cleanedSource.keyFacts } : {}),
          ...(cleanedSource.dataPoints && cleanedSource.dataPoints.length > 0 ? { dataPoints: cleanedSource.dataPoints } : {}),
          ...(typeof r.score === 'number' ? { score: r.score } : {}),
          // Preserve images for image pipeline (SearchResultImage format for backward compat)
          ...(resultImages.length > 0 ? { images: resultImages } : {}),
          // Preserve full SourceImage objects for proper 'source' attribution in image pool
          ...(sourceImages.length > 0 ? { sourceImages: sourceImages } : {}),
          qualityScore: cleanedSource.qualityScore,
          relevanceScore: cleanedSource.relevanceScore,
          wasCached,
        };
      }

      // Collect per-result images for fallback path too
      const resultImages: readonly SearchResultImage[] = [
        ...(r.image ? [{ url: r.image }] : []),
        ...(r.imageLinks ?? []).map((imgUrl) => ({ url: imgUrl })),
      ];

      // Fallback to raw content (no relevance/quality check - haven't cleaned it)
      return {
        title: r.title,
        url: normalized,
        content: r.raw_content ?? r.content ?? '',
        ...(r.summary ? { summary: r.summary } : {}),
        ...(typeof r.score === 'number' ? { score: r.score } : {}),
        // Preserve images for image pipeline
        ...(resultImages.length > 0 ? { images: resultImages } : {}),
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

  // Combine prefilter and extraction for backwards-compatible cleaningTokenUsage
  const cleaningTokenUsage = addTokenUsage(prefilterTokenUsage, extractionTokenUsage);

  // Convert query-level images (from Tavily with include_images) - preserve for image pipeline
  const queryImages = rawResults.images?.map((img) => ({
    url: img.url,
    ...(img.description ? { description: img.description } : {}),
  }));

  return {
    result: {
      query,
      answer: rawResults.answer ?? null,
      results: processedResults,
      // Include query-level images if present (for image pipeline)
      ...(queryImages && queryImages.length > 0 ? { images: queryImages } : {}),
      category,
      timestamp: Date.now(),
      searchSource,
      ...(costUsd !== undefined ? { costUsd } : {}),
    },
    cacheHits: hits.length,
    cacheMisses: misses.length,
    cleaningFailures,
    prefilterTokenUsage,
    extractionTokenUsage,
    cleaningTokenUsage,
    filteredSources,
  };
}

