/**
 * Scout Query Planner
 *
 * Intelligent query planning system for the Scout agent.
 * Uses an LLM to strategically plan research queries based on:
 * - Available game context (IGDB data, user instruction)
 * - Search engine strengths (Tavily vs Exa)
 * - Discovery needs (unknown game, specific topic, recent changes)
 *
 * Two phases:
 * - Phase 0: Discovery Check - Evaluate if initial research is needed
 * - Phase 1: Query Planning - Generate strategic queries with expected findings
 */

import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';

import { type Logger } from '../../utils/logger';
import {
  createTokenUsageFromResult,
  addTokenUsage,
  createEmptyTokenUsage,
  type DiscoveryCheck,
  type DiscoveryReason,
  type GameArticleContext,
  type PlannedQuery,
  type QueryPlan,
  type TokenUsage,
  type SearchSource,
} from './types';
import { SCOUT_CONFIG } from './config';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of the discovery check phase.
 */
export interface DiscoveryCheckResult {
  readonly discoveryCheck: DiscoveryCheck;
  readonly tokenUsage: TokenUsage;
}

/**
 * Result of query planning including token usage.
 */
export interface QueryPlanResult {
  readonly queryPlan: QueryPlan;
  readonly tokenUsage: TokenUsage;
}

/**
 * Complete result from the Scout Query Planner.
 * Includes discovery check, query plan, and aggregated token usage.
 */
export interface ScoutQueryPlannerResult {
  readonly discoveryCheck: DiscoveryCheck;
  readonly queryPlan: QueryPlan;
  readonly tokenUsage: TokenUsage;
}

/**
 * Dependencies for the Scout Query Planner.
 */
export interface ScoutQueryPlannerDeps {
  readonly generateObject: typeof generateObject;
  readonly model: LanguageModel;
  readonly logger?: Logger;
  readonly signal?: AbortSignal;
}

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema for Phase 0: Discovery Check.
 */
const discoveryCheckSchema = z.object({
  needsDiscovery: z.boolean().describe('Whether you need a discovery query before planning strategic queries'),
  discoveryReason: z.enum(['unknown_game', 'specific_topic', 'recent_changes', 'none']).describe(
    'Why discovery is needed: unknown_game (new/obscure game), specific_topic (need depth on specific topic), recent_changes (need patch/update info), none (sufficient knowledge)'
  ),
  discoveryQuery: z.string().optional().describe('The discovery query to execute (if needsDiscovery is true)'),
  discoveryEngine: z.enum(['tavily', 'exa']).optional().default('tavily').describe('Which engine to use for discovery (default: tavily)'),
});

/**
 * Schema for Phase 1: Query Planning.
 */
const queryPlanSchema = z.object({
  draftTitle: z.string().min(10).max(100).describe('Working title for the article (10-100 characters)'),
  queries: z.array(z.object({
    query: z.string().min(5).describe('The search query string'),
    engine: z.enum(['tavily', 'exa']).describe('Which search engine to use'),
    purpose: z.string().min(10).describe('Why this query is needed for the article'),
    expectedFindings: z.array(z.string().min(5)).min(1).max(5).describe('What information this query should provide (1-5 items)'),
  })).min(SCOUT_CONFIG.MIN_QUERIES).max(SCOUT_CONFIG.MAX_QUERIES).describe(`Strategic queries to execute (${SCOUT_CONFIG.MIN_QUERIES}-${SCOUT_CONFIG.MAX_QUERIES} queries)`),
});

// ============================================================================
// System Prompts
// ============================================================================

function buildDiscoverySystemPrompt(): string {
  return `You are the Scout agent evaluating whether you need initial research before planning article queries.

EVALUATE YOUR KNOWLEDGE:
Consider the game context provided (name, description, genres, etc.) and the article intent.
Decide if you can plan effective research queries OR if you need a discovery query first.

REASONS TO REQUEST DISCOVERY:
1. UNKNOWN_GAME: The game is new, obscure, or you don't know enough about it
   - Example: A just-released indie game with minimal IGDB description
   - Discovery query: "What is [Game]? gameplay overview mechanics"

2. SPECIFIC_TOPIC: You know the game generally but need depth on a SPECIFIC topic
   - Example: User wants "Malenia boss guide" for Elden Ring
   - You know Elden Ring, but need current strategies, patch changes, community meta
   - Discovery query: "Elden Ring Malenia boss fight strategies tips 2024"

3. RECENT_CHANGES: The game may have had patches/updates affecting the article
   - Example: A live-service game that gets frequent balance changes
   - Discovery query: "[Game] patch notes update changes 2024"

4. NONE: You have sufficient knowledge to plan ${SCOUT_CONFIG.MAX_QUERIES} effective queries
   - Example: Well-known game with clear article intent

Discovery is FREE - it's separate from your ${SCOUT_CONFIG.MAX_QUERIES} strategic queries.
When in doubt, prefer discovery to get better context.`;
}

function buildQueryPlanSystemPrompt(): string {
  return `You are the Scout agent planning strategic research for a game article.

SEARCH BUDGET: Up to ${SCOUT_CONFIG.MAX_QUERIES} searches (flexible distribution between engines)

SEARCH ENGINES:
📍 TAVILY (up to 10 results each): Keyword-based web search
   ⚠️ CRITICAL FORMATTING RULES:
   1. ALWAYS start with the FULL game name in quotes: "Game Name"
   2. Put the quoted game name FIRST, then search terms
   3. Without quotes, you get irrelevant results!
   
   ✅ CORRECT: "Clair Obscur: Expedition 33" Simon boss guide strategies
   ✅ CORRECT: "Elden Ring" Margit weakness fire damage guide
   ❌ WRONG: Simon boss fight guide Clair Obscur (wrong order, no quotes)
   ❌ WRONG: Clair Obscur Simon guide (no quotes = unrelated results)

📍 EXA (up to 5 results each): Semantic/neural search
   ⚠️ CRITICAL: ALWAYS include the FULL game name in every query!
   - Natural language questions work best
   - Game name at the END of the question
   
   ✅ CORRECT: How to beat Simon the Divergent Star in Clair Obscur: Expedition 33?
   ✅ CORRECT: What are the best parry strategies in Elden Ring?
   ❌ WRONG: How to beat Simon the Divergent Star? (missing game name!)
   ❌ WRONG: Simon parry timings strategy (missing game name = Smash Bros results!)

PLANNING STRATEGY:
1. Create a draft title that focuses your research
2. Allocate queries strategically between Tavily and Exa
3. Include at least 1 general "[Game] guide/overview" query for broad coverage
4. Each query must have clear expected findings - these guide briefing synthesis
5. Queries should COMPLEMENT each other, covering different aspects
6. Think about what the Editor needs to create a detailed article plan

EXPECTED FINDINGS:
For each query, list 1-5 specific things you expect to learn.
These will be used to synthesize focused briefings.
Be specific: "Boss weakness to fire damage" not just "Boss strategies"`;
}

// ============================================================================
// User Prompts
// ============================================================================

function buildDiscoveryUserPrompt(context: GameArticleContext): string {
  const parts: string[] = [
    '=== GAME CONTEXT ===',
    `Game: ${context.gameName}`,
  ];

  if (context.igdbDescription) {
    parts.push(`Description: ${context.igdbDescription}`);
  }

  if (context.genres?.length) {
    parts.push(`Genres: ${context.genres.join(', ')}`);
  }

  if (context.platforms?.length) {
    parts.push(`Platforms: ${context.platforms.join(', ')}`);
  }

  if (context.developer) {
    parts.push(`Developer: ${context.developer}`);
  }

  if (context.releaseDate) {
    parts.push(`Release: ${context.releaseDate}`);
  }

  parts.push('');
  parts.push('=== ARTICLE INTENT ===');
  parts.push(context.instruction || 'General guide about the game');

  parts.push('');
  parts.push('=== YOUR TASK ===');
  parts.push('Evaluate: Do you need a discovery query before planning your 6 strategic queries?');
  parts.push('Consider: Is this game familiar? Is the topic specific? Are there recent changes?');

  return parts.join('\n');
}

function buildQueryPlanUserPrompt(
  context: GameArticleContext,
  discoveryResult?: string
): string {
  const parts: string[] = [
    '=== GAME CONTEXT ===',
    `Game: ${context.gameName}`,
  ];

  if (context.igdbDescription) {
    parts.push(`Description: ${context.igdbDescription}`);
  }

  if (context.genres?.length) {
    parts.push(`Genres: ${context.genres.join(', ')}`);
  }

  if (context.platforms?.length) {
    parts.push(`Platforms: ${context.platforms.join(', ')}`);
  }

  if (context.developer) {
    parts.push(`Developer: ${context.developer}`);
  }

  if (context.releaseDate) {
    parts.push(`Release: ${context.releaseDate}`);
  }

  // Include discovery findings if available
  if (discoveryResult) {
    parts.push('');
    parts.push('=== DISCOVERY FINDINGS ===');
    parts.push(discoveryResult);
  }

  parts.push('');
  parts.push('=== ARTICLE INTENT ===');
  parts.push(context.instruction || 'General guide about the game');

  parts.push('');
  parts.push('=== YOUR TASK ===');
  parts.push('1. Create a draft title for the article');
  parts.push(`2. Plan ${SCOUT_CONFIG.MIN_QUERIES}-${SCOUT_CONFIG.MAX_QUERIES} strategic queries with engine selection`);
  parts.push('3. For each query, specify expected findings');
  parts.push('');
  parts.push('Remember:');
  parts.push('- At least 1 general coverage query');
  parts.push('- Mix Tavily (factual) and Exa (conceptual) strategically');
  parts.push('- Expected findings guide what to extract from results');

  return parts.join('\n');
}

// ============================================================================
// Query Validation & Fixing
// ============================================================================

/**
 * Validates that a query contains the game name.
 * Returns true if the game name (or a substantial part) is present.
 */
function queryContainsGameName(query: string, gameName: string): boolean {
  const normalizedQuery = query.toLowerCase();
  const normalizedGameName = gameName.toLowerCase();
  
  // Check for full game name
  if (normalizedQuery.includes(normalizedGameName)) {
    return true;
  }
  
  // Check for game name without subtitle (e.g., "Clair Obscur" without ": Expedition 33")
  const mainTitle = gameName.split(':')[0].trim().toLowerCase();
  if (mainTitle.length > 5 && normalizedQuery.includes(mainTitle)) {
    return true;
  }
  
  // Check for quoted game name
  const quotedName = `"${gameName}"`.toLowerCase();
  if (normalizedQuery.includes(quotedName)) {
    return true;
  }
  
  return false;
}

/**
 * Fixes a query by adding the game name if missing.
 * - Tavily: Prepends quoted game name at the start
 * - Exa: Appends game name at the end
 */
function fixQueryWithGameName(
  query: string,
  gameName: string,
  engine: 'tavily' | 'exa',
  logger?: Logger
): string {
  if (queryContainsGameName(query, gameName)) {
    return query;
  }
  
  if (engine === 'tavily') {
    // Tavily: Prepend quoted game name
    const fixed = `"${gameName}" ${query}`;
    logger?.debug?.(`Fixed Tavily query: "${query}" → "${fixed}"`);
    return fixed;
  } else {
    // Exa: Append game name at the end
    // If query ends with ?, insert before it
    if (query.endsWith('?')) {
      const fixed = `${query.slice(0, -1)} in ${gameName}?`;
      logger?.debug?.(`Fixed Exa query: "${query}" → "${fixed}"`);
      return fixed;
    }
    const fixed = `${query} in ${gameName}`;
    logger?.debug?.(`Fixed Exa query: "${query}" → "${fixed}"`);
    return fixed;
  }
}

/**
 * Validates and fixes all queries in a query plan.
 * Ensures every query includes the game name.
 */
function validateAndFixQueries(
  queryPlan: QueryPlan,
  gameName: string,
  logger?: Logger
): QueryPlan {
  const fixedQueries = queryPlan.queries.map((q): PlannedQuery => ({
    ...q,
    query: fixQueryWithGameName(q.query, gameName, q.engine, logger),
  }));
  
  return {
    ...queryPlan,
    queries: fixedQueries,
  };
}

// ============================================================================
// Phase Functions
// ============================================================================

/**
 * Phase 0: Discovery Check
 * Evaluates if the Scout needs initial research before planning queries.
 */
export async function checkDiscovery(
  context: GameArticleContext,
  deps: ScoutQueryPlannerDeps
): Promise<DiscoveryCheckResult> {
  const { generateObject: generate, model, logger, signal } = deps;

  logger?.info?.(`Evaluating if discovery research is needed for "${context.gameName}"...`);

  const result = await generate({
    model,
    schema: discoveryCheckSchema,
    system: buildDiscoverySystemPrompt(),
    prompt: buildDiscoveryUserPrompt(context),
    abortSignal: signal,
  });

  const discoveryCheck: DiscoveryCheck = {
    needsDiscovery: result.object.needsDiscovery,
    discoveryReason: result.object.discoveryReason as DiscoveryReason,
    discoveryQuery: result.object.discoveryQuery,
    discoveryEngine: (result.object.discoveryEngine ?? 'tavily') as SearchSource,
  };

  if (discoveryCheck.needsDiscovery) {
    logger?.info?.(`Discovery needed (${discoveryCheck.discoveryReason}): "${discoveryCheck.discoveryQuery}"`);
  } else {
    logger?.info?.('Discovery not needed - sufficient knowledge to plan queries');
  }

  return {
    discoveryCheck,
    tokenUsage: createTokenUsageFromResult(result),
  };
}

/**
 * Phase 1: Query Planning
 * Generates strategic queries with expected findings.
 */
export async function planQueries(
  context: GameArticleContext,
  deps: ScoutQueryPlannerDeps,
  discoveryResult?: string
): Promise<QueryPlanResult> {
  const { generateObject: generate, model, logger, signal } = deps;

  logger?.info?.(`Planning ${SCOUT_CONFIG.MAX_QUERIES} strategic search queries...`);

  const result = await generate({
    model,
    schema: queryPlanSchema,
    system: buildQueryPlanSystemPrompt(),
    prompt: buildQueryPlanUserPrompt(context, discoveryResult),
    abortSignal: signal,
  });

  const rawQueryPlan: QueryPlan = {
    draftTitle: result.object.draftTitle,
    queries: result.object.queries.map((q): PlannedQuery => ({
      query: q.query,
      engine: q.engine as SearchSource,
      purpose: q.purpose,
      expectedFindings: q.expectedFindings,
    })),
  };

  // Validate and fix queries to ensure game name is included
  const queryPlan = validateAndFixQueries(rawQueryPlan, context.gameName, logger);

  // Log planned queries (after fixing)
  logger?.info?.(`Query plan: "${queryPlan.draftTitle}"`);
  for (const q of queryPlan.queries) {
    logger?.info?.(`  [${q.engine}] ${q.query}`);
    logger?.debug?.(`    Purpose: ${q.purpose}`);
    logger?.debug?.(`    Expected: ${q.expectedFindings.join(', ')}`);
  }

  return {
    queryPlan,
    tokenUsage: createTokenUsageFromResult(result),
  };
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Runs the complete Scout Query Planner.
 * 
 * Phase 0: Check if discovery is needed
 * Phase 1: Plan strategic queries (with discovery context if available)
 * 
 * Note: This function does NOT execute the discovery query.
 * The caller (Scout agent) handles discovery execution and passes
 * the result back for query planning.
 *
 * @param context - Game article context including intent
 * @param deps - Dependencies including model and logger
 * @param discoveryResult - Optional result from discovery query execution
 * @returns Complete query planner result
 */
export async function runScoutQueryPlanner(
  context: GameArticleContext,
  deps: ScoutQueryPlannerDeps,
  discoveryResult?: string
): Promise<ScoutQueryPlannerResult> {
  const { logger } = deps;

  logger?.info?.(`Scout Query Planner starting for "${context.gameName}"`);

  // Phase 0: Discovery check (only if no discovery result provided)
  let discoveryCheck: DiscoveryCheck;
  let totalTokenUsage = createEmptyTokenUsage();

  if (discoveryResult === undefined) {
    const checkResult = await checkDiscovery(context, deps);
    discoveryCheck = checkResult.discoveryCheck;
    totalTokenUsage = addTokenUsage(totalTokenUsage, checkResult.tokenUsage);
  } else {
    // Discovery was already executed, skip check
    discoveryCheck = {
      needsDiscovery: false,
      discoveryReason: 'none',
    };
    logger?.debug?.('Discovery result provided, skipping check');
  }

  // Phase 1: Query planning
  const planResult = await planQueries(context, deps, discoveryResult);
  totalTokenUsage = addTokenUsage(totalTokenUsage, planResult.tokenUsage);

  logger?.info?.(
    `Scout Query Planner complete: ${planResult.queryPlan.queries.length} queries planned`
  );

  return {
    discoveryCheck,
    queryPlan: planResult.queryPlan,
    tokenUsage: totalTokenUsage,
  };
}

// ============================================================================
// Backwards Compatibility (Legacy API)
// ============================================================================

/**
 * @deprecated Use runScoutQueryPlanner instead.
 * Kept for backwards compatibility during migration.
 */
export interface OptimizedQueries {
  readonly tavily: readonly string[];
  readonly exa: readonly string[];
}

/**
 * @deprecated Use runScoutQueryPlanner instead.
 */
export interface QueryOptimizationResult {
  readonly queries: OptimizedQueries;
  readonly tokenUsage: TokenUsage;
}

/**
 * @deprecated Use ScoutQueryPlannerDeps instead.
 */
export type QueryOptimizerDeps = ScoutQueryPlannerDeps;

/**
 * @deprecated Use runScoutQueryPlanner instead.
 * Converts new QueryPlan format to legacy OptimizedQueries format.
 */
export async function generateOptimizedQueries(
  context: GameArticleContext,
  _articleType: string,
  deps: ScoutQueryPlannerDeps
): Promise<QueryOptimizationResult> {
  const result = await runScoutQueryPlanner(context, deps);
  
  // Convert to legacy format: split by engine
  const tavily = result.queryPlan.queries
    .filter(q => q.engine === 'tavily')
    .map(q => q.query);
  const exa = result.queryPlan.queries
    .filter(q => q.engine === 'exa')
    .map(q => q.query);

  return {
    queries: { tavily, exa },
    tokenUsage: result.tokenUsage,
  };
}

/**
 * @deprecated Use fallback query planning instead.
 * Generates fallback queries when LLM fails.
 */
export function generateFallbackQueries(
  context: GameArticleContext,
  _articleType: string
): OptimizedQueries {
  const gameName = context.gameName;
  const intent = context.instruction?.replace(/guide|walkthrough|how to/gi, '').trim();
  const intentKeywords = intent || 'gameplay mechanics';

  const tavily = [
    `"${gameName}" ${intentKeywords} guide tutorial`,
    `"${gameName}" ${intentKeywords} walkthrough strategies`,
    `"${gameName}" ${intentKeywords} tips secrets`,
  ];

  const exa = intent
    ? [
        `how to ${intent} in ${gameName}`,
        `best strategies for ${intent} in ${gameName}`,
        `tips and tricks for ${intent} in ${gameName}`,
      ]
    : [
        `how does gameplay work in ${gameName}`,
        `beginner tips and essential mechanics for ${gameName}`,
        `what makes ${gameName} unique and interesting`,
      ];

  return { tavily, exa };
}

/**
 * Generates a fallback query plan when LLM fails.
 */
export function generateFallbackQueryPlan(context: GameArticleContext): QueryPlan {
  const gameName = context.gameName;
  const intent = context.instruction?.replace(/guide|walkthrough|how to/gi, '').trim();
  const intentKeywords = intent || 'gameplay mechanics';

  const queries: PlannedQuery[] = [
    {
      query: `"${gameName}" ${intentKeywords} guide tutorial`,
      engine: 'tavily',
      purpose: 'General overview and tutorial content',
      expectedFindings: ['Core mechanics', 'Getting started tips', 'Basic strategies'],
    },
    {
      query: `"${gameName}" ${intentKeywords} walkthrough strategies`,
      engine: 'tavily',
      purpose: 'Detailed strategies and walkthroughs',
      expectedFindings: ['Step-by-step instructions', 'Optimal approaches', 'Common challenges'],
    },
    {
      query: `"${gameName}" tips secrets`,
      engine: 'tavily',
      purpose: 'Tips, tricks, and hidden content',
      expectedFindings: ['Pro tips', 'Hidden mechanics', 'Secret content'],
    },
    {
      query: `How does ${intentKeywords} work in ${gameName}?`,
      engine: 'exa',
      purpose: 'Conceptual understanding of mechanics',
      expectedFindings: ['Mechanic explanations', 'System interactions', 'Design philosophy'],
    },
    {
      query: `Best strategies for ${intent || 'playing'} ${gameName}`,
      engine: 'exa',
      purpose: 'Community-recommended approaches',
      expectedFindings: ['Meta strategies', 'Community consensus', 'Advanced techniques'],
    },
  ];

  return {
    draftTitle: `${gameName} ${intent ? intent.charAt(0).toUpperCase() + intent.slice(1) : 'Guide'}`,
    queries,
  };
}
