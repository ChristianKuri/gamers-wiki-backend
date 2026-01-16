/**
 * TypeScript Types for TTS (Text-to-Speech) Service
 *
 * Defines interfaces for Inworld AI TTS integration.
 */

import type { Core } from '@strapi/strapi';

/**
 * Timestamp type for Inworld AI TTS API.
 * Controls timestamp metadata returned with the audio.
 */
export type TimestampType = 'TIMESTAMP_TYPE_UNSPECIFIED' | 'WORD' | 'CHARACTER';

/**
 * Configuration for TTS generation.
 */
export interface TTSConfig {
  /** Voice ID to use (e.g., "Dennis", "Ashley") */
  readonly voice?: string;
  /** Model ID to use (e.g., "inworld-tts-1-max") */
  readonly model?: string;
  /** API key (defaults to INWORLD_API_KEY env var) */
  readonly apiKey?: string;
  /** Timestamp type for alignment data (default: WORD for chapter tracking) */
  readonly timestampType?: TimestampType;
  /** Strapi instance for logging */
  readonly strapi?: Core.Strapi;
}

/**
 * Chapter marker for audio navigation.
 */
export interface AudioChapter {
  /** Chapter title (H2 heading text) */
  readonly title: string;
  /** Start time in seconds */
  readonly startTime: number;
  /** End time in seconds (optional, can be inferred from next chapter) */
  readonly endTime?: number;
}

/**
 * Result from audio generation.
 */
export interface AudioGenerationResult {
  /** Audio data as buffer (MP3 format) */
  readonly buffer: Buffer;
  /** Total generation duration in milliseconds */
  readonly durationMs: number;
  /** Number of chunks processed */
  readonly chunkCount: number;
  /** Chapter markers for H2 sections (if available) */
  readonly chapters?: readonly AudioChapter[];
  /** Total audio duration in seconds (actual playback time from timestamps or estimation) */
  readonly audioDurationSeconds?: number;
  /** Timestamp type used for generation */
  readonly timestampType?: TimestampType;
  /** Full word alignment data (for advanced frontend features like word highlighting) */
  readonly wordAlignment?: WordAlignment;
  /** Full character alignment data (for advanced frontend features like karaoke) */
  readonly characterAlignment?: CharacterAlignment;
}

/**
 * Result from audio upload to Strapi.
 */
export interface AudioUploadResult {
  /** Strapi media numeric ID */
  readonly id: number;
  /** Strapi media document ID */
  readonly documentId: string;
  /** Public CDN URL to the audio file */
  readonly url: string;
  /** Chapter file ID (if chapters were generated) */
  readonly chapterFileId?: number;
}

/**
 * Word alignment data from Inworld API.
 * Provides precise timing for each word in the audio.
 */
export interface WordAlignment {
  /** Array of words in order */
  readonly words: readonly string[];
  /** Start time for each word in seconds */
  readonly wordStartTimeSeconds: readonly number[];
  /** End time for each word in seconds */
  readonly wordEndTimeSeconds: readonly number[];
}

/**
 * Character alignment data from Inworld API.
 * Provides precise timing for each character in the audio.
 */
export interface CharacterAlignment {
  /** Array of characters in order */
  readonly characters: readonly string[];
  /** Start time for each character in seconds */
  readonly characterStartTimeSeconds: readonly number[];
  /** End time for each character in seconds */
  readonly characterEndTimeSeconds: readonly number[];
}

/**
 * Timestamp information from Inworld API response.
 */
export interface TimestampInfo {
  /** Word-level alignment (if timestampType=WORD) */
  readonly wordAlignment?: WordAlignment;
  /** Character-level alignment (if timestampType=CHARACTER) */
  readonly characterAlignment?: CharacterAlignment;
}

// ============================================================================
// Section-Aware Chunking Types
// ============================================================================

/**
 * Chunk source type indicating how the chunk was created.
 */
export type ChunkSource = 'section' | 'paragraph' | 'sentence';

/**
 * Section-aware chunk metadata for TTS generation.
 * Tracks which H2 section a chunk belongs to for better chapter alignment.
 */
export interface SectionAwareChunk {
  /** The text content of this chunk */
  readonly text: string;
  /** Index of the H2 section this chunk belongs to (-1 if no sections) */
  readonly sectionIndex: number;
  /** H2 section heading text (empty string if no sections) */
  readonly sectionHeading: string;
  /** Whether this is the first chunk of the section */
  readonly isFirstChunkOfSection: boolean;
  /** How this chunk was created (section fit entirely, split by paragraph, or sentence) */
  readonly source: ChunkSource;
}

/**
 * MP3 chunk data with metadata from TTS API.
 * Combines the raw audio buffer with timing and section information.
 */
export interface MP3ChunkData {
  /** Raw MP3 buffer from API */
  readonly buffer: Buffer;
  /** Timestamp info from API (word/character alignment) */
  readonly timestampInfo?: TimestampInfo;
  /** Section-aware chunk metadata */
  readonly chunkMeta: SectionAwareChunk;
}

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Internal: Inworld API request body for a single chunk.
 */
export interface InworldTTSRequest {
  readonly text: string;
  readonly voiceId: string;
  readonly modelId: string;
  /** Timestamp type for alignment data */
  readonly timestampType?: TimestampType;
}

/**
 * Internal: Inworld API response for a single chunk.
 */
export interface InworldTTSResponse {
  /** Base64-encoded audio content (MP3) */
  readonly audioContent: string;
  /** Timestamp alignment data (if requested) */
  readonly timestampInfo?: TimestampInfo;
}
