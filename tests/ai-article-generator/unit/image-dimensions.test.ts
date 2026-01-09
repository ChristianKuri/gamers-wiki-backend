/**
 * Tests for the image dimensions service.
 *
 * Tests IGDB dimension inference and dimension probing functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  inferIGDBDimensions,
  meetsHeroRequirements,
  meetsSectionRequirements,
  type ImageDimensions,
} from '../../../src/ai/articles/services/image-dimensions';

// ============================================================================
// IGDB Dimension Inference Tests
// ============================================================================

describe('inferIGDBDimensions', () => {
  it('should infer dimensions for t_1080p images', () => {
    const url = 'https://images.igdb.com/igdb/image/upload/t_1080p/abc123.jpg';
    const result = inferIGDBDimensions(url);
    
    expect(result).toEqual({ width: 1920, height: 1080 });
  });

  it('should infer dimensions for t_720p images', () => {
    const url = 'https://images.igdb.com/igdb/image/upload/t_720p/xyz789.jpg';
    const result = inferIGDBDimensions(url);
    
    expect(result).toEqual({ width: 1280, height: 720 });
  });

  it('should infer dimensions for t_screenshot_huge images', () => {
    const url = 'https://images.igdb.com/igdb/image/upload/t_screenshot_huge/screenshot1.jpg';
    const result = inferIGDBDimensions(url);
    
    expect(result).toEqual({ width: 1280, height: 720 });
  });

  it('should infer dimensions for t_screenshot_big images', () => {
    const url = 'https://images.igdb.com/igdb/image/upload/t_screenshot_big/screenshot2.jpg';
    const result = inferIGDBDimensions(url);
    
    expect(result).toEqual({ width: 889, height: 500 });
  });

  it('should infer dimensions for t_screenshot_med images', () => {
    const url = 'https://images.igdb.com/igdb/image/upload/t_screenshot_med/screenshot3.jpg';
    const result = inferIGDBDimensions(url);
    
    expect(result).toEqual({ width: 569, height: 320 });
  });

  it('should infer dimensions for t_cover_big images', () => {
    const url = 'https://images.igdb.com/igdb/image/upload/t_cover_big/cover1.jpg';
    const result = inferIGDBDimensions(url);
    
    expect(result).toEqual({ width: 264, height: 374 });
  });

  it('should infer dimensions for t_cover_small images', () => {
    const url = 'https://images.igdb.com/igdb/image/upload/t_cover_small/cover2.jpg';
    const result = inferIGDBDimensions(url);
    
    expect(result).toEqual({ width: 90, height: 128 });
  });

  it('should infer dimensions for t_thumb images', () => {
    const url = 'https://images.igdb.com/igdb/image/upload/t_thumb/thumb1.jpg';
    const result = inferIGDBDimensions(url);
    
    expect(result).toEqual({ width: 90, height: 90 });
  });

  it('should infer dimensions for t_micro images', () => {
    const url = 'https://images.igdb.com/igdb/image/upload/t_micro/micro1.jpg';
    const result = inferIGDBDimensions(url);
    
    expect(result).toEqual({ width: 35, height: 35 });
  });

  it('should infer dimensions for t_logo_med images', () => {
    const url = 'https://images.igdb.com/igdb/image/upload/t_logo_med/logo1.jpg';
    const result = inferIGDBDimensions(url);
    
    expect(result).toEqual({ width: 284, height: 160 });
  });

  it('should return null for non-IGDB URLs', () => {
    const url = 'https://example.com/image.jpg';
    const result = inferIGDBDimensions(url);
    
    expect(result).toBeNull();
  });

  it('should return null for IGDB URLs without known size token', () => {
    const url = 'https://images.igdb.com/igdb/image/upload/t_custom/custom1.jpg';
    const result = inferIGDBDimensions(url);
    
    expect(result).toBeNull();
  });

  it('should return null for t_original URLs (forces actual dimension probing)', () => {
    // t_original can be any size (original uploaded image), so we don't estimate
    const url = 'https://images.igdb.com/igdb/image/upload/t_original/abc123.jpg';
    const result = inferIGDBDimensions(url);
    
    expect(result).toBeNull();
  });

  it('should return null for URLs with IGDB substring but not real IGDB domain', () => {
    // This URL doesn't have the real IGDB structure - it's just a string containing the domain
    const url = 'https://example.com/images?from=igdb.com/t_1080p/image.jpg';
    const result = inferIGDBDimensions(url);
    
    // The function uses substring matching, so this would match if 'images.igdb.com' is in the URL
    // For URLs that don't contain the exact 'images.igdb.com' string, it should return null
    expect(result).toBeNull();
  });

  it('should handle URLs with query parameters', () => {
    const url = 'https://images.igdb.com/igdb/image/upload/t_1080p/abc123.jpg?cache=bust';
    const result = inferIGDBDimensions(url);
    
    expect(result).toEqual({ width: 1920, height: 1080 });
  });
});

// ============================================================================
// Dimension Validation Helpers Tests
// ============================================================================

describe('meetsHeroRequirements', () => {
  it('should return true for dimensions meeting default hero width', () => {
    const dims: ImageDimensions = { width: 800, height: 600, inferred: false };
    expect(meetsHeroRequirements(dims)).toBe(true);
  });

  it('should return true for dimensions exceeding hero width', () => {
    const dims: ImageDimensions = { width: 1920, height: 1080, inferred: true };
    expect(meetsHeroRequirements(dims)).toBe(true);
  });

  it('should return false for dimensions below hero width', () => {
    const dims: ImageDimensions = { width: 799, height: 600, inferred: false };
    expect(meetsHeroRequirements(dims)).toBe(false);
  });

  it('should return false for null dimensions', () => {
    expect(meetsHeroRequirements(null)).toBe(false);
  });

  it('should respect custom minWidth', () => {
    const dims: ImageDimensions = { width: 500, height: 400, inferred: false };
    expect(meetsHeroRequirements(dims, 500)).toBe(true);
    expect(meetsHeroRequirements(dims, 501)).toBe(false);
  });
});

describe('meetsSectionRequirements', () => {
  it('should return true for dimensions meeting default section width', () => {
    const dims: ImageDimensions = { width: 500, height: 400, inferred: false };
    expect(meetsSectionRequirements(dims)).toBe(true);
  });

  it('should return true for dimensions exceeding section width', () => {
    const dims: ImageDimensions = { width: 1920, height: 1080, inferred: true };
    expect(meetsSectionRequirements(dims)).toBe(true);
  });

  it('should return false for dimensions below section width', () => {
    const dims: ImageDimensions = { width: 499, height: 400, inferred: false };
    expect(meetsSectionRequirements(dims)).toBe(false);
  });

  it('should return false for null dimensions', () => {
    expect(meetsSectionRequirements(null)).toBe(false);
  });

  it('should respect custom minWidth', () => {
    const dims: ImageDimensions = { width: 600, height: 400, inferred: false };
    expect(meetsSectionRequirements(dims, 700)).toBe(false);
    expect(meetsSectionRequirements(dims, 500)).toBe(true);
  });
});

// ============================================================================
// getImageDimensions Retry Tests
// ============================================================================

// Mock downloadImage for dimension probing tests
vi.mock('../../../src/ai/articles/services/image-downloader', () => ({
  downloadImage: vi.fn(),
}));

// Mock sharp for dimension probing tests
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    metadata: vi.fn(),
  })),
}));

describe('getImageDimensions retry behavior', () => {
  let mockDownloadImage: ReturnType<typeof vi.fn>;
  let mockSharp: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const { downloadImage } = await import('../../../src/ai/articles/services/image-downloader');
    mockDownloadImage = downloadImage as ReturnType<typeof vi.fn>;
    mockDownloadImage.mockReset();

    const sharp = (await import('sharp')).default;
    mockSharp = sharp as unknown as ReturnType<typeof vi.fn>;
    mockSharp.mockReset();
  });

  it('should return inferred dimensions for IGDB URLs without probing', async () => {
    const { getImageDimensions } = await import('../../../src/ai/articles/services/image-dimensions');
    
    const url = 'https://images.igdb.com/igdb/image/upload/t_1080p/abc123.jpg';
    const result = await getImageDimensions(url);

    expect(result).toEqual({ width: 1920, height: 1080, inferred: true });
    // Should not call downloadImage for IGDB URLs
    expect(mockDownloadImage).not.toHaveBeenCalled();
  });

  it('should retry on transient network failure', async () => {
    const { getImageDimensions } = await import('../../../src/ai/articles/services/image-dimensions');
    
    const url = 'https://example.com/image.jpg';
    const mockBuffer = Buffer.from('fake-image');

    // First call fails, second succeeds
    mockDownloadImage
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockResolvedValueOnce({ buffer: mockBuffer, contentType: 'image/jpeg' });

    mockSharp.mockReturnValue({
      metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
    });

    const result = await getImageDimensions(url, { retries: 1 });

    expect(result).toEqual({ width: 800, height: 600, inferred: false });
    expect(mockDownloadImage).toHaveBeenCalledTimes(2);
  });

  it('should return null after all retries exhausted', async () => {
    const { getImageDimensions } = await import('../../../src/ai/articles/services/image-dimensions');
    
    const url = 'https://example.com/image.jpg';

    // All calls fail
    mockDownloadImage.mockRejectedValue(new Error('Network error'));

    const result = await getImageDimensions(url, { retries: 2 });

    expect(result).toBeNull();
    // Initial attempt + 2 retries = 3 calls
    expect(mockDownloadImage).toHaveBeenCalledTimes(3);
  });

  it('should not retry when retries is set to 0', async () => {
    const { getImageDimensions } = await import('../../../src/ai/articles/services/image-dimensions');
    
    const url = 'https://example.com/image.jpg';

    mockDownloadImage.mockRejectedValue(new Error('Network error'));

    const result = await getImageDimensions(url, { retries: 0 });

    expect(result).toBeNull();
    // Only 1 call (no retries)
    expect(mockDownloadImage).toHaveBeenCalledTimes(1);
  });

  it('should succeed on first attempt without retrying', async () => {
    const { getImageDimensions } = await import('../../../src/ai/articles/services/image-dimensions');
    
    const url = 'https://example.com/image.jpg';
    const mockBuffer = Buffer.from('fake-image');

    mockDownloadImage.mockResolvedValue({ buffer: mockBuffer, contentType: 'image/jpeg' });
    mockSharp.mockReturnValue({
      metadata: vi.fn().mockResolvedValue({ width: 1024, height: 768 }),
    });

    const result = await getImageDimensions(url, { retries: 2 });

    expect(result).toEqual({ width: 1024, height: 768, inferred: false });
    // Only 1 call (succeeded first try)
    expect(mockDownloadImage).toHaveBeenCalledTimes(1);
  });
});
