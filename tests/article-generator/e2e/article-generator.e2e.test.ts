/**
 * Article Generator E2E Test
 *
 * Comprehensive end-to-end test that verifies:
 * - Strapi route POST /api/article-generator/generate works
 * - A draft Post is created in the database and linked to the game
 * - Generated content passes all validation constraints
 * - Metadata is properly captured (durations, tokens, sources)
 * - Game import/creation works correctly
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

import { isStrapiRunning, createDbConnection, cleanDatabase, E2E_CONFIG } from '../../game-fetcher/e2e/setup';
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
  const timeoutMs = options.timeoutMs ?? 600000; // 10 minutes default

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
// Validation Functions
// ============================================================================

/**
 * Validates structure constraints (title, excerpt, tags, markdown).
 */
function validateStructure(draft: any): E2EValidationIssue[] {
  const issues: E2EValidationIssue[] = [];
  const C = ARTICLE_PLAN_CONSTRAINTS;

  // Title validation
  if (typeof draft.title !== 'string') {
    issues.push({ severity: 'error', field: 'title', message: 'Title must be a string', actual: typeof draft.title });
  } else {
    if (draft.title.length < C.TITLE_MIN_LENGTH) {
      issues.push({
        severity: 'error',
        field: 'title',
        message: `Title too short (minimum ${C.TITLE_MIN_LENGTH} chars)`,
        actual: draft.title.length,
        expected: C.TITLE_MIN_LENGTH,
      });
    }
    if (draft.title.length > C.TITLE_MAX_LENGTH) {
      issues.push({
        severity: 'error',
        field: 'title',
        message: `Title too long (maximum ${C.TITLE_MAX_LENGTH} chars)`,
        actual: draft.title.length,
        expected: C.TITLE_MAX_LENGTH,
      });
    }
    if (draft.title.length > C.TITLE_RECOMMENDED_MAX_LENGTH) {
      issues.push({
        severity: 'warning',
        field: 'title',
        message: `Title exceeds recommended length (${C.TITLE_RECOMMENDED_MAX_LENGTH} chars)`,
        actual: draft.title.length,
        expected: C.TITLE_RECOMMENDED_MAX_LENGTH,
      });
    }
  }

  // Excerpt validation
  if (typeof draft.excerpt !== 'string') {
    issues.push({ severity: 'error', field: 'excerpt', message: 'Excerpt must be a string', actual: typeof draft.excerpt });
  } else {
    if (draft.excerpt.length < C.EXCERPT_MIN_LENGTH) {
      issues.push({
        severity: 'error',
        field: 'excerpt',
        message: `Excerpt too short (minimum ${C.EXCERPT_MIN_LENGTH} chars)`,
        actual: draft.excerpt.length,
        expected: C.EXCERPT_MIN_LENGTH,
      });
    }
    if (draft.excerpt.length > C.EXCERPT_MAX_LENGTH) {
      issues.push({
        severity: 'error',
        field: 'excerpt',
        message: `Excerpt too long (maximum ${C.EXCERPT_MAX_LENGTH} chars)`,
        actual: draft.excerpt.length,
        expected: C.EXCERPT_MAX_LENGTH,
      });
    }
  }

  // Category slug validation
  if (!VALID_CATEGORY_SLUGS.includes(draft.categorySlug)) {
    issues.push({
      severity: 'error',
      field: 'categorySlug',
      message: `Invalid category slug`,
      actual: draft.categorySlug,
      expected: VALID_CATEGORY_SLUGS,
    });
  }

  // Tags validation
  if (!Array.isArray(draft.tags)) {
    issues.push({ severity: 'error', field: 'tags', message: 'Tags must be an array', actual: typeof draft.tags });
  } else {
    if (draft.tags.length < C.MIN_TAGS) {
      issues.push({
        severity: 'error',
        field: 'tags',
        message: `Not enough tags (minimum ${C.MIN_TAGS})`,
        actual: draft.tags.length,
        expected: C.MIN_TAGS,
      });
    }
    if (draft.tags.length > C.MAX_TAGS) {
      issues.push({
        severity: 'error',
        field: 'tags',
        message: `Too many tags (maximum ${C.MAX_TAGS})`,
        actual: draft.tags.length,
        expected: C.MAX_TAGS,
      });
    }
    for (let i = 0; i < draft.tags.length; i++) {
      const tag = draft.tags[i];
      if (typeof tag !== 'string' || tag.trim().length === 0) {
        issues.push({ severity: 'error', field: `tags[${i}]`, message: 'Tag must be a non-empty string', actual: tag });
      } else if (tag.length > C.TAG_MAX_LENGTH) {
        issues.push({
          severity: 'error',
          field: `tags[${i}]`,
          message: `Tag too long (maximum ${C.TAG_MAX_LENGTH} chars)`,
          actual: tag.length,
        });
      }
    }
  }

  // Markdown validation
  if (typeof draft.markdown !== 'string') {
    issues.push({ severity: 'error', field: 'markdown', message: 'Markdown must be a string', actual: typeof draft.markdown });
  } else {
    if (draft.markdown.length < C.MIN_MARKDOWN_LENGTH) {
      issues.push({
        severity: 'error',
        field: 'markdown',
        message: `Markdown content too short (minimum ${C.MIN_MARKDOWN_LENGTH} chars)`,
        actual: draft.markdown.length,
        expected: C.MIN_MARKDOWN_LENGTH,
      });
    }

    // Count H2 sections (excluding ## Sources)
    const h2Matches = draft.markdown.match(/^## .+$/gm) || [];
    const contentSections = h2Matches.filter((h: string) => !h.toLowerCase().includes('sources'));
    if (contentSections.length < C.MIN_SECTIONS) {
      issues.push({
        severity: 'warning',
        field: 'markdown.sections',
        message: `Only ${contentSections.length} H2 sections found (minimum ${C.MIN_SECTIONS})`,
        actual: contentSections.length,
        expected: C.MIN_SECTIONS,
      });
    }
    if (contentSections.length > C.MAX_SECTIONS) {
      issues.push({
        severity: 'warning',
        field: 'markdown.sections',
        message: `Too many sections (${contentSections.length}, maximum ${C.MAX_SECTIONS})`,
        actual: contentSections.length,
        expected: C.MAX_SECTIONS,
      });
    }
  }

  // Sources validation
  if (!Array.isArray(draft.sources)) {
    issues.push({ severity: 'error', field: 'sources', message: 'Sources must be an array', actual: typeof draft.sources });
  } else {
    if (draft.sources.length === 0) {
      issues.push({ severity: 'warning', field: 'sources', message: 'No sources collected' });
    }
    for (let i = 0; i < draft.sources.length; i++) {
      const source = draft.sources[i];
      if (typeof source !== 'string') {
        issues.push({ severity: 'error', field: `sources[${i}]`, message: 'Source must be a string', actual: typeof source });
      } else {
        try {
          new URL(source);
        } catch {
          issues.push({ severity: 'error', field: `sources[${i}]`, message: 'Invalid URL', actual: source });
        }
      }
    }
  }

  return issues;
}

/**
 * Validates content quality (placeholders, code fences, clichés).
 */
function validateContentQuality(markdown: string): E2EValidationIssue[] {
  const issues: E2EValidationIssue[] = [];

  // Check for placeholder text
  for (const placeholder of PLACEHOLDER_PATTERNS) {
    const re = new RegExp(`\\b${placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(markdown)) {
      issues.push({
        severity: 'error',
        field: 'markdown.content',
        message: `Article contains placeholder text: ${placeholder}`,
      });
    }
  }

  // Check for code fences (usually undesirable in prose articles)
  if (markdown.includes('```')) {
    issues.push({
      severity: 'warning',
      field: 'markdown.content',
      message: 'Article contains code fences (usually undesirable for prose)',
    });
  }

  // AI clichés detection (warning only - doesn't fail test)
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
  const lowercaseMarkdown = markdown.toLowerCase();
  const foundCliches = clichePhrases.filter((phrase) => lowercaseMarkdown.includes(phrase));
  if (foundCliches.length > 0) {
    issues.push({
      severity: 'warning',
      field: 'markdown.content',
      message: `Article contains ${foundCliches.length} AI cliché(s): ${foundCliches.join(', ')}`,
    });
  }

  return issues;
}

/**
 * Validates metadata completeness and correctness.
 */
function validateMetadata(metadata: any): E2EValidationIssue[] {
  const issues: E2EValidationIssue[] = [];

  if (!metadata) {
    issues.push({ severity: 'error', field: 'metadata', message: 'Metadata is missing' });
    return issues;
  }

  // generatedAt
  if (typeof metadata.generatedAt !== 'string') {
    issues.push({ severity: 'error', field: 'metadata.generatedAt', message: 'generatedAt must be a string', actual: typeof metadata.generatedAt });
  } else {
    const date = new Date(metadata.generatedAt);
    if (isNaN(date.getTime())) {
      issues.push({ severity: 'error', field: 'metadata.generatedAt', message: 'generatedAt is not a valid ISO date', actual: metadata.generatedAt });
    }
  }

  // totalDurationMs
  if (typeof metadata.totalDurationMs !== 'number' || metadata.totalDurationMs <= 0) {
    issues.push({
      severity: 'error',
      field: 'metadata.totalDurationMs',
      message: 'totalDurationMs must be a positive number',
      actual: metadata.totalDurationMs,
    });
  }

  // phaseDurations
  const requiredPhases = ['scout', 'editor', 'specialist', 'validation'];
  if (!metadata.phaseDurations || typeof metadata.phaseDurations !== 'object') {
    issues.push({ severity: 'error', field: 'metadata.phaseDurations', message: 'phaseDurations must be an object' });
  } else {
    for (const phase of requiredPhases) {
      if (typeof metadata.phaseDurations[phase] !== 'number' || metadata.phaseDurations[phase] < 0) {
        issues.push({
          severity: 'error',
          field: `metadata.phaseDurations.${phase}`,
          message: `${phase} duration must be a non-negative number`,
          actual: metadata.phaseDurations[phase],
        });
      }
    }
  }

  // queriesExecuted
  if (typeof metadata.queriesExecuted !== 'number' || metadata.queriesExecuted < 0) {
    issues.push({
      severity: 'error',
      field: 'metadata.queriesExecuted',
      message: 'queriesExecuted must be a non-negative number',
      actual: metadata.queriesExecuted,
    });
  }
  if (metadata.queriesExecuted === 0) {
    issues.push({ severity: 'warning', field: 'metadata.queriesExecuted', message: 'No queries were executed' });
  }

  // sourcesCollected
  if (typeof metadata.sourcesCollected !== 'number' || metadata.sourcesCollected < 0) {
    issues.push({
      severity: 'error',
      field: 'metadata.sourcesCollected',
      message: 'sourcesCollected must be a non-negative number',
      actual: metadata.sourcesCollected,
    });
  }
  if (metadata.sourcesCollected === 0) {
    issues.push({ severity: 'warning', field: 'metadata.sourcesCollected', message: 'No sources were collected' });
  }

  // correlationId
  if (typeof metadata.correlationId !== 'string' || metadata.correlationId.length === 0) {
    issues.push({
      severity: 'error',
      field: 'metadata.correlationId',
      message: 'correlationId must be a non-empty string',
      actual: metadata.correlationId,
    });
  }

  // researchConfidence
  if (!VALID_CONFIDENCE_LEVELS.includes(metadata.researchConfidence)) {
    issues.push({
      severity: 'error',
      field: 'metadata.researchConfidence',
      message: 'Invalid research confidence level',
      actual: metadata.researchConfidence,
      expected: VALID_CONFIDENCE_LEVELS,
    });
  }

  // tokenUsage (optional but validate if present)
  if (metadata.tokenUsage) {
    const tu = metadata.tokenUsage;
    for (const phase of ['scout', 'editor', 'specialist', 'total']) {
      if (tu[phase]) {
        if (typeof tu[phase].input !== 'number' || tu[phase].input < 0) {
          issues.push({
            severity: 'warning',
            field: `metadata.tokenUsage.${phase}.input`,
            message: 'Token input must be non-negative',
            actual: tu[phase].input,
          });
        }
        if (typeof tu[phase].output !== 'number' || tu[phase].output < 0) {
          issues.push({
            severity: 'warning',
            field: `metadata.tokenUsage.${phase}.output`,
            message: 'Token output must be non-negative',
            actual: tu[phase].output,
          });
        }
      }
    }
    if (tu.estimatedCostUsd !== undefined && (typeof tu.estimatedCostUsd !== 'number' || tu.estimatedCostUsd < 0)) {
      issues.push({
        severity: 'warning',
        field: 'metadata.tokenUsage.estimatedCostUsd',
        message: 'estimatedCostUsd must be non-negative',
        actual: tu.estimatedCostUsd,
      });
    }
  }

  return issues;
}

/**
 * Validates plan structure.
 */
function validatePlan(plan: any): E2EValidationIssue[] {
  const issues: E2EValidationIssue[] = [];

  if (!plan) {
    issues.push({ severity: 'error', field: 'plan', message: 'Plan is missing' });
    return issues;
  }

  // gameName
  if (typeof plan.gameName !== 'string' || plan.gameName.trim().length === 0) {
    issues.push({ severity: 'error', field: 'plan.gameName', message: 'gameName must be a non-empty string', actual: plan.gameName });
  }

  // sections
  if (!Array.isArray(plan.sections)) {
    issues.push({ severity: 'error', field: 'plan.sections', message: 'sections must be an array', actual: typeof plan.sections });
  } else {
    for (let i = 0; i < plan.sections.length; i++) {
      const section = plan.sections[i];
      if (!section.headline || typeof section.headline !== 'string') {
        issues.push({ severity: 'error', field: `plan.sections[${i}].headline`, message: 'Section headline must be a string' });
      }
      if (!section.goal || typeof section.goal !== 'string') {
        issues.push({ severity: 'error', field: `plan.sections[${i}].goal`, message: 'Section goal must be a string' });
      }
      if (!Array.isArray(section.researchQueries)) {
        issues.push({ severity: 'error', field: `plan.sections[${i}].researchQueries`, message: 'researchQueries must be an array' });
      }
    }
  }

  // safety
  if (!plan.safety || typeof plan.safety !== 'object') {
    issues.push({ severity: 'warning', field: 'plan.safety', message: 'safety settings are missing' });
  } else if (typeof plan.safety.noScoresUnlessReview !== 'boolean') {
    issues.push({ severity: 'warning', field: 'plan.safety.noScoresUnlessReview', message: 'noScoresUnlessReview should be a boolean' });
  }

  return issues;
}

/**
 * Validates game information in response.
 */
function validateGameInfo(game: any): E2EValidationIssue[] {
  const issues: E2EValidationIssue[] = [];

  if (!game) {
    issues.push({ severity: 'error', field: 'game', message: 'Game info is missing from response' });
    return issues;
  }

  if (typeof game.documentId !== 'string' || game.documentId.length === 0) {
    issues.push({ severity: 'error', field: 'game.documentId', message: 'Game documentId must be a non-empty string', actual: game.documentId });
  }

  if (typeof game.name !== 'string' || game.name.length === 0) {
    issues.push({ severity: 'error', field: 'game.name', message: 'Game name must be a non-empty string', actual: game.name });
  }

  return issues;
}

// ============================================================================
// Test Suite
// ============================================================================

describeE2E('Article Generator E2E', () => {
  let knex: Knex | undefined;
  let strapiReady = false;

  const secret = process.env.AI_GENERATION_SECRET || getFromDotEnvFile('AI_GENERATION_SECRET');

  beforeAll(async () => {
    strapiReady = await isStrapiRunning();

    if (!strapiReady) {
      console.warn(`\n⚠️  Strapi is not running at ${E2E_CONFIG.strapiUrl}\nTo run E2E tests, use: npm run test:e2e:run\n`);
      return;
    }

    knex = await createDbConnection();

    const linkTable = await findPostGameLinkTable(knex);
    if (linkTable) {
      await safeDeleteAll(knex, linkTable);
    }
    await safeDeleteAll(knex, 'posts');
  }, 120000);

  afterAll(async () => {
    if (knex) {
      await knex.destroy();
    }
  });

  it('creates a draft post with comprehensive validation', async ({ skip }) => {
    const testStartTime = Date.now();
    const TEST_NAME = 'creates-draft-post-comprehensive-validation';
    const TEST_IGDB_ID = 119388; // Zelda TOTK

    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const headerSecret = secret || mustGetEnv('AI_GENERATION_SECRET');

    // Check IGDB/AI configuration
    const igdbStatusRes = await fetch(`${E2E_CONFIG.strapiUrl}/api/game-fetcher/status`);
    if (!igdbStatusRes.ok) {
      skip();
      return;
    }
    const igdbStatusJson = (await igdbStatusRes.json()) as { configured?: boolean };
    if (!igdbStatusJson.configured) {
      skip();
      return;
    }

    const aiStatus = await fetch(`${E2E_CONFIG.strapiUrl}/api/game-fetcher/ai-status`);
    if (!aiStatus.ok) {
      skip();
      return;
    }
    const aiJson = (await aiStatus.json()) as { configured?: boolean };
    if (!aiJson.configured) {
      skip();
      return;
    }

    // Act: call the article generator endpoint with extended timeout (AI generation is slow)
    const response = await fetchWithExtendedTimeout(`${E2E_CONFIG.strapiUrl}/api/article-generator/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ai-generation-secret': headerSecret,
      },
      body: JSON.stringify({
        igdbId: TEST_IGDB_ID,
        instruction: 'Write a very short beginner guide for the first hour. Use only 3 sections.',
        publish: false,
      }),
      timeoutMs: 300000, // 5 minutes for article generation
    });

    const responseText = await response.text();
    let json: any;
    try {
      json = JSON.parse(responseText);
    } catch {
      json = { raw: responseText, parseError: true };
    }

    // Collect all validation issues
    const validationIssues: E2EValidationIssue[] = [];
    const dbAssertions: Record<string, unknown> = {};

    // Basic response validation
    if (!response.ok) {
      validationIssues.push({
        severity: 'error',
        field: 'response.status',
        message: `Expected 2xx status, got ${response.status}`,
        actual: response.status,
        expected: '2xx',
      });
    }

    if (!json?.success) {
      validationIssues.push({
        severity: 'error',
        field: 'response.success',
        message: 'Response success flag is not true',
        actual: json?.success,
      });
    }

    if (!json?.post?.documentId) {
      validationIssues.push({
        severity: 'error',
        field: 'response.post.documentId',
        message: 'Post documentId is missing',
      });
    }

    // Validate draft structure, content, metadata, plan, game
    if (json?.draft) {
      validationIssues.push(...validateStructure(json.draft));
      if (json.draft.markdown) {
        validationIssues.push(...validateContentQuality(json.draft.markdown));
      }
      if (json.draft.metadata) {
        validationIssues.push(...validateMetadata(json.draft.metadata));
      }
      if (json.draft.plan) {
        validationIssues.push(...validatePlan(json.draft.plan));
      }
    } else {
      validationIssues.push({
        severity: 'error',
        field: 'response.draft',
        message: 'Draft object is missing from response',
      });
    }

    // Validate game info
    if (json?.game) {
      validationIssues.push(...validateGameInfo(json.game));
    } else {
      validationIssues.push({
        severity: 'error',
        field: 'response.game',
        message: 'Game info is missing from response',
      });
    }

    // Validate models
    if (!json?.models) {
      validationIssues.push({ severity: 'error', field: 'response.models', message: 'Models info is missing' });
    } else {
      for (const agent of ['scout', 'editor', 'specialist']) {
        if (typeof json.models[agent] !== 'string' || json.models[agent].length === 0) {
          validationIssues.push({
            severity: 'error',
            field: `response.models.${agent}`,
            message: `${agent} model must be a non-empty string`,
            actual: json.models[agent],
          });
        }
      }
    }

    // Database assertions
    if (json?.post?.documentId && knex) {
      const postDocumentId = json.post.documentId;

      const postRow = await knex('posts')
        .select('id', 'document_id', 'title', 'locale', 'published_at')
        .where({ document_id: postDocumentId })
        .first();

      dbAssertions.postExists = Boolean(postRow);
      dbAssertions.postDocumentId = postRow?.document_id;
      dbAssertions.postLocale = postRow?.locale;
      dbAssertions.postIsPublished = postRow?.published_at !== null;

      if (!postRow) {
        validationIssues.push({
          severity: 'error',
          field: 'database.post',
          message: 'Post not found in database',
          expected: postDocumentId,
        });
      } else {
        if (postRow.locale !== 'en') {
          validationIssues.push({
            severity: 'error',
            field: 'database.post.locale',
            message: 'Post locale should be EN',
            actual: postRow.locale,
            expected: 'en',
          });
        }
        if (postRow.published_at !== null) {
          validationIssues.push({
            severity: 'error',
            field: 'database.post.published_at',
            message: 'Draft post should not be published',
            actual: postRow.published_at,
          });
        }
      }

      // Validate game-post link
      const linkTable = await findPostGameLinkTable(knex);
      dbAssertions.linkTableFound = linkTable;

      if (linkTable && postRow) {
        const gameCols = await getTableColumns(knex, 'games');
        const igdbCol = gameCols.has('igdb_id') ? 'igdb_id' : gameCols.has('igdbId') ? 'igdbId' : null;

        if (igdbCol) {
          const gameRows = await knex('games')
            .select('id', 'document_id', 'name', 'published_at', 'locale')
            .where({ [igdbCol]: TEST_IGDB_ID, locale: 'en' });

          dbAssertions.gameFound = gameRows.length > 0;
          dbAssertions.gameName = gameRows[0]?.name;
          dbAssertions.gameDocumentId = gameRows[0]?.document_id;

          if (gameRows.length === 0) {
            validationIssues.push({
              severity: 'error',
              field: 'database.game',
              message: 'Game not found in database',
              expected: `IGDB ID: ${TEST_IGDB_ID}`,
            });
          } else {
            const gameIds = gameRows.map((g: any) => Number(g.id));
            const linkCols = await getTableColumns(knex, linkTable);
            const postIdCol = linkCols.has('post_id') ? 'post_id' : linkCols.has('postId') ? 'postId' : null;
            const gameIdCol = linkCols.has('game_id') ? 'game_id' : linkCols.has('gameId') ? 'gameId' : null;

            if (postIdCol && gameIdCol) {
              const links = await knex(linkTable)
                .select('*')
                .where({ [postIdCol]: postRow.id })
                .whereIn(gameIdCol, gameIds);

              dbAssertions.postGameLinked = links.length > 0;

              if (links.length === 0) {
                validationIssues.push({
                  severity: 'error',
                  field: 'database.link',
                  message: 'Post is not linked to game in database',
                });
              }
            }
          }
        }
      }
    }

    // Log validation summary
    logValidationSummary(validationIssues);

    // Save test results to file
    const testResult = createTestResult(
      TEST_NAME,
      testStartTime,
      json,
      validationIssues,
      dbAssertions,
      { igdbId: TEST_IGDB_ID, gameName: json?.game?.name }
    );

    const savedPath = saveTestResult(testResult);
    console.log(`\n📄 Test results saved to: ${savedPath}`);

    // Assert: no errors (warnings are allowed)
    const errors = validationIssues.filter((i) => i.severity === 'error');
    expect(errors.length, `Validation errors found: ${errors.map((e) => e.message).join('; ')}`).toBe(0);

    // Additional expect assertions for core functionality
    expect(response.ok).toBe(true);
    expect(json?.success).toBe(true);
    expect(json?.post?.documentId).toBeTruthy();
    expect(json?.draft).toBeTruthy();
    expect(json?.game?.documentId).toBeTruthy();
    expect(dbAssertions.postExists).toBe(true);
    expect(dbAssertions.postGameLinked).toBe(true);
  }, 300000);

  it(
    'imports game by igdbId, publishes EN post, and auto-creates ES locale on publish',
    async ({ skip }) => {
      const testStartTime = Date.now();
      const TEST_NAME = 'imports-game-publishes-post-creates-es-locale';
      const TEST_IGDB_ID = 119388;

      if (!strapiReady || !knex) {
        skip();
        return;
      }

      const headerSecret = secret || mustGetEnv('AI_GENERATION_SECRET');

      const igdbStatusRes = await fetch(`${E2E_CONFIG.strapiUrl}/api/game-fetcher/status`);
      if (!igdbStatusRes.ok) {
        skip();
        return;
      }
      const igdbStatusJson = (await igdbStatusRes.json()) as { configured?: boolean };
      if (!igdbStatusJson.configured) {
        skip();
        return;
      }

      const aiStatus = await fetch(`${E2E_CONFIG.strapiUrl}/api/game-fetcher/ai-status`);
      if (!aiStatus.ok) {
        skip();
        return;
      }
      const aiJson = (await aiStatus.json()) as { configured?: boolean };
      if (!aiJson.configured) {
        skip();
        return;
      }

      // Clean to ensure import path is exercised
      await cleanDatabase(knex);

      const linkTable = await findPostGameLinkTable(knex);
      if (linkTable) await safeDeleteAll(knex, linkTable);
      await safeDeleteAll(knex, 'posts');

      // Call article generator with extended timeout (AI generation + game import is slow)
      const response = await fetchWithExtendedTimeout(`${E2E_CONFIG.strapiUrl}/api/article-generator/generate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ai-generation-secret': headerSecret,
        },
        body: JSON.stringify({
          igdbId: TEST_IGDB_ID,
          instruction: 'Write a beginner guide for the first 30 minutes. Keep it concise.',
          publish: true,
        }),
        timeoutMs: 600000, // 10 minutes for full import + generation + publish
      });

      const responseText = await response.text();
      let json: any;
      try {
        json = JSON.parse(responseText);
      } catch {
        json = { raw: responseText, parseError: true };
      }

      const validationIssues: E2EValidationIssue[] = [];
      const dbAssertions: Record<string, unknown> = {};

      if (!response.ok) {
        validationIssues.push({
          severity: 'error',
          field: 'response.status',
          message: `Expected 2xx status, got ${response.status}`,
          actual: response.status,
        });
      }

      // Validate draft structure
      if (json?.draft) {
        validationIssues.push(...validateStructure(json.draft));
        if (json.draft.markdown) {
          validationIssues.push(...validateContentQuality(json.draft.markdown));
        }
        if (json.draft.metadata) {
          validationIssues.push(...validateMetadata(json.draft.metadata));
        }
      }

      // Validate published flag
      if (json?.published !== true) {
        validationIssues.push({
          severity: 'error',
          field: 'response.published',
          message: 'Response should indicate post was published',
          actual: json?.published,
          expected: true,
        });
      }

      // Wait for ES locale
      const postDocumentId = json?.post?.documentId;
      dbAssertions.postDocumentId = postDocumentId;

      if (postDocumentId) {
        const start = Date.now();
        const timeoutMs = 180000;
        let esRow: any = null;

        while (Date.now() - start < timeoutMs) {
          esRow = await knex('posts')
            .select('id', 'document_id', 'locale', 'title', 'content', 'published_at')
            .where({ document_id: postDocumentId, locale: 'es' })
            .whereNotNull('published_at')
            .first();

          if (esRow) break;
          await new Promise((r) => setTimeout(r, 2000));
        }

        dbAssertions.esLocaleCreated = Boolean(esRow);
        dbAssertions.esLocalePublished = esRow?.published_at !== null;

        if (!esRow) {
          validationIssues.push({
            severity: 'error',
            field: 'database.es_locale',
            message: 'ES locale was not created within timeout',
          });
        } else {
          const esContent = String(esRow.content || '');
          const hasSpanishContent = /(gu[ií]a|consejo|paso|primeros|minutos)/i.test(esContent);
          dbAssertions.esContentHasSpanish = hasSpanishContent;

          if (!hasSpanishContent) {
            validationIssues.push({
              severity: 'warning',
              field: 'database.es_locale.content',
              message: 'ES content may not be properly translated (no common Spanish words found)',
            });
          }
        }
      }

      logValidationSummary(validationIssues);

      const testResult = createTestResult(
        TEST_NAME,
        testStartTime,
        json,
        validationIssues,
        dbAssertions,
        { igdbId: TEST_IGDB_ID, gameName: json?.game?.name }
      );

      const savedPath = saveTestResult(testResult);
      console.log(`\n📄 Test results saved to: ${savedPath}`);

      const errors = validationIssues.filter((i) => i.severity === 'error');
      expect(errors.length, `Validation errors found: ${errors.map((e) => e.message).join('; ')}`).toBe(0);

      expect(json?.success).toBe(true);
      expect(json?.post?.documentId).toBeTruthy();
      expect(dbAssertions.esLocaleCreated).toBe(true);
    },
    900000
  );
});
