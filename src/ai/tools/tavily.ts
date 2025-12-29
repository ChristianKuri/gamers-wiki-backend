/**
 * Tavily Web Search API wrapper.
 *
 * Pricing: $0.008 per credit (basic=1, advanced=2)
 * Docs: https://docs.tavily.com/documentation/api-reference/endpoint/search
 *
 * Current features used:
 * - search_depth: basic (1 credit)
 * - include_answer: true (LLM summary)
 * - include_usage: true (cost tracking)
 *
 * Future features available (not yet implemented):
 * - include_images: true → images[]: { url, description? }
 *   Use case: Article hero images, inline screenshots
 * - include_image_descriptions: true → Alt text for images
 * - topic: "news" → Real-time game updates, patch notes
 * - time_range: "week" | "month" → Filter recent content
 * - search_depth: "advanced" → Multiple semantic snippets per URL (2 credits)
 *
 * @see docs/ai-article-generation-technical-reference.md for full API reference
 */

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

/**
 * Credit usage from Tavily API.
 * Cost: $0.008 per credit
 * - basic search: 1 credit
 * - advanced search: 2 credits
 */
export interface TavilyUsage {
  readonly credits: number;
}

export interface TavilySearchResponse {
  readonly query: string;
  readonly answer: string | null;
  readonly results: readonly TavilySearchResult[];
  /** Credit usage from Tavily API (if include_usage was true) */
  readonly usage?: TavilyUsage;
  /** Calculated cost in USD based on credits ($0.008/credit) */
  readonly costUsd?: number;
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

/** Cost per Tavily credit in USD */
const TAVILY_COST_PER_CREDIT = 0.008;

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

  // Parse usage from response (if include_usage was true)
  let usage: TavilyUsage | undefined;
  let costUsd: number | undefined;
  const usageObj = obj.usage;
  if (usageObj && typeof usageObj === 'object') {
    const usageRecord = usageObj as Record<string, unknown>;
    if (typeof usageRecord.credits === 'number') {
      const credits = usageRecord.credits;
      usage = { credits };
      costUsd = credits * TAVILY_COST_PER_CREDIT;
    }
  }

  return {
    query,
    answer,
    results,
    ...(usage ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
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
        // Modern auth via header (api_key in body still works for backwards compat)
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: cleanedQuery,
        search_depth: options.searchDepth ?? 'basic',
        max_results: clampInt(options.maxResults ?? 6, 1, 20), // Tavily allows up to 20
        include_answer: options.includeAnswer ?? true,
        include_raw_content: options.includeRawContent ?? false,
        include_usage: true, // Track actual credit usage for cost calculation
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
