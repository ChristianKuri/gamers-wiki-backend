/**
 * AI Model Comparison Test: Game Resolver (IGDB candidates → LLM pick)
 *
 * Produces a Markdown + JSON report similar to `scripts/test-ai-game-descriptions.ts`.
 *
 * What it tests:
 * - Calls the running Strapi endpoints:
 *   - GET /api/game-fetcher/search?q=...&limit=...
 *   - GET /api/game-fetcher/resolve?q=...&limit=...&model=... (requires x-ai-generation-secret)
 *
 * Requirements:
 * - Strapi running (recommended: test env on port 1338 + strapi_test DB)
 * - IGDB creds configured (for /search)
 * - OPENROUTER_API_KEY configured (for /resolve)
 * - AI_GENERATION_SECRET configured (for /resolve auth)
 *
 * Usage:
 *   npx tsx scripts/test-ai-game-resolver.ts
 *
 * Optional env:
 *   STRAPI_URL=http://localhost:1338
 *   GAME_RESOLVER_MODELS="modelA,modelB,modelC"
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// ----------------------------------------------------------------------------
// Minimal dotenv loader (no deps)
// ----------------------------------------------------------------------------
function loadEnvFile(): void {
  const envPaths = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '.env.local'),
    resolve(__dirname, '../.env'),
    resolve(__dirname, '../.env.local'),
  ];

  for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue;
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const rawValue = trimmed.slice(idx + 1).trim();
      const value = rawValue.replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = value;
    }
    // eslint-disable-next-line no-console
    console.log(`📁 Loaded env from: ${envPath}`);
    return;
  }
}

loadEnvFile();

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------
const STRAPI_URL = process.env.STRAPI_URL || 'http://localhost:1338';
const RESOLVE_TIMEOUT_MS = parseInt(process.env.GAME_RESOLVER_TIMEOUT_MS || '90000', 10); // 90s default
const SEARCH_TIMEOUT_MS = parseInt(process.env.GAME_RESOLVER_SEARCH_TIMEOUT_MS || '30000', 10); // 30s default

const DEFAULT_MODELS_TO_TEST = [
  'google/gemini-3-pro-preview',
  'google/gemini-3-flash-preview',
  'moonshotai/kimi-k2-thinking',
  'deepseek/deepseek-v3.2',
  'openai/gpt-5-mini',
  'minimax/minimax-m2',
] as const;

const MODELS_TO_TEST: readonly string[] = (() => {
  const raw = process.env.GAME_RESOLVER_MODELS;
  if (!raw) return DEFAULT_MODELS_TO_TEST;
  const models = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return models.length > 0 ? models : DEFAULT_MODELS_TO_TEST;
})();

type Difficulty = 'easy' | 'medium' | 'hard';
type Case = { difficulty: Difficulty; query: string; expectedNames: string[]; limit: number };

const TEST_CASES: readonly Case[] = [
  // --------------------------------------------------------------------------
  // Dataset: 20 "imperfect" game names (user-provided)
  // Validation:
  // - We resolve the expected IGDB ids by searching IGDB for each expected title.
  // - A run is "correct" if the resolver returns an IGDB id in the expected-id set.
  // --------------------------------------------------------------------------

  // Category 1: Missing subtitles / implied numbering
  { difficulty: 'medium', query: 'Zelda Tears', expectedNames: ['The Legend of Zelda: Tears of the Kingdom'], limit: 10 },
  { difficulty: 'hard', query: 'Horizon 2', expectedNames: ['Horizon Forbidden West'], limit: 10 },
  { difficulty: 'medium', query: 'Resident Evil 8', expectedNames: ['Resident Evil Village'], limit: 10 },
  { difficulty: 'hard', query: 'Jedi 2', expectedNames: ['Star Wars Jedi: Survivor'], limit: 10 },
  { difficulty: 'hard', query: 'God of War 4', expectedNames: ['God of War'], limit: 10 }, // 2018 reboot is usually just "God of War"
  { difficulty: 'hard', query: 'Final Fantasy 7-2', expectedNames: ['Final Fantasy VII Rebirth'], limit: 10 },
  { difficulty: 'medium', query: 'Doom 5', expectedNames: ['DOOM Eternal'], limit: 10 },

  // Category 2: Rebranded / renamed
  { difficulty: 'hard', query: 'Fifa 24', expectedNames: ['EA Sports FC 24'], limit: 10 },
  { difficulty: 'hard', query: 'Yakuza 8', expectedNames: ['Like a Dragon: Infinite Wealth'], limit: 10 },
  { difficulty: 'hard', query: 'Budokai 4', expectedNames: ['Dragon Ball: Sparking! ZERO'], limit: 10 },
  { difficulty: 'hard', query: 'Assassins Red', expectedNames: ["Assassin's Creed Shadows"], limit: 10 },

  // Category 3: Misremembered / phonetic
  { difficulty: 'medium', query: 'Harry Potter Legacy', expectedNames: ['Hogwarts Legacy'], limit: 10 },
  { difficulty: 'easy', query: 'Elder Ring', expectedNames: ['Elden Ring'], limit: 10 },
  { difficulty: 'easy', query: 'Near Automata', expectedNames: ['NieR: Automata'], limit: 10 },
  { difficulty: 'hard', query: 'Skyrim 2', expectedNames: ['The Elder Scrolls VI'], limit: 10 },
  { difficulty: 'hard', query: 'Mario Hat Game', expectedNames: ['Super Mario Odyssey'], limit: 10 },

  // Category 4: Ambiguous abbreviations
  {
    difficulty: 'hard',
    query: 'Cod MW2',
    expectedNames: [
      'Call of Duty: Modern Warfare II', // 2022
      'Call of Duty: Modern Warfare 2',  // 2009 (IGDB often drops the roman numerals)
    ],
    limit: 10,
  },
  { difficulty: 'easy', query: 'Gta Andreas', expectedNames: ['Grand Theft Auto: San Andreas'], limit: 10 },
  { difficulty: 'easy', query: 'Wow Classic', expectedNames: ['World of Warcraft Classic'], limit: 10 },
  { difficulty: 'hard', query: 'Kotor Remake', expectedNames: ['Star Wars: Knights of the Old Republic Remake'], limit: 10 },
];

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------
type SearchResult = { igdbId: number; name: string };

type ResolveResponse = {
  success?: boolean;
  query?: string;
  igdbId?: number;
  pick?: { confidence?: string; reason?: string };
  candidates?: Array<{ igdbId?: number; name?: string; slug?: string }>;
  model?: string;
};

type ABResult = {
  model: string;
  case: Case;
  expectedIgdbIds: number[];
  expectedNames: string[];
  pickedIgdbId: number | null;
  pickedName?: string;
  ok: boolean;
  durationMs: number;
  confidence?: string;
  reason?: string;
  error?: string;
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function getExpectedIgdbIdFromSearch(tc: Case): Promise<{ expectedIgdbId: number | null; candidates: SearchResult[] }> {
  // Deprecated: we no longer derive "expected" from the imperfect query itself,
  // because /search can vary by query wording. Instead, we derive expected ids
  // by searching for each expected official title.
  return { expectedIgdbId: null, candidates: [] };
}

async function resolveWithModel(tc: Case, model: string, secret: string): Promise<{ data?: ResolveResponse; durationMs: number; error?: string }> {
  const start = Date.now();
  try {
    const url =
      `${STRAPI_URL}/api/game-fetcher/resolve?q=${encodeURIComponent(tc.query)}&limit=${tc.limit}` +
      `&model=${encodeURIComponent(model)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-ai-generation-secret': secret },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const text = await res.text();
    const durationMs = Date.now() - start;

    if (!res.ok) {
      return { durationMs, error: `${res.status}: ${text}` };
    }

    return { durationMs, data: JSON.parse(text) as ResolveResponse };
  } catch (e) {
    const msg =
      e instanceof Error && e.name === 'AbortError'
        ? `Request timed out after ${RESOLVE_TIMEOUT_MS}ms`
        : e instanceof Error
          ? e.message
          : String(e);
    return { durationMs: Date.now() - start, error: msg };
  }
}

async function searchExactTitleToIgdbId(title: string, limit: number): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${STRAPI_URL}/api/game-fetcher/search?q=${encodeURIComponent(title)}&limit=${limit}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { results?: SearchResult[] };
    const candidates = Array.isArray(json.results) ? json.results : [];
    const match = candidates.find((c) => c.name.toLowerCase() === title.toLowerCase());
    return match?.igdbId ?? null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function pickNameFromCandidates(candidates: ResolveResponse['candidates'], igdbId: number | null): string | undefined {
  if (!igdbId) return undefined;
  const found = (candidates ?? []).find((c) => typeof c.igdbId === 'number' && c.igdbId === igdbId);
  return typeof found?.name === 'string' ? found.name : undefined;
}

// ----------------------------------------------------------------------------
// Report output (Markdown + JSON)
// ----------------------------------------------------------------------------
const RESULTS_DIR = resolve(__dirname, 'test-results', 'game-resolver');

function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function saveResults(payload: unknown): { jsonPath: string; mdPath: string } {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  const timestamp = getTimestamp();

  const jsonPath = resolve(RESULTS_DIR, `${timestamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2));

  const mdPath = resolve(RESULTS_DIR, `${timestamp}.md`);

  const data = payload as {
    timestamp: string;
    strapiUrl: string;
    models: string[];
    cases: Case[];
    results: ABResult[];
  };

  const byModel = new Map<string, ABResult[]>();
  for (const r of data.results) {
    const arr = byModel.get(r.model) ?? [];
    arr.push(r);
    byModel.set(r.model, arr);
  }

  let md = `# AI Model Test: Game Resolver (IGDB → LLM pick)\n\n`;
  md += `**Date:** ${new Date().toLocaleString()}\n`;
  md += `**Strapi:** ${data.strapiUrl}\n`;
  md += `**Cases:** ${data.cases.length}\n`;
  md += `**Models:** ${data.models.length}\n\n`;

  md += `## Summary (per model)\n\n`;
  md += `**Success criteria:** picked IGDB id must match the expected IGDB id for the official target title.\n`;
  md += `Expected IGDB ids are computed by searching IGDB for each target title and taking an exact name match.\n\n`;

  md += `| Model | Correct | Total (scored) | Skipped (no expected id) | Success % | Avg Duration |\n`;
  md += `|------|---------:|---------------:|-------------------------:|----------:|-------------:|\n`;

  for (const model of data.models) {
    const arr = byModel.get(model) ?? [];
    const scored = arr.filter((r) => r.expectedIgdbIds.length > 0).length;
    const ok = arr.filter((r) => r.ok).length;
    const skipped = arr.filter((r) => r.expectedIgdbIds.length === 0).length;
    const avg = arr.length > 0 ? Math.round(arr.reduce((s, r) => s + r.durationMs, 0) / arr.length) : 0;
    const pct = scored > 0 ? Math.round((ok / scored) * 100) : 0;
    md += `| ${model} | ${ok} | ${scored} | ${skipped} | ${pct}% | ${formatDuration(avg)} |\n`;
  }

  md += `\n## Results (per case)\n\n`;
  for (const tc of data.cases) {
    md += `### (${tc.difficulty}) ${tc.query}\n\n`;
    md += `- **Expected titles:** ${tc.expectedNames.join(' OR ')}\n`;

    const caseResults = data.results.filter((r) => r.case.query === tc.query);
    const expectedIgdbIds = caseResults.find((r) => r.expectedIgdbIds)?.expectedIgdbIds ?? [];
    md += `- **Expected igdbId(s):** ${expectedIgdbIds.length > 0 ? expectedIgdbIds.join(', ') : 'N/A (could not resolve expected title to IGDB id)'}\n\n`;

    md += `| Model | Picked name | Picked igdbId | OK | Duration | Confidence |\n`;
    md += `|------|------------|---------------:|:--:|---------:|------------|\n`;
    for (const r of caseResults) {
      const ok = r.ok ? '✅' : '❌';
      md += `| ${r.model} | ${r.pickedName ?? ''} | ${r.pickedIgdbId ?? 'N/A'} | ${ok} | ${formatDuration(r.durationMs)} | ${r.confidence ?? ''} |\n`;
    }

    md += `\n`;
    for (const r of caseResults) {
      if (r.ok) continue;
      md += `- **${r.model} failure**: ${r.error ?? 'picked wrong igdbId'}\n`;
      if (r.reason) md += `  - **reason**: ${r.reason}\n`;
    }
    md += `\n---\n\n`;
  }

  writeFileSync(mdPath, md);
  return { jsonPath, mdPath };
}

// ----------------------------------------------------------------------------
// Runner
// ----------------------------------------------------------------------------
async function run(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('🎯 AI Model Test: Game Resolver');
  // eslint-disable-next-line no-console
  console.log(`   Strapi: ${STRAPI_URL}`);
  // eslint-disable-next-line no-console
  console.log(`   Models: ${MODELS_TO_TEST.length}`);
  // eslint-disable-next-line no-console
  console.log(`   Cases:  ${TEST_CASES.length}`);

  // Required for /resolve
  const secret = mustGetEnv('AI_GENERATION_SECRET');

  // Quick readiness check (with retries) - Strapi dev server can restart on file changes.
  {
    const start = Date.now();
    const timeoutMs = 60000;
    // eslint-disable-next-line no-console
    console.log(`⏳ Waiting for Strapi to be ready (up to ${Math.round(timeoutMs / 1000)}s)...`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Strapi not reachable at ${STRAPI_URL} after ${timeoutMs}ms`);
      }
      try {
        const statusRes = await fetch(`${STRAPI_URL}/api/game-fetcher/status`, { signal: AbortSignal.timeout(5000) });
        if (statusRes.ok) break;
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const results: ABResult[] = [];

  for (const tc of TEST_CASES) {
    const expectedIgdbIds: number[] = [];
    for (const title of tc.expectedNames) {
      const id = await searchExactTitleToIgdbId(title, 25);
      if (typeof id === 'number') expectedIgdbIds.push(id);
    }
    const uniqueExpected = [...new Set(expectedIgdbIds)];

    for (const model of MODELS_TO_TEST) {
      const resolved = await resolveWithModel(tc, model, secret);
      const pickedIgdbId = resolved.data?.igdbId ?? null;
      const pickedName = pickNameFromCandidates(resolved.data?.candidates, pickedIgdbId);
      const ok = uniqueExpected.length > 0 && pickedIgdbId !== null && uniqueExpected.includes(pickedIgdbId);
      results.push({
        model,
        case: tc,
        expectedIgdbIds: uniqueExpected,
        expectedNames: tc.expectedNames,
        pickedIgdbId,
        ...(pickedName ? { pickedName } : {}),
        ok,
        durationMs: resolved.durationMs,
        confidence: resolved.data?.pick?.confidence,
        reason: resolved.data?.pick?.reason,
        ...(resolved.error ? { error: resolved.error } : {}),
      });

      // eslint-disable-next-line no-console
      console.log(
        `[${tc.difficulty}] ${model} "${tc.query}" -> picked=${pickedIgdbId ?? 'N/A'} expected=${uniqueExpected.length > 0 ? uniqueExpected.join('|') : 'N/A'} ${ok ? '✅' : '❌'} (${formatDuration(
          resolved.durationMs
        )})`
      );
    }
  }

  const payload = {
    timestamp: new Date().toISOString(),
    strapiUrl: STRAPI_URL,
    models: [...MODELS_TO_TEST],
    cases: [...TEST_CASES],
    results,
  };

  const { jsonPath, mdPath } = saveResults(payload);
  // eslint-disable-next-line no-console
  console.log('\n✅ Saved results:');
  // eslint-disable-next-line no-console
  console.log(`- JSON: ${jsonPath}`);
  // eslint-disable-next-line no-console
  console.log(`- MD:   ${mdPath}`);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ Game resolver AB test failed:', err);
  process.exit(1);
});

