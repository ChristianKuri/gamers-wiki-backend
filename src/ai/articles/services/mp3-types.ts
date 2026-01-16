/**
 * MP3 Types and Constants
 *
 * Type definitions and constants for MP3 parsing and manipulation.
 */

// ============================================================================
// Constants
// ============================================================================

/** Xing header magic bytes */
export const XING_MAGIC = Buffer.from('Xing');
export const INFO_MAGIC = Buffer.from('Info');

/** Xing header flags */
export const XING_FLAG_FRAMES = 0x0001;
export const XING_FLAG_BYTES = 0x0002;
export const XING_FLAG_TOC = 0x0004;

/**
 * Bitrate lookup table for MPEG1 Layer 3 (kbps).
 * Index corresponds to 4-bit bitrate_index from frame header.
 */
export const BITRATE_TABLE_V1_L3 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
] as const;

/**
 * Bitrate lookup table for MPEG2/2.5 Layer 3 (kbps).
 */
export const BITRATE_TABLE_V2_L3 = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
] as const;

/** Sample rate lookup tables (Hz) */
export const SAMPLE_RATE_TABLE_V1 = [44100, 48000, 32000, 0] as const;
export const SAMPLE_RATE_TABLE_V2 = [22050, 24000, 16000, 0] as const;
export const SAMPLE_RATE_TABLE_V25 = [11025, 12000, 8000, 0] as const;

/** Samples per frame constants */
export const SAMPLES_PER_FRAME_V1_L3 = 1152;
export const SAMPLES_PER_FRAME_V2_L3 = 576;

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

/** Reusable invalid frame info object to avoid repeated allocations */
export const INVALID_FRAME_INFO: MP3FrameInfo = {
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
} as const;

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
