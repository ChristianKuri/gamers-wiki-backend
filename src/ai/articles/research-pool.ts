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
   */
  readonly excludedDomains?: readonly string[];
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
}

/**
 * A source that was filtered out due to low quality or relevance.
 */
export interface FilteredSource {
  readonly url: string;
  readonly domain: string;
  readonly title: string;
  readonly qualityScore: number;
  readonly relevanceScore: number;
  /** Reason for filtering */
  readonly reason: 'low_relevance' | 'low_quality' | 'excluded_domain';
  /** Human-readable details */
  readonly details: string;
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

  const { strapi, generateObject, model, logger, signal, gameName, gameDocumentId, minRelevanceOverride, minQualityOverride } = cleaningDeps;

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

  // Separate cache hits and misses
  const hits = cacheResults.filter((r) => r.hit);
  const misses = cacheResults.filter((r) => !r.hit && r.raw);

  // Log cache status
  const cleanerEnabled = CLEANER_CONFIG.ENABLED;
  
  if (hits.length > 0 || misses.length > 0) {
    logger?.info?.(
      `Source cache: ${hits.length} hits, ${misses.length} misses for "${query.slice(0, 40)}..."` +
      (cleanerEnabled ? '' : ' (cleaner disabled, using raw content for misses)')
    );
  }

  // Clean uncached sources (only if cleaner is enabled)
  let cleanedSources: CleanedSource[] = [];
  let cleaningFailures = 0;
  let cleaningTokenUsage: TokenUsage = createEmptyTokenUsage();

  if (misses.length > 0 && cleanerEnabled) {
    // Filter out content too short to be real (scrape failures)
    const allMissedSources = misses.map((m) => m.raw!);
    const sourcesToClean = allMissedSources.filter(
      (s) => s.content.length > CLEANER_CONFIG.MIN_CONTENT_LENGTH
    );
    const scrapeFailures = allMissedSources.filter(
      (s) => s.content.length <= CLEANER_CONFIG.MIN_CONTENT_LENGTH
    );

    if (scrapeFailures.length > 0) {
      logger?.info?.(
        `Skipping ${scrapeFailures.length} source(s) with content ≤ ${CLEANER_CONFIG.MIN_CONTENT_LENGTH} chars (scrape failures)`
      );

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

    const cleanResult = await cleanSourcesBatch(sourcesToClean, {
      generateObject,
      model,
      logger,
      signal,
      gameName,
    });
    cleanedSources = cleanResult.sources;
    cleaningTokenUsage = cleanResult.tokenUsage;

    cleaningFailures = sourcesToClean.length - cleanedSources.length;

    // Store cleaned sources in DB (fire-and-forget is OK here)
    if (cleanedSources.length > 0) {
      storeCleanedSources(strapi, cleanedSources, gameDocumentId).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logger?.warn?.(`Failed to store cleaned sources: ${message}`);
      });
    }
  } else if (misses.length > 0 && !cleanerEnabled) {
    // Log that we're skipping cleaning
    logger?.debug?.(`Skipping cleaning for ${misses.length} sources (cleaner disabled)`);
  }

  // Build lookup maps for merging
  const cachedByUrl = new Map<string, CleanedSource>();
  for (const hit of hits) {
    if (hit.cached) {
      cachedByUrl.set(hit.url, hit.cached);
    }
  }

  const cleanedByUrl = new Map<string, CleanedSource>();
  for (const cleaned of cleanedSources) {
    cleanedByUrl.set(cleaned.url, cleaned);
  }

  // Track filtered sources for logging and result tracking
  const filteredSources: FilteredSource[] = [];

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
        // Check relevance score - filter out irrelevant content
        if (cleanedSource.relevanceScore < minRelevance) {
          filteredSources.push({
            url: normalized,
            domain: cleanedSource.domain,
            title: r.title,
            qualityScore: cleanedSource.qualityScore,
            relevanceScore: cleanedSource.relevanceScore,
            reason: 'low_relevance',
            details: `Relevance ${cleanedSource.relevanceScore}/100 < min ${minRelevance}`,
          });
          return null;
        }

        // Check quality score - filter out low-quality content
        if (cleanedSource.qualityScore < minQuality) {
          filteredSources.push({
            url: normalized,
            domain: cleanedSource.domain,
            title: r.title,
            qualityScore: cleanedSource.qualityScore,
            relevanceScore: cleanedSource.relevanceScore,
            reason: 'low_quality',
            details: `Quality ${cleanedSource.qualityScore}/100 < min ${minQuality}`,
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
      filteredSources.map((s) => `${s.domain} [Q:${s.qualityScore}/R:${s.relevanceScore}]`).join(', ')
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

