/**
 * Query Optimizer
 *
 * Uses an LLM to generate optimized search queries based on the article intent.
 * Generates different query styles for different search engines:
 * - Tavily: Keyword-based queries with exact phrase matching
 * - Exa: Natural language questions for semantic search
 *
 * Query structure is article-type dependent:
 * - Guides: overview + intent-specific + tips
 * - News: overview + intent-specific + recent
 * - Lists: overview + topic-specific + meta
 * - Reviews: overview + focus-specific + current state
 */

import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';

import { type Logger } from '../../utils/logger';
import { getQueryOptimizationPrompt as getPromptForArticleType } from './prompts';
import type { GameArticleContext, TokenUsage } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Optimized queries output from the LLM.
 */
export interface OptimizedQueries {
  /** Keyword-based queries for Tavily (3 queries) */
  readonly tavily: readonly string[];
  /** Natural language queries for Exa semantic search (3 queries) */
  readonly exa: readonly string[];
}

/**
 * Result of query optimization including token usage.
 */
export interface QueryOptimizationResult {
  readonly queries: OptimizedQueries;
  readonly tokenUsage: TokenUsage;
}

/**
 * Dependencies for query optimization.
 */
export interface QueryOptimizerDeps {
  readonly generateObject: typeof generateObject;
  readonly model: LanguageModel;
  readonly logger?: Logger;
  readonly signal?: AbortSignal;
}

// ============================================================================
// Schema
// ============================================================================

const optimizedQueriesSchema = z.object({
  tavily: z
    .array(z.string())
    .length(3)
    .describe('3 keyword-based search queries optimized for Tavily. Use quotes around game name for exact match.'),
  exa: z
    .array(z.string())
    .length(3)
    .describe('3 natural language questions optimized for Exa semantic search. Ask like you would ask an expert.'),
});

// ============================================================================
// Prompts
// ============================================================================

function buildSystemPrompt(): string {
  return `You are a search query optimization expert. Your job is to generate highly effective search queries for gathering research about video games.

You will generate TWO types of queries:

## TAVILY QUERIES (Keyword-based)
Tavily is a traditional web search engine. Optimize for:
- Use quotes around the game name: "Elden Ring"
- Include specific keywords relevant to the query type
- Be specific to the user's intent
- Example: "Elden Ring" boss fight strategies weakness guide

## EXA QUERIES (Semantic/Neural)  
Exa uses AI to understand meaning, not just keywords. Optimize for:
- Write natural questions like asking an expert
- No need for quotes or keyword stuffing
- Be conversational and specific
- Example: What are the best strategies for defeating bosses in Elden Ring?

Generate queries that will find the most relevant, high-quality content for the specific article intent.`;
}

function buildUserPrompt(context: GameArticleContext, articleType: string): string {
  // Get article-type-specific prompt guidance
  const promptGuidance = getPromptForArticleType(
    context.gameName,
    context.instruction,
    context.genres,
    articleType,
    context.categorySlug
  );

  const parts: string[] = [
    `Generate optimized search queries for a ${articleType.toUpperCase()} article.`,
    '',
    '=== GAME INFO ===',
    `Game: ${context.gameName}`,
  ];

  if (context.genres?.length) {
    parts.push(`Genres: ${context.genres.join(', ')}`);
  }

  if (context.instruction) {
    parts.push(``, `=== USER INTENT ===`, context.instruction);
  } else {
    parts.push(``, `=== USER INTENT ===`, `General ${articleType} about the game`);
  }

  // Add article-type-specific query structure guidance
  if (promptGuidance) {
    parts.push('', '=== QUERY STRUCTURE (IMPORTANT!) ===', promptGuidance.queryStructure);
    
    parts.push('', '=== TAVILY EXAMPLES ===');
    promptGuidance.tavilyExamples.forEach((ex, i) => {
      parts.push(`${i + 1}. ${ex}`);
    });

    parts.push('', '=== EXA EXAMPLES ===');
    promptGuidance.exaExamples.forEach((ex, i) => {
      parts.push(`${i + 1}. ${ex}`);
    });
  } else {
    // Fallback generic guidance
    parts.push(
      '',
      '=== REQUIREMENTS ===',
      '- Generate 3 Tavily queries (keyword-based, use "Game Name" in quotes)',
      '- Generate 3 Exa queries (natural language questions)',
      '- All queries must be specific to the user intent',
      '- Queries should complement each other, not duplicate'
    );
  }

  parts.push('', 'Generate the optimized queries:');

  return parts.join('\n');
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Generates optimized search queries using an LLM.
 *
 * @param context - Game article context including intent
 * @param articleType - Type of article (guide, news, review, list)
 * @param deps - Dependencies including model and logger
 * @returns Optimized queries for Tavily and Exa
 */
export async function generateOptimizedQueries(
  context: GameArticleContext,
  articleType: string,
  deps: QueryOptimizerDeps
): Promise<QueryOptimizationResult> {
  const { generateObject: generate, model, logger, signal } = deps;

  logger?.debug?.(`Generating optimized queries for "${context.gameName}" (${articleType})`);
  if (context.instruction) {
    logger?.debug?.(`Intent: ${context.instruction}`);
  }

  const result = await generate({
    model,
    schema: optimizedQueriesSchema,
    system: buildSystemPrompt(),
    prompt: buildUserPrompt(context, articleType),
    abortSignal: signal,
  });

  const queries: OptimizedQueries = {
    tavily: result.object.tavily,
    exa: result.object.exa,
  };

  // Log generated queries
  logger?.info?.(`Generated optimized queries:`);
  logger?.info?.(`  Tavily: ${queries.tavily.join(' | ')}`);
  logger?.info?.(`  Exa: ${queries.exa.join(' | ')}`);

  const tokenUsage: TokenUsage = {
    input: result.usage?.inputTokens ?? 0,
    output: result.usage?.outputTokens ?? 0,
  };

  return { queries, tokenUsage };
}

// ============================================================================
// Fallback (for when LLM fails or is disabled)
// ============================================================================

/**
 * Generates fallback queries using simple string interpolation.
 * Used when LLM query optimization fails or is disabled.
 */
export function generateFallbackQueries(context: GameArticleContext, articleType: string): OptimizedQueries {
  const gameName = context.gameName;
  const intent = context.instruction?.replace(/guide|walkthrough|how to/gi, '').trim();
  const intentKeywords = intent || 'gameplay mechanics';

  // Tavily: keyword-based
  const tavily = [
    `"${gameName}" ${intentKeywords} guide tutorial`,
    `"${gameName}" ${intentKeywords} walkthrough strategies`,
    `"${gameName}" ${intentKeywords} tips secrets`,
  ];

  // Exa: natural language
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
