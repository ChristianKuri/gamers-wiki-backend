/**
 * TTS Generator Service
 *
 * Converts article markdown to speech using Inworld AI TTS API.
 *
 * Features:
 * - Markdown to plain text conversion
 * - Automatic chunking for API limits (2000 chars)
 * - Chunk merging via buffer concatenation
 * - Retry logic for transient failures
 * - Chapter marker generation for H2 sections
 */

import type { TTSConfig, AudioGenerationResult, InworldTTSRequest, InworldTTSResponse, AudioChapter, TimestampType, WordAlignment, CharacterAlignment } from './tts-types';
import { TTS_CONFIG } from '../config';

// ============================================================================
// Chapter Generation
// ============================================================================

/**
 * Parsed section from markdown with H2 heading.
 */
interface MarkdownSection {
  /** H2 heading text (without ## prefix) */
  readonly heading: string;
  /** Content of this section (everything until next H2) */
  readonly content: string;
}

/**
 * Parses H2 sections from markdown.
 * Returns array of sections with headings and content.
 *
 * @param markdown - Markdown content to parse
 * @returns Array of sections with H2 headings
 */
function parseH2Sections(markdown: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];

  // Split by H2 headings (## Heading)
  const lines = markdown.split('\n');
  let currentSection: { heading: string; content: string[] } | null = null;

  for (const line of lines) {
    // Check if line is an H2 heading
    const h2Match = line.match(/^##\s+(.+)$/);

    if (h2Match) {
      // Save previous section if exists
      if (currentSection) {
        sections.push({
          heading: currentSection.heading,
          content: currentSection.content.join('\n').trim(),
        });
      }

      // Start new section
      currentSection = {
        heading: h2Match[1].trim(),
        content: [],
      };
    } else if (currentSection) {
      // Add line to current section
      currentSection.content.push(line);
    }
  }

  // Don't forget the last section
  if (currentSection) {
    sections.push({
      heading: currentSection.heading,
      content: currentSection.content.join('\n').trim(),
    });
  }

  return sections;
}

/**
 * Estimates audio duration in seconds based on text length.
 * Uses average speech rate of ~150 words per minute.
 *
 * @param text - Plain text content
 * @returns Estimated duration in seconds
 */
function estimateAudioDuration(text: string): number {
  // Average speech rate: ~150 words per minute
  // Or approximately 900 characters per minute
  const CHARS_PER_MINUTE = 900;
  const CHARS_PER_SECOND = CHARS_PER_MINUTE / 60;

  const charCount = text.length;
  const estimatedSeconds = charCount / CHARS_PER_SECOND;

  // Round to 1 decimal place
  return Math.round(estimatedSeconds * 10) / 10;
}

/**
 * Finds the word index in the word alignment array that best matches the start of a section.
 * Uses fuzzy matching to find where the section content begins in the spoken text.
 *
 * @param sectionText - Plain text of the section content
 * @param words - Array of all words from word alignment
 * @param startSearchIndex - Index to start searching from (for sequential sections)
 * @returns Word index where section starts, or -1 if not found
 */
function findSectionStartWordIndex(
  sectionText: string,
  words: readonly string[],
  startSearchIndex: number = 0
): number {
  // Get first few words of section for matching (normalize case and punctuation)
  const sectionWords = sectionText
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0)
    .slice(0, 5); // Match first 5 words

  if (sectionWords.length === 0) return -1;

  // Search for matching sequence in words array
  for (let i = startSearchIndex; i < words.length - sectionWords.length; i++) {
    let matchCount = 0;
    for (let j = 0; j < sectionWords.length; j++) {
      const word = words[i + j].toLowerCase().replace(/[^\w]/g, '');
      if (word === sectionWords[j]) {
        matchCount++;
      }
    }

    // If we match at least 3 out of 5 words, consider it a match
    if (matchCount >= Math.min(3, sectionWords.length)) {
      return i;
    }
  }

  return -1;
}

// ============================================================================
// Markdown Conversion
// ============================================================================

/**
 * Converts markdown to plain text suitable for TTS.
 * Removes formatting while preserving readability.
 *
 * @param markdown - Markdown content to convert
 * @returns Plain text without markdown formatting
 */
export function convertMarkdownToPlainText(markdown: string): string {
  let text = markdown;

  // Remove H1 title (already in metadata, don't read twice)
  text = text.replace(/^#\s+.+$/m, '');

  // Remove headings but keep the text content
  // H2-H6 headings become regular paragraphs for natural flow
  text = text.replace(/^#{2,6}\s+(.+)$/gm, '$1');

  // Remove markdown links but keep link text
  // [Example](https://example.com) → Example
  text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

  // Remove bold markers but keep text
  // **bold** or __bold__ → bold
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');

  // Remove italic markers but keep text
  // *italic* or _italic_ → italic
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');

  // Remove images entirely (no value in TTS)
  // ![alt text](url) → (removed)
  text = text.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');

  // Remove code blocks (not useful for audio narration)
  // ```code``` → (removed)
  text = text.replace(/```[\s\S]*?```/g, '');

  // Remove inline code markers but keep text
  // `code` → code
  text = text.replace(/`([^`]+)`/g, '$1');

  // Remove horizontal rules
  // --- or *** → (removed)
  text = text.replace(/^[\*\-_]{3,}$/gm, '');

  // Remove blockquote markers but keep text
  // > quote → quote
  text = text.replace(/^>\s+(.+)$/gm, '$1');

  // Remove list markers but keep text
  // - item or * item or 1. item → item
  text = text.replace(/^[\*\-]\s+(.+)$/gm, '$1');
  text = text.replace(/^\d+\.\s+(.+)$/gm, '$1');

  // Clean up whitespace
  // Multiple consecutive newlines → double newline (paragraph break)
  text = text.replace(/\n{3,}/g, '\n\n');

  // Trim leading/trailing whitespace
  text = text.trim();

  return text;
}

// ============================================================================
// Text Chunking
// ============================================================================

/**
 * Splits text into chunks at paragraph boundaries.
 * Ensures no chunk exceeds MAX_CHUNK_SIZE.
 *
 * @param text - Plain text to split
 * @returns Array of text chunks
 */
export function splitTextIntoChunks(text: string): string[] {
  // If text is small enough, return as single chunk
  if (text.length <= TTS_CONFIG.MAX_CHUNK_SIZE) {
    return [text];
  }

  const chunks: string[] = [];

  // Split by double newlines (paragraphs)
  const paragraphs = text.split(/\n\s*\n/);

  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();
    if (!trimmedParagraph) continue;

    // If adding this paragraph would exceed limit
    if (currentChunk.length + trimmedParagraph.length + 2 > TTS_CONFIG.MAX_CHUNK_SIZE) {
      // Save current chunk if it has content
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }

      // If single paragraph is too long, split by sentences
      if (trimmedParagraph.length > TTS_CONFIG.MAX_CHUNK_SIZE) {
        const sentenceChunks = splitBySentences(trimmedParagraph);
        chunks.push(...sentenceChunks);
        currentChunk = '';
      } else {
        currentChunk = trimmedParagraph;
      }
    } else {
      // Add paragraph to current chunk
      if (currentChunk) {
        currentChunk += '\n\n' + trimmedParagraph;
      } else {
        currentChunk = trimmedParagraph;
      }
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Splits a long paragraph by sentences.
 * Used when a single paragraph exceeds MAX_CHUNK_SIZE.
 *
 * @param text - Long paragraph to split
 * @returns Array of sentence-based chunks
 */
function splitBySentences(text: string): string[] {
  const chunks: string[] = [];

  // Split by sentence endings (. ! ?)
  // Keep the punctuation with the sentence
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];

  let currentChunk = '';

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > TTS_CONFIG.MAX_CHUNK_SIZE) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// ============================================================================
// Inworld API Integration
// ============================================================================

/**
 * Result from generating a single audio chunk.
 */
interface AudioChunkResult {
  /** Audio buffer (MP3 format) */
  readonly buffer: Buffer;
  /** Timestamp info (if requested) */
  readonly timestampInfo?: InworldTTSResponse['timestampInfo'];
}

/**
 * Calls Inworld TTS API to generate audio for a single chunk of text.
 * Includes retry logic for transient failures.
 *
 * @param text - Text chunk to convert to speech
 * @param voiceId - Voice ID to use
 * @param modelId - Model ID to use
 * @param apiKey - Inworld API key
 * @param timestampType - Timestamp type for alignment data
 * @returns Audio buffer and timestamp info
 * @throws Error if all retries fail
 */
async function generateAudioChunk(
  text: string,
  voiceId: string,
  modelId: string,
  apiKey: string,
  timestampType?: TimestampType
): Promise<AudioChunkResult> {
  let lastError: Error | null = null;

  // Retry logic with exponential backoff
  for (let attempt = 0; attempt < TTS_CONFIG.MAX_RETRIES; attempt++) {
    try {
      const payload: InworldTTSRequest = {
        text,
        voiceId,
        modelId,
        ...(timestampType && { timestampType }),
      };

      const response = await fetch(TTS_CONFIG.API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Inworld API error (${response.status}): ${errorText}`);
      }

      const result = (await response.json()) as InworldTTSResponse;

      if (!result.audioContent) {
        throw new Error('Inworld API response missing audioContent field');
      }

      // Decode base64 audio content to buffer
      const audioBuffer = Buffer.from(result.audioContent, 'base64');

      return {
        buffer: audioBuffer,
        timestampInfo: result.timestampInfo,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If this is not the last attempt, wait and retry
      if (attempt < TTS_CONFIG.MAX_RETRIES - 1) {
        const delay = TTS_CONFIG.RETRY_DELAY_MS * Math.pow(2, attempt); // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries failed
  throw new Error(`Failed to generate audio after ${TTS_CONFIG.MAX_RETRIES} attempts: ${lastError?.message}`);
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Generates audio from article markdown with chapter markers for H2 sections.
 * Main entry point for TTS service.
 *
 * @param markdown - Article markdown content
 * @param config - TTS configuration (voice, model, API key, strapi logger)
 * @returns Audio generation result with buffer, metadata, and chapters, or null if generation fails
 *
 * @example
 * const result = await generateAudioFromMarkdown(article.content, {
 *   voice: 'Dennis',
 *   model: 'inworld-tts-1-max',
 *   strapi,
 * });
 *
 * if (result) {
 *   strapi.log.info(`Generated ${result.chunkCount} chunks in ${result.durationMs}ms`);
 *   strapi.log.info(`Chapters: ${result.chapters?.length || 0}`);
 *   await uploadAudio(result.buffer);
 * }
 */
export async function generateAudioFromMarkdown(
  markdown: string,
  config: TTSConfig = {}
): Promise<AudioGenerationResult | null> {
  const startTime = Date.now();

  // Get configuration with defaults
  const apiKey = config.apiKey || process.env.INWORLD_API_KEY;
  if (!apiKey) {
    throw new Error('INWORLD_API_KEY not configured (set in .env or pass in config)');
  }

  const voiceId = config.voice || TTS_CONFIG.DEFAULT_VOICE_ID;
  const modelId = config.model || TTS_CONFIG.DEFAULT_MODEL_ID;
  const timestampType = config.timestampType || TTS_CONFIG.DEFAULT_TIMESTAMP_TYPE;

  try {
    // Parse H2 sections for chapter markers
    const sections = parseH2Sections(markdown);
    const hasChapters = sections.length > 0;

    // Convert markdown to plain text
    const plainText = convertMarkdownToPlainText(markdown);

    if (!plainText.trim()) {
      throw new Error('No text content after markdown conversion');
    }

    // Split into chunks if needed
    const chunks = splitTextIntoChunks(plainText);

    // Generate audio for each chunk
    const audioChunks: Buffer[] = [];
    const allWords: string[] = [];
    const allWordStartTimes: number[] = [];
    const allWordEndTimes: number[] = [];
    let cumulativeTime = 0;

    for (const chunk of chunks) {
      const result = await generateAudioChunk(chunk, voiceId, modelId, apiKey, timestampType);
      audioChunks.push(result.buffer);

      // Collect word alignment data if available
      if (result.timestampInfo?.wordAlignment) {
        const { words, wordStartTimeSeconds, wordEndTimeSeconds } = result.timestampInfo.wordAlignment;

        // Adjust timestamps to be cumulative across chunks
        allWords.push(...words);
        allWordStartTimes.push(...wordStartTimeSeconds.map(t => t + cumulativeTime));
        allWordEndTimes.push(...wordEndTimeSeconds.map(t => t + cumulativeTime));

        // Update cumulative time to the end of this chunk
        if (wordEndTimeSeconds.length > 0) {
          cumulativeTime = allWordEndTimes[allWordEndTimes.length - 1];
        }
      }
    }

    // Merge all chunks by concatenating buffers
    // MP3 frames can be safely concatenated without re-encoding
    const finalBuffer = Buffer.concat(audioChunks);

    const durationMs = Date.now() - startTime;

    // Generate chapter markers if H2 sections exist
    let chapters: AudioChapter[] | undefined;
    let totalAudioDuration: number | undefined;

    if (hasChapters) {
      chapters = [];

      // Use actual word alignment data if available
      const hasWordAlignment = allWords.length > 0 && allWordStartTimes.length > 0;

      if (hasWordAlignment) {
        config.strapi?.log.info(`[TTS] Generating ${sections.length} chapter markers using word-level timestamps...`);

        let searchStartIndex = 0;

        for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          const sectionPlainText = convertMarkdownToPlainText(section.content);

          // Find where this section starts in the word array
          const wordIndex = findSectionStartWordIndex(sectionPlainText, allWords, searchStartIndex);

          if (wordIndex >= 0) {
            const startTime = allWordStartTimes[wordIndex];
            // End time is either the start of next section or end of last word
            const endTime = i < sections.length - 1
              ? allWordStartTimes[findSectionStartWordIndex(
                  convertMarkdownToPlainText(sections[i + 1].content),
                  allWords,
                  wordIndex + 1
                )] || allWordEndTimes[allWordEndTimes.length - 1]
              : allWordEndTimes[allWordEndTimes.length - 1];

            chapters.push({
              title: section.heading,
              startTime,
              endTime,
            });

            config.strapi?.log.info(`[TTS] Chapter: "${section.heading}" (${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s) [accurate]`);

            searchStartIndex = wordIndex + 1;
          } else {
            // Fallback to estimation if word matching fails
            config.strapi?.log.warn(`[TTS] Could not find word alignment for section "${section.heading}", using estimation`);
            const estimatedDuration = estimateAudioDuration(sectionPlainText);
            const startTime = i > 0 && chapters[i - 1]
              ? chapters[i - 1].endTime || 0
              : 0;

            chapters.push({
              title: section.heading,
              startTime,
              endTime: startTime + estimatedDuration,
            });

            config.strapi?.log.info(`[TTS] Chapter: "${section.heading}" (${startTime.toFixed(1)}s - ${(startTime + estimatedDuration).toFixed(1)}s) [estimated]`);
          }
        }

        totalAudioDuration = allWordEndTimes[allWordEndTimes.length - 1];
      } else {
        // Fallback to estimation if no word alignment data
        config.strapi?.log.info(`[TTS] Generating ${sections.length} chapter markers using estimation (no word timestamps)...`);

        let currentTime = 0;

        for (const section of sections) {
          const sectionPlainText = convertMarkdownToPlainText(section.content);
          const sectionDuration = estimateAudioDuration(sectionPlainText);

          chapters.push({
            title: section.heading,
            startTime: currentTime,
            endTime: currentTime + sectionDuration,
          });

          config.strapi?.log.info(`[TTS] Chapter: "${section.heading}" (${currentTime.toFixed(1)}s - ${(currentTime + sectionDuration).toFixed(1)}s) [estimated]`);

          currentTime += sectionDuration;
        }

        totalAudioDuration = currentTime;
      }

      config.strapi?.log.info(`[TTS] Total audio duration: ${totalAudioDuration.toFixed(1)} seconds (${(totalAudioDuration / 60).toFixed(1)} minutes)`);
    }

    // Build word alignment data if available
    const wordAlignment: WordAlignment | undefined = allWords.length > 0
      ? {
          words: allWords,
          wordStartTimeSeconds: allWordStartTimes,
          wordEndTimeSeconds: allWordEndTimes,
        }
      : undefined;

    return {
      buffer: finalBuffer,
      durationMs,
      chunkCount: chunks.length,
      chapters,
      audioDurationSeconds: totalAudioDuration,
      timestampType,
      wordAlignment,
    };
  } catch (error) {
    // Log error but return null (non-fatal - audio is optional)
    const errorMsg = error instanceof Error ? error.message : String(error);
    config.strapi?.log.error(`[TTS] Audio generation failed: ${errorMsg}`);
    return null;
  }
}
