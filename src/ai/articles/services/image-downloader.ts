/**
 * Image Downloader Service
 *
 * Consolidated image download logic with:
 * - SSRF protection (validates URLs before downloading)
 * - Magic byte validation (ensures downloaded content is actually an image)
 * - Size limits and timeouts
 * - Optional retry logic with exponential backoff
 *
 * This module is the single source of truth for downloading images from external URLs.
 */

import sharp from 'sharp';
import type { Logger } from '../../../utils/logger';
import { validateImageUrl, isSSRFError } from './url-validator';
import { IMAGE_DOWNLOADER_CONFIG } from '../config';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for dimension validation.
 */
export interface DimensionValidationOptions {
  /** Minimum width in pixels */
  readonly minWidth?: number;
  /** Minimum height in pixels */
  readonly minHeight?: number;
}

/**
 * Options for downloading an image.
 */
export interface ImageDownloadOptions {
  /** URL to download from */
  readonly url: string;
  /** Logger for debugging */
  readonly logger?: Logger;
  /** Timeout in milliseconds (default: from config) */
  readonly timeoutMs?: number;
  /** Maximum file size in bytes (default: from config) */
  readonly maxSizeBytes?: number;
  /** Whether to perform HEAD request first to check size (default: true) */
  readonly checkSizeFirst?: boolean;
  /** AbortSignal for cancellation support */
  readonly signal?: AbortSignal;
  /**
   * Optional dimension validation. If provided, validates image dimensions
   * after download using Sharp. Throws if image is smaller than specified minimums.
   */
  readonly validateDimensions?: DimensionValidationOptions;
}

/**
 * Result of a successful image download.
 */
export interface ImageDownloadResult {
  /** Downloaded image as buffer */
  readonly buffer: Buffer;
  /** Detected MIME type */
  readonly mimeType: string;
  /** Size in bytes */
  readonly size: number;
}

/**
 * Options for download with retry.
 */
export interface ImageDownloadWithRetryOptions extends ImageDownloadOptions {
  /** Maximum retry attempts (default: 3) */
  readonly maxRetries?: number;
  /** Initial delay before first retry in ms (default: 1000) */
  readonly initialDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  readonly backoffMultiplier?: number;
}

// ============================================================================
// Pre-download Validation
// ============================================================================

/**
 * Performs a HEAD request to check image size before downloading.
 * This saves bandwidth by rejecting large images early.
 *
 * Security: Uses redirect: 'manual' and validates redirect targets to prevent
 * SSRF attacks where the initial URL is safe but redirects to a blocked address.
 *
 * @param url - URL to check
 * @param maxSizeBytes - Maximum allowed size
 * @param logger - Optional logger
 * @param signal - Optional AbortSignal for timeout/cancellation
 * @returns Content-Length if available, null if HEAD not supported
 * @throws Error if size exceeds limit or redirect target is blocked
 */
async function checkImageSizeWithHead(
  url: string,
  maxSizeBytes: number,
  logger?: Logger,
  signal?: AbortSignal
): Promise<number | null> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': IMAGE_DOWNLOADER_CONFIG.USER_AGENT,
      },
      redirect: 'manual', // Handle redirects manually to validate targets
      signal,
    });

    // If redirected, validate the target before following
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        // Resolve relative URLs
        const redirectUrl = new URL(location, url).href;
        // Validate redirect target using the same SSRF protection as main download
        await validateImageUrl(redirectUrl);
        logger?.debug(`[ImageDownloader] HEAD redirect validated: ${redirectUrl}`);
      }
      // Let the actual GET handle the redirect (it also validates)
      return null;
    }

    if (!response.ok) {
      // HEAD not supported or failed, continue with GET
      return null;
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (size > maxSizeBytes) {
        throw new Error(`Image too large: ${size} bytes (max: ${maxSizeBytes}) - rejected before download`);
      }
      logger?.debug(`[ImageDownloader] HEAD check passed: ${size} bytes`);
      return size;
    }

    return null;
  } catch (error) {
    // If it's our size error or SSRF error, re-throw it
    if (error instanceof Error && (error.message.includes('too large') || isSSRFError(error))) {
      throw error;
    }
    // Otherwise HEAD failed, continue with GET
    return null;
  }
}

// ============================================================================
// Magic Byte Validation
// ============================================================================

/**
 * Image format signatures (magic bytes).
 */
const IMAGE_SIGNATURES = {
  JPEG: [0xff, 0xd8, 0xff],
  PNG: [0x89, 0x50, 0x4e, 0x47],
  GIF: [0x47, 0x49, 0x46, 0x38],
  WEBP_RIFF: [0x52, 0x49, 0x46, 0x46],
  WEBP_WEBP: [0x57, 0x45, 0x42, 0x50],
} as const;

/**
 * Validates that a buffer contains a valid image by checking magic bytes.
 *
 * @param buffer - Buffer to validate
 * @returns Object with validation result and detected MIME type
 */
function validateImageBuffer(buffer: Buffer): { valid: boolean; mimeType?: string } {
  if (buffer.length < 12) {
    return { valid: false };
  }

  // JPEG: FF D8 FF
  if (
    buffer[0] === IMAGE_SIGNATURES.JPEG[0] &&
    buffer[1] === IMAGE_SIGNATURES.JPEG[1] &&
    buffer[2] === IMAGE_SIGNATURES.JPEG[2]
  ) {
    return { valid: true, mimeType: 'image/jpeg' };
  }

  // PNG: 89 50 4E 47
  if (
    buffer[0] === IMAGE_SIGNATURES.PNG[0] &&
    buffer[1] === IMAGE_SIGNATURES.PNG[1] &&
    buffer[2] === IMAGE_SIGNATURES.PNG[2] &&
    buffer[3] === IMAGE_SIGNATURES.PNG[3]
  ) {
    return { valid: true, mimeType: 'image/png' };
  }

  // GIF: 47 49 46 38
  if (
    buffer[0] === IMAGE_SIGNATURES.GIF[0] &&
    buffer[1] === IMAGE_SIGNATURES.GIF[1] &&
    buffer[2] === IMAGE_SIGNATURES.GIF[2] &&
    buffer[3] === IMAGE_SIGNATURES.GIF[3]
  ) {
    return { valid: true, mimeType: 'image/gif' };
  }

  // WebP: RIFF....WEBP
  if (
    buffer[0] === IMAGE_SIGNATURES.WEBP_RIFF[0] &&
    buffer[1] === IMAGE_SIGNATURES.WEBP_RIFF[1] &&
    buffer[2] === IMAGE_SIGNATURES.WEBP_RIFF[2] &&
    buffer[3] === IMAGE_SIGNATURES.WEBP_RIFF[3] &&
    buffer[8] === IMAGE_SIGNATURES.WEBP_WEBP[0] &&
    buffer[9] === IMAGE_SIGNATURES.WEBP_WEBP[1] &&
    buffer[10] === IMAGE_SIGNATURES.WEBP_WEBP[2] &&
    buffer[11] === IMAGE_SIGNATURES.WEBP_WEBP[3]
  ) {
    return { valid: true, mimeType: 'image/webp' };
  }

  return { valid: false };
}

// ============================================================================
// Download Functions
// ============================================================================

/** Maximum number of redirects to follow */
const MAX_REDIRECTS = 5;

/**
 * Downloads an image from a URL with SSRF protection and validation.
 *
 * Security features:
 * - Validates initial URL against SSRF attacks
 * - Uses manual redirect handling to validate each redirect URL
 * - Limits redirect chain to prevent infinite loops
 *
 * @param options - Download options
 * @returns Downloaded image buffer and metadata
 * @throws SSRFError if URL fails security validation
 * @throws Error if download fails, times out, or content is not a valid image
 */
export async function downloadImage(options: ImageDownloadOptions): Promise<ImageDownloadResult> {
  const {
    url,
    logger,
    timeoutMs = IMAGE_DOWNLOADER_CONFIG.TIMEOUT_MS,
    maxSizeBytes = IMAGE_DOWNLOADER_CONFIG.MAX_SIZE_BYTES,
    checkSizeFirst = true,
    signal: externalSignal,
    validateDimensions,
  } = options;

  // Check if already aborted
  if (externalSignal?.aborted) {
    throw new Error('Download aborted');
  }

  // SSRF protection - validate initial URL before downloading
  validateImageUrl(url);

  // Optional: Check size with HEAD request before downloading (saves bandwidth)
  // Pass signal to HEAD request so it can be cancelled and validates redirects
  if (checkSizeFirst) {
    await checkImageSizeWithHead(url, maxSizeBytes, logger, externalSignal);
  }

  // Create internal controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // If external signal is provided, abort our controller when it aborts
  const externalAbortHandler = () => controller.abort();
  externalSignal?.addEventListener('abort', externalAbortHandler);

  try {
    logger?.debug(`[ImageDownloader] Downloading: ${url}`);

    // Follow redirects manually to validate each redirect URL for SSRF
    let currentUrl = url;
    let response: Response;
    let redirectCount = 0;

    while (true) {
      response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: 'manual', // Handle redirects manually for SSRF protection
        headers: {
          'User-Agent': IMAGE_DOWNLOADER_CONFIG.USER_AGENT,
          'Accept': 'image/*',
        },
      });

      // Check for redirects (3xx status codes)
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`Redirect (${response.status}) without Location header`);
        }

        // Resolve relative URLs
        const redirectUrl = new URL(location, currentUrl).toString();

        // Validate redirect URL for SSRF
        validateImageUrl(redirectUrl);

        redirectCount++;
        if (redirectCount > MAX_REDIRECTS) {
          throw new Error(`Too many redirects (max: ${MAX_REDIRECTS})`);
        }

        logger?.debug(`[ImageDownloader] Following redirect ${redirectCount}: ${redirectUrl}`);
        currentUrl = redirectUrl;
        continue;
      }

      // Not a redirect, break out of loop
      break;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Check size from Content-Length header
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const declaredSize = parseInt(contentLength, 10);
      if (declaredSize > maxSizeBytes) {
        throw new Error(`Image too large: ${declaredSize} bytes (max: ${maxSizeBytes})`);
      }
    }

    // Download the content
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Verify actual size
    if (buffer.length > maxSizeBytes) {
      throw new Error(`Image too large: ${buffer.length} bytes (max: ${maxSizeBytes})`);
    }

    // Validate magic bytes to ensure it's actually an image
    const validation = validateImageBuffer(buffer);
    if (!validation.valid) {
      throw new Error('Downloaded content is not a valid image (invalid magic bytes)');
    }

    logger?.debug(
      `[ImageDownloader] Downloaded ${buffer.length} bytes, type: ${validation.mimeType}`
    );

    // Optional dimension validation using Sharp
    if (validateDimensions) {
      const { minWidth, minHeight } = validateDimensions;
      const metadata = await sharp(buffer).metadata();
      
      if (minWidth && metadata.width && metadata.width < minWidth) {
        throw new Error(`Image too narrow: ${metadata.width}px (min: ${minWidth}px)`);
      }
      if (minHeight && metadata.height && metadata.height < minHeight) {
        throw new Error(`Image too short: ${metadata.height}px (min: ${minHeight}px)`);
      }
      
      logger?.debug(
        `[ImageDownloader] Dimension validation passed: ${metadata.width}x${metadata.height}`
      );
    }

    return {
      buffer,
      mimeType: validation.mimeType!,
      size: buffer.length,
    };
  } catch (error) {
    // Re-throw abort errors with clearer message
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Download timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', externalAbortHandler);
  }
}

/**
 * Determines if an error is retryable (network issues, not validation errors).
 */
function isRetryableDownloadError(error: unknown): boolean {
  // Never retry SSRF errors
  if (isSSRFError(error)) {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  // Don't retry validation errors
  if (
    message.includes('too large') ||
    message.includes('not a valid image') ||
    message.includes('invalid magic bytes')
  ) {
    return false;
  }

  // Retry network errors
  if (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('etimedout') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('socket hang up') ||
    message.includes('fetch failed')
  ) {
    return true;
  }

  // Retry server errors (5xx)
  if (
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504')
  ) {
    return true;
  }

  return false;
}

/**
 * Sleeps for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Downloads an image with automatic retry on transient failures.
 *
 * @param options - Download options with retry configuration
 * @returns Downloaded image buffer and metadata
 */
export async function downloadImageWithRetry(
  options: ImageDownloadWithRetryOptions
): Promise<ImageDownloadResult> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    backoffMultiplier = 2,
    logger,
    ...downloadOptions
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await downloadImage({ ...downloadOptions, logger });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry non-retryable errors
      if (!isRetryableDownloadError(error)) {
        throw lastError;
      }

      // Don't wait after the last attempt
      if (attempt < maxRetries) {
        logger?.debug(
          `[ImageDownloader] Attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms: ${lastError.message}`
        );
        await sleep(delay);
        delay = Math.min(delay * backoffMultiplier, 30000); // Cap at 30 seconds
      }
    }
  }

  throw lastError ?? new Error('Download failed after retries');
}
