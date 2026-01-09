/**
 * Image Phase Orchestrator
 *
 * Orchestrates the complete image pipeline:
 * 1. Collect images from ImagePool (IGDB + search results)
 * 2. Run Image Curator to select and place images
 * 3. Generate hero image with text overlay
 * 4. Upload images to Strapi
 * 5. Insert images into markdown
 *
 * This module is called AFTER the Validation phase to work with final article content.
 */

import { randomUUID } from 'crypto';
import type { Core } from '@strapi/strapi';
import type { LanguageModel } from 'ai';
import { generateObject } from 'ai';

import type { Logger } from '../../utils/logger';
import type { ArticlePlan } from './article-plan';
import type { GameArticleContext, ResearchPool, TokenUsage } from './types';
import type { ImagePool, CollectedImage } from './image-pool';
import { createEmptyImagePool, addIGDBImages, addWebImages, getPoolSummary } from './image-pool';
import { runImageCurator, type ImageCuratorOutput, type SectionImageAssignment, type HeroImageAssignment } from './agents/image-curator';
import { processHeroImage, processSectionImage, getHighResIGDBUrl, type HeroImageResult, type SectionImageResult } from './hero-image';
import { 
  uploadImageFromUrl, 
  uploadImageBuffer,
  createImageFilename,
  type ImageUploadResult,
  type ImageUploaderDeps,
} from './services/image-uploader';
import { insertImagesIntoMarkdown, type ImageInsertionResult } from './image-inserter';
import { IMAGE_CURATOR_CONFIG } from './config';
import { addTokenUsage, createEmptyTokenUsage } from './types';
import { downloadImageWithRetry } from './services/image-downloader';
import { getOrCreateArticleFolder, type FolderResult } from './services/folder-service';
import { slugify } from '../../utils/slug';

// ============================================================================
// Type Helpers
// ============================================================================

/** Valid image source types for metadata */
const VALID_IMAGE_SOURCES = ['igdb', 'tavily', 'exa'] as const;
type ValidImageSource = typeof VALID_IMAGE_SOURCES[number];

/**
 * Safely converts an image source string to a typed image source.
 * Returns 'web' as fallback for unknown sources.
 */
function toImageSourceType(source: string): ValidImageSource | 'web' {
  return VALID_IMAGE_SOURCES.includes(source as ValidImageSource)
    ? (source as ValidImageSource)
    : 'web';
}

// ============================================================================
// Research Pool Image Extraction
// ============================================================================

/**
 * Extracts images from a ResearchPool into an ImagePool.
 *
 * This bridges the gap between search results (which now contain images)
 * and the image curation system.
 *
 * @param researchPool - The research pool from Scout/Specialist phases
 * @returns An ImagePool containing all extracted images
 */
export function extractImagesFromResearchPool(researchPool: ResearchPool): ImagePool {
  let imagePool = createEmptyImagePool();

  // Helper to process a CategorizedSearchResult array
  const processSearchResults = (results: ResearchPool['scoutFindings']['overview']) => {
    for (const searchResult of results) {
      const query = searchResult.query;
      // Determine the actual source for proper image tracking
      const source = searchResult.searchSource === 'exa' ? 'exa' : 'tavily';

      // Process query-level images (from Tavily with include_images)
      // These are only from Tavily, so always use 'tavily' source
      if (searchResult.images && searchResult.images.length > 0) {
        const webImages = searchResult.images.map((img) => ({
          url: img.url,
          description: img.description,
        }));
        imagePool = addWebImages(imagePool, webImages, query, 'tavily');
      }

      // Process per-result images (from individual search results)
      // Use the actual source so images are properly tracked as 'tavily' or 'exa'
      for (const result of searchResult.results) {
        if (result.images && result.images.length > 0) {
          const images = result.images.map((img) => ({
            url: img.url,
            description: img.description,
          }));
          imagePool = addWebImages(imagePool, images, query, source);
        }
      }
    }
  };

  // Process all scout findings
  processSearchResults(researchPool.scoutFindings.overview);
  processSearchResults(researchPool.scoutFindings.categorySpecific);
  processSearchResults(researchPool.scoutFindings.recent);

  // Process section-specific results from queryCache
  // These are not added to scoutFindings but may contain valuable images
  for (const result of researchPool.queryCache.values()) {
    if (result.category === 'section-specific') {
      processSearchResults([result]);
    }
  }

  return imagePool;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Input for the image phase.
 */
export interface ImagePhaseInput {
  /** Final article markdown (after review/fixes) */
  readonly markdown: string;
  /** Article plan with section structure */
  readonly plan: ArticlePlan;
  /** Game article context (contains IGDB images) */
  readonly context: GameArticleContext;
  /** Image pool from search phases (Tavily/Exa images) */
  readonly searchImagePool?: ImagePool;
  /** Article title (from metadata) */
  readonly articleTitle: string;
}

/**
 * Dependencies for the image phase.
 */
export interface ImagePhaseDeps {
  /** OpenRouter model for image curation */
  readonly model: LanguageModel;
  /** Strapi instance for uploads */
  readonly strapi: Core.Strapi;
  /** Logger for debugging */
  readonly logger?: Logger;
  /** Abort signal for cancellation */
  readonly signal?: AbortSignal;
}

/**
 * Result of the image phase.
 */
export interface ImagePhaseResult {
  /** Markdown with images inserted */
  readonly markdown: string;
  /** Whether images were added */
  readonly imagesAdded: boolean;
  /** Number of images inserted */
  readonly imageCount: number;
  /** Hero image info (if uploaded) */
  readonly heroImage?: ImageUploadResult;
  /** Whether hero image processing was attempted but failed */
  readonly heroImageFailed?: boolean;
  /** Section images info (if uploaded) */
  readonly sectionImages: readonly ImageUploadResult[];
  /** Sections where image upload failed (for debugging) */
  readonly failedSections?: readonly string[];
  /** Token usage for image curation */
  readonly tokenUsage: TokenUsage;
  /** Image pool summary for debugging */
  readonly poolSummary: {
    readonly total: number;
    readonly igdb: number;
    readonly web: number;
  };
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Runs the complete image phase.
 *
 * @param input - Input with markdown, plan, and context
 * @param deps - Dependencies (model, strapi, logger)
 * @returns Result with updated markdown and image info
 */
export async function runImagePhase(
  input: ImagePhaseInput,
  deps: ImagePhaseDeps
): Promise<ImagePhaseResult> {
  const { markdown, plan, context, searchImagePool, articleTitle } = input;
  const { model, strapi, logger: log, signal } = deps;

  // Generate correlation ID for tracing this image phase execution
  const correlationId = randomUUID().slice(0, 8);
  const logPrefix = `[ImagePhase:${correlationId}]`;

  log?.info(`${logPrefix} Starting image phase for "${articleTitle}"`);

  // Check if images are enabled for this category
  const categorySlug = plan.categorySlug;
  const isEnabled = IMAGE_CURATOR_CONFIG.ENABLED_BY_CATEGORY[categorySlug] ?? true;
  if (!isEnabled) {
    log?.info(`${logPrefix} Images disabled for category: ${categorySlug}`);
    return {
      markdown,
      imagesAdded: false,
      imageCount: 0,
      sectionImages: [],
      tokenUsage: createEmptyTokenUsage(),
      poolSummary: { total: 0, igdb: 0, web: 0 },
    };
  }

  // ===== STEP 1: Build Image Pool =====
  // Start with search images if provided, otherwise empty pool
  let imagePool = searchImagePool ?? createEmptyImagePool();

  // Add IGDB images from context (screenshots, artworks, and/or cover)
  const hasScreenshots = context.screenshotUrls && context.screenshotUrls.length > 0;
  const hasArtworks = context.artworkUrls && context.artworkUrls.length > 0;
  const hasCover = !!context.coverImageUrl;
  
  if (hasScreenshots || hasArtworks || hasCover) {
    imagePool = addIGDBImages(
      imagePool,
      context.screenshotUrls ?? [],
      context.artworkUrls ?? [],
      context.coverImageUrl
    );
    const igdbCount = (context.screenshotUrls?.length ?? 0) + (context.artworkUrls?.length ?? 0) + (hasCover ? 1 : 0);
    log?.info(
      `${logPrefix} Added ${igdbCount} IGDB images to pool ` +
      `(${context.screenshotUrls?.length ?? 0} screenshots, ${context.artworkUrls?.length ?? 0} artworks, ${hasCover ? 1 : 0} cover)`
    );
  }

  const poolSummary = getPoolSummary(imagePool);
  const webCount = poolSummary.tavily + poolSummary.exa;
  log?.info(`${logPrefix} Image pool: ${poolSummary.total} total (${poolSummary.igdb} IGDB, ${webCount} web)`);

  // Check if we have any images to work with
  if (imagePool.count === 0) {
    log?.warn(`${logPrefix} No images available, skipping image phase`);
    return {
      markdown,
      imagesAdded: false,
      imageCount: 0,
      sectionImages: [],
      tokenUsage: createEmptyTokenUsage(),
      poolSummary: { total: 0, igdb: 0, web: webCount },
    };
  }

  // ===== STEP 1.5: Create Folder Structure =====
  // Organize images by: /images/{game_slug}/{article_slug}
  let articleFolder: FolderResult | undefined;
  const gameSlug = context.gameSlug ?? slugify(context.gameName);
  const articleSlug = slugify(articleTitle);
  
  try {
    articleFolder = await getOrCreateArticleFolder(
      { strapi, logger: log },
      gameSlug,
      articleSlug
    );
    log?.debug(`${logPrefix} Using folder: ${articleFolder.path} (id: ${articleFolder.id})`);
  } catch (error) {
    // Log but continue - images will be uploaded to root
    const errorMsg = error instanceof Error ? error.message : String(error);
    log?.warn(`${logPrefix} Failed to create article folder: ${errorMsg}`);
  }

  // ===== STEP 2: Run Image Curator =====
  let curatorOutput: ImageCuratorOutput;
  try {
    curatorOutput = await runImageCurator(
      {
        markdown,
        plan,
        imagePool,
        gameName: context.gameName,
        articleTitle,
      },
      {
        model,
        generateObject,
        logger: log,
        signal,
      }
    );
    log?.info(`${logPrefix} Curator selected: hero=${curatorOutput.heroImage ? 'yes' : 'no'}, sections=${curatorOutput.sectionImages.length}`);
  } catch (error) {
    log?.error(`${logPrefix} Curator failed: ${error}`);
    return {
      markdown,
      imagesAdded: false,
      imageCount: 0,
      sectionImages: [],
      tokenUsage: createEmptyTokenUsage(),
      poolSummary: { total: poolSummary.total, igdb: poolSummary.igdb, web: webCount },
    };
  }

  // ===== STEP 3: Process and Upload Hero Image =====
  // All hero images are processed (resize/optimize) for consistent quality
  let heroUpload: ImageUploadResult | undefined;
  let heroImageFailed = false;
  if (curatorOutput.heroImage) {
    try {
      const heroAssignment = curatorOutput.heroImage;
      const isIgdb = heroAssignment.image.source === 'igdb';
      
      // Get the source URL (high-res for IGDB, original for web)
      const sourceUrl = isIgdb
        ? getHighResIGDBUrl(heroAssignment.image.url)
        : heroAssignment.image.url;
      
      log?.info(`${logPrefix} Processing hero image from ${heroAssignment.image.source}`);
      const heroResult = await processHeroImage({
        imageUrl: sourceUrl,
        logger: log,
        signal,
      });

      // Upload the processed image
      const uploaderDeps: ImageUploaderDeps = { strapi, logger: log };
      heroUpload = await uploadImageBuffer(
        {
          buffer: heroResult.buffer,
          filename: createImageFilename(articleTitle, 'hero'),
          mimeType: heroResult.mimeType,
          altText: heroAssignment.altText,
          // Caption is now just a description, not attribution
          caption: isIgdb ? 'Official game artwork' : undefined,
          // Source metadata stored in provider_metadata for frontend attribution
          sourceMetadata: {
            sourceUrl: heroAssignment.image.url,
            sourceDomain: heroAssignment.image.sourceDomain,
            imageSource: toImageSourceType(heroAssignment.image.source),
          },
          // Folder organization: /images/{game_slug}/{article_slug}
          folderId: articleFolder?.id,
          folderPath: articleFolder?.path,
        },
        uploaderDeps
      );
      log?.info(`${logPrefix} Hero image uploaded: ${heroUpload.url}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log?.warn(
        `${logPrefix} Hero image processing failed: ` +
        `title="${articleTitle}", url="${curatorOutput.heroImage?.image.url}", error=${errorMsg}`
      );
      // Continue without hero image, but mark as failed for caller
      heroImageFailed = true;
    }
  }

  // ===== STEP 4: Upload Section Images (Batched for Concurrency Control) =====
  // Upload images in batches to prevent overwhelming Strapi
  const uploaderDeps: ImageUploaderDeps = { strapi, logger: log };
  const concurrency = IMAGE_CURATOR_CONFIG.UPLOAD_CONCURRENCY;
  
  const uploadedSectionImages: Array<{
    assignment: SectionImageAssignment;
    upload: ImageUploadResult;
  }> = [];
  
  // Track sections where upload failed for debugging
  const failedSections: string[] = [];

  // Process uploads in batches
  const assignments = curatorOutput.sectionImages;
  for (let i = 0; i < assignments.length; i += concurrency) {
    // Check if aborted before starting new batch (prevents orphan uploads on timeout)
    if (signal?.aborted) {
      log?.warn(`${logPrefix} Aborted before batch upload, stopping`);
      break;
    }

    const batch = assignments.slice(i, i + concurrency);
    const batchNum = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(assignments.length / concurrency);
    
    log?.debug(`${logPrefix} Uploading batch ${batchNum}/${totalBatches} (${batch.length} images)`);
    
    const batchResults = await Promise.allSettled(
      batch.map(async (assignment) => {
        const upload = await uploadImageFromUrl(
          {
            url: assignment.image.url,
            filename: createImageFilename(articleTitle, assignment.sectionHeadline, assignment.sectionIndex),
            altText: assignment.altText,
            caption: assignment.caption,
            // Source metadata stored in provider_metadata for frontend attribution
            sourceMetadata: {
              sourceUrl: assignment.image.url,
              sourceDomain: assignment.image.sourceDomain,
              imageSource: toImageSourceType(assignment.image.source),
            },
            signal,
            // Folder organization: /images/{game_slug}/{article_slug}
            folderId: articleFolder?.id,
            folderPath: articleFolder?.path,
          },
          uploaderDeps
        );
        return { assignment, upload };
      })
    );

    // Process batch results - check abort between each result for faster response
    for (let j = 0; j < batchResults.length; j++) {
      // Early exit if aborted (prevents processing remaining results after abort)
      if (signal?.aborted) {
        log?.debug(`${logPrefix} Aborted during result processing, stopping`);
        break;
      }
      
      const result = batchResults[j];
      if (result.status === 'fulfilled') {
        uploadedSectionImages.push(result.value);
        log?.debug(`${logPrefix} Section image uploaded: ${result.value.upload.url}`);
      } else {
        const assignment = batch[j];
        const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        failedSections.push(assignment.sectionHeadline);
        log?.warn(
          `${logPrefix} Section image upload failed: ` +
          `section="${assignment.sectionHeadline}", url="${assignment.image.url}", error=${errorMsg}`
        );
      }
    }
  }

  log?.info(`${logPrefix} Uploaded ${uploadedSectionImages.length}/${assignments.length} section images`);
  if (failedSections.length > 0) {
    log?.warn(`${logPrefix} Failed sections: ${failedSections.join(', ')}`);
  }

  // ===== STEP 5: Insert Images into Markdown =====
  let insertionResult: ImageInsertionResult;
  try {
    insertionResult = insertImagesIntoMarkdown({
      markdown,
      heroImage: heroUpload && curatorOutput.heroImage
        ? { assignment: curatorOutput.heroImage, upload: heroUpload }
        : undefined,
      sectionImages: uploadedSectionImages,
    });
    log?.info(`${logPrefix} Inserted ${insertionResult.imagesInserted} images into markdown`);
  } catch (error) {
    log?.error(`${logPrefix} Image insertion failed: ${error}`);
    return {
      markdown,
      imagesAdded: false,
      imageCount: 0,
      heroImage: heroUpload,
      heroImageFailed,
      sectionImages: uploadedSectionImages.map(s => s.upload),
      failedSections: failedSections.length > 0 ? failedSections : undefined,
      tokenUsage: curatorOutput.tokenUsage,
      poolSummary: { total: poolSummary.total, igdb: poolSummary.igdb, web: webCount },
    };
  }

  // Hero image counts as "added" even though it's not inserted into markdown
  // (it's used as featuredImage), plus any section images inserted into markdown
  const hasHeroImage = insertionResult.heroImage !== undefined;
  const hasSectionImages = insertionResult.imagesInserted > 0;
  
  return {
    markdown: insertionResult.markdown,
    imagesAdded: hasHeroImage || hasSectionImages,
    imageCount: insertionResult.imagesInserted + (hasHeroImage ? 1 : 0),
    heroImage: insertionResult.heroImage,
    heroImageFailed,
    sectionImages: insertionResult.sectionImages,
    failedSections: failedSections.length > 0 ? failedSections : undefined,
    tokenUsage: curatorOutput.tokenUsage,
    poolSummary: { total: poolSummary.total, igdb: poolSummary.igdb, web: webCount },
  };
}

/**
 * Checks if image phase should run for given context and options.
 */
export function shouldRunImagePhase(
  context: GameArticleContext,
  categorySlug: string,
  enableImages?: boolean
): boolean {
  // Explicit override takes precedence
  if (enableImages !== undefined) {
    return enableImages;
  }

  // Check category-specific setting
  // Note: ENABLED_BY_CATEGORY may not have all categories, so check if key exists
  type CategoryKey = keyof typeof IMAGE_CURATOR_CONFIG.ENABLED_BY_CATEGORY;
  const isKnownCategory = categorySlug in IMAGE_CURATOR_CONFIG.ENABLED_BY_CATEGORY;
  if (isKnownCategory) {
    const categoryEnabled = IMAGE_CURATOR_CONFIG.ENABLED_BY_CATEGORY[categorySlug as CategoryKey];
    if (!categoryEnabled) {
      return false;
    }
  }

  // Always allow image phase to attempt running
  // Web images from research will be collected even without IGDB images
  // The actual "do we have any images?" check happens inside runImagePhase
  // after the pool is populated from all sources (IGDB + web search)
  return true;
}
