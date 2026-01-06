import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  runMetadata,
  extractTopSources,
  METADATA_CONFIG,
  type MetadataDeps,
  type MetadataContext,
} from '../../../src/ai/articles/agents/metadata';
import type { SourceSummary } from '../../../src/ai/articles/types';

// ============================================================================
// Mock Setup
// ============================================================================

const createMockGenerateObject = () => vi.fn();
const createMockModel = () => ({} as any);

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockMetadataContext = (overrides: Partial<MetadataContext> = {}): MetadataContext => ({
  articleMarkdown: `# How to Beat the First Boss in Elden Ring

## Getting Started

The Tree Sentinel is the first boss you'll encounter in Elden Ring. Don't fight him right away.

## Strategy

Level up first by exploring Limgrave. Return when you have better gear.

## Rewards

Defeating the Tree Sentinel grants you the Golden Halberd and Erdtree Greatshield.
`,
  gameName: 'Elden Ring',
  instruction: 'Write a guide about beating the first boss',
  categorySlug: 'guides',
  topSources: [
    {
      url: 'https://ign.com/elden-ring-guide',
      title: 'IGN Elden Ring Boss Guide',
      detailedSummary: 'Complete guide to defeating Tree Sentinel in Elden Ring.',
      keyFacts: ['Level up first', 'Return with better gear', 'Use mount combat'],
      contentType: 'guide',
      dataPoints: ['Golden Halberd reward', '2000 runes'],
      query: '"Elden Ring" first boss guide',
      qualityScore: 90,
      relevanceScore: 95,
    },
  ],
  ...overrides,
});

const createMockMetadataOutput = (overrides: Record<string, any> = {}) => ({
  title: 'How to Beat Tree Sentinel in Elden Ring: First Boss Guide',
  excerpt: 'Learn how to defeat the Tree Sentinel, Elden Ring\'s first boss. Strategy, tips, and rewards guide.',
  description: 'Complete guide to beating the Tree Sentinel including when to fight and what rewards you get.',
  tags: ['elden-ring', 'tree-sentinel', 'boss-guide', 'beginner'],
  ...overrides,
});

// ============================================================================
// Unit Tests
// ============================================================================

describe('Metadata Agent', () => {
  let mockGenerateObject: ReturnType<typeof createMockGenerateObject>;
  let mockModel: ReturnType<typeof createMockModel>;
  let deps: MetadataDeps;

  beforeEach(() => {
    mockGenerateObject = createMockGenerateObject();
    mockModel = createMockModel();
    deps = {
      generateObject: mockGenerateObject,
      model: mockModel,
    };
  });

  describe('runMetadata', () => {
    it('should generate metadata from article content', async () => {
      const mockOutput = createMockMetadataOutput();
      mockGenerateObject.mockResolvedValueOnce({
        object: mockOutput,
        usage: { inputTokens: 500, outputTokens: 100 },
      });

      const ctx = createMockMetadataContext();
      const result = await runMetadata(ctx, deps);

      expect(result.metadata.title).toBe(mockOutput.title);
      expect(result.metadata.excerpt).toBe(mockOutput.excerpt);
      expect(result.metadata.description).toBe(mockOutput.description);
      expect(result.metadata.tags).toEqual(mockOutput.tags);
    });

    it('should pass article markdown to the LLM', async () => {
      const mockOutput = createMockMetadataOutput();
      mockGenerateObject.mockResolvedValueOnce({
        object: mockOutput,
        usage: { inputTokens: 500, outputTokens: 100 },
      });

      const ctx = createMockMetadataContext({
        articleMarkdown: '# Custom Article\n\nSome custom content.',
      });
      await runMetadata(ctx, deps);

      expect(mockGenerateObject).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateObject.mock.calls[0][0];
      expect(callArgs.prompt).toContain('Custom Article');
      expect(callArgs.prompt).toContain('Some custom content');
    });

    it('should include game name in prompt', async () => {
      const mockOutput = createMockMetadataOutput();
      mockGenerateObject.mockResolvedValueOnce({
        object: mockOutput,
        usage: { inputTokens: 500, outputTokens: 100 },
      });

      const ctx = createMockMetadataContext({ gameName: 'Dark Souls III' });
      await runMetadata(ctx, deps);

      const callArgs = mockGenerateObject.mock.calls[0][0];
      expect(callArgs.prompt).toContain('Dark Souls III');
    });

    it('should include instruction in prompt', async () => {
      const mockOutput = createMockMetadataOutput();
      mockGenerateObject.mockResolvedValueOnce({
        object: mockOutput,
        usage: { inputTokens: 500, outputTokens: 100 },
      });

      const ctx = createMockMetadataContext({
        instruction: 'Write a beginner guide for the first 5 hours',
      });
      await runMetadata(ctx, deps);

      const callArgs = mockGenerateObject.mock.calls[0][0];
      expect(callArgs.prompt).toContain('beginner guide for the first 5 hours');
    });

    it('should track token usage', async () => {
      const mockOutput = createMockMetadataOutput();
      mockGenerateObject.mockResolvedValueOnce({
        object: mockOutput,
        usage: { inputTokens: 800, outputTokens: 150 },
      });

      const ctx = createMockMetadataContext();
      const result = await runMetadata(ctx, deps);

      expect(result.tokenUsage.input).toBe(800);
      expect(result.tokenUsage.output).toBe(150);
    });

    it('should use default temperature from config', async () => {
      const mockOutput = createMockMetadataOutput();
      mockGenerateObject.mockResolvedValueOnce({
        object: mockOutput,
        usage: { inputTokens: 500, outputTokens: 100 },
      });

      const ctx = createMockMetadataContext();
      await runMetadata(ctx, deps);

      const callArgs = mockGenerateObject.mock.calls[0][0];
      expect(callArgs.temperature).toBe(METADATA_CONFIG.TEMPERATURE);
    });

    it('should allow temperature override', async () => {
      const mockOutput = createMockMetadataOutput();
      mockGenerateObject.mockResolvedValueOnce({
        object: mockOutput,
        usage: { inputTokens: 500, outputTokens: 100 },
      });

      const ctx = createMockMetadataContext();
      await runMetadata(ctx, { ...deps, temperature: 0.8 });

      const callArgs = mockGenerateObject.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.8);
    });

    it('should truncate long articles in prompt', async () => {
      const mockOutput = createMockMetadataOutput();
      mockGenerateObject.mockResolvedValueOnce({
        object: mockOutput,
        usage: { inputTokens: 500, outputTokens: 100 },
      });

      // Create a very long article (>4000 chars)
      const longArticle = '# Long Article\n\n' + 'Lorem ipsum dolor sit amet. '.repeat(200);
      const ctx = createMockMetadataContext({ articleMarkdown: longArticle });
      await runMetadata(ctx, deps);

      const callArgs = mockGenerateObject.mock.calls[0][0];
      // Should contain truncation indicator
      expect(callArgs.prompt).toContain('article continues');
    });
  });

  describe('extractTopSources', () => {
    const createSourceSummaries = (): readonly SourceSummary[] => [
      {
        url: 'https://example1.com',
        title: 'Source 1',
        detailedSummary: 'Summary 1',
        keyFacts: ['Fact 1'],
        contentType: 'guide',
        dataPoints: [],
        query: 'query 1',
        qualityScore: 80,
        relevanceScore: 85,
      },
      {
        url: 'https://example2.com',
        title: 'Source 2',
        detailedSummary: 'Summary 2',
        keyFacts: ['Fact 2'],
        contentType: 'guide',
        dataPoints: [],
        query: 'query 2',
        qualityScore: 95,
        relevanceScore: 90,
      },
      {
        url: 'https://example3.com',
        title: 'Source 3',
        detailedSummary: 'Summary 3',
        keyFacts: ['Fact 3'],
        contentType: 'guide',
        dataPoints: [],
        query: 'query 3',
        qualityScore: 70,
        relevanceScore: 75,
      },
    ];

    it('should return top sources sorted by quality score', () => {
      const sources = createSourceSummaries();
      const result = extractTopSources(sources, 2);

      expect(result).toHaveLength(2);
      expect(result[0].qualityScore).toBe(95); // Highest quality first
      expect(result[1].qualityScore).toBe(80);
    });

    it('should return all sources if count exceeds available', () => {
      const sources = createSourceSummaries();
      const result = extractTopSources(sources, 10);

      expect(result).toHaveLength(3);
    });

    it('should return empty array for undefined input', () => {
      const result = extractTopSources(undefined, 3);

      expect(result).toHaveLength(0);
    });

    it('should return empty array for empty input', () => {
      const result = extractTopSources([], 3);

      expect(result).toHaveLength(0);
    });

    it('should use default count of 3', () => {
      const sources = createSourceSummaries();
      const result = extractTopSources(sources);

      expect(result).toHaveLength(3);
    });
  });
});
