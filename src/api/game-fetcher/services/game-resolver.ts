import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';

import { getModel } from '../../../ai/config/utils';
import type { IGDBSearchResult } from './igdb';

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || '',
});

const PickSchema = z.object({
  igdbId: z.number().int().positive(),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string().min(1).max(400),
});

const NormalizeSchema = z.object({
  normalizedNames: z.array(z.string().min(1).max(200)).min(1).max(5),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string().min(1).max(400).optional(),
});

export type PickedIGDBGame = z.infer<typeof PickSchema>;
export type NormalizedGameQuery = z.infer<typeof NormalizeSchema>;

export interface GameResolverOptions {
  /**
   * Override which model is used for the GAME_MATCHER task.
   * If omitted, uses getModel('GAME_MATCHER') (env override > default).
   */
  model?: string;
}

function formatCandidates(candidates: readonly IGDBSearchResult[]): string {
  return candidates
    .slice(0, 12)
    .map((c, idx) => {
      const release = c.releaseDate ? `releaseDate=${c.releaseDate}` : 'releaseDate=?';
      const platforms = c.platforms?.length ? `platforms=${c.platforms.join(',')}` : 'platforms=?';
      const dev = c.developer ? `dev=${c.developer}` : 'dev=?';
      return `${idx + 1}. igdbId=${c.igdbId} name="${c.name}" slug="${c.slug}" ${release} ${platforms} ${dev}`;
    })
    .join('\n');
}

/**
 * Normalize a user query to the official game name(s) that IGDB will recognize.
 * Handles abbreviations, typos, colloquial names, and variations.
 * 
 * Examples:
 * - "Fifa 24" → ["EA Sports FC 24"]
 * - "Jedi 2" → ["Star Wars Jedi: Survivor"]
 * - "Near Automata" → ["NieR: Automata"]
 * - "Elder Ring" → ["Elden Ring"]
 * 
 * Returns multiple normalized names in order of preference, allowing fallback
 * if the first search returns no results.
 */
export async function normalizeGameQuery(
  query: string,
  options?: GameResolverOptions
): Promise<NormalizedGameQuery> {
  const modelId = options?.model ?? getModel('GAME_MATCHER');

  const { object } = await generateObject({
    model: openrouter(modelId),
    schema: NormalizeSchema,
    system:
      'You are a game name normalizer. Your job is to convert user queries (which may be abbreviated, ' +
      'typo-ridden, or colloquial) into the official game name(s) that IGDB (Internet Game Database) will recognize. ' +
      'Return 1-5 normalized names in order of preference. The first name should be the most likely official title.',
    prompt: `User query: "${query}"

Rules:
- Return the official, full game title(s) as they appear in IGDB.
- Handle abbreviations (e.g., "Fifa 24" → "EA Sports FC 24", "Jedi 2" → "Star Wars Jedi: Survivor").
- Handle typos (e.g., "Elder Ring" → "Elden Ring", "Near Automata" → "NieR: Automata").
- Handle colloquial names (e.g., "Mario Hat Game" → "Super Mario Odyssey").
- If the query is already an official name, return it as-is.
- Return multiple variants if ambiguous (e.g., ["Call of Duty: Modern Warfare 2", "Call of Duty: Modern Warfare II"]).
- Set confidence based on how certain you are about the normalization.
- Return ONLY JSON matching the schema.`,
  });

  return object;
}

/**
 * Use an LLM to pick the best IGDB candidate for a given user query.
 * We constrain the model to select one of the provided candidates.
 */
export async function pickBestIGDBGame(
  query: string,
  candidates: readonly IGDBSearchResult[],
  options?: GameResolverOptions
): Promise<PickedIGDBGame> {
  if (candidates.length === 0) {
    throw new Error('No IGDB candidates provided');
  }

  // If only one candidate exists, no need to spend tokens.
  if (candidates.length === 1) {
    return { igdbId: candidates[0].igdbId, confidence: 'high', reason: 'Only one candidate returned.' };
  }

  const candidateIds = new Set(candidates.map((c) => c.igdbId));

  const modelId = options?.model ?? getModel('GAME_MATCHER');

  const { object } = await generateObject({
    model: openrouter(modelId),
    schema: PickSchema,
    system:
      'You are a game resolver. Your job is to select the correct IGDB game ID from the provided candidates. ' +
      'Prefer the main/base game (not DLC/editions) and the most widely known release when ambiguous.',
    prompt: `User query:
${query}

Candidates (choose ONE igdbId from this list only):
${formatCandidates(candidates)}

Rules:
- Return ONLY JSON matching the schema.
- igdbId MUST be one of the candidates above.
- If unsure, choose the most likely candidate and set confidence=low.`,
  });

  if (!candidateIds.has(object.igdbId)) {
    // Hard guard: never allow selecting an ID outside the set.
    return {
      igdbId: candidates[0].igdbId,
      confidence: 'low',
      reason: 'Model picked an invalid igdbId; falling back to the first candidate.',
    };
  }

  return object;
}

/**
 * Resolve an IGDB game ID from a query string using a two-step process:
 * 1. Normalize the query using AI to get the official game name(s)
 * 2. Search IGDB with normalized name(s) (trying alternatives if needed)
 * 3. Use AI to pick the best match from IGDB results
 * 
 * This approach handles abbreviations, typos, and colloquial names that
 * IGDB's search API doesn't recognize.
 */
export async function resolveIGDBGameIdFromQuery(
  strapi: Core.Strapi,
  query: string,
  limit: number = 10,
  options?: GameResolverOptions
): Promise<{ igdbId: number; pick: PickedIGDBGame; candidates: IGDBSearchResult[]; normalizedQuery?: NormalizedGameQuery }> {
  const igdbService = strapi.service('api::game-fetcher.igdb') as unknown as {
    isConfigured: () => boolean;
    searchGames: (q: string, lim?: number) => Promise<IGDBSearchResult[]>;
  };

  if (!igdbService?.isConfigured?.()) {
    throw new Error('IGDB is not configured');
  }

  // Step 1: Normalize the query using AI
  const normalized = await normalizeGameQuery(query, options);

  // Step 2: Try searching IGDB with each normalized name until we get results
  let candidates: IGDBSearchResult[] = [];
  let searchQuery = query; // Fallback to original if all normalized names fail

  for (const normalizedName of normalized.normalizedNames) {
    candidates = await igdbService.searchGames(normalizedName, limit);
    if (candidates.length > 0) {
      searchQuery = normalizedName;
      break;
    }
  }

  // If normalized names didn't work, try the original query as fallback
  if (candidates.length === 0) {
    candidates = await igdbService.searchGames(query, limit);
  }

  if (candidates.length === 0) {
    throw new Error(
      `No IGDB results for query: ${query}${normalized.normalizedNames.length > 0 ? ` (tried normalized: ${normalized.normalizedNames.join(', ')})` : ''}`
    );
  }

  // Step 3: Use AI to pick the best match from candidates
  const pick = await pickBestIGDBGame(query, candidates, options);
  return { igdbId: pick.igdbId, pick, candidates, normalizedQuery: normalized };
}

