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
import { getImagesForSection, getBestHeroImage, getPoolSummary } from '../image-pool';
import { IMAGE_CURATOR_CONFIG } from '../config';
import { createTokenUsageFromResult } from '../types';
import { normalizeHeadline, findMatchingHeadline, buildH2LineMap } from '../utils/headline-utils';
import { extractFilenameFromUrl, normalizeImageUrlForDedupe } from '../utils/url-utils';

// ============================================================================
// Types
// ============================================================================

/**
 * Image assignment for a section.
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
 * Hero image assignment.
 */
export interface HeroImageAssignment {
  /** Selected image for hero */
  readonly image: CollectedImage;
  /** SEO-optimized alt text */
  readonly altText: string;
}

/**
 * Output from the Image Curator agent.
 */
export interface ImageCuratorOutput {
  /** Hero image assignment (if found) */
  readonly heroImage?: HeroImageAssignment;
  /** Section image assignments */
  readonly sectionImages: readonly SectionImageAssignment[];
  /** Token usage for curation */
  readonly tokenUsage: TokenUsage;
  /** Summary of image pool for debugging */
  readonly poolSummary: {
    readonly total: number;
    readonly igdb: number;
    readonly tavily: number;
    readonly exa: number;
  };
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

const ImageSelectionSchema = z.object({
  sectionHeadline: z.string().describe('The section headline this image is for'),
  selectedImageIndex: z.number().describe('Index of selected image from candidates (0-based), or -1 if none suitable'),
  altText: z.string().max(150).describe('SEO-optimized alt text (80-120 chars, include game name and context)'),
  caption: z.string().optional().describe('Brief descriptive caption for the image (NOT attribution - that is handled separately)'),
  relevanceScore: z.number().min(0).max(100).describe('How relevant is this image to the section content (0-100)'),
  qualityScore: z.number().min(0).max(100).describe('Image quality assessment (0-100): not blurry, good composition'),
});

const ImageCuratorResponseSchema = z.object({
  heroImageAltText: z.string().max(150).describe('Alt text for hero image (include article title and game name)'),
  sectionSelections: z.array(ImageSelectionSchema).describe('Image selection for each section'),
});

type ImageCuratorResponse = z.infer<typeof ImageCuratorResponseSchema>;

// ============================================================================
// Prompts
// ============================================================================

function buildImageCuratorSystemPrompt(): string {
  return `You are an expert image curator for a gaming wiki. Your job is to select the best images for article sections and generate SEO-optimized alt text.

## Image Selection Criteria

1. **Relevance**: Image must directly relate to section content
   - For boss guides: show the boss, the arena, or the attack patterns
   - For location guides: show the location, map, or key landmarks
   - For item guides: show the item, where to find it, or how it's used

2. **Quality**: Prefer high-quality screenshots and artwork
   - Official images (from IGDB) are highest quality
   - Avoid UI overlays, watermarks, or cluttered screenshots
   - Prefer images that are well-composed and clear

3. **Variety**: Don't pick similar images for different sections
   - Each section should have a distinct visual

4. **Coverage**: You MUST select at least one image for EVERY section
   - If no perfect match exists, pick the best available option
   - Empty sections are not acceptable - readers expect visual content
   - Even a loosely related image is better than no image

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

For each section, provide:
1. selectedImageIndex: Which candidate image to use (-1 ONLY if absolutely no candidates exist)
2. altText: SEO-optimized description
3. relevanceScore: 0-100 (how well it matches section content)
4. qualityScore: 0-100 (image quality assessment)
5. caption: Brief descriptive caption (optional, NOT for attribution - attribution is handled separately)

IMPORTANT: Every section MUST have an image. Do not skip any section. If candidates are limited, pick the most relevant one available.`;
}

// Note: extractFilenameFromUrl and normalizeImageUrlForDedupe are imported from '../utils/url-utils'

function buildImageCuratorUserPrompt(
  context: ImageCuratorContext,
  candidatesPerSection: Map<string, readonly CollectedImage[]>
): string {
  const lines: string[] = [
    `# Image Curation for: ${context.articleTitle}`,
    `Game: ${context.gameName}`,
    '',
    '## Article Sections',
    '',
  ];

  // Add section info with their candidate images
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

  // Add hero image info - select based on article title relevance
  const heroImage = getBestHeroImage(context.imagePool, context.articleTitle);
  if (heroImage) {
    const heroFilename = extractFilenameFromUrl(heroImage.url);
    lines.push('## Hero Image');
    lines.push(`Source: ${heroImage.source.toUpperCase()}${heroImage.isOfficial ? ' (Official)' : ''} [${heroFilename}]`);
    if (heroImage.description) {
      lines.push(`Description: ${heroImage.description}`);
    }
    lines.push('');
    lines.push('Generate alt text for this hero image.');
    lines.push('');
    lines.push(`**IMPORTANT**: Do NOT select this same image [${heroFilename}] for any section. Each section must use a different image.`);
  }

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
 * Runs the Image Curator agent to select and place images in the article.
 *
 * @param context - Context with article content, plan, and image pool
 * @param deps - Dependencies (model, generateObject, logger)
 * @returns Image assignments for hero and sections
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
      sectionImages: [],
      tokenUsage: { input: 0, output: 0 },
      poolSummary,
    };
  }

  // Get best hero image
  const heroImage = getBestHeroImage(context.imagePool, context.articleTitle);

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
  const userPrompt = buildImageCuratorUserPrompt(context, candidatesPerSection);

  // Call LLM to select images and generate alt text
  log?.debug('[ImageCurator] Calling LLM for image selection...');
  
  const result = await genObject({
    model,
    schema: ImageCuratorResponseSchema,
    system: systemPrompt,
    prompt: userPrompt,
    temperature: IMAGE_CURATOR_CONFIG.TEMPERATURE,
    abortSignal: signal,
  });

  // result.object is already typed by generateObject via the Zod schema
  const response = result.object;
  const tokenUsage = createTokenUsageFromResult(result);

  log?.debug(`[ImageCurator] LLM response: ${response.sectionSelections.length} section selections`);

  // Parse markdown to find section line numbers (using shared utility)
  const sectionLines = buildH2LineMap(context.markdown);

  // Build section image assignments
  const sectionImages: SectionImageAssignment[] = [];

  for (const selection of response.sectionSelections) {
    // Skip if no image selected
    if (selection.selectedImageIndex < 0) {
      continue;
    }

    // Skip if scores below threshold
    if (selection.relevanceScore < IMAGE_CURATOR_CONFIG.MIN_RELEVANCE_SCORE) {
      log?.debug(`[ImageCurator] Skipping "${selection.sectionHeadline}" - low relevance (${selection.relevanceScore})`);
      continue;
    }
    if (selection.qualityScore < IMAGE_CURATOR_CONFIG.MIN_QUALITY_SCORE) {
      log?.debug(`[ImageCurator] Skipping "${selection.sectionHeadline}" - low quality (${selection.qualityScore})`);
      continue;
    }

    // Get the selected image using normalized headline for reliable lookup
    const normalizedSelectionHeadline = normalizeHeadline(selection.sectionHeadline);
    const candidates = candidatesPerSection.get(normalizedSelectionHeadline) ?? [];
    
    if (candidates.length === 0) {
      // Expected if image pool is sparse - use debug level
      log?.debug(`[ImageCurator] No candidates found for section "${selection.sectionHeadline}" (normalized: "${normalizedSelectionHeadline}")`);
      continue;
    }
    
    if (selection.selectedImageIndex >= candidates.length) {
      log?.warn(`[ImageCurator] Invalid image index ${selection.selectedImageIndex} for "${selection.sectionHeadline}" (${candidates.length} candidates)`);
      continue;
    }

    const selectedImage = candidates[selection.selectedImageIndex];

    // Find the section in markdown
    const matchedSection = findMatchingHeadline(selection.sectionHeadline, sectionLines, log);
    if (!matchedSection) {
      log?.warn(
        `[ImageCurator] Could not find section in markdown. ` +
        `original="${selection.sectionHeadline}", normalized="${normalizedSelectionHeadline}"`
      );
      continue;
    }

    // Find section index in plan - skip if not found (don't default to 0)
    const sectionIndex = context.plan.sections.findIndex(
      s => normalizeHeadline(s.headline) === normalizedSelectionHeadline
    );

    if (sectionIndex < 0) {
      const availableSections = context.plan.sections.map(s => s.headline).join(', ');
      log?.warn(
        `[ImageCurator] Section not found in plan, skipping. ` +
        `original="${selection.sectionHeadline}", normalized="${normalizedSelectionHeadline}". ` +
        `Available sections: [${availableSections}]`
      );
      continue;
    }

    sectionImages.push({
      sectionHeadline: matchedSection.headline,
      sectionIndex,
      image: selectedImage,
      altText: selection.altText,
      caption: selection.caption,
    });
  }

  // Deduplicate section images by normalized URL
  // IGDB images at different sizes (t_1080p, t_screenshot_big) are the same underlying image
  const seenNormalizedUrls = new Set<string>();
  if (heroImage) {
    seenNormalizedUrls.add(normalizeImageUrlForDedupe(heroImage.url));
  }
  
  const deduplicatedSectionImages = sectionImages.filter((img) => {
    const normalizedUrl = normalizeImageUrlForDedupe(img.image.url);
    if (seenNormalizedUrls.has(normalizedUrl)) {
      log?.debug(`[ImageCurator] Skipping duplicate image for "${img.sectionHeadline}" (already used)`);
      return false;
    }
    seenNormalizedUrls.add(normalizedUrl);
    return true;
  });

  if (deduplicatedSectionImages.length < sectionImages.length) {
    log?.info(`[ImageCurator] Removed ${sectionImages.length - deduplicatedSectionImages.length} duplicate image(s)`);
  }

  // Limit to max images per article (excluding hero)
  const maxSectionImages = IMAGE_CURATOR_CONFIG.MAX_IMAGES_PER_ARTICLE - (heroImage ? 1 : 0);
  const limitedSectionImages = deduplicatedSectionImages.slice(0, maxSectionImages);

  log?.info(`[ImageCurator] Selected ${limitedSectionImages.length} section images`);

  // Build hero image assignment
  let heroImageAssignment: HeroImageAssignment | undefined;
  if (heroImage) {
    heroImageAssignment = {
      image: heroImage,
      altText: response.heroImageAltText || `${context.articleTitle} - ${context.gameName}`,
    };
    log?.info(`[ImageCurator] Hero image selected from ${heroImage.source}`);
  }

  return {
    heroImage: heroImageAssignment,
    sectionImages: limitedSectionImages,
    tokenUsage,
    poolSummary,
  };
}
