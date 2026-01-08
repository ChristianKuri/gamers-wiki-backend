/**
 * Image Uploader Service
 *
 * Uploads images to Strapi's media library.
 * Handles both URL-based downloads and buffer uploads.
 *
 * Features:
 * - Download images from external URLs (via consolidated downloader with SSRF protection)
 * - Upload to Strapi media library
 * - Store attribution metadata
 * - Return Strapi media URLs for embedding in markdown
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Core } from '@strapi/strapi';
import type { Logger } from '../../../utils/logger';
import { downloadImageWithRetry } from './image-downloader';

// ============================================================================
// Types
// ============================================================================

/**
 * Input for uploading an image from a URL.
 */
export interface UrlUploadInput {
  /** External URL to download image from */
  readonly url: string;
  /** Filename for the uploaded image (without extension) */
  readonly filename: string;
  /** Alt text for the image */
  readonly altText: string;
  /** Attribution/caption text */
  readonly caption?: string;
  /** Source domain for attribution */
  readonly sourceDomain?: string;
  /** Optional AbortSignal for cancellation */
  readonly signal?: AbortSignal;
}

/**
 * Input for uploading an image from a buffer.
 */
export interface BufferUploadInput {
  /** Image data as buffer */
  readonly buffer: Buffer;
  /** Filename for the uploaded image (without extension) */
  readonly filename: string;
  /** MIME type of the image */
  readonly mimeType: string;
  /** Alt text for the image */
  readonly altText: string;
  /** Attribution/caption text */
  readonly caption?: string;
}

/**
 * Result of uploading an image.
 */
export interface ImageUploadResult {
  /** Strapi media ID */
  readonly id: number;
  /** Strapi document ID */
  readonly documentId: string;
  /** Public URL to the uploaded image */
  readonly url: string;
  /** Alt text */
  readonly altText: string;
  /** Caption if provided */
  readonly caption?: string;
  /** Image width */
  readonly width?: number;
  /** Image height */
  readonly height?: number;
}

/**
 * Dependencies for the image uploader.
 */
export interface ImageUploaderDeps {
  readonly strapi: Core.Strapi;
  readonly logger?: Logger;
}

// ============================================================================
// Constants
// ============================================================================

/** MIME type to extension mapping */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sanitizes a filename for use in Strapi.
 */
function sanitizeFilename(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

// ============================================================================
// Upload Functions
// ============================================================================

/**
 * Uploads an image from a URL to Strapi.
 *
 * Uses the consolidated image downloader with SSRF protection and retry logic.
 *
 * @param input - Upload input with URL, filename, and alt text
 * @param deps - Dependencies (Strapi instance, logger)
 * @returns Upload result with Strapi URL
 */
export async function uploadImageFromUrl(
  input: UrlUploadInput,
  deps: ImageUploaderDeps
): Promise<ImageUploadResult> {
  const { url, filename, altText, caption, sourceDomain, signal } = input;
  const { logger } = deps;

  logger?.info(`[ImageUploader] Uploading from URL: ${url}`);

  // Download the image using consolidated downloader (with SSRF protection + retry)
  const downloadResult = await downloadImageWithRetry({
    url,
    logger,
    signal,
  });

  // Build full caption with attribution
  let fullCaption = caption;
  if (sourceDomain && !caption?.includes(sourceDomain)) {
    fullCaption = caption ? `${caption} (Source: ${sourceDomain})` : `Source: ${sourceDomain}`;
  }

  // Upload to Strapi
  return uploadImageBuffer(
    {
      buffer: downloadResult.buffer,
      filename,
      mimeType: downloadResult.mimeType,
      altText,
      caption: fullCaption,
    },
    deps
  );
}

/**
 * Uploads an image buffer to Strapi.
 *
 * @param input - Upload input with buffer, filename, and metadata
 * @param deps - Dependencies (Strapi instance, logger)
 * @returns Upload result with Strapi URL
 */
export async function uploadImageBuffer(
  input: BufferUploadInput,
  deps: ImageUploaderDeps
): Promise<ImageUploadResult> {
  const { buffer, filename, mimeType, altText, caption } = input;
  const { strapi, logger } = deps;

  const sanitizedFilename = sanitizeFilename(filename);
  const extension = MIME_TO_EXT[mimeType] ?? 'jpg';
  const fullFilename = `${sanitizedFilename}.${extension}`;

  logger?.info(`[ImageUploader] Uploading buffer: ${fullFilename} (${buffer.length} bytes)`);

  // Use Strapi's upload service
  const uploadService = strapi.plugin('upload').service('upload');

  // Write buffer to temporary file
  // Strapi's upload service expects a file path, not a buffer or stream
  const tmpDir = os.tmpdir();
  const tmpFilePath = path.join(tmpDir, `strapi-upload-${Date.now()}-${fullFilename}`);
  
  try {
    await fs.promises.writeFile(tmpFilePath, buffer);
    
    // Create a file object that Strapi's upload service expects
    // As of Strapi 5 with koa-body 6.x, properties changed:
    // - path → filepath
    // - name → originalFilename (for the filename)
    // - type → mimetype (for the MIME type)
    // See: https://github.com/strapi/strapi/commit/bf35cde68f79ff3bfa0dfe30a3b92baa44a7c2a4
    const file = {
      filepath: tmpFilePath,       // NOT 'path' - changed in koa-body 6.x
      originalFilename: fullFilename,  // NOT 'name' - koa-body 6.x uses originalFilename
      mimetype: mimeType,          // NOT 'type' - koa-body 6.x uses mimetype
      size: buffer.length,
    };

    // Upload using Strapi's internal upload mechanism
    // data: {} is mandatory but must be empty per Strapi docs
    const [uploadedFile] = await uploadService.upload({
      data: {},
      files: file,
    });
    
    // Update file metadata after upload (alternativeText, caption)
    if (uploadedFile && (altText || caption)) {
      await strapi.plugin('upload').service('upload').updateFileInfo(uploadedFile.id, {
        alternativeText: altText,
        caption: caption ?? null,
      });
    }
    
    // Validate upload result
    if (!uploadedFile) {
      throw new Error('Upload service returned no file');
    }

    if (!uploadedFile.url) {
      throw new Error('Uploaded file missing URL');
    }

    if (typeof uploadedFile.id !== 'number') {
      throw new Error('Uploaded file missing valid ID');
    }

    logger?.info(`[ImageUploader] Uploaded successfully: ${uploadedFile.url}`);

    return {
      id: uploadedFile.id,
      documentId: uploadedFile.documentId ?? String(uploadedFile.id),
      url: uploadedFile.url,
      altText,
      caption,
      width: uploadedFile.width ?? undefined,
      height: uploadedFile.height ?? undefined,
    };
  } finally {
    // Clean up temp file regardless of success or failure
    await fs.promises.unlink(tmpFilePath).catch(() => {
      // Ignore cleanup errors
    });
  }
}

/**
 * Uploads multiple images from URLs in parallel with error handling.
 *
 * Uses Promise.allSettled to prevent one failure from stopping all uploads.
 *
 * @param inputs - Array of upload inputs
 * @param deps - Dependencies
 * @returns Array of results (successful uploads only)
 */
export async function uploadImagesFromUrls(
  inputs: readonly UrlUploadInput[],
  deps: ImageUploaderDeps
): Promise<readonly ImageUploadResult[]> {
  const { logger } = deps;

  // Upload all in parallel with Promise.allSettled
  const results = await Promise.allSettled(
    inputs.map((input) => uploadImageFromUrl(input, deps))
  );

  // Collect successful results
  const successfulUploads: ImageUploadResult[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      successfulUploads.push(result.value);
    } else {
      const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      logger?.warn(`[ImageUploader] Failed to upload "${inputs[i].url}": ${errorMsg}`);
    }
  }

  logger?.info(`[ImageUploader] Uploaded ${successfulUploads.length}/${inputs.length} images`);
  return successfulUploads;
}

/**
 * Creates a unique filename for an article image.
 *
 * @param articleTitle - Article title
 * @param section - Section name (for section images)
 * @param index - Image index
 * @returns Sanitized filename
 */
export function createImageFilename(
  articleTitle: string,
  section?: string,
  index?: number
): string {
  const base = sanitizeFilename(articleTitle);
  if (section) {
    const sectionSlug = sanitizeFilename(section);
    return index !== undefined ? `${base}-${sectionSlug}-${index}` : `${base}-${sectionSlug}`;
  }
  return index !== undefined ? `${base}-${index}` : base;
}
