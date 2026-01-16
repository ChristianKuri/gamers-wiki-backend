/**
 * MP3 Parser
 *
 * Functions for reading and parsing MP3 data.
 * Handles ID3 tag detection, frame header parsing, and audio frame extraction.
 */

import type { MP3FrameInfo, ExtractedMP3Data } from './mp3-types';
import {
  INVALID_FRAME_INFO,
  BITRATE_TABLE_V1_L3,
  BITRATE_TABLE_V2_L3,
  SAMPLE_RATE_TABLE_V1,
  SAMPLE_RATE_TABLE_V2,
  SAMPLE_RATE_TABLE_V25,
  SAMPLES_PER_FRAME_V1_L3,
  SAMPLES_PER_FRAME_V2_L3,
  XING_MAGIC,
  INFO_MAGIC,
} from './mp3-types';

// ============================================================================
// ID3v2 Detection
// ============================================================================

/**
 * Detects and returns the size of ID3v2 header (if present).
 * ID3v2 header starts with "ID3" and uses syncsafe integer for size.
 *
 * @param buffer - MP3 buffer
 * @returns Size of ID3v2 header in bytes (0 if not present)
 */
export function getID3v2Size(buffer: Buffer): number {
  if (buffer.length < 10) return 0;

  // Check for "ID3" magic (0x49 0x44 0x33)
  if (buffer[0] !== 0x49 || buffer[1] !== 0x44 || buffer[2] !== 0x33) {
    return 0;
  }

  // Read syncsafe integer size (4 bytes, 7 bits each = 28 bits total)
  // Syncsafe means the MSB of each byte is always 0
  const size =
    ((buffer[6] & 0x7f) << 21) |
    ((buffer[7] & 0x7f) << 14) |
    ((buffer[8] & 0x7f) << 7) |
    (buffer[9] & 0x7f);

  // Total size = header (10 bytes) + tag content
  return 10 + size;
}

/**
 * Checks if buffer has ID3v1 tag at the end.
 * ID3v1 is always 128 bytes and starts with "TAG".
 *
 * @param buffer - MP3 buffer
 * @returns Size of ID3v1 tag (128) or 0 if not present
 */
export function getID3v1Size(buffer: Buffer): number {
  if (buffer.length < 128) return 0;

  const tagStart = buffer.length - 128;
  // Check for "TAG" magic (0x54 0x41 0x47)
  if (
    buffer[tagStart] === 0x54 &&
    buffer[tagStart + 1] === 0x41 &&
    buffer[tagStart + 2] === 0x47
  ) {
    return 128;
  }

  return 0;
}

// ============================================================================
// Frame Header Parsing
// ============================================================================

/**
 * Parses an MP3 frame header from 4 bytes.
 *
 * MP3 frame header structure (32 bits):
 * - Bits 31-21: Sync word (all 1s = 0x7FF)
 * - Bits 20-19: MPEG version (00=2.5, 01=reserved, 10=2, 11=1)
 * - Bits 18-17: Layer (00=reserved, 01=3, 10=2, 11=1)
 * - Bit 16: Protection bit (0=CRC, 1=no CRC)
 * - Bits 15-12: Bitrate index
 * - Bits 11-10: Sample rate index
 * - Bit 9: Padding bit
 * - Bit 8: Private bit
 * - Bits 7-6: Channel mode
 * - Bits 5-4: Mode extension
 * - Bit 3: Copyright
 * - Bit 2: Original
 * - Bits 1-0: Emphasis
 *
 * @param header - 4-byte frame header buffer
 * @returns Parsed frame information
 */
export function parseFrameHeader(header: Buffer): MP3FrameInfo {
  if (header.length < 4) return INVALID_FRAME_INFO;

  // Check sync word: first 11 bits must all be 1
  // Byte 0 must be 0xFF, and top 3 bits of byte 1 must be 0xE0
  if (header[0] !== 0xff || (header[1] & 0xe0) !== 0xe0) {
    return INVALID_FRAME_INFO;
  }

  // Parse MPEG version (bits 19-20, in byte 1 bits 3-4)
  const versionBits = (header[1] >> 3) & 0x03;
  let mpegVersion: 1 | 2 | 2.5;
  switch (versionBits) {
    case 3:
      mpegVersion = 1;
      break;
    case 2:
      mpegVersion = 2;
      break;
    case 0:
      mpegVersion = 2.5;
      break;
    default:
      return INVALID_FRAME_INFO; // Reserved
  }

  // Parse layer (bits 17-18, in byte 1 bits 1-2)
  const layerBits = (header[1] >> 1) & 0x03;
  let layer: 1 | 2 | 3;
  switch (layerBits) {
    case 3:
      layer = 1;
      break;
    case 2:
      layer = 2;
      break;
    case 1:
      layer = 3;
      break;
    default:
      return INVALID_FRAME_INFO; // Reserved
  }

  // Parse bitrate (bits 12-15, in byte 2 bits 4-7)
  const bitrateIndex = (header[2] >> 4) & 0x0f;
  const bitrateTable = mpegVersion === 1 ? BITRATE_TABLE_V1_L3 : BITRATE_TABLE_V2_L3;
  const bitrate = bitrateTable[bitrateIndex];
  if (bitrate === 0) {
    // 0 means free format or invalid
    if (bitrateIndex === 0 || bitrateIndex === 15) {
      return INVALID_FRAME_INFO;
    }
  }

  // Parse sample rate (bits 10-11, in byte 2 bits 2-3)
  const sampleRateIndex = (header[2] >> 2) & 0x03;
  const sampleRateTable =
    mpegVersion === 1
      ? SAMPLE_RATE_TABLE_V1
      : mpegVersion === 2
        ? SAMPLE_RATE_TABLE_V2
        : SAMPLE_RATE_TABLE_V25;
  const sampleRate = sampleRateTable[sampleRateIndex];
  if (sampleRate === 0) return INVALID_FRAME_INFO;

  // Parse padding (bit 9, in byte 2 bit 1)
  const padding = ((header[2] >> 1) & 0x01) === 1;

  // Parse channel mode (bits 6-7, in byte 3 bits 6-7)
  const channelMode = (header[3] >> 6) & 0x03;

  // Calculate samples per frame
  const samplesPerFrame = mpegVersion === 1 ? SAMPLES_PER_FRAME_V1_L3 : SAMPLES_PER_FRAME_V2_L3;

  // Calculate frame size
  // For Layer 3: frameSize = floor((144 * bitrate * 1000) / sampleRate) + padding
  // Note: For MPEG2/2.5 Layer 3, the formula uses 72 instead of 144
  const coefficient = mpegVersion === 1 ? 144 : 72;
  const paddingSize = padding ? 1 : 0;
  const frameSize = Math.floor((coefficient * bitrate * 1000) / sampleRate) + paddingSize;

  // Calculate duration
  const duration = samplesPerFrame / sampleRate;

  return {
    mpegVersion,
    layer,
    bitrate,
    sampleRate,
    padding,
    channelMode,
    frameSize,
    samplesPerFrame,
    duration,
    valid: true,
  };
}

// ============================================================================
// Xing Header Detection
// ============================================================================

/**
 * Checks if a frame contains a Xing or Info header.
 * The Xing header location depends on MPEG version and channel mode:
 * - MPEG1 stereo/joint stereo/dual channel: offset 36
 * - MPEG1 mono: offset 21
 * - MPEG2/2.5 stereo/joint stereo/dual channel: offset 21
 * - MPEG2/2.5 mono: offset 13
 *
 * @param frame - Complete MP3 frame buffer
 * @param frameInfo - Parsed frame header info
 * @returns true if frame contains Xing/Info header
 */
export function isXingFrame(frame: Buffer, frameInfo: MP3FrameInfo): boolean {
  // Calculate Xing header offset based on version and channel mode
  let xingOffset: number;
  if (frameInfo.mpegVersion === 1) {
    xingOffset = frameInfo.channelMode === 3 ? 21 : 36; // 3 = mono
  } else {
    xingOffset = frameInfo.channelMode === 3 ? 13 : 21;
  }

  // Add 4 bytes for frame header
  xingOffset += 4;

  if (frame.length < xingOffset + 4) return false;

  // Check for "Xing" or "Info" magic
  const magic = frame.subarray(xingOffset, xingOffset + 4);
  return magic.equals(XING_MAGIC) || magic.equals(INFO_MAGIC);
}

// ============================================================================
// Frame Extraction
// ============================================================================

/**
 * Finds the position of the first valid MP3 audio frame.
 * Skips ID3v2 header and any Xing/Info header frames.
 *
 * @param buffer - MP3 buffer
 * @param skipXing - Whether to skip Xing header frames (default: true)
 * @returns Offset to first audio frame, or -1 if not found
 */
export function findFirstAudioFrame(buffer: Buffer, skipXing: boolean = true): number {
  // Skip ID3v2 if present
  let offset = getID3v2Size(buffer);

  // Search for sync word
  while (offset < buffer.length - 4) {
    if (buffer[offset] === 0xff && (buffer[offset + 1] & 0xe0) === 0xe0) {
      const header = buffer.subarray(offset, offset + 4);
      const frameInfo = parseFrameHeader(header);

      if (frameInfo.valid && frameInfo.frameSize > 0) {
        // Check if this is a Xing/Info header frame
        if (skipXing && offset + frameInfo.frameSize <= buffer.length) {
          const frame = buffer.subarray(offset, offset + frameInfo.frameSize);
          if (isXingFrame(frame, frameInfo)) {
            // Skip Xing frame and continue searching
            offset += frameInfo.frameSize;
            continue;
          }
        }
        return offset;
      }
    }
    offset++;
  }

  return -1;
}

/**
 * Extracts raw MP3 audio frames from a buffer.
 * Strips ID3v2/ID3v1 tags and Xing/Info headers.
 *
 * @param buffer - Complete MP3 file buffer
 * @returns Extracted audio data and metadata
 * @throws Error if no valid MP3 frames found
 */
export function extractAudioFrames(buffer: Buffer): ExtractedMP3Data {
  const frames: Buffer[] = [];
  const framePositions: number[] = [];
  let frameCount = 0;
  let totalDuration = 0;
  let firstFrameInfo: MP3FrameInfo | null = null;

  // Find start of audio (skip ID3v2 and Xing)
  let offset = findFirstAudioFrame(buffer, true);
  if (offset < 0) {
    throw new Error('No valid MP3 frames found in buffer');
  }

  // Find end of audio (before ID3v1 tag if present)
  const id3v1Size = getID3v1Size(buffer);
  const endOffset = buffer.length - id3v1Size;

  // Track byte position in output
  let currentBytePosition = 0;

  // Parse all frames
  while (offset < endOffset - 4) {
    // Look for sync word
    if (buffer[offset] === 0xff && (buffer[offset + 1] & 0xe0) === 0xe0) {
      const header = buffer.subarray(offset, offset + 4);
      const frameInfo = parseFrameHeader(header);

      if (frameInfo.valid && frameInfo.frameSize > 0 && offset + frameInfo.frameSize <= endOffset) {
        // Save first frame info for metadata
        if (!firstFrameInfo) {
          firstFrameInfo = frameInfo;
        }

        // Extract frame
        const frame = buffer.subarray(offset, offset + frameInfo.frameSize);

        // Skip if this is somehow a Xing frame we missed
        if (isXingFrame(frame, frameInfo)) {
          offset += frameInfo.frameSize;
          continue;
        }

        frames.push(frame);
        framePositions.push(currentBytePosition);

        frameCount++;
        totalDuration += frameInfo.duration;
        currentBytePosition += frameInfo.frameSize;
        offset += frameInfo.frameSize;
        continue;
      }
    }
    offset++;
  }

  if (!firstFrameInfo || frameCount === 0) {
    throw new Error('No valid MP3 frames extracted from buffer');
  }

  return {
    audioData: Buffer.concat(frames),
    frameCount,
    duration: totalDuration,
    firstFrameInfo,
    framePositions,
  };
}
