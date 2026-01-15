/**
 * Article Audio Generator Service
 *
 * High-level service for generating audio from article content.
 * Combines TTS generation and Strapi upload into a single reusable function.
 *
 * Use this service from:
 * - Article generator controller
 * - Lifecycle hooks (e.g., regenerate audio on update)
 * - Admin endpoints (e.g., regenerate audio for existing articles)
 */

import type { Core } from '@strapi/strapi';

import { generateAudioFromMarkdown } from './tts-generator';
import { uploadAudioToStrapi } from './audio-uploader';
import type { AudioUploadResult, TTSConfig, TimestampType } from './tts-types';
import { TTS_CONFIG } from '../config';
import type { DocumentService, PostDocument } from '../../../types/strapi';

// ============================================================================
// Types
// ============================================================================

/**
 * Input for generating audio from article content.
 */
export interface GenerateArticleAudioInput {
  /** Article markdown content (without images) */
  readonly markdown: string;
  /** Article title (for metadata and logging) */
  readonly articleTitle: string;
  /** Game slug (for folder organization) */
  readonly gameSlug: string;
  /** Article slug (for filename generation) */
  readonly articleSlug: string;
  /** Optional TTS configuration (voice, model) */
  readonly ttsConfig?: TTSConfig;
  /** Strapi instance for upload */
  readonly strapi: Core.Strapi;
}

/**
 * Result from generating and uploading article audio.
 */
export interface GenerateArticleAudioResult {
  /** Strapi media file ID */
  readonly id: number;
  /** Strapi media document ID */
  readonly documentId: string;
  /** Public CDN URL to the audio file */
  readonly url: string;
  /** Generation duration in milliseconds */
  readonly durationMs: number;
  /** Number of chunks processed */
  readonly chunkCount: number;
  /** Chapter file ID (if chapters were generated) */
  readonly chapterFileId?: number;
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Generates audio from article markdown and uploads to Strapi.
 *
 * This is a high-level convenience function that combines:
 * 1. TTS generation (markdown → audio buffer)
 * 2. Upload to Strapi media library → S3 → CDN
 *
 * **Non-fatal errors**: Returns null on failure (audio is optional).
 * Errors are logged but don't throw exceptions.
 *
 * @param input - Article content and metadata
 * @returns Audio upload result, or null if generation/upload failed
 *
 * @example
 * // Generate audio for a new article
 * const audioResult = await generateAndUploadArticleAudio({
 *   markdown: draft.markdownWithoutImages,
 *   articleTitle: draft.title,
 *   gameSlug: game.slug,
 *   articleSlug: slugify(draft.title),
 *   strapi,
 * });
 *
 * if (audioResult) {
 *   console.log(`Audio uploaded: ${audioResult.url}`);
 *   // Save audioResult.id to post.audioFile
 * }
 *
 * @example
 * // Regenerate audio with custom voice
 * const audioResult = await generateAndUploadArticleAudio({
 *   markdown: post.content,
 *   articleTitle: post.title,
 *   gameSlug: 'elden-ring',
 *   articleSlug: post.slug,
 *   ttsConfig: {
 *     voice: 'Ashley',
 *     model: 'inworld-tts-1-max',
 *   },
 *   strapi,
 * });
 */
export async function generateAndUploadArticleAudio(
  input: GenerateArticleAudioInput
): Promise<GenerateArticleAudioResult | null> {
  const { markdown, articleTitle, gameSlug, articleSlug, ttsConfig, strapi } = input;

  // Check if TTS is enabled
  if (!TTS_CONFIG.ENABLED) {
    strapi.log.info('[ArticleAudioGen] TTS is disabled, skipping audio generation');
    return null;
  }

  // Validate markdown is not empty
  if (!markdown || markdown.trim().length === 0) {
    strapi.log.warn(`[ArticleAudioGen] Empty markdown provided for "${articleTitle}"`);
    return null;
  }

  try {
    // Step 1: Generate audio from markdown
    strapi.log.info(`[ArticleAudioGen] Generating audio for "${articleTitle}"...`);

    const audioResult = await generateAudioFromMarkdown(markdown, {
      voice: ttsConfig?.voice || TTS_CONFIG.DEFAULT_VOICE_ID,
      model: ttsConfig?.model || TTS_CONFIG.DEFAULT_MODEL_ID,
      timestampType: ttsConfig?.timestampType || TTS_CONFIG.DEFAULT_TIMESTAMP_TYPE,
      apiKey: ttsConfig?.apiKey,
      strapi,
    });

    if (!audioResult) {
      strapi.log.warn(`[ArticleAudioGen] Audio generation returned null for "${articleTitle}"`);
      return null;
    }

    strapi.log.info(
      `[ArticleAudioGen] Audio generated: ${audioResult.chunkCount} chunks in ${audioResult.durationMs}ms`
    );

    // Step 2: Upload to Strapi media library
    const uploadResult = await uploadAudioToStrapi({
      buffer: audioResult.buffer,
      filename: `${articleSlug}-audio`,
      gameSlug,
      articleSlug,
      articleTitle,
      voice: ttsConfig?.voice || TTS_CONFIG.DEFAULT_VOICE_ID,
      model: ttsConfig?.model || TTS_CONFIG.DEFAULT_MODEL_ID,
      chapters: audioResult.chapters,
      audioDurationSeconds: audioResult.audioDurationSeconds,
      timestampType: audioResult.timestampType,
      wordAlignment: audioResult.wordAlignment,
      characterAlignment: audioResult.characterAlignment,
      strapi,
    });

    strapi.log.info(`[ArticleAudioGen] Audio uploaded: ${uploadResult.url}`);

    return {
      id: uploadResult.id,
      documentId: uploadResult.documentId,
      url: uploadResult.url,
      durationMs: audioResult.durationMs,
      chunkCount: audioResult.chunkCount,
      ...(uploadResult.chapterFileId && { chapterFileId: uploadResult.chapterFileId }),
    };
  } catch (error) {
    // Non-fatal: log and return null (audio is optional)
    const errorMsg = error instanceof Error ? error.message : String(error);
    strapi.log.warn(`[ArticleAudioGen] Failed to generate audio for "${articleTitle}": ${errorMsg}`);
    return null;
  }
}

/**
 * Post document with populated games relation.
 * Used for type safety when accessing post properties.
 */
interface PostWithGames extends PostDocument {
  games?: ReadonlyArray<{
    readonly slug?: string | null;
  }> | null;
}

/**
 * Generates audio for an existing article by its document ID.
 *
 * Fetches the article from the database, generates audio, and updates the audioFile field.
 * Useful for regenerating audio for existing articles or batch processing.
 *
 * @param strapi - Strapi instance
 * @param postDocumentId - Document ID of the post
 * @param locale - Locale of the post (default: 'en')
 * @param ttsConfig - Optional TTS configuration
 * @returns Audio upload result, or null if generation/upload failed
 *
 * @example
 * // Regenerate audio for a specific post
 * const result = await generateAudioForExistingArticle(
 *   strapi,
 *   'abc123',
 *   'en',
 *   { voice: 'Ashley' }
 * );
 */
export async function generateAudioForExistingArticle(
  strapi: Core.Strapi,
  postDocumentId: string,
  locale: string = 'en',
  ttsConfig?: TTSConfig
): Promise<GenerateArticleAudioResult | null> {
  try {
    // Fetch the post
    const postService = strapi.documents('api::post.post') as DocumentService<PostWithGames>;
    const post = await postService.findOne({
      documentId: postDocumentId,
      locale,
      populate: ['games'],
    });

    if (!post) {
      strapi.log.error(`[ArticleAudioGen] Post not found: ${postDocumentId}`);
      return null;
    }

    // Extract game slug (use first game)
    const gameSlug = post.games?.[0]?.slug || 'unknown';

    // Generate audio
    const audioResult = await generateAndUploadArticleAudio({
      markdown: post.content || '',
      articleTitle: post.title || 'Untitled',
      gameSlug,
      articleSlug: post.slug || 'untitled',
      ttsConfig,
      strapi,
    });

    if (!audioResult) {
      return null;
    }

    // Update post with audio file and chapter file if available
    await postService.update({
      documentId: postDocumentId,
      locale,
      data: {
        audioFile: audioResult.id,
        ...(audioResult.chapterFileId && {
          chapterFile: audioResult.chapterFileId,
        }),
      },
    });

    strapi.log.info(`[ArticleAudioGen] Updated post ${postDocumentId} with audio file`);

    return audioResult;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    strapi.log.error(`[ArticleAudioGen] Failed to generate audio for existing article: ${errorMsg}`);
    return null;
  }
}
