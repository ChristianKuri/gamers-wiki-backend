/**
 * Exa API Wrapper
 *
 * Provides semantic/neural search capabilities to complement Tavily's keyword-based search.
 * Exa excels at:
 * - Neural search (meaning-based, not just keyword matching)
 * - Finding similar content to a reference URL
 * - Category-based filtering (news, wiki, etc.)
 * - Understanding natural language queries like "how does X work"
 *
 * @see https://docs.exa.ai/
 */

// ============================================================================
// Types
// ============================================================================

/** Search type for Exa queries */
export type ExaSearchType = 'keyword' | 'neural' | 'auto';

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
  /** Number of results to return (1-10, default: 5) */
  readonly numResults?: number;
  /** Search type: 'keyword', 'neural', or 'auto' (default: 'auto') */
  readonly type?: ExaSearchType;
  /** Filter by content category */
  readonly category?: ExaCategory;
  /** Only include results from these domains */
  readonly includeDomains?: readonly string[];
  /** Exclude results from these domains */
  readonly excludeDomains?: readonly string[];
  /** Let Exa optimize the query for better results (default: true for neural) */
  readonly useAutoprompt?: boolean;
  /** Include text content in results (default: true) */
  readonly includeText?: boolean;
  /** Maximum characters of text to include per result */
  readonly textMaxCharacters?: number;
  /** Request timeout in milliseconds (default: 15000) */
  readonly timeoutMs?: number;
  /** Filter results to those published after this date (ISO string) */
  readonly startPublishedDate?: string;
  /** Filter results to those published before this date (ISO string) */
  readonly endPublishedDate?: string;
}

export interface ExaFindSimilarOptions {
  /** Number of results to return (1-10, default: 5) */
  readonly numResults?: number;
  /** Only include results from these domains */
  readonly includeDomains?: readonly string[];
  /** Exclude results from these domains */
  readonly excludeDomains?: readonly string[];
  /** Exclude the source URL from results (default: true) */
  readonly excludeSourceDomain?: boolean;
  /** Include text content in results (default: true) */
  readonly includeText?: boolean;
  /** Maximum characters of text to include per result */
  readonly textMaxCharacters?: number;
  /** Request timeout in milliseconds (default: 15000) */
  readonly timeoutMs?: number;
}

export interface ExaSearchResult {
  readonly title: string;
  readonly url: string;
  readonly content?: string;
  readonly score?: number;
  readonly publishedDate?: string;
  readonly author?: string;
}

export interface ExaSearchResponse {
  readonly query: string;
  readonly results: readonly ExaSearchResult[];
  /** Autoprompt-enhanced query (if useAutoprompt was enabled) */
  readonly autopromptQuery?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const EXA_API_BASE_URL = 'https://api.exa.ai';
const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;
const MIN_RESULTS = 1;
const MAX_RESULTS = 10;
const DEFAULT_RESULTS = 5;
const DEFAULT_TEXT_MAX_CHARS = 1000;

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

  const content = safeString(obj.text);
  const score = typeof obj.score === 'number' ? obj.score : undefined;
  const publishedDate = safeString(obj.publishedDate);
  const author = safeString(obj.author);

  return {
    title,
    url,
    ...(content ? { content } : {}),
    ...(score !== undefined ? { score } : {}),
    ...(publishedDate ? { publishedDate } : {}),
    ...(author ? { author } : {}),
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

  return {
    query,
    results,
    ...(autopromptQuery ? { autopromptQuery } : {}),
  };
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Performs a semantic search using Exa API.
 *
 * Exa's neural search understands meaning, not just keywords.
 * Best for queries like "how does X work" or "best strategies for Y".
 *
 * If `EXA_API_KEY` is not configured, returns empty results so callers can
 * degrade gracefully.
 *
 * @param query - The search query (natural language works best for neural search)
 * @param options - Search options
 * @returns Search results
 *
 * @example
 * // Neural search for game mechanics
 * const results = await exaSearch('how does the Ultrahand ability work in Zelda Tears of the Kingdom');
 *
 * @example
 * // Filter to specific domains
 * const results = await exaSearch('Elden Ring boss strategies', {
 *   includeDomains: ['fextralife.com', 'ign.com'],
 *   type: 'neural',
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

  try {
    // Build request body
    const body: Record<string, unknown> = {
      query: cleanedQuery,
      numResults: clampInt(options.numResults ?? DEFAULT_RESULTS, MIN_RESULTS, MAX_RESULTS),
      type: options.type ?? 'auto',
      useAutoprompt: options.useAutoprompt ?? (options.type === 'neural' || options.type === 'auto'),
      contents: {
        text: {
          maxCharacters: options.textMaxCharacters ?? DEFAULT_TEXT_MAX_CHARS,
        },
      },
    };

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
 *   numResults: 5,
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

