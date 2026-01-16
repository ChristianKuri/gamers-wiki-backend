/**
 * MP3 Utilities
 *
 * Pure TypeScript utilities for MP3 parsing and manipulation.
 * Used for proper concatenation of MP3 chunks from TTS API.
 *
 * Features:
 * - ID3v2 tag detection and skipping
 * - MP3 frame header parsing
 * - Raw audio frame extraction
 * - Xing header generation for accurate seeking
 * - Proper multi-file concatenation
 */

// ============================================================================
// Constants
// ============================================================================

/** Xing header magic bytes */
const XING_MAGIC = Buffer.from('Xing');
const INFO_MAGIC = Buffer.from('Info');

/** Xing header flags */
const XING_FLAG_FRAMES = 0x0001;
const XING_FLAG_BYTES = 0x0002;
const XING_FLAG_TOC = 0x0004;

/**
 * Bitrate lookup table for MPEG1 Layer 3 (kbps).
 * Index corresponds to 4-bit bitrate_index from frame header.
 */
const BITRATE_TABLE_V1_L3 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
] as const;

/**
 * Bitrate lookup table for MPEG2/2.5 Layer 3 (kbps).
 */
const BITRATE_TABLE_V2_L3 = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
] as const;

/** Sample rate lookup tables (Hz) */
const SAMPLE_RATE_TABLE_V1 = [44100, 48000, 32000, 0] as const;
const SAMPLE_RATE_TABLE_V2 = [22050, 24000, 16000, 0] as const;
const SAMPLE_RATE_TABLE_V25 = [11025, 12000, 8000, 0] as const;

/** Samples per frame constants */
const SAMPLES_PER_FRAME_V1_L3 = 1152;
const SAMPLES_PER_FRAME_V2_L3 = 576;

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed MP3 frame header information.
 */
export interface MP3FrameInfo {
  /** MPEG version (1, 2, or 2.5) */
  readonly mpegVersion: 1 | 2 | 2.5;
  /** Layer (always 3 for MP3) */
  readonly layer: 1 | 2 | 3;
  /** Bitrate in kbps */
  readonly bitrate: number;
  /** Sample rate in Hz */
  readonly sampleRate: number;
  /** Whether frame has padding byte */
  readonly padding: boolean;
  /** Channel mode (0=stereo, 1=joint stereo, 2=dual channel, 3=mono) */
  readonly channelMode: number;
  /** Calculated frame size in bytes */
  readonly frameSize: number;
  /** Samples per frame */
  readonly samplesPerFrame: number;
  /** Frame duration in seconds */
  readonly duration: number;
  /** Whether this is a valid frame header */
  readonly valid: boolean;
}

/**
 * Result of extracting MP3 frames from a buffer.
 */
export interface ExtractedMP3Data {
  /** Raw audio frames (no ID3, no Xing header) */
  readonly audioData: Buffer;
  /** Total number of frames */
  readonly frameCount: number;
  /** Total audio duration in seconds */
  readonly duration: number;
  /** First frame info (for sample rate, channel mode, etc.) */
  readonly firstFrameInfo: MP3FrameInfo;
  /** Byte positions of each frame (for TOC generation) */
  readonly framePositions: readonly number[];
}

/**
 * Result of MP3 concatenation.
 */
export interface ConcatenatedMP3Result {
  /** Properly formatted MP3 buffer with Xing header */
  readonly buffer: Buffer;
  /** Total audio duration in seconds */
  readonly duration: number;
  /** Total frame count */
  readonly frameCount: number;
  /** Byte offsets where each original chunk starts in the final audio */
  readonly chunkByteOffsets: readonly number[];
  /** Frame offsets where each original chunk starts */
  readonly chunkFrameOffsets: readonly number[];
  /** Duration of each original chunk in seconds */
  readonly chunkDurations: readonly number[];
}

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
  const invalid: MP3FrameInfo = {
    mpegVersion: 1,
    layer: 3,
    bitrate: 0,
    sampleRate: 0,
    padding: false,
    channelMode: 0,
    frameSize: 0,
    samplesPerFrame: 0,
    duration: 0,
    valid: false,
  };

  if (header.length < 4) return invalid;

  // Check sync word: first 11 bits must all be 1
  // Byte 0 must be 0xFF, and top 3 bits of byte 1 must be 0xE0
  if (header[0] !== 0xff || (header[1] & 0xe0) !== 0xe0) {
    return invalid;
  }

  // Parse MPEG version (bits 19-20, in byte 1 bits 3-4)
  const versionBits = (header[1] >> 3) & 0x03;
  let mpegVersion: 1 | 2 | 2.5;
  if (versionBits === 3) {
    mpegVersion = 1;
  } else if (versionBits === 2) {
    mpegVersion = 2;
  } else if (versionBits === 0) {
    mpegVersion = 2.5;
  } else {
    return invalid; // Reserved
  }

  // Parse layer (bits 17-18, in byte 1 bits 1-2)
  const layerBits = (header[1] >> 1) & 0x03;
  let layer: 1 | 2 | 3;
  if (layerBits === 3) {
    layer = 1;
  } else if (layerBits === 2) {
    layer = 2;
  } else if (layerBits === 1) {
    layer = 3;
  } else {
    return invalid; // Reserved
  }

  // Parse bitrate (bits 12-15, in byte 2 bits 4-7)
  const bitrateIndex = (header[2] >> 4) & 0x0f;
  const bitrateTable = mpegVersion === 1 ? BITRATE_TABLE_V1_L3 : BITRATE_TABLE_V2_L3;
  const bitrate = bitrateTable[bitrateIndex];
  if (bitrate === 0) {
    // 0 means free format or invalid
    if (bitrateIndex === 0 || bitrateIndex === 15) {
      return invalid;
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
  if (sampleRate === 0) return invalid;

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

  // Single buffer - still process to ensure clean output
  if (mp3Buffers.length === 1) {
    const extracted = extractAudioFrames(mp3Buffers[0]);
    const xingHeader = generateXingHeader(
      extracted.frameCount,
      extracted.audioData.length,
      extracted.firstFrameInfo,
      extracted.framePositions
    );

    return {
      buffer: Buffer.concat([xingHeader, extracted.audioData]),
      duration: extracted.duration,
      frameCount: extracted.frameCount,
      chunkByteOffsets: [xingHeader.length],
      chunkFrameOffsets: [0],
      chunkDurations: [extracted.duration],
    };
  }

  // Multiple buffers - extract and concatenate
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
