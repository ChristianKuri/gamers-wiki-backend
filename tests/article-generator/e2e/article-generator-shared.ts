/**
 * Shared utilities for Article Generator E2E Tests
 *
 * Contains common infrastructure, validation constants, and helper functions
 * used across all article generator E2E test files.
 */

import type { Knex } from 'knex';
import { readFileSync } from 'node:fs';

import { isStrapiRunning, createDbConnection, E2E_CONFIG } from '../../game-fetcher/e2e/setup';
import {
  saveTestResult,
  logValidationSummary,
  type E2ETestResult,
  type ValidationIssue,
  type ReviewerIssue,
  type GenerationStats,
  type ArticleAnalysis,
  type ArticlePlanAnalysis,
  type DatabaseVerification,
  type GameInfo,
} from './save-results';

// Re-export for convenience
export {
  isStrapiRunning,
  createDbConnection,
  E2E_CONFIG,
  saveTestResult,
  logValidationSummary,
  type E2ETestResult,
  type ValidationIssue,
  type ReviewerIssue,
  type GenerationStats,
  type ArticleAnalysis,
  type ArticlePlanAnalysis,
  type DatabaseVerification,
  type GameInfo,
};

// ============================================================================
// Test Configuration Types
// ============================================================================

/** Configuration for a specific game E2E test */
export interface GameTestConfig {
  /** IGDB ID of the game */
  readonly igdbId: number;
  /** Human-readable game name (for logs/results) */
  readonly gameName: string;
  /** Short identifier for filenames (e.g., 'zelda', 'bg3', 'eldenring') */
  readonly gameSlug: string;
  /** Test instruction for the article generator */
  readonly instruction: string;
  /** Category slug for the article */
  readonly categorySlug: 'news' | 'reviews' | 'guides' | 'lists';
  /** Expected name substring to verify game import */
  readonly expectedNameContains: string;
}

// ============================================================================
// Validation Constants (mirrored from src/ai/articles/config.ts)
// ============================================================================

export const ARTICLE_PLAN_CONSTRAINTS = {
  TITLE_MIN_LENGTH: 10,
  TITLE_MAX_LENGTH: 100,
  TITLE_RECOMMENDED_MAX_LENGTH: 70,
  EXCERPT_MIN_LENGTH: 120,
  EXCERPT_RECOMMENDED_MAX_LENGTH: 160, // Ideal for SEO
  EXCERPT_MAX_LENGTH: 200, // Hard cap - allows flexibility
  MIN_SECTIONS: 3,
  MAX_SECTIONS: 12,
  MIN_SECTION_LENGTH: 100,
  MIN_TAGS: 1,
  MAX_TAGS: 10,
  TAG_MAX_LENGTH: 50,
  MIN_MARKDOWN_LENGTH: 500,
} as const;

export const PLACEHOLDER_PATTERNS = ['TODO', 'TBD', 'PLACEHOLDER', 'FIXME', '[INSERT', 'XXX'];

export const AI_CLICHE_PHRASES = [
  'dive into',
  'delve into',
  'game-changer',
  'embark on',
  'ever-evolving',
  'cutting-edge',
  'seamlessly',
  'leverage',
  'masterclass',
  'unleash',
  'groundbreaking',
  'revolutionize',
  'journey',
  'adventure awaits',
];

export const VALID_CATEGORY_SLUGS = ['news', 'reviews', 'guides', 'lists'] as const;
export const VALID_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

// ============================================================================
// Test Infrastructure
// ============================================================================

/**
 * Fetch with extended timeouts for long-running AI operations.
 */
export async function fetchWithExtendedTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const { Agent, fetch: undiciFetch } = await import('undici');
  const timeoutMs = options.timeoutMs ?? 900000;

  const agent = new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    connectTimeout: 30000,
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
    pipelining: 0,
  });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await undiciFetch(url, {
      ...options,
      dispatcher: agent,
    } as any)) as unknown as Response;
  } finally {
    await agent.close();
  }
}

export function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function getFromDotEnvFile(name: string): string | undefined {
  try {
    const contents = readFileSync('.env', 'utf8');
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      if (key !== name) continue;
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
  } catch {
    // Ignore missing .env
  }
  return undefined;
}

export async function tableExists(knex: Knex, tableName: string): Promise<boolean> {
  const row = await knex('information_schema.tables')
    .select('table_name')
    .where({ table_schema: 'public', table_name: tableName })
    .first();
  return Boolean(row);
}

export async function safeDeleteAll(knex: Knex, tableName: string): Promise<void> {
  if (!(await tableExists(knex, tableName))) return;
  await knex(tableName).del();
}

export async function getTableColumns(knex: Knex, tableName: string): Promise<Set<string>> {
  const rows = await knex('information_schema.columns')
    .select('column_name')
    .where({ table_schema: 'public', table_name: tableName });
  return new Set(rows.map((r: { column_name: string }) => r.column_name));
}

export async function findPostGameLinkTable(knex: Knex): Promise<string | null> {
  const candidates = ['posts_games_lnk', 'games_posts_lnk'];
  for (const t of candidates) {
    if (await tableExists(knex, t)) return t;
  }
  return null;
}

// ============================================================================
// Result Builders - Extract data from API response
// ============================================================================

export function extractGameInfo(json: any): GameInfo {
  return {
    documentId: json?.game?.documentId ?? '',
    name: json?.game?.name ?? '',
    slug: json?.game?.slug,
  };
}

/**
 * Group sources by query to reduce JSON repetition.
 */
function groupSourcesByQuery(sources: any[]): any[] {
  const groups = new Map<string, any>();
  
  for (const source of sources) {
    const key = `${source.query}|${source.phase}|${source.searchSource ?? 'unknown'}|${source.section ?? ''}`;
    
    if (!groups.has(key)) {
      groups.set(key, {
        query: source.query,
        phase: source.phase,
        searchSource: source.searchSource,
        contentType: source.contentType ?? 'full',
        ...(source.section ? { section: source.section } : {}),
        sources: [],
      });
    }
    
    // Get cleaned char count from various possible field names
    const cleanedCharCount = source.cleanedContentLength ?? source.cleanedCharCount ?? 
      (source.cleanedContent?.length);
    
    groups.get(key).sources.push({
      url: source.url,
      title: source.title,
      ...(source.qualityScore !== undefined ? { qualityScore: source.qualityScore } : {}),
      ...(source.relevanceScore !== undefined ? { relevanceScore: source.relevanceScore } : {}),
      ...(cleanedCharCount !== undefined ? { cleanedCharCount } : {}),
    });
  }
  
  return Array.from(groups.values());
}

/**
 * Group filtered sources by query to reduce JSON repetition.
 */
function groupFilteredSourcesByQuery(sources: any[]): any[] {
  const groups = new Map<string, any>();
  
  for (const source of sources) {
    const key = `${source.query ?? 'unknown'}|${source.searchSource ?? 'unknown'}`;
    
    if (!groups.has(key)) {
      groups.set(key, {
        query: source.query ?? 'unknown',
        searchSource: source.searchSource,
        sources: [],
      });
    }
    
    // Get cleaned char count from various possible field names
    const cleanedCharCount = source.cleanedContentLength ?? source.cleanedCharCount ?? 
      (source.cleanedContent?.length);
    
    groups.get(key).sources.push({
      url: source.url,
      domain: source.domain,
      title: source.title,
      qualityScore: source.qualityScore,
      relevanceScore: source.relevanceScore,
      reason: source.reason,
      details: source.details,
      ...(source.filterStage ? { filterStage: source.filterStage } : {}),
      ...(cleanedCharCount !== undefined ? { cleanedCharCount } : {}),
    });
  }
  
  return Array.from(groups.values());
}

export function extractGenerationStats(json: any): GenerationStats {
  const metadata = json?.draft?.metadata ?? {};
  const tokenUsage = metadata.tokenUsage ?? {};
  const searchApiCosts = metadata.searchApiCosts;
  const rawSourceContentUsage = metadata.sourceContentUsage;
  const rawFilteredSources = metadata.filteredSources;

  // Group source content usage by query (directly as array)
  const sourceContentUsage = rawSourceContentUsage?.sources?.length > 0
    ? groupSourcesByQuery(rawSourceContentUsage.sources)
    : undefined;

  // Group filtered sources by query (directly as array)
  const filteredSourcesStats = rawFilteredSources && rawFilteredSources.length > 0
    ? groupFilteredSourcesByQuery(rawFilteredSources)
    : undefined;

  return {
    success: json?.success ?? false,
    correlationId: metadata.correlationId ?? '',
    timing: {
      totalMs: metadata.totalDurationMs ?? 0,
      byPhase: metadata.phaseDurations ?? {
        scout: 0,
        editor: 0,
        specialist: 0,
        reviewer: 0,
        validation: 0,
      },
    },
    tokens: {
      byPhase: {
        // Include actualCostUsd from each phase if available
        scout: tokenUsage.scout ?? { input: 0, output: 0 },
        editor: tokenUsage.editor ?? { input: 0, output: 0 },
        specialist: tokenUsage.specialist ?? { input: 0, output: 0 },
        ...(tokenUsage.reviewer ? { reviewer: tokenUsage.reviewer } : {}),
        // Cleaner is tracked separately for cost visibility
        ...(tokenUsage.cleaner ? { cleaner: tokenUsage.cleaner } : {}),
      },
      total: tokenUsage.total ?? { input: 0, output: 0 },
      // Use actualCostUsd if available, fall back to estimatedCostUsd for backwards compatibility
      estimatedCostUsd: tokenUsage.actualCostUsd ?? tokenUsage.estimatedCostUsd ?? 0,
    },
    models: json?.models ?? {},
    research: {
      queriesExecuted: metadata.queriesExecuted ?? 0,
      sourcesCollected: metadata.sourcesCollected ?? 0,
      confidence: metadata.researchConfidence ?? 'medium',
    },
    // Include search API costs if available
    ...(searchApiCosts ? { searchCosts: searchApiCosts } : {}),
    // Include total cost (LLM + Search APIs) if available
    ...(metadata.totalEstimatedCostUsd !== undefined ? { totalCostUsd: metadata.totalEstimatedCostUsd } : {}),
    // Include source content usage tracking if available
    ...(sourceContentUsage ? { sourceContentUsage } : {}),
    // Include filtered sources tracking if available
    ...(filteredSourcesStats ? { filteredSources: filteredSourcesStats } : {}),
  };
}

export function analyzeMarkdownContent(markdown: string): {
  wordCount: number;
  paragraphCount: number;
  sections: { total: number; content: number; hasSourcesSection: boolean; headlines: string[] };
  lists: { bulletItems: number; numberedItems: number; total: number };
  linkCount: number;
} {
  const h2Matches: string[] = markdown.match(/^## .+$/gm) ?? [];
  const contentSections = h2Matches.filter((h) => !h.toLowerCase().includes('sources'));
  const hasSourcesSection = h2Matches.some((h) => h.toLowerCase().includes('sources'));

  const wordCount = markdown.split(/\s+/).filter((w) => w.length > 0).length;
  const paragraphCount = markdown.split(/\n\n+/).filter((p) => p.trim().length > 0).length;
  const bulletItems = (markdown.match(/^[-*] .+$/gm) || []).length;
  const numberedItems = (markdown.match(/^\d+\. .+$/gm) || []).length;
  const linkCount = (markdown.match(/\[.+?\]\([^)]+\)/g) || []).length;

  return {
    wordCount,
    paragraphCount,
    sections: {
      total: h2Matches.length,
      content: contentSections.length,
      hasSourcesSection,
      headlines: contentSections.map((h) => h.replace(/^## /, '')),
    },
    lists: {
      bulletItems,
      numberedItems,
      total: bulletItems + numberedItems,
    },
    linkCount,
  };
}

export function analyzeSources(sources: string[]): {
  count: number;
  uniqueDomains: number;
  topDomains: string[];
  domainBreakdown: Record<string, number>;
  urls: string[];
} {
  const domainCounts: Record<string, number> = {};

  for (const source of sources) {
    try {
      const url = new URL(source);
      const domain = url.hostname.replace(/^www\./, '');
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    } catch {
      // Invalid URL, skip
    }
  }

  const sortedDomains = Object.keys(domainCounts).sort((a, b) => domainCounts[b] - domainCounts[a]);

  return {
    count: sources.length,
    uniqueDomains: sortedDomains.length,
    topDomains: sortedDomains.slice(0, 10),
    domainBreakdown: domainCounts,
    urls: sources,
  };
}

export function extractArticleAnalysis(json: any): ArticleAnalysis {
  const draft = json?.draft ?? {};
  const post = json?.post ?? {};
  const markdown = draft.markdown ?? '';
  const sources = draft.sources ?? [];

  const C = ARTICLE_PLAN_CONSTRAINTS;
  const contentStats = analyzeMarkdownContent(markdown);

  return {
    post: {
      documentId: post.documentId ?? '',
      locale: post.locale ?? 'en',
      published: post.publishedAt !== null && post.publishedAt !== undefined,
    },
    title: {
      value: draft.title ?? '',
      length: (draft.title ?? '').length,
      withinRecommended: (draft.title ?? '').length <= C.TITLE_RECOMMENDED_MAX_LENGTH,
    },
    excerpt: {
      value: draft.excerpt ?? '',
      length: (draft.excerpt ?? '').length,
      withinLimits:
        (draft.excerpt ?? '').length >= C.EXCERPT_MIN_LENGTH &&
        (draft.excerpt ?? '').length <= C.EXCERPT_MAX_LENGTH,
    },
    categorySlug: draft.categorySlug ?? '',
    tags: draft.tags ?? [],
    content: {
      markdownLength: markdown.length,
      ...contentStats,
    },
    sources: analyzeSources(sources),
  };
}

export function extractPlanAnalysis(json: any): ArticlePlanAnalysis {
  const plan = json?.draft?.plan ?? {};
  const sections = plan.sections ?? [];

  return {
    title: plan.title ?? '',
    categorySlug: plan.categorySlug ?? '',
    sectionCount: sections.length,
    sections: sections.map((s: any) => ({
      headline: s.headline ?? '',
      goal: s.goal ?? '',
      researchQueries: s.researchQueries ?? [],
      mustCover: s.mustCover ?? [],
    })),
    requiredElements: plan.requiredElements ?? [],
    totalResearchQueries: sections.reduce(
      (sum: number, s: any) => sum + (s.researchQueries?.length ?? 0),
      0
    ),
  };
}

export function analyzeAiCliches(markdown: string): {
  found: string[];
  totalOccurrences: number;
} {
  const lowercaseMarkdown = markdown.toLowerCase();
  const found = AI_CLICHE_PHRASES.filter((phrase) => lowercaseMarkdown.includes(phrase));

  let totalOccurrences = 0;
  for (const phrase of found) {
    const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = markdown.match(regex);
    totalOccurrences += matches ? matches.length : 0;
  }

  return { found, totalOccurrences };
}

export function findPlaceholders(markdown: string): string[] {
  const found: string[] = [];
  for (const placeholder of PLACEHOLDER_PATTERNS) {
    const re = new RegExp(`\\b${placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(markdown)) {
      found.push(placeholder);
    }
  }
  return found;
}

// ============================================================================
// Test State Types
// ============================================================================

/** Mutable version of DatabaseVerification for test state */
export interface MutableDatabaseVerification {
  post: {
    exists: boolean;
    linkedToGame: boolean;
  };
  game: {
    exists: boolean;
    hasDescription: boolean;
  };
}

/** Shared state for E2E tests */
export interface TestState {
  knex: Knex | undefined;
  strapiReady: boolean;
  response: Response | undefined;
  json: any;
  testStartTime: number;
  validationIssues: ValidationIssue[];
  gameInfo: GameInfo | undefined;
  generationStats: GenerationStats | undefined;
  articleAnalysis: ArticleAnalysis | undefined;
  planAnalysis: ArticlePlanAnalysis | undefined;
  qualityChecks: { placeholders: string[]; cliches: { found: string[]; total: number } };
  reviewerData: {
    ran: boolean;
    approved: boolean | null;
    issues: ReviewerIssue[];
    initialIssues?: ReviewerIssue[];
  };
  recoveryData: {
    applied: boolean;
    planRetries: number;
    fixerIterations: number;
    fixesAttempted: number;
    fixesSuccessful: number;
  };
  dbVerification: MutableDatabaseVerification;
}

/** Create initial test state */
export function createInitialTestState(): TestState {
  return {
    knex: undefined,
    strapiReady: false,
    response: undefined,
    json: undefined,
    testStartTime: 0,
    validationIssues: [],
    gameInfo: undefined,
    generationStats: undefined,
    articleAnalysis: undefined,
    planAnalysis: undefined,
    qualityChecks: {
      placeholders: [],
      cliches: { found: [], total: 0 },
    },
    reviewerData: {
      ran: false,
      approved: null,
      issues: [],
      initialIssues: undefined,
    },
    recoveryData: {
      applied: false,
      planRetries: 0,
      fixerIterations: 0,
      fixesAttempted: 0,
      fixesSuccessful: 0,
    },
    dbVerification: {
      post: { exists: false, linkedToGame: false },
      game: { exists: false, hasDescription: false },
    },
  };
}

// ============================================================================
// Setup and Teardown Helpers
// ============================================================================

/**
 * Setup function for E2E tests - validates prerequisites and calls the endpoint
 */
export async function setupArticleGeneratorTest(
  state: TestState,
  config: GameTestConfig
): Promise<void> {
  state.testStartTime = Date.now();
  const secret = process.env.AI_GENERATION_SECRET || getFromDotEnvFile('AI_GENERATION_SECRET');

  console.log(`[E2E Setup] Step 1/5: Checking Strapi availability...`);
  state.strapiReady = await isStrapiRunning();

  if (!state.strapiReady) {
    console.warn(
      `\n⚠️  Strapi is not running at ${E2E_CONFIG.strapiUrl}\nTo run E2E tests, use: npm run test:e2e:run\n`
    );
    return;
  }
  console.log('[E2E Setup] ✓ Strapi is running');

  console.log('[E2E Setup] Step 2/5: Validating IGDB configuration...');
  try {
    const igdbStatus = await fetch(`${E2E_CONFIG.strapiUrl}/api/game-fetcher/status`);
    if (!igdbStatus.ok) {
      console.warn('[E2E Setup] ⚠️ IGDB status endpoint not available');
      state.strapiReady = false;
      return;
    }
    const igdbJson = (await igdbStatus.json()) as { configured?: boolean };
    if (!igdbJson.configured) {
      console.warn('[E2E Setup] ⚠️ IGDB not configured');
      state.strapiReady = false;
      return;
    }
    console.log('[E2E Setup] ✓ IGDB is configured');
  } catch (error) {
    console.warn('[E2E Setup] ⚠️ Failed to check IGDB status:', error);
    state.strapiReady = false;
    return;
  }

  console.log('[E2E Setup] Step 3/5: Validating AI/OpenRouter configuration...');
  try {
    const aiStatus = await fetch(`${E2E_CONFIG.strapiUrl}/api/game-fetcher/ai-status`);
    if (!aiStatus.ok) {
      console.warn('[E2E Setup] ⚠️ AI status endpoint not available');
      state.strapiReady = false;
      return;
    }
    const aiJson = (await aiStatus.json()) as { configured?: boolean };
    if (!aiJson.configured) {
      console.warn('[E2E Setup] ⚠️ OpenRouter AI not configured');
      state.strapiReady = false;
      return;
    }
    console.log('[E2E Setup] ✓ AI/OpenRouter is configured');
  } catch (error) {
    console.warn('[E2E Setup] ⚠️ Failed to check AI status:', error);
    state.strapiReady = false;
    return;
  }

  console.log('[E2E Setup] Step 4/5: Cleaning posts...');
  state.knex = await createDbConnection();
  const linkTable = await findPostGameLinkTable(state.knex);
  if (linkTable) {
    await safeDeleteAll(state.knex, linkTable);
  }
  await safeDeleteAll(state.knex, 'posts');
  console.log('[E2E Setup] ✓ Posts cleaned');

  console.log('[E2E Setup] Step 5/5: Calling article generator endpoint...');
  console.log(`[E2E Setup] IGDB ID: ${config.igdbId} (${config.gameName})`);
  const headerSecret = secret || mustGetEnv('AI_GENERATION_SECRET');

  state.response = await fetchWithExtendedTimeout(
    `${E2E_CONFIG.strapiUrl}/api/article-generator/generate`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ai-generation-secret': headerSecret,
      },
      body: JSON.stringify({
        igdbId: config.igdbId,
        instruction: config.instruction,
        publish: false,
        categorySlug: config.categorySlug,
      }),
      timeoutMs: 900000,
    }
  );

  const responseText = await state.response.text();
  try {
    state.json = JSON.parse(responseText);
  } catch {
    state.json = { raw: responseText, parseError: true };
  }

  const duration = ((Date.now() - state.testStartTime) / 1000).toFixed(1);
  console.log(`[E2E Setup] ✓ Endpoint called in ${duration}s`);
  console.log(`[E2E Setup] Response status: ${state.response.status}`);
  console.log(`[E2E Setup] Success: ${state.json?.success}`);

  // Pre-extract data for result building
  if (state.json && !state.json.parseError) {
    state.gameInfo = extractGameInfo(state.json);
    state.generationStats = extractGenerationStats(state.json);
    state.articleAnalysis = extractArticleAnalysis(state.json);
    state.planAnalysis = extractPlanAnalysis(state.json);

    // Extract reviewer data
    const hasReviewerData =
      typeof state.json.reviewerApproved === 'boolean' || Array.isArray(state.json.reviewerIssues);
    if (hasReviewerData) {
      state.reviewerData = {
        ran: true,
        approved: state.json.reviewerApproved ?? null,
        issues: state.json.reviewerIssues ?? [],
        initialIssues: state.json.reviewerInitialIssues ?? undefined,
      };
    }

    // Extract recovery data
    const recovery = state.json.draft?.metadata?.recovery;
    if (recovery) {
      state.recoveryData = {
        applied: true,
        planRetries: recovery.planRetries ?? 0,
        fixerIterations: recovery.fixerIterations ?? 0,
        fixesAttempted: recovery.fixesApplied?.length ?? 0,
        fixesSuccessful: recovery.fixesApplied?.filter((f: any) => f.success).length ?? 0,
      };
    }
  }
}

/**
 * Teardown function for E2E tests - saves results and closes connections
 */
export async function teardownArticleGeneratorTest(
  state: TestState,
  config: GameTestConfig
): Promise<void> {
  if (state.validationIssues.length > 0) {
    logValidationSummary(state.validationIssues);
  }

  // Build and save final result
  if (
    state.json &&
    state.testStartTime &&
    state.gameInfo &&
    state.generationStats &&
    state.articleAnalysis &&
    state.planAnalysis
  ) {
    const errors = state.validationIssues.filter((i) => i.severity === 'error');
    const reviewerBySeverity = {
      critical: state.reviewerData.issues.filter((i) => i.severity === 'critical').length,
      major: state.reviewerData.issues.filter((i) => i.severity === 'major').length,
      minor: state.reviewerData.issues.filter((i) => i.severity === 'minor').length,
    };

    const result: E2ETestResult = {
      metadata: {
        testName: `guide-${config.gameSlug}`,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - state.testStartTime,
        passed: errors.length === 0,
      },
      input: {
        igdbId: config.igdbId,
        instruction: config.instruction,
        publish: false,
      },
      game: state.gameInfo,
      generation: state.generationStats,
      article: state.articleAnalysis,
      plan: state.planAnalysis,
      quality: {
        passed: errors.length === 0,
        issues: state.validationIssues,
        reviewer: {
          ran: state.reviewerData.ran,
          approved: state.reviewerData.approved,
          issues: state.reviewerData.issues,
          ...(state.reviewerData.initialIssues &&
            state.reviewerData.initialIssues.length !== state.reviewerData.issues.length && {
              initialIssues: state.reviewerData.initialIssues,
              issuesFixed: state.reviewerData.initialIssues.length - state.reviewerData.issues.length,
            }),
          bySeverity: reviewerBySeverity,
        },
        recovery: state.recoveryData,
        checks: {
          placeholders: {
            passed: state.qualityChecks.placeholders.length === 0,
            found: state.qualityChecks.placeholders,
          },
          aiCliches: {
            passed: state.qualityChecks.cliches.found.length < 5,
            found: state.qualityChecks.cliches.found,
            totalOccurrences: state.qualityChecks.cliches.total,
          },
        },
      },
      database: state.dbVerification,
      rawContent: {
        markdown: state.json?.draft?.markdown ?? '',
      },
    };

    const savedPath = saveTestResult(result);
    console.log(`\n📄 Test results saved to: ${savedPath}`);
  }

  if (state.knex) {
    await state.knex.destroy();
  }
}
