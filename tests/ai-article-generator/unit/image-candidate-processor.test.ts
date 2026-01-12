/**
 * Tests for the image candidate processor service.
 *
 * Tests the post-selection dimension validation and layout determination.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  processHeroCandidates,
  processSectionCandidates,
  processAllSectionCandidates,
  toHeroAssignment,
  toSectionAssignment,
  toSectionAssignments,
  type ProcessedHeroResult,
  type ProcessedSectionResult,
} from '../../../src/ai/articles/services/image-candidate-processor';
import type { HeroCandidateOutput, SectionSelectionOutput } from '../../../src/ai/articles/agents/image-curator';
import type { CollectedImage } from '../../../src/ai/articles/image-pool';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockImage(overrides: Partial<CollectedImage> = {}): CollectedImage {
  return {
    url: 'https://images.igdb.com/igdb/image/upload/t_1080p/test123.jpg',
    source: 'igdb',
    isOfficial: true,
    sourceQuality: 80,
    ...overrides,
  };
}

function createMockHeroCandidate(
  imageIndex: number,
  image: CollectedImage,
  overrides: Partial<Omit<HeroCandidateOutput, 'imageIndex' | 'image'>> = {}
): HeroCandidateOutput {
  return {
    imageIndex,
    image,
    altText: `Test alt text for image ${imageIndex}`,
    relevanceScore: 85,
    ...overrides,
  };
}

function createMockSectionSelection(
  sectionHeadline: string,
  sectionIndex: number,
  candidates: Array<{
    imageIndex: number;
    image: CollectedImage;
  }>
): SectionSelectionOutput {
  return {
    sectionHeadline,
    sectionIndex,
    candidates: candidates.map((c, idx) => ({
      imageIndex: c.imageIndex,
      image: c.image,
      altText: `Alt text for ${sectionHeadline} image ${idx}`,
      relevanceScore: 80 - idx * 10, // First candidate has highest score
    })),
  };
}

// ============================================================================
// Mocks for downloadImage and sharp
// ============================================================================

// Mock the image-downloader module
vi.mock('../../../src/ai/articles/services/image-downloader', () => ({
  downloadImage: vi.fn(),
}));

// Mock sharp module
vi.mock('sharp', () => {
  const mockMetadata = vi.fn();
  const mockSharp = vi.fn(() => ({
    metadata: mockMetadata,
  }));
  (mockSharp as unknown as { metadata: typeof mockMetadata }).metadata = mockMetadata;
  return { default: mockSharp };
});

import { downloadImage } from '../../../src/ai/articles/services/image-downloader';
import sharp from 'sharp';
const mockDownloadImage = vi.mocked(downloadImage);
const mockSharp = vi.mocked(sharp);

/**
 * Helper to set up mock for successful image download and dimension check.
 */
function mockImageDownloadAndDimensions(
  width: number,
  height: number,
  url?: string
): void {
  const buffer = Buffer.from('mock image data');
  mockDownloadImage.mockResolvedValueOnce({
    buffer,
    mimeType: 'image/jpeg',
    size: buffer.length,
    sourceUrl: url ?? 'https://example.com/test.jpg',
  });
  (mockSharp as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
    metadata: vi.fn().mockResolvedValueOnce({ width, height, format: 'jpeg' }),
  });
}

/**
 * Helper to set up mock for failed image download.
 */
function mockImageDownloadFailure(error: Error = new Error('Download failed')): void {
  mockDownloadImage.mockRejectedValueOnce(error);
}

beforeEach(() => {
  mockDownloadImage.mockReset();
  mockSharp.mockReset();
});

// ============================================================================
// processHeroCandidates Tests
// ============================================================================

describe('processHeroCandidates', () => {
  it('should return first candidate that meets dimension requirements', async () => {
    const image1 = createMockImage({ url: 'https://example.com/small.jpg' });
    const image2 = createMockImage({ url: 'https://example.com/large.jpg' });
    
    const candidates = [
      createMockHeroCandidate(0, image1),
      createMockHeroCandidate(1, image2),
    ];

    // First image too small, second meets requirements
    mockImageDownloadAndDimensions(600, 400);
    mockImageDownloadAndDimensions(1200, 800);

    const result = await processHeroCandidates(candidates, { minWidth: 800 });

    expect(result).not.toBeNull();
    expect(result?.image).toBe(image2);
    expect(result?.selectedCandidateIndex).toBe(1);
    expect(result?.dimensions.width).toBe(1200);
    expect(result?.buffer).toBeDefined();
    expect(result?.mimeType).toBe('image/jpeg');
  });

  it('should return first candidate when it meets requirements', async () => {
    const image1 = createMockImage({ url: 'https://example.com/perfect.jpg' });
    const image2 = createMockImage({ url: 'https://example.com/also-good.jpg' });
    
    const candidates = [
      createMockHeroCandidate(0, image1),
      createMockHeroCandidate(1, image2),
    ];

    mockImageDownloadAndDimensions(1920, 1080);

    const result = await processHeroCandidates(candidates, { minWidth: 800 });

    expect(result).not.toBeNull();
    expect(result?.image).toBe(image1);
    expect(result?.selectedCandidateIndex).toBe(0);
    // Should only download first candidate since it passes
    expect(mockDownloadImage).toHaveBeenCalledTimes(1);
  });

  it('should return null if no candidates meet requirements', async () => {
    const image1 = createMockImage({ url: 'https://example.com/small1.jpg' });
    const image2 = createMockImage({ url: 'https://example.com/small2.jpg' });
    
    const candidates = [
      createMockHeroCandidate(0, image1),
      createMockHeroCandidate(1, image2),
    ];

    mockImageDownloadAndDimensions(400, 300);
    mockImageDownloadAndDimensions(500, 350);

    const result = await processHeroCandidates(candidates, { minWidth: 800 });

    expect(result).toBeNull();
  });

  it('should skip candidates that fail to download', async () => {
    const image1 = createMockImage({ url: 'https://example.com/broken.jpg' });
    const image2 = createMockImage({ url: 'https://example.com/working.jpg' });
    
    const candidates = [
      createMockHeroCandidate(0, image1),
      createMockHeroCandidate(1, image2),
    ];

    mockImageDownloadFailure(); // First fails to download
    mockImageDownloadAndDimensions(1000, 700);

    const result = await processHeroCandidates(candidates, { minWidth: 800 });

    expect(result).not.toBeNull();
    expect(result?.image).toBe(image2);
    expect(result?.selectedCandidateIndex).toBe(1);
  });

  it('should return null for empty candidates array', async () => {
    const result = await processHeroCandidates([], { minWidth: 800 });
    expect(result).toBeNull();
  });

  it('should include buffer and mimeType in result', async () => {
    const image = createMockImage();
    const candidates = [createMockHeroCandidate(0, image)];

    mockImageDownloadAndDimensions(1920, 1080);

    const result = await processHeroCandidates(candidates, { minWidth: 800 });

    expect(result?.buffer).toBeDefined();
    expect(result?.buffer.length).toBeGreaterThan(0);
    expect(result?.mimeType).toBe('image/jpeg');
  });

  describe('quality validator', () => {
    it('should call quality validator after dimension check passes', async () => {
      const image = createMockImage();
      const candidates = [createMockHeroCandidate(0, image)];
      const qualityValidator = vi.fn().mockResolvedValue({ passed: true });

      mockImageDownloadAndDimensions(1920, 1080);

      const result = await processHeroCandidates(candidates, {
        minWidth: 800,
        qualityValidator,
      });

      expect(result).not.toBeNull();
      expect(qualityValidator).toHaveBeenCalledTimes(1);
      expect(qualityValidator).toHaveBeenCalledWith(
        expect.any(Buffer),
        'image/jpeg'
      );
    });

    it('should try next candidate when quality validator rejects', async () => {
      const image1 = createMockImage({ url: 'https://example.com/watermarked.jpg' });
      const image2 = createMockImage({ url: 'https://example.com/clean.jpg' });
      const candidates = [
        createMockHeroCandidate(0, image1),
        createMockHeroCandidate(1, image2),
      ];
      const qualityValidator = vi.fn()
        .mockResolvedValueOnce({ passed: false, reason: 'Watermark detected' })
        .mockResolvedValueOnce({ passed: true });

      // Both images pass dimension check
      mockImageDownloadAndDimensions(1920, 1080);
      mockImageDownloadAndDimensions(1920, 1080);

      const result = await processHeroCandidates(candidates, {
        minWidth: 800,
        qualityValidator,
      });

      expect(result).not.toBeNull();
      expect(result?.image).toBe(image2); // Second image selected
      expect(result?.selectedCandidateIndex).toBe(1);
      expect(qualityValidator).toHaveBeenCalledTimes(2);
    });

    it('should return null when all candidates fail quality validation', async () => {
      const image1 = createMockImage({ url: 'https://example.com/bad1.jpg' });
      const image2 = createMockImage({ url: 'https://example.com/bad2.jpg' });
      const candidates = [
        createMockHeroCandidate(0, image1),
        createMockHeroCandidate(1, image2),
      ];
      const qualityValidator = vi.fn().mockResolvedValue({
        passed: false,
        reason: 'Watermark detected',
      });

      // Both images pass dimension check but fail quality
      mockImageDownloadAndDimensions(1920, 1080);
      mockImageDownloadAndDimensions(1920, 1080);

      const result = await processHeroCandidates(candidates, {
        minWidth: 800,
        qualityValidator,
      });

      expect(result).toBeNull();
      expect(qualityValidator).toHaveBeenCalledTimes(2);
    });

    it('should not call quality validator when dimension check fails', async () => {
      const image = createMockImage();
      const candidates = [createMockHeroCandidate(0, image)];
      const qualityValidator = vi.fn();

      // Image fails dimension check
      mockImageDownloadAndDimensions(400, 300);

      const result = await processHeroCandidates(candidates, {
        minWidth: 800,
        qualityValidator,
      });

      expect(result).toBeNull();
      expect(qualityValidator).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// processSectionCandidates Tests
// ============================================================================

describe('processSectionCandidates', () => {
  it('should return result for images >= minWidth', async () => {
    const image = createMockImage({ url: 'https://example.com/wide.jpg' });
    const selection = createMockSectionSelection('Boss Guide', 0, [
      { imageIndex: 0, image },
    ]);

    mockImageDownloadAndDimensions(600, 400);

    const result = await processSectionCandidates(selection, {
      minWidth: 500,
    });

    expect(result).not.toBeNull();
    expect(result?.sectionHeadline).toBe('Boss Guide');
    expect(result?.sectionIndex).toBe(0);
    expect(result?.dimensions.width).toBe(600);
    expect(result?.buffer).toBeDefined();
  });

  it('should skip candidates below minWidth and try next', async () => {
    const image1 = createMockImage({ url: 'https://example.com/tiny.jpg' });
    const image2 = createMockImage({ url: 'https://example.com/good.jpg' });
    const selection = createMockSectionSelection('Location', 1, [
      { imageIndex: 0, image: image1 },
      { imageIndex: 1, image: image2 },
    ]);

    mockImageDownloadAndDimensions(350, 250); // Too small
    mockImageDownloadAndDimensions(550, 400); // Good

    const result = await processSectionCandidates(selection, {
      minWidth: 500,
    });

    expect(result).not.toBeNull();
    expect(result?.image).toBe(image2);
    expect(result?.selectedCandidateIndex).toBe(1);
  });

  it('should return null if all candidates are too small', async () => {
    const image1 = createMockImage({ url: 'https://example.com/tiny1.jpg' });
    const image2 = createMockImage({ url: 'https://example.com/tiny2.jpg' });
    const selection = createMockSectionSelection('Strategy', 3, [
      { imageIndex: 0, image: image1 },
      { imageIndex: 1, image: image2 },
    ]);

    mockImageDownloadAndDimensions(200, 150);
    mockImageDownloadAndDimensions(300, 200);

    const result = await processSectionCandidates(selection, {
      minWidth: 500,
    });

    expect(result).toBeNull();
  });

  it('should return first candidate when it meets requirements', async () => {
    const image = createMockImage({ url: 'https://example.com/good.jpg' });
    const selection = createMockSectionSelection('Characters', 4, [
      { imageIndex: 0, image },
    ]);

    mockImageDownloadAndDimensions(600, 800);

    const result = await processSectionCandidates(selection, {
      minWidth: 500,
    });

    expect(result).not.toBeNull();
    expect(result?.dimensions.width).toBe(600);
  });

  it('should preserve caption from candidate', async () => {
    const image = createMockImage();
    const selection: SectionSelectionOutput = {
      sectionHeadline: 'Weapons',
      sectionIndex: 0,
      candidates: [{
        imageIndex: 0,
        image,
        altText: 'Weapon screenshot',
        caption: 'The legendary sword',
        relevanceScore: 90,
      }],
    };

    mockImageDownloadAndDimensions(800, 600);

    const result = await processSectionCandidates(selection, {
      minWidth: 500,
    });

    expect(result?.caption).toBe('The legendary sword');
  });

  it('should skip excluded URLs (deduplication)', async () => {
    const heroImage = createMockImage({ url: 'https://example.com/hero.jpg' });
    const sectionImage = createMockImage({ url: 'https://example.com/section.jpg' });
    
    const selection = createMockSectionSelection('Boss Guide', 0, [
      { imageIndex: 0, image: heroImage },  // Same as hero - should be skipped
      { imageIndex: 1, image: sectionImage }, // Different - should be selected
    ]);

    // Only the second candidate should be downloaded (first is excluded)
    mockImageDownloadAndDimensions(800, 600);

    const result = await processSectionCandidates(selection, {
      minWidth: 500,
      excludeUrls: ['https://example.com/hero.jpg'],
    });

    expect(result).not.toBeNull();
    expect(result?.image.url).toBe('https://example.com/section.jpg');
    // Should only have downloaded once (skipped the excluded URL)
    expect(mockDownloadImage).toHaveBeenCalledTimes(1);
  });

  it('should handle IGDB URL deduplication (same image different sizes)', async () => {
    // Hero uses 1080p size, section candidate uses screenshot_big size
    const heroImage = createMockImage({ 
      url: 'https://images.igdb.com/igdb/image/upload/t_1080p/abc123.jpg' 
    });
    const sameImageDifferentSize = createMockImage({ 
      url: 'https://images.igdb.com/igdb/image/upload/t_screenshot_big/abc123.jpg' 
    });
    const differentImage = createMockImage({ 
      url: 'https://images.igdb.com/igdb/image/upload/t_1080p/xyz789.jpg' 
    });
    
    const selection = createMockSectionSelection('Combat', 1, [
      { imageIndex: 0, image: sameImageDifferentSize },  // Same IGDB image - should be skipped
      { imageIndex: 1, image: differentImage }, // Different image - should be selected
    ]);

    // Only download the different image
    mockImageDownloadAndDimensions(1920, 1080);

    const result = await processSectionCandidates(selection, {
      minWidth: 500,
      excludeUrls: [heroImage.url],
    });

    expect(result).not.toBeNull();
    expect(result?.image.url).toContain('xyz789');
    expect(mockDownloadImage).toHaveBeenCalledTimes(1);
  });

  it('should return null if all candidates are excluded', async () => {
    const heroImage = createMockImage({ url: 'https://example.com/hero.jpg' });
    
    const selection = createMockSectionSelection('Intro', 0, [
      { imageIndex: 0, image: heroImage }, // Excluded
    ]);

    const result = await processSectionCandidates(selection, {
      minWidth: 500,
      excludeUrls: ['https://example.com/hero.jpg'],
    });

    expect(result).toBeNull();
    // No download should happen since all candidates were excluded
    expect(mockDownloadImage).not.toHaveBeenCalled();
  });
});

// ============================================================================
// processAllSectionCandidates Tests
// ============================================================================

describe('processAllSectionCandidates', () => {
  it('should process all sections sequentially for deduplication', async () => {
    const image1 = createMockImage({ url: 'https://example.com/img1.jpg' });
    const image2 = createMockImage({ url: 'https://example.com/img2.jpg' });
    
    const selections = [
      createMockSectionSelection('Section A', 0, [{ imageIndex: 0, image: image1 }]),
      createMockSectionSelection('Section B', 1, [{ imageIndex: 0, image: image2 }]),
    ];

    mockImageDownloadAndDimensions(800, 600);
    mockImageDownloadAndDimensions(600, 400);

    const results = await processAllSectionCandidates(selections);

    expect(results).toHaveLength(2);
    expect(results[0]?.sectionHeadline).toBe('Section A');
    expect(results[1]?.sectionHeadline).toBe('Section B');
    expect(results[0]?.buffer).toBeDefined();
    expect(results[1]?.buffer).toBeDefined();
  });

  it('should pass excludeUrls to each section processing', async () => {
    const heroImage = createMockImage({ url: 'https://example.com/hero.jpg' });
    const section1Image = createMockImage({ url: 'https://example.com/s1.jpg' });
    const section2Image = createMockImage({ url: 'https://example.com/s2.jpg' });
    
    const selections = [
      createMockSectionSelection('Section 1', 0, [
        { imageIndex: 0, image: heroImage },  // Excluded
        { imageIndex: 1, image: section1Image },
      ]),
      createMockSectionSelection('Section 2', 1, [
        { imageIndex: 0, image: heroImage },  // Excluded
        { imageIndex: 1, image: section2Image },
      ]),
    ];

    mockImageDownloadAndDimensions(800, 600);
    mockImageDownloadAndDimensions(700, 500);

    const results = await processAllSectionCandidates(selections, {
      excludeUrls: [heroImage.url],
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.image.url).toBe('https://example.com/s1.jpg');
    expect(results[1]?.image.url).toBe('https://example.com/s2.jpg');
    // Only 2 downloads (hero images were excluded)
    expect(mockDownloadImage).toHaveBeenCalledTimes(2);
  });

  it('should include null for sections with no valid candidates', async () => {
    const image1 = createMockImage({ url: 'https://example.com/good.jpg' });
    const image2 = createMockImage({ url: 'https://example.com/tiny.jpg' });
    
    const selections = [
      createMockSectionSelection('Good Section', 0, [{ imageIndex: 0, image: image1 }]),
      createMockSectionSelection('Bad Section', 1, [{ imageIndex: 0, image: image2 }]),
    ];

    mockImageDownloadAndDimensions(800, 600);
    mockImageDownloadAndDimensions(100, 80); // Too small

    const results = await processAllSectionCandidates(selections, {
      minWidth: 500,
    });

    expect(results).toHaveLength(2);
    expect(results[0]).not.toBeNull();
    expect(results[1]).toBeNull();
  });

  it('should prevent cross-section duplicates (Section A image excluded from Section B)', async () => {
    // Same image appears in both sections' candidate lists
    const sharedImage = createMockImage({ url: 'https://example.com/shared.jpg' });
    const backupImage = createMockImage({ url: 'https://example.com/backup.jpg' });
    
    const selections = [
      // Section A has shared image as first candidate
      createMockSectionSelection('Section A', 0, [
        { imageIndex: 0, image: sharedImage },
      ]),
      // Section B has shared image as first candidate, backup as second
      createMockSectionSelection('Section B', 1, [
        { imageIndex: 0, image: sharedImage },
        { imageIndex: 1, image: backupImage },
      ]),
    ];

    // First download: Section A downloads shared image (succeeds)
    // Second download: Section B downloads backup image (shared is excluded)
    mockImageDownloadAndDimensions(800, 600); // shared for A
    mockImageDownloadAndDimensions(700, 500); // backup for B

    const results = await processAllSectionCandidates(selections, {
      minWidth: 500,
    });

    expect(results).toHaveLength(2);
    // Section A gets the shared image
    expect(results[0]?.image.url).toBe('https://example.com/shared.jpg');
    // Section B gets the backup (shared is excluded because Section A used it)
    expect(results[1]?.image.url).toBe('https://example.com/backup.jpg');
    // Only 2 downloads (shared once, backup once)
    expect(mockDownloadImage).toHaveBeenCalledTimes(2);
  });

  it('should handle download failures gracefully', async () => {
    const image1 = createMockImage({ url: 'https://example.com/good.jpg' });
    const image2 = createMockImage({ url: 'https://example.com/broken.jpg' });
    
    const selections = [
      createMockSectionSelection('Good Section', 0, [{ imageIndex: 0, image: image1 }]),
      createMockSectionSelection('Broken Section', 1, [{ imageIndex: 0, image: image2 }]),
    ];

    mockImageDownloadAndDimensions(800, 600);
    mockImageDownloadFailure();

    const results = await processAllSectionCandidates(selections, {
      minWidth: 500,
    });

    expect(results).toHaveLength(2);
    expect(results[0]).not.toBeNull();
    expect(results[1]).toBeNull(); // Failed section returns null
  });
});

// ============================================================================
// Conversion Helper Tests
// ============================================================================

describe('toHeroAssignment', () => {
  it('should convert ProcessedHeroResult to HeroImageAssignment', () => {
    const image = createMockImage();
    const result: ProcessedHeroResult = {
      image,
      altText: 'Test hero image',
      dimensions: { width: 1920, height: 1080, inferred: true },
      selectedCandidateIndex: 0,
      buffer: Buffer.from('test'),
      mimeType: 'image/jpeg',
    };

    const assignment = toHeroAssignment(result);

    expect(assignment.image).toBe(image);
    expect(assignment.altText).toBe('Test hero image');
  });
});

describe('toSectionAssignment', () => {
  it('should convert ProcessedSectionResult to SectionImageAssignment', () => {
    const image = createMockImage();
    const result: ProcessedSectionResult = {
      sectionHeadline: 'Boss Fight',
      sectionIndex: 2,
      image,
      altText: 'Boss screenshot',
      caption: 'Phase 2 attack pattern',
      dimensions: { width: 800, height: 600, inferred: false },
      selectedCandidateIndex: 0,
      buffer: Buffer.from('test'),
      mimeType: 'image/jpeg',
    };

    const assignment = toSectionAssignment(result);

    expect(assignment.sectionHeadline).toBe('Boss Fight');
    expect(assignment.sectionIndex).toBe(2);
    expect(assignment.image).toBe(image);
    expect(assignment.altText).toBe('Boss screenshot');
    expect(assignment.caption).toBe('Phase 2 attack pattern');
  });

  it('should handle undefined caption', () => {
    const image = createMockImage();
    const result: ProcessedSectionResult = {
      sectionHeadline: 'Items',
      sectionIndex: 3,
      image,
      altText: 'Item icon',
      dimensions: { width: 600, height: 400, inferred: false },
      selectedCandidateIndex: 1,
      buffer: Buffer.from('test'),
      mimeType: 'image/jpeg',
    };

    const assignment = toSectionAssignment(result);

    expect(assignment.caption).toBeUndefined();
  });
});

describe('toSectionAssignments', () => {
  it('should convert array and filter out nulls', () => {
    const image1 = createMockImage({ url: 'https://example.com/1.jpg' });
    const image2 = createMockImage({ url: 'https://example.com/2.jpg' });
    
    const results: (ProcessedSectionResult | null)[] = [
      {
        sectionHeadline: 'Section 1',
        sectionIndex: 0,
        image: image1,
        altText: 'Alt 1',
        dimensions: { width: 800, height: 600, inferred: false },
        selectedCandidateIndex: 0,
        buffer: Buffer.from('test1'),
        mimeType: 'image/jpeg',
      },
      null, // Failed section
      {
        sectionHeadline: 'Section 3',
        sectionIndex: 2,
        image: image2,
        altText: 'Alt 3',
        dimensions: { width: 600, height: 450, inferred: false },
        selectedCandidateIndex: 0,
        buffer: Buffer.from('test3'),
        mimeType: 'image/png',
      },
    ];

    const assignments = toSectionAssignments(results);

    expect(assignments).toHaveLength(2);
    expect(assignments[0].sectionHeadline).toBe('Section 1');
    expect(assignments[1].sectionHeadline).toBe('Section 3');
  });

  it('should return empty array for all-null results', () => {
    const results: (ProcessedSectionResult | null)[] = [null, null, null];
    
    const assignments = toSectionAssignments(results);
    
    expect(assignments).toHaveLength(0);
  });
});
