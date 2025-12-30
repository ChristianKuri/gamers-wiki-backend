import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  runSpecialist,
  SPECIALIST_CONFIG,
  type SpecialistDeps,
  type SpecialistOutput,
} from '../../../src/ai/articles/agents/specialist';
import type { GameArticleContext, ScoutOutput, SearchFunction } from '../../../src/ai/articles/types';
import type { ArticlePlan } from '../../../src/ai/articles/article-plan';
import { createEmptyTokenUsage } from '../../../src/ai/articles/types';
import { createEmptyResearchPool, ResearchPoolBuilder } from '../../../src/ai/articles/research-pool';

// ============================================================================
// Mock Setup
// ============================================================================

const createMockGenerateText = () => vi.fn();
const createMockModel = () => ({} as any);
const createMockSearch = (): SearchFunction =>
  vi.fn().mockResolvedValue({
    query: 'test',
    answer: 'answer',
    results: [{ title: 'Result', url: 'https://example.com', content: 'Content', score: 0.9 }],
  });

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockGameContext = (overrides: Partial<GameArticleContext> = {}): GameArticleContext => ({
  gameName: 'Elden Ring',
  gameSlug: 'elden-ring',
  releaseDate: '2022-02-25',
  genres: ['Action RPG', 'Soulslike'],
  platforms: ['PC', 'PlayStation 5'],
  developer: 'FromSoftware',
  publisher: 'Bandai Namco',
  igdbDescription: 'An epic open-world action RPG.',
  instruction: 'Write a beginner guide',
  ...overrides,
});

const createMockScoutOutput = (): ScoutOutput => ({
  briefing: {
    overview: 'Elden Ring is an action RPG. It features open world exploration and challenging combat.',
    categoryInsights: 'Guide content would be most valuable.',
    recentDevelopments: 'DLC announced.',
    fullContext: 'Full context document...',
  },
  researchPool: createEmptyResearchPool(),
  sourceUrls: ['https://ign.com'],
  tokenUsage: createEmptyTokenUsage(),
  confidence: 'high',
});

const createMockArticlePlan = (overrides: Partial<ArticlePlan> = {}): ArticlePlan => ({
  gameName: 'Elden Ring',
  gameSlug: 'elden-ring',
  title: 'Elden Ring: Complete Beginner Guide',
  categorySlug: 'guides',
  excerpt: 'Master the Lands Between with this comprehensive guide.',
  tags: ['beginner', 'guide', 'tips'],
  sections: [
    { headline: 'Getting Started', goal: 'Help new players', researchQueries: ['elden ring basics'], mustCover: ['Game basics'] },
    { headline: 'Character Builds', goal: 'Cover builds', researchQueries: ['elden ring builds'], mustCover: ['Build types'] },
    { headline: 'Exploration Tips', goal: 'Guide exploration', researchQueries: ['elden ring exploration'], mustCover: ['Exploration tips'] },
  ],
  safety: { noScoresUnlessReview: true },
  ...overrides,
});

const createMockSpecialistDeps = (overrides: Partial<SpecialistDeps> = {}): SpecialistDeps => ({
  search: createMockSearch(),
  generateText: createMockGenerateText(),
  model: createMockModel(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  ...overrides,
});

// ============================================================================
// runSpecialist Tests
// ============================================================================

describe('runSpecialist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('basic functionality', () => {
    it('returns SpecialistOutput with markdown and sources', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({
        text: 'Section content goes here.',
        usage: { promptTokens: 500, completionTokens: 200 },
      });

      const deps = createMockSpecialistDeps({ generateText: mockGenerateText });
      const context = createMockGameContext();
      const scoutOutput = createMockScoutOutput();
      const plan = createMockArticlePlan();

      const result = await runSpecialist(context, scoutOutput, plan, deps);

      expect(result).toHaveProperty('markdown');
      expect(result).toHaveProperty('sources');
      expect(result).toHaveProperty('researchPool');
      expect(result).toHaveProperty('tokenUsage');
    });

    it('generates markdown with title and section headings', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({
        text: 'Section content.',
        usage: {},
      });

      const deps = createMockSpecialistDeps({ generateText: mockGenerateText });
      const plan = createMockArticlePlan();

      const result = await runSpecialist(
        createMockGameContext(),
        createMockScoutOutput(),
        plan,
        deps
      );

      expect(result.markdown).toContain('# Elden Ring: Complete Beginner Guide');
      expect(result.markdown).toContain('## Getting Started');
      expect(result.markdown).toContain('## Character Builds');
      expect(result.markdown).toContain('## Exploration Tips');
    });

    it('includes section content from generateText calls', async () => {
      const mockGenerateText = vi.fn()
        .mockResolvedValueOnce({ text: 'First section content.', usage: {} })
        .mockResolvedValueOnce({ text: 'Second section content.', usage: {} })
        .mockResolvedValueOnce({ text: 'Third section content.', usage: {} });

      const deps = createMockSpecialistDeps({ generateText: mockGenerateText });
      const plan = createMockArticlePlan();

      const result = await runSpecialist(
        createMockGameContext(),
        createMockScoutOutput(),
        plan,
        deps
      );

      expect(result.markdown).toContain('First section content.');
      expect(result.markdown).toContain('Second section content.');
      expect(result.markdown).toContain('Third section content.');
    });
  });

  describe('batch research', () => {
    it('executes research queries from plan sections', async () => {
      const mockSearch = vi.fn().mockResolvedValue({
        query: 'test',
        answer: 'answer',
        results: [{ title: 'R', url: 'https://example.com', content: 'C' }],
      });

      const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Content.', usage: {} });

      const deps = createMockSpecialistDeps({
        search: mockSearch,
        generateText: mockGenerateText,
      });

      const plan = createMockArticlePlan({
        sections: [
          { headline: 'S1', goal: 'G1', researchQueries: ['query1', 'query2'], mustCover: ['item1'] },
        ],
      });

      await runSpecialist(createMockGameContext(), createMockScoutOutput(), plan, deps);

      // Should have called search for each unique query
      expect(mockSearch).toHaveBeenCalledWith('query1', expect.any(Object));
      expect(mockSearch).toHaveBeenCalledWith('query2', expect.any(Object));
    });

    it('deduplicates research queries across sections', async () => {
      const mockSearch = vi.fn().mockResolvedValue({
        query: 'test',
        answer: 'answer',
        results: [{ title: 'R', url: 'https://example.com', content: 'C' }],
      });

      const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Content.', usage: {} });

      const deps = createMockSpecialistDeps({
        search: mockSearch,
        generateText: mockGenerateText,
      });

      const plan = createMockArticlePlan({
        sections: [
          { headline: 'S1', goal: 'G1', researchQueries: ['shared query'], mustCover: ['item1'] },
          { headline: 'S2', goal: 'G2', researchQueries: ['shared query'], mustCover: ['item2'] }, // duplicate
          { headline: 'S3', goal: 'G3', researchQueries: ['unique query'], mustCover: ['item3'] },
        ],
      });

      await runSpecialist(createMockGameContext(), createMockScoutOutput(), plan, deps);

      // 'shared query' should only be searched once
      const sharedQueryCalls = mockSearch.mock.calls.filter(
        (call) => call[0] === 'shared query'
      );
      expect(sharedQueryCalls.length).toBe(1);
    });

    it('skips queries already in Scout research pool', async () => {
      const mockSearch = vi.fn().mockResolvedValue({
        query: 'test',
        answer: 'answer',
        results: [{ title: 'R', url: 'https://example.com', content: 'C' }],
      });

      const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Content.', usage: {} });

      // Create scout output with existing query
      const poolBuilder = new ResearchPoolBuilder();
      poolBuilder.add({
        query: 'existing query',
        answer: 'existing answer',
        results: [{ title: 'E', url: 'https://existing.com', content: 'Existing' }],
        category: 'overview',
        timestamp: Date.now(),
      });

      const scoutOutput: ScoutOutput = {
        ...createMockScoutOutput(),
        researchPool: poolBuilder.build(),
      };

      const deps = createMockSpecialistDeps({
        search: mockSearch,
        generateText: mockGenerateText,
      });

      const plan = createMockArticlePlan({
        sections: [
          { headline: 'S1', goal: 'G1', researchQueries: ['existing query', 'new query'], mustCover: ['item1'] },
        ],
      });

      await runSpecialist(createMockGameContext(), scoutOutput, plan, deps);

      // Should not search for 'existing query' since it's already in pool
      expect(mockSearch).not.toHaveBeenCalledWith('existing query', expect.any(Object));
      expect(mockSearch).toHaveBeenCalledWith('new query', expect.any(Object));
    });
  });

  describe('graceful degradation on search failures', () => {
    it('continues writing sections when search fails', async () => {
      const mockSearch = vi.fn().mockRejectedValue(new Error('Search failed'));

      const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Content.', usage: {} });

      const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      const deps = createMockSpecialistDeps({
        search: mockSearch,
        generateText: mockGenerateText,
        logger: mockLogger,
      });

      const plan = createMockArticlePlan({
        sections: [
          { headline: 'S1', goal: 'G1', researchQueries: ['failing query'], mustCover: ['item1'] },
        ],
      });

      const result = await runSpecialist(
        createMockGameContext(),
        createMockScoutOutput(),
        plan,
        deps
      );

      // Should still produce output despite search failures
      expect(result.markdown).toContain('## S1');
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('sequential vs parallel mode', () => {
    it('writes sections sequentially by default', async () => {
      const callOrder: string[] = [];
      const mockGenerateText = vi.fn().mockImplementation(async (opts) => {
        // Match the current prompt format: This section: "Headline"
        const match = opts.prompt.match(/This section: "([^"]+)"/);
        callOrder.push(match?.[1] || 'unknown');
        return { text: 'Content.', usage: {} };
      });

      const deps = createMockSpecialistDeps({
        generateText: mockGenerateText,
        parallelSections: false,
      });

      const plan = createMockArticlePlan({
        sections: [
          { headline: 'First', goal: 'G1', researchQueries: [], mustCover: ['item1'] },
          { headline: 'Second', goal: 'G2', researchQueries: [], mustCover: ['item2'] },
          { headline: 'Third', goal: 'G3', researchQueries: [], mustCover: ['item3'] },
        ],
      });

      await runSpecialist(createMockGameContext(), createMockScoutOutput(), plan, deps);

      // In sequential mode, calls should be in order
      expect(callOrder).toEqual(['First', 'Second', 'Third']);
    });

    it('can write sections in parallel when enabled', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Content.', usage: {} });

      const deps = createMockSpecialistDeps({
        generateText: mockGenerateText,
        parallelSections: true,
      });

      const plan = createMockArticlePlan();

      const result = await runSpecialist(
        createMockGameContext(),
        createMockScoutOutput(),
        plan,
        deps
      );

      // Should still produce valid output
      expect(result.markdown).toContain('## Getting Started');
      expect(mockGenerateText).toHaveBeenCalledTimes(plan.sections.length);
    });
  });

  describe('progress callbacks', () => {
    it('reports section progress when callback provided', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Content.', usage: {} });

      const onSectionProgress = vi.fn();

      const deps = createMockSpecialistDeps({
        generateText: mockGenerateText,
        onSectionProgress,
      });

      const plan = createMockArticlePlan();

      await runSpecialist(createMockGameContext(), createMockScoutOutput(), plan, deps);

      expect(onSectionProgress).toHaveBeenCalled();
      // Should report progress for each section
      expect(onSectionProgress.mock.calls.length).toBe(plan.sections.length);
    });

    it('reports research progress when callback provided', async () => {
      const mockSearch = vi.fn().mockResolvedValue({
        query: 'test',
        answer: 'answer',
        results: [{ title: 'R', url: 'https://example.com', content: 'C' }],
      });

      const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Content.', usage: {} });

      const onResearchProgress = vi.fn();

      const deps = createMockSpecialistDeps({
        search: mockSearch,
        generateText: mockGenerateText,
        onResearchProgress,
      });

      const plan = createMockArticlePlan({
        sections: [
          { headline: 'S1', goal: 'G1', researchQueries: ['query1', 'query2'], mustCover: ['item1'] },
        ],
      });

      await runSpecialist(createMockGameContext(), createMockScoutOutput(), plan, deps);

      // Should report initial 0 progress and updates as queries complete
      expect(onResearchProgress).toHaveBeenCalled();
    });
  });

  describe('token usage aggregation', () => {
    it('aggregates token usage from all sections', async () => {
      const mockGenerateText = vi.fn()
        .mockResolvedValueOnce({ text: 'S1.', usage: { inputTokens: 100, outputTokens: 50 } })
        .mockResolvedValueOnce({ text: 'S2.', usage: { inputTokens: 150, outputTokens: 75 } })
        .mockResolvedValueOnce({ text: 'S3.', usage: { inputTokens: 200, outputTokens: 100 } });

      const deps = createMockSpecialistDeps({ generateText: mockGenerateText });

      const result = await runSpecialist(
        createMockGameContext(),
        createMockScoutOutput(),
        createMockArticlePlan(),
        deps
      );

      expect(result.tokenUsage.input).toBe(100 + 150 + 200);
      expect(result.tokenUsage.output).toBe(50 + 75 + 100);
    });

    it('handles missing usage data in responses', async () => {
      const mockGenerateText = vi.fn()
        .mockResolvedValueOnce({ text: 'S1.', usage: { inputTokens: 100, outputTokens: 50 } })
        .mockResolvedValueOnce({ text: 'S2.', usage: undefined })
        .mockResolvedValueOnce({ text: 'S3.', usage: { inputTokens: 200 } }); // missing outputTokens

      const deps = createMockSpecialistDeps({ generateText: mockGenerateText });

      const result = await runSpecialist(
        createMockGameContext(),
        createMockScoutOutput(),
        createMockArticlePlan(),
        deps
      );

      expect(result.tokenUsage.input).toBe(100 + 0 + 200);
      expect(result.tokenUsage.output).toBe(50 + 0 + 0);
    });
  });

  describe('source URL collection', () => {
    it('collects source URLs from research pool', async () => {
      const mockSearch = vi.fn().mockResolvedValue({
        query: 'test',
        answer: 'answer',
        results: [
          { title: 'R1', url: 'https://source1.com/page', content: 'C1' },
          { title: 'R2', url: 'https://source2.com/page', content: 'C2' },
        ],
      });

      const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Content.', usage: {} });

      const deps = createMockSpecialistDeps({
        search: mockSearch,
        generateText: mockGenerateText,
      });

      const plan = createMockArticlePlan({
        sections: [
          { headline: 'S1', goal: 'G1', researchQueries: ['query'], mustCover: ['item1'] },
        ],
      });

      const result = await runSpecialist(
        createMockGameContext(),
        createMockScoutOutput(),
        plan,
        deps
      );

      expect(result.sources.length).toBeGreaterThan(0);
    });

    it('deduplicates source URLs', async () => {
      const mockSearch = vi.fn().mockResolvedValue({
        query: 'test',
        answer: 'answer',
        results: [
          { title: 'R1', url: 'https://same.com', content: 'C1' },
          { title: 'R2', url: 'https://same.com', content: 'C2' }, // duplicate
        ],
      });

      const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Content.', usage: {} });

      const deps = createMockSpecialistDeps({
        search: mockSearch,
        generateText: mockGenerateText,
      });

      const plan = createMockArticlePlan({
        sections: [
          { headline: 'S1', goal: 'G1', researchQueries: ['query'], mustCover: ['item1'] },
        ],
      });

      const result = await runSpecialist(
        createMockGameContext(),
        createMockScoutOutput(),
        plan,
        deps
      );

      // Should only have unique URLs
      const uniqueUrls = new Set(result.sources);
      expect(result.sources.length).toBe(uniqueUrls.size);
    });

    it('includes sources section in markdown when sources exist', async () => {
      const mockSearch = vi.fn().mockResolvedValue({
        query: 'test',
        answer: 'answer',
        results: [{ title: 'R', url: 'https://example.com', content: 'C' }],
      });

      const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Content.', usage: {} });

      const deps = createMockSpecialistDeps({
        search: mockSearch,
        generateText: mockGenerateText,
      });

      const plan = createMockArticlePlan({
        sections: [
          { headline: 'S1', goal: 'G1', researchQueries: ['query'], mustCover: ['item1'] },
        ],
      });

      const result = await runSpecialist(
        createMockGameContext(),
        createMockScoutOutput(),
        plan,
        deps
      );

      expect(result.markdown).toContain('## Sources');
    });
  });

  describe('temperature override', () => {
    it('uses default temperature from SPECIALIST_CONFIG', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Content.', usage: {} });

      const deps = createMockSpecialistDeps({ generateText: mockGenerateText });

      await runSpecialist(
        createMockGameContext(),
        createMockScoutOutput(),
        createMockArticlePlan(),
        deps
      );

      const call = mockGenerateText.mock.calls[0][0];
      expect(call.temperature).toBe(SPECIALIST_CONFIG.TEMPERATURE);
    });

    it('uses custom temperature when provided', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Content.', usage: {} });

      const customTemperature = 0.9;
      const deps = createMockSpecialistDeps({
        generateText: mockGenerateText,
        temperature: customTemperature,
      });

      await runSpecialist(
        createMockGameContext(),
        createMockScoutOutput(),
        createMockArticlePlan(),
        deps
      );

      const call = mockGenerateText.mock.calls[0][0];
      expect(call.temperature).toBe(customTemperature);
    });
  });

  describe('cancellation support', () => {
    it('respects abort signal during batch research', async () => {
      const controller = new AbortController();
      controller.abort();

      const mockSearch = vi.fn().mockRejectedValue(new Error('Rate limit'));
      const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Content.', usage: {} });

      const deps = createMockSpecialistDeps({
        search: mockSearch,
        generateText: mockGenerateText,
        signal: controller.signal,
      });

      const plan = createMockArticlePlan({
        sections: [
          { headline: 'S1', goal: 'G1', researchQueries: ['query'], mustCover: ['item1'] },
        ],
      });

      await expect(
        runSpecialist(createMockGameContext(), createMockScoutOutput(), plan, deps)
      ).rejects.toThrow('cancelled');
    });
  });

  describe('research pool enrichment', () => {
    it('returns enriched research pool with new queries', async () => {
      const mockSearch = vi.fn().mockResolvedValue({
        query: 'new query',
        answer: 'answer',
        results: [{ title: 'R', url: 'https://new.com', content: 'C' }],
      });

      const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Content.', usage: {} });

      const deps = createMockSpecialistDeps({
        search: mockSearch,
        generateText: mockGenerateText,
      });

      const plan = createMockArticlePlan({
        sections: [
          { headline: 'S1', goal: 'G1', researchQueries: ['new query'], mustCover: ['item1'] },
        ],
      });

      const result = await runSpecialist(
        createMockGameContext(),
        createMockScoutOutput(),
        plan,
        deps
      );

      // Research pool should contain the new query
      expect(result.researchPool.queryCache.has('new query')).toBe(true);
    });

    it('preserves scout research in enriched pool', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Content.', usage: {} });

      // Create scout output with existing research
      const poolBuilder = new ResearchPoolBuilder();
      poolBuilder.add({
        query: 'scout query',
        answer: 'scout answer',
        results: [{ title: 'Scout', url: 'https://scout.com', content: 'Scout content' }],
        category: 'overview',
        timestamp: Date.now(),
      });

      const scoutOutput: ScoutOutput = {
        ...createMockScoutOutput(),
        researchPool: poolBuilder.build(),
      };

      const deps = createMockSpecialistDeps({ generateText: mockGenerateText });

      const plan = createMockArticlePlan({
        sections: [
          { headline: 'S1', goal: 'G1', researchQueries: [], mustCover: ['item1'] }, // No new queries
        ],
      });

      const result = await runSpecialist(
        createMockGameContext(),
        scoutOutput,
        plan,
        deps
      );

      // Scout research should still be in the pool
      expect(result.researchPool.queryCache.has('scout query')).toBe(true);
    });
  });
});

// ============================================================================
// SPECIALIST_CONFIG Tests
// ============================================================================

describe('SPECIALIST_CONFIG', () => {
  it('exports TEMPERATURE', () => {
    expect(SPECIALIST_CONFIG.TEMPERATURE).toBeDefined();
    expect(typeof SPECIALIST_CONFIG.TEMPERATURE).toBe('number');
  });

  it('exports BATCH_CONCURRENCY', () => {
    expect(SPECIALIST_CONFIG.BATCH_CONCURRENCY).toBeDefined();
    expect(typeof SPECIALIST_CONFIG.BATCH_CONCURRENCY).toBe('number');
  });

  it('exports MAX_SOURCES', () => {
    expect(SPECIALIST_CONFIG.MAX_SOURCES).toBeDefined();
    expect(typeof SPECIALIST_CONFIG.MAX_SOURCES).toBe('number');
  });

  it('has reasonable temperature value', () => {
    expect(SPECIALIST_CONFIG.TEMPERATURE).toBeGreaterThanOrEqual(0);
    expect(SPECIALIST_CONFIG.TEMPERATURE).toBeLessThanOrEqual(1);
  });

  it('has reasonable batch concurrency', () => {
    expect(SPECIALIST_CONFIG.BATCH_CONCURRENCY).toBeGreaterThanOrEqual(1);
    expect(SPECIALIST_CONFIG.BATCH_CONCURRENCY).toBeLessThanOrEqual(10);
  });
});

