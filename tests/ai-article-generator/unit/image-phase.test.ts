/**
 * Image Phase Orchestrator Tests
 *
 * Tests for the image phase which orchestrates:
 * - Image extraction from research pool
 * - Image curator selection
 * - Hero image processing
 * - Section image uploads
 * - Markdown insertion
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Core } from '@strapi/strapi';
import type { LanguageModel } from 'ai';
import type { ArticlePlan } from '../../../src/ai/articles/article-plan';
import type { GameArticleContext, ResearchPool, CategorizedSearchResult } from '../../../src/ai/articles/types';
import type { ImageCuratorOutput, SectionImageAssignment, HeroImageAssignment } from '../../../src/ai/articles/agents/image-curator';
import type { ImageUploadResult } from '../../../src/ai/articles/services/image-uploader';
import type { HeroImageResult } from '../../../src/ai/articles/hero-image';
import type { ImageInsertionResult } from '../../../src/ai/articles/image-inserter';
import type { ProcessedHeroResult, ProcessedSectionResult } from '../../../src/ai/articles/services/image-candidate-processor';

// ============================================================================
// Mocks
// ============================================================================

// Mock the modules that have side effects or external dependencies
vi.mock('../../../src/ai/articles/agents/image-curator', () => ({
  runImageCurator: vi.fn(),
}));

vi.mock('../../../src/ai/articles/hero-image', () => ({
  processHeroImage: vi.fn(),
  getHighResIGDBUrl: vi.fn((url: string) => url.replace(/\/t_[a-z_]+\//, '/t_1080p/')),
}));

vi.mock('../../../src/ai/articles/services/image-uploader', () => ({
  uploadImageFromUrl: vi.fn(),
  uploadImageBuffer: vi.fn(),
  createImageFilename: vi.fn((title: string, section?: string) => 
    section ? `${title}-${section}` : title
  ),
}));

vi.mock('../../../src/ai/articles/image-inserter', () => ({
  insertImagesIntoMarkdown: vi.fn(),
}));

vi.mock('../../../src/ai/articles/services/image-candidate-processor', () => ({
  processHeroCandidates: vi.fn(),
  processAllSectionCandidates: vi.fn(),
  toHeroAssignment: vi.fn((result) => result ? { image: result.image, altText: result.altText } : undefined),
  toSectionAssignments: vi.fn((results) => results.filter((r: unknown) => r !== null).map((r: { sectionHeadline: string; sectionIndex: number; image: unknown; altText: string; caption?: string }) => ({
    sectionHeadline: r.sectionHeadline,
    sectionIndex: r.sectionIndex,
    image: r.image,
    altText: r.altText,
    caption: r.caption,
  }))),
}));

// ============================================================================
// Test Helpers
// ============================================================================

function createMockStrapi(): Core.Strapi {
  return {
    plugin: vi.fn().mockReturnValue({
      service: vi.fn().mockReturnValue({
        upload: vi.fn(),
      }),
    }),
  } as unknown as Core.Strapi;
}

function createMockPlan(sections: string[]): ArticlePlan {
  return {
    title: 'Test Article',
    categorySlug: 'guide',
    excerpt: 'Test excerpt',
    description: 'Test description',
    tags: ['test'],
    sections: sections.map((headline, i) => ({
      headline,
      keyPoints: ['Point 1'],
      researchQueries: ['query 1'],
      priority: i + 1,
    })),
  };
}

function createMockContext(options: Partial<GameArticleContext> = {}): GameArticleContext {
  return {
    gameName: 'Test Game',
    gameSlug: 'test-game',
    gameDocumentId: 'doc-123',
    ...options,
  };
}

function createMockSearchResult(
  query: string,
  options: Partial<CategorizedSearchResult> = {}
): CategorizedSearchResult {
  return {
    query,
    answer: null,
    results: [],
    category: 'overview',
    timestamp: Date.now(),
    searchSource: 'tavily',
    ...options,
  };
}

function createMockResearchPool(
  overviewResults: CategorizedSearchResult[] = [],
  queryCacheEntries: Array<[string, CategorizedSearchResult]> = []
): ResearchPool {
  return {
    scoutFindings: {
      overview: overviewResults,
      categorySpecific: [],
      recent: [],
    },
    allUrls: new Set<string>(),
    queryCache: new Map(queryCacheEntries),
  };
}

function createMockCuratorOutput(options: Partial<ImageCuratorOutput> = {}): ImageCuratorOutput {
  return {
    heroCandidates: [],
    sectionSelections: [],
    tokenUsage: { input: 100, output: 50 },
    poolSummary: { total: 10, igdb: 5, tavily: 3, exa: 2 },
    candidatesPerSection: new Map(),
    heroCandidatePool: [],
    ...options,
  };
}

function createMockUploadResult(options: Partial<ImageUploadResult> = {}): ImageUploadResult {
  return {
    id: 1,
    documentId: 'upload-doc-1',
    url: 'https://example.com/uploaded-image.jpg',
    altText: 'Test image',
    ...options,
  };
}

function createMockHeroAssignment(): HeroImageAssignment {
  return {
    image: {
      url: 'https://images.igdb.com/igdb/image/upload/t_screenshot_big/abc123.jpg',
      source: 'igdb',
      priority: 100,
    },
    altText: 'Hero image alt text',
  };
}

function createMockSectionAssignment(headline: string, index: number): SectionImageAssignment {
  return {
    sectionHeadline: headline,
    sectionIndex: index,
    image: {
      url: `https://example.com/image-${index}.jpg`,
      source: 'tavily',
      sourceDomain: 'example.com',
      priority: 50,
    },
    altText: `Image for ${headline}`,
    caption: `Caption for ${headline}`,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Image Phase', () => {
  let mockRunImageCurator: ReturnType<typeof vi.fn>;
  let mockProcessHeroImage: ReturnType<typeof vi.fn>;
  let mockUploadImageBuffer: ReturnType<typeof vi.fn>;
  let mockUploadImageFromUrl: ReturnType<typeof vi.fn>;
  let mockInsertImagesIntoMarkdown: ReturnType<typeof vi.fn>;
  let mockProcessHeroCandidates: ReturnType<typeof vi.fn>;
  let mockProcessAllSectionCandidates: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Get mocked functions
    const curatorModule = await import('../../../src/ai/articles/agents/image-curator');
    const heroModule = await import('../../../src/ai/articles/hero-image');
    const uploaderModule = await import('../../../src/ai/articles/services/image-uploader');
    const inserterModule = await import('../../../src/ai/articles/image-inserter');
    const candidateProcessorModule = await import('../../../src/ai/articles/services/image-candidate-processor');
    
    mockRunImageCurator = curatorModule.runImageCurator as ReturnType<typeof vi.fn>;
    mockProcessHeroImage = heroModule.processHeroImage as ReturnType<typeof vi.fn>;
    mockUploadImageBuffer = uploaderModule.uploadImageBuffer as ReturnType<typeof vi.fn>;
    mockUploadImageFromUrl = uploaderModule.uploadImageFromUrl as ReturnType<typeof vi.fn>;
    mockInsertImagesIntoMarkdown = inserterModule.insertImagesIntoMarkdown as ReturnType<typeof vi.fn>;
    mockProcessHeroCandidates = candidateProcessorModule.processHeroCandidates as ReturnType<typeof vi.fn>;
    mockProcessAllSectionCandidates = candidateProcessorModule.processAllSectionCandidates as ReturnType<typeof vi.fn>;
    
    // Default mocks for candidate processors - return null (no valid candidates)
    mockProcessHeroCandidates.mockResolvedValue(null);
    mockProcessAllSectionCandidates.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('extractImagesFromResearchPool', () => {
    it('extracts images from scout findings overview', async () => {
      const { extractImagesFromResearchPool } = await import('../../../src/ai/articles/image-phase');
      
      const researchPool = createMockResearchPool([
        createMockSearchResult('test query', {
          images: [
            { url: 'https://example.com/img1.jpg', description: 'Image 1' },
            { url: 'https://example.com/img2.jpg', description: 'Image 2' },
          ],
          searchSource: 'tavily',
        }),
      ]);

      const imagePool = extractImagesFromResearchPool(researchPool);

      expect(imagePool.count).toBe(2);
      expect(imagePool.webImages.length).toBe(2);
      expect(imagePool.webImages[0].url).toBe('https://example.com/img1.jpg');
    });

    it('extracts images from per-result images', async () => {
      const { extractImagesFromResearchPool } = await import('../../../src/ai/articles/image-phase');
      
      const researchPool = createMockResearchPool([
        createMockSearchResult('test query', {
          results: [
            {
              title: 'Result 1',
              url: 'https://example.com/page',
              content: 'Content',
              images: [
                { url: 'https://example.com/result-img.jpg', description: 'Result image' },
              ],
            },
          ],
          searchSource: 'tavily',
        }),
      ]);

      const imagePool = extractImagesFromResearchPool(researchPool);

      expect(imagePool.count).toBe(1);
      expect(imagePool.webImages[0].url).toBe('https://example.com/result-img.jpg');
    });

    it('distinguishes Exa vs Tavily sources for per-result images', async () => {
      const { extractImagesFromResearchPool } = await import('../../../src/ai/articles/image-phase');
      
      // Use distinct CDN domains to avoid matching issues with "example" containing "exa"
      const researchPool = createMockResearchPool([
        createMockSearchResult('tavily query', {
          results: [
            {
              title: 'Tavily Result',
              url: 'https://tavily-source.com/page',
              content: 'Tavily content',
              images: [{ url: 'https://cdn-tavily.com/img.jpg' }],
            },
          ],
          searchSource: 'tavily',
        }),
        createMockSearchResult('semantic query', {
          results: [
            {
              title: 'Exa Result',
              url: 'https://semantic-source.com/page',
              content: 'Exa content',
              images: [{ url: 'https://cdn-semantic.com/img.jpg' }],
            },
          ],
          searchSource: 'exa',
        }),
      ]);

      const imagePool = extractImagesFromResearchPool(researchPool);

      expect(imagePool.count).toBe(2);
      
      // Find by URL pattern
      const tavilyImg = imagePool.webImages.find(i => i.url.includes('cdn-tavily'));
      const exaImg = imagePool.webImages.find(i => i.url.includes('cdn-semantic'));
      
      expect(tavilyImg).toBeDefined();
      expect(tavilyImg?.source).toBe('tavily');
      expect(exaImg).toBeDefined();
      expect(exaImg?.source).toBe('exa');
    });

    it('extracts section-specific results from queryCache', async () => {
      const { extractImagesFromResearchPool } = await import('../../../src/ai/articles/image-phase');
      
      const sectionResult = createMockSearchResult('section query', {
        category: 'section-specific',
        images: [{ url: 'https://example.com/section-img.jpg' }],
      });
      
      const researchPool = createMockResearchPool(
        [], // empty overview
        [['section-query', sectionResult]]
      );

      const imagePool = extractImagesFromResearchPool(researchPool);

      expect(imagePool.count).toBe(1);
      expect(imagePool.webImages[0].url).toBe('https://example.com/section-img.jpg');
    });

    it('ignores non-section-specific queryCache entries', async () => {
      const { extractImagesFromResearchPool } = await import('../../../src/ai/articles/image-phase');
      
      const overviewResult = createMockSearchResult('overview query', {
        category: 'overview',
        images: [{ url: 'https://example.com/overview-img.jpg' }],
      });
      
      // This is already in scoutFindings.overview, shouldn't be duplicated
      const researchPool: ResearchPool = {
        scoutFindings: {
          overview: [overviewResult],
          categorySpecific: [],
          recent: [],
        },
        allUrls: new Set(),
        queryCache: new Map([['overview-query', overviewResult]]),
      };

      const imagePool = extractImagesFromResearchPool(researchPool);

      // Should only have 1 image (from overview), not duplicated from queryCache
      expect(imagePool.count).toBe(1);
    });

    it('skips results with malformed URLs without crashing', async () => {
      const { extractImagesFromResearchPool } = await import('../../../src/ai/articles/image-phase');
      
      const researchPool = createMockResearchPool([
        createMockSearchResult('test query', {
          results: [
            // Malformed URL - should be skipped, not crash
            {
              url: 'not-a-valid-url',
              title: 'Bad Result',
              images: [{ url: 'https://example.com/img1.jpg', description: 'Test' }],
            },
            // Valid URL - should be processed
            {
              url: 'https://example.com/article',
              title: 'Good Result',
              images: [{ url: 'https://example.com/img2.jpg', description: 'Test' }],
            },
          ],
        }),
      ]);

      // Should not throw and should still extract images from valid URLs
      const imagePool = extractImagesFromResearchPool(researchPool);

      // Only the valid URL's images should be extracted
      expect(imagePool.count).toBe(1);
      expect(imagePool.webImages[0].url).toBe('https://example.com/img2.jpg');
    });

    it('handles empty string URLs gracefully', async () => {
      const { extractImagesFromResearchPool } = await import('../../../src/ai/articles/image-phase');
      
      const researchPool = createMockResearchPool([
        createMockSearchResult('test query', {
          results: [
            {
              url: '', // Empty URL
              title: 'Empty URL Result',
              images: [{ url: 'https://example.com/img.jpg', description: 'Test' }],
            },
          ],
        }),
      ]);

      // Should not throw
      const imagePool = extractImagesFromResearchPool(researchPool);

      // Empty URL result should be skipped
      expect(imagePool.count).toBe(0);
    });
  });

  describe('shouldRunImagePhase', () => {
    it('returns explicit enableImages value when provided', async () => {
      const { shouldRunImagePhase } = await import('../../../src/ai/articles/image-phase');
      const context = createMockContext();

      expect(shouldRunImagePhase(context, 'guide', true)).toBe(true);
      expect(shouldRunImagePhase(context, 'guide', false)).toBe(false);
    });

    it('returns true for unknown categories', async () => {
      const { shouldRunImagePhase } = await import('../../../src/ai/articles/image-phase');
      const context = createMockContext();

      expect(shouldRunImagePhase(context, 'unknown-category')).toBe(true);
    });

    it('returns true by default for enabled categories', async () => {
      const { shouldRunImagePhase } = await import('../../../src/ai/articles/image-phase');
      const context = createMockContext();

      expect(shouldRunImagePhase(context, 'guide')).toBe(true);
    });
  });

  describe('runImagePhase', () => {
    const mockModel = {} as LanguageModel;
    const mockStrapi = createMockStrapi();
    const testMarkdown = '# Test Article\n\n## Section 1\n\nContent here.';

    it('returns early when no images in pool', async () => {
      const { runImagePhase } = await import('../../../src/ai/articles/image-phase');

      const result = await runImagePhase(
        {
          markdown: testMarkdown,
          plan: createMockPlan(['Section 1']),
          context: createMockContext(), // No IGDB images
          articleTitle: 'Test Article',
        },
        { model: mockModel, strapi: mockStrapi }
      );

      expect(result.imagesAdded).toBe(false);
      expect(result.imageCount).toBe(0);
      expect(result.markdown).toBe(testMarkdown);
      expect(mockRunImageCurator).not.toHaveBeenCalled();
    });

    it('adds IGDB images to pool', async () => {
      const { runImagePhase } = await import('../../../src/ai/articles/image-phase');

      mockRunImageCurator.mockResolvedValueOnce(createMockCuratorOutput());
      mockInsertImagesIntoMarkdown.mockReturnValueOnce({
        markdown: testMarkdown,
        imagesInserted: 0,
        sectionImages: [],
      } as ImageInsertionResult);

      const result = await runImagePhase(
        {
          markdown: testMarkdown,
          plan: createMockPlan(['Section 1']),
          context: createMockContext({
            screenshotUrls: ['https://images.igdb.com/screenshot1.jpg'],
            artworkUrls: ['https://images.igdb.com/artwork1.jpg'],
          }),
          articleTitle: 'Test Article',
        },
        { model: mockModel, strapi: mockStrapi }
      );

      expect(mockRunImageCurator).toHaveBeenCalled();
      expect(result.poolSummary.igdb).toBe(2);
    });

    it('handles curator failure gracefully', async () => {
      const { runImagePhase } = await import('../../../src/ai/articles/image-phase');

      mockRunImageCurator.mockRejectedValueOnce(new Error('Curator failed'));

      const result = await runImagePhase(
        {
          markdown: testMarkdown,
          plan: createMockPlan(['Section 1']),
          context: createMockContext({
            screenshotUrls: ['https://images.igdb.com/screenshot1.jpg'],
          }),
          articleTitle: 'Test Article',
        },
        { model: mockModel, strapi: mockStrapi }
      );

      expect(result.imagesAdded).toBe(false);
      expect(result.markdown).toBe(testMarkdown);
    });

    it('processes and uploads hero image', async () => {
      const { runImagePhase } = await import('../../../src/ai/articles/image-phase');

      const heroAssignment = createMockHeroAssignment();
      const uploadResult = createMockUploadResult({ url: 'https://strapi/hero.webp' });

      // Mock curator to return hero candidates
      mockRunImageCurator.mockResolvedValueOnce(createMockCuratorOutput({
        heroCandidates: [{
          imageIndex: 0,
          image: heroAssignment.image,
          altText: heroAssignment.altText,
          relevanceScore: 90,
        }],
      }));
      
      // Mock candidate processor to return a valid hero result
      mockProcessHeroCandidates.mockResolvedValueOnce({
        image: heroAssignment.image,
        altText: heroAssignment.altText,
        dimensions: { width: 1920, height: 1080, inferred: false },
        selectedCandidateIndex: 0,
      } as ProcessedHeroResult);
      
      mockProcessHeroImage.mockResolvedValueOnce({
        buffer: Buffer.from('test'),
        mimeType: 'image/webp',
        originalUrl: heroAssignment.image.url,
        width: 1280,
        height: 720,
        format: 'webp',
      } as HeroImageResult);
      mockUploadImageBuffer.mockResolvedValueOnce(uploadResult);
      mockInsertImagesIntoMarkdown.mockReturnValueOnce({
        markdown: testMarkdown + '\n\n![Hero](https://strapi/hero.webp)',
        imagesInserted: 1,
        heroImage: uploadResult,
        sectionImages: [],
      } as ImageInsertionResult);

      const result = await runImagePhase(
        {
          markdown: testMarkdown,
          plan: createMockPlan(['Section 1']),
          context: createMockContext({
            screenshotUrls: ['https://images.igdb.com/screenshot1.jpg'],
          }),
          articleTitle: 'Test Article',
        },
        { model: mockModel, strapi: mockStrapi }
      );

      expect(mockProcessHeroImage).toHaveBeenCalled();
      expect(mockUploadImageBuffer).toHaveBeenCalled();
      expect(result.heroImage).toBeDefined();
      expect(result.imagesAdded).toBe(true);
    });

    it('sets heroImageFailed when hero processing fails', async () => {
      const { runImagePhase } = await import('../../../src/ai/articles/image-phase');

      const heroAssignment = createMockHeroAssignment();
      
      mockRunImageCurator.mockResolvedValueOnce(createMockCuratorOutput({
        heroCandidates: [{
          imageIndex: 0,
          image: heroAssignment.image,
          altText: heroAssignment.altText,
          relevanceScore: 90,
        }],
      }));
      
      // Mock candidate processor to return a valid hero result
      mockProcessHeroCandidates.mockResolvedValueOnce({
        image: heroAssignment.image,
        altText: heroAssignment.altText,
        dimensions: { width: 1920, height: 1080, inferred: false },
        selectedCandidateIndex: 0,
      } as ProcessedHeroResult);
      
      mockProcessHeroImage.mockRejectedValueOnce(new Error('Download failed'));
      mockInsertImagesIntoMarkdown.mockReturnValueOnce({
        markdown: testMarkdown,
        imagesInserted: 0,
        sectionImages: [],
      } as ImageInsertionResult);

      const result = await runImagePhase(
        {
          markdown: testMarkdown,
          plan: createMockPlan(['Section 1']),
          context: createMockContext({
            screenshotUrls: ['https://images.igdb.com/screenshot1.jpg'],
          }),
          articleTitle: 'Test Article',
        },
        { model: mockModel, strapi: mockStrapi }
      );

      expect(result.heroImageFailed).toBe(true);
      expect(result.heroImage).toBeUndefined();
    });

    it('uploads section images in batches', async () => {
      const { runImagePhase } = await import('../../../src/ai/articles/image-phase');

      const sectionAssignments = [
        createMockSectionAssignment('Section 1', 0),
        createMockSectionAssignment('Section 2', 1),
        createMockSectionAssignment('Section 3', 2),
      ];

      mockRunImageCurator.mockResolvedValueOnce(createMockCuratorOutput({
        sectionSelections: sectionAssignments.map((a, idx) => ({
          sectionHeadline: a.sectionHeadline,
          sectionIndex: idx,
          candidates: [{
            imageIndex: 0,
            image: a.image,
            altText: a.altText,
            relevanceScore: 80,
          }],
        })),
      }));
      
      // Mock candidate processor to return valid section results
      mockProcessAllSectionCandidates.mockResolvedValueOnce(
        sectionAssignments.map((a, idx) => ({
          sectionHeadline: a.sectionHeadline,
          sectionIndex: idx,
          image: a.image,
          altText: a.altText,
          caption: a.caption,
          dimensions: { width: 800, height: 600, inferred: false },
          selectedCandidateIndex: 0,
        } as ProcessedSectionResult))
      );
      
      // Mock upload for each section image
      mockUploadImageFromUrl
        .mockResolvedValueOnce(createMockUploadResult({ id: 1 }))
        .mockResolvedValueOnce(createMockUploadResult({ id: 2 }))
        .mockResolvedValueOnce(createMockUploadResult({ id: 3 }));

      mockInsertImagesIntoMarkdown.mockReturnValueOnce({
        markdown: testMarkdown,
        imagesInserted: 3,
        sectionImages: [
          createMockUploadResult({ id: 1 }),
          createMockUploadResult({ id: 2 }),
          createMockUploadResult({ id: 3 }),
        ],
      } as ImageInsertionResult);

      const result = await runImagePhase(
        {
          markdown: testMarkdown,
          plan: createMockPlan(['Section 1', 'Section 2', 'Section 3']),
          context: createMockContext({
            screenshotUrls: ['https://images.igdb.com/screenshot1.jpg'],
          }),
          articleTitle: 'Test Article',
        },
        { model: mockModel, strapi: mockStrapi }
      );

      expect(mockUploadImageFromUrl).toHaveBeenCalledTimes(3);
      expect(result.sectionImages.length).toBe(3);
    });

    it('handles partial upload failures gracefully', async () => {
      const { runImagePhase } = await import('../../../src/ai/articles/image-phase');

      const sectionAssignments = [
        createMockSectionAssignment('Section 1', 0),
        createMockSectionAssignment('Section 2', 1),
      ];

      mockRunImageCurator.mockResolvedValueOnce(createMockCuratorOutput({
        sectionSelections: sectionAssignments.map((a, idx) => ({
          sectionHeadline: a.sectionHeadline,
          sectionIndex: idx,
          candidates: [{
            imageIndex: 0,
            image: a.image,
            altText: a.altText,
            relevanceScore: 80,
          }],
        })),
      }));
      
      // Mock candidate processor to return valid section results
      mockProcessAllSectionCandidates.mockResolvedValueOnce(
        sectionAssignments.map((a, idx) => ({
          sectionHeadline: a.sectionHeadline,
          sectionIndex: idx,
          image: a.image,
          altText: a.altText,
          caption: a.caption,
          dimensions: { width: 800, height: 600, inferred: false },
          selectedCandidateIndex: 0,
        } as ProcessedSectionResult))
      );
      
      // First succeeds, second fails
      mockUploadImageFromUrl
        .mockResolvedValueOnce(createMockUploadResult({ id: 1 }))
        .mockRejectedValueOnce(new Error('Upload failed'));

      mockInsertImagesIntoMarkdown.mockReturnValueOnce({
        markdown: testMarkdown,
        imagesInserted: 1,
        sectionImages: [createMockUploadResult({ id: 1 })],
      } as ImageInsertionResult);

      const result = await runImagePhase(
        {
          markdown: testMarkdown,
          plan: createMockPlan(['Section 1', 'Section 2']),
          context: createMockContext({
            screenshotUrls: ['https://images.igdb.com/screenshot1.jpg'],
          }),
          articleTitle: 'Test Article',
        },
        { model: mockModel, strapi: mockStrapi }
      );

      // Should continue despite one failure
      expect(result.sectionImages.length).toBe(1);
    });

    it('stops batch processing when aborted', async () => {
      const { runImagePhase } = await import('../../../src/ai/articles/image-phase');

      const controller = new AbortController();
      
      const sectionAssignments = [
        createMockSectionAssignment('Section 1', 0),
        createMockSectionAssignment('Section 2', 1),
        createMockSectionAssignment('Section 3', 2),
        createMockSectionAssignment('Section 4', 3),
      ];

      mockRunImageCurator.mockResolvedValueOnce(createMockCuratorOutput({
        sectionSelections: sectionAssignments.map((a, idx) => ({
          sectionHeadline: a.sectionHeadline,
          sectionIndex: idx,
          candidates: [{
            imageIndex: 0,
            image: a.image,
            altText: a.altText,
            relevanceScore: 80,
          }],
        })),
      }));
      
      // Mock candidate processor to return valid section results
      mockProcessAllSectionCandidates.mockResolvedValueOnce(
        sectionAssignments.map((a, idx) => ({
          sectionHeadline: a.sectionHeadline,
          sectionIndex: idx,
          image: a.image,
          altText: a.altText,
          caption: a.caption,
          dimensions: { width: 800, height: 600, inferred: false },
          selectedCandidateIndex: 0,
        } as ProcessedSectionResult))
      );

      // Abort after first batch
      mockUploadImageFromUrl.mockImplementation(async () => {
        controller.abort();
        return createMockUploadResult();
      });

      mockInsertImagesIntoMarkdown.mockReturnValueOnce({
        markdown: testMarkdown,
        imagesInserted: 0,
        sectionImages: [],
      } as ImageInsertionResult);

      await runImagePhase(
        {
          markdown: testMarkdown,
          plan: createMockPlan(['Section 1', 'Section 2', 'Section 3', 'Section 4']),
          context: createMockContext({
            screenshotUrls: ['https://images.igdb.com/screenshot1.jpg'],
          }),
          articleTitle: 'Test Article',
        },
        { model: mockModel, strapi: mockStrapi, signal: controller.signal }
      );

      // With concurrency of 3, first batch starts 3 uploads, then abort kicks in
      // Second batch should not start due to abort check
      expect(mockUploadImageFromUrl.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it('passes markdown to insertion and returns updated markdown', async () => {
      const { runImagePhase } = await import('../../../src/ai/articles/image-phase');
      
      const updatedMarkdown = testMarkdown + '\n\n![Test](https://test.com/img.jpg)';

      mockRunImageCurator.mockResolvedValueOnce(createMockCuratorOutput());
      mockInsertImagesIntoMarkdown.mockReturnValueOnce({
        markdown: updatedMarkdown,
        imagesInserted: 1,
        sectionImages: [],
      } as ImageInsertionResult);

      const result = await runImagePhase(
        {
          markdown: testMarkdown,
          plan: createMockPlan(['Section 1']),
          context: createMockContext({
            screenshotUrls: ['https://images.igdb.com/screenshot1.jpg'],
          }),
          articleTitle: 'Test Article',
        },
        { model: mockModel, strapi: mockStrapi }
      );

      expect(mockInsertImagesIntoMarkdown).toHaveBeenCalledWith(expect.objectContaining({
        markdown: testMarkdown,
      }));
      expect(result.markdown).toBe(updatedMarkdown);
    });
  });
});
