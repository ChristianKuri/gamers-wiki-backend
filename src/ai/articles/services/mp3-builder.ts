/**
 * MP3 Builder
 *
 * Functions for creating and building MP3 data.
 * Handles Xing header generation and MP3 concatenation.
 */

import type { MP3FrameInfo, ConcatenatedMP3Result, ExtractedMP3Data } from './mp3-types';
import {
  XING_MAGIC,
  XING_FLAG_FRAMES,
  XING_FLAG_BYTES,
  XING_FLAG_TOC,
  SAMPLE_RATE_TABLE_V1,
  SAMPLE_RATE_TABLE_V2,
  SAMPLE_RATE_TABLE_V25,
} from './mp3-types';
import { extractAudioFrames } from './mp3-parser';

// ============================================================================
// Xing Header Generation
// ============================================================================

/**
 * Generates a 100-byte Table of Contents for Xing header.
 * Maps 0-99% time positions to byte offsets (scaled to 0-255).
 *
 * @param framePositions - Byte positions of each frame
 * @param totalBytes - Total audio data size in bytes
 * @returns 100-byte TOC buffer
 */
function generateTOC(framePositions: readonly number[], totalBytes: number): Buffer {
  const toc = Buffer.alloc(100);
  const totalFrames = framePositions.length;

  if (totalFrames === 0 || totalBytes === 0) {
    // Return linear TOC if no data
    for (let i = 0; i < 100; i++) {
      toc[i] = Math.floor((i / 100) * 256);
    }
    return toc;
  }

  for (let i = 0; i < 100; i++) {
    // Which frame corresponds to i% of total time?
    const targetFrame = Math.floor((i / 100) * totalFrames);
    const safeFrame = Math.min(targetFrame, totalFrames - 1);
    const byteOffset = framePositions[safeFrame] || 0;

    // Scale to 0-255 range
    toc[i] = Math.min(255, Math.floor((byteOffset / totalBytes) * 256));
  }

  return toc;
}

/**
 * Generates a Xing header frame for proper VBR seeking.
 * The Xing header is placed in a valid MP3 frame with silent audio.
 *
 * @param totalFrames - Total number of audio frames
 * @param totalBytes - Total audio data size in bytes
 * @param frameInfo - Frame info from source audio (for matching format)
 * @param framePositions - Byte positions of frames (for TOC)
 * @returns Xing header frame as buffer
 */
export function generateXingHeader(
  totalFrames: number,
  totalBytes: number,
  frameInfo: MP3FrameInfo,
  framePositions: readonly number[]
): Buffer {
  const { mpegVersion, sampleRate, channelMode } = frameInfo;

  // Find sample rate index
  const sampleRateTable: readonly number[] =
    mpegVersion === 1
      ? SAMPLE_RATE_TABLE_V1
      : mpegVersion === 2
        ? SAMPLE_RATE_TABLE_V2
        : SAMPLE_RATE_TABLE_V25;
  const sampleRateIndex = sampleRateTable.indexOf(sampleRate);
  if (sampleRateIndex < 0 || sampleRateIndex > 2) {
    throw new Error(`Invalid sample rate: ${sampleRate}`);
  }

  // Use 128kbps for the Xing frame - provides adequate frame size for all sample rates
  // (16kHz-48kHz) and maximum compatibility. The Xing frame contains only metadata
  // (no audio), so this bitrate doesn't affect audio quality.
  // MPEG1 Layer 3: index 9 = 128kbps
  // MPEG2/2.5 Layer 3: index 12 = 128kbps
  const bitrateIndex = mpegVersion === 1 ? 9 : 12;
  const bitrate = 128;

  // Calculate frame size for Xing frame
  const coefficient = mpegVersion === 1 ? 144 : 72;
  const frameSize = Math.floor((coefficient * bitrate * 1000) / sampleRate);

  // Allocate frame buffer
  const xingFrame = Buffer.alloc(frameSize, 0);

  // Build frame header (4 bytes)
  // Byte 0: 0xFF (sync)
  xingFrame[0] = 0xff;

  // Byte 1: sync continuation + version + layer + protection
  // 111 (sync) + version bits + 01 (layer 3) + 1 (no CRC)
  let byte1 = 0xe0; // 111 00000
  if (mpegVersion === 1) {
    byte1 |= 0x18; // 11 for MPEG1
  } else if (mpegVersion === 2) {
    byte1 |= 0x10; // 10 for MPEG2
  }
  // else 00 for MPEG2.5
  byte1 |= 0x02; // Layer 3
  byte1 |= 0x01; // No CRC
  xingFrame[1] = byte1;

  // Byte 2: bitrate index + sample rate index + padding + private
  const byte2 = (bitrateIndex << 4) | (sampleRateIndex << 2);
  xingFrame[2] = byte2;

  // Byte 3: channel mode + mode extension + copyright + original + emphasis
  const byte3 = channelMode << 6;
  xingFrame[3] = byte3;

  // Calculate Xing header offset (depends on MPEG version and channel mode)
  // This is where the Xing data starts after the side info
  let xingOffset: number;
  if (mpegVersion === 1) {
    xingOffset = channelMode === 3 ? 21 : 36; // mono vs stereo
  } else {
    xingOffset = channelMode === 3 ? 13 : 21;
  }
  xingOffset += 4; // Add frame header size

  // Note: No size check needed - 128kbps guarantees adequate frame size
  // for all supported sample rates (minimum 384 bytes at 48kHz, need 156 bytes max)

  // Write "Xing" magic
  XING_MAGIC.copy(xingFrame, xingOffset);

  // Write flags (frames + bytes + TOC)
  const flags = XING_FLAG_FRAMES | XING_FLAG_BYTES | XING_FLAG_TOC;
  xingFrame.writeUInt32BE(flags, xingOffset + 4);

  // Write total frames
  xingFrame.writeUInt32BE(totalFrames, xingOffset + 8);

  // Write total bytes (audio data only, excluding this Xing frame)
  xingFrame.writeUInt32BE(totalBytes, xingOffset + 12);

  // Generate and write TOC (100 bytes)
  const toc = generateTOC(framePositions, totalBytes);
  toc.copy(xingFrame, xingOffset + 16);

  return xingFrame;
}

// ============================================================================
// Main Concatenation Function
// ============================================================================

/**
 * Concatenates multiple MP3 buffers into a single valid MP3 file.
 * Creates proper Xing header for accurate seeking in web browsers.
 *
 * Algorithm:
 * 1. Extract raw audio frames from each buffer (strips ID3 tags, Xing headers)
 * 2. Track frame positions and durations for each chunk
 * 3. Concatenate all audio frames
 * 4. Generate new Xing header with accurate metadata
 * 5. Return combined buffer: [Xing Header] + [All Audio Frames]
 *
 * @param mp3Buffers - Array of complete MP3 file buffers
 * @returns Concatenated MP3 with proper headers for web playback
 * @throws Error if no valid MP3 data found
 */
export function concatenateMP3Buffers(mp3Buffers: readonly Buffer[]): ConcatenatedMP3Result {
  if (mp3Buffers.length === 0) {
    throw new Error('No MP3 buffers provided for concatenation');
  }

  // Extract and concatenate all buffers (handles single and multiple buffers uniformly)
  const extractedChunks: ExtractedMP3Data[] = [];
  let totalFrames = 0;
  let totalDuration = 0;
  const allFramePositions: number[] = [];
  const chunkByteOffsets: number[] = [];
  const chunkFrameOffsets: number[] = [];
  const chunkDurations: number[] = [];
  let currentByteOffset = 0;
  let currentFrameOffset = 0;

  for (const mp3Buffer of mp3Buffers) {
    const extracted = extractAudioFrames(mp3Buffer);
    extractedChunks.push(extracted);

    // Track chunk start positions
    chunkByteOffsets.push(currentByteOffset);
    chunkFrameOffsets.push(currentFrameOffset);
    chunkDurations.push(extracted.duration);

    // Accumulate frame positions (adjusted for concatenation offset)
    for (const pos of extracted.framePositions) {
      allFramePositions.push(currentByteOffset + pos);
    }

    totalFrames += extracted.frameCount;
    totalDuration += extracted.duration;
    currentByteOffset += extracted.audioData.length;
    currentFrameOffset += extracted.frameCount;
  }

  // Use first chunk's frame info for Xing header format
  const firstFrameInfo = extractedChunks[0].firstFrameInfo;

  // Validate that all chunks have a compatible format
  for (let i = 1; i < extractedChunks.length; i++) {
    const currentFrameInfo = extractedChunks[i].firstFrameInfo;
    if (
      currentFrameInfo.mpegVersion !== firstFrameInfo.mpegVersion ||
      currentFrameInfo.sampleRate !== firstFrameInfo.sampleRate ||
      currentFrameInfo.channelMode !== firstFrameInfo.channelMode
    ) {
      // Log the differing info for easier debugging
      const firstInfoStr = `v${firstFrameInfo.mpegVersion} ${firstFrameInfo.sampleRate}Hz`;
      const currentInfoStr = `v${currentFrameInfo.mpegVersion} ${currentFrameInfo.sampleRate}Hz`;
      throw new Error(
        `MP3 chunks have incompatible audio formats. Cannot concatenate. Chunk 0: ${firstInfoStr}, Chunk ${i}: ${currentInfoStr}`
      );
    }
  }

  // Concatenate all audio data
  const audioData = Buffer.concat(extractedChunks.map((e) => e.audioData));

  // Generate Xing header
  const xingHeader = generateXingHeader(
    totalFrames,
    audioData.length,
    firstFrameInfo,
    allFramePositions
  );

  // Adjust chunk byte offsets to account for Xing header
  const xingHeaderSize = xingHeader.length;
  const adjustedChunkByteOffsets = chunkByteOffsets.map((offset) => offset + xingHeaderSize);

  // Final buffer: Xing header + audio data
  const finalBuffer = Buffer.concat([xingHeader, audioData]);

  return {
    buffer: finalBuffer,
    duration: totalDuration,
    frameCount: totalFrames,
    chunkByteOffsets: adjustedChunkByteOffsets,
    chunkFrameOffsets,
    chunkDurations,
  };
}
