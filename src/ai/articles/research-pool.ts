/**
 * Research Pool Management
 *
 * Manages the collection of research results from Scout and Specialist agents.
 * Uses a builder pattern internally for efficient mutation, returning immutable
 * snapshots at boundaries.
 */

import type {
  CategorizedSearchResult,
  ResearchPool,
  SearchCategory,
  SearchResultItem,
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
 * Processes raw search results into a CategorizedSearchResult.
 *
 * @param query - The search query
 * @param category - The category for this search
 * @param rawResults - Raw results from search API
 * @returns Processed categorized result
 */
export function processSearchResults(
  query: string,
  category: SearchCategory,
  rawResults: {
    answer?: string | null;
    results: readonly { title: string; url: string; content?: string; score?: number }[];
  }
): CategorizedSearchResult {
  const processedResults: SearchResultItem[] = rawResults.results
    .map((r) => {
      const normalized = normalizeUrl(r.url);
      if (!normalized) return null;
      return {
        title: r.title,
        url: normalized,
        content: r.content ?? '',
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
  };
}

