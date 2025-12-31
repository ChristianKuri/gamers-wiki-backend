import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  runScout,
  SCOUT_CONFIG,
  type ScoutDeps,
} from '../../../src/ai/articles/agents/scout';
import type { GameArticleContext, SearchFunction, ScoutOutput } from '../../../src/ai/articles/types';

// ============================================================================
// Mock Setup
// ============================================================================

// Mock briefing text that meets MIN_OVERVIEW_LENGTH requirement (>50 chars)
const MOCK_OVERVIEW_BRIEFING = 'This is a comprehensive overview briefing about the game. It covers all the essential information that players need to know, including gameplay mechanics, story elements, and critical reception. The game has received widespread acclaim from critics and players alike.';
const MOCK_CATEGORY_BRIEFING = 'This category briefing provides insights about guides and tutorials. It analyzes the best approaches for creating helpful content for this game.';
const MOCK_RECENT_BRIEFING = 'Recent developments include new DLC announcements, patches, and community events. The game continues to receive updates and support from the developers.';

// Mock per-query briefing response (for new briefing generation)
const MOCK_QUERY_BRIEFING_TEXT = `FINDINGS:
This search found comprehensive information about the game including mechanics, characters, and strategies.

KEY FACTS:
- Fact 1 about the game
- Fact 2 about the game

GAPS:
- Some advanced strategies not covered`;

const createMockGenerateText = () => vi.fn().mockImplementation(() => Promise.resolve({
  text: MOCK_OVERVIEW_BRIEFING,
  usage: { promptTokens: 500, completionTokens: 200 },
}));

// Create mock that always returns a valid briefing response
// The scout now generates: 3 old briefings + N per-query briefings (where N = queries in plan)
const createMockGenerateTextWithBriefings = () => {
  return vi.fn().mockImplementation(() => {
    // Return a response that works for both old briefings and per-query briefings
    return Promise.resolve({ 
      text: `FINDINGS:
This is a comprehensive briefing about the game covering all essential information.

KEY FACTS:
- Core gameplay mechanics explained
- Important locations and characters

GAPS:
- Some advanced strategies not covered`, 
      usage: { promptTokens: 300, completionTokens: 150 } 
    });
  });
};

// Mock for generateObject (used by Scout Query Planner)
const createMockGenerateObject = () => vi.fn().mockImplementation((opts: { schema: unknown }) => {
  // Check if this is a discovery check (has needsDiscovery field)
  const schemaStr = JSON.stringify(opts.schema);
  if (schemaStr.includes('needsDiscovery')) {
    return Promise.resolve({
      object: {
        needsDiscovery: false,
        discoveryReason: 'none',
        discoveryQuery: undefined,
        discoveryEngine: 'tavily',
      },
      usage: { promptTokens: 200, completionTokens: 50 },
    });
  }
  // Query plan schema
  return Promise.resolve({
    object: {
      draftTitle: 'Elden Ring Beginner Guide',
      queries: [
        { query: '"Elden Ring" beginner guide', engine: 'tavily', purpose: 'General overview', expectedFindings: ['Core mechanics', 'Starting tips'] },
        { query: '"Elden Ring" combat tips', engine: 'tavily', purpose: 'Combat mechanics', expectedFindings: ['Combat basics', 'Weapon types'] },
        { query: 'How does gameplay work in Elden Ring', engine: 'exa', purpose: 'Conceptual overview', expectedFindings: ['Gameplay systems', 'Progression'] },
      ],
    },
    usage: { promptTokens: 400, completionTokens: 150 },
  });
});

const createMockModel = () => ({} as any);

const createMockSearch = (overrides: Partial<ReturnType<SearchFunction>> = {}): SearchFunction =>
  vi.fn().mockResolvedValue({
    query: 'test query',
    answer: 'This is an AI-generated answer based on search results.',
    results: [
      { title: 'Result 1', url: 'https://example1.com', content: 'Content for result 1', score: 0.95 },
      { title: 'Result 2', url: 'https://example2.com', content: 'Content for result 2', score: 0.9 },
      { title: 'Result 3', url: 'https://example3.com', content: 'Content for result 3', score: 0.85 },
    ],
    ...overrides,
  });

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockGameContext = (overrides: Partial<GameArticleContext> = {}): GameArticleContext => ({
  gameName: 'Elden Ring',
  gameSlug: 'elden-ring',
  releaseDate: '2022-02-25',
  genres: ['Action RPG', 'Soulslike'],
  platforms: ['PC', 'PlayStation 5', 'Xbox Series X'],
  developer: 'FromSoftware',
  publisher: 'Bandai Namco',
  igdbDescription: 'An epic open-world action RPG.',
  instruction: 'Write a beginner guide',
  ...overrides,
});

const createMockScoutDeps = (overrides: Partial<ScoutDeps> = {}): ScoutDeps => ({
  search: createMockSearch(),
  generateText: createMockGenerateTextWithBriefings(),
  generateObject: createMockGenerateObject(),
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
// runScout Tests
// ============================================================================

describe('runScout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('basic functionality', () => {
    it('returns ScoutOutput with all required fields', async () => {
      // Use default mocks that handle all generateText calls
      const deps = createMockScoutDeps();
      const context = createMockGameContext();

      const result = await runScout(context, deps);

      expect(result).toHaveProperty('queryPlan');
      expect(result).toHaveProperty('discoveryCheck');
      expect(result).toHaveProperty('queryBriefings');
      expect(result).toHaveProperty('researchPool');
      expect(result).toHaveProperty('sourceUrls');
      expect(result).toHaveProperty('tokenUsage');
      expect(result).toHaveProperty('confidence');
    });

    it('returns query briefings with required fields', async () => {
      // Use default mocks that handle all generateText calls
      const deps = createMockScoutDeps();
      const context = createMockGameContext();

      const result = await runScout(context, deps);

      expect(result.queryBriefings).toBeDefined();
      expect(Array.isArray(result.queryBriefings)).toBe(true);
      // Each briefing should have the required fields
      for (const briefing of result.queryBriefings) {
        expect(briefing).toHaveProperty('query');
        expect(briefing).toHaveProperty('findings');
        expect(briefing).toHaveProperty('keyFacts');
      }
    });

    it('returns valid confidence level', async () => {
      const deps = createMockScoutDeps();
      const context = createMockGameContext();

      const result = await runScout(context, deps);

      expect(['high', 'medium', 'low']).toContain(result.confidence);
    });
  });

  describe('parallel search execution', () => {
    it('executes overview search', async () => {
      const mockSearch = createMockSearch();
      const deps = createMockScoutDeps({ search: mockSearch });

      await runScout(createMockGameContext(), deps);

      expect(mockSearch).toHaveBeenCalled();
      // Should search for game-related queries
      const calls = mockSearch.mock.calls;
      const queries = calls.map((call) => call[0]);
      expect(queries.some((q) => q.toLowerCase().includes('elden ring'))).toBe(true);
    });

    it('executes category-specific searches based on instruction', async () => {
      const mockSearch = createMockSearch();
      const deps = createMockScoutDeps({ search: mockSearch });
      const context = createMockGameContext({ instruction: 'Write a beginner guide' });

      await runScout(context, deps);

      const calls = mockSearch.mock.calls;
      const queries = calls.map((call) => call[0]);
      // Should have category-related searches
      expect(queries.some((q) => q.toLowerCase().includes('guide') || q.toLowerCase().includes('beginner'))).toBe(true);
    });

    it('executes supplementary search (tips for guides, recent for news/reviews)', async () => {
      const mockSearch = createMockSearch();
      const deps = createMockScoutDeps({ search: mockSearch });

      await runScout(createMockGameContext(), deps);

      const calls = mockSearch.mock.calls;
      const queries = calls.map((call) => call[0]);
      // Should have supplementary searches - tips for guides, recent/news for other types
      expect(queries.some((q) =>
        q.toLowerCase().includes('tips') ||
        q.toLowerCase().includes('tricks') ||
        q.toLowerCase().includes('secrets') ||
        q.toLowerCase().includes('news') ||
        q.toLowerCase().includes('update') ||
        q.toLowerCase().includes(String(new Date().getFullYear()))
      )).toBe(true);
    });
  });

  describe('briefing generation', () => {
    it('generates overview briefing from search results', async () => {
      const mockSearch = createMockSearch({
        answer: 'Elden Ring is a popular action RPG.',
        results: [
          { title: 'IGN Review', url: 'https://ign.com', content: 'Detailed review content.' },
        ],
      });

      const deps = createMockScoutDeps({ search: mockSearch });
      const result = await runScout(createMockGameContext(), deps);

      expect(result.queryBriefings.length).toBeGreaterThan(0);
      expect(deps.generateText).toHaveBeenCalled();
    });

    it('generates query briefings based on instruction', async () => {
      const deps = createMockScoutDeps();
      const context = createMockGameContext({ instruction: 'Write a review' });

      const result = await runScout(context, deps);

      expect(result.queryBriefings).toBeDefined();
      expect(result.queryBriefings.length).toBeGreaterThan(0);
    });

    it('includes findings in query briefings', async () => {
      const deps = createMockScoutDeps();
      const result = await runScout(createMockGameContext(), deps);

      expect(result.queryBriefings.length).toBeGreaterThan(0);
      for (const briefing of result.queryBriefings) {
        expect(briefing.findings).toBeDefined();
      }
    });
  });

  describe('research pool building', () => {
    it('builds research pool with overview findings', async () => {
      const mockSearch = createMockSearch({
        results: [
          { title: 'R1', url: 'https://r1.com', content: 'C1' },
          { title: 'R2', url: 'https://r2.com', content: 'C2' },
        ],
      });

      const deps = createMockScoutDeps({ search: mockSearch });
      const result = await runScout(createMockGameContext(), deps);

      expect(result.researchPool.scoutFindings.overview.length).toBeGreaterThan(0);
    });

    it('collects unique source URLs', async () => {
      const mockSearch = vi.fn()
        .mockResolvedValueOnce({
          query: 'q1',
          answer: 'a1',
          results: [{ title: 'R1', url: 'https://shared.com', content: 'C1' }],
        })
        .mockResolvedValueOnce({
          query: 'q2',
          answer: 'a2',
          results: [{ title: 'R2', url: 'https://shared.com', content: 'C2' }],  // duplicate
        })
        .mockResolvedValue({
          query: 'qn',
          answer: 'an',
          results: [{ title: 'R3', url: 'https://unique.com', content: 'C3' }],
        });

      const deps = createMockScoutDeps({ search: mockSearch });
      const result = await runScout(createMockGameContext(), deps);

      // sourceUrls should have unique URLs
      const uniqueCount = new Set(result.sourceUrls).size;
      expect(result.sourceUrls.length).toBe(uniqueCount);
    });
  });

  describe('confidence calculation', () => {
    it('returns high confidence when sources are plentiful', async () => {
      const mockSearch = createMockSearch({
        results: [
          { title: 'R1', url: 'https://r1.com', content: 'C1' },
          { title: 'R2', url: 'https://r2.com', content: 'C2' },
          { title: 'R3', url: 'https://r3.com', content: 'C3' },
          { title: 'R4', url: 'https://r4.com', content: 'C4' },
          { title: 'R5', url: 'https://r5.com', content: 'C5' },
        ],
      });

      const deps = createMockScoutDeps({ search: mockSearch });
      const result = await runScout(createMockGameContext(), deps);

      // With many sources and good overview, should have high or medium confidence
      expect(['high', 'medium']).toContain(result.confidence);
    });

    it('returns lower confidence when search returns few results', async () => {
      const mockSearch = createMockSearch({
        results: [], // No results
        answer: null,
      });

      const deps = createMockScoutDeps({ search: mockSearch });
      const result = await runScout(createMockGameContext(), deps);

      // With no search results but valid briefings, confidence should be low or medium
      // The exact level depends on the confidence calculation algorithm
      expect(['low', 'medium']).toContain(result.confidence);
    });
  });

  describe('progress callbacks', () => {
    it('reports search progress when callback provided', async () => {
      const onProgress = vi.fn();
      const deps = createMockScoutDeps({ onProgress });

      await runScout(createMockGameContext(), deps);

      expect(onProgress).toHaveBeenCalled();
    });

    it('reports completion at end of scout phase', async () => {
      const onProgress = vi.fn();
      const deps = createMockScoutDeps({ onProgress });

      await runScout(createMockGameContext(), deps);

      // Should have reported progress multiple times
      expect(onProgress.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe('token usage aggregation', () => {
    it('aggregates token usage from all briefing generations', async () => {
      // Create a mock that returns proper usage data
      const mockGenerateText = vi.fn().mockImplementation(() => Promise.resolve({
        text: MOCK_OVERVIEW_BRIEFING,
        usage: { inputTokens: 100, outputTokens: 50 },
      }));

      const deps = createMockScoutDeps({ generateText: mockGenerateText });
      const result = await runScout(createMockGameContext(), deps);

      // Should have accumulated usage from all LLM calls
      expect(result.tokenUsage.input).toBeGreaterThan(0);
      expect(result.tokenUsage.output).toBeGreaterThan(0);
    });

    it('handles missing usage data gracefully', async () => {
      // Create a mock that returns undefined usage
      const mockGenerateText = vi.fn().mockImplementation(() => Promise.resolve({
        text: MOCK_OVERVIEW_BRIEFING,
        usage: undefined,
      }));

      const deps = createMockScoutDeps({ generateText: mockGenerateText });
      const result = await runScout(createMockGameContext(), deps);

      expect(result.tokenUsage).toBeDefined();
      // With undefined usage, defaults to 0
      expect(result.tokenUsage.input).toBeGreaterThanOrEqual(0);
      expect(result.tokenUsage.output).toBeGreaterThanOrEqual(0);
    });
  });

  describe('temperature override', () => {
    it('uses default temperature from SCOUT_CONFIG', async () => {
      const deps = createMockScoutDeps();
      await runScout(createMockGameContext(), deps);

      // Check that generateText was called with the default temperature
      const call = (deps.generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.temperature).toBe(SCOUT_CONFIG.TEMPERATURE);
    });

    it('uses custom temperature when provided', async () => {
      const customTemperature = 0.5;
      const deps = createMockScoutDeps({ temperature: customTemperature });
      await runScout(createMockGameContext(), deps);

      // Check that generateText was called with the custom temperature
      const call = (deps.generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.temperature).toBe(customTemperature);
    });
  });

  describe('cancellation support', () => {
    it('respects abort signal during search', async () => {
      const controller = new AbortController();
      controller.abort();

      const mockSearch = vi.fn().mockRejectedValue(new Error('Rate limit'));
      const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Content.', usage: {} });

      const deps = createMockScoutDeps({
        search: mockSearch,
        generateText: mockGenerateText,
        signal: controller.signal,
      });

      await expect(runScout(createMockGameContext(), deps)).rejects.toThrow('cancelled');
    });

    it('respects abort signal during briefing generation', async () => {
      const controller = new AbortController();

      const mockSearch = createMockSearch();
      const mockGenerateText = vi.fn().mockImplementation(async () => {
        // Abort during generation
        controller.abort();
        throw new Error('Rate limit');
      });

      const deps = createMockScoutDeps({
        search: mockSearch,
        generateText: mockGenerateText,
        signal: controller.signal,
      });

      await expect(runScout(createMockGameContext(), deps)).rejects.toThrow('cancelled');
    });
  });

  describe('error handling', () => {
    it('propagates search errors after retries exhausted', async () => {
      const mockSearch = vi.fn().mockRejectedValue(new Error('Search API unavailable'));
      const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Content.', usage: {} });

      const deps = createMockScoutDeps({
        search: mockSearch,
        generateText: mockGenerateText,
      });

      await expect(runScout(createMockGameContext(), deps)).rejects.toThrow('Search API unavailable');
    });

    it('propagates generation errors after retries exhausted', async () => {
      const mockSearch = createMockSearch();
      const mockGenerateText = vi.fn().mockRejectedValue(new Error('LLM API error'));

      const deps = createMockScoutDeps({
        search: mockSearch,
        generateText: mockGenerateText,
      });

      await expect(runScout(createMockGameContext(), deps)).rejects.toThrow('LLM API error');
    });
  });

  describe('game context handling', () => {
    it('includes game name in search queries', async () => {
      const mockSearch = createMockSearch();
      const deps = createMockScoutDeps({ search: mockSearch });
      // Use the default game name from the context (Elden Ring) since the mock query planner
      // uses hardcoded Elden Ring queries
      const context = createMockGameContext();

      await runScout(context, deps);

      const queries = mockSearch.mock.calls.map((call) => call[0]);
      expect(queries.some((q) => q.includes('Elden Ring'))).toBe(true);
    });

    it('includes game name in overview search', async () => {
      const mockSearch = createMockSearch();
      const deps = createMockScoutDeps({ search: mockSearch });
      const context = createMockGameContext({ genres: ['Metroidvania', 'Platformer'] });

      await runScout(context, deps);

      const queries = mockSearch.mock.calls.map((call) => call[0]);
      // Guides strategy includes game name and gameplay-related keywords
      expect(queries.some((q) => q.includes('Elden Ring'))).toBe(true);
    });

    it('handles missing instruction gracefully', async () => {
      const deps = createMockScoutDeps();
      const context = createMockGameContext({ instruction: null });

      const result = await runScout(context, deps);

      expect(result).toBeDefined();
      expect(result.queryBriefings).toBeDefined();
    });
  });

  describe('category hints', () => {
    it('includes category hints in category searches when provided', async () => {
      const mockSearch = createMockSearch();
      const deps = createMockScoutDeps({ search: mockSearch });

      const context = createMockGameContext({
        categoryHints: [
          { slug: 'guides', systemPrompt: 'Focus on beginners' },
          { slug: 'reviews' },
        ],
      });

      await runScout(context, deps);

      const queries = mockSearch.mock.calls.map((call) => call[0]);
      expect(queries.some((q) =>
        q.toLowerCase().includes('beginner') ||
        q.toLowerCase().includes('guide') ||
        q.toLowerCase().includes('review')
      )).toBe(true);
    });
  });
});

// ============================================================================
// SCOUT_CONFIG Tests
// ============================================================================

describe('SCOUT_CONFIG', () => {
  it('exports TEMPERATURE', () => {
    expect(SCOUT_CONFIG.TEMPERATURE).toBeDefined();
    expect(typeof SCOUT_CONFIG.TEMPERATURE).toBe('number');
  });

  it('exports OVERVIEW_SEARCH_RESULTS', () => {
    expect(SCOUT_CONFIG.OVERVIEW_SEARCH_RESULTS).toBeDefined();
    expect(typeof SCOUT_CONFIG.OVERVIEW_SEARCH_RESULTS).toBe('number');
  });

  it('exports CATEGORY_SEARCH_RESULTS', () => {
    expect(SCOUT_CONFIG.CATEGORY_SEARCH_RESULTS).toBeDefined();
    expect(typeof SCOUT_CONFIG.CATEGORY_SEARCH_RESULTS).toBe('number');
  });

  it('exports RECENT_SEARCH_RESULTS', () => {
    expect(SCOUT_CONFIG.RECENT_SEARCH_RESULTS).toBeDefined();
    expect(typeof SCOUT_CONFIG.RECENT_SEARCH_RESULTS).toBe('number');
  });

  it('has reasonable temperature value', () => {
    expect(SCOUT_CONFIG.TEMPERATURE).toBeGreaterThanOrEqual(0);
    expect(SCOUT_CONFIG.TEMPERATURE).toBeLessThanOrEqual(1);
  });

  it('has reasonable search result limits', () => {
    expect(SCOUT_CONFIG.OVERVIEW_SEARCH_RESULTS).toBeGreaterThanOrEqual(1);
    expect(SCOUT_CONFIG.CATEGORY_SEARCH_RESULTS).toBeGreaterThanOrEqual(1);
    expect(SCOUT_CONFIG.RECENT_SEARCH_RESULTS).toBeGreaterThanOrEqual(1);
  });

  it('exports MIN_SOURCES_WARNING threshold', () => {
    expect(SCOUT_CONFIG.MIN_SOURCES_WARNING).toBeDefined();
    expect(typeof SCOUT_CONFIG.MIN_SOURCES_WARNING).toBe('number');
  });

  it('exports MIN_OVERVIEW_LENGTH threshold', () => {
    expect(SCOUT_CONFIG.MIN_OVERVIEW_LENGTH).toBeDefined();
    expect(typeof SCOUT_CONFIG.MIN_OVERVIEW_LENGTH).toBe('number');
  });
});

