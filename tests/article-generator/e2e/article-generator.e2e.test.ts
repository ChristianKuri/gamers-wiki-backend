/**
 * Article Generator E2E Test
 *
 * E2E Test Pattern: Clean → Call Endpoint → Validate
 *
 * This test suite:
 * 1. Cleans relevant data in beforeAll
 * 2. Calls the article generator endpoint ONCE
 * 3. Uses multiple focused tests to validate the response
 *
 * Each test validates a specific aspect of the generated article.
 * Tests share the response data - no cleanup between tests.
 *
 * REQUIREMENTS:
 * - Strapi must be running (use npm run test:e2e:run)
 * - PostgreSQL test database must be available
 * - OPENROUTER_API_KEY must be configured (real calls)
 * - AI_GENERATION_SECRET must be configured (header auth)
 * - TAVILY_API_KEY should be configured for research
 *
 * Results are saved to tests/e2e-results/article-generator/ for analysis.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
  type QualityAnalysis,
  type DatabaseVerification,
  type GameInfo,
} from './save-results';

// ============================================================================
// Validation Constants (mirrored from src/ai/articles/config.ts)
// ============================================================================

const ARTICLE_PLAN_CONSTRAINTS = {
  TITLE_MIN_LENGTH: 10,
  TITLE_MAX_LENGTH: 100,
  TITLE_RECOMMENDED_MAX_LENGTH: 70,
  EXCERPT_MIN_LENGTH: 120,
  EXCERPT_MAX_LENGTH: 160,
  MIN_SECTIONS: 3,
  MAX_SECTIONS: 12,
  MIN_SECTION_LENGTH: 100,
  MIN_TAGS: 1,
  MAX_TAGS: 10,
  TAG_MAX_LENGTH: 50,
  MIN_MARKDOWN_LENGTH: 500,
} as const;

const PLACEHOLDER_PATTERNS = ['TODO', 'TBD', 'PLACEHOLDER', 'FIXME', '[INSERT', 'XXX'];

const AI_CLICHE_PHRASES = [
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

const VALID_CATEGORY_SLUGS = ['news', 'reviews', 'guides', 'lists'] as const;
const VALID_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

const TEST_IGDB_ID = 119388; // The Legend of Zelda: Tears of the Kingdom
const TEST_INSTRUCTION = 'Write a beginner guide for the first hour. Use 3-4 sections.';

// ============================================================================
// Test Infrastructure
// ============================================================================

/**
 * Fetch with extended timeouts for long-running AI operations.
 */
async function fetchWithExtendedTimeout(
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
    return (await undiciFetch(url, {
      ...options,
      dispatcher: agent,
    })) as unknown as Response;
  } finally {
    await agent.close();
  }
}

const describeE2E = process.env.RUN_E2E_TESTS === 'true' ? describe : describe.skip;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function getFromDotEnvFile(name: string): string | undefined {
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

async function tableExists(knex: Knex, tableName: string): Promise<boolean> {
  const row = await knex('information_schema.tables')
    .select('table_name')
    .where({ table_schema: 'public', table_name: tableName })
    .first();
  return Boolean(row);
}

async function safeDeleteAll(knex: Knex, tableName: string): Promise<void> {
  if (!(await tableExists(knex, tableName))) return;
  await knex(tableName).del();
}

async function getTableColumns(knex: Knex, tableName: string): Promise<Set<string>> {
  const rows = await knex('information_schema.columns')
    .select('column_name')
    .where({ table_schema: 'public', table_name: tableName });
  return new Set(rows.map((r: { column_name: string }) => r.column_name));
}

async function findPostGameLinkTable(knex: Knex): Promise<string | null> {
  const candidates = ['posts_games_lnk', 'games_posts_lnk'];
  for (const t of candidates) {
    if (await tableExists(knex, t)) return t;
  }
  return null;
}

// ============================================================================
// Result Builders - Extract data from API response
// ============================================================================

function extractGameInfo(json: any): GameInfo {
  return {
    documentId: json?.game?.documentId ?? '',
    name: json?.game?.name ?? '',
    slug: json?.game?.slug,
  };
}

function extractGenerationStats(json: any): GenerationStats {
  const metadata = json?.draft?.metadata ?? {};
  const tokenUsage = metadata.tokenUsage ?? {};

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
        scout: tokenUsage.scout ?? { input: 0, output: 0 },
        editor: tokenUsage.editor ?? { input: 0, output: 0 },
        specialist: tokenUsage.specialist ?? { input: 0, output: 0 },
        ...(tokenUsage.reviewer ? { reviewer: tokenUsage.reviewer } : {}),
      },
      total: tokenUsage.total ?? { input: 0, output: 0 },
      estimatedCostUsd: tokenUsage.estimatedCostUsd ?? 0,
    },
    models: json?.models ?? {},
    research: {
      queriesExecuted: metadata.queriesExecuted ?? 0,
      sourcesCollected: metadata.sourcesCollected ?? 0,
      confidence: metadata.researchConfidence ?? 'medium',
    },
  };
}

function analyzeMarkdownContent(markdown: string): {
  wordCount: number;
  paragraphCount: number;
  sections: { total: number; content: number; hasSourcesSection: boolean; headlines: string[] };
  lists: { bulletItems: number; numberedItems: number; total: number };
  linkCount: number;
} {
  const h2Matches = markdown.match(/^## .+$/gm) || [];
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

function analyzeSources(sources: string[]): {
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

function extractArticleAnalysis(json: any): ArticleAnalysis {
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

function extractPlanAnalysis(json: any): ArticlePlanAnalysis {
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

function analyzeAiCliches(markdown: string): {
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

function findPlaceholders(markdown: string): string[] {
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
// Test Suite
// ============================================================================

describeE2E('Article Generator E2E', () => {
  // Shared state
  let knex: Knex | undefined;
  let strapiReady = false;
  let response: Response | undefined;
  let json: any;
  let testStartTime: number;

  // Result data (populated during tests)
  const validationIssues: ValidationIssue[] = [];
  let gameInfo: GameInfo | undefined;
  let generationStats: GenerationStats | undefined;
  let articleAnalysis: ArticleAnalysis | undefined;
  let planAnalysis: ArticlePlanAnalysis | undefined;
  let qualityChecks: { placeholders: string[]; cliches: { found: string[]; total: number } } = {
    placeholders: [],
    cliches: { found: [], total: 0 },
  };
  let reviewerData: {
    ran: boolean;
    approved: boolean | null;
    issues: ReviewerIssue[];
    initialIssues?: ReviewerIssue[];
  } = {
    ran: false,
    approved: null,
    issues: [],
    initialIssues: undefined,
  };
  let recoveryData = {
    applied: false,
    planRetries: 0,
    fixerIterations: 0,
    fixesAttempted: 0,
    fixesSuccessful: 0,
  };
  let dbVerification: DatabaseVerification = {
    post: { exists: false, linkedToGame: false },
    game: { exists: false, hasDescription: false },
  };

  const secret = process.env.AI_GENERATION_SECRET || getFromDotEnvFile('AI_GENERATION_SECRET');

  // ========================================================================
  // SETUP: Clean → Call Endpoint (runs once before all tests)
  // ========================================================================
  beforeAll(async () => {
    testStartTime = Date.now();

    console.log('[E2E Setup] Step 1/5: Checking Strapi availability...');
    strapiReady = await isStrapiRunning();

    if (!strapiReady) {
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
        strapiReady = false;
        return;
      }
      const igdbJson = (await igdbStatus.json()) as { configured?: boolean };
      if (!igdbJson.configured) {
        console.warn('[E2E Setup] ⚠️ IGDB not configured');
        strapiReady = false;
        return;
      }
      console.log('[E2E Setup] ✓ IGDB is configured');
    } catch (error) {
      console.warn('[E2E Setup] ⚠️ Failed to check IGDB status:', error);
      strapiReady = false;
      return;
    }

    console.log('[E2E Setup] Step 3/5: Validating AI/OpenRouter configuration...');
    try {
      const aiStatus = await fetch(`${E2E_CONFIG.strapiUrl}/api/game-fetcher/ai-status`);
      if (!aiStatus.ok) {
        console.warn('[E2E Setup] ⚠️ AI status endpoint not available');
        strapiReady = false;
        return;
      }
      const aiJson = (await aiStatus.json()) as { configured?: boolean };
      if (!aiJson.configured) {
        console.warn('[E2E Setup] ⚠️ OpenRouter AI not configured');
        strapiReady = false;
        return;
      }
      console.log('[E2E Setup] ✓ AI/OpenRouter is configured');
    } catch (error) {
      console.warn('[E2E Setup] ⚠️ Failed to check AI status:', error);
      strapiReady = false;
      return;
    }

    console.log('[E2E Setup] Step 4/5: Cleaning posts...');
    knex = await createDbConnection();
    const linkTable = await findPostGameLinkTable(knex);
    if (linkTable) {
      await safeDeleteAll(knex, linkTable);
    }
    await safeDeleteAll(knex, 'posts');
    console.log('[E2E Setup] ✓ Posts cleaned');

    console.log('[E2E Setup] Step 5/5: Calling article generator endpoint...');
    console.log(`[E2E Setup] IGDB ID: ${TEST_IGDB_ID} (Zelda TOTK)`);
    const headerSecret = secret || mustGetEnv('AI_GENERATION_SECRET');

    response = await fetchWithExtendedTimeout(
      `${E2E_CONFIG.strapiUrl}/api/article-generator/generate`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ai-generation-secret': headerSecret,
        },
        body: JSON.stringify({
          igdbId: TEST_IGDB_ID,
          instruction: TEST_INSTRUCTION,
          publish: false,
          categorySlug: 'guides',
        }),
        timeoutMs: 900000,
      }
    );

    const responseText = await response.text();
    try {
      json = JSON.parse(responseText);
    } catch {
      json = { raw: responseText, parseError: true };
    }

    const duration = ((Date.now() - testStartTime) / 1000).toFixed(1);
    console.log(`[E2E Setup] ✓ Endpoint called in ${duration}s`);
    console.log(`[E2E Setup] Response status: ${response.status}`);
    console.log(`[E2E Setup] Success: ${json?.success}`);

    // Pre-extract data for result building
    if (json && !json.parseError) {
      gameInfo = extractGameInfo(json);
      generationStats = extractGenerationStats(json);
      articleAnalysis = extractArticleAnalysis(json);
      planAnalysis = extractPlanAnalysis(json);

      // Extract reviewer data - check for boolean (true/false) or issues array
      const hasReviewerData =
        typeof json.reviewerApproved === 'boolean' || Array.isArray(json.reviewerIssues);
      if (hasReviewerData) {
        reviewerData = {
          ran: true,
          approved: json.reviewerApproved ?? null,
          issues: json.reviewerIssues ?? [],
          // Capture initial issues if present (before fixes were applied)
          initialIssues: json.reviewerInitialIssues ?? undefined,
        };
      }

      // Extract recovery data
      const recovery = json.draft?.metadata?.recovery;
      if (recovery) {
        recoveryData = {
          applied: true,
          planRetries: recovery.planRetries ?? 0,
          fixerIterations: recovery.fixerIterations ?? 0,
          fixesAttempted: recovery.fixesApplied?.length ?? 0,
          fixesSuccessful: recovery.fixesApplied?.filter((f: any) => f.success).length ?? 0,
        };
      }
    }
  }, 1080000);

  // ========================================================================
  // TEARDOWN: Save results and close connections
  // ========================================================================
  afterAll(async () => {
    if (validationIssues.length > 0) {
      logValidationSummary(validationIssues);
    }

    // Build and save final result
    if (json && testStartTime && gameInfo && generationStats && articleAnalysis && planAnalysis) {
      const errors = validationIssues.filter((i) => i.severity === 'error');
      const reviewerBySeverity = {
        critical: reviewerData.issues.filter((i) => i.severity === 'critical').length,
        major: reviewerData.issues.filter((i) => i.severity === 'major').length,
        minor: reviewerData.issues.filter((i) => i.severity === 'minor').length,
      };

      const result: E2ETestResult = {
        metadata: {
          testName: 'article-generator-validation',
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - testStartTime,
          passed: errors.length === 0,
        },
        input: {
          igdbId: TEST_IGDB_ID,
          instruction: TEST_INSTRUCTION,
          publish: false,
        },
        game: gameInfo,
        generation: generationStats,
        article: articleAnalysis,
        plan: planAnalysis,
        quality: {
          passed: errors.length === 0,
          issues: validationIssues,
          reviewer: {
            ran: reviewerData.ran,
            approved: reviewerData.approved,
            issues: reviewerData.issues,
            // Include initial issues if they differ from final (i.e., some were fixed)
            ...(reviewerData.initialIssues &&
              reviewerData.initialIssues.length !== reviewerData.issues.length && {
                initialIssues: reviewerData.initialIssues,
                issuesFixed:
                  reviewerData.initialIssues.length - reviewerData.issues.length,
              }),
            bySeverity: reviewerBySeverity,
          },
          recovery: recoveryData,
          checks: {
            placeholders: {
              passed: qualityChecks.placeholders.length === 0,
              found: qualityChecks.placeholders,
            },
            aiCliches: {
              passed: qualityChecks.cliches.found.length < 5,
              found: qualityChecks.cliches.found,
              totalOccurrences: qualityChecks.cliches.total,
            },
          },
        },
        database: dbVerification,
        rawContent: {
          markdown: json?.draft?.markdown ?? '',
        },
      };

      const savedPath = saveTestResult(result);
      console.log(`\n📄 Test results saved to: ${savedPath}`);
    }

    if (knex) {
      await knex.destroy();
    }
  });

  // ========================================================================
  // VALIDATION TESTS
  // ========================================================================

  it('should return a successful response', async ({ skip }) => {
    if (!strapiReady || !response) {
      skip();
      return;
    }

    expect(response.ok).toBe(true);
    expect(json?.success).toBe(true);
    expect(json?.post?.documentId).toBeTruthy();
  });

  it('should include game information in response', async ({ skip }) => {
    if (!strapiReady || !json) {
      skip();
      return;
    }

    expect(json?.game).toBeDefined();
    expect(json?.game?.documentId).toBeTruthy();
    expect(json?.game?.name).toBeTruthy();

    if (!json?.game?.documentId) {
      validationIssues.push({
        severity: 'error',
        field: 'game.documentId',
        message: 'Game documentId is missing',
      });
    }
  });

  it('should generate a valid title', async ({ skip }) => {
    if (!strapiReady || !json?.draft) {
      skip();
      return;
    }

    const title = json.draft.title;
    const C = ARTICLE_PLAN_CONSTRAINTS;

    expect(typeof title).toBe('string');
    expect(title.length).toBeGreaterThanOrEqual(C.TITLE_MIN_LENGTH);
    expect(title.length).toBeLessThanOrEqual(C.TITLE_MAX_LENGTH);

    if (title.length > C.TITLE_RECOMMENDED_MAX_LENGTH) {
      validationIssues.push({
        severity: 'warning',
        field: 'title',
        message: `Title exceeds recommended length (${C.TITLE_RECOMMENDED_MAX_LENGTH} chars)`,
        actual: title.length,
      });
    }
  });

  it('should generate a valid excerpt', async ({ skip }) => {
    if (!strapiReady || !json?.draft) {
      skip();
      return;
    }

    const excerpt = json.draft.excerpt;
    const C = ARTICLE_PLAN_CONSTRAINTS;

    expect(typeof excerpt).toBe('string');
    expect(excerpt.length).toBeGreaterThanOrEqual(C.EXCERPT_MIN_LENGTH);
    expect(excerpt.length).toBeLessThanOrEqual(C.EXCERPT_MAX_LENGTH);
  });

  it('should assign a valid category', async ({ skip }) => {
    if (!strapiReady || !json?.draft) {
      skip();
      return;
    }

    expect(VALID_CATEGORY_SLUGS).toContain(json.draft.categorySlug);
  });

  it('should generate valid tags', async ({ skip }) => {
    if (!strapiReady || !json?.draft) {
      skip();
      return;
    }

    const tags = json.draft.tags;
    const C = ARTICLE_PLAN_CONSTRAINTS;

    expect(Array.isArray(tags)).toBe(true);
    expect(tags.length).toBeGreaterThanOrEqual(C.MIN_TAGS);
    expect(tags.length).toBeLessThanOrEqual(C.MAX_TAGS);

    for (const tag of tags) {
      expect(typeof tag).toBe('string');
      expect(tag.trim().length).toBeGreaterThan(0);
      expect(tag.length).toBeLessThanOrEqual(C.TAG_MAX_LENGTH);
    }
  });

  it('should generate markdown content with proper structure', async ({ skip }) => {
    if (!strapiReady || !json?.draft) {
      skip();
      return;
    }

    const markdown = json.draft.markdown;
    const C = ARTICLE_PLAN_CONSTRAINTS;

    expect(typeof markdown).toBe('string');
    expect(markdown.length).toBeGreaterThanOrEqual(C.MIN_MARKDOWN_LENGTH);

    const analysis = analyzeMarkdownContent(markdown);

    if (analysis.sections.content < C.MIN_SECTIONS) {
      validationIssues.push({
        severity: 'warning',
        field: 'markdown.sections',
        message: `Only ${analysis.sections.content} H2 sections found (minimum ${C.MIN_SECTIONS})`,
        actual: analysis.sections.content,
      });
    }
  });

  it('should not contain placeholder text', async ({ skip }) => {
    if (!strapiReady || !json?.draft?.markdown) {
      skip();
      return;
    }

    const found = findPlaceholders(json.draft.markdown);
    qualityChecks.placeholders = found;

    for (const placeholder of found) {
      validationIssues.push({
        severity: 'error',
        field: 'markdown.content',
        message: `Article contains placeholder text: ${placeholder}`,
      });
    }

    expect(found.length).toBe(0);
  });

  it('should minimize AI clichés', async ({ skip }) => {
    if (!strapiReady || !json?.draft?.markdown) {
      skip();
      return;
    }

    const analysis = analyzeAiCliches(json.draft.markdown);
    qualityChecks.cliches = { found: analysis.found, total: analysis.totalOccurrences };

    if (analysis.found.length > 0) {
      validationIssues.push({
        severity: 'warning',
        field: 'markdown.content',
        message: `Article contains ${analysis.found.length} AI cliché(s): ${analysis.found.join(', ')}`,
      });
    }

    expect(analysis.found.length).toBeLessThan(5);
  });

  it('should collect valid sources', async ({ skip }) => {
    if (!strapiReady || !json?.draft) {
      skip();
      return;
    }

    const sources = json.draft.sources;

    expect(Array.isArray(sources)).toBe(true);

    if (sources.length === 0) {
      validationIssues.push({
        severity: 'warning',
        field: 'sources',
        message: 'No sources collected',
      });
    }

    for (const source of sources) {
      expect(typeof source).toBe('string');
    }
  });

  it('should include complete metadata', async ({ skip }) => {
    if (!strapiReady || !json?.draft?.metadata) {
      skip();
      return;
    }

    const metadata = json.draft.metadata;

    expect(typeof metadata.generatedAt).toBe('string');
    expect(new Date(metadata.generatedAt).getTime()).not.toBeNaN();
    expect(typeof metadata.totalDurationMs).toBe('number');
    expect(metadata.totalDurationMs).toBeGreaterThan(0);
    expect(typeof metadata.correlationId).toBe('string');
    expect(VALID_CONFIDENCE_LEVELS).toContain(metadata.researchConfidence);

    const requiredPhases = ['scout', 'editor', 'specialist', 'validation'];
    for (const phase of requiredPhases) {
      expect(typeof metadata.phaseDurations[phase]).toBe('number');
    }
  });

  it('should track recovery metadata when retries occur', async ({ skip }) => {
    if (!strapiReady || !json?.draft?.metadata) {
      skip();
      return;
    }

    const recovery = json.draft.metadata.recovery;

    if (recovery) {
      expect(typeof recovery.planRetries).toBe('number');
      expect(typeof recovery.fixerIterations).toBe('number');
      expect(Array.isArray(recovery.fixesApplied)).toBe(true);

      if (recovery.planRetries > 0 || recovery.fixerIterations > 0) {
        validationIssues.push({
          severity: 'info',
          field: 'metadata.recovery',
          message: `Recovery applied: ${recovery.planRetries} plan retries, ${recovery.fixerIterations} fixer iterations`,
        });
      }
    }
  });

  it('should include a valid article plan', async ({ skip }) => {
    if (!strapiReady || !json?.draft?.plan) {
      skip();
      return;
    }

    const plan = json.draft.plan;

    expect(typeof plan.gameName).toBe('string');
    expect(plan.gameName.trim().length).toBeGreaterThan(0);
    expect(Array.isArray(plan.sections)).toBe(true);
    expect(plan.sections.length).toBeGreaterThan(0);

    for (const section of plan.sections) {
      expect(typeof section.headline).toBe('string');
      expect(typeof section.goal).toBe('string');
      expect(Array.isArray(section.researchQueries)).toBe(true);
    }
  });

  it('should specify models used for each agent', async ({ skip }) => {
    if (!strapiReady || !json?.models) {
      skip();
      return;
    }

    const agents = ['scout', 'editor', 'specialist'];

    for (const agent of agents) {
      expect(typeof json.models[agent]).toBe('string');
      expect(json.models[agent].length).toBeGreaterThan(0);
    }
  });

  it('should capture reviewer issues for analysis', async ({ skip }) => {
    if (!strapiReady || !json) {
      skip();
      return;
    }

    const issues = json.reviewerIssues || [];

    if (issues.length > 0) {
      const critical = issues.filter((i: any) => i.severity === 'critical').length;
      const major = issues.filter((i: any) => i.severity === 'major').length;
      const minor = issues.filter((i: any) => i.severity === 'minor').length;

      validationIssues.push({
        severity: 'info',
        field: 'reviewer.issues',
        message: `Reviewer found ${issues.length} issue(s): ${critical} critical, ${major} major, ${minor} minor`,
      });
    }
  });

  it('should create post in database', async ({ skip }) => {
    if (!strapiReady || !knex || !json?.post?.documentId) {
      skip();
      return;
    }

    const postRow = await knex('posts')
      .select('id', 'document_id', 'title', 'locale', 'published_at')
      .where({ document_id: json.post.documentId })
      .first();

    dbVerification.post.exists = Boolean(postRow);

    expect(postRow).toBeDefined();
    expect(postRow?.document_id).toBe(json.post.documentId);
    expect(postRow?.locale).toBe('en');
    expect(postRow?.published_at).toBeNull(); // Draft
  });

  it('should link post to game in database', async ({ skip }) => {
    if (!strapiReady || !knex || !json?.post?.documentId) {
      skip();
      return;
    }

    const postRow = await knex('posts')
      .select('id')
      .where({ document_id: json.post.documentId })
      .first();

    if (!postRow) {
      skip();
      return;
    }

    const linkTable = await findPostGameLinkTable(knex);
    expect(linkTable).toBeTruthy();

    if (!linkTable) return;

    const gameCols = await getTableColumns(knex, 'games');
    const igdbCol = gameCols.has('igdb_id') ? 'igdb_id' : gameCols.has('igdbId') ? 'igdbId' : null;

    if (!igdbCol) {
      skip();
      return;
    }

    const gameRows = await knex('games')
      .select('id')
      .where({ [igdbCol]: TEST_IGDB_ID, locale: 'en' });

    expect(gameRows.length).toBeGreaterThan(0);

    const gameIds = gameRows.map((g: any) => Number(g.id));
    const linkCols = await getTableColumns(knex, linkTable);
    const postIdCol = linkCols.has('post_id') ? 'post_id' : linkCols.has('postId') ? 'postId' : null;
    const gameIdCol = linkCols.has('game_id') ? 'game_id' : linkCols.has('gameId') ? 'gameId' : null;

    if (!postIdCol || !gameIdCol) {
      skip();
      return;
    }

    const links = await knex(linkTable)
      .select('*')
      .where({ [postIdCol]: postRow.id })
      .whereIn(gameIdCol, gameIds);

    dbVerification.post.linkedToGame = links.length > 0;
    expect(links.length).toBeGreaterThan(0);
  });

  it('should import game with correct data', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const gameCols = await getTableColumns(knex, 'games');
    const igdbCol = gameCols.has('igdb_id') ? 'igdb_id' : gameCols.has('igdbId') ? 'igdbId' : null;

    if (!igdbCol) {
      skip();
      return;
    }

    const gameRow = await knex('games')
      .select('name', 'description', 'locale', 'document_id')
      .where({ [igdbCol]: TEST_IGDB_ID, locale: 'en' })
      .first();

    dbVerification.game.exists = Boolean(gameRow);
    dbVerification.game.hasDescription = Boolean(gameRow?.description?.length > 100);

    expect(gameRow).toBeDefined();
    expect(gameRow?.name).toContain('Zelda');
    expect(gameRow?.description).toBeTruthy();
    expect(gameRow?.description?.length).toBeGreaterThan(100);
  });
});
