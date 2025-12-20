/**
 * Article Generator E2E Test
 *
 * Verifies:
 * - Strapi route POST /api/article-generator/generate works
 * - A draft Post is created in the database and linked to the game
 *
 * REQUIREMENTS:
 * - Strapi must be running (use npm run test:e2e:run)
 * - PostgreSQL test database must be available
 * - OPENROUTER_API_KEY must be configured (real calls)
 * - AI_GENERATION_SECRET must be configured (header auth)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import { readFileSync } from 'node:fs';

import { isStrapiRunning, createDbConnection, cleanDatabase, E2E_CONFIG } from '../../game-fetcher/e2e/setup';

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
      // Support common dotenv quoting styles:
      // AI_GENERATION_SECRET="secret" → secret
      // AI_GENERATION_SECRET='secret' → secret
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
  } catch {
    // Ignore missing .env (e.g., CI or different env handling)
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

describeE2E('Article Generator E2E', () => {
  let knex: Knex | undefined;
  let strapiReady = false;

  const secret = process.env.AI_GENERATION_SECRET || getFromDotEnvFile('AI_GENERATION_SECRET');

  beforeAll(async () => {
    // Check if Strapi is running
    strapiReady = await isStrapiRunning();

    if (!strapiReady) {
      console.warn(`\n⚠️  Strapi is not running at ${E2E_CONFIG.strapiUrl}\nTo run E2E tests, use: npm run test:e2e:run\n`);
      return;
    }

    // Create database connection
    knex = await createDbConnection();

    // Clean only what we create (leave seeded categories/authors alone)
    // Posts content type is new, so we delete link table rows first (if present).
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

  it('creates a draft post linked to the game', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    // Ensure the endpoint auth secret is configured for both Strapi and test.
    // Strapi reads process.env.AI_GENERATION_SECRET when it started.
    const headerSecret = secret || mustGetEnv('AI_GENERATION_SECRET');

    // Skip gracefully if Strapi isn't configured for IGDB/AI in this environment.
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

    const TEST_IGDB_ID = 119388; // Zelda TOTK

    // Act: call the article generator endpoint
    const response = await fetch(`${E2E_CONFIG.strapiUrl}/api/article-generator/generate`, {
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
    });

    const responseText = await response.text();
    const json = (() => {
      try {
        return JSON.parse(responseText) as any;
      } catch {
        return { raw: responseText } as any;
      }
    })();

    if (!response.ok) {
      throw new Error(`Expected 2xx from article generator, got ${response.status}: ${responseText}`);
    }

    expect(response.ok).toBe(true);
    expect(json?.success).toBe(true);
    expect(json?.post?.documentId).toBeTruthy();

    const postDocumentId: string = json.post.documentId;

    // Assert: post row exists in DB
    const postRow = await knex('posts')
      .select('id', 'document_id', 'title', 'locale', 'published_at')
      .where({ document_id: postDocumentId })
      .first();

    expect(postRow).toBeDefined();
    expect(postRow.document_id).toBe(postDocumentId);
    expect(postRow.locale).toBe('en');
    // Draft post should not be published
    expect(postRow.published_at).toBeNull();

    // Assert: it is linked to the game via the m2m link table
    const linkTable = await findPostGameLinkTable(knex);
    expect(linkTable).toBeTruthy();

    if (linkTable) {
      // posts_games_lnk uses FK ids (not document ids).
      // Look up the imported game rows by igdb_id and accept either draft or published id.
      const gameCols = await getTableColumns(knex, 'games');
      const igdbCol = gameCols.has('igdb_id') ? 'igdb_id' : gameCols.has('igdbId') ? 'igdbId' : null;
      if (!igdbCol) {
        throw new Error('Expected games table to have igdb_id / igdbId column');
      }

      const gameRows = await knex('games')
        .select('id', 'published_at', 'locale')
        .where({ [igdbCol]: TEST_IGDB_ID, locale: 'en' });

      expect(gameRows.length).toBeGreaterThan(0);
      const gameIds = gameRows.map((g: any) => Number(g.id));

      const linkCols = await getTableColumns(knex, linkTable);
      const postIdCol = linkCols.has('post_id') ? 'post_id' : linkCols.has('postId') ? 'postId' : null;
      const gameIdCol = linkCols.has('game_id') ? 'game_id' : linkCols.has('gameId') ? 'gameId' : null;
      if (!postIdCol || !gameIdCol) {
        throw new Error(`Unexpected link table columns for ${linkTable}`);
      }

      const links = await knex(linkTable)
        .select('*')
        .where({ [postIdCol]: postRow.id })
        .whereIn(gameIdCol, gameIds);

      expect(links.length).toBeGreaterThan(0);
    }
  }, 300000);

  it(
    'imports game by igdbId, publishes EN post, and auto-creates ES locale on publish',
    async ({ skip }) => {
      if (!strapiReady || !knex) {
        skip();
        return;
      }

      // Requires real external APIs (IGDB + OpenRouter + Tavily optional) and secret header.
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

      // Clean game-related imported data to ensure the import path is exercised.
      await cleanDatabase(knex);

      const linkTable = await findPostGameLinkTable(knex);
      if (linkTable) await safeDeleteAll(knex, linkTable);
      await safeDeleteAll(knex, 'posts');

      const TEST_IGDB_ID = 119388; // Zelda TOTK (same as game-import.e2e)

      const response = await fetch(`${E2E_CONFIG.strapiUrl}/api/article-generator/generate`, {
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
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Expected 2xx from article generator, got ${response.status}: ${responseText}`);
      }

      const json = JSON.parse(responseText) as any;
      expect(json?.success).toBe(true);
      expect(json?.post?.documentId).toBeTruthy();

      const postDocumentId: string = json.post.documentId;

      // Wait for ES locale to be generated/published by lifecycle (async relative to publish).
      const start = Date.now();
      const timeoutMs = 180000; // 3 minutes
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

      expect(esRow).toBeTruthy();
      expect(esRow.document_id).toBe(postDocumentId);
      expect(esRow.locale).toBe('es');

      // Basic sanity: Spanish content should include some common Spanish words.
      const esContent = String(esRow.content || '');
      expect(esContent).toMatch(/(gu[ií]a|consejo|paso|primeros|minutos)/i);
    },
    900000
  );
});

