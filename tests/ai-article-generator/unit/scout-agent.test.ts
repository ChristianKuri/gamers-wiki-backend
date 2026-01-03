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
      expect(result).toHaveProperty('researchPool');
      expect(result).toHaveProperty('sourceUrls');
      expect(result).toHaveProperty('tokenUsage');
      expect(result).toHaveProperty('confidence');
    });

    it('returns valid output without briefings (briefing LLM step removed)', async () => {
      // Briefing generation has been removed to save ~$0.07/article
      // Source summaries from Cleaner are used directly instead
      const deps = createMockScoutDeps();
      const context = createMockGameContext();

      const result = await runScout(context, deps);

      // queryBriefings field has been completely removed from ScoutOutput
      expect(result).not.toHaveProperty('queryBriefings');
      // tokenUsage equals queryPlanningTokenUsage now
      expect(result.tokenUsage).toEqual(result.queryPlanningTokenUsage);
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

  describe('source summaries (replaces briefing generation)', () => {
    // Note: queryBriefings was completely removed to save ~$0.07/article.
    // Scout now extracts sourceSummaries directly from Cleaner's output.
    // Without cleaningDeps, sourceSummaries will be empty (sources have no quality scores).
    
    it('does not have queryBriefings field (completely removed)', async () => {
      const mockSearch = createMockSearch({
        answer: 'Elden Ring is a popular action RPG.',
        results: [
          { title: 'IGN Review', url: 'https://ign.com', content: 'Detailed review content.' },
        ],
      });

      const deps = createMockScoutDeps({ search: mockSearch });
      const result = await runScout(createMockGameContext(), deps);

      // queryBriefings field was completely removed from ScoutOutput
      expect(result).not.toHaveProperty('queryBriefings');
      // generateText should NOT be called for briefings anymore
    });

    it('output structure is valid without queryBriefings', async () => {
      const deps = createMockScoutDeps();
      const context = createMockGameContext({ instruction: 'Write a review' });

      const result = await runScout(context, deps);

      // queryBriefings field was completely removed
      expect(result).not.toHaveProperty('queryBriefings');
      expect(result).toHaveProperty('queryPlan');
    });

    it('sourceSummaries is empty without cleaning deps (no quality scores)', async () => {
      // Without cleaningDeps, search results don't have quality/relevance scores
      // or detailedSummary, so sourceSummaries will be empty
      const deps = createMockScoutDeps();
      const result = await runScout(createMockGameContext(), deps);

      // sourceSummaries requires sources with detailedSummary and scores
      expect(result.sourceSummaries || []).toEqual([]);
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
    it('returns confidence based on sources and summaries', async () => {
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

      // Without cleaningDeps, sourceSummaries is empty, so confidence may be low
      // This tests that confidence calculation runs without errors
      expect(['high', 'medium', 'low']).toContain(result.confidence);
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

  describe('token usage aggregation (briefing removed)', () => {
    it('tokenUsage equals queryPlanningTokenUsage (no briefing)', async () => {
      // Briefing generation was removed, so tokenUsage only includes query planning
      const deps = createMockScoutDeps();
      const result = await runScout(createMockGameContext(), deps);

      // tokenUsage should equal queryPlanningTokenUsage since briefing was removed
      expect(result.tokenUsage).toEqual(result.queryPlanningTokenUsage);
    });

    it('handles missing usage data gracefully', async () => {
      const deps = createMockScoutDeps();
      const result = await runScout(createMockGameContext(), deps);

      expect(result.tokenUsage).toBeDefined();
      // tokenUsage comes from query planning, may be 0 if generateObject wasn't called
      expect(result.tokenUsage.input).toBeGreaterThanOrEqual(0);
      expect(result.tokenUsage.output).toBeGreaterThanOrEqual(0);
    });
  });

  describe('generateText not called (briefing removed)', () => {
    it('does not call generateText during normal execution', async () => {
      const mockGenerateText = vi.fn();
      const deps = createMockScoutDeps({ generateText: mockGenerateText });
      
      await runScout(createMockGameContext(), deps);

      // generateText should NOT be called since briefing generation was removed
      expect(mockGenerateText).not.toHaveBeenCalled();
    });

    it('temperature override does not affect Scout (generateText not called)', async () => {
      const customTemperature = 0.5;
      const mockGenerateText = vi.fn();
      const deps = createMockScoutDeps({ generateText: mockGenerateText, temperature: customTemperature });
      
      await runScout(createMockGameContext(), deps);

      // generateText should NOT be called since briefing generation was removed
      expect(mockGenerateText).not.toHaveBeenCalled();
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

    it('completes without calling generateText for briefings (LLM step removed)', async () => {
      // Since briefing generation was removed, abort during generateText is no longer possible
      // This test verifies that Scout completes without calling generateText
      const mockSearch = createMockSearch();
      const mockGenerateText = vi.fn().mockRejectedValue(new Error('Should not be called'));

      const deps = createMockScoutDeps({
        search: mockSearch,
        generateText: mockGenerateText,
      });

      // Scout should complete successfully without calling generateText
      const result = await runScout(createMockGameContext(), deps);
      expect(result).toBeDefined();
      expect(mockGenerateText).not.toHaveBeenCalled();
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

    it('does not call generateText for briefings (LLM step removed)', async () => {
      // Since briefing generation was removed, generateText should NOT be called
      // during normal Scout execution (without cleaning)
      const mockSearch = createMockSearch();
      const mockGenerateText = vi.fn();

      const deps = createMockScoutDeps({
        search: mockSearch,
        generateText: mockGenerateText,
      });

      const result = await runScout(createMockGameContext(), deps);

      // generateText should not be called for briefing generation
      expect(mockGenerateText).not.toHaveBeenCalled();
      // Result should still be valid
      expect(result).toBeDefined();
      expect(result).not.toHaveProperty('queryBriefings');
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
      // queryBriefings field was completely removed
      expect(result).not.toHaveProperty('queryBriefings');
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

  it('exports MIN_SOURCES_FOR_MEDIUM threshold', () => {
    expect(SCOUT_CONFIG.MIN_SOURCES_FOR_MEDIUM).toBeDefined();
    expect(typeof SCOUT_CONFIG.MIN_SOURCES_FOR_MEDIUM).toBe('number');
  });

  it('exports MIN_OVERVIEW_LENGTH threshold', () => {
    expect(SCOUT_CONFIG.MIN_OVERVIEW_LENGTH).toBeDefined();
    expect(typeof SCOUT_CONFIG.MIN_OVERVIEW_LENGTH).toBe('number');
  });
});

