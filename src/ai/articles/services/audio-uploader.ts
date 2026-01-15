/**
 * Audio Uploader Service
 *
 * Uploads audio files to Strapi's media library.
 * Handles buffer uploads for TTS-generated audio.
 *
 * Features:
 * - Upload audio buffer to Strapi media library
 * - Automatic S3 upload via Strapi's upload plugin
 * - Store TTS metadata (voice, model)
 * - Organize in folders (/audio/{gameSlug}/{articleSlug}/)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Core } from '@strapi/strapi';

import type { AudioUploadResult, AudioChapter, TimestampType, WordAlignment, CharacterAlignment } from './tts-types';
import { ensureFolderExists, linkFileToFolder } from './folder-service';

// ============================================================================
// Types
// ============================================================================

/**
 * TTS metadata stored in Strapi's provider_metadata.ttsInfo field.
 * Allows tracking of TTS generation details.
 */
export interface TTSMetadata {
  /** TTS provider (e.g., "inworld") */
  readonly ttsProvider: string;
  /** Voice ID used (e.g., "Dennis") */
  readonly voice: string;
  /** Model ID used (e.g., "inworld-tts-1-max") */
  readonly model: string;
  /** Generation timestamp */
  readonly generatedAt: string;
  /** Chapter markers for H2 sections (if available) */
  readonly chapters?: readonly AudioChapter[];
  /** Total audio duration in seconds (if available) */
  readonly audioDurationSeconds?: number;
  /** Timestamp type used for generation (WORD, CHARACTER, or UNSPECIFIED) */
  readonly timestampType?: TimestampType;
  /** Full word alignment data (for word highlighting, etc.) */
  readonly wordAlignment?: WordAlignment;
  /** Full character alignment data (for karaoke-style captions, lipsync) */
  readonly characterAlignment?: CharacterAlignment;
}

/**
 * Input for uploading audio to Strapi.
 */
export interface AudioUploadInput {
  /** Audio data as buffer (MP3 format) */
  readonly buffer: Buffer;
  /** Filename for the uploaded audio (without extension) */
  readonly filename: string;
  /** Game slug for folder organization */
  readonly gameSlug: string;
  /** Article title for metadata */
  readonly articleTitle: string;
  /** Voice ID used for generation */
  readonly voice?: string;
  /** Model ID used for generation */
  readonly model?: string;
  /** Chapter markers for H2 sections (if available) */
  readonly chapters?: readonly AudioChapter[];
  /** Total audio duration in seconds (if available) */
  readonly audioDurationSeconds?: number;
  /** Timestamp type used for generation */
  readonly timestampType?: TimestampType;
  /** Full word alignment data (optional, for advanced features) */
  readonly wordAlignment?: WordAlignment;
  /** Full character alignment data (optional, for advanced features) */
  readonly characterAlignment?: CharacterAlignment;
  /** Strapi instance */
  readonly strapi: Core.Strapi;
}

// ============================================================================
// Constants
// ============================================================================

/** MIME type for MP3 audio */
const AUDIO_MIME_TYPE = 'audio/mpeg';

/** File extension for MP3 */
const AUDIO_EXTENSION = 'mp3';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sanitizes a filename for use in Strapi.
 * Removes special characters and limits length.
 *
 * @param filename - Filename to sanitize
 * @returns Sanitized filename
 */
function sanitizeFilename(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

/**
 * Formats seconds as WebVTT timestamp (HH:MM:SS.mmm).
 *
 * @param seconds - Time in seconds
 * @returns Formatted timestamp
 */
function formatWebVTTTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

/**
 * Generates WebVTT chapter file content from chapter markers.
 *
 * @param chapters - Array of chapter markers
 * @returns WebVTT file content as string
 *
 * @example
 * const vtt = generateWebVTTChapters([
 *   { title: 'Introduction', startTime: 0, endTime: 30 },
 *   { title: 'Main Content', startTime: 30, endTime: 120 },
 * ]);
 * // Returns:
 * // WEBVTT
 * //
 * // Chapter 1
 * // 00:00:00.000 --> 00:00:30.000
 * // Introduction
 * // ...
 */
function generateWebVTTChapters(chapters: readonly AudioChapter[]): string {
  const lines: string[] = ['WEBVTT', ''];

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const endTime = chapter.endTime ?? (chapters[i + 1]?.startTime || chapter.startTime + 60);

    lines.push(`Chapter ${i + 1}`);
    lines.push(`${formatWebVTTTimestamp(chapter.startTime)} --> ${formatWebVTTTimestamp(endTime)}`);
    lines.push(chapter.title);
    lines.push(''); // Empty line between chapters
  }

  return lines.join('\n');
}

// ============================================================================
// Upload Functions
// ============================================================================

/**
 * Uploads audio buffer to Strapi's media library.
 *
 * The audio is organized in folders: /audio/{gameSlug}/{articleSlug}/
 * TTS metadata is stored in provider_metadata for tracking.
 *
 * @param input - Upload input with buffer, metadata, and folder info
 * @returns Upload result with Strapi media ID and CDN URL
 *
 * @example
 * const result = await uploadAudioToStrapi({
 *   buffer: audioBuffer,
 *   filename: 'elden-ring-beginner-guide-audio',
 *   gameSlug: 'elden-ring',
 *   articleTitle: 'Elden Ring Beginner Guide',
 *   voice: 'Dennis',
 *   model: 'inworld-tts-1-max',
 *   strapi,
 * });
 *
 * console.log(`Audio uploaded: ${result.url}`);
 */
export async function uploadAudioToStrapi(
  input: AudioUploadInput
): Promise<AudioUploadResult> {
  const { buffer, filename, gameSlug, articleTitle, voice, model, strapi } = input;

  const sanitizedFilename = sanitizeFilename(filename);
  const fullFilename = `${sanitizedFilename}.${AUDIO_EXTENSION}`;

  strapi.log.info(`[AudioUploader] Uploading: ${fullFilename} (${buffer.length} bytes)`);

  // Create folder structure: /audio/{gameSlug}/{articleSlug}/
  const articleSlug = sanitizeFilename(articleTitle);
  const folderPath = `/audio/${gameSlug}/${articleSlug}`;

  let folderId: number | undefined;
  try {
    folderId = await ensureFolderExists(
      {
        strapi,
        logger: {
          info: (msg: string) => strapi.log.info(msg),
          warn: (msg: string) => strapi.log.warn(msg),
          error: (msg: string) => strapi.log.error(msg),
          debug: (msg: string) => strapi.log.debug(msg),
        },
      },
      folderPath
    );
  } catch (error) {
    // Non-fatal: continue without folder organization
    const errorMsg = error instanceof Error ? error.message : String(error);
    strapi.log.warn(`[AudioUploader] Failed to create folder: ${errorMsg}`);
  }

  // Use Strapi's upload service
  const uploadService = strapi.plugin('upload').service('upload');

  // Write buffer to temporary file
  // Strapi's upload service expects a file path, not a buffer
  const tmpDir = os.tmpdir();
  const tmpFilePath = path.join(tmpDir, `strapi-audio-upload-${Date.now()}-${fullFilename}`);

  try {
    await fs.promises.writeFile(tmpFilePath, buffer);

    // Create file object for Strapi upload service
    // Uses koa-body 6.x properties (Strapi 5)
    const file = {
      filepath: tmpFilePath,
      originalFilename: fullFilename,
      mimetype: AUDIO_MIME_TYPE,
      size: buffer.length,
    };

    // Upload using Strapi's internal upload mechanism
    const [uploadedFile] = await uploadService.upload({
      data: {},
      files: file,
    });

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

    // Update file metadata (alternativeText, caption)
    const altText = `Audio narration for ${articleTitle}`;
    const caption = voice && model
      ? `Generated using Inworld AI TTS (Voice: ${voice}, Model: ${model})`
      : 'Generated using Inworld AI TTS';

    await strapi.plugin('upload').service('upload').updateFileInfo(uploadedFile.id, {
      alternativeText: altText,
      caption: caption,
    });

    // Store TTS metadata in provider_metadata for tracking
    // Uses nested 'ttsInfo' to avoid conflicts with S3 provider metadata
    if (voice && model) {
      try {
        const existingMetadata = uploadedFile.provider_metadata ?? {};
        const ttsMetadata: TTSMetadata = {
          ttsProvider: 'inworld',
          voice,
          model,
          generatedAt: new Date().toISOString(),
          ...(input.chapters && { chapters: input.chapters }),
          ...(input.audioDurationSeconds !== undefined && { audioDurationSeconds: input.audioDurationSeconds }),
          ...(input.timestampType && { timestampType: input.timestampType }),
          ...(input.wordAlignment && { wordAlignment: input.wordAlignment }),
          ...(input.characterAlignment && { characterAlignment: input.characterAlignment }),
        };

        await strapi.db.query('plugin::upload.file').update({
          where: { id: uploadedFile.id },
          data: {
            provider_metadata: {
              ...existingMetadata,
              ttsInfo: ttsMetadata,
            },
          },
        });

        strapi.log.debug(`[AudioUploader] Stored TTS metadata: ${voice} / ${model}`);
      } catch (error) {
        // Log but don't fail - file is already uploaded
        const errorMsg = error instanceof Error ? error.message : String(error);
        strapi.log.warn(`[AudioUploader] Failed to store TTS metadata: ${errorMsg}`);
      }
    }

    // Link file to folder if folder was created
    if (folderId) {
      try {
        await linkFileToFolder(
          {
            strapi,
            logger: {
              info: (msg: string) => strapi.log.info(msg),
              warn: (msg: string) => strapi.log.warn(msg),
              error: (msg: string) => strapi.log.error(msg),
              debug: (msg: string) => strapi.log.debug(msg),
            },
          },
          uploadedFile.id,
          folderId,
          folderPath
        );
      } catch (error) {
        // Log but don't fail - file is already uploaded
        const errorMsg = error instanceof Error ? error.message : String(error);
        strapi.log.warn(`[AudioUploader] Failed to link file to folder: ${errorMsg}`);
      }
    }

    strapi.log.info(`[AudioUploader] Uploaded successfully: ${uploadedFile.url}`);

    // Generate and upload WebVTT chapter file if chapters exist
    let chapterFileId: number | undefined;
    if (input.chapters && input.chapters.length > 0) {
      try {
        const vttContent = generateWebVTTChapters(input.chapters);
        const vttBuffer = Buffer.from(vttContent, 'utf-8');
        const vttFilename = `${sanitizedFilename}-chapters.vtt`;
        const vttTmpFilePath = path.join(tmpDir, `strapi-vtt-upload-${Date.now()}-${vttFilename}`);

        await fs.promises.writeFile(vttTmpFilePath, vttBuffer);

        const vttFile = {
          filepath: vttTmpFilePath,
          originalFilename: vttFilename,
          mimetype: 'text/vtt',
          size: vttBuffer.length,
        };

        const [uploadedVttFile] = await uploadService.upload({
          data: {},
          files: vttFile,
        });

        // Clean up VTT temp file
        await fs.promises.unlink(vttTmpFilePath).catch(() => {});

        if (uploadedVttFile) {
          chapterFileId = uploadedVttFile.id;

          if (folderId) {
            // Update VTT file metadata
            await strapi.plugin('upload').service('upload').updateFileInfo(uploadedVttFile.id, {
              alternativeText: `Chapter markers for ${articleTitle}`,
              caption: `WebVTT chapter file for audio narration`,
            });

            // Link VTT file to same folder as audio
            await linkFileToFolder(
              {
                strapi,
                logger: {
                  info: (msg: string) => strapi.log.info(msg),
                  warn: (msg: string) => strapi.log.warn(msg),
                  error: (msg: string) => strapi.log.error(msg),
                  debug: (msg: string) => strapi.log.debug(msg),
                },
              },
              uploadedVttFile.id,
              folderId,
              folderPath
            );
          }

          strapi.log.info(`[AudioUploader] WebVTT chapter file uploaded: ${uploadedVttFile.url}`);
        }
      } catch (error) {
        // Non-fatal: log warning but don't fail audio upload
        const errorMsg = error instanceof Error ? error.message : String(error);
        strapi.log.warn(`[AudioUploader] Failed to upload WebVTT chapter file: ${errorMsg}`);
      }
    }

    return {
      id: uploadedFile.id,
      documentId: uploadedFile.documentId ?? String(uploadedFile.id),
      url: uploadedFile.url,
      ...(chapterFileId && { chapterFileId }),
    };
  } finally {
    // Clean up temp file regardless of success or failure
    await fs.promises.unlink(tmpFilePath).catch(() => {
      // Ignore cleanup errors
    });
  }
}
