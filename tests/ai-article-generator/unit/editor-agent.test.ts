import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  runEditor,
  EDITOR_CONFIG,
  type EditorDeps,
  type EditorOutput,
} from '../../../src/ai/articles/agents/editor';
import type { GameArticleContext, ScoutOutput } from '../../../src/ai/articles/types';
import { createEmptyTokenUsage } from '../../../src/ai/articles/types';
import { createEmptyResearchPool } from '../../../src/ai/articles/research-pool';

// ============================================================================
// Mock Setup
// ============================================================================

const createMockGenerateText = () => vi.fn();
const createMockModel = () => ({} as any);

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
  queryPlan: {
    draftTitle: 'Elden Ring: Complete Beginner Guide',
    queries: [
      { query: '"Elden Ring" beginner guide', engine: 'tavily', purpose: 'General overview', expectedFindings: ['Core mechanics'] },
    ],
  },
  discoveryCheck: {
    needsDiscovery: false,
    discoveryReason: 'none',
  },
  sourceSummaries: [
    {
      url: 'https://ign.com',
      title: 'IGN Review',
      detailedSummary: 'Elden Ring is an action RPG developed by FromSoftware with open world exploration.',
      keyFacts: ['Open world', 'Challenging combat'],
      contentType: 'guide',
      dataPoints: ['2022 release'],
      query: '"Elden Ring" beginner guide',
      qualityScore: 85,
      relevanceScore: 90,
    },
  ],
  researchPool: {
    scoutFindings: {
      overview: [
        {
          query: 'Elden Ring overview',
          answer: 'Great game',
          results: [{ title: 'IGN Review', url: 'https://ign.com', content: 'Review content', score: 0.9 }],
          category: 'overview',
          timestamp: Date.now(),
        },
      ],
      categorySpecific: [],
      recent: [],
    },
    allUrls: new Set(['https://ign.com']),
    queryCache: new Map(),
  },
  sourceUrls: ['https://ign.com'],
  queryPlanningTokenUsage: createEmptyTokenUsage(),
  tokenUsage: createEmptyTokenUsage(),
  confidence: 'high',
  searchApiCosts: { totalUsd: 0, exaSearchCount: 0, tavilySearchCount: 1, exaCostUsd: 0, tavilyCostUsd: 0.008, tavilyCredits: 1 },
  filteredSources: [],
});

const createMockArticlePlan = (overrides: Record<string, any> = {}) => ({
  title: 'Elden Ring: Complete Beginner Guide',
  categorySlug: 'guides',
  excerpt: 'Master the Lands Between with this comprehensive guide covering builds and exploration tips.',
  description: 'Everything you need to know to get started in Elden Ring.',
  tags: ['beginner', 'guide', 'tips'],
  requiredElements: ['Game basics', 'Build types', 'Exploration tips'],
  sections: [
    { headline: 'Getting Started', goal: 'Help new players', researchQueries: ['elden ring basics'], mustCover: ['Game basics'] },
    { headline: 'Character Builds', goal: 'Cover builds', researchQueries: ['elden ring builds'], mustCover: ['Build types'] },
    { headline: 'Exploration Tips', goal: 'Guide exploration', researchQueries: ['elden ring exploration'], mustCover: ['Exploration tips'] },
  ],
  ...overrides,
});

const createMockEditorDeps = (overrides: Partial<EditorDeps> = {}): EditorDeps => ({
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
// runEditor Tests
// ============================================================================

describe('runEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('basic functionality', () => {
    it('returns EditorOutput with plan and token usage', async () => {
      const mockPlan = createMockArticlePlan();
      const mockGenerateText = vi.fn().mockResolvedValue({
        output: mockPlan,
        usage: { promptTokens: 1000, completionTokens: 500 },
      });

      const deps = createMockEditorDeps({ generateText: mockGenerateText });
      const context = createMockGameContext();
      const scoutOutput = createMockScoutOutput();

      const result = await runEditor(context, scoutOutput, deps);

      expect(result).toHaveProperty('plan');
      expect(result).toHaveProperty('tokenUsage');
      expect(result.plan.title).toBe('Elden Ring: Complete Beginner Guide');
    });

    it('calls generateText with correct parameters', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({
        output: createMockArticlePlan(),
        usage: { promptTokens: 100, completionTokens: 50 },
      });

      const deps = createMockEditorDeps({ generateText: mockGenerateText });
      const context = createMockGameContext();
      const scoutOutput = createMockScoutOutput();

      await runEditor(context, scoutOutput, deps);

      expect(mockGenerateText).toHaveBeenCalledTimes(1);
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: deps.model,
          temperature: EDITOR_CONFIG.TEMPERATURE,
          output: expect.objectContaining({
            schema: expect.any(Object),
          }),
          system: expect.any(String),
          prompt: expect.any(String),
        })
      );
    });

    it('includes game context in prompt', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({
        output: createMockArticlePlan(),
        usage: { promptTokens: 100, completionTokens: 50 },
      });

      const deps = createMockEditorDeps({ generateText: mockGenerateText });
      const context = createMockGameContext({ gameName: 'Dark Souls' });
      const scoutOutput = createMockScoutOutput();

      await runEditor(context, scoutOutput, deps);

      const call = mockGenerateText.mock.calls[0][0];
      expect(call.prompt).toContain('Dark Souls');
    });
  });

  describe('category slug normalization', () => {
    it('normalizes "guide" to "guides"', async () => {
      const mockPlan = createMockArticlePlan({ categorySlug: 'guide' });
      const mockGenerateObject = vi.fn().mockResolvedValue({
        object: mockPlan,
        usage: {},
      });

      const deps = createMockEditorDeps({ generateText: mockGenerateText });
      const result = await runEditor(createMockGameContext(), createMockScoutOutput(), deps);

      expect(result.plan.categorySlug).toBe('guides');
    });

    it('preserves valid category slugs', async () => {
      const validSlugs = ['news', 'reviews', 'guides', 'lists'];

      for (const slug of validSlugs) {
        const mockPlan = createMockArticlePlan({ categorySlug: slug });
        const mockGenerateObject = vi.fn().mockResolvedValue({
          object: mockPlan,
          usage: {},
        });

        const deps = createMockEditorDeps({ generateText: mockGenerateText });
        const result = await runEditor(createMockGameContext(), createMockScoutOutput(), deps);

        expect(result.plan.categorySlug).toBe(slug);
      }
    });
  });

  describe('game context handling', () => {
    it('includes gameName from context in plan', async () => {
      const mockPlan = createMockArticlePlan();
      const mockGenerateObject = vi.fn().mockResolvedValue({
        object: mockPlan,
        usage: {},
      });

      const deps = createMockEditorDeps({ generateText: mockGenerateText });
      const context = createMockGameContext({ gameName: 'Hollow Knight' });

      const result = await runEditor(context, createMockScoutOutput(), deps);

      expect(result.plan.gameName).toBe('Hollow Knight');
    });

    it('includes gameSlug from context in plan', async () => {
      const mockPlan = createMockArticlePlan();
      const mockGenerateObject = vi.fn().mockResolvedValue({
        object: mockPlan,
        usage: {},
      });

      const deps = createMockEditorDeps({ generateText: mockGenerateText });
      const context = createMockGameContext({ gameSlug: 'hollow-knight' });

      const result = await runEditor(context, createMockScoutOutput(), deps);

      expect(result.plan.gameSlug).toBe('hollow-knight');
    });

    it('handles undefined gameSlug', async () => {
      const mockPlan = createMockArticlePlan();
      const mockGenerateObject = vi.fn().mockResolvedValue({
        object: mockPlan,
        usage: {},
      });

      const deps = createMockEditorDeps({ generateText: mockGenerateText });
      const context = createMockGameContext({ gameSlug: undefined });

      const result = await runEditor(context, createMockScoutOutput(), deps);

      expect(result.plan.gameSlug).toBeUndefined();
    });

    it('handles null gameSlug', async () => {
      const mockPlan = createMockArticlePlan();
      const mockGenerateObject = vi.fn().mockResolvedValue({
        object: mockPlan,
        usage: {},
      });

      const deps = createMockEditorDeps({ generateText: mockGenerateText });
      const context = createMockGameContext({ gameSlug: null });

      const result = await runEditor(context, createMockScoutOutput(), deps);

      expect(result.plan.gameSlug).toBeUndefined();
    });
  });

  describe('safety settings', () => {
    it('applies default safety settings when AI omits them', async () => {
      const mockPlan = createMockArticlePlan();
      delete (mockPlan as any).safety;

      const mockGenerateObject = vi.fn().mockResolvedValue({
        object: mockPlan,
        usage: {},
      });

      const deps = createMockEditorDeps({ generateText: mockGenerateText });
      const result = await runEditor(createMockGameContext(), createMockScoutOutput(), deps);

      expect(result.plan.safety).toBeDefined();
      expect(result.plan.safety.noScoresUnlessReview).toBe(true);
    });

    it('preserves AI-provided safety settings', async () => {
      const mockPlan = createMockArticlePlan({
        safety: { noScoresUnlessReview: false },
      });

      const mockGenerateObject = vi.fn().mockResolvedValue({
        object: mockPlan,
        usage: {},
      });

      const deps = createMockEditorDeps({ generateText: mockGenerateText });
      const result = await runEditor(createMockGameContext(), createMockScoutOutput(), deps);

      expect(result.plan.safety.noScoresUnlessReview).toBe(false);
    });
  });

  describe('token usage tracking', () => {
    it('tracks token usage from API response', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({
        output: createMockArticlePlan(),
        usage: { inputTokens: 1500, outputTokens: 750 },
      });

      const deps = createMockEditorDeps({ generateText: mockGenerateText });
      const result = await runEditor(createMockGameContext(), createMockScoutOutput(), deps);

      expect(result.tokenUsage.input).toBe(1500);
      expect(result.tokenUsage.output).toBe(750);
    });

    it('handles missing usage data gracefully', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({
        output: createMockArticlePlan(),
        usage: undefined,
      });

      const deps = createMockEditorDeps({ generateText: mockGenerateText });
      const result = await runEditor(createMockGameContext(), createMockScoutOutput(), deps);

      expect(result.tokenUsage.input).toBe(0);
      expect(result.tokenUsage.output).toBe(0);
    });

    it('handles partial usage data', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({
        output: createMockArticlePlan(),
        usage: { inputTokens: 100 }, // missing outputTokens
      });

      const deps = createMockEditorDeps({ generateText: mockGenerateText });
      const result = await runEditor(createMockGameContext(), createMockScoutOutput(), deps);

      expect(result.tokenUsage.input).toBe(100);
      expect(result.tokenUsage.output).toBe(0);
    });
  });

  describe('temperature override', () => {
    it('uses default temperature from EDITOR_CONFIG', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({
        output: createMockArticlePlan(),
        usage: {},
      });

      const deps = createMockEditorDeps({ generateText: mockGenerateText });
      await runEditor(createMockGameContext(), createMockScoutOutput(), deps);

      const call = mockGenerateText.mock.calls[0][0];
      expect(call.temperature).toBe(EDITOR_CONFIG.TEMPERATURE);
    });

    it('uses custom temperature when provided', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({
        output: createMockArticlePlan(),
        usage: {},
      });

      const customTemperature = 0.8;
      const deps = createMockEditorDeps({
        generateText: mockGenerateText,
        temperature: customTemperature,
      });

      await runEditor(createMockGameContext(), createMockScoutOutput(), deps);

      const call = mockGenerateText.mock.calls[0][0];
      expect(call.temperature).toBe(customTemperature);
    });
  });

  describe('cancellation support', () => {
    it('passes signal to retry wrapper', async () => {
      const controller = new AbortController();
      const mockGenerateText = vi.fn().mockResolvedValue({
        output: createMockArticlePlan(),
        usage: {},
      });

      const deps = createMockEditorDeps({
        generateText: mockGenerateText,
        signal: controller.signal,
      });

      // Should complete normally when not aborted
      await expect(
        runEditor(createMockGameContext(), createMockScoutOutput(), deps)
      ).resolves.toBeDefined();
    });

    it('respects aborted signal', async () => {
      const controller = new AbortController();
      controller.abort();

      const mockGenerateObject = vi.fn().mockRejectedValue(new Error('Rate limit'));

      const deps = createMockEditorDeps({
        generateText: mockGenerateText,
        signal: controller.signal,
      });

      await expect(
        runEditor(createMockGameContext(), createMockScoutOutput(), deps)
      ).rejects.toThrow('cancelled');
    });
  });

  describe('logger usage', () => {
    it('logs debug messages during generation', async () => {
      const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      const mockGenerateText = vi.fn().mockResolvedValue({
        output: createMockArticlePlan(),
        usage: {},
      });

      const deps = createMockEditorDeps({
        generateText: mockGenerateText,
        logger: mockLogger,
      });

      await runEditor(createMockGameContext(), createMockScoutOutput(), deps);

      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('uses default logger when not provided', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({
        output: createMockArticlePlan(),
        usage: {},
      });

      const deps: EditorDeps = {
        generateText: mockGenerateText,
        model: createMockModel(),
      };

      // Should not throw when logger is not provided
      await expect(
        runEditor(createMockGameContext(), createMockScoutOutput(), deps)
      ).resolves.toBeDefined();
    });
  });

  describe('category hints handling', () => {
    it('includes category hints in prompt when provided', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({
        output: createMockArticlePlan(),
        usage: {},
      });

      const deps = createMockEditorDeps({ generateText: mockGenerateText });
      const context = createMockGameContext({
        categoryHints: [
          { slug: 'guides', systemPrompt: 'Focus on beginner tips' },
        ],
      });

      await runEditor(context, createMockScoutOutput(), deps);

      const call = mockGenerateText.mock.calls[0][0];
      expect(call.prompt).toContain('guides');
    });
  });

  describe('error handling', () => {
    it('propagates errors from generateObject', async () => {
      const mockError = new Error('API error');
      const mockGenerateObject = vi.fn().mockRejectedValue(mockError);

      const deps = createMockEditorDeps({ generateText: mockGenerateText });

      await expect(
        runEditor(createMockGameContext(), createMockScoutOutput(), deps)
      ).rejects.toThrow('API error');
    });
  });
});

// ============================================================================
// EDITOR_CONFIG Tests
// ============================================================================

describe('EDITOR_CONFIG', () => {
  it('exports TEMPERATURE', () => {
    expect(EDITOR_CONFIG.TEMPERATURE).toBeDefined();
    expect(typeof EDITOR_CONFIG.TEMPERATURE).toBe('number');
  });

  it('exports OVERVIEW_LINES_IN_PROMPT', () => {
    expect(EDITOR_CONFIG.OVERVIEW_LINES_IN_PROMPT).toBeDefined();
    expect(typeof EDITOR_CONFIG.OVERVIEW_LINES_IN_PROMPT).toBe('number');
  });

  it('has reasonable temperature value', () => {
    expect(EDITOR_CONFIG.TEMPERATURE).toBeGreaterThanOrEqual(0);
    expect(EDITOR_CONFIG.TEMPERATURE).toBeLessThanOrEqual(1);
  });
});

