/**
 * Image Curator Agent Tests
 *
 * Tests for the LLM-based image selection agent.
 * Uses mocked generateObject to test selection logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { runImageCurator, type ImageCuratorContext, type ImageCuratorDeps } from '../../../src/ai/articles/agents/image-curator';
import { createEmptyImagePool, addIGDBImages, addWebImages } from '../../../src/ai/articles/image-pool';
import type { ArticlePlan } from '../../../src/ai/articles/article-plan';
import type { LanguageModel, generateObject } from 'ai';

// ============================================================================
// Mock Types
// ============================================================================

/** Mock LLM result structure matching generateObject return type */
interface MockLLMResult {
  object: { heroImageAltText: string; sectionSelections: unknown[] };
  usage: { inputTokens: number; outputTokens: number };
  finishReason: string;
  warnings: unknown[];
  experimental_providerMetadata: undefined;
  response: { id: string; timestamp: Date; modelId: string };
  request: Record<string, unknown>;
  toJsonResponse: () => Response;
  rawResponse: undefined;
}

/** Typed mock for generateObject that matches the expected interface */
type MockGenerateObject = Mock<Parameters<typeof generateObject>, Promise<MockLLMResult>>;

// ============================================================================
// Mocks
// ============================================================================

// Mock model
const mockModel = {} as LanguageModel;

// Mock generateObject function with proper typing
const mockGenerateObject: MockGenerateObject = vi.fn();

// Helper to create a minimal plan
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

// Helper to create mock context
function createMockContext(
  sections: string[],
  igdbScreenshots: string[] = [],
  igdbArtworks: string[] = [],
  webImages: { url: string; description?: string }[] = []
): ImageCuratorContext {
  let imagePool = createEmptyImagePool();
  
  if (igdbScreenshots.length > 0 || igdbArtworks.length > 0) {
    imagePool = addIGDBImages(imagePool, igdbScreenshots, igdbArtworks);
  }
  
  if (webImages.length > 0) {
    imagePool = addWebImages(imagePool, webImages, 'test query');
  }

  const markdown = [
    '# Test Article',
    '',
    ...sections.flatMap(s => [`## ${s}`, '', 'Content for this section.', '']),
  ].join('\n');

  return {
    markdown,
    plan: createMockPlan(sections),
    imagePool,
    gameName: 'Test Game',
    articleTitle: 'Test Article Title',
  };
}

// Helper to create deps with mock
function createMockDeps(): ImageCuratorDeps {
  return {
    model: mockModel,
    // The mock is typed to match generateObject's signature
    generateObject: mockGenerateObject as typeof generateObject,
  };
}

// Helper to create mock LLM result with correct token structure
function createMockLLMResult(response: { heroImageAltText: string; sectionSelections: unknown[] }): MockLLMResult {
  return {
    object: response,
    // Use the structure expected by createTokenUsageFromResult
    usage: { inputTokens: 100, outputTokens: 50 },
    finishReason: 'stop',
    warnings: [],
    experimental_providerMetadata: undefined,
    response: { id: '1', timestamp: new Date(), modelId: 'test' },
    request: {},
    toJsonResponse: () => new Response(),
    rawResponse: undefined,
  };
}

describe('Image Curator Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runImageCurator', () => {
    it('should return empty result when image pool is empty', async () => {
      const context = createMockContext(['Section 1', 'Section 2']);
      
      // Pool is empty, should skip LLM call
      const result = await runImageCurator(context, createMockDeps());

      expect(result.heroImage).toBeUndefined();
      expect(result.sectionImages).toHaveLength(0);
      // generateObject should not be called for empty pool
      expect(mockGenerateObject).not.toHaveBeenCalled();
    });

    it('should select hero image from IGDB artwork when available', async () => {
      const artworkUrl = 'https://images.igdb.com/igdb/image/upload/t_screenshot_big/art1.jpg';
      const context = createMockContext(
        ['Boss Guide'],
        [],
        [artworkUrl]
      );

      mockGenerateObject.mockResolvedValueOnce(createMockLLMResult({
        heroImageAltText: 'Epic boss battle in Test Game',
        sectionSelections: [],
      }));

      const result = await runImageCurator(context, createMockDeps());

      expect(result.heroImage).toBeDefined();
      expect(result.heroImage?.image.igdbType).toBe('artwork');
      expect(result.heroImage?.altText).toBe('Epic boss battle in Test Game');
    });

    it('should skip sections with invalid image index', async () => {
      const context = createMockContext(
        ['Section 1'],
        ['https://images.igdb.com/igdb/image/upload/t_screenshot_big/ss1.jpg'],
        []
      );

      mockGenerateObject.mockResolvedValueOnce(createMockLLMResult({
        heroImageAltText: 'Test hero',
        sectionSelections: [
          {
            sectionHeadline: 'Section 1',
            selectedImageIndex: 99, // Invalid - out of bounds
            altText: 'Invalid selection',
            relevanceScore: 90,
            qualityScore: 85,
          },
        ],
      }));

      const result = await runImageCurator(context, createMockDeps());

      // Should skip the invalid selection
      expect(result.sectionImages).toHaveLength(0);
    });

    it('should skip sections not found in the plan', async () => {
      const context = createMockContext(
        ['Real Section'],
        ['https://images.igdb.com/igdb/image/upload/t_screenshot_big/ss1.jpg'],
        []
      );

      mockGenerateObject.mockResolvedValueOnce(createMockLLMResult({
        heroImageAltText: 'Test hero',
        sectionSelections: [
          {
            sectionHeadline: 'Non-existent Section',
            selectedImageIndex: 0,
            altText: 'Should be skipped',
            relevanceScore: 90,
            qualityScore: 85,
          },
        ],
      }));

      const result = await runImageCurator(context, createMockDeps());

      // Should skip the section not in the plan
      expect(result.sectionImages).toHaveLength(0);
    });

    it('should not use hero image in section images (deduplication)', async () => {
      // Only one image in pool - will be used as hero
      const onlyImageUrl = 'https://images.igdb.com/igdb/image/upload/t_screenshot_big/only.jpg';
      const context = createMockContext(
        ['Section 1'],
        [],
        [onlyImageUrl]
      );

      mockGenerateObject.mockResolvedValueOnce(createMockLLMResult({
        heroImageAltText: 'Hero image alt',
        sectionSelections: [
          {
            sectionHeadline: 'Section 1',
            selectedImageIndex: 0, // Trying to use hero image
            altText: 'Should be skipped',
            relevanceScore: 90,
            qualityScore: 85,
          },
        ],
      }));

      const result = await runImageCurator(context, createMockDeps());

      // Hero should be set
      expect(result.heroImage).toBeDefined();
      // Section should be skipped because it's the same image as hero
      expect(result.sectionImages).toHaveLength(0);
    });

    it('should track token usage from LLM call', async () => {
      const context = createMockContext(
        ['Section 1'],
        ['https://images.igdb.com/igdb/image/upload/t_screenshot_big/ss1.jpg'],
        []
      );

      mockGenerateObject.mockResolvedValueOnce({
        object: {
          heroImageAltText: 'Test hero',
          sectionSelections: [],
        },
        usage: { inputTokens: 500, outputTokens: 200 },
        finishReason: 'stop',
        warnings: [],
        experimental_providerMetadata: undefined,
        response: { id: '1', timestamp: new Date(), modelId: 'test' },
        request: {},
        toJsonResponse: () => new Response(),
        rawResponse: undefined,
      });

      const result = await runImageCurator(context, createMockDeps());

      // TokenUsage uses 'input' and 'output' field names
      expect(result.tokenUsage.input).toBe(500);
      expect(result.tokenUsage.output).toBe(200);
    });

    it('should fall back to screenshot if no artwork available', async () => {
      const context = createMockContext(
        ['Section 1'],
        ['https://images.igdb.com/igdb/image/upload/t_screenshot_big/ss1.jpg'],
        [] // No artworks
      );

      mockGenerateObject.mockResolvedValueOnce(createMockLLMResult({
        heroImageAltText: 'Screenshot hero',
        sectionSelections: [],
      }));

      const result = await runImageCurator(context, createMockDeps());

      expect(result.heroImage).toBeDefined();
      expect(result.heroImage?.image.igdbType).toBe('screenshot');
    });

    it('should call generateObject with signal when provided', async () => {
      const context = createMockContext(
        ['Section 1'],
        ['https://images.igdb.com/igdb/image/upload/t_screenshot_big/ss1.jpg'],
        []
      );

      const controller = new AbortController();
      const deps = {
        ...createMockDeps(),
        signal: controller.signal,
      };

      mockGenerateObject.mockResolvedValueOnce(createMockLLMResult({
        heroImageAltText: 'Test hero',
        sectionSelections: [],
      }));

      await runImageCurator(context, deps);

      // Verify signal was passed to generateObject
      expect(mockGenerateObject).toHaveBeenCalledWith(
        expect.objectContaining({
          abortSignal: controller.signal,
        })
      );
    });

    it('should return empty token usage when pool is empty', async () => {
      const context = createMockContext(['Section 1', 'Section 2']);
      
      const result = await runImageCurator(context, createMockDeps());

      // Empty pool means no LLM call, so token usage should be empty
      expect(result.tokenUsage.input).toBe(0);
      expect(result.tokenUsage.output).toBe(0);
    });
  });
});
