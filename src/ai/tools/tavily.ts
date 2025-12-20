export type TavilySearchDepth = 'basic' | 'advanced';

export interface TavilySearchOptions {
  readonly searchDepth?: TavilySearchDepth;
  readonly maxResults?: number;
  readonly includeAnswer?: boolean;
  readonly includeRawContent?: boolean;
  readonly timeoutMs?: number;
}

export interface TavilySearchResult {
  readonly title: string;
  readonly url: string;
  readonly content?: string;
  readonly score?: number;
  readonly raw_content?: string;
}

export interface TavilySearchResponse {
  readonly query: string;
  readonly answer: string | null;
  readonly results: readonly TavilySearchResult[];
}

export function isTavilyConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseTavilyResponse(query: string, raw: unknown): TavilySearchResponse {
  if (!raw || typeof raw !== 'object') {
    return { query, answer: null, results: [] };
  }

  const obj = raw as Record<string, unknown>;

  const answer = safeString(obj.answer) ?? null;
  const resultsRaw = Array.isArray(obj.results) ? obj.results : [];

  const results: TavilySearchResult[] = resultsRaw
    .map((r): TavilySearchResult | null => {
      if (!r || typeof r !== 'object') return null;
      const rr = r as Record<string, unknown>;
      const title = safeString(rr.title);
      const url = safeString(rr.url);
      if (!title || !url) return null;

      const content = safeString(rr.content);
      const rawContent = safeString(rr.raw_content);
      const score = typeof rr.score === 'number' ? rr.score : undefined;

      return {
        title,
        url,
        ...(content ? { content } : {}),
        ...(rawContent ? { raw_content: rawContent } : {}),
        ...(score !== undefined ? { score } : {}),
      };
    })
    .filter((r): r is TavilySearchResult => r !== null);

  return { query, answer, results };
}

/**
 * Tavily search wrapper.
 *
 * If `TAVILY_API_KEY` is not configured, returns empty results so callers can
 * degrade gracefully (Strapi/IGDB context only).
 */
export async function tavilySearch(
  query: string,
  options: TavilySearchOptions = {}
): Promise<TavilySearchResponse> {
  const cleanedQuery = query.trim();
  if (cleanedQuery.length === 0) {
    return { query: cleanedQuery, answer: null, results: [] };
  }

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return { query: cleanedQuery, answer: null, results: [] };
  }

  const timeoutMs = clampInt(options.timeoutMs ?? 15_000, 1_000, 60_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: cleanedQuery,
        search_depth: options.searchDepth ?? 'basic',
        max_results: clampInt(options.maxResults ?? 6, 1, 10),
        include_answer: options.includeAnswer ?? true,
        include_raw_content: options.includeRawContent ?? false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { query: cleanedQuery, answer: null, results: [] };
    }

    const json = (await res.json()) as unknown;
    return parseTavilyResponse(cleanedQuery, json);
  } catch {
    return { query: cleanedQuery, answer: null, results: [] };
  } finally {
    clearTimeout(timer);
  }
}
