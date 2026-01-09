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
    priority: 80,
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
// Mock getImageDimensions
// ============================================================================

// Mock the image-dimensions module
vi.mock('../../../src/ai/articles/services/image-dimensions', async () => {
  const actual = await vi.importActual('../../../src/ai/articles/services/image-dimensions');
  return {
    ...actual,
    getImageDimensions: vi.fn(),
  };
});

import { getImageDimensions } from '../../../src/ai/articles/services/image-dimensions';
const mockGetImageDimensions = vi.mocked(getImageDimensions);

beforeEach(() => {
  mockGetImageDimensions.mockReset();
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
    mockGetImageDimensions
      .mockResolvedValueOnce({ width: 600, height: 400, inferred: false })
      .mockResolvedValueOnce({ width: 1200, height: 800, inferred: false });

    const result = await processHeroCandidates(candidates, { minWidth: 800 });

    expect(result).not.toBeNull();
    expect(result?.image).toBe(image2);
    expect(result?.selectedCandidateIndex).toBe(1);
    expect(result?.dimensions.width).toBe(1200);
  });

  it('should return first candidate when it meets requirements', async () => {
    const image1 = createMockImage({ url: 'https://example.com/perfect.jpg' });
    const image2 = createMockImage({ url: 'https://example.com/also-good.jpg' });
    
    const candidates = [
      createMockHeroCandidate(0, image1),
      createMockHeroCandidate(1, image2),
    ];

    mockGetImageDimensions.mockResolvedValueOnce({ width: 1920, height: 1080, inferred: true });

    const result = await processHeroCandidates(candidates, { minWidth: 800 });

    expect(result).not.toBeNull();
    expect(result?.image).toBe(image1);
    expect(result?.selectedCandidateIndex).toBe(0);
    // Should only check first candidate since it passes
    expect(mockGetImageDimensions).toHaveBeenCalledTimes(1);
  });

  it('should return null if no candidates meet requirements', async () => {
    const image1 = createMockImage({ url: 'https://example.com/small1.jpg' });
    const image2 = createMockImage({ url: 'https://example.com/small2.jpg' });
    
    const candidates = [
      createMockHeroCandidate(0, image1),
      createMockHeroCandidate(1, image2),
    ];

    mockGetImageDimensions
      .mockResolvedValueOnce({ width: 400, height: 300, inferred: false })
      .mockResolvedValueOnce({ width: 500, height: 350, inferred: false });

    const result = await processHeroCandidates(candidates, { minWidth: 800 });

    expect(result).toBeNull();
  });

  it('should skip candidates that fail dimension probing', async () => {
    const image1 = createMockImage({ url: 'https://example.com/broken.jpg' });
    const image2 = createMockImage({ url: 'https://example.com/working.jpg' });
    
    const candidates = [
      createMockHeroCandidate(0, image1),
      createMockHeroCandidate(1, image2),
    ];

    mockGetImageDimensions
      .mockResolvedValueOnce(null) // Failed to get dimensions
      .mockResolvedValueOnce({ width: 1000, height: 700, inferred: false });

    const result = await processHeroCandidates(candidates, { minWidth: 800 });

    expect(result).not.toBeNull();
    expect(result?.image).toBe(image2);
    expect(result?.selectedCandidateIndex).toBe(1);
  });

  it('should return null for empty candidates array', async () => {
    const result = await processHeroCandidates([], { minWidth: 800 });
    expect(result).toBeNull();
  });

  it('should preserve inferred flag from dimension check', async () => {
    const image = createMockImage();
    const candidates = [createMockHeroCandidate(0, image)];

    mockGetImageDimensions.mockResolvedValueOnce({ width: 1920, height: 1080, inferred: true });

    const result = await processHeroCandidates(candidates, { minWidth: 800 });

    expect(result?.dimensions.inferred).toBe(true);
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

    mockGetImageDimensions.mockResolvedValueOnce({ width: 600, height: 400, inferred: false });

    const result = await processSectionCandidates(selection, {
      minWidth: 500,
    });

    expect(result).not.toBeNull();
    expect(result?.sectionHeadline).toBe('Boss Guide');
    expect(result?.sectionIndex).toBe(0);
    expect(result?.dimensions.width).toBe(600);
  });

  it('should skip candidates below minWidth and try next', async () => {
    const image1 = createMockImage({ url: 'https://example.com/tiny.jpg' });
    const image2 = createMockImage({ url: 'https://example.com/good.jpg' });
    const selection = createMockSectionSelection('Location', 1, [
      { imageIndex: 0, image: image1 },
      { imageIndex: 1, image: image2 },
    ]);

    mockGetImageDimensions
      .mockResolvedValueOnce({ width: 350, height: 250, inferred: false }) // Too small
      .mockResolvedValueOnce({ width: 550, height: 400, inferred: false }); // Good

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

    mockGetImageDimensions
      .mockResolvedValueOnce({ width: 200, height: 150, inferred: false })
      .mockResolvedValueOnce({ width: 300, height: 200, inferred: false });

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

    mockGetImageDimensions.mockResolvedValueOnce({ width: 600, height: 800, inferred: false });

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

    mockGetImageDimensions.mockResolvedValueOnce({ width: 800, height: 600, inferred: false });

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

    // Only the second candidate should be checked (first is excluded)
    mockGetImageDimensions.mockResolvedValueOnce({ width: 800, height: 600, inferred: false });

    const result = await processSectionCandidates(selection, {
      minWidth: 500,
      excludeUrls: ['https://example.com/hero.jpg'],
    });

    expect(result).not.toBeNull();
    expect(result?.image.url).toBe('https://example.com/section.jpg');
    // Should only have called getImageDimensions once (skipped the excluded URL)
    expect(mockGetImageDimensions).toHaveBeenCalledTimes(1);
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

    // Only check the different image
    mockGetImageDimensions.mockResolvedValueOnce({ width: 1920, height: 1080, inferred: true });

    const result = await processSectionCandidates(selection, {
      minWidth: 500,
      excludeUrls: [heroImage.url],
    });

    expect(result).not.toBeNull();
    expect(result?.image.url).toContain('xyz789');
    expect(mockGetImageDimensions).toHaveBeenCalledTimes(1);
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
    // No dimension check should happen since all candidates were excluded
    expect(mockGetImageDimensions).not.toHaveBeenCalled();
  });
});

// ============================================================================
// processAllSectionCandidates Tests
// ============================================================================

describe('processAllSectionCandidates', () => {
  it('should process all sections in parallel', async () => {
    const image1 = createMockImage({ url: 'https://example.com/img1.jpg' });
    const image2 = createMockImage({ url: 'https://example.com/img2.jpg' });
    
    const selections = [
      createMockSectionSelection('Section A', 0, [{ imageIndex: 0, image: image1 }]),
      createMockSectionSelection('Section B', 1, [{ imageIndex: 0, image: image2 }]),
    ];

    mockGetImageDimensions
      .mockResolvedValueOnce({ width: 800, height: 600, inferred: false })
      .mockResolvedValueOnce({ width: 600, height: 400, inferred: false });

    const results = await processAllSectionCandidates(selections);

    expect(results).toHaveLength(2);
    expect(results[0]?.sectionHeadline).toBe('Section A');
    expect(results[1]?.sectionHeadline).toBe('Section B');
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

    mockGetImageDimensions
      .mockResolvedValueOnce({ width: 800, height: 600, inferred: false })
      .mockResolvedValueOnce({ width: 700, height: 500, inferred: false });

    const results = await processAllSectionCandidates(selections, {
      excludeUrls: [heroImage.url],
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.image.url).toBe('https://example.com/s1.jpg');
    expect(results[1]?.image.url).toBe('https://example.com/s2.jpg');
    // Only 2 dimension checks (hero images were excluded)
    expect(mockGetImageDimensions).toHaveBeenCalledTimes(2);
  });

  it('should include null for sections with no valid candidates', async () => {
    const image1 = createMockImage({ url: 'https://example.com/good.jpg' });
    const image2 = createMockImage({ url: 'https://example.com/tiny.jpg' });
    
    const selections = [
      createMockSectionSelection('Good Section', 0, [{ imageIndex: 0, image: image1 }]),
      createMockSectionSelection('Bad Section', 1, [{ imageIndex: 0, image: image2 }]),
    ];

    mockGetImageDimensions
      .mockResolvedValueOnce({ width: 800, height: 600, inferred: false })
      .mockResolvedValueOnce({ width: 100, height: 80, inferred: false }); // Too small

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

    // First call: Section A probes shared image (succeeds)
    // Second call: Section B probes backup image (shared is excluded)
    mockGetImageDimensions
      .mockResolvedValueOnce({ width: 800, height: 600, inferred: false })  // shared for A
      .mockResolvedValueOnce({ width: 700, height: 500, inferred: false }); // backup for B

    const results = await processAllSectionCandidates(selections, {
      minWidth: 500,
    });

    expect(results).toHaveLength(2);
    // Section A gets the shared image
    expect(results[0]?.image.url).toBe('https://example.com/shared.jpg');
    // Section B gets the backup (shared is excluded because Section A used it)
    expect(results[1]?.image.url).toBe('https://example.com/backup.jpg');
    // Only 2 dimension checks (shared once, backup once)
    expect(mockGetImageDimensions).toHaveBeenCalledTimes(2);
  });

  it('should use dimension cache to avoid redundant probes', async () => {
    // Same image URL appears in different sections' candidate lists
    const sameUrlImage1 = createMockImage({ url: 'https://example.com/image.jpg' });
    const sameUrlImage2 = createMockImage({ url: 'https://example.com/image.jpg' });
    const differentImage = createMockImage({ url: 'https://example.com/other.jpg' });
    
    const selections = [
      // Section A: same URL image (will be selected)
      createMockSectionSelection('Section A', 0, [
        { imageIndex: 0, image: sameUrlImage1 },
      ]),
      // Section B: same URL (excluded), then different image
      createMockSectionSelection('Section B', 1, [
        { imageIndex: 0, image: sameUrlImage2 }, // Same URL - will be excluded
        { imageIndex: 1, image: differentImage },
      ]),
    ];

    mockGetImageDimensions
      .mockResolvedValueOnce({ width: 800, height: 600, inferred: false })  // image.jpg
      .mockResolvedValueOnce({ width: 700, height: 500, inferred: false }); // other.jpg

    const results = await processAllSectionCandidates(selections, {
      minWidth: 500,
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.image.url).toBe('https://example.com/image.jpg');
    expect(results[1]?.image.url).toBe('https://example.com/other.jpg');
    // Only 2 probes: image.jpg probed once, other.jpg probed once
    // (image.jpg not re-probed for Section B because it's excluded via dedup)
    expect(mockGetImageDimensions).toHaveBeenCalledTimes(2);
  });

  it('should use cached dimensions when same URL appears and is not excluded', async () => {
    // Two sections with same image URL where first section rejects it (too small)
    // Second section should use cached dimensions instead of re-probing
    const tinyImage = createMockImage({ url: 'https://example.com/tiny.jpg' });
    const goodImage = createMockImage({ url: 'https://example.com/good.jpg' });
    
    const selections = [
      // Section A: tiny image only (will fail, returns null)
      createMockSectionSelection('Section A', 0, [
        { imageIndex: 0, image: tinyImage },
      ]),
      // Section B: tiny image (should use cache), then good image
      createMockSectionSelection('Section B', 1, [
        { imageIndex: 0, image: tinyImage }, // Same URL, will use cache
        { imageIndex: 1, image: goodImage },
      ]),
    ];

    mockGetImageDimensions
      .mockResolvedValueOnce({ width: 100, height: 80, inferred: false })   // tiny.jpg (too small)
      .mockResolvedValueOnce({ width: 800, height: 600, inferred: false }); // good.jpg

    const results = await processAllSectionCandidates(selections, {
      minWidth: 500,
    });

    expect(results).toHaveLength(2);
    // Section A fails (tiny image too small)
    expect(results[0]).toBeNull();
    // Section B succeeds with good image (tiny used cached dims, still too small)
    expect(results[1]?.image.url).toBe('https://example.com/good.jpg');
    // Only 2 probes total (tiny.jpg cached, not re-probed for Section B)
    expect(mockGetImageDimensions).toHaveBeenCalledTimes(2);
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
      },
      null, // Failed section
      {
        sectionHeadline: 'Section 3',
        sectionIndex: 2,
        image: image2,
        altText: 'Alt 3',
        dimensions: { width: 600, height: 450, inferred: false },
        selectedCandidateIndex: 0,
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
