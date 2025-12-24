import { createOpenAI } from '@ai-sdk/openai';
import { generateObject, generateText } from 'ai';

import type { SupportedLocale } from '../config';
import { getModel } from '../config';
import { tavilySearch } from '../tools/tavily';
import {
  ArticlePlanSchema,
  normalizeArticleCategorySlug,
  type ArticlePlan,
  type ArticlePlanInput,
  type ArticleCategorySlug,
  type ArticleSectionPlan,
} from './article-plan';
import { countContentH2Sections, getContentH2Sections, stripSourcesSection } from './markdown-utils';

// Configuration constants
const SCOUT_CONFIG = {
  MAX_SNIPPET_LENGTH: 800,
  MAX_SNIPPETS: 10,
  OVERVIEW_SEARCH_RESULTS: 8,
  CATEGORY_SEARCH_RESULTS: 6,
  RECENT_SEARCH_RESULTS: 5,
  MAX_CATEGORY_SEARCHES: 2,
  OVERVIEW_SEARCH_DEPTH: 'advanced' as const,
  CATEGORY_SEARCH_DEPTH: 'advanced' as const,
  RECENT_SEARCH_DEPTH: 'basic' as const,
  TEMPERATURE: 0.2, // Low temperature for factual extraction
  RESULTS_PER_SEARCH_CONTEXT: 5, // Results to include per search in context
  KEY_FINDINGS_LIMIT: 3, // Key findings per category search
  RECENT_RESULTS_LIMIT: 3, // Recent results to include
  RECENT_CONTENT_LENGTH: 300, // Character limit for recent content snippets
};

const EDITOR_CONFIG = {
  TEMPERATURE: 0.4, // Moderate temperature for structured creativity
  OVERVIEW_LINES_IN_PROMPT: 10, // Lines of overview to show in editor prompt
};

const SPECIALIST_CONFIG = {
  SNIPPET_LENGTH: 280,
  TOP_RESULTS_PER_QUERY: 3,
  CONTEXT_TAIL_LENGTH: 500,
  MIN_PARAGRAPHS: 2,
  MAX_PARAGRAPHS: 5,
  MAX_SCOUT_OVERVIEW_LENGTH: 2500,
  RESEARCH_CONTEXT_PER_RESULT: 600, // Characters per research result in context
  THIN_RESEARCH_THRESHOLD: 500, // Minimum research content length
  TEMPERATURE: 0.6, // Higher temperature for engaging prose
  RESULTS_PER_RESEARCH_CONTEXT: 5, // Results to show per research in specialist
  MAX_OUTPUT_TOKENS_PER_SECTION: 1500, // ~1000-1200 words max per section
};

const GENERAL_CONFIG = {
  MAX_SOURCES: 25,
  MAX_UNIQUE_ITEMS: 10,
  SPECIALIST_SEARCH_DEPTH: 'advanced' as const,
  SPECIALIST_MAX_RESULTS: 5,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  RATE_LIMIT_DELAY_MS: 300,
  MIN_SOURCES_WARNING: 5,
  MIN_QUERIES_WARNING: 3,
  API_TIMEOUT_MS: 60000, // 60 second timeout for API calls
};

// Logger abstraction - uses strapi.log when available, falls back to console
const logger = {
  info: (message: string) => (typeof strapi !== 'undefined' ? strapi.log.info(message) : console.log(message)),
  warn: (message: string) => (typeof strapi !== 'undefined' ? strapi.log.warn(message) : console.warn(message)),
  error: (message: string) => (typeof strapi !== 'undefined' ? strapi.log.error(message) : console.error(message)),
  debug: (message: string) => (typeof strapi !== 'undefined' ? strapi.log.debug(message) : console.log(message)),
};

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || '',
});

// Research Pool Types
interface SearchResultItem {
  readonly title: string;
  readonly url: string;
  readonly content: string;
  readonly score?: number;
}

interface CategorizedSearchResult {
  readonly query: string;
  readonly answer: string | null;
  readonly results: SearchResultItem[];
  readonly category: 'overview' | 'category-specific' | 'recent' | 'section-specific';
  readonly timestamp: number;
}

interface ResearchPool {
  readonly scoutFindings: {
    readonly overview: CategorizedSearchResult[];
    readonly categorySpecific: CategorizedSearchResult[];
    readonly recent: CategorizedSearchResult[];
  };
  readonly allUrls: Set<string>;
  readonly queryCache: Map<string, CategorizedSearchResult>; // Dedupe similar queries
}

interface ScoutOutput {
  readonly briefing: {
    readonly overview: string;
    readonly categoryInsights: string;
    readonly recentDevelopments: string;
    readonly fullContext: string; // Comprehensive briefing, no word limit
  };
  readonly researchPool: ResearchPool;
  readonly sourceUrls: string[];
}

export interface GameArticleContext {
  readonly gameName: string;
  readonly gameSlug?: string | null;
  readonly releaseDate?: string | null;
  readonly genres?: readonly string[];
  readonly platforms?: readonly string[];
  readonly developer?: string | null;
  readonly publisher?: string | null;
  readonly igdbDescription?: string | null;
  readonly instruction?: string | null;
  readonly categoryHints?: readonly { slug: ArticleCategorySlug; systemPrompt?: string | null }[];
}

export interface GameArticleDraft {
  readonly title: string;
  readonly categorySlug: ArticleCategorySlug;
  readonly excerpt: string;
  readonly tags: readonly string[];
  readonly markdown: string;
  readonly sources: readonly string[];
  readonly plan: ArticlePlan;
  readonly models: {
    scout: string;
    editor: string;
    specialist: string;
  };
}

function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function formatSources(urls: readonly string[]): string {
  if (urls.length === 0) return '';
  return ['## Sources', ...urls.map((u) => `- ${u}`), ''].join('\n');
}

function ensureUniqueStrings(values: readonly string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const trimmed = v.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  operation: string,
  options: { maxRetries?: number; timeoutMs?: number } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? GENERAL_CONFIG.MAX_RETRIES;
  const timeoutMs = options.timeoutMs ?? GENERAL_CONFIG.API_TIMEOUT_MS;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, operation);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn(`${operation} attempt ${attempt + 1}/${maxRetries} failed: ${lastError.message}`);
      if (attempt < maxRetries - 1) {
        const delay = GENERAL_CONFIG.RETRY_DELAY_MS * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  interface ErrorWithCause extends Error {
    cause?: unknown;
  }

  const err: ErrorWithCause = new Error(
    `${operation} failed after ${maxRetries} attempts: ${lastError?.message}`
  );
  err.cause = lastError ?? undefined;
  throw err;
}

async function rateLimitedMap<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  delayMs = GENERAL_CONFIG.RATE_LIMIT_DELAY_MS
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i++) {
    results.push(await fn(items[i]));
    // Add delay between items (but not after the last one)
    if (delayMs > 0 && i < items.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return results;
}

function createResearchPool(): ResearchPool {
  return {
    scoutFindings: {
      overview: [],
      categorySpecific: [],
      recent: [],
    },
    allUrls: new Set(),
    queryCache: new Map(),
  };
}

function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

function addToResearchPool(
  pool: ResearchPool,
  result: CategorizedSearchResult
): ResearchPool {
  const normalizedQuery = normalizeQuery(result.query);

  // Check if we already have this query
  if (pool.queryCache.has(normalizedQuery)) {
    return pool; // Skip duplicate
  }

  // Add URLs to tracking (immutable)
  const newUrls = new Set(pool.allUrls);
  result.results.forEach(r => newUrls.add(r.url));

  // Add to appropriate category (immutable)
  const newScoutFindings = { ...pool.scoutFindings };
  if (result.category === 'overview') {
    newScoutFindings.overview = [...pool.scoutFindings.overview, result];
  } else if (result.category === 'category-specific') {
    newScoutFindings.categorySpecific = [...pool.scoutFindings.categorySpecific, result];
  } else if (result.category === 'recent') {
    newScoutFindings.recent = [...pool.scoutFindings.recent, result];
  }

  // Create new query cache (immutable)
  const newQueryCache = new Map(pool.queryCache);
  newQueryCache.set(normalizedQuery, result);

  return {
    scoutFindings: newScoutFindings,
    allUrls: newUrls,
    queryCache: newQueryCache,
  };
}

function findInResearchPool(
  pool: ResearchPool,
  query: string
): CategorizedSearchResult | null {
  const normalized = normalizeQuery(query);
  return pool.queryCache.get(normalized) || null;
}

async function executeSearch(
  query: string,
  category: CategorizedSearchResult['category'],
  options: { searchDepth: 'basic' | 'advanced'; maxResults: number }
): Promise<CategorizedSearchResult> {
  const result = await withRetry(
    () => tavilySearch(query, {
      searchDepth: options.searchDepth,
      maxResults: options.maxResults,
      includeAnswer: true,
      includeRawContent: false,
    }),
    `Search for: ${query}`
  );

  return {
    query,
    answer: result.answer || null,
    results: result.results
      .map((r) => {
        const normalized = normalizeUrl(r.url);
        if (!normalized) return null;
        const score = typeof r.score === 'number' ? r.score : undefined;
        return {
          title: r.title,
          url: normalized,
          content: r.content || '',
          ...(score !== undefined ? { score } : {}),
        };
      })
      .filter((r): r is SearchResultItem => r !== null),
    category,
    timestamp: Date.now(),
  };
}

function buildCategoryHintsSection(
  hints: readonly { slug: ArticleCategorySlug; systemPrompt?: string | null }[] | undefined
): string {
  if (!hints || hints.length === 0) return '';
  const lines = hints.map((h) => {
    const p = (h.systemPrompt || '').trim();
    return p.length > 0 ? `- ${h.slug}: ${p}` : `- ${h.slug}`;
  });
  return `\n\nAvailable categories (pick ONE categorySlug):\n${lines.join('\n')}`;
}

function deduplicateQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  return queries.filter(query => {
    const normalized = normalizeQuery(query);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

async function runScout(context: GameArticleContext, locale: SupportedLocale): Promise<ScoutOutput> {
  const localeInstruction = locale === 'es' ? 'Write in Spanish.' : 'Write in English.';
  const instruction = context.instruction?.trim();

  // Initialize research pool
  let researchPool = createResearchPool();

  // ===== PARALLEL SEARCH PHASE: Run all searches simultaneously =====

  // Build overview query
  const overviewQuery = `"${context.gameName}" game overview gameplay mechanics ${context.genres?.join(' ') || ''}`;

  // Build category queries (deduplicate before execution to avoid wasted API calls)
  const rawCategoryQueries: string[] = [];
  if (instruction) {
    rawCategoryQueries.push(`"${context.gameName}" ${instruction}`);
  } else {
    rawCategoryQueries.push(`"${context.gameName}" review analysis opinion`);
    rawCategoryQueries.push(`"${context.gameName}" guide tips strategies`);
  }

  if (context.categoryHints?.length) {
    context.categoryHints.forEach(hint => {
      const hintQuery = `"${context.gameName}" ${hint.systemPrompt || hint.slug}`;
      rawCategoryQueries.push(hintQuery);
    });
  }

  // Deduplicate category queries before API execution
  const categoryQueries = deduplicateQueries(rawCategoryQueries);

  // Build recent query
  const currentYear = new Date().getFullYear();
  const recentQuery = `"${context.gameName}" latest news updates patches ${currentYear}`;

  // Execute ALL searches in parallel
  const [overviewSearch, ...categorySearches] = await Promise.all([
    // Overview search
    executeSearch(overviewQuery, 'overview', {
      searchDepth: SCOUT_CONFIG.OVERVIEW_SEARCH_DEPTH,
      maxResults: SCOUT_CONFIG.OVERVIEW_SEARCH_RESULTS,
    }),
    // Category searches (limited and deduplicated)
    ...categoryQueries.slice(0, SCOUT_CONFIG.MAX_CATEGORY_SEARCHES).map(query =>
      executeSearch(query, 'category-specific', {
        searchDepth: SCOUT_CONFIG.CATEGORY_SEARCH_DEPTH,
        maxResults: SCOUT_CONFIG.CATEGORY_SEARCH_RESULTS,
      })
    ),
    // Recent search
    executeSearch(recentQuery, 'recent', {
      searchDepth: SCOUT_CONFIG.RECENT_SEARCH_DEPTH,
      maxResults: SCOUT_CONFIG.RECENT_SEARCH_RESULTS,
    }),
  ]);

  // Process all search results into research pool
  researchPool = addToResearchPool(researchPool, overviewSearch);
  categorySearches.slice(0, -1).forEach(search => {
    researchPool = addToResearchPool(researchPool, search);
  });
  // Last item is the recent search
  const recentSearch = categorySearches[categorySearches.length - 1];
  researchPool = addToResearchPool(researchPool, recentSearch);

  // ===== PHASE 4: GENERATE COMPREHENSIVE BRIEFINGS (NO COMPRESSION) =====

  // Collect all search results for context
  const allSearchResults = [
    ...researchPool.scoutFindings.overview,
    ...researchPool.scoutFindings.categorySpecific,
    ...researchPool.scoutFindings.recent,
  ];

  // Build rich context from all searches
  const searchContext = allSearchResults
    .map(search => {
      const snippets = search.results
        .slice(0, SCOUT_CONFIG.RESULTS_PER_SEARCH_CONTEXT)
        .map(r => `  - ${r.title} (${r.url})\n    ${r.content.slice(0, SCOUT_CONFIG.MAX_SNIPPET_LENGTH)}`)
        .join('\n');

      return `Query: "${search.query}"
Category: ${search.category}
AI Summary: ${search.answer || '(none)'}
Results:
${snippets}`;
    })
    .join('\n\n---\n\n');

  // Generate category-specific insights context
  const categoryContext = researchPool.scoutFindings.categorySpecific
    .map(search => `Query: "${search.query}"\nSummary: ${search.answer || '(none)'}\nKey findings: ${search.results.slice(0, SCOUT_CONFIG.KEY_FINDINGS_LIMIT).map(r => r.title).join('; ')}`)
    .join('\n\n');

  // Generate recent developments context
  const recentContext = researchPool.scoutFindings.recent
    .flatMap(search => search.results.slice(0, SCOUT_CONFIG.RECENT_RESULTS_LIMIT))
    .map(r => `- ${r.title}: ${r.content.slice(0, SCOUT_CONFIG.RECENT_CONTENT_LENGTH)}`)
    .join('\n');

  // Run all three briefing generations in parallel for faster execution
  const [
    { text: overviewBriefing },
    { text: categoryBriefing },
    { text: recentBriefing }
  ] = await Promise.all([
    // Overview briefing (no word limit)
    withRetry(
      () => generateText({
        model: openrouter(getModel('ARTICLE_SCOUT')),
        temperature: SCOUT_CONFIG.TEMPERATURE,
        system: `You are the Scout agent — a precision research specialist for game journalism.

Your mission: Create a comprehensive overview briefing with all essential facts about the game.

Core principles:
- FACTS ONLY: Never invent, speculate, or extrapolate beyond the sources
- COMPREHENSIVE: Include ALL relevant details, no word limits
- STRUCTURED: Organize by topic for easy reference
- VERIFICATION: Mark uncertain claims as "according to [source]"

${localeInstruction}`,
        prompt: `Create a comprehensive overview briefing for "${context.gameName}".

=== GAME METADATA ===
- Name: ${context.gameName}
- Release Date: ${context.releaseDate || 'unknown'}
- Genres: ${context.genres?.join(', ') || 'unknown'}
- Platforms: ${context.platforms?.join(', ') || 'unknown'}
- Developer: ${context.developer || 'unknown'}
- Publisher: ${context.publisher || 'unknown'}
${context.igdbDescription ? `- IGDB Description: ${context.igdbDescription}` : ''}

=== SEARCH RESULTS ===
${searchContext}

=== BRIEFING STRUCTURE ===
Organize your briefing with these sections (use bullet points):

1. CORE GAME IDENTITY
   - Genre(s) and gameplay style
   - Core gameplay loop
   - Primary appeal (what players praise most, per sources)

2. RELEASE & AVAILABILITY
   - Release status and date
   - Available platforms
   - Development stage (released/early access/upcoming)

3. KEY FEATURES & MECHANICS
   - Standout gameplay mechanics
   - Unique selling points
   - Innovation or notable systems

4. TECHNICAL & CONTENT DETAILS
   - Game modes (single/multiplayer)
   - Content scope
   - Technical specifications (if relevant)

5. RECEPTION & COMMUNITY
   - Critical reception (review scores if available)
   - Player sentiment
   - Notable praise or criticism

6. CURRENT STATE & HISTORY
   - Recent updates or patches
   - Development timeline
   - Controversies or ongoing issues (if any)

IMPORTANT:
- NO word limits - be thorough
- Ground all claims in sources
- Note conflicting information
- Acknowledge gaps in knowledge

Output your comprehensive briefing:`,
      }),
      'Scout overview briefing'
    ),

    // Category-specific insights
    withRetry(
      () => generateText({
        model: openrouter(getModel('ARTICLE_SCOUT')),
        temperature: SCOUT_CONFIG.TEMPERATURE,
        system: `You are the Scout agent analyzing category-specific research.

${localeInstruction}`,
        prompt: `Analyze the category-specific research for "${context.gameName}".

${instruction ? `User wants: ${instruction}` : 'General analysis requested'}

=== CATEGORY RESEARCH ===
${categoryContext || '(No category-specific research available)'}

Provide insights on:
- What angle would make the best article (news/review/guide/list)?
- What specific aspects should be highlighted?
- What gaps exist in current coverage?

Keep it factual and brief (3-5 bullet points):`,
      }),
      'Scout category insights'
    ),

    // Recent developments summary
    withRetry(
      () => generateText({
        model: openrouter(getModel('ARTICLE_SCOUT')),
        temperature: SCOUT_CONFIG.TEMPERATURE,
        system: `You are the Scout agent tracking recent developments.

${localeInstruction}`,
        prompt: `Summarize recent news and updates for "${context.gameName}".

=== RECENT FINDINGS ===
${recentContext || '(No recent news found)'}

Provide:
- Latest announcements or updates
- Recent patch notes or changes
- Current community discussions
- Time-sensitive information

Brief summary (3-5 bullet points, or state if nothing significant):`,
      }),
      'Scout recent developments'
    )
  ]);

  // Create full context document (combination of all briefings)
  const fullContext = `=== OVERVIEW ===
${overviewBriefing}

=== CATEGORY INSIGHTS ===
${categoryBriefing}

=== RECENT DEVELOPMENTS ===
${recentBriefing}

=== METADATA ===
Game: ${context.gameName}
Developer: ${context.developer || 'unknown'}
Publisher: ${context.publisher || 'unknown'}
Release: ${context.releaseDate || 'unknown'}
Genres: ${context.genres?.join(', ') || 'unknown'}
Platforms: ${context.platforms?.join(', ') || 'unknown'}
${context.igdbDescription ? `\nIGDB: ${context.igdbDescription}` : ''}
${instruction ? `\nUser Directive: ${instruction}` : ''}`;

  // Collect all unique URLs
  const allUrls = Array.from(researchPool.allUrls);

  // ===== VALIDATION: Check research quality =====
  if (researchPool.allUrls.size < GENERAL_CONFIG.MIN_SOURCES_WARNING) {
    logger.warn(
      `Scout found only ${researchPool.allUrls.size} sources for "${context.gameName}" ` +
      `(minimum recommended: ${GENERAL_CONFIG.MIN_SOURCES_WARNING}). Article quality may be limited.`
    );
  }

  if (researchPool.queryCache.size < GENERAL_CONFIG.MIN_QUERIES_WARNING) {
    logger.warn(
      `Only ${researchPool.queryCache.size} unique queries executed for "${context.gameName}" ` +
      `(minimum recommended: ${GENERAL_CONFIG.MIN_QUERIES_WARNING}). Research depth may be limited.`
    );
  }

  // Validate briefings aren't empty
  if (!overviewBriefing.trim() || overviewBriefing.trim().length < 50) {
    throw new Error(
      `Scout failed to generate meaningful overview briefing for "${context.gameName}". ` +
      `Generated briefing was ${overviewBriefing.trim().length} characters. ` +
      `This may indicate poor search results or API issues.`
    );
  }

  // Check for failed searches
  const failedSearches = Array.from(researchPool.queryCache.values())
    .filter(r => r.results.length === 0);

  if (failedSearches.length > 0) {
    logger.warn(
      `${failedSearches.length} search(es) returned no results: ` +
      failedSearches.map(s => `"${s.query}"`).join(', ')
    );
  }

  return {
    briefing: {
      overview: overviewBriefing.trim(),
      categoryInsights: categoryBriefing.trim(),
      recentDevelopments: recentBriefing.trim(),
      fullContext: fullContext.trim(),
    },
    researchPool,
    sourceUrls: allUrls,
  };
}

async function runEditor(
  context: GameArticleContext,
  locale: SupportedLocale,
  scoutOutput: ScoutOutput
): Promise<ArticlePlan> {
  const localeInstruction = locale === 'es' ? 'Write all strings in Spanish.' : 'Write all strings in English.';
  const categoryHints = buildCategoryHintsSection(context.categoryHints);

  // Build summary of existing research to inform Editor
  const existingResearchSummary = `EXISTING RESEARCH COVERAGE:
Overview searches: ${scoutOutput.researchPool.scoutFindings.overview.map(s => `"${s.query}"`).join(', ')}
Category searches: ${scoutOutput.researchPool.scoutFindings.categorySpecific.map(s => `"${s.query}"`).join(', ')}
Recent searches: ${scoutOutput.researchPool.scoutFindings.recent.map(s => `"${s.query}"`).join(', ')}
Total sources: ${scoutOutput.researchPool.allUrls.size}

The research pool already contains comprehensive information on:
${scoutOutput.briefing.overview.split('\n').slice(0, EDITOR_CONFIG.OVERVIEW_LINES_IN_PROMPT).join('\n')}
...

When creating research queries, focus on SPECIFIC details not yet fully covered.`;

  const { object } = await withRetry(
    () => generateObject({
      model: openrouter(getModel('ARTICLE_EDITOR')),
      temperature: EDITOR_CONFIG.TEMPERATURE,
      schema: ArticlePlanSchema,
      system: `You are the Editor agent — a strategic article architect for game journalism.

Your mission: Design a compelling, well-researched article outline that balances reader value with journalistic rigor.

Core competencies:
- STRATEGIC STRUCTURE: Organize information in a logical, engaging flow
- RESEARCH EFFICIENCY: Create queries that complement existing research (not duplicate it)
- CATEGORY EXPERTISE: Select the format that best serves the content and reader
- AUDIENCE AWARENESS: Tailor depth and tone to reader expectations
- QUALITY GATEKEEPING: Plan only what can be factually supported

${localeInstruction}`,
      prompt: `Design an article plan for "${context.gameName}".

=== USER DIRECTIVE ===
${context.instruction?.trim() || '(No specific directive — determine best article type from context)'}

=== COMPREHENSIVE SCOUT INTELLIGENCE ===
${scoutOutput.briefing.fullContext}

=== ${existingResearchSummary}

=== GAME METADATA ===
- Name: ${context.gameName}
- Release Date: ${context.releaseDate || 'unknown'}
- Genres: ${context.genres?.join(', ') || 'unknown'}
- Platforms: ${context.platforms?.join(', ') || 'unknown'}
- Developer: ${context.developer || 'unknown'}
- Publisher: ${context.publisher || 'unknown'}

=== CATEGORY SELECTION GUIDE ===
Choose the categorySlug that delivers maximum reader value:

• news: Breaking announcements, updates, patches, release dates, industry events
  - Best for: Time-sensitive information, official announcements, recent developments
  - Avoid if: Information is evergreen or instructional

• reviews: Critical analysis, scoring, recommendation, pros/cons evaluation
  - Best for: Post-release assessment, comparative analysis, editorial opinion
  - Requires: Enough source material for substantive critique

• guides: How-to content, tutorials, strategies, walkthroughs, optimization tips
  - Best for: Helping players solve problems or improve performance
  - Requires: Actionable, step-by-step information

• lists: Ranked compilations, curated collections, comparison articles
  - Best for: Multiple items to compare, "top X" or "best of" formats
  - Requires: At least 5-7 items to list/compare

${categoryHints}

=== RESEARCH QUERY CRAFTING ===
Each section needs 1-6 researchQueries. Make them SPECIFIC and TARGETED.

IMPORTANT: We already have extensive research from Scout. Create queries that:
1. Fill SPECIFIC gaps in existing knowledge
2. Target DETAILS needed for this particular section
3. AVOID repeating what Scout already covered

✓ GOOD: "What are the specific combo inputs for Elden Ring magic builds?"
✓ GOOD: "How long does it take to complete Hollow Knight 100%?"
✓ GOOD: "What weapons are in the latest Hades patch 1.5?"

✗ BAD: "Tell me about Elden Ring" (Scout already covered this)
✗ BAD: "Is it good?" (subjective, not researchable)
✗ BAD: "Elden Ring gameplay overview" (redundant with Scout overview)

Quality criteria for research queries:
- Complement (not duplicate) existing Scout research
- Target section-specific details, not general overviews
- Can be answered with specific facts from search results
- Target concrete information (mechanics, dates, features, specs)
- Each query should yield distinct, additive information

=== STRUCTURAL REQUIREMENTS ===

title: Compelling, SEO-friendly headline (50-70 characters ideal)
  - Include game name
  - Indicate article type/value prop
  - Avoid clickbait; be specific

excerpt: Meta description (MUST be 120-160 characters)
  - Summarize article value
  - Include primary keyword
  - Write for search results display

tags: 3-8 short topic tags (no hashtags, no @ symbols)
  - Examples: "action RPG", "PS5 exclusive", "multiplayer guide"
  - Use reader search terms, not marketing jargon

sections: 4-8 sections (3 minimum, 12 maximum allowed by schema)
  - Each section has: headline, goal, researchQueries[]
  - headline: Section title (2-5 words)
  - goal: Internal note on section purpose (1 sentence)
  - researchQueries: 1-6 specific questions to research

=== CONTENT POLICY ===
The Specialist agent will enforce these rules, but plan accordingly:
- NO pricing information or "buy now" calls-to-action
- NO numeric review scores unless categorySlug is "reviews"
- NO speculation beyond what sources support
- NO release date promises unless officially confirmed

=== OUTPUT FORMAT ===
Return ONLY valid JSON matching ArticlePlanSchema. Structure:
{
  "title": "...",
  "categorySlug": "news|reviews|guides|lists",
  "excerpt": "...",
  "tags": ["...", "..."],
  "sections": [
    {
      "headline": "...",
      "goal": "...",
      "researchQueries": ["...", "..."]
    }
  ]
}

Design your article plan now:`,
    }),
    'Editor plan generation'
  );

  const plan: ArticlePlanInput = object;
  return {
    ...plan,
    categorySlug: normalizeArticleCategorySlug(plan.categorySlug),
  };
}

async function batchResearchForSections(
  plan: ArticlePlan,
  researchPool: ResearchPool
): Promise<ResearchPool> {
  // Collect ALL research queries from all sections
  const allQueries = plan.sections.flatMap(section => section.researchQueries);

  // Filter out queries that already exist in pool
  const newQueriesRaw = allQueries.filter(query => {
    const existing = findInResearchPool(researchPool, query);
    return !existing;
  });

  // De-duplicate remaining queries across sections (avoid redundant API calls)
  const newQueries = deduplicateQueries(newQueriesRaw);

  if (newQueries.length === 0) {
    logger.debug('All research queries already satisfied by Scout research');
    return researchPool;
  }

  const alreadySatisfiedCount = allQueries.length - newQueriesRaw.length;
  const duplicatesRemovedCount = newQueriesRaw.length - newQueries.length;
  logger.info(
    `Executing ${newQueries.length} new research queries ` +
      `(${alreadySatisfiedCount} already in pool` +
      (duplicatesRemovedCount > 0 ? `, ${duplicatesRemovedCount} duplicate(s) removed` : '') +
      `)`
  );

  // Execute new queries with rate limiting
  const newResults = await rateLimitedMap(
    newQueries,
    async (query) => {
      return executeSearch(query, 'section-specific', {
        searchDepth: GENERAL_CONFIG.SPECIALIST_SEARCH_DEPTH,
        maxResults: GENERAL_CONFIG.SPECIALIST_MAX_RESULTS,
      });
    }
  );

  // Add all new results to pool
  let updatedPool = researchPool;
  newResults.forEach(result => {
    updatedPool = addToResearchPool(updatedPool, result);
  });

  return updatedPool;
}

function extractResearchForSection(
  section: ArticleSectionPlan,
  researchPool: ResearchPool
): CategorizedSearchResult[] {
  const results: CategorizedSearchResult[] = [];

  for (const query of section.researchQueries) {
    const found = findInResearchPool(researchPool, query);
    if (found) {
      results.push(found);
    }
  }

  // Also include relevant Scout findings
  // Overview findings are always relevant
  results.push(...researchPool.scoutFindings.overview);

  return results;
}

async function runSpecialist(
  context: GameArticleContext,
  locale: SupportedLocale,
  scoutOutput: ScoutOutput,
  plan: ArticlePlan
): Promise<{ markdown: string; sources: string[]; researchPool: ResearchPool }> {
  const localeInstruction = locale === 'es' ? 'Write in Spanish.' : 'Write in English.';

  // Determine article tone and structure based on category
  const categoryToneGuide = {
    news: `Professional and objective reporting tone.
- Use inverted pyramid structure: most important information first
- Attribute all claims to sources ("according to developer", "announced on Twitter")
- State facts clearly without editorializing or personal opinion
- Use active voice and concise sentences
- Lead with what happened, when, and why it matters`,

    reviews: `Critical but balanced editorial voice.
- Support all opinions with specific examples from the game
- Provide balanced analysis: acknowledge both strengths and weaknesses
- Use concrete details, not vague praise ("tight controls" vs "feels good")
- Compare to similar games when relevant for context
- Make clear recommendations based on player preferences`,

    guides: `Instructional and helpful tone using second person ("you").
- Be specific with numbers, stats, and exact steps
- Use sequential language: "First," "Next," "Finally"
- Include precise details: "equip the Fire Sword, not the Ice Blade"
- Anticipate common mistakes and warn readers
- Organize information hierarchically: overview → details → advanced tips`,

    lists: `Engaging and comparative tone with consistent criteria.
- Justify each ranking or selection with clear reasoning
- Use consistent evaluation criteria across all items
- Provide context: "Best for beginners" vs "Best for endgame"
- Balance objective facts with subjective assessment
- End each entry with a clear takeaway or recommendation`,
  }[plan.categorySlug];

  // ===== BATCH RESEARCH PHASE =====
  // Execute ALL section research queries upfront, deduplicating against Scout research
  logger.info('Starting batch research for all sections...');
  const enrichedResearchPool = await batchResearchForSections(
    plan,
    scoutOutput.researchPool
  );

  // ===== SECTION WRITING PHASE =====
  let markdown = `# ${plan.title}\n\n`;
  let previousContext = '';

  for (let i = 0; i < plan.sections.length; i++) {
    const section = plan.sections[i];
    const isFirstSection = i === 0;
    const isLastSection = i === plan.sections.length - 1;

    // Extract relevant research from pool (NO NEW SEARCHES)
    const sectionResearch = extractResearchForSection(section, enrichedResearchPool);

    // Guard: Check if we have any meaningful research for this section
    const hasAnyResearch = sectionResearch.some(r => r.results.length > 0);
    if (!hasAnyResearch && !scoutOutput.briefing.overview) {
      logger.warn(`Section "${section.headline}" has no research and no Scout overview - quality may be compromised`);
    }

    // Build comprehensive research context for this section
    const researchContext = sectionResearch
      .map((research, idx) => {
        const topResults = research.results
          .slice(0, SPECIALIST_CONFIG.RESULTS_PER_RESEARCH_CONTEXT)
          .map(r => `  - ${r.title} (${r.url})\n    ${r.content.slice(0, SPECIALIST_CONFIG.RESEARCH_CONTEXT_PER_RESULT)}`)
          .join('\n');

        return `Research ${idx + 1} [${research.category}]: "${research.query}"
AI Summary: ${research.answer || '(none)'}
Results:
${topResults}`;
      })
      .join('\n\n---\n\n');

    // Calculate research content length for thin-research detection
    const researchContentLength = sectionResearch
      .flatMap(r => r.results)
      .reduce((sum, result) => sum + result.content.length, 0);

    const isThinResearch = researchContentLength < SPECIALIST_CONFIG.THIN_RESEARCH_THRESHOLD;

    // Write section using pooled research
    const { text } = await withRetry(
      () => generateText({
        model: openrouter(getModel('ARTICLE_SPECIALIST')),
        temperature: SPECIALIST_CONFIG.TEMPERATURE,
        maxOutputTokens: SPECIALIST_CONFIG.MAX_OUTPUT_TOKENS_PER_SECTION,
        system: `You are the Specialist agent — an expert gaming journalist who writes engaging, accurate, well-researched content.

Your mission: Transform research into compelling prose that informs and engages readers while maintaining strict factual integrity.

Core writing principles:
- EVIDENCE-BASED: Every claim must be grounded in the provided research
- READER-FIRST: Write for human readers, not search engines. Be engaging but never sensational.
- FLOW & CONTINUITY: Each section should connect naturally to the article's narrative arc
- VOICE CONSISTENCY: Maintain appropriate tone throughout (see category guide below)
- INTELLECTUAL HONESTY: Acknowledge uncertainty rather than fabricate details

${localeInstruction}

CATEGORY-SPECIFIC TONE:
${categoryToneGuide}`,
        prompt: `Write section ${i + 1} of ${plan.sections.length} for this article.

=== ARTICLE CONTEXT ===
Title: ${plan.title}
Category: ${plan.categorySlug}
Game: ${context.gameName}
Full Outline: ${plan.sections.map((s, idx) => `${idx + 1}. ${s.headline}`).join(', ')}

=== CURRENT SECTION ===
Headline: ${section.headline}
Internal Goal: ${section.goal}
Position: ${isFirstSection ? 'Opening section (set the stage, no preamble needed)' : isLastSection ? 'Closing section (provide satisfying conclusion)' : 'Middle section (develop key points)'}

=== COMPREHENSIVE RESEARCH CONTEXT ===
You have access to extensive research from Scout and section-specific searches.

Scout Overview:
${scoutOutput.briefing.overview.slice(0, SPECIALIST_CONFIG.MAX_SCOUT_OVERVIEW_LENGTH)}${scoutOutput.briefing.overview.length > SPECIALIST_CONFIG.MAX_SCOUT_OVERVIEW_LENGTH ? '\n...(truncated for brevity)' : ''}

${scoutOutput.briefing.categoryInsights ? `Category Insights:\n${scoutOutput.briefing.categoryInsights}\n\n` : ''}

Section-Specific Research:
${researchContext || '(Using Scout research only for this section)'}

=== CONTINUITY CONTEXT ===
${previousContext ? `Previous section's closing:\n${previousContext}\n\n→ Build natural transitions. Reference previous points when relevant.` : '(First section — establish strong opening)'}

=== WRITING GUIDELINES ===

${isThinResearch ? `⚠️ THIN RESEARCH WARNING ⚠️
This section has limited research content (${researchContentLength} characters).
- Write a concise ${SPECIALIST_CONFIG.MIN_PARAGRAPHS}-paragraph section
- Do NOT pad or speculate to fill space
- Focus on the most important verified facts only
- If there's not enough information, acknowledge it briefly

` : ''}Paragraph structure:
- ${isThinResearch ? SPECIALIST_CONFIG.MIN_PARAGRAPHS : SPECIALIST_CONFIG.MIN_PARAGRAPHS}-${SPECIALIST_CONFIG.MAX_PARAGRAPHS} paragraphs based on content depth
- Simple facts = ${SPECIALIST_CONFIG.MIN_PARAGRAPHS} paragraphs
- Analysis or mechanics = 3-4 paragraphs
- Complex systems = ${SPECIALIST_CONFIG.MAX_PARAGRAPHS} paragraphs
- Each paragraph should develop ONE clear idea

Handling uncertain information:
- If research is sparse → Acknowledge gaps: "Details remain limited..."
- If sources conflict → Present both views: "While some reports suggest X, others indicate Y..."
- If speculation is needed → Frame carefully: "Based on early previews..." or "According to developer interviews..."
- Never invent: player counts, sales figures, release dates, technical specs, or review scores

Markdown formatting:
- Use **bold** for key game mechanics, features, or important terms (sparingly)
- Use natural language, not listicles (unless category is "lists")
- No code blocks, no tables (unless absolutely essential for guides)
- Write flowing prose, not bullet points

Transitions & flow:
${isFirstSection ? '- Open strong: Hook the reader with the most compelling aspect\n- No meta-commentary ("In this article..." or "Let\'s explore...")' : '- Connect to previous section theme when relevant\n- Use transitional phrases: "Building on this foundation...", "In contrast to...", "This ties directly to..."'}
${isLastSection ? '- Provide closure without being formulaic\n- Avoid clichés like "In conclusion..." or "Overall..."' : '- End with a natural bridge to the next topic'}

Content restrictions (STRICT):
✗ NO pricing, purchase links, or "buy now" language
✗ NO numeric review scores unless categorySlug === "reviews"
✗ NO marketing superlatives ("revolutionary", "game-changing") unless directly quoted from sources
✗ NO fabricated statistics, dates, or technical specifications
✗ NO personal opinions framed as facts ("players will love..." → "early impressions suggest...")

=== OUTPUT FORMAT ===
Write ONLY the markdown prose for this section.
- Do NOT include the section heading (system adds it)
- Do NOT wrap in code fences
- Do NOT add meta-commentary
- Output plain markdown paragraphs, ready to publish

Write the section now:`,
      }),
      `Specialist section ${i + 1}: ${section.headline}`
    );

    const sectionText = text.trim();
    markdown += `## ${section.headline}\n\n${sectionText}\n\n`;
    previousContext = sectionText.slice(-SPECIALIST_CONFIG.CONTEXT_TAIL_LENGTH);
  }

  // Collect all sources from research pool
  const allSources = Array.from(enrichedResearchPool.allUrls);
  const finalUrls = ensureUniqueStrings(allSources, GENERAL_CONFIG.MAX_SOURCES);
  markdown += formatSources(finalUrls);

  return {
    markdown: markdown.trim() + '\n',
    sources: finalUrls,
    researchPool: enrichedResearchPool,
  };
}

interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
}

function validateArticleDraft(draft: Omit<GameArticleDraft, 'models'>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const contentMarkdown = stripSourcesSection(draft.markdown);

  // Validate excerpt length
  if (draft.excerpt.length < 120) {
    issues.push({
      severity: 'error',
      message: `Excerpt too short: ${draft.excerpt.length} characters (minimum 120)`,
    });
  }
  if (draft.excerpt.length > 160) {
    issues.push({
      severity: 'error',
      message: `Excerpt too long: ${draft.excerpt.length} characters (maximum 160)`,
    });
  }

  // Validate title
  if (!draft.title || draft.title.length < 10) {
    issues.push({
      severity: 'error',
      message: 'Title is too short or missing',
    });
  }
  if (draft.title.length > 100) {
    issues.push({
      severity: 'warning',
      message: `Title is quite long: ${draft.title.length} characters (recommended: 50-70)`,
    });
  }

  // Validate markdown structure
  const sectionCount = countContentH2Sections(draft.markdown);
  if (sectionCount < 3) {
    issues.push({
      severity: 'warning',
      message: `Only ${sectionCount} sections found (recommended: 4-8)`,
    });
  }

  // Check for empty sections
  const sections = getContentH2Sections(draft.markdown);
  sections.forEach((section, idx) => {
    const content = section.content.trim();
    if (content.length < 100) {
      issues.push({
        severity: 'warning',
        message: `Section ${idx + 1} appears very short (${content.length} characters)`,
      });
    }
  });

  // Validate sources
  if (draft.sources.length === 0) {
    issues.push({
      severity: 'warning',
      message: 'No sources were collected',
    });
  }

  // Check for invalid URLs in sources
  draft.sources.forEach((url, idx) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        issues.push({
          severity: 'error',
          message: `Invalid source URL scheme at index ${idx}: ${url}`,
        });
      }
    } catch {
      issues.push({
        severity: 'error',
        message: `Invalid source URL at index ${idx}: ${url}`,
      });
    }
  });

  // Validate tags
  if (draft.tags.length === 0) {
    issues.push({
      severity: 'warning',
      message: 'No tags were generated',
    });
  }
  if (draft.tags.length > 10) {
    issues.push({
      severity: 'error',
      message: `Too many tags: ${draft.tags.length} (maximum 10)`,
    });
  }

  // Check for common quality issues in markdown
  if (contentMarkdown.includes('```')) {
    issues.push({
      severity: 'warning',
      message: 'Article contains code fences (usually undesirable for prose)',
    });
  }

  if (contentMarkdown.match(/\$\d+/)) {
    issues.push({
      severity: 'warning',
      message: 'Article contains pricing information or currency figures (verify policy compliance)',
    });
  }

  // Check for placeholder text
  const placeholders = ['TODO', 'TBD', 'PLACEHOLDER', 'FIXME', '[INSERT', 'XXX'];
  placeholders.forEach((placeholder) => {
    // Use a boundary-ish regex to reduce false positives (e.g., URLs).
    const re = new RegExp(`\\b${placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(contentMarkdown)) {
      issues.push({
        severity: 'error',
        message: `Article contains placeholder text: ${placeholder}`,
      });
    }
  });

  // Check for AI-isms and clichés (warnings, not errors)
  const aiCliches = [
    { phrase: 'in conclusion', context: 'conclusion cliché' },
    { phrase: "let's dive into", context: 'conversational filler' },
    { phrase: 'without further ado', context: 'unnecessary preamble' },
    { phrase: "it's worth noting", context: 'hedging phrase' },
    { phrase: 'game-changing', context: 'marketing hyperbole' },
    { phrase: 'truly revolutionary', context: 'marketing hyperbole' },
    { phrase: 'seamlessly', context: 'overused modifier' },
    { phrase: 'unparalleled', context: 'marketing hyperbole' },
    { phrase: 'delve into', context: 'academic formality' },
    { phrase: 'utilize', context: 'unnecessarily formal (use "use")' },
    { phrase: 'at the end of the day', context: 'filler phrase' },
    { phrase: 'needless to say', context: 'redundant phrase' },
  ];

  const lowercaseMarkdown = contentMarkdown.toLowerCase();
  const foundCliches: string[] = [];

  aiCliches.forEach(({ phrase, context }) => {
    if (lowercaseMarkdown.includes(phrase)) {
      foundCliches.push(`"${phrase}" (${context})`);
    }
  });

  if (foundCliches.length > 0) {
    issues.push({
      severity: 'warning',
      message: `Article contains ${foundCliches.length} AI cliché(s): ${foundCliches.join(', ')}`,
    });
  }

  // Check for repetitive sentence starts (AI tends to repeat patterns)
  const sentences = contentMarkdown
    .split(/[.!?]+/)
    .map(s => s.trim().split(/\s+/)[0]?.toLowerCase())
    .filter((word): word is string => Boolean(word && word.length > 2));

  const startCounts = new Map<string, number>();
  sentences.forEach(start => {
    startCounts.set(start, (startCounts.get(start) || 0) + 1);
  });

  // Common articles and conjunctions are expected to repeat
  const allowedRepeats = new Set(['the', 'a', 'an', 'this', 'that', 'it', 'and', 'but', 'or', 'if', 'as', 'in', 'on', 'for', 'to', 'with']);
  const repetitiveStarts: string[] = [];

  startCounts.forEach((count, word) => {
    if (count > 6 && !allowedRepeats.has(word)) {
      repetitiveStarts.push(`"${word}" (${count}x)`);
    }
  });

  if (repetitiveStarts.length > 0) {
    issues.push({
      severity: 'warning',
      message: `Repetitive sentence starts detected: ${repetitiveStarts.join(', ')}`,
    });
  }

  return issues;
}

function validateGameArticleContext(context: GameArticleContext): void {
  if (!context.gameName?.trim()) {
    throw new Error('GameArticleContext.gameName is required and cannot be empty');
  }

  if (context.genres && !Array.isArray(context.genres)) {
    throw new Error('GameArticleContext.genres must be an array');
  }

  if (context.platforms && !Array.isArray(context.platforms)) {
    throw new Error('GameArticleContext.platforms must be an array');
  }

  if (context.categoryHints) {
    if (!Array.isArray(context.categoryHints)) {
      throw new Error('GameArticleContext.categoryHints must be an array');
    }
    for (const hint of context.categoryHints) {
      if (!hint.slug) {
        throw new Error('Each categoryHint must have a slug');
      }
    }
  }
}

export async function generateGameArticleDraft(
  context: GameArticleContext,
  locale: SupportedLocale
): Promise<GameArticleDraft> {
  // Validate environment
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  // Validate input context
  validateGameArticleContext(context);

  const scoutModel = getModel('ARTICLE_SCOUT');
  const editorModel = getModel('ARTICLE_EDITOR');
  const specialistModel = getModel('ARTICLE_SPECIALIST');

  const totalStartTime = Date.now();
  logger.info(`=== Starting Multi-Agent Article Generation for "${context.gameName}" ===`);

  // ===== PHASE 1: SCOUT (Deep Research) =====
  const scoutStartTime = Date.now();
  logger.info('Phase 1: Scout - Deep multi-query research...');
  const scoutOutput = await runScout(context, locale);
  logger.info(`Scout complete in ${Date.now() - scoutStartTime}ms: ${scoutOutput.researchPool.allUrls.size} sources, ${scoutOutput.researchPool.queryCache.size} unique queries`);

  // ===== PHASE 2: EDITOR (Strategic Planning with Research Context) =====
  const editorStartTime = Date.now();
  logger.info('Phase 2: Editor - Planning article with full research context...');
  const plan = await runEditor(context, locale, scoutOutput);
  logger.info(`Editor complete in ${Date.now() - editorStartTime}ms: ${plan.categorySlug} article with ${plan.sections.length} sections`);

  // ===== PHASE 3: SPECIALIST (Batch Research + Writing) =====
  const specialistStartTime = Date.now();
  logger.info('Phase 3: Specialist - Batch research + section writing...');
  const { markdown, sources, researchPool: finalResearchPool } = await runSpecialist(
    context,
    locale,
    scoutOutput,
    plan
  );
  logger.info(
    `Specialist complete in ${Date.now() - specialistStartTime}ms: ` +
    `${countContentH2Sections(markdown)} sections written, ${sources.length} total sources`
  );

  const draft = {
    title: plan.title,
    categorySlug: plan.categorySlug,
    excerpt: plan.excerpt,
    tags: plan.tags,
    markdown,
    sources,
    plan,
  };

  // ===== PHASE 4: VALIDATION =====
  logger.info('Phase 4: Validating generated content...');
  const validationIssues = validateArticleDraft(draft);

  // Log validation issues (errors will throw, warnings will just log)
  const errors = validationIssues.filter((i) => i.severity === 'error');
  const warnings = validationIssues.filter((i) => i.severity === 'warning');

  if (warnings.length > 0) {
    logger.warn(`Article validation warnings: ${warnings.map((w) => w.message).join('; ')}`);
  }

  if (errors.length > 0) {
    logger.error(`Article validation errors: ${errors.map((e) => e.message).join('; ')}`);
    throw new Error(`Article validation failed: ${errors.map((e) => e.message).join('; ')}`);
  }

  logger.info(`=== Article Generation Complete in ${Date.now() - totalStartTime}ms ===`);
  logger.info(`Final research pool: ${finalResearchPool.queryCache.size} total queries, ${finalResearchPool.allUrls.size} unique sources`);

  return {
    ...draft,
    models: {
      scout: scoutModel,
      editor: editorModel,
      specialist: specialistModel,
    },
  };
}
