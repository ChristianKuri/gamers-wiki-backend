/**
 * Metadata Agent
 *
 * Responsible for generating SEO-optimized metadata after the article is written.
 * Runs after the Specialist agent, with access to the actual article content.
 *
 * Input:
 * - Article markdown (primary context)
 * - Top 2-3 source summaries (game knowledge)
 * - Original user instruction (intent)
 * - Game context (name, category, etc.)
 *
 * Output:
 * - title: SEO-optimized title (55-65 chars)
 * - excerpt: Meta description for search engines (120-160 chars)
 * - description: Card preview for site visitors (80-150 chars)
 * - tags: Relevant topic tags (3-5)
 */

import type { LanguageModel } from 'ai';
import type { z } from 'zod';

import { createPrefixedLogger, type Logger } from '../../../utils/logger';
import { ArticleMetadataSchema, type ArticleCategorySlug, type ArticleMetadata } from '../article-plan';
import { METADATA_CONFIG, ARTICLE_PLAN_CONSTRAINTS } from '../config';
import { withRetry } from '../retry';
import { createEmptyTokenUsage, createTokenUsageFromResult, type SourceSummary, type TokenUsage } from '../types';

// Re-export config for consumers
export { METADATA_CONFIG } from '../config';

// ============================================================================
// Types
// ============================================================================

export interface MetadataDeps {
  readonly generateObject: typeof import('ai').generateObject;
  readonly model: LanguageModel;
  readonly logger?: Logger;
  /** Optional AbortSignal for cancellation support */
  readonly signal?: AbortSignal;
  /** Optional temperature override (default: METADATA_CONFIG.TEMPERATURE) */
  readonly temperature?: number;
}

/**
 * Context for the Metadata Agent.
 * Contains everything needed to generate SEO-optimized metadata.
 */
export interface MetadataContext {
  /** The actual article content (markdown) */
  readonly articleMarkdown: string;
  /** Game name for SEO title inclusion */
  readonly gameName: string;
  /** Original user instruction/prompt (intent) */
  readonly instruction?: string;
  /** Category from Editor (affects metadata style) */
  readonly categorySlug: ArticleCategorySlug;
  /** Top 2-3 sources for game context */
  readonly topSources: readonly SourceSummary[];
}

/**
 * Output from the Metadata Agent.
 */
export interface MetadataOutput {
  readonly metadata: ArticleMetadata;
  readonly tokenUsage: TokenUsage;
}

// ============================================================================
// Prompts
// ============================================================================

function buildSystemPrompt(): string {
  return `You are the Metadata Agent — an SEO specialist for game journalism.

Your mission: Generate optimized metadata for an article that's already been written.

You have access to:
1. The ACTUAL ARTICLE CONTENT - use this as your primary source
2. Game context and source summaries - for background knowledge
3. The original user request - to understand intent

Your output must be:
- ACCURATE: Metadata should reflect what the article actually covers
- SEO-OPTIMIZED: Follow search engine best practices
- ENGAGING: Compelling for both humans and search engines

Write all metadata in English.`;
}

function buildUserPrompt(ctx: MetadataContext): string {
  const topSourcesSection = ctx.topSources.length > 0
    ? `\n=== TOP SOURCES (Game Context) ===\n${ctx.topSources.map((s, i) => `${i + 1}. ${s.title}\n   Key Facts: ${s.keyFacts.slice(0, 3).join('; ')}`).join('\n')}\n`
    : '';

  // Truncate article if too long (keep first ~4000 chars for context)
  const articlePreview = ctx.articleMarkdown.length > 4000
    ? ctx.articleMarkdown.slice(0, 4000) + '\n\n[... article continues ...]'
    : ctx.articleMarkdown;

  return `Generate SEO-optimized metadata for this ${ctx.categorySlug} article about "${ctx.gameName}".

=== ORIGINAL REQUEST ===
${ctx.instruction || 'Create a comprehensive article'}

=== ARTICLE CONTENT ===
${articlePreview}
${topSourcesSection}
=== METADATA REQUIREMENTS ===

**TITLE** (${ARTICLE_PLAN_CONSTRAINTS.TITLE_MIN_LENGTH}-${ARTICLE_PLAN_CONSTRAINTS.TITLE_MAX_LENGTH} chars, target: 55-65)
- Include the game name naturally
- Be descriptive: readers AND AI should instantly understand the topic
- Use action words for guides: "How to Beat", "How to Find", "Best Build for"
- Specific: name the boss, item, mechanic, or subject clearly
- No pipes or brackets, write naturally

Title patterns by type:
- Boss guides: "How to Beat [Boss] in [Game Name]"
- Build guides: "Best [Build Type] Build Guide for [Game Name]"
- Location guides: "All [Item] Locations in [Game Name]"
- Tips: "[Topic] Tips and Tricks for [Game Name]"

**EXCERPT** (${ARTICLE_PLAN_CONSTRAINTS.EXCERPT_PROMPT_MIN}-${ARTICLE_PLAN_CONSTRAINTS.EXCERPT_PROMPT_MAX} chars) — SEO meta description
- Start with primary keyword in first 40 chars
- Include game name and specific topic
- Professional, action-oriented, end with CTA
- Example: "How to beat Simon in Clair Obscur. Three-phase guide with parry timings and one-shot Maelle strategy."

**DESCRIPTION** (${ARTICLE_PLAN_CONSTRAINTS.DESCRIPTION_PROMPT_MIN}-${ARTICLE_PLAN_CONSTRAINTS.DESCRIPTION_PROMPT_MAX} chars) — Card preview for site visitors
- Casual, benefit-focused: what will they learn?
- Create curiosity and engagement
- Example: "Complete Simon boss guide covering all phases, parry patterns, and the build that can one-shot him."

**TAGS** (${ARTICLE_PLAN_CONSTRAINTS.MIN_TAGS}-${ARTICLE_PLAN_CONSTRAINTS.MAX_TAGS} tags)
- Include game name slug (lowercase, hyphens)
- Include main topic (boss name, mechanic, etc.)
- Include category-relevant tags
- Example: ["clair-obscur", "simon-boss", "boss-guide", "expedition-33"]

=== OUTPUT ===
Return JSON with: title, excerpt, description, tags`;
}

// ============================================================================
// Main Metadata Function
// ============================================================================

/**
 * Runs the Metadata Agent to generate SEO-optimized metadata.
 *
 * @param ctx - Metadata context with article content and game info
 * @param deps - Dependencies (generateObject, model)
 * @returns Metadata output with title, excerpt, description, tags
 */
export async function runMetadata(
  ctx: MetadataContext,
  deps: MetadataDeps
): Promise<MetadataOutput> {
  const log = deps.logger ?? createPrefixedLogger('[Metadata]');
  const temperature = deps.temperature ?? METADATA_CONFIG.TEMPERATURE;

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(ctx);

  log.info(`Generating article metadata...`);
  log.info(`  System prompt: ${systemPrompt.length} chars`);
  log.info(`  User prompt: ${userPrompt.length} chars`);
  log.info(`  Category: ${ctx.categorySlug}`);

  const startTime = Date.now();
  log.info(`  Calling generateObject (timeout: ${METADATA_CONFIG.TIMEOUT_MS}ms per attempt)...`);

  // Helper to create a fresh timeout signal for each attempt
  const createTimeoutSignal = (): AbortSignal => {
    const timeoutSignal = AbortSignal.timeout(METADATA_CONFIG.TIMEOUT_MS);
    return deps.signal
      ? AbortSignal.any([deps.signal, timeoutSignal])
      : timeoutSignal;
  };

  let rawMetadata: z.infer<typeof ArticleMetadataSchema>;
  let generationResult: {
    usage?: { inputTokens?: number; outputTokens?: number };
    providerMetadata?: Record<string, unknown>;
  } | undefined;

  try {
    const result = await withRetry(
      () => {
        const attemptSignal = createTimeoutSignal();
        return deps.generateObject({
          model: deps.model,
          temperature,
          schema: ArticleMetadataSchema,
          system: systemPrompt,
          prompt: userPrompt,
          abortSignal: attemptSignal,
        });
      },
      { context: 'Metadata generation', signal: deps.signal }
    );
    rawMetadata = result.object;
    generationResult = { usage: result.usage, providerMetadata: result.providerMetadata };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`  generateObject failed: ${errorMessage}`);
    
    // Log constraint details for debugging
    log.error(`  Schema constraints:`);
    log.error(`    title: ${ARTICLE_PLAN_CONSTRAINTS.TITLE_MIN_LENGTH}-${ARTICLE_PLAN_CONSTRAINTS.TITLE_MAX_LENGTH} chars`);
    log.error(`    excerpt: ${ARTICLE_PLAN_CONSTRAINTS.EXCERPT_MIN_LENGTH}-${ARTICLE_PLAN_CONSTRAINTS.EXCERPT_MAX_LENGTH} chars`);
    log.error(`    description: ${ARTICLE_PLAN_CONSTRAINTS.DESCRIPTION_MIN_LENGTH}-${ARTICLE_PLAN_CONSTRAINTS.DESCRIPTION_MAX_LENGTH} chars`);
    log.error(`    tags: ${ARTICLE_PLAN_CONSTRAINTS.MIN_TAGS}-${ARTICLE_PLAN_CONSTRAINTS.MAX_TAGS} tags`);
    log.error(`  This likely means the LLM generated content outside these constraints.`);
    log.error(`  Consider relaxing constraints or improving prompt guidance.`);
    
    throw error;
  }

  const elapsed = Date.now() - startTime;
  log.info(`  generateObject completed in ${elapsed}ms`);
  log.info(`  Title: "${rawMetadata.title}" (${rawMetadata.title.length} chars)`);
  log.info(`  Tags: ${rawMetadata.tags.join(', ')}`);

  // Track token usage and actual cost from OpenRouter
  const tokenUsage: TokenUsage = generationResult
    ? createTokenUsageFromResult(generationResult)
    : createEmptyTokenUsage();

  return {
    metadata: rawMetadata,
    tokenUsage,
  };
}

/**
 * Extracts the top N sources by quality score from source summaries.
 *
 * @param sourceSummaries - All source summaries from Scout
 * @param count - Number of top sources to extract (default: 3)
 * @returns Top sources sorted by quality score
 */
export function extractTopSources(
  sourceSummaries: readonly SourceSummary[] | undefined,
  count: number = 3
): readonly SourceSummary[] {
  if (!sourceSummaries || sourceSummaries.length === 0) {
    return [];
  }

  // Sort by quality score (descending) and take top N
  return [...sourceSummaries]
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, count);
}
