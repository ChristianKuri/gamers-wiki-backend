/**
 * Image Curator Agent Tests
 *
 * Tests for the LLM-based image selection agent.
 * Uses mocked generateObject to test selection logic.
 *
 * Note: The curator now uses per-section LLM calls:
 * - One call for hero image selection
 * - One call per section for relevance scoring
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { runImageCurator, type ImageCuratorContext, type ImageCuratorDeps } from '../../../src/ai/articles/agents/image-curator';
import { createEmptyImagePool, addIGDBImages, addWebImages } from '../../../src/ai/articles/image-pool';
import type { ArticlePlan } from '../../../src/ai/articles/article-plan';
import type { LanguageModel, generateObject } from 'ai';

// ============================================================================
// Mock Types
// ============================================================================

/** Mock hero candidate structure (for hero selection call) */
interface MockHeroCandidate {
  imageIndex: number;
  altText: string;
  relevanceScore: number;
}

/** Mock section candidate structure (for section relevance call) */
interface MockSectionCandidate {
  imageIndex: number;
  altText: string;
  caption?: string;
  relevanceScore: number;
}

/** Mock hero selection response */
interface MockHeroSelectionResult {
  object: {
    heroCandidates: MockHeroCandidate[];
  };
  usage: { inputTokens: number; outputTokens: number };
  finishReason: string;
  warnings: unknown[];
  experimental_providerMetadata: undefined;
  response: { id: string; timestamp: Date; modelId: string };
  request: Record<string, unknown>;
  toJsonResponse: () => Response;
  rawResponse: undefined;
}

/** Mock section relevance response (per-section call) */
interface MockSectionRelevanceResult {
  object: {
    rankedCandidates: MockSectionCandidate[];
  };
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
type MockGenerateObject = Mock<Parameters<typeof generateObject>, Promise<MockHeroSelectionResult | MockSectionRelevanceResult>>;

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

// Helper to create mock hero selection result
function createMockHeroResult(heroCandidates: MockHeroCandidate[]): MockHeroSelectionResult {
  return {
    object: { heroCandidates },
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

// Helper to create mock section relevance result
function createMockSectionResult(rankedCandidates: MockSectionCandidate[]): MockSectionRelevanceResult {
  return {
    object: { rankedCandidates },
    usage: { inputTokens: 50, outputTokens: 25 },
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

      expect(result.heroCandidates).toHaveLength(0);
      expect(result.sectionSelections).toHaveLength(0);
      // generateObject should not be called for empty pool
      expect(mockGenerateObject).not.toHaveBeenCalled();
    });

    it('should return hero candidates from LLM response', async () => {
      const artworkUrl = 'https://images.igdb.com/igdb/image/upload/t_screenshot_big/art1.jpg';
      const context = createMockContext(
        ['Boss Guide'],
        [],
        [artworkUrl]
      );

      // First call: hero selection
      mockGenerateObject.mockResolvedValueOnce(createMockHeroResult([
        { imageIndex: 0, altText: 'Epic boss battle in Test Game', relevanceScore: 90 },
      ]));
      // Second call: section relevance for 'Boss Guide'
      mockGenerateObject.mockResolvedValueOnce(createMockSectionResult([]));

      const result = await runImageCurator(context, createMockDeps());

      expect(result.heroCandidates).toHaveLength(1);
      expect(result.heroCandidates[0].image.igdbType).toBe('artwork');
      expect(result.heroCandidates[0].altText).toBe('Epic boss battle in Test Game');
    });

    it('should skip hero candidates with invalid image index', async () => {
      const context = createMockContext(
        ['Section 1'],
        ['https://images.igdb.com/igdb/image/upload/t_screenshot_big/ss1.jpg'],
        []
      );

      // Hero call with invalid index
      mockGenerateObject.mockResolvedValueOnce(createMockHeroResult([
        { imageIndex: 99, altText: 'Invalid hero', relevanceScore: 90 }, // Invalid index
      ]));
      // Section call with invalid index
      mockGenerateObject.mockResolvedValueOnce(createMockSectionResult([
        { imageIndex: 99, altText: 'Invalid selection', relevanceScore: 90 }, // Invalid index
      ]));

      const result = await runImageCurator(context, createMockDeps());

      // Should skip the invalid candidates
      expect(result.heroCandidates).toHaveLength(0);
      expect(result.sectionSelections).toHaveLength(0);
    });

    it('should return section candidates with resolved images', async () => {
      const screenshotUrl = 'https://images.igdb.com/igdb/image/upload/t_screenshot_big/ss1.jpg';
      const context = createMockContext(
        ['Section 1'],
        [screenshotUrl],
        []
      );

      // Hero call
      mockGenerateObject.mockResolvedValueOnce(createMockHeroResult([]));
      // Section call
      mockGenerateObject.mockResolvedValueOnce(createMockSectionResult([
        { imageIndex: 0, altText: 'Section image alt', relevanceScore: 85 },
      ]));

      const result = await runImageCurator(context, createMockDeps());

      expect(result.sectionSelections).toHaveLength(1);
      expect(result.sectionSelections[0].candidates).toHaveLength(1);
      expect(result.sectionSelections[0].candidates[0].image.url).toContain('ss1.jpg');
    });

    it('should track token usage from LLM calls', async () => {
      const context = createMockContext(
        ['Section 1'],
        ['https://images.igdb.com/igdb/image/upload/t_screenshot_big/ss1.jpg'],
        []
      );

      // Hero call with specific token usage
      mockGenerateObject.mockResolvedValueOnce({
        object: { heroCandidates: [] },
        usage: { inputTokens: 200, outputTokens: 100 },
        finishReason: 'stop',
        warnings: [],
        experimental_providerMetadata: undefined,
        response: { id: '1', timestamp: new Date(), modelId: 'test' },
        request: {},
        toJsonResponse: () => new Response(),
        rawResponse: undefined,
      });
      // Section call with specific token usage
      mockGenerateObject.mockResolvedValueOnce({
        object: { rankedCandidates: [] },
        usage: { inputTokens: 300, outputTokens: 100 },
        finishReason: 'stop',
        warnings: [],
        experimental_providerMetadata: undefined,
        response: { id: '1', timestamp: new Date(), modelId: 'test' },
        request: {},
        toJsonResponse: () => new Response(),
        rawResponse: undefined,
      });

      const result = await runImageCurator(context, createMockDeps());

      // TokenUsage should be summed from hero + section calls
      expect(result.tokenUsage.input).toBe(500); // 200 + 300
      expect(result.tokenUsage.output).toBe(200); // 100 + 100
    });

    it('should return screenshot candidates when no artwork available', async () => {
      const context = createMockContext(
        ['Section 1'],
        ['https://images.igdb.com/igdb/image/upload/t_screenshot_big/ss1.jpg'],
        [] // No artworks
      );

      // Hero call
      mockGenerateObject.mockResolvedValueOnce(createMockHeroResult([
        { imageIndex: 0, altText: 'Screenshot hero', relevanceScore: 85 },
      ]));
      // Section call
      mockGenerateObject.mockResolvedValueOnce(createMockSectionResult([]));

      const result = await runImageCurator(context, createMockDeps());

      expect(result.heroCandidates).toHaveLength(1);
      expect(result.heroCandidates[0].image.igdbType).toBe('screenshot');
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

      // Hero call
      mockGenerateObject.mockResolvedValueOnce(createMockHeroResult([]));
      // Section call
      mockGenerateObject.mockResolvedValueOnce(createMockSectionResult([]));

      await runImageCurator(context, deps);

      // Verify signal was passed to generateObject (both calls)
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

    it('should make multiple section calls for multiple sections', async () => {
      const context = createMockContext(
        ['Section 1', 'Section 2', 'Section 3'],
        ['https://images.igdb.com/igdb/image/upload/t_screenshot_big/ss1.jpg'],
        []
      );

      // Hero call
      mockGenerateObject.mockResolvedValueOnce(createMockHeroResult([]));
      // Section calls (one per section)
      mockGenerateObject.mockResolvedValueOnce(createMockSectionResult([]));
      mockGenerateObject.mockResolvedValueOnce(createMockSectionResult([]));
      mockGenerateObject.mockResolvedValueOnce(createMockSectionResult([]));

      await runImageCurator(context, createMockDeps());

      // Should have 1 hero call + 3 section calls = 4 total
      expect(mockGenerateObject).toHaveBeenCalledTimes(4);
    });

    it('should include sourceQuery and sourceDomain in hero prompt', async () => {
      // Create context with web images that have context/source info
      let imagePool = createEmptyImagePool();
      imagePool = addWebImages(imagePool, [
        {
          url: 'https://example.com/boss-fight.jpg',
          description: 'Epic boss battle screenshot',
        },
      ], 'boss guide');

      const context: ImageCuratorContext = {
        markdown: '# Test\n\n## Section 1\n\nContent.',
        plan: createMockPlan(['Section 1']),
        imagePool,
        gameName: 'Test Game',
        articleTitle: 'Test Article',
      };

      // Hero call
      mockGenerateObject.mockResolvedValueOnce(createMockHeroResult([]));
      // Section call
      mockGenerateObject.mockResolvedValueOnce(createMockSectionResult([]));

      await runImageCurator(context, createMockDeps());

      // Verify hero selection call includes context fields in prompt
      const heroCall = mockGenerateObject.mock.calls[0];
      const heroPrompt = heroCall[0].prompt as string;
      
      // Should include source domain
      expect(heroPrompt).toContain('Source: example.com');
      // Should include context (sourceQuery is the search query used to find the image)
      expect(heroPrompt).toContain('Context: "boss guide"');
    });
  });
});
