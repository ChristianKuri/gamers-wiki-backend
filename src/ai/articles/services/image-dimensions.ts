/**
 * Image Dimension Service
 *
 * Provides utilities for determining image dimensions:
 * 1. IGDB dimension inference from URL tokens (no download needed)
 * 2. Actual dimension probing via download + Sharp metadata
 *
 * This module is used after the Image Curator selects candidates,
 * to validate dimensions before upload and determine layout.
 */

import sharp from 'sharp';
import type { Logger } from '../../../utils/logger';
import { downloadImage } from './image-downloader';
import { IMAGE_DIMENSION_CONFIG } from '../config';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of dimension detection.
 */
export interface ImageDimensions {
  /** Width in pixels */
  readonly width: number;
  /** Height in pixels */
  readonly height: number;
  /**
   * Whether dimensions were inferred from URL (true) or
   * measured from actual download (false).
   * Inferred dimensions are faster but may not match actual image.
   */
  readonly inferred: boolean;
}

/**
 * Options for getting image dimensions.
 */
export interface GetDimensionsOptions {
  /** Logger for debugging */
  readonly logger?: Logger;
  /** AbortSignal for cancellation */
  readonly signal?: AbortSignal;
  /** Timeout in ms (defaults to config value) */
  readonly timeoutMs?: number;
  /** Number of retries for failed probes (defaults to config value) */
  readonly retries?: number;
}

// ============================================================================
// IGDB Dimension Inference
// ============================================================================

/**
 * IGDB image size tokens and their known dimensions.
 * See: https://api-docs.igdb.com/#images
 *
 * IGDB URLs follow the pattern: https://images.igdb.com/igdb/image/upload/{size}/{image_id}.jpg
 * The size token determines the dimensions.
 */
const IGDB_SIZE_MAP: Record<string, { width: number; height: number }> = {
  // High resolution
  't_1080p': { width: 1920, height: 1080 },
  't_720p': { width: 1280, height: 720 },

  // Screenshots
  't_screenshot_huge': { width: 1280, height: 720 },
  't_screenshot_big': { width: 889, height: 500 },
  't_screenshot_med': { width: 569, height: 320 },

  // Note: t_original is intentionally excluded - it can be any size
  // (original uploaded image), so we force actual dimension probing

  // Covers
  't_cover_big': { width: 264, height: 374 },
  't_cover_small': { width: 90, height: 128 },

  // Thumbnails
  't_thumb': { width: 90, height: 90 },
  't_micro': { width: 35, height: 35 },
  't_logo_med': { width: 284, height: 160 },
} as const;

/**
 * Infers image dimensions from IGDB URL without downloading.
 *
 * @param url - Image URL to analyze
 * @returns Dimensions if URL is IGDB with known size token, null otherwise
 *
 * @example
 * inferIGDBDimensions('https://images.igdb.com/igdb/image/upload/t_1080p/abc123.jpg')
 * // Returns: { width: 1920, height: 1080 }
 */
export function inferIGDBDimensions(
  url: string
): { width: number; height: number } | null {
  // Check if this is an IGDB URL
  if (!url.includes('images.igdb.com')) {
    return null;
  }

  // Look for size token in URL
  for (const [token, dims] of Object.entries(IGDB_SIZE_MAP)) {
    if (url.includes(`/${token}/`)) {
      return dims;
    }
  }

  return null;
}

// ============================================================================
// Dimension Probing
// ============================================================================

/**
 * Gets image dimensions, preferring inference over download.
 *
 * Strategy:
 * 1. Try IGDB URL inference (instant, no download)
 * 2. Fall back to downloading and probing with Sharp (with retry for transient failures)
 *
 * @param url - Image URL
 * @param options - Options including logger, signal, timeout, retries
 * @returns Dimensions if successful, null if failed
 */
export async function getImageDimensions(
  url: string,
  options: GetDimensionsOptions = {}
): Promise<ImageDimensions | null> {
  const {
    logger,
    signal,
    timeoutMs = IMAGE_DIMENSION_CONFIG.DIMENSION_PROBE_TIMEOUT_MS,
    retries = IMAGE_DIMENSION_CONFIG.DIMENSION_PROBE_RETRIES,
  } = options;

  // Try IGDB inference first (no download needed)
  const igdbDims = inferIGDBDimensions(url);
  if (igdbDims) {
    logger?.debug(`[ImageDimensions] Inferred IGDB dimensions: ${igdbDims.width}x${igdbDims.height}`);
    return {
      width: igdbDims.width,
      height: igdbDims.height,
      inferred: true,
    };
  }

  // Download and probe with Sharp (with retry for transient network failures)
  const maxAttempts = retries + 1;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check for cancellation before each attempt
    if (signal?.aborted) {
      logger?.debug(`[ImageDimensions] Probing cancelled for: ${url}`);
      return null;
    }

    try {
      if (attempt === 1) {
        logger?.debug(`[ImageDimensions] Probing dimensions for: ${url}`);
      } else {
        logger?.debug(`[ImageDimensions] Retry ${attempt - 1}/${retries} for: ${url}`);
      }

      const result = await downloadImage({
        url,
        logger,
        signal,
        timeoutMs,
        checkSizeFirst: true, // Reject oversized images early
      });

      const metadata = await sharp(result.buffer).metadata();

      if (!metadata.width || !metadata.height) {
        logger?.warn(`[ImageDimensions] Sharp returned no dimensions for: ${url}`);
        return null;
      }

      logger?.debug(`[ImageDimensions] Probed dimensions: ${metadata.width}x${metadata.height}`);

      return {
        width: metadata.width,
        height: metadata.height,
        inferred: false,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      
      // Don't retry if aborted
      if (signal?.aborted) {
        return null;
      }

      // Log and continue to next attempt if retries remaining
      if (attempt < maxAttempts) {
        logger?.debug(`[ImageDimensions] Attempt ${attempt} failed for ${url}: ${lastError}`);
      }
    }
  }

  // All attempts failed
  logger?.warn(
    `[ImageDimensions] Failed to probe dimensions after ${maxAttempts} attempt(s) for ${url}: ${lastError}`
  );
  return null;
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Checks if dimensions meet hero image requirements.
 */
export function meetsHeroRequirements(
  dims: ImageDimensions | null,
  minWidth: number = IMAGE_DIMENSION_CONFIG.HERO_MIN_WIDTH
): boolean {
  return dims !== null && dims.width >= minWidth;
}

/**
 * Checks if dimensions meet section image requirements.
 * All section images use full-width layout (no float-left).
 */
export function meetsSectionRequirements(
  dims: ImageDimensions | null,
  minWidth: number = IMAGE_DIMENSION_CONFIG.SECTION_MIN_WIDTH
): boolean {
  return dims !== null && dims.width >= minWidth;
}
