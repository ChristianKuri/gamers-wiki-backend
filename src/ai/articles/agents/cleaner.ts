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
import { extractImagesFromSource } from '../utils/image-extractor';

// Re-export config for backwards compatibility
export { CLEANER_CONFIG } from '../config';

// ============================================================================
// Zod Schema for LLM Output
// ============================================================================

/**
 * Schema for cleaner LLM output (single-step cleaning).
 * Validates structured response from the model.
 * 
 * For two-step cleaning, use PureCleanerOutputSchema + EnhancedSummarySchema instead.
 */
const CleanerOutputSchema = z.object({
  cleanedContent: z
    .string()
    .min(1)
    .describe('The cleaned content with all junk removed. Keep ALL substantive content.'),
  summary: z
    .string()
    .min(1)
    .max(1000)
    .describe('A concise 1-2 sentence summary of what this content is about. Will be used for quick reference.'),
  detailedSummary: z
    .string()
    .min(1)
    .max(10000)
    .describe('A detailed summary (3-5 paragraphs) preserving specific facts, numbers, names, locations, and actionable information. Include concrete details that would be useful for writing an article.'),
  keyFacts: z
    .array(z.string())
    .min(1)
    .max(10)
    .describe('3-7 key facts as bullet points. Each fact should be specific and contain concrete information (names, numbers, locations, strategies).'),
  dataPoints: z
    .array(z.string())
    .min(0)
    .max(15)
    .describe('Specific data points extracted: statistics, dates, version numbers, character names, item names, damage values, percentages, etc. Empty array if no specific data found.'),
  qualityScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('Content quality score 0-100 based on depth, structure, authority, and junk ratio'),
  relevanceScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('Gaming relevance score 0-100. Is this content about video games/gaming? Python docs, cooking recipes, etc. = 0. Game wikis, guides, reviews = 100.'),
  qualityNotes: z
    .string()
    .describe('Brief explanation of quality and relevance scores (1-2 sentences)'),
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
  /** Language model for content cleaning (junk removal) */
  readonly model: LanguageModel;
  /** 
   * Optional separate model for summarization (two-step cleaning).
   * When provided, uses two-step cleaning: clean first, then summarize.
   * This produces better summaries and costs less than single-step.
   * If not provided, falls back to single-step cleaning using `model`.
   */
  readonly summarizerModel?: LanguageModel;
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
 * System prompt for the cleaner agent (single-step cleaning).
 * Used when two-step cleaning is not enabled.
 */
function getCleanerSystemPrompt(): string {
  return `You are a content cleaning specialist for a VIDEO GAME website. Your job is to:
1. Extract valuable content from web pages while removing junk
2. Create detailed summaries with specific facts for article writing
3. Rate content QUALITY (structure, depth, authority)
4. Rate content RELEVANCE TO VIDEO GAMES (PC, console, mobile games)

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
- Images: preserve as markdown ![descriptive alt text](original_url)
  - Keep the EXACT original image URL - do not modify or create URLs
  - Write a descriptive alt text based on context (what the image shows)
- Headings and subheadings
- ALL substantive information

CRITICAL RULES:
1. DO NOT SUMMARIZE the cleanedContent - Keep ALL valuable content, just remove junk
2. Preserve the original structure (headings, lists, paragraphs)
3. Keep the content in markdown format
4. If the content is mostly junk, return what little value exists
5. Be generous - when in doubt, keep the content

SUMMARY (short):
Write a concise 1-2 sentence summary of what this content covers.

DETAILED SUMMARY (rich):
Write a detailed 3-5 paragraph summary that preserves SPECIFIC information:
- Names of characters, items, locations, bosses, abilities
- Numbers: damage values, percentages, stats, costs, distances
- Step-by-step procedures or strategies
- Conditions, requirements, prerequisites
- Tips and warnings
This will be used by writers who may not read the full content, so include all actionable details.

KEY FACTS:
Extract 3-7 key facts as bullet points. Each fact should be SPECIFIC and CONCRETE:
✓ "The Moonlight Greatsword deals 180 base damage and scales with INT"
✓ "Boss has 3 phases, second phase starts at 50% HP"
✓ "Quest requires completing the Ranni questline first"
✗ "This guide covers various strategies" (too vague)
✗ "The game has interesting mechanics" (not actionable)

DATA POINTS:
Extract specific data: statistics, dates, version numbers, character names, item names, damage values, percentages, coordinates, etc.
Examples: "Update 1.09", "35% damage reduction", "Malenia", "Sword of Night and Flame", "2024-03-15 release"
Return empty array if no specific data found.

QUALITY SCORING (0-100) - Content quality regardless of topic:
- Content depth (0-40 pts): Detailed, comprehensive information?
- Structure (0-30 pts): Well-organized, clear headings, logical flow?
- Authority signals (0-30 pts): Wiki, official source, reputable site?

RELEVANCE SCORING (0-100) - Is this about VIDEO GAMES specifically?

VIDEO GAMES = PC games, console games (PlayStation, Xbox, Nintendo), mobile games
NOT VIDEO GAMES = board games, card games, tabletop RPGs, gambling, sports

RELEVANCE SCORE (0-100) - Is this about VIDEO GAMES?
│ 90-100 │ Video game content: guides, wikis, news, reviews, builds, walkthroughs
│ 70-89  │ Patch notes, announcements
│ 50-69  │ Gaming-adjacent: hardware, esports, streaming, game dev content
│ 20-49  │ Tangential: general tech/entertainment mentioning games
│ 0-19   │ NOT video games: board games, tabletop RPGs, D&D, cooking, coding

CRITICAL: Board games, card games, tabletop games are NOT video games!
- boardgamegeek.com content = relevance 0-10 (NOT video games)
- D&D/tabletop RPG content = relevance 0-10 (NOT video games)
- Magic: The Gathering (paper) = relevance 0-10 (NOT video games)
- Poker/gambling = relevance 0 (NOT video games)

IMPORTANT: A page can have HIGH QUALITY but LOW RELEVANCE.
Example: Python documentation is high quality (90+) but 0 relevance to video games.
Example: Board game guide is high quality but 0-10 relevance (not a video game).
Example: A rambling Reddit post might be low quality (30) but high relevance (90) if it's about a video game.

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
  const gameContext = gameName ? `\nContext: This content is being evaluated for an article about the VIDEO GAME "${gameName}".` : '';

  return `Clean the following web content and rate its quality AND relevance to VIDEO GAMES.
${gameContext}

═══════════════════════════════════════════════════════════════════
SOURCE
═══════════════════════════════════════════════════════════════════
URL: ${source.url}
Title: ${source.title}
Raw Length: ${source.content.length.toLocaleString()} chars

═══════════════════════════════════════════════════════════════════
RAW CONTENT
═══════════════════════════════════════════════════════════════════
${source.content.slice(0, CLEANER_CONFIG.MAX_INPUT_CHARS)}

═══════════════════════════════════════════════════════════════════
REQUIRED OUTPUTS
═══════════════════════════════════════════════════════════════════

1. cleanedContent: Remove web junk, keep ALL article content (~90-100% of text)

2. summary (1-2 sentences): What is this content about?

3. detailedSummary (3-5 paragraphs): Preserve ALL specifics!
   • Every proper noun (characters, bosses, items, locations)
   • Every number (damage, HP, costs, percentages)
   • Every strategy, tip, or procedure
   Writers use this WITHOUT reading the original.

4. keyFacts (3-7 items): Specific, actionable facts
   ✓ "Boss X has 5,000 HP and is weak to Fire"
   ✗ "There's a tough boss" (too vague)

5. dataPoints: Every name and number mentioned

6. qualityScore (0-100): Content quality
   90+: Comprehensive wiki | 70-89: Good guide | 50-69: Basic | <50: Poor

7. relevanceScore (0-100): VIDEO GAME relevance
   90+: All video game content (guides, wikis, news, reviews, patch notes)
   60-89: Gaming-adjacent (hardware, esports) | <60: Not gaming
   CRITICAL: Board games, tabletop, D&D = NOT video games (0-19)

8. qualityNotes: Brief explanation of both scores

9. contentType: Specific type (wiki, guide, walkthrough, news, etc.)

CRITICAL FOR SUMMARIES:
- Include SPECIFIC details: character names, item names, damage numbers, percentages
- Preserve step-by-step procedures and strategies
- Include prerequisites, conditions, and warnings
- Be concrete, not vague - writers will use this without reading the full content`;
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
    const startTime = Date.now();
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
        // Full URL + content length for debugging timeouts
        context: `Cleaner [${originalLength} chars]: ${source.url}`,
        signal: deps.signal,
        maxRetries: CLEANER_CONFIG.MAX_RETRIES,
      }
    );
    
    const elapsed = Date.now() - startTime;
    if (elapsed > 30000) {
      // Log slow cleans for monitoring (>30s is notable with 90s timeout)
      log.info(`[Cleaner] Slow clean: ${domain} took ${(elapsed / 1000).toFixed(1)}s for ${originalLength} chars`);
    }

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
    
    // Extract images with validation and context (pass source URL for relative URL resolution)
    const imageResult = extractImagesFromSource(source.content, output.cleanedContent, source.url);
    if (imageResult.discardedCount > 0) {
      // Log at warn level if high hallucination rate (>50% of images discarded)
      const hallucinationRate = imageResult.parsedCount > 0
        ? imageResult.discardedCount / imageResult.parsedCount
        : 0;
      if (hallucinationRate > 0.5) {
        log.warn(`[Cleaner] High image hallucination rate for ${domain}: ${imageResult.discardedCount}/${imageResult.parsedCount} (${(hallucinationRate * 100).toFixed(0)}%) discarded`);
      } else {
        log.debug(`[Cleaner] Discarded ${imageResult.discardedCount} hallucinated image URL(s) for ${domain}`);
      }
    }
    
    // Log completion with raw→cleaned ratio
    const preservedPct = ((cleanedLength / originalLength) * 100).toFixed(0);
    const costStr = tokenUsage.actualCostUsd ? ` ($${tokenUsage.actualCostUsd.toFixed(4)})` : '';
    const imageStr = imageResult.images.length > 0 ? `, ${imageResult.images.length} images` : '';
    log.info(`Single-step clean complete: ${domain} - ${originalLength.toLocaleString()}→${cleanedLength.toLocaleString()}c (${preservedPct}%), Q:${output.qualityScore}, R:${output.relevanceScore}${imageStr}${costStr}`);

    return {
      source: {
        url: source.url,
        domain,
        title: source.title,
        summary: output.summary,
        detailedSummary: output.detailedSummary,
        keyFacts: output.keyFacts,
        dataPoints: output.dataPoints,
        cleanedContent: output.cleanedContent,
        originalContentLength: originalLength,
        qualityScore: output.qualityScore,
        relevanceScore: output.relevanceScore,
        qualityNotes: output.qualityNotes,
        contentType: output.contentType,
        junkRatio: Math.max(0, Math.min(1, junkRatio)),
        searchSource: source.searchSource,
        images: imageResult.images.length > 0 ? imageResult.images : null,
      },
      tokenUsage,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Failed to clean source ${source.url}: ${message}`);

    // Fallback: return raw content with low quality score so it can still be used
    // This prevents losing potentially valuable content due to LLM timeouts
    const domain = extractDomain(source.url);
    log.info(`[Cleaner] Falling back to raw content for ${source.url}`);

    return {
      source: {
        url: source.url,
        domain,
        title: source.title,
        summary: `[Cleaning failed: ${message}] ${source.title}`,
        detailedSummary: null, // Not available for fallback
        keyFacts: null, // Not available for fallback
        dataPoints: null, // Not available for fallback
        cleanedContent: source.content.slice(0, CLEANER_CONFIG.MAX_INPUT_CHARS),
        originalContentLength: source.content.length,
        qualityScore: 25, // Low score since uncleaned
        relevanceScore: 50, // Neutral - we don't know without cleaning
        qualityNotes: `Cleaning failed after retries: ${message}. Using raw content as fallback.`,
        contentType: 'raw fallback',
        junkRatio: 0, // Unknown junk ratio
        searchSource: source.searchSource,
        images: null, // Not available for fallback
      },
      tokenUsage: createEmptyTokenUsage(),
    };
  }
}

// ============================================================================
// Batch Cleaning
// ============================================================================

/**
 * Clean multiple sources in parallel batches.
 * 
 * When `summarizerModel` is provided in deps, uses two-step cleaning:
 * 1. Clean content (remove junk, preserve full content)
 * 2. Summarize cleaned content (extract summaries, key facts, data points)
 * 
 * This approach is cheaper and produces better quality summaries than single-step.
 *
 * @param sources - Raw sources to clean
 * @param deps - Cleaner dependencies (include summarizerModel for two-step)
 * @returns Cleaned sources with aggregated token usage
 */
export async function cleanSourcesBatch(
  sources: readonly RawSourceInput[],
  deps: CleanerDeps
): Promise<CleanSourcesBatchResult> {
  const log = deps.logger ?? createPrefixedLogger('[Cleaner]');
  // Use two-step if enabled in config AND summarizerModel is provided
  const useTwoStep = CLEANER_CONFIG.TWO_STEP_ENABLED && Boolean(deps.summarizerModel);

  if (sources.length === 0) {
    return { sources: [], tokenUsage: createEmptyTokenUsage() };
  }

  const mode = useTwoStep ? 'two-step' : 'single-step';
  log.info(`Cleaning ${sources.length} sources in batches of ${CLEANER_CONFIG.BATCH_SIZE} (${mode})...`);

  const cleanedSources: CleanedSource[] = [];
  let totalTokenUsage = createEmptyTokenUsage();
  const batchSize = CLEANER_CONFIG.BATCH_SIZE;

  // Process in batches
  for (let i = 0; i < sources.length; i += batchSize) {
    const batch = sources.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(sources.length / batchSize);

    log.debug(`Processing batch ${batchNum}/${totalBatches} (${batch.length} sources)...`);

    // Clean batch in parallel - use two-step if summarizerModel provided
    const results = await Promise.all(
      batch.map((source) => {
        if (useTwoStep && deps.summarizerModel) {
          // Two-step cleaning: better quality, cheaper
          const twoStepDeps: TwoStepCleanerDeps = {
            generateObject: deps.generateObject,
            cleanerModel: deps.model,
            summarizerModel: deps.summarizerModel,
            logger: deps.logger,
            signal: deps.signal,
            gameName: deps.gameName,
          };
          return cleanSourceTwoStep(source, twoStepDeps).then((r) => ({
            source: r.source,
            tokenUsage: r.totalTokenUsage,
          }));
        } else {
          // Single-step cleaning (legacy)
          return cleanSingleSource(source, deps);
        }
      })
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
// TWO-STEP CLEANING: Step 1 - Pure Content Cleaning (No Summaries)
// ============================================================================

/**
 * Schema for pure cleaning output (no summaries).
 * Used in step 1 of two-step cleaning where summarization is separate.
 * 
 * Two-step process:
 * 1. PureCleanerOutputSchema → removes junk, preserves full content
 * 2. EnhancedSummarySchema → extracts structured summaries from cleaned content
 */
const PureCleanerOutputSchema = z.object({
  cleanedContent: z
    .string()
    .min(1)
    .describe('Full article content with web junk removed. Keep 90-100% of original article text. Do NOT summarize, condense, or paraphrase.'),
  qualityScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('Content quality 0-100: 90+: Comprehensive wiki | 70-89: Good guide | 50-69: Basic | <50: Poor/junk'),
  relevanceScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('VIDEO GAME relevance 0-100: 90+: All video game content (guides, wikis, news, reviews) | 60-89: Gaming-adjacent (hardware, esports) | <60: Not gaming. Board games/tabletop = 0-19.'),
  qualityNotes: z
    .string()
    .describe('Brief explanation of both scores (1-2 sentences)'),
  contentType: z
    .string()
    .min(1)
    .max(100)
    .describe('Specific content type: "wiki article", "strategy guide", "walkthrough", "build guide", "news", "patch notes", etc.'),
});

/**
 * System prompt for PURE content cleaning (no summarization).
 * Focused only on removing junk and preserving content.
 */
function getPureCleanerSystemPrompt(): string {
  return `You are a surgical content extractor for video game articles. Your job is to remove web page JUNK while preserving 100% of the ARTICLE CONTENT.

═══════════════════════════════════════════════════════════════════
WHAT IS "JUNK"? (REMOVE completely)
═══════════════════════════════════════════════════════════════════

NAVIGATION & CHROME:
✗ Headers, footers, sidebars, navigation menus
✗ Breadcrumbs (Home > Games > Guide)
✗ Site logos, search bars
✗ "Back to top" links

USER INTERACTION NOISE:
✗ Cookie/consent banners, popups, modals
✗ Login/signup prompts, paywalls
✗ Newsletter signups, email capture forms
✗ Social media buttons (Share, Like, Tweet)
✗ "Print", "Save", "Bookmark" buttons
✗ Rating widgets, voting buttons

PROMOTIONAL CONTENT:
✗ Advertisements, sponsored content, affiliate disclaimers
✗ "You might also like", "Related articles" sections
✗ Cross-promotion banners

USER-GENERATED NOISE:
✗ Comments sections, replies, discussions
✗ "X users found this helpful"
✗ User ratings/reviews (unless part of main article)

BOILERPLATE:
✗ Legal disclaimers, copyright notices
✗ Site-wide announcements
✗ Author bio cards (unless discussing the game)
✗ Publication metadata (date, category tags as UI elements)

═══════════════════════════════════════════════════════════════════
WHAT IS "CONTENT"? (KEEP everything)
═══════════════════════════════════════════════════════════════════

ARTICLE TEXT:
✓ Every paragraph of the main article - KEEP ALL
✓ All headings (H1, H2, H3, etc.) - preserve hierarchy
✓ Introduction, body, conclusion sections

STRUCTURED INFORMATION:
✓ Tables with data (full tables, all rows and columns)
✓ Numbered lists (steps, rankings, orderings)
✓ Bulleted lists (items, features, tips)
✓ Stat blocks, character sheets, item stats

SPECIAL CONTENT:
✓ Code snippets, console commands, cheat codes
✓ Quoted text that's part of the article narrative
✓ Images → preserve as markdown: ![descriptive alt text](original_url)
  - Keep the EXACT original image URL unchanged
  - Write a helpful alt text describing what the image shows
✓ Embedded video descriptions → [Video: description]

═══════════════════════════════════════════════════════════════════
CRITICAL RULES (Follow EXACTLY)
═══════════════════════════════════════════════════════════════════

1. NEVER SUMMARIZE: Your output should contain 90-100% of the original article text, KEEP FULL CONTENT.
2. NEVER CONDENSE: If source has 10 paragraphs, output has ~10 paragraphs
3. NEVER PARAPHRASE: Keep the original wording, don't rewrite
4. PRESERVE STRUCTURE: Headings, lists, tables stay in their format
5. OUTPUT FORMAT: Clean markdown (no HTML tags)
6. WHEN IN DOUBT: Include the content - false positives are better than losing info

═══════════════════════════════════════════════════════════════════
SCORING GUIDELINES
═══════════════════════════════════════════════════════════════════

QUALITY SCORING (0-100):
- Content depth (0-40): Detailed, comprehensive?
- Structure (0-30): Well-organized, clear headings?
- Authority (0-30): Wiki, official source, expert site?

RELEVANCE SCORE (0-100) - Is this about VIDEO GAMES?
│ 90-100 │ Video game content: guides, wikis, news, reviews, builds, walkthroughs
│ 70-89  │ Patch notes, announcements
│ 50-69  │ Gaming-adjacent: hardware, esports, streaming, game dev content
│ 20-49  │ Tangential: general tech/entertainment mentioning games
│ 0-19   │ NOT video games: board games, tabletop RPGs, D&D, cooking, coding`;
}

/**
 * User prompt for pure content cleaning.
 */
function getPureCleanerUserPrompt(source: RawSourceInput, gameName?: string): string {
  const gameContext = gameName 
    ? `\nContext: Cleaning content for an article about "${gameName}".` 
    : '';

  return `Extract the article content from this web page. Remove web junk, keep EVERYTHING else.
${gameContext}

═══════════════════════════════════════════════════════════════════
SOURCE METADATA
═══════════════════════════════════════════════════════════════════
URL: ${source.url}
Title: ${source.title}
Raw Length: ${source.content.length.toLocaleString()} characters

═══════════════════════════════════════════════════════════════════
RAW WEB CONTENT (extract article from this)
═══════════════════════════════════════════════════════════════════
${source.content.slice(0, CLEANER_CONFIG.MAX_INPUT_CHARS)}

═══════════════════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════════════════

cleanedContent: Extract the FULL article. Remove navigation, ads, comments, etc.
IMPORTANT: Do NOT summarize or condense. Output should be ~90-100% of article length.

QUALITY SCORING (0-100):
- Content depth (0-40): Detailed, comprehensive?
- Structure (0-30): Well-organized, clear headings?
- Authority (0-30): Wiki, official source, expert site?

RELEVANCE SCORE (0-100) - Is this about VIDEO GAMES?
│ 90-100 │ Video game content: guides, wikis, news, reviews, builds, walkthroughs
│ 70-89  │ Patch notes, announcements
│ 50-69  │ Gaming-adjacent: hardware, esports, streaming, game dev content
│ 20-49  │ Tangential: general tech/entertainment mentioning games
│ 0-19   │ NOT video games: board games, tabletop RPGs, D&D, cooking, coding

qualityNotes: 1-2 sentences explaining both scores

contentType: What kind of content? (e.g., "wiki article", "strategy guide", "walkthrough", "news article")`;
}

// ============================================================================
// TWO-STEP CLEANING: Step 2 - Enhanced Summarization
// ============================================================================

/**
 * Enhanced schema for summary extraction with more detailed output.
 * 
 * Two-step cleaning process:
 * 1. Cleaner extracts content (removes junk) → cleanedContent + scores
 * 2. Summarizer extracts structured info → summary, keyFacts, dataPoints, etc.
 * 
 * This schema is used in step 2 (summarization).
 */
const EnhancedSummarySchema = z.object({
  summary: z
    .string()
    .min(50)
    .max(500)
    .describe('Quick-reference overview: 2-4 sentences (100-400 chars) covering content type, main topic, and scope.'),
  detailedSummary: z
    .string()
    .min(300)
    .max(20000)
    .describe('THE MOST IMPORTANT OUTPUT. 5-10 paragraphs (500+ words) preserving ALL specifics: every proper noun (characters, bosses, items, locations), every number (damage, HP, costs, percentages), every strategy/tip. Writers use this WITHOUT reading original.'),
  keyFacts: z
    .array(z.string())
    .min(3)
    .max(15)
    .describe('5-15 standalone facts writers can directly use. Each MUST contain specifics: "Margit has 4,174 HP and is weak to Bleed" NOT "There are tough bosses."'),
  dataPoints: z
    .array(z.string())
    .min(0)
    .max(50)
    .describe('Raw data extraction - every name and number. Names: characters, bosses, items, locations, abilities. Numbers: stats, costs, percentages, levels, versions.'),
  procedures: z
    .array(z.string())
    .min(0)
    .max(20)
    .describe('Step-by-step instructions or strategies IF present in content. Each should be actionable: "To meet Renna: 1) Meet Melina 2) Return to Church at night 3) Speak with Renna"'),
  requirements: z
    .array(z.string())
    .min(0)
    .max(15)
    .describe('Prerequisites and conditions IF mentioned: "Requires 2x Stonesword Key", "Level 30+ recommended", "Must defeat Margit first"'),
});

/**
 * Enhanced system prompt for detailed, accurate summarization.
 */
function getEnhancedSummarySystemPrompt(): string {
  return `You are an expert video game content summarizer. Writers will use your summaries WITHOUT reading the original - you must capture EVERYTHING important.

═══════════════════════════════════════════════════════════════════
OUTPUT 1: SUMMARY (Required: 2-4 sentences, 100-400 characters)
═══════════════════════════════════════════════════════════════════
A quick-reference overview covering:
• Content type (guide, wiki, walkthrough, news, build guide, news article, patch notes, etc.)
• Main topic/subject
• Scope (what parts of the game it covers)

Example: "A comprehensive boss guide for Elden Ring's Limgrave region, covering strategies for Margit, Godrick, and 15 mini-bosses. Includes recommended levels, weapon suggestions, and phase-by-phase breakdowns."

═══════════════════════════════════════════════════════════════════
OUTPUT 2: DETAILED SUMMARY (Required: 5-10 paragraphs, 500+ words)
═══════════════════════════════════════════════════════════════════
This is your MOST IMPORTANT output. Structure it as:

PARAGRAPH 1 - Overview:
• What the content covers and its purpose
• Target audience (beginners, completionists, speedrunners)
• How the content is organized

PARAGRAPHS 2-7 - Core Information (preserve ALL specifics):
• Every major topic, section, or game area discussed
• ALL proper nouns: character names, boss names, NPC names
• ALL item names: weapons, armor, consumables, key items
• ALL location names: regions, dungeons, landmarks, Sites of Grace
• ALL numbers: damage values, HP, costs, drop rates, percentages
• ALL strategies: combat tactics, optimal rotations, cheese methods
• ALL tips: warnings, common mistakes, pro advice

PARAGRAPHS 8-10 - Additional Context:
• Prerequisites and requirements
• Rewards, drops, unlocks
• Version/patch information
• Related topics or follow-up content

CRITICAL: If the original mentions "450 damage" or "Renna at Church of Elleh" - include it. Missing specifics = writers can't use them.

═══════════════════════════════════════════════════════════════════
OUTPUT 3: KEY FACTS (Required: 5-15 bullet points)
═══════════════════════════════════════════════════════════════════
Standalone facts a writer can directly use. Each MUST contain specifics:

GOOD (specific, actionable):
✓ "Margit the Fell Omen has 4,174 HP and is vulnerable to Bleed and Jump Attacks"
✓ "Spirit Calling Bell is obtained from Renna at Church of Elleh (only appears at night)"
✓ "Gatefront Ruins contains: Lordsworn's Greatsword, Whetstone Knife, Map: Limgrave West"
✓ "Tree Sentinel drops Golden Halberd (requires Str 30, Dex 14, Fai 12)"
✓ "Recommended level for Stormveil Castle: 30-40"

BAD (vague, not actionable):
✗ "There are several bosses in this area"
✗ "The combat system is complex"
✗ "Players should explore thoroughly"

═══════════════════════════════════════════════════════════════════
OUTPUT 4: DATA POINTS (Required: 0-30 items)
═══════════════════════════════════════════════════════════════════
Raw data extraction - every specific piece of information:

NAMES (always include):
• Characters: "Melina", "White-Faced Varré", "Iron Fist Alexander"
• Bosses: "Margit", "Godrick the Grafted", "Tree Sentinel"  
• Items: "Flask of Crimson Tears", "Stonesword Key", "Smithing Stone [1]"
• Locations: "Church of Elleh", "Gatefront Ruins", "Stormveil Castle"
• Skills: "Storm Stomp", "Glintstone Pebble", "Flame of the Redmanes"

NUMBERS (always include):
• Stats: "4,174 HP", "30 Strength", "18 Dexterity"
• Costs: "2,000 Runes", "8,000 souls", "500 gold"
• Percentages: "50% damage boost", "25% drop rate", "10% HP threshold"
• Distances/Times: "100 meters", "5 seconds", "3 turns"
• Versions: "Patch 1.09", "Update 1.5.0", "Version 2.0"

═══════════════════════════════════════════════════════════════════
OUTPUT 5: PROCEDURES (Optional: 0-20 items)
═══════════════════════════════════════════════════════════════════
Step-by-step instructions or strategies. Include ONLY if content has procedural info:

Examples:
• "To meet Renna: 1) Meet Melina at Gatefront 2) Return to Church of Elleh at night 3) Speak with Renna near the ruins"
• "Tree Sentinel strategy: Use Torrent, maintain medium range, punish after his charge attack, avoid his shield bash"
• "Unlock Bloody Slash: Defeat Godrick Knight at Fort Haight, loot the Ash of War"

═══════════════════════════════════════════════════════════════════
OUTPUT 6: REQUIREMENTS (Optional: 0-10 items)
═══════════════════════════════════════════════════════════════════
Prerequisites, conditions, and dependencies. Include ONLY if content mentions them:

Examples:
• "Requires: Meeting Melina first (automatic at third Site of Grace)"
• "Requires: 2x Stonesword Key to unlock Fringefolk Hero's Grave"
• "Prerequisite: Must defeat Margit to enter Stormveil Castle"
• "Level requirement: 30+ recommended for Raya Lucaria"`;
}

/**
 * Enhanced user prompt for detailed summarization.
 */
function getEnhancedSummaryUserPrompt(title: string, cleanedContent: string, gameName?: string): string {
  const gameContext = gameName 
    ? `Game: "${gameName}"` 
    : 'Game: (not specified)';
  const truncatedContent = cleanedContent.slice(0, CLEANER_CONFIG.MAX_INPUT_CHARS);

  return `Create a HIGHLY DETAILED (ULTRA IMPORTANT) and ACCURATE summary of this video game content.

Title: ${title}
Content Length: ${cleanedContent.length} characters

Writers will use your summary WITHOUT reading the original - include ALL important information.
${gameContext}

═══════════════════════════════════════════════════════════════════
CLEANED CONTENT TO SUMMARIZE
═══════════════════════════════════════════════════════════════════
${truncatedContent}

═══════════════════════════════════════════════════════════════════
REQUIRED OUTPUTS (extract everything)
═══════════════════════════════════════════════════════════════════

1. summary (100-400 chars)
   Quick overview: What is this content? What does it cover?

2. detailedSummary (500+ words, 5-10 paragraphs)
   THE MOST IMPORTANT OUTPUT. Preserve ALL:
   • Every proper noun (characters, bosses, items, locations)
   • Every number (damage, HP, costs, percentages, levels)
   • Every strategy, tip, or procedure mentioned
   Writers cannot use information you don't include!

3. keyFacts (5-15 bullet points)
   Standalone facts with SPECIFIC details:
   ✓ "Boss X has 5,000 HP and is weak to Fire"
   ✗ "There's a tough boss here" (too vague)

4. dataPoints (up to 30 items)
   Raw data extraction - every name and number:
   Names: characters, bosses, items, locations, abilities
   Numbers: stats, costs, percentages, levels, durations

5. procedures (0-20 items, if applicable)
   Step-by-step instructions found in the content

6. requirements (0-10 items, if applicable)
   Prerequisites, level requirements, unlock conditions

═══════════════════════════════════════════════════════════════════
REMEMBER: ITS A CRITICAL FEALURE TO MISS DETAILS. BE EXHAUSTIVE.
═══════════════════════════════════════════════════════════════════`;
}

// ============================================================================
// Legacy Summary Extraction (for backwards compatibility)
// ============================================================================

/**
 * Schema for summary extraction from already-cleaned content.
 * Used for backfilling legacy cached content that has cleanedContent but no summaries.
 */
const SummaryExtractionSchema = z.object({
  summary: z
    .string()
    .min(1)
    .max(1000)
    .describe('A concise 1-2 sentence summary of what this content is about.'),
  detailedSummary: z
    .string()
    .min(1)
    .max(10000)
    .describe('A detailed summary (3-5 paragraphs) preserving specific facts, numbers, names, locations, and actionable information.'),
  keyFacts: z
    .array(z.string())
    .min(1)
    .max(10)
    .describe('3-7 key facts as bullet points. Each fact should be specific and contain concrete information.'),
  dataPoints: z
    .array(z.string())
    .min(0)
    .max(15)
    .describe('Specific data points extracted: statistics, dates, version numbers, character names, item names, etc.'),
});

/**
 * @deprecated Use getEnhancedSummarySystemPrompt for new code
 */
function getSummaryExtractionSystemPrompt(): string {
  return `You are extracting summaries and key facts from ALREADY CLEANED video game content.
The content has already been cleaned of navigation, ads, and junk. Your job is to summarize it.

SUMMARY (short):
Write a concise 1-2 sentence summary of what this content covers.

DETAILED SUMMARY (rich):
Write a detailed 3-5 paragraph summary that preserves SPECIFIC information:
- Names of characters, items, locations, bosses, abilities
- Numbers: damage values, percentages, stats, costs, distances
- Step-by-step procedures or strategies
- Conditions, requirements, prerequisites
- Tips and warnings
This will be used by writers who may not read the full content, so include all actionable details.

KEY FACTS:
Extract 3-7 key facts as bullet points. Each fact should be SPECIFIC and CONCRETE:
✓ "The Moonlight Greatsword deals 180 base damage and scales with INT"
✓ "Boss has 3 phases, second phase starts at 50% HP"
✓ "Quest requires completing the Ranni questline first"
✗ "This guide covers various strategies" (too vague)
✗ "The game has interesting mechanics" (not actionable)

DATA POINTS:
Extract specific data: statistics, dates, version numbers, character names, item names, damage values, percentages, etc.
Return empty array if no specific data found.`;
}

/**
 * @deprecated Use getEnhancedSummaryUserPrompt for new code
 */
function getSummaryExtractionUserPrompt(title: string, cleanedContent: string, gameName?: string): string {
  const gameContext = gameName ? `\nContext: This content is about the video game "${gameName}".` : '';
  const truncatedContent = cleanedContent.slice(0, CLEANER_CONFIG.MAX_INPUT_CHARS);

  return `Extract summaries and key facts from this already-cleaned video game content.
${gameContext}

Title: ${title}

=== CLEANED CONTENT ===
${truncatedContent}
=== END CONTENT ===

Extract and return:
1. summary: A concise 1-2 sentence summary
2. detailedSummary: A rich 3-5 paragraph summary with ALL specific facts, names, numbers
3. keyFacts: 3-7 specific, concrete facts as bullet points
4. dataPoints: Array of specific data (stats, dates, names, numbers)`;
}

/**
 * Result of extracting summaries from cleaned content.
 */
export interface SummaryExtractionResult {
  readonly summary: string;
  readonly detailedSummary: string;
  readonly keyFacts: readonly string[];
  readonly dataPoints: readonly string[];
  readonly tokenUsage: TokenUsage;
}

/**
 * Extract summaries from already-cleaned content.
 * Used for backfilling legacy cached sources that have cleanedContent but no summaries.
 * 
 * This is MUCH cheaper than full cleaning since:
 * - No junk removal needed (content already cleaned)
 * - Smaller output (just summaries, not full cleanedContent)
 * - Can use smaller/faster model
 * 
 * @param title - Title of the source
 * @param cleanedContent - Already cleaned content
 * @param deps - Cleaner dependencies
 * @param gameName - Optional game name for context
 * @returns Extracted summaries or null if extraction fails
 */
export async function extractSummariesFromCleanedContent(
  title: string,
  cleanedContent: string,
  deps: CleanerDeps,
  gameName?: string
): Promise<SummaryExtractionResult | null> {
  const log = deps.logger ?? createPrefixedLogger('[Cleaner]');

  // Skip if content is too short
  if (cleanedContent.length < CLEANER_CONFIG.MIN_CLEANED_CHARS) {
    log.debug(`Content too short for summary extraction: ${cleanedContent.length} chars`);
    return null;
  }

  try {
    const result = await withRetry(
      async () => {
        const timeoutSignal = AbortSignal.timeout(CLEANER_CONFIG.TIMEOUT_MS);
        const signal = deps.signal
          ? AbortSignal.any([deps.signal, timeoutSignal])
          : timeoutSignal;

        return deps.generateObject({
          model: deps.model,
          schema: SummaryExtractionSchema,
          temperature: CLEANER_CONFIG.TEMPERATURE,
          abortSignal: signal,
          system: getSummaryExtractionSystemPrompt(),
          prompt: getSummaryExtractionUserPrompt(title, cleanedContent, gameName),
        });
      },
      {
        context: `Summary extraction: ${title.slice(0, 50)}...`,
        signal: deps.signal,
        maxRetries: CLEANER_CONFIG.MAX_RETRIES,
      }
    );

    const tokenUsage = createTokenUsageFromResult(result);
    const output = result.object;

    return {
      summary: output.summary,
      detailedSummary: output.detailedSummary,
      keyFacts: output.keyFacts,
      dataPoints: output.dataPoints,
      tokenUsage,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Failed to extract summaries from "${title}": ${message}`);
    return null;
  }
}

// ============================================================================
// TWO-STEP CLEANING: Combined Implementation
// ============================================================================

/**
 * Dependencies for two-step cleaning.
 * Allows using different models for cleaning vs summarization.
 */
export interface TwoStepCleanerDeps {
  readonly generateObject: typeof import('ai').generateObject;
  /** Model for step 1: content cleaning */
  readonly cleanerModel: import('ai').LanguageModel;
  /** Model for step 2: summarization (can be same as cleanerModel) */
  readonly summarizerModel: import('ai').LanguageModel;
  readonly logger?: Logger;
  readonly signal?: AbortSignal;
  readonly gameName?: string;
}

/**
 * Enhanced summary result with additional fields.
 */
export interface EnhancedSummaryResult {
  readonly summary: string;
  readonly detailedSummary: string;
  readonly keyFacts: readonly string[];
  readonly dataPoints: readonly string[];
  readonly procedures: readonly string[];
  readonly requirements: readonly string[];
  readonly tokenUsage: TokenUsage;
}

/**
 * Result of two-step cleaning.
 */
export interface TwoStepCleanResult {
  /** Cleaned source with enhanced summaries */
  readonly source: CleanedSource | null;
  /** Token usage from step 1 (cleaning) */
  readonly cleaningTokenUsage: TokenUsage;
  /** Token usage from step 2 (summarization) */
  readonly summaryTokenUsage: TokenUsage;
  /** Combined token usage */
  readonly totalTokenUsage: TokenUsage;
  /** Enhanced summary data (includes procedures, requirements) */
  readonly enhancedSummary: EnhancedSummaryResult | null;
}

/**
 * Step 1: Pure content cleaning (no summarization).
 * Focused only on removing junk and preserving content.
 */
async function cleanContentOnly(
  source: RawSourceInput,
  deps: TwoStepCleanerDeps
): Promise<{ cleanedContent: string; qualityScore: number; relevanceScore: number; qualityNotes: string; contentType: string; tokenUsage: TokenUsage } | null> {
  const log = deps.logger ?? createPrefixedLogger('[Cleaner:Step1]');

  if (!source.content || source.content.trim().length === 0) {
    log.debug(`Skipping empty content: ${source.url}`);
    return null;
  }

  if (source.content.length < CLEANER_CONFIG.MIN_CLEANED_CHARS) {
    log.debug(`Skipping short content (${source.content.length} chars): ${source.url}`);
    return null;
  }

  try {
    const result = await withRetry(
      async () => {
        const timeoutSignal = AbortSignal.timeout(CLEANER_CONFIG.TIMEOUT_MS);
        const signal = deps.signal
          ? AbortSignal.any([deps.signal, timeoutSignal])
          : timeoutSignal;

        return deps.generateObject({
          model: deps.cleanerModel,
          schema: PureCleanerOutputSchema,
          temperature: CLEANER_CONFIG.TEMPERATURE,
          abortSignal: signal,
          system: getPureCleanerSystemPrompt(),
          prompt: getPureCleanerUserPrompt(source, deps.gameName),
        });
      },
      {
        context: `Cleaner Step1 [${source.content.length} chars]: ${source.url}`,
        signal: deps.signal,
        maxRetries: CLEANER_CONFIG.MAX_RETRIES,
      }
    );

    const tokenUsage = createTokenUsageFromResult(result);
    const output = result.object;

    if (output.cleanedContent.length < CLEANER_CONFIG.MIN_CLEANED_CHARS) {
      log.debug(`Cleaned content too short (${output.cleanedContent.length} chars): ${source.url}`);
      return null;
    }

    return {
      cleanedContent: output.cleanedContent,
      qualityScore: output.qualityScore,
      relevanceScore: output.relevanceScore,
      qualityNotes: output.qualityNotes,
      contentType: output.contentType,
      tokenUsage,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Step 1 (cleaning) failed for ${source.url}: ${message}`);
    return null;
  }
}

/**
 * Step 2: Enhanced summarization from cleaned content.
 * Creates detailed, accurate summaries.
 */
async function extractEnhancedSummaries(
  title: string,
  cleanedContent: string,
  deps: TwoStepCleanerDeps
): Promise<EnhancedSummaryResult | null> {
  const log = deps.logger ?? createPrefixedLogger('[Cleaner:Step2]');

  if (cleanedContent.length < CLEANER_CONFIG.MIN_CLEANED_CHARS) {
    log.debug(`Content too short for summarization: ${cleanedContent.length} chars`);
    return null;
  }

  try {
    const result = await withRetry(
      async () => {
        const timeoutSignal = AbortSignal.timeout(CLEANER_CONFIG.TIMEOUT_MS);
        const signal = deps.signal
          ? AbortSignal.any([deps.signal, timeoutSignal])
          : timeoutSignal;

        return deps.generateObject({
          model: deps.summarizerModel,
          schema: EnhancedSummarySchema,
          temperature: CLEANER_CONFIG.TEMPERATURE,
          abortSignal: signal,
          system: getEnhancedSummarySystemPrompt(),
          prompt: getEnhancedSummaryUserPrompt(title, cleanedContent, deps.gameName),
        });
      },
      {
        context: `Cleaner Step2 (summarize): ${title.slice(0, 50)}...`,
        signal: deps.signal,
        maxRetries: CLEANER_CONFIG.MAX_RETRIES,
      }
    );

    const tokenUsage = createTokenUsageFromResult(result);
    const output = result.object;

    return {
      summary: output.summary,
      detailedSummary: output.detailedSummary,
      keyFacts: output.keyFacts,
      dataPoints: output.dataPoints,
      procedures: output.procedures,
      requirements: output.requirements,
      tokenUsage,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Step 2 (summarization) failed for "${title}": ${message}`);
    return null;
  }
}

/**
 * Two-step content cleaning: Clean first, then summarize.
 * 
 * Benefits over single-step:
 * - Cleaner focuses ONLY on removing junk (won't over-summarize)
 * - Summarizer gets clean input (better quality summaries)
 * - Can use different/optimized models for each step
 * - Often cheaper overall
 * 
 * @param source - Raw source input
 * @param deps - Two-step cleaner dependencies
 * @returns Cleaned source with enhanced summaries
 */
export async function cleanSourceTwoStep(
  source: RawSourceInput,
  deps: TwoStepCleanerDeps
): Promise<TwoStepCleanResult> {
  const log = deps.logger ?? createPrefixedLogger('[Cleaner:2Step]');
  const originalLength = source.content.length;
  const domain = extractDomain(source.url);

  // Step 1: Clean content
  log.debug(`Step 1: Cleaning ${originalLength} chars from ${domain}...`);
  const cleanResult = await cleanContentOnly(source, deps);

  if (!cleanResult) {
    return {
      source: null,
      cleaningTokenUsage: createEmptyTokenUsage(),
      summaryTokenUsage: createEmptyTokenUsage(),
      totalTokenUsage: createEmptyTokenUsage(),
      enhancedSummary: null,
    };
  }

  log.debug(`Step 1 complete: ${cleanResult.cleanedContent.length} chars cleaned (${((cleanResult.cleanedContent.length / originalLength) * 100).toFixed(0)}% preserved)`);

  // Step 2: Extract enhanced summaries
  log.debug(`Step 2: Summarizing ${cleanResult.cleanedContent.length} chars...`);
  const summaryResult = await extractEnhancedSummaries(source.title, cleanResult.cleanedContent, deps);

  const totalTokenUsage = addTokenUsage(
    cleanResult.tokenUsage,
    summaryResult?.tokenUsage ?? createEmptyTokenUsage()
  );

  // Calculate junk ratio
  const junkRatio = 1 - cleanResult.cleanedContent.length / originalLength;

  // Extract images with validation and context (pass source URL for relative URL resolution)
  const imageResult = extractImagesFromSource(source.content, cleanResult.cleanedContent, source.url);
  if (imageResult.discardedCount > 0) {
    // Log at warn level if high hallucination rate (>50% of images discarded)
    const hallucinationRate = imageResult.parsedCount > 0
      ? imageResult.discardedCount / imageResult.parsedCount
      : 0;
    if (hallucinationRate > 0.5) {
      log.warn(`[Cleaner] High image hallucination rate for ${domain}: ${imageResult.discardedCount}/${imageResult.parsedCount} (${(hallucinationRate * 100).toFixed(0)}%) discarded`);
    } else {
      log.debug(`[Cleaner] Discarded ${imageResult.discardedCount} hallucinated image URL(s) for ${domain}`);
    }
  }

  // Build cleaned source
  const cleanedSource: CleanedSource = {
    url: source.url,
    domain,
    title: source.title,
    summary: summaryResult?.summary ?? null,
    detailedSummary: summaryResult?.detailedSummary ?? null,
    keyFacts: summaryResult?.keyFacts ?? null,
    dataPoints: summaryResult?.dataPoints ?? null,
    cleanedContent: cleanResult.cleanedContent,
    originalContentLength: originalLength,
    qualityScore: cleanResult.qualityScore,
    relevanceScore: cleanResult.relevanceScore,
    qualityNotes: cleanResult.qualityNotes,
    contentType: cleanResult.contentType,
    junkRatio: Math.max(0, Math.min(1, junkRatio)),
    searchSource: source.searchSource,
    images: imageResult.images.length > 0 ? imageResult.images : null,
  };

  const costStr = totalTokenUsage.actualCostUsd 
    ? ` ($${totalTokenUsage.actualCostUsd.toFixed(4)})` 
    : '';
  const preservedPct = ((cleanResult.cleanedContent.length / originalLength) * 100).toFixed(0);
  const imageStr = imageResult.images.length > 0 ? `, ${imageResult.images.length} images` : '';
  log.info(`Two-step clean complete: ${source.url} - ${originalLength.toLocaleString()}→${cleanResult.cleanedContent.length.toLocaleString()}c (${preservedPct}%), Q:${cleanResult.qualityScore}, R:${cleanResult.relevanceScore}${imageStr}${costStr}`);

  return {
    source: cleanedSource,
    cleaningTokenUsage: cleanResult.tokenUsage,
    summaryTokenUsage: summaryResult?.tokenUsage ?? createEmptyTokenUsage(),
    totalTokenUsage,
    enhancedSummary: summaryResult,
  };
}

// ============================================================================
// Pre-Filter: Quick Relevance Check (Cheap LLM call)
// ============================================================================

/**
 * Schema for pre-filter LLM output.
 * Uses two relevance scores for nuanced filtering.
 */
const PreFilterOutputSchema = z.object({
  relevanceToGaming: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('Is this content about VIDEO GAMES in general? 0 = not at all (cooking, programming, adult), 100 = definitely about video games (game guides, reviews, wikis)'),
  relevanceToArticle: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('Is this content relevant to the SPECIFIC article we are writing? 0 = unrelated to article topic, 100 = directly useful for this article'),
  reason: z
    .string()
    .max(150)
    .describe('Brief reason for the scores (max 150 chars)'),
  contentType: z
    .string()
    .max(50)
    .describe('Type of content detected (e.g., "game guide", "wiki", "news", "adult content", "programming tutorial")'),
});

type PreFilterOutput = z.infer<typeof PreFilterOutputSchema>;

/**
 * Pre-filter result for a single source.
 */
export interface PreFilterSingleResult {
  readonly url: string;
  readonly domain: string;
  readonly title: string;
  readonly relevanceToGaming: number;
  readonly relevanceToArticle: number;
  readonly reason: string;
  readonly contentType: string;
  readonly tokenUsage: TokenUsage;
}

/**
 * Pre-filter batch result.
 */
export interface PreFilterBatchResult {
  readonly relevant: RawSourceInput[];
  readonly irrelevant: Array<{
    source: RawSourceInput;
    relevanceToGaming: number;
    relevanceToArticle: number;
    reason: string;
  }>;
  readonly results: PreFilterSingleResult[];
  readonly tokenUsage: TokenUsage;
}

/**
 * Get pre-filter system prompt.
 */
function getPreFilterSystemPrompt(): string {
  return `You are a content relevance filter for Gamers.Wiki, a VIDEO GAME blog.

Your job is to score web content on TWO dimensions:

1. relevanceToGaming (0-100): Is this content about VIDEO GAMES?
   - 0-20: Not gaming (adult content, cooking, programming tutorials, general tech)
   - 21-50: Tangentially related (tech hardware, general entertainment)
   - 51-80: Gaming-adjacent (gaming hardware, esports, gaming culture)
   - 81-100: Directly about video games (guides, wikis, reviews, game news)

2. relevanceToArticle (0-100): Is this useful for the SPECIFIC article topic?
   - 0-20: Unrelated to article topic
   - 21-50: Same game/genre but different topic
   - 51-80: Related topic, might be useful
   - 81-100: Directly relevant to what we're writing about

EXAMPLES:
- Python documentation → relevanceToGaming: 0, relevanceToArticle: 0
- Elden Ring guide (for Elden Ring article) → relevanceToGaming: 100, relevanceToArticle: 100
- Elden Ring boss guide (for beginner guide article) → relevanceToGaming: 100, relevanceToArticle: 70
- Dark Souls guide (for Elden Ring article) → relevanceToGaming: 100, relevanceToArticle: 30
- Gaming keyboard review (for Elden Ring article) → relevanceToGaming: 60, relevanceToArticle: 10
- Adult content → relevanceToGaming: 0, relevanceToArticle: 0

Be STRICT. When in doubt, score lower. We'd rather skip questionable content.`;
}

/**
 * Get pre-filter user prompt.
 */
function getPreFilterUserPrompt(
  domain: string,
  title: string,
  snippet: string,
  gameName?: string,
  articleTopic?: string
): string {
  const articleContext = articleTopic
    ? `ARTICLE TOPIC: ${articleTopic}`
    : gameName
      ? `ARTICLE TOPIC: Article about the video game "${gameName}"`
      : 'ARTICLE TOPIC: General gaming content';

  return `Score this web content for relevance.

${articleContext}

DOMAIN: ${domain}
PAGE TITLE: ${title}
CONTENT SNIPPET:
${snippet}

NOTE: If snippet starts with navigation/breadcrumbs, look past them for actual article content.

Provide:
1. relevanceToGaming (0-100): Is this about video games?
2. relevanceToArticle (0-100): Is this useful for our specific article?
3. reason: Brief explanation
4. contentType: What type of content is this?`;
}

/**
 * Extended dependencies for pre-filter with article context.
 */
export interface PreFilterDeps extends CleanerDeps {
  /** Topic/title of the article being written (for relevanceToArticle scoring) */
  readonly articleTopic?: string;
  /** Minimum relevanceToGaming score to pass (default: 50) */
  readonly minGamingRelevance?: number;
  /** Minimum relevanceToArticle score to pass (default: 30) */
  readonly minArticleRelevance?: number;
}

/**
 * Pre-filter a single source using a cheap LLM call.
 * Uses only domain, title, and first 500 chars of content.
 * Returns two relevance scores for nuanced filtering.
 * 
 * @param source - Raw source to check
 * @param deps - Pre-filter dependencies
 * @returns Pre-filter result with relevance scores
 */
export async function preFilterSingleSource(
  source: RawSourceInput,
  deps: PreFilterDeps
): Promise<PreFilterSingleResult> {
  const log = deps.logger ?? createPrefixedLogger('[PreFilter]');
  const domain = extractDomain(source.url);
  // Use Tavily's clean snippet if available (already ~800c extracted content)
  // Otherwise fall back to slicing the full content
  const snippet = source.snippet ?? source.content.slice(0, CLEANER_CONFIG.PREFILTER_SNIPPET_LENGTH);

  try {
    const result = await withRetry(
      async () => {
        // Short timeout for pre-filter (it's a simple check)
        const timeoutSignal = AbortSignal.timeout(CLEANER_CONFIG.PREFILTER_TIMEOUT_MS);
        const signal = deps.signal
          ? AbortSignal.any([deps.signal, timeoutSignal])
          : timeoutSignal;

        return deps.generateObject({
          model: deps.model,
          schema: PreFilterOutputSchema,
          temperature: 0, // Deterministic for consistency
          abortSignal: signal,
          system: getPreFilterSystemPrompt(),
          prompt: getPreFilterUserPrompt(domain, source.title, snippet, deps.gameName, deps.articleTopic),
        });
      },
      {
        context: `PreFilter: ${source.url}`,
        maxRetries: 1, // Only 1 retry for pre-filter (speed > reliability)
        signal: deps.signal,
      }
    );

    const tokenUsage = createTokenUsageFromResult(result);
    const output = result.object as PreFilterOutput;

    return {
      url: source.url,
      domain,
      title: source.title,
      relevanceToGaming: output.relevanceToGaming,
      relevanceToArticle: output.relevanceToArticle,
      reason: output.reason,
      contentType: output.contentType,
      tokenUsage,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Pre-filter failed for ${source.url}: ${message}`);

    // On failure, assume relevant (don't filter out potentially good content)
    // Use neutral scores so it goes to full cleaning
    return {
      url: source.url,
      domain,
      title: source.title,
      relevanceToGaming: 50, // Neutral - let full cleaner decide
      relevanceToArticle: 50,
      reason: `Pre-filter failed: ${message.slice(0, 50)}`,
      contentType: 'unknown',
      tokenUsage: createEmptyTokenUsage(),
    };
  }
}

/**
 * Pre-filter multiple sources in parallel.
 * Separates relevant from irrelevant sources before full cleaning.
 * Logs full URLs of filtered sources for debugging.
 * 
 * @param sources - Raw sources to check
 * @param deps - Pre-filter dependencies  
 * @returns Relevant sources, filtered sources, and all results for DB storage
 */
export async function preFilterSourcesBatch(
  sources: readonly RawSourceInput[],
  deps: PreFilterDeps
): Promise<PreFilterBatchResult> {
  const log = deps.logger ?? createPrefixedLogger('[PreFilter]');

  if (sources.length === 0) {
    return { relevant: [], irrelevant: [], results: [], tokenUsage: createEmptyTokenUsage() };
  }

  log.info(`Pre-filtering ${sources.length} sources for relevance...`);

  // Run all pre-filters in parallel (they're cheap)
  const results = await Promise.all(
    sources.map((source) => preFilterSingleSource(source, deps))
  );

  // Use thresholds from deps or defaults
  const minGaming = deps.minGamingRelevance ?? CLEANER_CONFIG.PREFILTER_MIN_GAMING_RELEVANCE;
  const minArticle = deps.minArticleRelevance ?? CLEANER_CONFIG.PREFILTER_MIN_ARTICLE_RELEVANCE;

  const relevant: RawSourceInput[] = [];
  const irrelevant: Array<{
    source: RawSourceInput;
    relevanceToGaming: number;
    relevanceToArticle: number;
    reason: string;
  }> = [];
  let totalTokenUsage = createEmptyTokenUsage();

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const result = results[i];
    totalTokenUsage = addTokenUsage(totalTokenUsage, result.tokenUsage);

    // Pass if BOTH scores meet minimum thresholds
    const passesGaming = result.relevanceToGaming >= minGaming;
    const passesArticle = result.relevanceToArticle >= minArticle;

    if (passesGaming && passesArticle) {
      relevant.push(source);
    } else {
      irrelevant.push({
        source,
        relevanceToGaming: result.relevanceToGaming,
        relevanceToArticle: result.relevanceToArticle,
        reason: result.reason,
      });
    }
  }

  // Log results with FULL URLs
  const costStr = totalTokenUsage.actualCostUsd
    ? ` ($${totalTokenUsage.actualCostUsd.toFixed(4)})`
    : '';
  log.info(
    `Pre-filter: ${relevant.length} relevant, ${irrelevant.length} irrelevant${costStr}`
  );

  // Log each filtered source with FULL URL for debugging
  if (irrelevant.length > 0) {
    for (const { source, relevanceToGaming, relevanceToArticle, reason } of irrelevant) {
      log.info(
        `  ✗ FILTERED: ${source.url}\n` +
        `    Gaming: ${relevanceToGaming}/100, Article: ${relevanceToArticle}/100\n` +
        `    Reason: ${reason}`
      );
    }
  }

  return { relevant, irrelevant, results, tokenUsage: totalTokenUsage };
}

// ============================================================================
// Exports
// ============================================================================

export { 
  CleanerOutputSchema, 
  PreFilterOutputSchema,
  PureCleanerOutputSchema,
  EnhancedSummarySchema,
};
