/**
 * Game Resolver A/B E2E
 *
 * Runs the resolver across multiple models and multiple queries, then prints a
 * small reliability report.
 *
 * This is NOT meant to be part of the default E2E suite because it is expensive
 * (multiple real LLM calls). Enable explicitly:
 *
 * RUN_E2E_TESTS=true RUN_AB_TESTS=true npm run test:e2e:run -- tests/game-fetcher/e2e/game-resolver.ab.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';

import { isStrapiRunning, E2E_CONFIG } from './setup';

const describeE2E =
  process.env.RUN_E2E_TESTS === 'true' && process.env.RUN_AB_TESTS === 'true' ? describe : describe.skip;

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

type Case = {
  difficulty: 'easy' | 'medium' | 'hard';
  query: string;
  expectedName: string;
  limit: number;
};

type Result = {
  model: string;
  case: Case;
  expectedIgdbId: number | null;
  pickedIgdbId: number | null;
  ok: boolean;
  confidence?: string;
  reason?: string;
  error?: string;
};

async function getExpectedIgdbIdFromSearch(tc: Case): Promise<number | null> {
  const searchRes = await fetch(
    `${E2E_CONFIG.strapiUrl}/api/game-fetcher/search?q=${encodeURIComponent(tc.query)}&limit=${tc.limit}`
  );
  if (!searchRes.ok) return null;
  const json = (await searchRes.json()) as { results?: SearchResult[] };
  const candidates = Array.isArray(json.results) ? json.results : [];
  const expected = candidates.find((c) => c.name.toLowerCase() === tc.expectedName.toLowerCase());
  return expected?.igdbId ?? null;
}

async function resolveWithModel(query: string, limit: number, model: string, secret: string) {
  const res = await fetch(
    `${E2E_CONFIG.strapiUrl}/api/game-fetcher/resolve?q=${encodeURIComponent(query)}&limit=${limit}&model=${encodeURIComponent(
      model
    )}`,
    { method: 'GET', headers: { 'x-ai-generation-secret': secret } }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text) as {
    success?: boolean;
    igdbId?: number;
    pick?: { confidence?: string; reason?: string };
  };
}

describeE2E('Game Resolver A/B E2E', () => {
  let strapiReady = false;
  const secret = process.env.AI_GENERATION_SECRET || getFromDotEnvFile('AI_GENERATION_SECRET');

  beforeAll(async () => {
    strapiReady = await isStrapiRunning();
  }, 120000);

  it(
    'prints per-model success rates across multiple queries',
    async ({ skip }) => {
      if (!strapiReady) {
        skip();
        return;
      }

      const headerSecret = secret || mustGetEnv('AI_GENERATION_SECRET');

      // Tune this list to whatever you want to compare.
      const models: readonly string[] = [
        'google/gemini-3-pro-preview',
        'google/gemini-3-flash-preview',
        'moonshotai/kimi-k2-thinking',
        'deepseek/deepseek-v3.2',
        'openai/gpt-5-mini',
        'minimax/minimax-m2',
      ];

      const cases: readonly Case[] = [
        { difficulty: 'easy', query: 'The Legend of Zelda: Tears of the Kingdom', expectedName: 'The Legend of Zelda: Tears of the Kingdom', limit: 10 },
        { difficulty: 'medium', query: 'Zelda TOTK', expectedName: 'The Legend of Zelda: Tears of the Kingdom', limit: 10 },
        { difficulty: 'hard', query: 'Tears of the Kingdom', expectedName: 'The Legend of Zelda: Tears of the Kingdom', limit: 10 },
        { difficulty: 'easy', query: 'Elden Ring', expectedName: 'Elden Ring', limit: 10 },
        { difficulty: 'medium', query: 'BG3', expectedName: "Baldur's Gate 3", limit: 10 },
        { difficulty: 'easy', query: 'Stardew Valley', expectedName: 'Stardew Valley', limit: 10 },
      ];

      const results: Result[] = [];

      for (const tc of cases) {
        const expectedIgdbId = await getExpectedIgdbIdFromSearch(tc);
        if (!expectedIgdbId) {
          // If IGDB changes results, skip this case (still produce useful output for the others).
          results.push({
            model: '(all)',
            case: tc,
            expectedIgdbId: null,
            pickedIgdbId: null,
            ok: false,
            error: 'Could not determine expectedIgdbId from /search results (no exact name match).',
          });
          continue;
        }

        for (const model of models) {
          try {
            const resolved = await resolveWithModel(tc.query, tc.limit, model, headerSecret);
            const pickedIgdbId = typeof resolved.igdbId === 'number' ? resolved.igdbId : null;
            const ok = pickedIgdbId === expectedIgdbId;
            results.push({
              model,
              case: tc,
              expectedIgdbId,
              pickedIgdbId,
              ok,
              confidence: resolved.pick?.confidence,
              reason: resolved.pick?.reason,
            });
          } catch (e) {
            results.push({
              model,
              case: tc,
              expectedIgdbId,
              pickedIgdbId: null,
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }

      // Print a compact report.
      const byModel = new Map<string, Result[]>();
      for (const r of results) {
        if (r.model === '(all)') continue;
        const arr = byModel.get(r.model) ?? [];
        arr.push(r);
        byModel.set(r.model, arr);
      }

      // eslint-disable-next-line no-console
      console.log('\n[AB] Game resolver reliability report\n');
      for (const [model, arr] of byModel) {
        const total = arr.length;
        const ok = arr.filter((r) => r.ok).length;
        // eslint-disable-next-line no-console
        console.log(`- ${model}: ${ok}/${total} correct`);
        for (const r of arr) {
          const status = r.ok ? 'OK' : 'FAIL';
          // eslint-disable-next-line no-console
          console.log(
            `  - [${status}] (${r.case.difficulty}) "${r.case.query}" → picked=${r.pickedIgdbId} expected=${r.expectedIgdbId}` +
              (r.confidence ? ` conf=${r.confidence}` : '') +
              (r.error ? ` error=${r.error}` : '')
          );
        }
      }

      // Basic safety assertion: at least one model must have at least 1 OK result,
      // otherwise something is fundamentally broken (IGDB/search, resolver endpoint, or auth).
      const anyOk = results.some((r) => r.ok);
      expect(anyOk).toBe(true);
    },
    600000
  );
});

