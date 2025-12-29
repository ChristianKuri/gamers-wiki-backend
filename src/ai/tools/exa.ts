/**
 * Exa API Wrapper
 *
 * Provides semantic/neural search capabilities to complement Tavily's keyword-based search.
 * Exa excels at:
 * - Deep search (comprehensive results with query expansion)
 * - Neural search (meaning-based, not just keyword matching)
 * - Finding similar content to a reference URL
 * - Category-based filtering (news, wiki, etc.)
 * - Understanding natural language queries like "how does X work"
 *
 * @see https://docs.exa.ai/reference/how-exa-search-works
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Search type for Exa queries.
 *
 * - 'deep': Comprehensive search with query expansion and detailed context (RECOMMENDED)
 * - 'auto': Intelligently combines multiple search methods
 * - 'neural': AI model predicts relevant links based on semantic meaning
 * - 'keyword': Traditional keyword matching
 * - 'fast': Streamlined for speed (<400ms)
 */
export type ExaSearchType = 'deep' | 'auto' | 'neural' | 'keyword' | 'fast';

/**
 * Livecrawl behavior for content freshness.
 *
 * - 'preferred': Try live crawl, fallback to cache if fails (RECOMMENDED for production)
 * - 'always': Always live crawl, fail if unsuccessful
 * - 'fallback': Use cache first, live crawl only if no cache
 * - 'never': Always use cached data
 */
export type ExaLivecrawl = 'preferred' | 'always' | 'fallback' | 'never';

/** Content category filter for Exa searches */
export type ExaCategory =
  | 'company'
  | 'research paper'
  | 'news'
  | 'pdf'
  | 'github'
  | 'tweet'
  | 'movie'
  | 'song'
  | 'personal site'
  | 'linkedin profile';

export interface ExaSearchOptions {
  /**
   * Number of results to return (1-25 recommended, same price).
   * 26-100 costs 5x more ($25/1k vs $5/1k).
   * Default: 25
   */
  readonly numResults?: number;
  /**
   * Search type. Default: 'deep' for comprehensive results.
   * - 'deep': Best quality, expands query, returns rich context
   * - 'auto': Balanced approach
   * - 'neural': Semantic understanding
   * - 'fast': Lowest latency (<400ms)
   */
  readonly type?: ExaSearchType;
  /**
   * Additional query variations for better coverage (deep search).
   * Exa will search all variations and combine results.
   */
  readonly additionalQueries?: readonly string[];
  /**
   * Livecrawl behavior for fresh content.
   * Default: 'preferred' (try fresh, fallback to cache)
   */
  readonly livecrawl?: ExaLivecrawl;
  /**
   * Timeout for livecrawl in milliseconds.
   * Recommended: 10000-15000ms to prevent hanging.
   * Default: 10000
   */
  readonly livecrawlTimeout?: number;
  /** Filter by content category */
  readonly category?: ExaCategory;
  /** Only include results from these domains */
  readonly includeDomains?: readonly string[];
  /** Exclude results from these domains */
  readonly excludeDomains?: readonly string[];
  /** Let Exa optimize the query for better results (default: true) */
  readonly useAutoprompt?: boolean;
  /**
   * Maximum characters of text to include per result.
   * Default: 2000 (increased from 1000 for better context)
   */
  readonly textMaxCharacters?: number;
  /**
   * Include AI-generated summary for each result.
   * Summaries are abstractive (created by Gemini Flash) and query-aware.
   * Much more useful than truncating raw text.
   * RECOMMENDED: Always enable for article generation.
   * @see https://docs.exa.ai/reference/contents-retrieval#summary-summary-true
   */
  readonly includeSummary?: boolean;
  /** Custom query for summary generation */
  readonly summaryQuery?: string;
  /** Request timeout in milliseconds (default: 20000 for deep search) */
  readonly timeoutMs?: number;
  /** Filter results to those published after this date (ISO string) */
  readonly startPublishedDate?: string;
  /** Filter results to those published before this date (ISO string) */
  readonly endPublishedDate?: string;
  // =========================================================================
  // Future: Image Support (not yet implemented)
  // =========================================================================
  /**
   * Number of images to retrieve per result.
   * Set via contents.extras.imageLinks in API request.
   * Use case: Article hero images, inline screenshots.
   * @see https://docs.exa.ai/reference/contents-retrieval#images-and-favicons
   * @future Not yet implemented - document for later use
   */
  // readonly imageLinks?: number;
}

export interface ExaFindSimilarOptions {
  /** Number of results to return (1-25 recommended, same price). Default: 25 */
  readonly numResults?: number;
  /** Only include results from these domains */
  readonly includeDomains?: readonly string[];
  /** Exclude results from these domains */
  readonly excludeDomains?: readonly string[];
  /** Exclude the source URL from results (default: true) */
  readonly excludeSourceDomain?: boolean;
  /** Maximum characters of text to include per result. Default: 2000 */
  readonly textMaxCharacters?: number;
  /** Livecrawl behavior. Default: 'preferred' */
  readonly livecrawl?: ExaLivecrawl;
  /** Request timeout in milliseconds (default: 20000) */
  readonly timeoutMs?: number;
}

export interface ExaSearchResult {
  readonly title: string;
  readonly url: string;
  /** Main text content from the page */
  readonly content?: string;
  /** AI-generated summary (if requested) */
  readonly summary?: string;
  /** Relevance score */
  readonly score?: number;
  readonly publishedDate?: string;
  readonly author?: string;
  // =========================================================================
  // Future: Image fields (available when imageLinks is requested)
  // =========================================================================
  /** Website favicon URL (always available) */
  readonly favicon?: string;
  /** Representative image URL for the page (when available) */
  readonly image?: string;
  /**
   * Array of image URLs from the page (when imageLinks > 0 requested).
   * @future Parse from extras.imageLinks in response
   */
  // readonly imageLinks?: readonly string[];
}

/**
 * Cost breakdown from Exa API response.
 * Useful for tracking API spend per article.
 */
export interface ExaCostDollars {
  /** Total cost in USD for this request */
  readonly total: number;
  /** Search type that was used */
  readonly searchType?: 'neural' | 'deep';
  /** Breakdown by component (if available) */
  readonly breakdown?: {
    readonly search?: number;
    readonly contents?: number;
    readonly neuralSearch?: number;
    readonly deepSearch?: number;
    readonly contentText?: number;
    readonly contentHighlight?: number;
    readonly contentSummary?: number;
  };
}

export interface ExaSearchResponse {
  readonly query: string;
  readonly results: readonly ExaSearchResult[];
  /** Autoprompt-enhanced query (if useAutoprompt was enabled) */
  readonly autopromptQuery?: string;
  /** Cost information from Exa (if available in response) */
  readonly costDollars?: ExaCostDollars;
}

// ============================================================================
// Configuration
// ============================================================================

const EXA_API_BASE_URL = 'https://api.exa.ai';

// Timeouts
const DEFAULT_TIMEOUT_MS = 20_000; // Increased for deep search
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_LIVECRAWL_TIMEOUT_MS = 10_000;

// Results (pricing: 1-25 = $5/1k, 26-100 = $25/1k)
const MIN_RESULTS = 1;
const MAX_RESULTS = 25;
const DEFAULT_RESULTS = 25;

// Content
const DEFAULT_TEXT_MAX_CHARS = 2000; // Increased from 1000 for better context

// ============================================================================
// Utility Functions
// ============================================================================

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Checks if Exa API is configured.
 */
export function isExaConfigured(): boolean {
  return Boolean(process.env.EXA_API_KEY);
}

// ============================================================================
// Response Parsing
// ============================================================================

function parseExaResult(raw: unknown): ExaSearchResult | null {
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;
  const title = safeString(obj.title);
  const url = safeString(obj.url);

  if (!title || !url) return null;

  // Content can come from 'text' field
  const content = safeString(obj.text);
  // Summary is a separate AI-generated field
  const summary = safeString(obj.summary);
  const score = typeof obj.score === 'number' ? obj.score : undefined;
  const publishedDate = safeString(obj.publishedDate);
  const author = safeString(obj.author);

  return {
    title,
    url,
    ...(content ? { content } : {}),
    ...(summary ? { summary } : {}),
    ...(score !== undefined ? { score } : {}),
    ...(publishedDate ? { publishedDate } : {}),
    ...(author ? { author } : {}),
  };
}

/**
 * Parses the costDollars object from Exa response.
 */
function parseExaCost(raw: unknown): ExaCostDollars | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const obj = raw as Record<string, unknown>;
  const total = typeof obj.total === 'number' ? obj.total : undefined;
  
  if (total === undefined) return undefined;

  // Parse breakdown if available
  let breakdown: ExaCostDollars['breakdown'] | undefined;
  const breakDownArray = Array.isArray(obj.breakDown) ? obj.breakDown : [];
  if (breakDownArray.length > 0) {
    const first = breakDownArray[0] as Record<string, unknown> | undefined;
    if (first) {
      const innerBreakdown = first.breakdown as Record<string, unknown> | undefined;
      breakdown = {
        search: typeof first.search === 'number' ? first.search : undefined,
        contents: typeof first.contents === 'number' ? first.contents : undefined,
        neuralSearch: typeof innerBreakdown?.neuralSearch === 'number' ? innerBreakdown.neuralSearch : undefined,
        deepSearch: typeof innerBreakdown?.deepSearch === 'number' ? innerBreakdown.deepSearch : undefined,
        contentText: typeof innerBreakdown?.contentText === 'number' ? innerBreakdown.contentText : undefined,
        contentHighlight: typeof innerBreakdown?.contentHighlight === 'number' ? innerBreakdown.contentHighlight : undefined,
        contentSummary: typeof innerBreakdown?.contentSummary === 'number' ? innerBreakdown.contentSummary : undefined,
      };
    }
  }

  // Get search type from response
  const searchType = obj.searchType === 'neural' || obj.searchType === 'deep' 
    ? obj.searchType 
    : undefined;

  return {
    total,
    ...(searchType ? { searchType } : {}),
    ...(breakdown ? { breakdown } : {}),
  };
}

function parseExaResponse(query: string, raw: unknown): ExaSearchResponse {
  if (!raw || typeof raw !== 'object') {
    return { query, results: [] };
  }

  const obj = raw as Record<string, unknown>;
  const autopromptQuery = safeString(obj.autopromptString);
  const resultsRaw = Array.isArray(obj.results) ? obj.results : [];

  const results = resultsRaw
    .map(parseExaResult)
    .filter((r): r is ExaSearchResult => r !== null);

  // Parse cost information
  const costDollars = parseExaCost(obj.costDollars);

  return {
    query,
    results,
    ...(autopromptQuery ? { autopromptQuery } : {}),
    ...(costDollars ? { costDollars } : {}),
  };
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Performs a search using Exa API.
 *
 * By default uses 'deep' search which:
 * - Expands query into multiple variations for comprehensive results
 * - Returns rich context for each result
 * - Uses livecrawl: 'preferred' for fresh content with cache fallback
 *
 * If `EXA_API_KEY` is not configured, returns empty results so callers can
 * degrade gracefully.
 *
 * @param query - The search query (natural language works best)
 * @param options - Search options
 * @returns Search results
 *
 * @example
 * // Deep search for game mechanics (recommended)
 * const results = await exaSearch('how does the Ultrahand ability work in Zelda Tears of the Kingdom');
 *
 * @example
 * // Deep search with additional query variations
 * const results = await exaSearch('Elden Ring beginner tips', {
 *   additionalQueries: ['Elden Ring new player guide', 'Elden Ring first hours walkthrough'],
 * });
 *
 * @example
 * // Filter to specific domains
 * const results = await exaSearch('Elden Ring boss strategies', {
 *   includeDomains: ['fextralife.com', 'ign.com'],
 * });
 */
export async function exaSearch(
  query: string,
  options: ExaSearchOptions = {}
): Promise<ExaSearchResponse> {
  const cleanedQuery = query.trim();
  if (cleanedQuery.length === 0) {
    return { query: cleanedQuery, results: [] };
  }

  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    return { query: cleanedQuery, results: [] };
  }

  const timeoutMs = clampInt(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Determine search type - default to 'deep' for best quality
  const searchType = options.type ?? 'deep';

  try {
    // Build contents object
    const contents: Record<string, unknown> = {
      text: {
        maxCharacters: options.textMaxCharacters ?? DEFAULT_TEXT_MAX_CHARS,
      },
    };

    // Deep search requires context: true for rich results
    if (searchType === 'deep') {
      contents.context = true;
    }

    // Add summary if requested
    if (options.includeSummary) {
      contents.summary = options.summaryQuery
        ? { query: options.summaryQuery }
        : true;
    }

    // Build request body
    const body: Record<string, unknown> = {
      query: cleanedQuery,
      numResults: clampInt(options.numResults ?? DEFAULT_RESULTS, MIN_RESULTS, MAX_RESULTS),
      type: searchType,
      useAutoprompt: options.useAutoprompt ?? true,
      contents,
      // Livecrawl: 'preferred' for fresh content with cache fallback
      livecrawl: options.livecrawl ?? 'preferred',
      livecrawlTimeout: options.livecrawlTimeout ?? DEFAULT_LIVECRAWL_TIMEOUT_MS,
    };

    // Additional queries for deep search (expands coverage)
    if (options.additionalQueries && options.additionalQueries.length > 0) {
      body.additionalQueries = [...options.additionalQueries];
    }

    // Optional filters
    if (options.category) {
      body.category = options.category;
    }
    if (options.includeDomains && options.includeDomains.length > 0) {
      body.includeDomains = [...options.includeDomains];
    }
    if (options.excludeDomains && options.excludeDomains.length > 0) {
      body.excludeDomains = [...options.excludeDomains];
    }
    if (options.startPublishedDate) {
      body.startPublishedDate = options.startPublishedDate;
    }
    if (options.endPublishedDate) {
      body.endPublishedDate = options.endPublishedDate;
    }

    const res = await fetch(`${EXA_API_BASE_URL}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { query: cleanedQuery, results: [] };
    }

    const json = (await res.json()) as unknown;
    return parseExaResponse(cleanedQuery, json);
  } catch {
    return { query: cleanedQuery, results: [] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Finds content similar to a given URL using Exa API.
 *
 * Useful for:
 * - Finding related articles to avoid duplicate content
 * - Discovering additional sources similar to a known good source
 * - Research expansion
 *
 * If `EXA_API_KEY` is not configured, returns empty results so callers can
 * degrade gracefully.
 *
 * @param url - The reference URL to find similar content for
 * @param options - Search options
 * @returns Similar content results
 *
 * @example
 * // Find articles similar to a known good guide
 * const results = await exaFindSimilar('https://ign.com/articles/zelda-totk-guide', {
 *   numResults: 25,  // 1-25 results cost the same!
 *   excludeSourceDomain: true,
 * });
 */
export async function exaFindSimilar(
  url: string,
  options: ExaFindSimilarOptions = {}
): Promise<ExaSearchResponse> {
  const cleanedUrl = url.trim();
  if (cleanedUrl.length === 0) {
    return { query: cleanedUrl, results: [] };
  }

  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    return { query: cleanedUrl, results: [] };
  }

  const timeoutMs = clampInt(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Build request body
    const body: Record<string, unknown> = {
      url: cleanedUrl,
      numResults: clampInt(options.numResults ?? DEFAULT_RESULTS, MIN_RESULTS, MAX_RESULTS),
      excludeSourceDomain: options.excludeSourceDomain ?? true,
      contents: {
        text: {
          maxCharacters: options.textMaxCharacters ?? DEFAULT_TEXT_MAX_CHARS,
        },
      },
      // Livecrawl: 'preferred' for fresh content with cache fallback
      livecrawl: options.livecrawl ?? 'preferred',
    };

    // Optional filters
    if (options.includeDomains && options.includeDomains.length > 0) {
      body.includeDomains = [...options.includeDomains];
    }
    if (options.excludeDomains && options.excludeDomains.length > 0) {
      body.excludeDomains = [...options.excludeDomains];
    }

    const res = await fetch(`${EXA_API_BASE_URL}/findSimilar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { query: cleanedUrl, results: [] };
    }

    const json = (await res.json()) as unknown;
    return parseExaResponse(cleanedUrl, json);
  } catch {
    return { query: cleanedUrl, results: [] };
  } finally {
    clearTimeout(timer);
  }
}
