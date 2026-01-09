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
import { linkFileToFolder } from './folder-service';

// ============================================================================
// Types
// ============================================================================

/**
 * Source metadata stored in Strapi's provider_metadata.imageAttribution field.
 * This allows the frontend to display attribution without embedding it in markdown.
 * 
 * Stored as: provider_metadata.imageAttribution = { sourceUrl, sourceDomain, imageSource }
 * This avoids conflicts with S3 provider metadata fields.
 */
export interface ImageSourceMetadata {
  /** Original URL where the image was found */
  readonly sourceUrl?: string;
  /** Domain for attribution display (e.g., "ign.com") */
  readonly sourceDomain?: string;
  /** Image source type */
  readonly imageSource?: 'igdb' | 'tavily' | 'exa' | 'web';
}

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
  /** Caption for the image (not attribution - use sourceMetadata for that) */
  readonly caption?: string;
  /** Source domain for attribution (deprecated - use sourceMetadata) */
  readonly sourceDomain?: string;
  /** Source metadata for attribution (stored in provider_metadata) */
  readonly sourceMetadata?: ImageSourceMetadata;
  /** Optional AbortSignal for cancellation */
  readonly signal?: AbortSignal;
  /** Optional folder ID to organize images in Strapi Media Library */
  readonly folderId?: number;
  /** Optional folder path (required if folderId provided) */
  readonly folderPath?: string;
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
  /** Caption for the image (not attribution - use sourceMetadata for that) */
  readonly caption?: string;
  /** Source metadata for attribution (stored in provider_metadata) */
  readonly sourceMetadata?: ImageSourceMetadata;
  /** Optional folder ID to organize images in Strapi Media Library */
  readonly folderId?: number;
  /** Optional folder path (required if folderId provided) */
  readonly folderPath?: string;
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
 * Source attribution is stored in provider_metadata, not in the caption.
 *
 * @param input - Upload input with URL, filename, and alt text
 * @param deps - Dependencies (Strapi instance, logger)
 * @returns Upload result with Strapi URL
 */
export async function uploadImageFromUrl(
  input: UrlUploadInput,
  deps: ImageUploaderDeps
): Promise<ImageUploadResult> {
  const { url, filename, altText, caption, sourceDomain, sourceMetadata, signal, folderId, folderPath } = input;
  const { logger } = deps;

  logger?.info(`[ImageUploader] Uploading from URL: ${url}`);

  // Download the image using consolidated downloader (with SSRF protection + retry)
  const downloadResult = await downloadImageWithRetry({
    url,
    logger,
    signal,
  });

  // Build source metadata for attribution (stored in provider_metadata, not caption)
  // If explicit sourceMetadata provided, use that; otherwise build from sourceDomain
  const finalSourceMetadata: ImageSourceMetadata | undefined = sourceMetadata ?? (sourceDomain ? {
    sourceUrl: url,
    sourceDomain,
    imageSource: 'web',
  } : undefined);

  // Upload to Strapi - caption is now purely for image description, not attribution
  return uploadImageBuffer(
    {
      buffer: downloadResult.buffer,
      filename,
      mimeType: downloadResult.mimeType,
      altText,
      caption,  // No longer includes "Source: domain" - that's in sourceMetadata
      sourceMetadata: finalSourceMetadata,
      folderId,
      folderPath,
    },
    deps
  );
}

/**
 * Uploads an image buffer to Strapi.
 *
 * Source attribution is stored in provider_metadata for frontend access,
 * keeping the caption field clean for actual image descriptions.
 *
 * @param input - Upload input with buffer, filename, and metadata
 * @param deps - Dependencies (Strapi instance, logger)
 * @returns Upload result with Strapi URL
 */
export async function uploadImageBuffer(
  input: BufferUploadInput,
  deps: ImageUploaderDeps
): Promise<ImageUploadResult> {
  const { buffer, filename, mimeType, altText, caption, sourceMetadata, folderId, folderPath } = input;
  const { strapi, logger } = deps;

  // Validate folder parameters: both or neither must be provided
  if ((folderId !== undefined && folderPath === undefined) || (folderId === undefined && folderPath !== undefined)) {
    throw new Error('Both folderId and folderPath must be provided together, or neither');
  }

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
      filepath: tmpFilePath,
      originalFilename: fullFilename,
      mimetype: mimeType,
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
    
    // Store source attribution in provider_metadata for frontend use
    // This keeps attribution separate from caption, allowing flexible frontend display
    // Uses nested 'imageAttribution' to avoid conflicts with S3 provider metadata
    if (uploadedFile && sourceMetadata) {
      try {
        // Get existing provider_metadata (from S3 provider) and merge with our source info
        const existingMetadata = uploadedFile.provider_metadata ?? {};
        await strapi.db.query('plugin::upload.file').update({
          where: { id: uploadedFile.id },
          data: {
            provider_metadata: {
              ...existingMetadata,
              // Namespaced under imageAttribution to avoid S3 provider conflicts
              imageAttribution: {
                sourceUrl: sourceMetadata.sourceUrl,
                sourceDomain: sourceMetadata.sourceDomain,
                imageSource: sourceMetadata.imageSource,
              },
            },
          },
        });
        logger?.debug(`[ImageUploader] Stored source metadata: ${sourceMetadata.sourceDomain}`);
      } catch (error) {
        // Log but don't fail the upload - file is already uploaded successfully
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger?.warn(`[ImageUploader] Failed to store source metadata: ${errorMsg}`);
        // Continue - upload succeeded, just metadata update failed
      }
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

    // Link file to folder if folder specified
    if (folderId && folderPath) {
      try {
        await linkFileToFolder(deps, uploadedFile.id, folderId, folderPath);
      } catch (error) {
        // Log but don't fail - file is already uploaded
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger?.warn(`[ImageUploader] Failed to link file to folder: ${errorMsg}`);
      }
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
