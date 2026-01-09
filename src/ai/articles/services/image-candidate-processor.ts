/**
 * Image Candidate Processor
 *
 * Processes ranked image candidates from the Image Curator, validates dimensions,
 * and selects the first valid image for each slot (hero, sections).
 *
 * This is the post-processing step between curator selection and image upload.
 */

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
  type ImageDimensions,
} from './image-dimensions';
import { IMAGE_DIMENSION_CONFIG } from '../config';
import { normalizeImageUrlForDedupe } from '../utils/url-utils';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of processing hero candidates.
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
}

/**
 * Result of processing section candidates.
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
}

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
 * dimension requirements.
 *
 * @param candidates - Ranked hero candidates from curator (best first)
 * @param options - Processing options
 * @returns First valid hero result, or null if none meet requirements
 */
export async function processHeroCandidates(
  candidates: readonly HeroCandidateOutput[],
  options: ProcessHeroOptions = {}
): Promise<ProcessedHeroResult | null> {
  const {
    minWidth = IMAGE_DIMENSION_CONFIG.HERO_MIN_WIDTH,
    logger,
    signal,
  } = options;

  logger?.debug(`[CandidateProcessor] Processing ${candidates.length} hero candidates (min width: ${minWidth}px)`);

  // Track failure reasons for summary logging
  let probeFailures = 0;
  let tooSmall = 0;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    // Check for cancellation
    if (signal?.aborted) {
      logger?.debug('[CandidateProcessor] Processing cancelled');
      return null;
    }

    logger?.debug(`[CandidateProcessor] Checking hero candidate ${i}: ${candidate.image.url.slice(0, 80)}...`);

    // Get dimensions (may use IGDB inference or download)
    const dims = await getImageDimensions(candidate.image.url, { logger, signal });

    if (!dims) {
      logger?.debug(`[CandidateProcessor] Hero candidate ${i}: failed to get dimensions`);
      probeFailures++;
      continue;
    }

    if (dims.width >= minWidth) {
      logger?.info(
        `[CandidateProcessor] Hero candidate ${i} selected: ${dims.width}x${dims.height} ` +
        `(${dims.inferred ? 'inferred' : 'measured'})`
      );
      return {
        image: candidate.image,
        altText: candidate.altText,
        dimensions: dims,
        selectedCandidateIndex: i,
      };
    }

    logger?.debug(`[CandidateProcessor] Hero candidate ${i} too small: ${dims.width}px < ${minWidth}px`);
    tooSmall++;
  }

  // Log summary of why all candidates failed
  logger?.warn(
    `[CandidateProcessor] All ${candidates.length} hero candidates failed: ` +
    `${probeFailures} probe failures, ${tooSmall} too small (min ${minWidth}px)`
  );
  return null;
}

// ============================================================================
// Section Candidate Processing
// ============================================================================

/**
 * Processes ranked section candidates and returns the first one that meets
 * dimension requirements.
 *
 * All section images use full-width layout with standard markdown.
 * Images below the minimum width threshold are skipped.
 *
 * @param selection - Section selection with ranked candidates from curator
 * @param options - Processing options
 * @returns First valid section result, or null if none meet requirements
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
  let probeFailures = 0;
  let tooSmall = 0;
  let cacheHits = 0;

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

    // Get dimensions (check cache first, then probe)
    let dims: ImageDimensions | null;
    const cachedDims = dimensionCache?.get(candidate.image.url);
    if (cachedDims !== undefined) {
      dims = cachedDims;
      cacheHits++;
      logger?.debug(`[CandidateProcessor] Section candidate ${i}: using cached dimensions`);
    } else {
      dims = await getImageDimensions(candidate.image.url, { logger, signal });
      // Store in cache for potential reuse
      dimensionCache?.set(candidate.image.url, dims);
    }

    if (!dims) {
      logger?.debug(`[CandidateProcessor] Section candidate ${i}: failed to get dimensions`);
      probeFailures++;
      continue;
    }

    if (dims.width >= minWidth) {
      logger?.info(
        `[CandidateProcessor] Section candidate ${i} selected for "${selection.sectionHeadline}": ` +
        `${dims.width}x${dims.height} (${dims.inferred ? 'inferred' : 'measured'})`
      );
      return {
        sectionHeadline: selection.sectionHeadline,
        sectionIndex: selection.sectionIndex,
        image: candidate.image,
        altText: candidate.altText,
        caption: candidate.caption,
        dimensions: dims,
        selectedCandidateIndex: i,
      };
    }

    logger?.debug(
      `[CandidateProcessor] Section candidate ${i} too small: ${dims.width}px < ${minWidth}px`
    );
    tooSmall++;
  }

  // Log summary of why all candidates failed
  const reasons = [];
  if (excluded > 0) reasons.push(`${excluded} excluded`);
  if (probeFailures > 0) reasons.push(`${probeFailures} probe failures`);
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
 * @param selections - All section selections from curator
 * @param options - Processing options
 * @returns Array of processed section results (some may be null)
 */
export async function processAllSectionCandidates(
  selections: readonly SectionSelectionOutput[],
  options: ProcessSectionOptions = {}
): Promise<(ProcessedSectionResult | null)[]> {
  const { excludeUrls = [], logger, signal } = options;

  logger?.info(
    `[CandidateProcessor] Processing ${selections.length} section selections ` +
    `(sequential for deduplication)`
  );

  // Accumulate selected URLs to prevent cross-section duplicates
  // Start with any externally excluded URLs (e.g., hero image)
  const usedUrls = new Set(
    excludeUrls.map(url => normalizeImageUrlForDedupe(url))
  );
  const results: (ProcessedSectionResult | null)[] = [];

  // Shared dimension cache to avoid redundant HTTP requests
  // If same image appears in multiple sections' candidates, we only probe once
  const sharedDimensionCache = new Map<string, ImageDimensions | null>();

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

    // Process this section with current exclusions and shared cache
    const result = await processSectionCandidates(selection, {
      ...options,
      excludeUrls: [...usedUrls], // Current accumulated exclusions
      dimensionCache: sharedDimensionCache,
    });

    // If we selected an image, add it to exclusions for subsequent sections
    if (result) {
      usedUrls.add(normalizeImageUrlForDedupe(result.image.url));
    }
    results.push(result);
  }

  const validCount = results.filter(r => r !== null).length;
  const cacheSize = sharedDimensionCache.size;
  logger?.info(
    `[CandidateProcessor] ${validCount}/${selections.length} sections have valid images ` +
    `(dimension cache: ${cacheSize} entries)`
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
