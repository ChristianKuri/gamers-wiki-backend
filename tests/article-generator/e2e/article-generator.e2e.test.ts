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
  createTestResult,
  logValidationSummary,
  type E2EValidationIssue,
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

const VALID_CATEGORY_SLUGS = ['news', 'reviews', 'guides', 'lists'] as const;
const VALID_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

const TEST_IGDB_ID = 119388; // The Legend of Zelda: Tears of the Kingdom

// ============================================================================
// Test Infrastructure
// ============================================================================

/**
 * Fetch with extended timeouts for long-running AI operations.
 * Uses undici Agent to avoid Node.js fetch default timeout issues.
 */
async function fetchWithExtendedTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const { Agent, fetch: undiciFetch } = await import('undici');
  const timeoutMs = options.timeoutMs ?? 900000; // 15 minutes default (AI generation can be slow)

  const agent = new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    connectTimeout: 30000,
  });

  try {
    return await undiciFetch(url, {
      ...options,
      dispatcher: agent,
    }) as unknown as Response;
  } finally {
    await agent.close();
  }
}

// Skip E2E tests if not explicitly enabled
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
// Test Suite
// ============================================================================

describeE2E('Article Generator E2E', () => {
  // Shared state across all tests
  let knex: Knex | undefined;
  let strapiReady = false;
  let response: Response | undefined;
  let json: any;
  let testStartTime: number;
  const validationIssues: E2EValidationIssue[] = [];
  const databaseAssertions: Record<string, unknown> = {};

  const secret = process.env.AI_GENERATION_SECRET || getFromDotEnvFile('AI_GENERATION_SECRET');

  // ========================================================================
  // SETUP: Clean → Call Endpoint (runs once before all tests)
  // ========================================================================
  beforeAll(async () => {
    testStartTime = Date.now();

    // Step 1: Check Strapi availability
    console.log('[E2E Setup] Step 1/5: Checking Strapi availability...');
    strapiReady = await isStrapiRunning();

    if (!strapiReady) {
      console.warn(`\n⚠️  Strapi is not running at ${E2E_CONFIG.strapiUrl}\nTo run E2E tests, use: npm run test:e2e:run\n`);
      return;
    }
    console.log('[E2E Setup] ✓ Strapi is running');

    // Step 2: Validate IGDB configuration
    console.log('[E2E Setup] Step 2/5: Validating IGDB configuration...');
    try {
      const igdbStatus = await fetch(`${E2E_CONFIG.strapiUrl}/api/game-fetcher/status`);
      if (!igdbStatus.ok) {
        console.warn('[E2E Setup] ⚠️ IGDB status endpoint not available - skipping setup');
        strapiReady = false;
        return;
      }
      const igdbJson = (await igdbStatus.json()) as { configured?: boolean };
      if (!igdbJson.configured) {
        console.warn('[E2E Setup] ⚠️ IGDB not configured - skipping setup');
        strapiReady = false;
        return;
      }
      console.log('[E2E Setup] ✓ IGDB is configured');
    } catch (error) {
      console.warn('[E2E Setup] ⚠️ Failed to check IGDB status:', error);
      strapiReady = false;
      return;
    }

    // Step 3: Validate AI/OpenRouter configuration
    console.log('[E2E Setup] Step 3/5: Validating AI/OpenRouter configuration...');
    try {
      const aiStatus = await fetch(`${E2E_CONFIG.strapiUrl}/api/game-fetcher/ai-status`);
      if (!aiStatus.ok) {
        console.warn('[E2E Setup] ⚠️ AI status endpoint not available - skipping setup');
        strapiReady = false;
        return;
      }
      const aiJson = (await aiStatus.json()) as { configured?: boolean };
      if (!aiJson.configured) {
        console.warn('[E2E Setup] ⚠️ OpenRouter AI not configured - skipping setup');
        strapiReady = false;
        return;
      }
      console.log('[E2E Setup] ✓ AI/OpenRouter is configured');
    } catch (error) {
      console.warn('[E2E Setup] ⚠️ Failed to check AI status:', error);
      strapiReady = false;
      return;
    }

    // Step 4: Clean posts (not game data - game will be imported if needed)
    console.log('[E2E Setup] Step 4/5: Cleaning posts...');
    knex = await createDbConnection();
    const linkTable = await findPostGameLinkTable(knex);
    if (linkTable) {
      await safeDeleteAll(knex, linkTable);
    }
    await safeDeleteAll(knex, 'posts');
    console.log('[E2E Setup] ✓ Posts cleaned');

    // Step 5: Call article generator endpoint ONCE
    console.log('[E2E Setup] Step 5/5: Calling article generator endpoint...');
    console.log(`[E2E Setup] IGDB ID: ${TEST_IGDB_ID} (Zelda TOTK)`);
    const headerSecret = secret || mustGetEnv('AI_GENERATION_SECRET');

    response = await fetchWithExtendedTimeout(`${E2E_CONFIG.strapiUrl}/api/article-generator/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ai-generation-secret': headerSecret,
      },
      body: JSON.stringify({
        igdbId: TEST_IGDB_ID,
        instruction: 'Write a beginner guide for the first hour. Use 3-4 sections.',
        publish: false,
      }),
      timeoutMs: 900000, // 15 minutes (AI generation can take 10+ minutes)
    });

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
  }, 1080000); // 18 minutes for full setup including game import + AI generation

  // ========================================================================
  // TEARDOWN: Save results and close connections
  // ========================================================================
  afterAll(async () => {
    // Log validation summary
    if (validationIssues.length > 0) {
      logValidationSummary(validationIssues);
    }

    // Save test results
    if (json && testStartTime) {
      const testResult = createTestResult(
        'article-generator-validation',
        testStartTime,
        json,
        validationIssues,
        databaseAssertions,
        { igdbId: TEST_IGDB_ID, gameName: json?.game?.name }
      );
      const savedPath = saveTestResult(testResult);
      console.log(`\n📄 Test results saved to: ${savedPath}`);
    }

    if (knex) {
      await knex.destroy();
    }
  });

  // ========================================================================
  // VALIDATION TESTS: Each test validates a specific aspect
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

    // Count H2 sections (excluding ## Sources)
    const h2Matches = markdown.match(/^## .+$/gm) || [];
    const contentSections = h2Matches.filter((h: string) => !h.toLowerCase().includes('sources'));

    if (contentSections.length < C.MIN_SECTIONS) {
      validationIssues.push({
        severity: 'warning',
        field: 'markdown.sections',
        message: `Only ${contentSections.length} H2 sections found (minimum ${C.MIN_SECTIONS})`,
        actual: contentSections.length,
      });
    }
  });

  it('should not contain placeholder text', async ({ skip }) => {
    if (!strapiReady || !json?.draft?.markdown) {
      skip();
      return;
    }

    const markdown = json.draft.markdown;

    for (const placeholder of PLACEHOLDER_PATTERNS) {
      const re = new RegExp(`\\b${placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      const hasPlaceholder = re.test(markdown);

      if (hasPlaceholder) {
        validationIssues.push({
          severity: 'error',
          field: 'markdown.content',
          message: `Article contains placeholder text: ${placeholder}`,
        });
      }

      expect(hasPlaceholder).toBe(false);
    }
  });

  it('should minimize AI clichés', async ({ skip }) => {
    if (!strapiReady || !json?.draft?.markdown) {
      skip();
      return;
    }

    const clichePhrases = [
      'dive into',
      'delve into',
      'game-changer',
      'embark on',
      'ever-evolving',
      'cutting-edge',
      'seamlessly',
      'leverage',
      'unlock',
      'masterclass',
    ];

    const lowercaseMarkdown = json.draft.markdown.toLowerCase();
    const foundCliches = clichePhrases.filter((phrase) => lowercaseMarkdown.includes(phrase));

    if (foundCliches.length > 0) {
      validationIssues.push({
        severity: 'warning',
        field: 'markdown.content',
        message: `Article contains ${foundCliches.length} AI cliché(s): ${foundCliches.join(', ')}`,
      });
    }

    // Warning only - doesn't fail the test
    expect(foundCliches.length).toBeLessThan(5);
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
      // Validate URL format
      expect(() => new URL(source)).not.toThrow();
    }
  });

  it('should include complete metadata', async ({ skip }) => {
    if (!strapiReady || !json?.draft?.metadata) {
      skip();
      return;
    }

    const metadata = json.draft.metadata;

    // Required fields
    expect(typeof metadata.generatedAt).toBe('string');
    expect(new Date(metadata.generatedAt).getTime()).not.toBeNaN();

    expect(typeof metadata.totalDurationMs).toBe('number');
    expect(metadata.totalDurationMs).toBeGreaterThan(0);

    expect(typeof metadata.correlationId).toBe('string');
    expect(metadata.correlationId.length).toBeGreaterThan(0);

    expect(VALID_CONFIDENCE_LEVELS).toContain(metadata.researchConfidence);

    // Phase durations
    const requiredPhases = ['scout', 'editor', 'specialist', 'validation'];
    for (const phase of requiredPhases) {
      expect(typeof metadata.phaseDurations[phase]).toBe('number');
      expect(metadata.phaseDurations[phase]).toBeGreaterThanOrEqual(0);
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

  it('should create post in database', async ({ skip }) => {
    if (!strapiReady || !knex || !json?.post?.documentId) {
      skip();
      return;
    }

    const postRow = await knex('posts')
      .select('id', 'document_id', 'title', 'locale', 'published_at')
      .where({ document_id: json.post.documentId })
      .first();

    // Capture database assertions for results file
    databaseAssertions.postExists = Boolean(postRow);
    databaseAssertions.postDocumentId = postRow?.document_id;
    databaseAssertions.postLocale = postRow?.locale;
    databaseAssertions.postIsPublished = postRow?.published_at !== null;

    expect(postRow).toBeDefined();
    expect(postRow?.document_id).toBe(json.post.documentId);
    expect(postRow?.locale).toBe('en');
    // Draft should not be published
    expect(postRow?.published_at).toBeNull();
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
    databaseAssertions.linkTableFound = linkTable;
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

    databaseAssertions.postGameLinked = links.length > 0;
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

    // Capture database assertions for results file
    databaseAssertions.gameFound = Boolean(gameRow);
    databaseAssertions.gameName = gameRow?.name;
    databaseAssertions.gameDocumentId = gameRow?.document_id;

    expect(gameRow).toBeDefined();
    expect(gameRow?.name).toContain('Zelda');
    expect(gameRow?.description).toBeTruthy();
    expect(gameRow?.description?.length).toBeGreaterThan(100);
  });
});
