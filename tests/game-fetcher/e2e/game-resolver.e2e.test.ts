/**
 * Game Resolver E2E Test
 *
 * Verifies:
 * - GET /api/game-fetcher/resolve picks the correct IGDB game from candidates
 *
 * This test uses:
 * - Real IGDB search results
 * - Real LLM (OpenRouter) selection
 * - Protected by x-ai-generation-secret
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';

import { isStrapiRunning, E2E_CONFIG } from './setup';

const describeE2E = process.env.RUN_E2E_TESTS === 'true' ? describe : describe.skip;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
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
    // ignore
  }
  return undefined;
}

type SearchResult = { igdbId: number; name: string };

describeE2E('Game Resolver E2E', () => {
  let strapiReady = false;
  const secret = process.env.AI_GENERATION_SECRET || getFromDotEnvFile('AI_GENERATION_SECRET');

  beforeAll(async () => {
    strapiReady = await isStrapiRunning();
  }, 120000);

  it(
    'resolves the correct game id for multiple queries (easy → hard)',
    async ({ skip }) => {
      if (!strapiReady) {
        skip();
        return;
      }

      const headerSecret = secret || mustGetEnv('AI_GENERATION_SECRET');

      const testCases: Array<{ difficulty: 'easy' | 'medium' | 'hard'; query: string; expectedName: string; limit?: number }> = [
        // Zelda TOTK (tests abbreviation + missing franchise prefix)
        { difficulty: 'easy', query: 'The Legend of Zelda: Tears of the Kingdom', expectedName: 'The Legend of Zelda: Tears of the Kingdom', limit: 10 },
        { difficulty: 'medium', query: 'Zelda TOTK', expectedName: 'The Legend of Zelda: Tears of the Kingdom', limit: 10 },
        { difficulty: 'hard', query: 'Tears of the Kingdom', expectedName: 'The Legend of Zelda: Tears of the Kingdom', limit: 10 },

        // Other popular titles (ensure the resolver isn't overfit to Zelda-only)
        { difficulty: 'easy', query: 'Elden Ring', expectedName: 'Elden Ring', limit: 10 },
        { difficulty: 'medium', query: 'BG3', expectedName: "Baldur's Gate 3", limit: 10 },
        { difficulty: 'easy', query: 'Stardew Valley', expectedName: 'Stardew Valley', limit: 10 },
      ];

      let validatedCases = 0;

      for (const tc of testCases) {
        // 1) Get candidates from the public search endpoint
        const searchRes = await fetch(
          `${E2E_CONFIG.strapiUrl}/api/game-fetcher/search?q=${encodeURIComponent(tc.query)}&limit=${tc.limit ?? 10}`
        );
        expect(searchRes.ok).toBe(true);
        const searchJson = (await searchRes.json()) as { results?: SearchResult[] };

        const candidates = Array.isArray(searchJson.results) ? searchJson.results : [];
        expect(candidates.length).toBeGreaterThan(0);

        // "Correct" is defined as exact name match (case-insensitive) among candidates.
        const expected = candidates.find((c) => c.name.toLowerCase() === tc.expectedName.toLowerCase());
        if (!expected) {
          // If IGDB changes naming/candidates, skip this case (but keep the suite running).
          continue;
        }

        validatedCases++;

        // 2) Ask the resolver endpoint to pick from IGDB (LLM constrained to candidates)
        const resolveRes = await fetch(
          `${E2E_CONFIG.strapiUrl}/api/game-fetcher/resolve?q=${encodeURIComponent(tc.query)}&limit=${tc.limit ?? 10}`,
          {
            method: 'GET',
            headers: {
              'x-ai-generation-secret': headerSecret,
            },
          }
        );

        const resolveText = await resolveRes.text();
        if (!resolveRes.ok) {
          throw new Error(`Expected 2xx from resolver, got ${resolveRes.status}: ${resolveText}`);
        }

        const resolveJson = JSON.parse(resolveText) as {
          success?: boolean;
          igdbId?: number;
          pick?: { confidence?: string; reason?: string };
        };

        expect(resolveJson.success).toBe(true);
        expect(resolveJson.igdbId).toBe(expected.igdbId);
        expect(resolveJson.pick?.confidence).toBeTruthy();
        expect(resolveJson.pick?.reason).toBeTruthy();
      }

      // Guard against "silent pass" if IGDB results shift unexpectedly.
      expect(validatedCases).toBeGreaterThanOrEqual(3);
    },
    300000
  );
});

