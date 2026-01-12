/**
 * Image Curator Agent
 *
 * Selects and places images in the final article.
 * Runs AFTER Reviewer/Fixer/Validation phase to see the final article content.
 *
 * Responsibilities:
 * 1. Select best image for each section from ImagePool
 * 2. Generate SEO-optimized alt text for each image
 * 3. Determine optimal insertion points in markdown
 * 4. Return image assignments for the uploader
 */

import { generateObject } from 'ai';
import { z } from 'zod';

import type { LanguageModel } from 'ai';
import type { Logger } from '../../../utils/logger';
import type { ArticlePlan } from '../article-plan';
import type { TokenUsage } from '../types';
import type { CollectedImage, ImagePool } from '../image-pool';
import { getImagesForSection, getPoolSummary } from '../image-pool';
import { IMAGE_CURATOR_CONFIG, IMAGE_DIMENSION_CONFIG } from '../config';
import { createTokenUsageFromResult, addTokenUsage } from '../types';
import { normalizeHeadline, findMatchingHeadline, buildH2LineMap } from '../utils/headline-utils';
import { extractFilenameFromUrl, normalizeImageUrlForDedupe } from '../utils/url-utils';

// ============================================================================
// Types
// ============================================================================

/**
 * A single hero image candidate from the curator.
 */
export interface HeroCandidateOutput {
  /** Index of the image in the hero candidate pool */
  readonly imageIndex: number;
  /** The actual image from the pool */
  readonly image: CollectedImage;
  /** SEO-optimized alt text */
  readonly altText: string;
  /** Relevance score from curator */
  readonly relevanceScore: number;
}

/**
 * A single section image candidate from the curator.
 */
export interface SectionCandidateOutput {
  /** Index of the image in the section candidate pool */
  readonly imageIndex: number;
  /** The actual image from the pool */
  readonly image: CollectedImage;
  /** SEO-optimized alt text */
  readonly altText: string;
  /** Optional caption */
  readonly caption?: string;
  /** Relevance score from curator */
  readonly relevanceScore: number;
}

/**
 * Section selection with ranked candidates.
 */
export interface SectionSelectionOutput {
  /** Section headline */
  readonly sectionHeadline: string;
  /** Section index in the plan */
  readonly sectionIndex: number;
  /** Ranked candidates (best first) */
  readonly candidates: readonly SectionCandidateOutput[];
}

/**
 * Final image assignment for a section (after dimension validation).
 * Used by image-phase after processing candidates.
 */
export interface SectionImageAssignment {
  /** Section headline this image belongs to */
  readonly sectionHeadline: string;
  /** Section index (0-based) */
  readonly sectionIndex: number;
  /** Selected image from the pool */
  readonly image: CollectedImage;
  /** SEO-optimized alt text */
  readonly altText: string;
  /** Optional descriptive caption (NOT attribution - that is stored in provider_metadata) */
  readonly caption?: string;
}

/**
 * Final hero image assignment (after dimension validation).
 */
export interface HeroImageAssignment {
  /** Selected image for hero */
  readonly image: CollectedImage;
  /** SEO-optimized alt text */
  readonly altText: string;
}

/**
 * Output from the Image Curator agent.
 * Contains ranked candidates that need post-processing for dimension validation.
 */
export interface ImageCuratorOutput {
  /** Ranked hero image candidates (up to 10, best first) */
  readonly heroCandidates: readonly HeroCandidateOutput[];
  /** Section selections with ranked candidates */
  readonly sectionSelections: readonly SectionSelectionOutput[];
  /** Token usage for curation */
  readonly tokenUsage: TokenUsage;
  /** Summary of image pool for debugging */
  readonly poolSummary: {
    readonly total: number;
    readonly igdb: number;
    readonly tavily: number;
    readonly exa: number;
    readonly source: number;
    readonly artworks: number;
    readonly screenshots: number;
  };
  /** Candidate images per section (for dimension validation lookup) */
  readonly candidatesPerSection: ReadonlyMap<string, readonly CollectedImage[]>;
  /** Hero candidate pool (for dimension validation lookup) */
  readonly heroCandidatePool: readonly CollectedImage[];
}

/**
 * Context for image curation.
 */
export interface ImageCuratorContext {
  /** Final article markdown (after review/fixes) */
  readonly markdown: string;
  /** Article plan with section structure */
  readonly plan: ArticlePlan;
  /** Collected images from all sources */
  readonly imagePool: ImagePool;
  /** Game name for context */
  readonly gameName: string;
  /** Article title for hero image alt text */
  readonly articleTitle: string;
}

/**
 * Dependencies for the Image Curator agent.
 */
export interface ImageCuratorDeps {
  readonly model: LanguageModel;
  readonly generateObject: typeof generateObject;
  readonly logger?: Logger;
  readonly signal?: AbortSignal;
}

// ============================================================================
// Zod Schemas for LLM Output
// ============================================================================

/**
 * Schema for a single hero image candidate (ranked selection).
 */
const HeroCandidateSchema = z.object({
  imageIndex: z.number().describe('Index of candidate image from hero pool (0-based)'),
  altText: z.string().max(150).describe('SEO-optimized alt text (80-120 chars, include game name and context)'),
  relevanceScore: z.number().min(0).max(100).describe('How relevant is this image for the article hero (0-100)'),
});

/**
 * Schema for a single section image candidate (ranked selection).
 */
const SectionCandidateSchema = z.object({
  imageIndex: z.number().describe('Index of candidate from section pool (0-based)'),
  altText: z.string().max(150).describe('SEO-optimized alt text'),
  caption: z.string().optional().describe('Brief descriptive caption (NOT attribution)'),
  relevanceScore: z.number().min(0).max(100).describe('How relevant is this image to the section (0-100)'),
});

/**
 * Schema for per-section relevance scoring response.
 * Used for text-based evaluation of candidates.
 */
const SectionRelevanceResponseSchema = z.object({
  rankedCandidates: z.array(SectionCandidateSchema).max(IMAGE_CURATOR_CONFIG.TEXT_TOP_RESULTS)
    .describe(`Up to ${IMAGE_CURATOR_CONFIG.TEXT_TOP_RESULTS} ranked candidates in order of relevance (best first)`),
});

/**
 * Schema for hero image selection response.
 */
const HeroSelectionResponseSchema = z.object({
  heroCandidates: z.array(HeroCandidateSchema).max(IMAGE_DIMENSION_CONFIG.MAX_HERO_CANDIDATES)
    .describe(`Up to ${IMAGE_DIMENSION_CONFIG.MAX_HERO_CANDIDATES} ranked hero image candidates in order of preference (best first)`),
});

type SectionRelevanceResponse = z.infer<typeof SectionRelevanceResponseSchema>;
type HeroSelectionResponse = z.infer<typeof HeroSelectionResponseSchema>;
type HeroCandidate = z.infer<typeof HeroCandidateSchema>;
type SectionCandidate = z.infer<typeof SectionCandidateSchema>;

// ============================================================================
// Prompts
// ============================================================================

/**
 * System prompt for hero image selection.
 */
function buildHeroSystemPrompt(): string {
  return `You are an expert image curator for a gaming wiki. Select the best hero/featured images for the article.

## Selection Criteria

1. **Relevance**: Image should represent the overall article topic
2. **Quality**: Prefer high-quality screenshots and artwork
   - Official images (from IGDB) are highest quality
   - Avoid UI overlays, watermarks, or cluttered screenshots
3. **Visual Impact**: Hero images should be visually striking

## Alt Text Guidelines

Write SEO-friendly alt text that:
- Is 80-120 characters long
- Includes the game name naturally
- Describes what's shown in the image
- Avoids "image of" or "screenshot of" prefixes

## Response Format

Provide up to 10 candidates ranked by preference (best first):
- imageIndex: Index from the candidate pool (0-based)
- altText: SEO-optimized alt text
- relevanceScore: 0-100 (how relevant is this for the article hero)`;
}

/**
 * System prompt for per-section text-based relevance scoring.
 */
function buildSectionSystemPrompt(): string {
  return `You are an expert image curator for a gaming wiki. Evaluate image candidates for a specific article section.

## IMPORTANT: Text-Based Evaluation Only

You are evaluating images based ONLY on their text metadata (description, source, context).
Do NOT consider visual quality - that will be checked separately.

## Selection Criteria

1. **Relevance**: How well does the description/context match the section topic?
   - Direct match (e.g., "boss fight" for a boss guide section) = high score
   - Tangential match = medium score
   - Unrelated = low score

2. **Source Quality**: Use as tiebreaker for similar relevance
   - IGDB (Official) images are typically higher quality
   - Source articles with headers matching the section are good
   - Generic web images are lower confidence

3. **Context Clues**: Consider the source query and nearest header
   - If sourceQuery matches section goal, higher relevance
   - If nearestHeader matches section headline, higher relevance

## Alt Text Guidelines

Write SEO-friendly alt text that:
- Is 80-120 characters long
- Includes the game name naturally
- Describes what the image likely shows (based on metadata)
- Avoids "image of" or "screenshot of" prefixes

## Response Format

Return up to ${IMAGE_CURATOR_CONFIG.TEXT_TOP_RESULTS} candidates ranked by relevance (best first):
- imageIndex: Index from the candidate pool (0-based)
- altText: SEO-optimized alt text
- caption: Optional brief descriptive caption
- relevanceScore: 0-100 (based on text metadata relevance)`;
}

// Note: extractFilenameFromUrl and normalizeImageUrlForDedupe are imported from '../utils/url-utils'

/**
 * Builds the user prompt for hero image selection.
 */
function buildHeroUserPrompt(
  articleTitle: string,
  gameName: string,
  candidates: readonly CollectedImage[]
): string {
  const lines: string[] = [
    `# Hero Image Selection for: ${articleTitle}`,
    `Game: ${gameName}`,
    '',
    `Select up to ${IMAGE_DIMENSION_CONFIG.MAX_HERO_CANDIDATES} candidates ranked by preference.`,
    '',
    '## Candidate Images',
    '',
  ];

  if (candidates.length === 0) {
    lines.push('No hero image candidates available.');
  } else {
    candidates.forEach((img, idx) => {
      const urlFilename = extractFilenameFromUrl(img.url);
      lines.push(`${idx}. ${img.source.toUpperCase()}${img.isOfficial ? ' (Official)' : ''} [${urlFilename}]`);
      if (img.description) {
        lines.push(`   Description: ${img.description}`);
      }
      if (img.igdbType) {
        lines.push(`   Type: ${img.igdbType}`);
      }
      // Context from source extraction (nearestHeader or surrounding paragraph)
      if (img.sourceQuery) {
        lines.push(`   Context: "${img.sourceQuery}"`);
      }
      if (img.sourceDomain) {
        lines.push(`   Source: ${img.sourceDomain}`);
      }
    });
  }

  return lines.join('\n');
}

/**
 * Builds the user prompt for per-section text-based relevance scoring.
 */
function buildSectionUserPrompt(
  gameName: string,
  sectionHeadline: string,
  sectionGoal: string,
  candidates: readonly CollectedImage[]
): string {
  const lines: string[] = [
    `# Section: ${sectionHeadline}`,
    `Game: ${gameName}`,
    `Goal: ${sectionGoal}`,
    '',
    `Evaluate these ${candidates.length} candidates and return the top ${IMAGE_CURATOR_CONFIG.TEXT_TOP_RESULTS} most relevant.`,
    '',
    '## Candidate Images (evaluate by metadata only)',
    '',
  ];

  if (candidates.length === 0) {
    lines.push('No candidate images available.');
  } else {
    candidates.forEach((img, idx) => {
      const urlFilename = extractFilenameFromUrl(img.url);
      lines.push(`${idx}. ${img.source.toUpperCase()}${img.isOfficial ? ' (Official)' : ''} [${urlFilename}]`);
      if (img.description) {
        lines.push(`   Description: ${img.description}`);
      }
      if (img.igdbType) {
        lines.push(`   Type: ${img.igdbType}`);
      }
      if (img.sourceQuery) {
        lines.push(`   Found via: "${img.sourceQuery}"`);
      }
      if (img.sourceDomain) {
        lines.push(`   Source: ${img.sourceDomain}`);
      }
    });
  }

  return lines.join('\n');
}

// ============================================================================
// Helper Functions
// ============================================================================

// Note: normalizeHeadline, findMatchingHeadline, and buildH2LineMap are imported from '../utils/headline-utils'

// ============================================================================
// Per-Section LLM Functions
// ============================================================================

/**
 * Runs hero image selection with LLM.
 */
async function runHeroSelection(
  candidates: readonly CollectedImage[],
  articleTitle: string,
  gameName: string,
  deps: ImageCuratorDeps
): Promise<{ heroCandidates: HeroCandidateOutput[]; tokenUsage: TokenUsage }> {
  const { model, generateObject: genObject, logger: log, signal } = deps;

  if (candidates.length === 0) {
    return { heroCandidates: [], tokenUsage: { input: 0, output: 0 } };
  }

  log?.debug(`[ImageCurator] Running hero selection with ${candidates.length} candidates`);

  const result = await genObject({
    model,
    schema: HeroSelectionResponseSchema,
    system: buildHeroSystemPrompt(),
    prompt: buildHeroUserPrompt(articleTitle, gameName, candidates),
    temperature: IMAGE_CURATOR_CONFIG.TEMPERATURE,
    abortSignal: signal,
  });

  const heroCandidates: HeroCandidateOutput[] = [];
  for (const candidate of result.object.heroCandidates) {
    if (candidate.imageIndex < 0 || candidate.imageIndex >= candidates.length) {
      log?.warn(`[ImageCurator] Invalid hero candidate index: ${candidate.imageIndex}`);
      continue;
    }
    heroCandidates.push({
      imageIndex: candidate.imageIndex,
      image: candidates[candidate.imageIndex],
      altText: candidate.altText,
      relevanceScore: candidate.relevanceScore,
    });
  }

  return {
    heroCandidates,
    tokenUsage: createTokenUsageFromResult(result),
  };
}

/**
 * Runs text-based relevance scoring for a single section.
 */
async function runSectionRelevanceScoring(
  sectionHeadline: string,
  sectionGoal: string,
  sectionIndex: number,
  candidates: readonly CollectedImage[],
  gameName: string,
  deps: ImageCuratorDeps
): Promise<{ selection: SectionSelectionOutput | null; tokenUsage: TokenUsage }> {
  const { model, generateObject: genObject, logger: log, signal } = deps;

  if (candidates.length === 0) {
    log?.debug(`[ImageCurator] Section "${sectionHeadline}": no candidates, skipping`);
    return { selection: null, tokenUsage: { input: 0, output: 0 } };
  }

  log?.debug(`[ImageCurator] Section "${sectionHeadline}": evaluating ${candidates.length} candidates`);

  const result = await genObject({
    model,
    schema: SectionRelevanceResponseSchema,
    system: buildSectionSystemPrompt(),
    prompt: buildSectionUserPrompt(gameName, sectionHeadline, sectionGoal, candidates),
    temperature: IMAGE_CURATOR_CONFIG.TEMPERATURE,
    abortSignal: signal,
  });

  const sectionCandidates: SectionCandidateOutput[] = [];
  for (const candidate of result.object.rankedCandidates) {
    if (candidate.imageIndex < 0 || candidate.imageIndex >= candidates.length) {
      log?.warn(`[ImageCurator] Invalid section candidate index: ${candidate.imageIndex} for "${sectionHeadline}"`);
      continue;
    }
    sectionCandidates.push({
      imageIndex: candidate.imageIndex,
      image: candidates[candidate.imageIndex],
      altText: candidate.altText,
      caption: candidate.caption,
      relevanceScore: candidate.relevanceScore,
    });
  }

  if (sectionCandidates.length === 0) {
    return { selection: null, tokenUsage: createTokenUsageFromResult(result) };
  }

  return {
    selection: {
      sectionHeadline,
      sectionIndex,
      candidates: sectionCandidates,
    },
    tokenUsage: createTokenUsageFromResult(result),
  };
}

/**
 * Runs text-based relevance scoring for all sections with concurrency control.
 */
async function runAllSectionRelevanceScoring(
  context: ImageCuratorContext,
  candidatesPerSection: Map<string, readonly CollectedImage[]>,
  deps: ImageCuratorDeps
): Promise<{ selections: SectionSelectionOutput[]; tokenUsage: TokenUsage }> {
  const { logger: log, signal } = deps;
  const concurrency = IMAGE_CURATOR_CONFIG.SECTION_CURATOR_CONCURRENCY;
  
  log?.info(`[ImageCurator] Processing ${context.plan.sections.length} sections with concurrency ${concurrency}`);

  const selections: SectionSelectionOutput[] = [];
  let totalTokenUsage: TokenUsage = { input: 0, output: 0 };

  // Process sections in batches for concurrency control
  for (let i = 0; i < context.plan.sections.length; i += concurrency) {
    // Check for cancellation
    if (signal?.aborted) {
      log?.debug('[ImageCurator] Processing cancelled');
      break;
    }

    const batch = context.plan.sections.slice(i, i + concurrency);
    const batchNum = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(context.plan.sections.length / concurrency);
    
    log?.debug(`[ImageCurator] Processing batch ${batchNum}/${totalBatches} (${batch.length} sections)`);

    // Process batch in parallel with error resilience
    const batchResults = await Promise.allSettled(
      batch.map((section, batchIdx) => {
        const sectionIndex = i + batchIdx;
        const normalizedKey = normalizeHeadline(section.headline);
        const candidates = candidatesPerSection.get(normalizedKey) ?? [];
        
        return runSectionRelevanceScoring(
          section.headline,
          section.goal,
          sectionIndex,
          candidates,
          context.gameName,
          deps
        );
      })
    );

    // Collect results, handling individual failures gracefully
    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const sectionHeadline = batch[j].headline;
      
      if (result.status === 'fulfilled') {
        totalTokenUsage = addTokenUsage(totalTokenUsage, result.value.tokenUsage);
        if (result.value.selection) {
          selections.push(result.value.selection);
        }
      } else {
        // Log error but continue with other sections
        const errorMsg = result.reason instanceof Error 
          ? result.reason.message 
          : String(result.reason);
        log?.warn(
          `[ImageCurator] Section "${sectionHeadline}" scoring failed: ${errorMsg}`
        );
      }
    }
  }

  return { selections, tokenUsage: totalTokenUsage };
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Runs the Image Curator agent to select ranked image candidates.
 *
 * Uses per-section LLM calls for text-based relevance scoring:
 * 1. Hero selection: Separate LLM call for hero image candidates
 * 2. Section selection: Per-section LLM calls with concurrency control
 *
 * This approach:
 * - Evaluates 30 candidates per section (vs 5 before)
 * - Uses text metadata only (cheap, no image tokens)
 * - Avoids huge prompts by processing sections individually
 * - Enables concurrency for faster processing
 *
 * @param context - Context with article content, plan, and image pool
 * @param deps - Dependencies (model, generateObject, logger)
 * @returns Ranked candidates for hero and sections (need post-processing)
 */
export async function runImageCurator(
  context: ImageCuratorContext,
  deps: ImageCuratorDeps
): Promise<ImageCuratorOutput> {
  const { logger: log, signal } = deps;
  const poolSummary = getPoolSummary(context.imagePool);

  // Early abort check before any work
  if (signal?.aborted) {
    log?.debug('[ImageCurator] Aborted before starting');
    return {
      heroCandidates: [],
      sectionSelections: [],
      tokenUsage: { input: 0, output: 0 },
      poolSummary,
      candidatesPerSection: new Map(),
      heroCandidatePool: [],
    };
  }

  log?.info(`[ImageCurator] Starting curation for "${context.articleTitle}"`);
  log?.info(`[ImageCurator] Pool: ${poolSummary.total} images (${poolSummary.igdb} IGDB, ${poolSummary.tavily} Tavily, ${poolSummary.exa} Exa, ${poolSummary.source} source)`);

  // Handle empty pool
  if (context.imagePool.count === 0) {
    log?.warn('[ImageCurator] No images in pool, skipping curation');
    return {
      heroCandidates: [],
      sectionSelections: [],
      tokenUsage: { input: 0, output: 0 },
      poolSummary,
      candidatesPerSection: new Map(),
      heroCandidatePool: [],
    };
  }

  // Get hero candidate pool - all images in collection order (no sourceQuality bias)
  // The LLM decides relevance based on description/context, not presentation order
  const heroCandidatePool = context.imagePool.images;
  log?.debug(`[ImageCurator] Hero candidate pool: ${heroCandidatePool.length} images`);

  // Get candidates for each section (30 per section for text-based evaluation)
  const candidatesPerSection = new Map<string, readonly CollectedImage[]>();
  for (const section of context.plan.sections) {
    const candidates = getImagesForSection(
      context.imagePool,
      IMAGE_CURATOR_CONFIG.TEXT_CANDIDATES_PER_SECTION
    );
    const normalizedKey = normalizeHeadline(section.headline);
    candidatesPerSection.set(normalizedKey, candidates);
  }

  let totalTokenUsage: TokenUsage = { input: 0, output: 0 };

  // ===== STEP 1: Hero Selection =====
  log?.info('[ImageCurator] Running hero selection...');
  const heroResult = await runHeroSelection(
    heroCandidatePool,
    context.articleTitle,
    context.gameName,
    deps
  );
  totalTokenUsage = addTokenUsage(totalTokenUsage, heroResult.tokenUsage);

  // Check for cancellation after hero selection
  if (signal?.aborted) {
    log?.debug('[ImageCurator] Processing cancelled after hero selection');
    return {
      heroCandidates: heroResult.heroCandidates,
      sectionSelections: [],
      tokenUsage: totalTokenUsage,
      poolSummary,
      candidatesPerSection,
      heroCandidatePool,
    };
  }

  // ===== STEP 2: Per-Section Text-Based Relevance Scoring =====
  log?.info('[ImageCurator] Running per-section relevance scoring...');
  const sectionResult = await runAllSectionRelevanceScoring(
    context,
    candidatesPerSection,
    deps
  );
  totalTokenUsage = addTokenUsage(totalTokenUsage, sectionResult.tokenUsage);

  log?.info(
    `[ImageCurator] Returning ${heroResult.heroCandidates.length} hero candidates, ` +
    `${sectionResult.selections.length} section selections`
  );

  return {
    heroCandidates: heroResult.heroCandidates,
    sectionSelections: sectionResult.selections,
    tokenUsage: totalTokenUsage,
    poolSummary,
    candidatesPerSection,
    heroCandidatePool,
  };
}
