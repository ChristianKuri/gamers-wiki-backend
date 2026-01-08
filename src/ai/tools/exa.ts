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
 * ## Pricing (December 2024)
 *
 * | Component         | Cost          | Notes                              |
 * |-------------------|---------------|------------------------------------|
 * | Neural search     | $0.005/req    | Flat rate for 1-25 results         |
 * | Deep search       | $0.015/req    | Flat rate for 1-25 results         |
 * | Content text      | $0.001/page   | Per result, any length up to limit |
 * | Summary           | $0.001/page   | AI-generated, query-aware          |
 * | Highlights        | $0.001/page   | Key sentences extracted            |
 *
 * ### Cost Examples:
 * - 5 results + neural + text: $0.005 + (5 × $0.001) = $0.010
 * - 10 results + neural + text: $0.005 + (10 × $0.001) = $0.015
 * - 5 results + neural + text + summary: $0.005 + (5 × $0.002) = $0.015
 *
 * ## A/B Test Findings (December 2024)
 *
 * - Neural vs Auto: Same cost, Neural is 5x FASTER (313ms vs 1,593ms)
 * - Content length: No cost difference up to 20,000c - free upgrade!
 * - Summary: Adds 8-16 SECONDS latency - NOT recommended
 * - Highlights: +$0.001/page, fast, marginal value
 * - 5 vs 10 results: 70% more content for 50% more cost - good value
 *
 * @see https://docs.exa.ai/reference/search
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
   * Search type. Default: 'neural' for best speed/cost balance.
   *
   * A/B Test Results (Dec 2024):
   * - Neural: 313ms avg latency, $0.005 base cost (RECOMMENDED)
   * - Auto: 1,593ms avg latency, same $0.005 cost (5x slower!)
   * - Deep: $0.015 base cost, slower, query expansion
   *
   * @see https://docs.exa.ai/reference/search
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
   * Default: 100000 (matches CLEANER_CONFIG.MAX_INPUT_CHARS)
   *
   * A/B Test: Content length has NO cost impact!
   * Cost is $0.001/page regardless of length.
   * Long wiki pages can exceed 20k easily - use 100k for full content.
   */
  readonly textMaxCharacters?: number;
  /**
   * Include AI-generated summary for each result.
   * Summaries are abstractive (created by Gemini Flash) and query-aware.
   *
   * WARNING: Adds 8-16 SECONDS of latency per search!
   * Cost: +$0.001/page.
   *
   * NOT RECOMMENDED: The latency cost is too high. If you need summaries,
   * generate them yourself with your own LLM call (faster).
   *
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
  /**
   * Number of images to retrieve per result (1-5).
   * Set via contents.extras.imageLinks in API request.
   * Use case: Article hero images, inline screenshots.
   * Cost: No extra charge for images.
   * @see https://docs.exa.ai/reference/contents-retrieval#images-and-favicons
   */
  readonly imageLinks?: number;
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
  /** Website favicon URL (always available) */
  readonly favicon?: string;
  /** Representative image URL for the page (when available) */
  readonly image?: string;
  /**
   * Array of image URLs from the page (when imageLinks > 0 requested).
   * @see https://docs.exa.ai/reference/contents-retrieval#images-and-favicons
   */
  readonly imageLinks?: readonly string[];
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

// Results limits
// Pricing: 1-25 results = same price ($0.005 neural, $0.015 deep)
// 26-100 results = 5x more ($0.025 neural, $0.075 deep)
const MIN_RESULTS = 1;
const MAX_RESULTS = 25;

// Default: 10 results
// - Each result costs +$0.001 for text extraction
// - 5 results = $0.010, 10 results = $0.015 (with neural)
// - 10 gives 70% more content for 50% more cost = good value
const DEFAULT_RESULTS = 10;

// Content length (characters per result)
// A/B Test: NO cost difference regardless of textMaxCharacters!
// Cost is $0.001/page whether 20k or 100k characters.
// Set to 100,000 to match CLEANER_CONFIG.MAX_INPUT_CHARS.
// Long wiki pages (Fextralife, Game8) can exceed 20k easily.
const DEFAULT_TEXT_MAX_CHARS = 100000;

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
  
  // Image fields
  const favicon = safeString(obj.favicon);
  const image = safeString(obj.image);
  
  // Parse imageLinks from extras (Exa returns these in an extras object)
  let imageLinks: readonly string[] | undefined;
  const extras = obj.extras as Record<string, unknown> | undefined;
  if (extras && Array.isArray(extras.imageLinks)) {
    const validLinks = extras.imageLinks
      .map(link => safeString(link))
      .filter((link): link is string => link !== undefined);
    if (validLinks.length > 0) {
      imageLinks = validLinks;
    }
  }

  return {
    title,
    url,
    ...(content ? { content } : {}),
    ...(summary ? { summary } : {}),
    ...(score !== undefined ? { score } : {}),
    ...(publishedDate ? { publishedDate } : {}),
    ...(author ? { author } : {}),
    ...(favicon ? { favicon } : {}),
    ...(image ? { image } : {}),
    ...(imageLinks ? { imageLinks } : {}),
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

  // Determine search type - default to 'neural' for best speed
  // A/B Test (Dec 2024): Neural is 5x faster than auto (313ms vs 1,593ms), same cost!
  const searchType = options.type ?? 'neural';

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
    
    // Add image links if requested (1-5 images per result)
    if (options.imageLinks && options.imageLinks > 0) {
      const imageCount = clampInt(options.imageLinks, 1, 5);
      contents.extras = {
        imageLinks: imageCount,
      };
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
