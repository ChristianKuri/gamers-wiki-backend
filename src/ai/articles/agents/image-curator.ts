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
import { getImagesForSection, getImagesByPriority, getPoolSummary } from '../image-pool';
import { IMAGE_CURATOR_CONFIG, IMAGE_DIMENSION_CONFIG } from '../config';
import { createTokenUsageFromResult } from '../types';
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
 * Schema for section selections with ranked candidates.
 */
const SectionSelectionSchema = z.object({
  sectionHeadline: z.string().describe('The section headline this selection is for'),
  candidates: z.array(SectionCandidateSchema).max(IMAGE_DIMENSION_CONFIG.MAX_SECTION_CANDIDATES)
    .describe(`Up to ${IMAGE_DIMENSION_CONFIG.MAX_SECTION_CANDIDATES} ranked candidates in order of preference (best first)`),
});

/**
 * Full response schema for ranked candidate selection.
 */
const ImageCuratorResponseSchema = z.object({
  heroCandidates: z.array(HeroCandidateSchema).max(IMAGE_DIMENSION_CONFIG.MAX_HERO_CANDIDATES)
    .describe(`Up to ${IMAGE_DIMENSION_CONFIG.MAX_HERO_CANDIDATES} ranked hero image candidates in order of preference (best first)`),
  sectionSelections: z.array(SectionSelectionSchema)
    .describe('Image selections for each section'),
});

type ImageCuratorResponse = z.infer<typeof ImageCuratorResponseSchema>;
type HeroCandidate = z.infer<typeof HeroCandidateSchema>;
type SectionCandidate = z.infer<typeof SectionCandidateSchema>;
type SectionSelection = z.infer<typeof SectionSelectionSchema>;

// ============================================================================
// Prompts
// ============================================================================

function buildImageCuratorSystemPrompt(): string {
  return `You are an expert image curator for a gaming wiki. Your job is to select the best images for article sections and generate SEO-optimized alt text.

## Ranked Selection System

You must provide RANKED candidates for each selection, not single choices. This allows fallback to the next-best option if the top pick is unavailable or too small.

**For hero image**: Provide up to 10 candidates ranked by preference (best first).
**For each section**: Provide up to 3 candidates ranked by preference (best first).

The system will use your top-ranked candidate if it meets dimension requirements, otherwise try the next candidate.

## Image Selection Criteria

1. **Relevance**: Image must directly relate to content
   - For boss guides: show the boss, the arena, or the attack patterns
   - For location guides: show the location, map, or key landmarks
   - For item guides: show the item, where to find it, or how it's used

2. **Quality**: Prefer high-quality screenshots and artwork
   - Official images (from IGDB) are highest quality
   - Avoid UI overlays, watermarks, or cluttered screenshots
   - Prefer images that are well-composed and clear

3. **Variety**: Don't pick similar images for different sections
   - Each section should have a distinct visual

4. **Coverage**: You MUST select candidates for EVERY section
   - Provide at least 1 candidate per section, ideally 3
   - If candidates are limited, include what's available

## Alt Text Guidelines

Write SEO-friendly alt text that:
- Is 80-120 characters long
- Includes the game name naturally
- Describes what's shown in the image
- Is useful for accessibility (screen readers)
- Avoids "image of" or "screenshot of" prefixes

Examples:
- "Malenia, Blade of Miquella preparing her Waterfowl Dance attack in Elden Ring"
- "Map showing all Tears of the Kingdom Shrine locations in Hyrule"
- "The Master Sword pedestal in Korok Forest from Zelda TOTK"

## Response Format

**heroCandidates**: Array of up to 10 hero image candidates, ranked best first
- imageIndex: Index from hero pool
- altText: SEO-optimized alt text
- relevanceScore: 0-100

**sectionSelections**: Array with one entry per section
- sectionHeadline: Section name
- candidates: Array of up to 3 candidates, ranked best first
  - imageIndex: Index from section candidates
  - altText: SEO-optimized alt text
  - caption: Optional descriptive caption
  - relevanceScore: 0-100

IMPORTANT: Every section MUST have at least one candidate.`;
}

// Note: extractFilenameFromUrl and normalizeImageUrlForDedupe are imported from '../utils/url-utils'

function buildImageCuratorUserPrompt(
  context: ImageCuratorContext,
  candidatesPerSection: Map<string, readonly CollectedImage[]>,
  heroCandidatePool: readonly CollectedImage[]
): string {
  const lines: string[] = [
    `# Image Curation for: ${context.articleTitle}`,
    `Game: ${context.gameName}`,
    '',
  ];

  // Add hero candidate pool first
  lines.push('## Hero Image Candidates');
  lines.push('Select up to 10 candidates ranked by preference for the featured/hero image.');
  lines.push('');
  
  if (heroCandidatePool.length === 0) {
    lines.push('No hero image candidates available.');
  } else {
    heroCandidatePool.forEach((img, idx) => {
      const urlFilename = extractFilenameFromUrl(img.url);
      lines.push(`${idx}. ${img.source.toUpperCase()}${img.isOfficial ? ' (Official)' : ''} [${urlFilename}]`);
      if (img.description) {
        lines.push(`   Description: ${img.description}`);
      }
      if (img.igdbType) {
        lines.push(`   Type: ${img.igdbType}`);
      }
    });
  }
  lines.push('');
  
  // Add section info with their candidate images
  lines.push('## Article Sections');
  lines.push('For each section, select up to 3 candidates ranked by preference.');
  lines.push('');

  // Note: candidatesPerSection is keyed by normalized headlines for reliable matching
  for (const section of context.plan.sections) {
    const normalizedKey = normalizeHeadline(section.headline);
    const candidates = candidatesPerSection.get(normalizedKey) ?? [];
    
    lines.push(`### ${section.headline}`);
    lines.push(`Goal: ${section.goal}`);
    lines.push('');
    
    if (candidates.length === 0) {
      lines.push('No candidate images available.');
    } else {
      lines.push('Candidate images:');
      candidates.forEach((img, idx) => {
        // Extract filename from URL for identification (helps distinguish IGDB screenshots)
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
    lines.push('');
  }
  
  lines.push('**IMPORTANT**: Images selected as hero candidates should NOT be selected for sections. Try to use different images for each selection.');

  return lines.join('\n');
}

// ============================================================================
// Helper Functions
// ============================================================================

// Note: normalizeHeadline, findMatchingHeadline, and buildH2LineMap are imported from '../utils/headline-utils'

// ============================================================================
// Main Function
// ============================================================================

/**
 * Runs the Image Curator agent to select ranked image candidates.
 *
 * This function returns RANKED CANDIDATES, not final selections.
 * The caller (image-phase.ts) should process these candidates through
 * dimension validation to select the first valid image for each slot.
 *
 * @param context - Context with article content, plan, and image pool
 * @param deps - Dependencies (model, generateObject, logger)
 * @returns Ranked candidates for hero and sections (need post-processing)
 */
export async function runImageCurator(
  context: ImageCuratorContext,
  deps: ImageCuratorDeps
): Promise<ImageCuratorOutput> {
  const { model, generateObject: genObject, logger: log, signal } = deps;
  const poolSummary = getPoolSummary(context.imagePool);

  log?.info(`[ImageCurator] Starting curation for "${context.articleTitle}"`);
  log?.info(`[ImageCurator] Pool: ${poolSummary.total} images (${poolSummary.igdb} IGDB, ${poolSummary.tavily} Tavily, ${poolSummary.exa} Exa)`);

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

  // Get hero candidate pool - all images sorted by priority
  // We show the curator all images and let it pick the best 10
  const heroCandidatePool = getImagesByPriority(context.imagePool);
  log?.debug(`[ImageCurator] Hero candidate pool: ${heroCandidatePool.length} images`);

  // Get candidates for each section (use normalized headlines as keys for reliable lookup)
  const candidatesPerSection = new Map<string, readonly CollectedImage[]>();
  
  for (const section of context.plan.sections) {
    const candidates = getImagesForSection(
      context.imagePool,
      section.headline,
      IMAGE_CURATOR_CONFIG.MAX_CANDIDATES_PER_SECTION
    );
    const normalizedKey = normalizeHeadline(section.headline);
    candidatesPerSection.set(normalizedKey, candidates);
  }

  // Build prompts
  const systemPrompt = buildImageCuratorSystemPrompt();
  const userPrompt = buildImageCuratorUserPrompt(context, candidatesPerSection, heroCandidatePool);

  // Call LLM to select ranked candidates
  log?.debug('[ImageCurator] Calling LLM for ranked image selection...');
  
  const result = await genObject({
    model,
    schema: ImageCuratorResponseSchema,
    system: systemPrompt,
    prompt: userPrompt,
    temperature: IMAGE_CURATOR_CONFIG.TEMPERATURE,
    abortSignal: signal,
  });

  const response = result.object;
  const tokenUsage = createTokenUsageFromResult(result);

  log?.debug(`[ImageCurator] LLM response: ${response.heroCandidates.length} hero candidates, ${response.sectionSelections.length} sections`);

  // Build hero candidate outputs with resolved images
  const heroCandidates: HeroCandidateOutput[] = [];
  for (const candidate of response.heroCandidates) {
    if (candidate.imageIndex < 0 || candidate.imageIndex >= heroCandidatePool.length) {
      log?.warn(`[ImageCurator] Invalid hero candidate index: ${candidate.imageIndex}`);
      continue;
    }
    heroCandidates.push({
      imageIndex: candidate.imageIndex,
      image: heroCandidatePool[candidate.imageIndex],
      altText: candidate.altText,
      relevanceScore: candidate.relevanceScore,
    });
  }

  // Build section selection outputs with resolved images
  const sectionSelections: SectionSelectionOutput[] = [];

  for (const selection of response.sectionSelections) {
    const normalizedSelectionHeadline = normalizeHeadline(selection.sectionHeadline);
    const sectionCandidates = candidatesPerSection.get(normalizedSelectionHeadline) ?? [];
    
    // Find section index in plan
    const sectionIndex = context.plan.sections.findIndex(
      s => normalizeHeadline(s.headline) === normalizedSelectionHeadline
    );

    if (sectionIndex < 0) {
      log?.warn(`[ImageCurator] Section not found in plan: "${selection.sectionHeadline}"`);
      continue;
    }

    // Build candidate outputs for this section
    const candidates: SectionCandidateOutput[] = [];
    for (const candidate of selection.candidates) {
      if (candidate.imageIndex < 0 || candidate.imageIndex >= sectionCandidates.length) {
        log?.warn(`[ImageCurator] Invalid section candidate index: ${candidate.imageIndex} for "${selection.sectionHeadline}"`);
        continue;
      }
      candidates.push({
        imageIndex: candidate.imageIndex,
        image: sectionCandidates[candidate.imageIndex],
        altText: candidate.altText,
        caption: candidate.caption,
        relevanceScore: candidate.relevanceScore,
      });
    }

    if (candidates.length > 0) {
      sectionSelections.push({
        sectionHeadline: selection.sectionHeadline,
        sectionIndex,
        candidates,
      });
    }
  }

  log?.info(`[ImageCurator] Returning ${heroCandidates.length} hero candidates, ${sectionSelections.length} section selections`);

  return {
    heroCandidates,
    sectionSelections,
    tokenUsage,
    poolSummary,
    candidatesPerSection,
    heroCandidatePool,
  };
}
