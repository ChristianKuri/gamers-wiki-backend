import { describe, it, expect } from 'vitest';

import {
  buildSearchContext,
  buildCategoryContext,
  buildRecentContext,
  buildFullContext,
  assembleScoutOutput,
  calculateResearchConfidence,
} from '../../../src/ai/articles/agents/scout.internals';
import { createEmptyResearchPool } from '../../../src/ai/articles/research-pool';
import { createEmptyTokenUsage } from '../../../src/ai/articles/types';
import type { CategorizedSearchResult, GameArticleContext } from '../../../src/ai/articles/types';

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockSearchResult = (
  query: string,
  category: CategorizedSearchResult['category'],
  answer: string | null = 'Mock answer',
  results: { title: string; url: string; content: string }[] = []
): CategorizedSearchResult => ({
  query,
  answer,
  category,
  timestamp: Date.now(),
  results: results.map((r) => ({ ...r, score: 0.9 })),
});

// ============================================================================
// Tests
// ============================================================================

describe('Scout Helper Functions', () => {
  describe('buildSearchContext', () => {
    it('formats search results into readable context string', () => {
      const results: CategorizedSearchResult[] = [
        createMockSearchResult('Elden Ring gameplay', 'overview', 'Great action RPG', [
          { title: 'IGN Review', url: 'https://ign.com/elden-ring', content: 'Elden Ring is a masterpiece...' },
          { title: 'GameSpot Review', url: 'https://gamespot.com/elden-ring', content: 'FromSoftware delivers...' },
        ]),
      ];

      const context = buildSearchContext(results);

      expect(context).toContain('Query: "Elden Ring gameplay"');
      expect(context).toContain('Category: overview');
      expect(context).toContain('AI Summary: Great action RPG');
      expect(context).toContain('IGN Review');
      expect(context).toContain('https://ign.com/elden-ring');
    });

    it('handles multiple search results', () => {
      const results: CategorizedSearchResult[] = [
        createMockSearchResult('query1', 'overview', 'answer1', [
          { title: 'Result 1', url: 'https://example.com/1', content: 'Content 1' },
        ]),
        createMockSearchResult('query2', 'category-specific', 'answer2', [
          { title: 'Result 2', url: 'https://example.com/2', content: 'Content 2' },
        ]),
      ];

      const context = buildSearchContext(results);

      expect(context).toContain('Query: "query1"');
      expect(context).toContain('Query: "query2"');
      expect(context).toContain('Category: overview');
      expect(context).toContain('Category: category-specific');
      expect(context).toContain('---'); // separator
    });

    it('handles empty results array', () => {
      const context = buildSearchContext([]);
      expect(context).toBe('');
    });

    it('shows (none) for missing AI summary', () => {
      const results: CategorizedSearchResult[] = [
        createMockSearchResult('query', 'overview', null, []),
      ];

      const context = buildSearchContext(results);

      expect(context).toContain('AI Summary: (none)');
    });

    it('respects config overrides', () => {
      const results: CategorizedSearchResult[] = [
        createMockSearchResult('query', 'overview', 'answer', [
          { title: 'Result 1', url: 'https://example.com/1', content: 'Content 1' },
          { title: 'Result 2', url: 'https://example.com/2', content: 'Content 2' },
          { title: 'Result 3', url: 'https://example.com/3', content: 'Content 3' },
        ]),
      ];

      // Limit to 1 result per context
      const context = buildSearchContext(results, { resultsPerContext: 1 });

      expect(context).toContain('Result 1');
      expect(context).not.toContain('Result 2');
      expect(context).not.toContain('Result 3');
    });

    it('truncates long content based on maxSnippetLength', () => {
      const longContent = 'A'.repeat(500);
      const results: CategorizedSearchResult[] = [
        createMockSearchResult('query', 'overview', 'answer', [
          { title: 'Result', url: 'https://example.com', content: longContent },
        ]),
      ];

      const context = buildSearchContext(results, { maxSnippetLength: 100 });

      // Should not contain the full 500 characters
      expect(context.length).toBeLessThan(500 + 200); // some overhead for formatting
    });
  });

  describe('buildCategoryContext', () => {
    it('formats category-specific findings', () => {
      const findings: CategorizedSearchResult[] = [
        createMockSearchResult('Elden Ring builds', 'category-specific', 'Popular builds include...', [
          { title: 'Best Strength Build', url: 'https://example.com/1', content: 'Strength builds are...' },
          { title: 'Mage Build Guide', url: 'https://example.com/2', content: 'Magic builds are...' },
        ]),
      ];

      const context = buildCategoryContext(findings);

      expect(context).toContain('Query: "Elden Ring builds"');
      expect(context).toContain('Summary: Popular builds include...');
      expect(context).toContain('Key findings:');
      expect(context).toContain('Best Strength Build');
    });

    it('handles multiple findings', () => {
      const findings: CategorizedSearchResult[] = [
        createMockSearchResult('query1', 'category-specific', 'summary1', [
          { title: 'Title 1', url: 'https://example.com/1', content: 'Content' },
        ]),
        createMockSearchResult('query2', 'category-specific', 'summary2', [
          { title: 'Title 2', url: 'https://example.com/2', content: 'Content' },
        ]),
      ];

      const context = buildCategoryContext(findings);

      expect(context).toContain('Query: "query1"');
      expect(context).toContain('Query: "query2"');
    });

    it('shows (none) for missing summary', () => {
      const findings: CategorizedSearchResult[] = [
        createMockSearchResult('query', 'category-specific', null, []),
      ];

      const context = buildCategoryContext(findings);

      expect(context).toContain('Summary: (none)');
    });

    it('respects keyFindingsLimit parameter', () => {
      const findings: CategorizedSearchResult[] = [
        createMockSearchResult('query', 'category-specific', 'summary', [
          { title: 'Finding 1', url: 'https://example.com/1', content: 'Content' },
          { title: 'Finding 2', url: 'https://example.com/2', content: 'Content' },
          { title: 'Finding 3', url: 'https://example.com/3', content: 'Content' },
          { title: 'Finding 4', url: 'https://example.com/4', content: 'Content' },
        ]),
      ];

      const context = buildCategoryContext(findings, 2);

      expect(context).toContain('Finding 1');
      expect(context).toContain('Finding 2');
      expect(context).not.toContain('Finding 3');
      expect(context).not.toContain('Finding 4');
    });

    it('handles empty findings array', () => {
      const context = buildCategoryContext([]);
      expect(context).toBe('');
    });
  });

  describe('buildRecentContext', () => {
    it('formats recent developments as bullet points', () => {
      const findings: CategorizedSearchResult[] = [
        createMockSearchResult('Elden Ring news', 'recent', 'Latest updates', [
          { title: 'DLC Announced', url: 'https://example.com/1', content: 'FromSoftware announces...' },
          { title: 'Patch 1.10', url: 'https://example.com/2', content: 'New patch includes...' },
        ]),
      ];

      const context = buildRecentContext(findings);

      expect(context).toContain('- DLC Announced:');
      expect(context).toContain('- Patch 1.10:');
    });

    it('flattens results from multiple searches', () => {
      const findings: CategorizedSearchResult[] = [
        createMockSearchResult('news1', 'recent', 'answer1', [
          { title: 'News A', url: 'https://example.com/a', content: 'Content A' },
        ]),
        createMockSearchResult('news2', 'recent', 'answer2', [
          { title: 'News B', url: 'https://example.com/b', content: 'Content B' },
        ]),
      ];

      const context = buildRecentContext(findings);

      expect(context).toContain('News A');
      expect(context).toContain('News B');
    });

    it('respects config overrides', () => {
      const findings: CategorizedSearchResult[] = [
        createMockSearchResult('news', 'recent', 'answer', [
          { title: 'News 1', url: 'https://example.com/1', content: 'Content 1' },
          { title: 'News 2', url: 'https://example.com/2', content: 'Content 2' },
          { title: 'News 3', url: 'https://example.com/3', content: 'Content 3' },
        ]),
      ];

      const context = buildRecentContext(findings, { recentResultsLimit: 1 });

      expect(context).toContain('News 1');
      expect(context).not.toContain('News 2');
      expect(context).not.toContain('News 3');
    });

    it('truncates content based on recentContentLength', () => {
      const longContent = 'X'.repeat(500);
      const findings: CategorizedSearchResult[] = [
        createMockSearchResult('news', 'recent', 'answer', [
          { title: 'News', url: 'https://example.com', content: longContent },
        ]),
      ];

      const context = buildRecentContext(findings, { recentContentLength: 50 });

      expect(context.length).toBeLessThan(500);
      expect(context).toContain('XXXXXXXXXX'); // Should contain truncated content
    });

    it('handles empty findings array', () => {
      const context = buildRecentContext([]);
      expect(context).toBe('');
    });
  });

  describe('buildFullContext', () => {
    const mockContext: GameArticleContext = {
      gameName: 'Elden Ring',
      developer: 'FromSoftware',
      publisher: 'Bandai Namco',
      releaseDate: '2022-02-25',
      genres: ['Action RPG', 'Soulslike'],
      platforms: ['PC', 'PlayStation 5', 'Xbox Series X'],
      igdbDescription: 'An epic open-world adventure.',
      instruction: 'Write a beginner guide',
    };

    it('combines all briefings into a structured document', () => {
      const context = buildFullContext(
        mockContext,
        'Overview briefing content',
        'Category briefing content',
        'Supplementary briefing content',
        'TIPS & TRICKS'
      );

      expect(context).toContain('=== OVERVIEW ===');
      expect(context).toContain('Overview briefing content');
      expect(context).toContain('=== CATEGORY INSIGHTS ===');
      expect(context).toContain('Category briefing content');
      expect(context).toContain('=== TIPS & TRICKS ===');
      expect(context).toContain('Supplementary briefing content');
      expect(context).toContain('=== METADATA ===');
    });

    it('uses default label when not specified', () => {
      const context = buildFullContext(
        mockContext,
        'Overview',
        'Category',
        'Supplementary'
      );

      expect(context).toContain('=== SUPPLEMENTARY RESEARCH ===');
    });

    it('includes all game metadata', () => {
      const context = buildFullContext(mockContext, 'o', 'c', 'r');

      expect(context).toContain('Game: Elden Ring');
      expect(context).toContain('Developer: FromSoftware');
      expect(context).toContain('Publisher: Bandai Namco');
      expect(context).toContain('Release: 2022-02-25');
      expect(context).toContain('Genres: Action RPG, Soulslike');
      expect(context).toContain('Platforms: PC, PlayStation 5, Xbox Series X');
    });

    it('includes IGDB description when provided', () => {
      const context = buildFullContext(mockContext, 'o', 'c', 'r');

      expect(context).toContain('IGDB: An epic open-world adventure.');
    });

    it('includes user instruction when provided', () => {
      const context = buildFullContext(mockContext, 'o', 'c', 'r');

      expect(context).toContain('User Directive: Write a beginner guide');
    });

    it('shows unknown for missing optional fields', () => {
      const minimalContext: GameArticleContext = {
        gameName: 'Test Game',
      };

      const context = buildFullContext(minimalContext, 'o', 'c', 'r');

      expect(context).toContain('Game: Test Game');
      expect(context).toContain('Developer: unknown');
      expect(context).toContain('Publisher: unknown');
      expect(context).toContain('Release: unknown');
      expect(context).toContain('Genres: unknown');
      expect(context).toContain('Platforms: unknown');
    });

    it('excludes IGDB line when not provided', () => {
      const contextWithoutIgdb: GameArticleContext = {
        gameName: 'Test Game',
        developer: 'Test Dev',
      };

      const context = buildFullContext(contextWithoutIgdb, 'o', 'c', 'r');

      expect(context).not.toContain('IGDB:');
    });

    it('excludes User Directive line when not provided', () => {
      const contextWithoutInstruction: GameArticleContext = {
        gameName: 'Test Game',
      };

      const context = buildFullContext(contextWithoutInstruction, 'o', 'c', 'r');

      expect(context).not.toContain('User Directive:');
    });
  });

  describe('assembleScoutOutput', () => {
    it('creates a properly structured ScoutOutput', () => {
      const pool = createEmptyResearchPool();
      const tokenUsage = createEmptyTokenUsage();
      const output = assembleScoutOutput(
        'Overview briefing',
        'Category briefing',
        'Recent briefing',
        'Full context document',
        pool,
        tokenUsage,
        'high'
      );

      expect(output.briefing.overview).toBe('Overview briefing');
      expect(output.briefing.categoryInsights).toBe('Category briefing');
      expect(output.briefing.recentDevelopments).toBe('Recent briefing');
      expect(output.briefing.fullContext).toBe('Full context document');
      expect(output.researchPool).toBe(pool);
      expect(output.tokenUsage).toBe(tokenUsage);
      expect(output.confidence).toBe('high');
    });

    it('extracts source URLs from research pool', () => {
      const pool = createEmptyResearchPool();
      const tokenUsage = createEmptyTokenUsage();
      const output = assembleScoutOutput('o', 'c', 'r', 'f', pool, tokenUsage, 'medium');

      expect(Array.isArray(output.sourceUrls)).toBe(true);
    });

    it('includes confidence level in output', () => {
      const pool = createEmptyResearchPool();
      const tokenUsage = createEmptyTokenUsage();
      
      const highOutput = assembleScoutOutput('o', 'c', 'r', 'f', pool, tokenUsage, 'high');
      const mediumOutput = assembleScoutOutput('o', 'c', 'r', 'f', pool, tokenUsage, 'medium');
      const lowOutput = assembleScoutOutput('o', 'c', 'r', 'f', pool, tokenUsage, 'low');

      expect(highOutput.confidence).toBe('high');
      expect(mediumOutput.confidence).toBe('medium');
      expect(lowOutput.confidence).toBe('low');
    });
  });

  describe('calculateResearchConfidence', () => {
    it('returns high confidence when all metrics exceed thresholds', () => {
      // High thresholds: sources >= 10, queries >= 6, overview >= 200 chars
      const confidence = calculateResearchConfidence(15, 8, 300);
      expect(confidence).toBe('high');
    });

    it('returns medium confidence when metrics meet medium thresholds', () => {
      // Medium thresholds: sources >= 5, queries >= 3, overview >= 50 chars
      const confidence = calculateResearchConfidence(6, 4, 100);
      expect(confidence).toBe('medium');
    });

    it('returns low confidence when metrics are below medium thresholds', () => {
      const confidence = calculateResearchConfidence(2, 1, 30);
      expect(confidence).toBe('low');
    });

    it('considers all three dimensions for scoring', () => {
      // High sources but low everything else
      const highSourcesOnly = calculateResearchConfidence(20, 1, 10);
      expect(highSourcesOnly).toBe('low');

      // High queries but low everything else
      const highQueriesOnly = calculateResearchConfidence(1, 10, 10);
      expect(highQueriesOnly).toBe('low');

      // High overview but low everything else
      const highOverviewOnly = calculateResearchConfidence(1, 1, 500);
      expect(highOverviewOnly).toBe('low');
    });

    it('handles edge case of zero values', () => {
      const confidence = calculateResearchConfidence(0, 0, 0);
      expect(confidence).toBe('low');
    });

    it('returns medium for borderline cases', () => {
      // Just meeting medium thresholds: sources = 5, queries = 3, overview = 50
      const confidence = calculateResearchConfidence(5, 3, 50);
      expect(confidence).toBe('medium');
    });

    it('returns high when two dimensions are high and one is medium', () => {
      // High sources and queries, medium overview
      const confidence = calculateResearchConfidence(12, 8, 100);
      expect(confidence).toBe('high');
    });
  });
});

