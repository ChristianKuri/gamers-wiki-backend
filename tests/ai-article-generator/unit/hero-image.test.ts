/**
 * Hero Image Tests
 *
 * Tests for hero image processing:
 * - Image download and resize
 * - WebP/JPEG format conversion
 * - IGDB URL transformation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../../../src/ai/articles/services/image-downloader', () => ({
  downloadImageWithRetry: vi.fn(),
}));

vi.mock('sharp', () => {
  const mockSharp = vi.fn();
  const mockResize = vi.fn();
  const mockWebp = vi.fn();
  const mockJpeg = vi.fn();
  const mockMetadata = vi.fn();
  const mockToBuffer = vi.fn();

  // Chain methods
  mockSharp.mockReturnValue({
    resize: mockResize.mockReturnValue({
      webp: mockWebp.mockReturnValue({
        toBuffer: mockToBuffer,
      }),
      jpeg: mockJpeg.mockReturnValue({
        toBuffer: mockToBuffer,
      }),
    }),
    metadata: mockMetadata,
  });

  return {
    default: mockSharp,
    __mocks: { mockSharp, mockResize, mockWebp, mockJpeg, mockMetadata, mockToBuffer },
  };
});

// ============================================================================
// Test Helpers
// ============================================================================

// Create a minimal valid JPEG buffer (just magic bytes + padding)
function createMockJpegBuffer(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(100).fill(0)]);
}

// Create a mock WebP output buffer
function createMockWebpBuffer(): Buffer {
  return Buffer.from([0x52, 0x49, 0x46, 0x46, ...Array(50).fill(0)]);
}

// ============================================================================
// Tests
// ============================================================================

describe('Hero Image', () => {
  let mockDownloadImageWithRetry: ReturnType<typeof vi.fn>;
  let sharpMocks: {
    mockSharp: ReturnType<typeof vi.fn>;
    mockResize: ReturnType<typeof vi.fn>;
    mockWebp: ReturnType<typeof vi.fn>;
    mockJpeg: ReturnType<typeof vi.fn>;
    mockMetadata: ReturnType<typeof vi.fn>;
    mockToBuffer: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Get mocked functions
    const downloaderModule = await import('../../../src/ai/articles/services/image-downloader');
    mockDownloadImageWithRetry = downloaderModule.downloadImageWithRetry as ReturnType<typeof vi.fn>;
    
    const sharpModule = await import('sharp');
    sharpMocks = (sharpModule as any).__mocks;
    
    // Reset sharp chain
    sharpMocks.mockSharp.mockReturnValue({
      resize: sharpMocks.mockResize.mockReturnValue({
        webp: sharpMocks.mockWebp.mockReturnValue({
          toBuffer: sharpMocks.mockToBuffer,
        }),
        jpeg: sharpMocks.mockJpeg.mockReturnValue({
          toBuffer: sharpMocks.mockToBuffer,
        }),
      }),
      metadata: sharpMocks.mockMetadata,
    });
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('getHighResIGDBUrl', () => {
    it('replaces size parameter in IGDB URLs', async () => {
      const { getHighResIGDBUrl } = await import('../../../src/ai/articles/hero-image');
      
      const url = 'https://images.igdb.com/igdb/image/upload/t_screenshot_big/abc123.jpg';
      const result = getHighResIGDBUrl(url);
      
      expect(result).toBe('https://images.igdb.com/igdb/image/upload/t_1080p/abc123.jpg');
    });

    it('returns non-IGDB URLs unchanged', async () => {
      const { getHighResIGDBUrl } = await import('../../../src/ai/articles/hero-image');
      
      const url = 'https://example.com/image.jpg';
      const result = getHighResIGDBUrl(url);
      
      expect(result).toBe(url);
    });

    it('supports custom size parameter', async () => {
      const { getHighResIGDBUrl } = await import('../../../src/ai/articles/hero-image');
      
      const url = 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg';
      const result = getHighResIGDBUrl(url, 't_screenshot_huge');
      
      expect(result).toBe('https://images.igdb.com/igdb/image/upload/t_screenshot_huge/abc123.jpg');
    });

    it('handles various IGDB size formats', async () => {
      const { getHighResIGDBUrl } = await import('../../../src/ai/articles/hero-image');
      
      // Different size formats
      const urls = [
        'https://images.igdb.com/igdb/image/upload/t_cover_big/id.jpg',
        'https://images.igdb.com/igdb/image/upload/t_screenshot_med/id.jpg',
        'https://images.igdb.com/igdb/image/upload/t_thumb/id.jpg',
        'https://images.igdb.com/igdb/image/upload/t_720p/id.jpg',
      ];
      
      for (const url of urls) {
        const result = getHighResIGDBUrl(url);
        expect(result).toContain('t_1080p');
        expect(result).not.toContain('t_cover_big');
        expect(result).not.toContain('t_screenshot_med');
      }
    });

    it('does not modify URLs without size parameter', async () => {
      const { getHighResIGDBUrl } = await import('../../../src/ai/articles/hero-image');
      
      // IGDB URL without standard size format
      const url = 'https://images.igdb.com/igdb/image/upload/abc123.jpg';
      const result = getHighResIGDBUrl(url);
      
      // Should be unchanged since there's no t_{size}/ to replace
      expect(result).toBe(url);
    });
  });

  describe('processHeroImage', () => {
    it('downloads and processes image to default WebP format', async () => {
      const { processHeroImage } = await import('../../../src/ai/articles/hero-image');
      
      const inputBuffer = createMockJpegBuffer();
      const outputBuffer = createMockWebpBuffer();
      
      mockDownloadImageWithRetry.mockResolvedValueOnce({
        buffer: inputBuffer,
        mimeType: 'image/jpeg',
      });
      
      sharpMocks.mockMetadata.mockResolvedValueOnce({
        width: 1920,
        height: 1080,
        format: 'jpeg',
      });
      
      sharpMocks.mockToBuffer.mockResolvedValueOnce(outputBuffer);
      
      const result = await processHeroImage({
        imageUrl: 'https://example.com/image.jpg',
      });
      
      expect(result.mimeType).toBe('image/webp');
      expect(result.format).toBe('webp');
      expect(result.width).toBe(1280);
      expect(result.height).toBe(720);
      expect(result.buffer).toBe(outputBuffer);
      expect(sharpMocks.mockWebp).toHaveBeenCalledWith({ quality: 85 });
    });

    it('processes image to JPEG when configured', async () => {
      const { processHeroImage } = await import('../../../src/ai/articles/hero-image');
      
      const inputBuffer = createMockJpegBuffer();
      const outputBuffer = Buffer.from([0xff, 0xd8, 0xff, ...Array(50).fill(0)]);
      
      mockDownloadImageWithRetry.mockResolvedValueOnce({
        buffer: inputBuffer,
        mimeType: 'image/jpeg',
      });
      
      sharpMocks.mockMetadata.mockResolvedValueOnce({
        width: 1920,
        height: 1080,
        format: 'jpeg',
      });
      
      sharpMocks.mockToBuffer.mockResolvedValueOnce(outputBuffer);
      
      const result = await processHeroImage({
        imageUrl: 'https://example.com/image.jpg',
        config: { format: 'jpeg' },
      });
      
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.format).toBe('jpeg');
      expect(sharpMocks.mockJpeg).toHaveBeenCalledWith({ quality: 85 });
    });

    it('uses custom dimensions when provided', async () => {
      const { processHeroImage } = await import('../../../src/ai/articles/hero-image');
      
      const inputBuffer = createMockJpegBuffer();
      const outputBuffer = createMockWebpBuffer();
      
      mockDownloadImageWithRetry.mockResolvedValueOnce({
        buffer: inputBuffer,
        mimeType: 'image/jpeg',
      });
      
      sharpMocks.mockMetadata.mockResolvedValueOnce({
        width: 1920,
        height: 1080,
        format: 'jpeg',
      });
      
      sharpMocks.mockToBuffer.mockResolvedValueOnce(outputBuffer);
      
      const result = await processHeroImage({
        imageUrl: 'https://example.com/image.jpg',
        config: { width: 1920, height: 1080 },
      });
      
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(sharpMocks.mockResize).toHaveBeenCalledWith(1920, 1080, expect.any(Object));
    });

    it('uses custom quality when provided', async () => {
      const { processHeroImage } = await import('../../../src/ai/articles/hero-image');
      
      const inputBuffer = createMockJpegBuffer();
      const outputBuffer = createMockWebpBuffer();
      
      mockDownloadImageWithRetry.mockResolvedValueOnce({
        buffer: inputBuffer,
        mimeType: 'image/jpeg',
      });
      
      sharpMocks.mockMetadata.mockResolvedValueOnce({
        width: 1920,
        height: 1080,
        format: 'jpeg',
      });
      
      sharpMocks.mockToBuffer.mockResolvedValueOnce(outputBuffer);
      
      await processHeroImage({
        imageUrl: 'https://example.com/image.jpg',
        config: { quality: 90 },
      });
      
      expect(sharpMocks.mockWebp).toHaveBeenCalledWith({ quality: 90 });
    });

    it('passes signal to download function', async () => {
      const { processHeroImage } = await import('../../../src/ai/articles/hero-image');
      
      const controller = new AbortController();
      const inputBuffer = createMockJpegBuffer();
      const outputBuffer = createMockWebpBuffer();
      
      mockDownloadImageWithRetry.mockResolvedValueOnce({
        buffer: inputBuffer,
        mimeType: 'image/jpeg',
      });
      
      sharpMocks.mockMetadata.mockResolvedValueOnce({
        width: 1920,
        height: 1080,
        format: 'jpeg',
      });
      
      sharpMocks.mockToBuffer.mockResolvedValueOnce(outputBuffer);
      
      await processHeroImage({
        imageUrl: 'https://example.com/image.jpg',
        signal: controller.signal,
      });
      
      expect(mockDownloadImageWithRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          signal: controller.signal,
        })
      );
    });

    it('returns original URL in result', async () => {
      const { processHeroImage } = await import('../../../src/ai/articles/hero-image');
      
      const inputBuffer = createMockJpegBuffer();
      const outputBuffer = createMockWebpBuffer();
      const imageUrl = 'https://images.igdb.com/image.jpg';
      
      mockDownloadImageWithRetry.mockResolvedValueOnce({
        buffer: inputBuffer,
        mimeType: 'image/jpeg',
      });
      
      sharpMocks.mockMetadata.mockResolvedValueOnce({
        width: 1920,
        height: 1080,
        format: 'jpeg',
      });
      
      sharpMocks.mockToBuffer.mockResolvedValueOnce(outputBuffer);
      
      const result = await processHeroImage({ imageUrl });
      
      expect(result.originalUrl).toBe(imageUrl);
    });

    it('propagates download errors', async () => {
      const { processHeroImage } = await import('../../../src/ai/articles/hero-image');
      
      mockDownloadImageWithRetry.mockRejectedValueOnce(new Error('Download failed'));
      
      await expect(processHeroImage({
        imageUrl: 'https://example.com/image.jpg',
      })).rejects.toThrow('Download failed');
    });

    it('propagates sharp processing errors', async () => {
      const { processHeroImage } = await import('../../../src/ai/articles/hero-image');
      
      const inputBuffer = createMockJpegBuffer();
      
      mockDownloadImageWithRetry.mockResolvedValueOnce({
        buffer: inputBuffer,
        mimeType: 'image/jpeg',
      });
      
      sharpMocks.mockMetadata.mockRejectedValueOnce(new Error('Invalid image'));
      
      await expect(processHeroImage({
        imageUrl: 'https://example.com/image.jpg',
      })).rejects.toThrow('Invalid image');
    });
  });
});
