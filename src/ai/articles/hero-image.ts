/**
 * Hero Image Generator
 *
 * Processes hero images for articles using IGDB artwork/screenshots.
 * Downloads and resizes images for consistent dimensions.
 *
 * Note: Text overlays (article title) are handled via CSS on the frontend,
 * not baked into the image itself.
 *
 * Uses the Sharp library for image processing:
 * - Download high-resolution IGDB image (via consolidated downloader)
 * - Resize to target dimensions
 * - Output as WebP (default) or JPEG for upload
 */

import sharp from 'sharp';
import type { Logger } from '../../utils/logger';
import { downloadImageWithRetry } from './services/image-downloader';
import { isFromDomain } from './utils/url-utils';

// ============================================================================
// Types
// ============================================================================

/**
 * Supported output formats for hero images.
 */
export type HeroImageFormat = 'webp' | 'jpeg';

/**
 * Configuration for hero image processing.
 */
export interface HeroImageConfig {
  /** Target width for hero image (px) */
  readonly width: number;
  /** Target height for hero image (px) */
  readonly height: number;
  /** Quality for output (1-100) */
  readonly quality: number;
  /** Output format (default: webp for better compression) */
  readonly format: HeroImageFormat;
}

/**
 * Result of hero image processing.
 */
export interface HeroImageResult {
  /** Processed image as buffer */
  readonly buffer: Buffer;
  /** MIME type */
  readonly mimeType: 'image/webp' | 'image/jpeg';
  /** Original image URL */
  readonly originalUrl: string;
  /** Final width */
  readonly width: number;
  /** Final height */
  readonly height: number;
  /** Output format used */
  readonly format: HeroImageFormat;
}

/**
 * Options for hero image processing.
 */
export interface HeroImageOptions {
  /** IGDB image URL to use as base */
  readonly imageUrl: string;
  /** Optional custom config */
  readonly config?: Partial<HeroImageConfig>;
  /** Logger for debugging */
  readonly logger?: Logger;
  /** AbortSignal for cancellation support */
  readonly signal?: AbortSignal;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: HeroImageConfig = {
  width: 1280,
  height: 720, // 16:9 aspect ratio
  quality: 85,
  format: 'webp', // WebP provides ~30% better compression than JPEG
};

/** Regex pattern for IGDB image size in URL */
const IGDB_SIZE_PATTERN = /\/t_[a-z0-9_]+\//i;

/** MIME types for output formats */
const FORMAT_MIME_TYPES: Record<HeroImageFormat, 'image/webp' | 'image/jpeg'> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
};

/**
 * Image formats supported by Sharp for hero image processing.
 * These are common web formats that Sharp can reliably process.
 */
const SUPPORTED_INPUT_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'tiff', 'avif']);

// ============================================================================
// Main Function
// ============================================================================

/**
 * Processes a hero image (download, resize, optimize).
 * Text overlay for article title is handled via CSS on the frontend.
 *
 * Outputs WebP by default for better compression (~30% smaller than JPEG).
 * Falls back to JPEG if WebP is not supported or explicitly requested.
 *
 * @param options - Processing options
 * @returns Processed hero image result with buffer
 *
 * @example
 * const result = await processHeroImage({
 *   imageUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/abc123.jpg',
 * });
 *
 * @example
 * // Force JPEG output
 * const result = await processHeroImage({
 *   imageUrl: 'https://images.igdb.com/image.jpg',
 *   config: { format: 'jpeg' },
 * });
 */
export async function processHeroImage(options: HeroImageOptions): Promise<HeroImageResult> {
  const { imageUrl, config: customConfig, logger, signal } = options;
  const config = { ...DEFAULT_CONFIG, ...customConfig };

  logger?.info(`[HeroImage] Processing hero image from: ${imageUrl}`);

  // Download the source image using consolidated downloader (with SSRF protection + retry)
  const downloadResult = await downloadImageWithRetry({
    url: imageUrl,
    logger,
    signal,
  });

  // Get image metadata and validate format
  const metadata = await sharp(downloadResult.buffer).metadata();
  logger?.debug(`[HeroImage] Source: ${metadata.width}x${metadata.height} ${metadata.format}`);

  // Validate format is supported by Sharp for processing
  if (!metadata.format || !SUPPORTED_INPUT_FORMATS.has(metadata.format)) {
    throw new Error(
      `Unsupported image format: ${metadata.format ?? 'unknown'}. ` +
      `Supported formats: ${[...SUPPORTED_INPUT_FORMATS].join(', ')}`
    );
  }

  // Start processing pipeline
  // Note: Sharp methods return new instances, so const is appropriate here
  const pipeline = sharp(downloadResult.buffer).resize(config.width, config.height, {
    fit: 'cover',
    position: 'center',
  });

  // Apply output format
  let outputBuffer: Buffer;
  if (config.format === 'webp') {
    outputBuffer = await pipeline.webp({ quality: config.quality }).toBuffer();
  } else {
    outputBuffer = await pipeline.jpeg({ quality: config.quality }).toBuffer();
  }

  logger?.info(
    `[HeroImage] Processed ${outputBuffer.length} bytes, ${config.width}x${config.height}, format: ${config.format}`
  );

  return {
    buffer: outputBuffer,
    mimeType: FORMAT_MIME_TYPES[config.format],
    originalUrl: imageUrl,
    width: config.width,
    height: config.height,
    format: config.format,
  };
}

/**
 * Converts an IGDB image URL to high-resolution version.
 *
 * IGDB image sizes:
 * - t_1080p: 1920x1080 (best for hero)
 * - t_screenshot_huge: 1280x720
 * - t_screenshot_big: 889x500
 *
 * @param url - Original IGDB URL
 * @param size - Desired size (default: t_1080p)
 * @returns URL with updated size (unchanged if not an IGDB URL)
 */
export function getHighResIGDBUrl(url: string, size: 't_1080p' | 't_screenshot_huge' = 't_1080p'): string {
  // Only modify URLs that are actually from IGDB (strict hostname check)
  if (!isFromDomain(url, 'images.igdb.com')) {
    return url;
  }

  // Replace the size parameter in IGDB URLs
  // Pattern: https://images.igdb.com/igdb/image/upload/t_{size}/{id}.jpg
  return url.replace(IGDB_SIZE_PATTERN, `/${size}/`);
}

// ============================================================================
// Section Image Processing
// ============================================================================

/**
 * Configuration for section image processing.
 */
export interface SectionImageConfig {
  /** Maximum width for resizing (maintains aspect ratio) */
  readonly maxWidth: number;
  /** Quality for output (1-100) */
  readonly quality: number;
  /** Output format */
  readonly format: HeroImageFormat;
}

/**
 * Result of section image processing.
 */
export interface SectionImageResult {
  /** Processed image as buffer */
  readonly buffer: Buffer;
  /** MIME type */
  readonly mimeType: 'image/webp' | 'image/jpeg';
  /** Final width */
  readonly width: number;
  /** Final height */
  readonly height: number;
}

/**
 * Options for section image processing.
 */
export interface SectionImageOptions {
  /** Source image buffer */
  readonly buffer: Buffer;
  /** Optional custom config */
  readonly config?: Partial<SectionImageConfig>;
  /** Logger for debugging */
  readonly logger?: Logger;
}

const DEFAULT_SECTION_CONFIG: SectionImageConfig = {
  maxWidth: 800,
  quality: 85,
  format: 'webp',
};

/**
 * Processes a section image (resize if needed, convert to WebP).
 * Unlike hero images, section images keep their aspect ratio.
 *
 * @param options - Processing options
 * @returns Processed section image result with buffer
 */
export async function processSectionImage(options: SectionImageOptions): Promise<SectionImageResult> {
  const { buffer, config: customConfig, logger } = options;
  const config = { ...DEFAULT_SECTION_CONFIG, ...customConfig };

  // Get source metadata
  const metadata = await sharp(buffer).metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;

  logger?.debug(`[SectionImage] Source: ${sourceWidth}x${sourceHeight} ${metadata.format}`);

  // Only resize if larger than max width
  const needsResize = sourceWidth > config.maxWidth;
  
  let pipeline = sharp(buffer);
  
  if (needsResize) {
    pipeline = pipeline.resize(config.maxWidth, null, {
      fit: 'inside', // Maintain aspect ratio
      withoutEnlargement: true,
    });
  }

  // Apply output format
  let outputBuffer: Buffer;
  let finalWidth = needsResize ? config.maxWidth : sourceWidth;
  let finalHeight: number;
  
  if (config.format === 'webp') {
    outputBuffer = await pipeline.webp({ quality: config.quality }).toBuffer();
  } else {
    outputBuffer = await pipeline.jpeg({ quality: config.quality }).toBuffer();
  }

  // Get final dimensions
  const outputMeta = await sharp(outputBuffer).metadata();
  finalWidth = outputMeta.width ?? finalWidth;
  finalHeight = outputMeta.height ?? sourceHeight;

  logger?.debug(
    `[SectionImage] Processed ${outputBuffer.length} bytes, ${finalWidth}x${finalHeight}, format: ${config.format}`
  );

  return {
    buffer: outputBuffer,
    mimeType: FORMAT_MIME_TYPES[config.format],
    width: finalWidth,
    height: finalHeight,
  };
}
