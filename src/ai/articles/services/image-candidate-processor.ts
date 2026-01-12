/**
 * Image Candidate Processor
 *
 * Processes ranked image candidates from the Image Curator, validates dimensions,
 * and selects the first valid image for each slot (hero, sections).
 *
 * This is the post-processing step between curator selection and image upload.
 *
 * MEMORY NOTE: ProcessedHeroResult and ProcessedSectionResult hold image buffers
 * in memory during the image phase. These are garbage collected after upload completes.
 * For articles with many large images, memory usage will spike temporarily.
 * This is an intentional trade-off for the "download once, reuse buffer" pattern
 * which avoids redundant network requests.
 */

import sharp from 'sharp';
import type { Logger } from '../../../utils/logger';
import type { CollectedImage } from '../image-pool';
import type {
  HeroCandidateOutput,
  SectionSelectionOutput,
  SectionCandidateOutput,
  HeroImageAssignment,
  SectionImageAssignment,
} from '../agents/image-curator';
import {
  getImageDimensions,
  inferIGDBDimensions,
  type ImageDimensions,
} from './image-dimensions';
import { downloadImage } from './image-downloader';
import { IMAGE_DIMENSION_CONFIG } from '../config';
import { normalizeImageUrlForDedupe } from '../utils/url-utils';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of processing hero candidates.
 * Includes downloaded buffer for reuse in validation and upload.
 */
export interface ProcessedHeroResult {
  /** Selected image */
  readonly image: CollectedImage;
  /** SEO-optimized alt text */
  readonly altText: string;
  /** Validated dimensions */
  readonly dimensions: ImageDimensions;
  /** Index of the selected candidate (for debugging) */
  readonly selectedCandidateIndex: number;
  /** Downloaded image buffer (for reuse in upload) */
  readonly buffer: Buffer;
  /** MIME type of the downloaded image */
  readonly mimeType: string;
}

/**
 * Result of processing section candidates.
 * Includes downloaded buffer for reuse in validation and upload.
 */
export interface ProcessedSectionResult {
  /** Section headline */
  readonly sectionHeadline: string;
  /** Section index in plan */
  readonly sectionIndex: number;
  /** Selected image */
  readonly image: CollectedImage;
  /** SEO-optimized alt text */
  readonly altText: string;
  /** Optional caption */
  readonly caption?: string;
  /** Validated dimensions */
  readonly dimensions: ImageDimensions;
  /** Index of the selected candidate (for debugging) */
  readonly selectedCandidateIndex: number;
  /** Downloaded image buffer (for reuse in upload) */
  readonly buffer: Buffer;
  /** MIME type of the downloaded image */
  readonly mimeType: string;
}

/**
 * Result of quality validation for a hero candidate.
 */
export interface QualityValidatorResult {
  readonly passed: boolean;
  readonly reason?: string;
}

/**
 * Quality validator function type.
 * Called after dimension validation passes to check for watermarks, blur, etc.
 */
export type QualityValidator = (
  buffer: Buffer,
  mimeType: string
) => Promise<QualityValidatorResult>;

/**
 * Options for processing hero candidates.
 */
export interface ProcessHeroOptions {
  /** Minimum width for hero images (default: from config) */
  readonly minWidth?: number;
  /** Logger for debugging */
  readonly logger?: Logger;
  /** AbortSignal for cancellation */
  readonly signal?: AbortSignal;
  /** Optional quality validator for hero images (watermark/clarity check) */
  readonly qualityValidator?: QualityValidator;
}

/**
 * Options for processing section candidates.
 */
export interface ProcessSectionOptions {
  /** Minimum width for section images (default: from config) */
  readonly minWidth?: number;
  /** URLs to exclude (e.g., hero image URL to prevent reuse) */
  readonly excludeUrls?: readonly string[];
  /** Shared cache for dimension probing (avoids redundant HTTP requests) */
  readonly dimensionCache?: Map<string, ImageDimensions | null>;
  /** Logger for debugging */
  readonly logger?: Logger;
  /** AbortSignal for cancellation */
  readonly signal?: AbortSignal;
}

// ============================================================================
// Hero Candidate Processing
// ============================================================================

/**
 * Processes ranked hero candidates and returns the first one that meets
 * dimension AND quality requirements.
 *
 * Downloads the image once and returns the buffer for reuse in upload.
 * This avoids re-downloading the same image multiple times.
 *
 * If a qualityValidator is provided, it's called after dimension validation
 * passes to check for watermarks, blur, etc. If validation fails, the next
 * candidate is tried.
 *
 * @param candidates - Ranked hero candidates from curator (best first)
 * @param options - Processing options (including optional quality validator)
 * @returns First valid hero result with buffer, or null if none meet requirements
 */
export async function processHeroCandidates(
  candidates: readonly HeroCandidateOutput[],
  options: ProcessHeroOptions = {}
): Promise<ProcessedHeroResult | null> {
  const {
    minWidth = IMAGE_DIMENSION_CONFIG.HERO_MIN_WIDTH,
    logger,
    signal,
    qualityValidator,
  } = options;

  logger?.debug(`[CandidateProcessor] Processing ${candidates.length} hero candidates (min width: ${minWidth}px)`);

  // Track failure reasons for summary logging
  let probeFailures = 0;
  let tooSmall = 0;
  let downloadFailures = 0;
  let qualityFailures = 0;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    // Check for cancellation
    if (signal?.aborted) {
      logger?.debug('[CandidateProcessor] Processing cancelled');
      return null;
    }

    logger?.debug(`[CandidateProcessor] Checking hero candidate ${i}: ${candidate.image.url.slice(0, 80)}...`);

    // For IGDB images, try to infer dimensions first (no download needed)
    const inferredDims = inferIGDBDimensions(candidate.image.url);
    if (inferredDims && inferredDims.width >= minWidth) {
      // IGDB image with known large size - download it
      try {
        const downloadResult = await downloadImage({
          url: candidate.image.url,
          logger,
          signal,
        });
        
        // Verify dimensions from actual buffer
        const metadata = await sharp(downloadResult.buffer).metadata();
        const dims: ImageDimensions = {
          width: metadata.width ?? inferredDims.width,
          height: metadata.height ?? inferredDims.height,
          inferred: false,
        };
        
        if (dims.width >= minWidth) {
          // Run quality validation if provided (for hero images)
          if (qualityValidator) {
            logger?.debug(`[CandidateProcessor] Hero candidate ${i}: running quality validation`);
            const qualityResult = await qualityValidator(downloadResult.buffer, downloadResult.mimeType);
            if (!qualityResult.passed) {
              logger?.debug(
                `[CandidateProcessor] Hero candidate ${i} failed quality check: ${qualityResult.reason ?? 'unknown'}`
              );
              qualityFailures++;
              continue; // Try next candidate
            }
            logger?.debug(`[CandidateProcessor] Hero candidate ${i} passed quality validation`);
          }
          
          logger?.info(
            `[CandidateProcessor] Hero candidate ${i} selected: ${dims.width}x${dims.height} (IGDB)`
          );
          return {
            image: candidate.image,
            altText: candidate.altText,
            dimensions: dims,
            selectedCandidateIndex: i,
            buffer: downloadResult.buffer,
            mimeType: downloadResult.mimeType,
          };
        }
        tooSmall++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger?.debug(`[CandidateProcessor] Hero candidate ${i}: download failed: ${errorMsg}`);
        downloadFailures++;
        continue;
      }
    } else {
      // Non-IGDB or small IGDB image - download and check dimensions
      try {
        const downloadResult = await downloadImage({
          url: candidate.image.url,
          logger,
          signal,
        });
        
        const metadata = await sharp(downloadResult.buffer).metadata();
        if (!metadata.width || !metadata.height) {
          logger?.debug(`[CandidateProcessor] Hero candidate ${i}: failed to get dimensions from buffer`);
          probeFailures++;
          continue;
        }
        
        const dims: ImageDimensions = {
          width: metadata.width,
          height: metadata.height,
          inferred: false,
        };
        
        if (dims.width >= minWidth) {
          // Run quality validation if provided (for hero images)
          if (qualityValidator) {
            logger?.debug(`[CandidateProcessor] Hero candidate ${i}: running quality validation`);
            const qualityResult = await qualityValidator(downloadResult.buffer, downloadResult.mimeType);
            if (!qualityResult.passed) {
              logger?.debug(
                `[CandidateProcessor] Hero candidate ${i} failed quality check: ${qualityResult.reason ?? 'unknown'}`
              );
              qualityFailures++;
              continue; // Try next candidate
            }
            logger?.debug(`[CandidateProcessor] Hero candidate ${i} passed quality validation`);
          }
          
          logger?.info(
            `[CandidateProcessor] Hero candidate ${i} selected: ${dims.width}x${dims.height}`
          );
          return {
            image: candidate.image,
            altText: candidate.altText,
            dimensions: dims,
            selectedCandidateIndex: i,
            buffer: downloadResult.buffer,
            mimeType: downloadResult.mimeType,
          };
        }
        
        logger?.debug(`[CandidateProcessor] Hero candidate ${i} too small: ${dims.width}px < ${minWidth}px`);
        tooSmall++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger?.debug(`[CandidateProcessor] Hero candidate ${i}: download failed: ${errorMsg}`);
        downloadFailures++;
        continue;
      }
    }
  }

  // Log summary of why all candidates failed
  const failureParts = [
    `${downloadFailures} download failures`,
    `${probeFailures} probe failures`,
    `${tooSmall} too small (min ${minWidth}px)`,
  ];
  if (qualityFailures > 0) {
    failureParts.push(`${qualityFailures} quality failures`);
  }
  logger?.warn(
    `[CandidateProcessor] All ${candidates.length} hero candidates failed: ${failureParts.join(', ')}`
  );
  return null;
}

// ============================================================================
// Section Candidate Processing
// ============================================================================

/**
 * Processed image with buffer and dimensions (cached for reuse).
 */
interface CachedDownloadResult {
  readonly buffer: Buffer;
  readonly mimeType: string;
  readonly dimensions: ImageDimensions;
}

/**
 * Processes ranked section candidates and returns the first one that meets
 * dimension requirements.
 *
 * Downloads the image once and returns the buffer for reuse in upload.
 * All section images use full-width layout with standard markdown.
 * Images below the minimum width threshold are skipped.
 *
 * @param selection - Section selection with ranked candidates from curator
 * @param options - Processing options
 * @returns First valid section result with buffer, or null if none meet requirements
 */
export async function processSectionCandidates(
  selection: SectionSelectionOutput,
  options: ProcessSectionOptions = {}
): Promise<ProcessedSectionResult | null> {
  const {
    minWidth = IMAGE_DIMENSION_CONFIG.SECTION_MIN_WIDTH,
    excludeUrls = [],
    dimensionCache,
    logger,
    signal,
  } = options;

  // Build normalized exclusion set for efficient lookup
  const excludeSet = new Set(
    excludeUrls.map(url => normalizeImageUrlForDedupe(url))
  );

  logger?.debug(
    `[CandidateProcessor] Processing ${selection.candidates.length} candidates ` +
    `for section "${selection.sectionHeadline}" (min width: ${minWidth}px, excludes: ${excludeSet.size})`
  );

  // Track failure reasons for summary logging
  let excluded = 0;
  let downloadFailures = 0;
  let tooSmall = 0;

  for (let i = 0; i < selection.candidates.length; i++) {
    const candidate = selection.candidates[i];

    // Check for cancellation
    if (signal?.aborted) {
      logger?.debug('[CandidateProcessor] Processing cancelled');
      return null;
    }

    // Check if this image is excluded (e.g., already used as hero)
    const normalizedUrl = normalizeImageUrlForDedupe(candidate.image.url);
    if (excludeSet.has(normalizedUrl)) {
      logger?.debug(`[CandidateProcessor] Section candidate ${i} excluded (already used elsewhere)`);
      excluded++;
      continue;
    }

    logger?.debug(`[CandidateProcessor] Checking section candidate ${i}: ${candidate.image.url.slice(0, 80)}...`);

    // Download once and get dimensions from buffer
    try {
      const downloadResult = await downloadImage({
        url: candidate.image.url,
        logger,
        signal,
      });
      
      const metadata = await sharp(downloadResult.buffer).metadata();
      if (!metadata.width || !metadata.height) {
        logger?.debug(`[CandidateProcessor] Section candidate ${i}: failed to get dimensions from buffer`);
        downloadFailures++;
        continue;
      }
      
      const dims: ImageDimensions = {
        width: metadata.width,
        height: metadata.height,
        inferred: false,
      };

      if (dims.width >= minWidth) {
        logger?.info(
          `[CandidateProcessor] Section candidate ${i} selected for "${selection.sectionHeadline}": ` +
          `${dims.width}x${dims.height}`
        );
        return {
          sectionHeadline: selection.sectionHeadline,
          sectionIndex: selection.sectionIndex,
          image: candidate.image,
          altText: candidate.altText,
          caption: candidate.caption,
          dimensions: dims,
          selectedCandidateIndex: i,
          buffer: downloadResult.buffer,
          mimeType: downloadResult.mimeType,
        };
      }

      logger?.debug(
        `[CandidateProcessor] Section candidate ${i} too small: ${dims.width}px < ${minWidth}px`
      );
      tooSmall++;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger?.debug(`[CandidateProcessor] Section candidate ${i}: download failed: ${errorMsg}`);
      downloadFailures++;
      continue;
    }
  }

  // Log summary of why all candidates failed
  const reasons = [];
  if (excluded > 0) reasons.push(`${excluded} excluded`);
  if (downloadFailures > 0) reasons.push(`${downloadFailures} download failures`);
  if (tooSmall > 0) reasons.push(`${tooSmall} too small`);
  
  logger?.warn(
    `[CandidateProcessor] Section "${selection.sectionHeadline}": ` +
    `all ${selection.candidates.length} candidates failed (${reasons.join(', ')}, min ${minWidth}px)`
  );
  return null;
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Processes all section selections sequentially to prevent cross-section duplicates.
 *
 * Each section's selected image is added to the exclusion set before processing
 * the next section, ensuring the same image isn't used twice.
 *
 * Downloads images once and returns buffers for reuse in upload.
 *
 * @param selections - All section selections from curator
 * @param options - Processing options
 * @returns Array of processed section results with buffers (some may be null)
 */
export async function processAllSectionCandidates(
  selections: readonly SectionSelectionOutput[],
  options: ProcessSectionOptions = {}
): Promise<(ProcessedSectionResult | null)[]> {
  const { excludeUrls = [], logger, signal } = options;

  logger?.info(
    `[CandidateProcessor] Processing ${selections.length} section selections ` +
    `(sequential for deduplication, download-once pattern)`
  );

  // Accumulate selected URLs to prevent cross-section duplicates
  // Start with any externally excluded URLs (e.g., hero image)
  const usedUrls = new Set(
    excludeUrls.map(url => normalizeImageUrlForDedupe(url))
  );
  const results: (ProcessedSectionResult | null)[] = [];

  // Process sections sequentially to accumulate exclusions
  for (const selection of selections) {
    // Check for cancellation
    if (signal?.aborted) {
      logger?.debug('[CandidateProcessor] Processing cancelled');
      // Fill remaining with nulls
      while (results.length < selections.length) {
        results.push(null);
      }
      break;
    }

    // Process this section with current exclusions
    const result = await processSectionCandidates(selection, {
      ...options,
      excludeUrls: [...usedUrls], // Current accumulated exclusions
    });

    // If we selected an image, add it to exclusions for subsequent sections
    if (result) {
      usedUrls.add(normalizeImageUrlForDedupe(result.image.url));
    }
    results.push(result);
  }

  const validCount = results.filter(r => r !== null).length;
  logger?.info(
    `[CandidateProcessor] ${validCount}/${selections.length} sections have valid images`
  );

  return results;
}

// ============================================================================
// Conversion to Final Assignments
// ============================================================================

/**
 * Converts a processed hero result to a HeroImageAssignment.
 */
export function toHeroAssignment(result: ProcessedHeroResult): HeroImageAssignment {
  return {
    image: result.image,
    altText: result.altText,
  };
}

/**
 * Converts a processed section result to a SectionImageAssignment.
 */
export function toSectionAssignment(result: ProcessedSectionResult): SectionImageAssignment {
  return {
    sectionHeadline: result.sectionHeadline,
    sectionIndex: result.sectionIndex,
    image: result.image,
    altText: result.altText,
    caption: result.caption,
  };
}

/**
 * Converts an array of processed section results to SectionImageAssignments,
 * filtering out nulls.
 */
export function toSectionAssignments(
  results: (ProcessedSectionResult | null)[]
): SectionImageAssignment[] {
  return results
    .filter((r): r is ProcessedSectionResult => r !== null)
    .map(toSectionAssignment);
}
