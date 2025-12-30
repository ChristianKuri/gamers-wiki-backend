/**
 * Cleaner Agent
 *
 * Responsible for cleaning raw web content from search results.
 * Removes junk (navigation, ads, boilerplate) and rates content quality.
 * Does NOT summarize - preserves all substantive content.
 */

import type { LanguageModel } from 'ai';
import { z } from 'zod';

import { createPrefixedLogger, type Logger } from '../../../utils/logger';
import { CLEANER_CONFIG } from '../config';
import { withRetry } from '../retry';
import { extractDomain } from '../source-cache';
import {
  addTokenUsage,
  createEmptyTokenUsage,
  createTokenUsageFromResult,
  type CleanedSource,
  type CleanerLLMOutput,
  type CleanSingleSourceResult,
  type RawSourceInput,
  type TokenUsage,
} from '../types';

// Re-export config for backwards compatibility
export { CLEANER_CONFIG } from '../config';

// ============================================================================
// Zod Schema for LLM Output
// ============================================================================

/**
 * Schema for cleaner LLM output.
 * Validates structured response from the model.
 */
const CleanerOutputSchema = z.object({
  cleanedContent: z
    .string()
    .min(1)
    .describe('The cleaned content with all junk removed. Keep ALL substantive content.'),
  summary: z
    .string()
    .min(1)
    .max(500)
    .describe('A concise 1-2 sentence summary of what this content is about. Will be used for quick reference.'),
  qualityScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('Quality score 0-100 based on relevance, depth, authority, and junk ratio'),
  qualityNotes: z
    .string()
    .describe('Brief explanation of the quality score (1-2 sentences)'),
  contentType: z
    .string()
    .min(1)
    .max(100)
    .describe('Type of content (e.g., "wiki article", "strategy guide", "forum discussion", "news article", "official documentation", "gameplay tips", etc.)'),
});

// ============================================================================
// Types
// ============================================================================

export interface CleanerDeps {
  readonly generateObject: typeof import('ai').generateObject;
  readonly model: LanguageModel;
  readonly logger?: Logger;
  readonly signal?: AbortSignal;
  /** Game name for relevance scoring context */
  readonly gameName?: string;
}

/**
 * Result of cleaning a batch of sources.
 */
export interface CleanSourcesBatchResult {
  /** Successfully cleaned sources */
  readonly sources: CleanedSource[];
  /** Aggregated token usage from all LLM calls */
  readonly tokenUsage: TokenUsage;
}

// ============================================================================
// Prompts
// ============================================================================

/**
 * System prompt for the cleaner agent.
 */
function getCleanerSystemPrompt(): string {
  return `You are a content cleaning specialist. Your job is to extract valuable content from web pages while removing all junk.

REMOVE (do not include in cleanedContent):
- Navigation menus, headers, footers
- Cookie consent banners
- Advertisement blocks
- Social media share buttons
- "Related articles" sections
- Comments sections
- Newsletter signup forms
- Login/signup prompts
- Breadcrumb trails
- Site-wide announcements
- Legal disclaimers at page bottom
- Author bio sections (unless essential)
- "Share this" widgets

KEEP (preserve in cleanedContent):
- Main article/guide content
- Code snippets and examples
- Tables with data
- Lists of items/steps
- Quoted text that's part of the article
- Image captions (describe as [Image: caption])
- Headings and subheadings
- ALL substantive information

CRITICAL RULES:
1. DO NOT SUMMARIZE the cleanedContent - Keep ALL valuable content, just remove junk
2. Preserve the original structure (headings, lists, paragraphs)
3. Keep the content in markdown format
4. If the content is mostly junk, return what little value exists
5. Be generous - when in doubt, keep the content

SUMMARY:
Write a concise 1-2 sentence summary of what this content covers. This will be used for quick reference to understand what information this source provides.

QUALITY SCORING (0-100):
- Relevance to gaming (0-30 pts): Is this about games/gaming?
- Content depth (0-30 pts): Detailed, comprehensive information?
- Authority signals (0-20 pts): Wiki, official source, reputable site?
- Junk ratio (0-20 pts): How much was junk vs valuable content?

CONTENT TYPE:
Describe what type of content this is. Be specific and descriptive. Examples:
- "wiki article" for encyclopedia-style content
- "strategy guide" for how-to content
- "build guide" for character/equipment builds
- "walkthrough" for step-by-step game progression
- "forum discussion" for community discussions
- "Reddit post" for Reddit content
- "news article" for game news
- "patch notes" for update information
- "official documentation" for publisher/developer content
- Or any other descriptive type that fits`;
}

/**
 * User prompt for cleaning a specific source.
 */
function getCleanerUserPrompt(source: RawSourceInput, gameName?: string): string {
  const gameContext = gameName ? `\nContext: This content is being evaluated for an article about "${gameName}".` : '';

  return `Clean the following web content and rate its quality.
${gameContext}

URL: ${source.url}
Title: ${source.title}

=== RAW CONTENT START ===
${source.content.slice(0, CLEANER_CONFIG.MAX_INPUT_CHARS)}
=== RAW CONTENT END ===

Extract and return:
1. cleanedContent: The content with all junk removed (keep ALL valuable content)
2. summary: A concise 1-2 sentence summary of what this content covers
3. qualityScore: 0-100 rating
4. qualityNotes: Brief explanation of score
5. contentType: Describe what type of content this is (be specific)`;
}

// ============================================================================
// Single Source Cleaning
// ============================================================================

/**
 * Clean a single source using the LLM.
 *
 * @param source - Raw source input
 * @param deps - Cleaner dependencies
 * @returns Cleaned source result with token usage
 */
export async function cleanSingleSource(
  source: RawSourceInput,
  deps: CleanerDeps
): Promise<CleanSingleSourceResult> {
  const log = deps.logger ?? createPrefixedLogger('[Cleaner]');

  // Skip empty content
  if (!source.content || source.content.trim().length === 0) {
    log.debug(`Skipping empty content: ${source.url}`);
    return { source: null, tokenUsage: createEmptyTokenUsage() };
  }

  // Skip content that's too short to be useful
  if (source.content.length < CLEANER_CONFIG.MIN_CLEANED_CHARS) {
    log.debug(`Skipping short content (${source.content.length} chars): ${source.url}`);
    return { source: null, tokenUsage: createEmptyTokenUsage() };
  }

  const domain = extractDomain(source.url);
  const originalLength = source.content.length;

  try {
    const result = await withRetry(
      async () => {
        const timeoutSignal = AbortSignal.timeout(CLEANER_CONFIG.TIMEOUT_MS);
        const signal = deps.signal
          ? AbortSignal.any([deps.signal, timeoutSignal])
          : timeoutSignal;

        return deps.generateObject({
          model: deps.model,
          schema: CleanerOutputSchema,
          temperature: CLEANER_CONFIG.TEMPERATURE,
          abortSignal: signal,
          system: getCleanerSystemPrompt(),
          prompt: getCleanerUserPrompt(source, deps.gameName),
        });
      },
      {
        context: `Cleaner: ${source.url.slice(0, 50)}...`,
        signal: deps.signal,
      }
    );

    // Use createTokenUsageFromResult to capture both tokens and actual cost from OpenRouter
    const tokenUsage = createTokenUsageFromResult(result);

    const output = result.object as CleanerLLMOutput;

    // Validate cleaned content is substantial
    if (output.cleanedContent.length < CLEANER_CONFIG.MIN_CLEANED_CHARS) {
      log.debug(
        `Cleaned content too short (${output.cleanedContent.length} chars): ${source.url}`
      );
      return { source: null, tokenUsage };
    }

    // Calculate junk ratio
    const cleanedLength = output.cleanedContent.length;
    const junkRatio = 1 - cleanedLength / originalLength;

    return {
      source: {
        url: source.url,
        domain,
        title: source.title,
        summary: output.summary,
        cleanedContent: output.cleanedContent,
        originalContentLength: originalLength,
        qualityScore: output.qualityScore,
        qualityNotes: output.qualityNotes,
        contentType: output.contentType,
        junkRatio: Math.max(0, Math.min(1, junkRatio)),
        searchSource: source.searchSource,
      },
      tokenUsage,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Failed to clean source ${source.url}: ${message}`);
    return { source: null, tokenUsage: createEmptyTokenUsage() };
  }
}

// ============================================================================
// Batch Cleaning
// ============================================================================

/**
 * Clean multiple sources in parallel batches.
 *
 * @param sources - Raw sources to clean
 * @param deps - Cleaner dependencies
 * @returns Cleaned sources with aggregated token usage
 */
export async function cleanSourcesBatch(
  sources: readonly RawSourceInput[],
  deps: CleanerDeps
): Promise<CleanSourcesBatchResult> {
  const log = deps.logger ?? createPrefixedLogger('[Cleaner]');

  if (sources.length === 0) {
    return { sources: [], tokenUsage: createEmptyTokenUsage() };
  }

  log.info(`Cleaning ${sources.length} sources in batches of ${CLEANER_CONFIG.BATCH_SIZE}...`);

  const cleanedSources: CleanedSource[] = [];
  let totalTokenUsage = createEmptyTokenUsage();
  const batchSize = CLEANER_CONFIG.BATCH_SIZE;

  // Process in batches
  for (let i = 0; i < sources.length; i += batchSize) {
    const batch = sources.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(sources.length / batchSize);

    log.debug(`Processing batch ${batchNum}/${totalBatches} (${batch.length} sources)...`);

    // Clean batch in parallel
    const results = await Promise.all(
      batch.map((source) => cleanSingleSource(source, deps))
    );

    // Collect successful results and aggregate token usage
    for (const result of results) {
      totalTokenUsage = addTokenUsage(totalTokenUsage, result.tokenUsage);
      if (result.source) {
        cleanedSources.push(result.source);
      }
    }

    // Check for cancellation between batches
    if (deps.signal?.aborted) {
      log.info('Cleaning cancelled');
      break;
    }
  }

  const successRate = ((cleanedSources.length / sources.length) * 100).toFixed(1);
  const costStr = totalTokenUsage.actualCostUsd 
    ? ` ($${totalTokenUsage.actualCostUsd.toFixed(4)})` 
    : '';
  log.info(
    `Cleaned ${cleanedSources.length}/${sources.length} sources (${successRate}% success rate)${costStr}`
  );

  return { sources: cleanedSources, tokenUsage: totalTokenUsage };
}

// ============================================================================
// Exports
// ============================================================================

export { CleanerOutputSchema };
