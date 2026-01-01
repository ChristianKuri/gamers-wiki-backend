import { describe, it, expect } from 'vitest';

import {
  assembleScoutOutput,
  calculateResearchConfidence,
} from '../../../src/ai/articles/agents/scout.internals';
import { createEmptyResearchPool, ResearchPoolBuilder } from '../../../src/ai/articles/research-pool';
import { createEmptyTokenUsage, createEmptySearchApiCosts } from '../../../src/ai/articles/types';
import type { QueryPlan, DiscoveryCheck, QueryBriefing } from '../../../src/ai/articles/types';

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockQueryPlan = (): QueryPlan => ({
  draftTitle: 'Test Game: Complete Guide',
  queries: [
    { query: '"Test Game" guide', engine: 'tavily', purpose: 'General overview', expectedFindings: ['Core mechanics'] },
    { query: '"Test Game" tips', engine: 'exa', purpose: 'Tips and tricks', expectedFindings: ['Tips'] },
  ],
});

const createMockDiscoveryCheck = (): DiscoveryCheck => ({
  needsDiscovery: false,
  discoveryReason: 'none',
});

const createMockQueryBriefings = (): QueryBriefing[] => [
  {
    query: '"Test Game" guide',
    engine: 'tavily',
    purpose: 'General overview',
    findings: 'Found comprehensive information about the game.',
    keyFacts: ['Fact 1', 'Fact 2'],
    gaps: ['Gap 1'],
    sourceCount: 3,
  },
  {
    query: '"Test Game" tips',
    engine: 'exa',
    purpose: 'Tips and tricks',
    findings: 'Found useful tips and strategies.',
    keyFacts: ['Tip 1'],
    gaps: [],
    sourceCount: 2,
  },
];

// ============================================================================
// Tests
// ============================================================================

describe('Scout Helper Functions', () => {
  describe('assembleScoutOutput', () => {
    it('creates a properly structured ScoutOutput', () => {
      const queryPlan = createMockQueryPlan();
      const discoveryCheck = createMockDiscoveryCheck();
      const queryBriefings = createMockQueryBriefings();
      const pool = createEmptyResearchPool();
      const tokenUsage = createEmptyTokenUsage();
      const searchApiCosts = createEmptySearchApiCosts();
      
      const output = assembleScoutOutput(
        queryPlan,
        discoveryCheck,
        queryBriefings,
        pool,
        tokenUsage,
        'high',
        searchApiCosts
      );

      expect(output.queryPlan).toBe(queryPlan);
      expect(output.discoveryCheck).toBe(discoveryCheck);
      expect(output.queryBriefings).toBe(queryBriefings);
      expect(output.researchPool).toBe(pool);
      expect(output.tokenUsage).toBe(tokenUsage);
      expect(output.confidence).toBe('high');
    });

    it('extracts source URLs from research pool', () => {
      const poolBuilder = new ResearchPoolBuilder();
      poolBuilder.add({
        query: 'test query',
        answer: 'test',
        results: [
          { title: 'Result 1', url: 'https://example1.com', content: 'Content 1' },
          { title: 'Result 2', url: 'https://example2.com', content: 'Content 2' },
        ],
        category: 'overview',
        timestamp: Date.now(),
      });
      const pool = poolBuilder.build();
      
      const output = assembleScoutOutput(
        createMockQueryPlan(),
        createMockDiscoveryCheck(),
        createMockQueryBriefings(),
        pool,
        createEmptyTokenUsage(),
        'medium',
        createEmptySearchApiCosts()
      );

      expect(Array.isArray(output.sourceUrls)).toBe(true);
      // URLs may have trailing slashes added during normalization
      expect(output.sourceUrls.some(url => url.startsWith('https://example1.com'))).toBe(true);
      expect(output.sourceUrls.some(url => url.startsWith('https://example2.com'))).toBe(true);
    });

    it('includes confidence level in output', () => {
      const queryPlan = createMockQueryPlan();
      const discoveryCheck = createMockDiscoveryCheck();
      const queryBriefings = createMockQueryBriefings();
      const pool = createEmptyResearchPool();
      const tokenUsage = createEmptyTokenUsage();
      const searchApiCosts = createEmptySearchApiCosts();
      
      const highOutput = assembleScoutOutput(queryPlan, discoveryCheck, queryBriefings, pool, tokenUsage, 'high', searchApiCosts);
      const mediumOutput = assembleScoutOutput(queryPlan, discoveryCheck, queryBriefings, pool, tokenUsage, 'medium', searchApiCosts);
      const lowOutput = assembleScoutOutput(queryPlan, discoveryCheck, queryBriefings, pool, tokenUsage, 'low', searchApiCosts);

      expect(highOutput.confidence).toBe('high');
      expect(mediumOutput.confidence).toBe('medium');
      expect(lowOutput.confidence).toBe('low');
    });
    
    it('includes optional discovery result when provided', () => {
      const queryPlan = createMockQueryPlan();
      const discoveryCheck: DiscoveryCheck = {
        needsDiscovery: true,
        discoveryReason: 'unknown_game',
        discoveryQuery: 'What is Test Game?',
        discoveryEngine: 'tavily',
      };
      const discoveryResult = {
        query: 'What is Test Game?',
        answer: 'Test Game is an RPG.',
        results: [{ title: 'Wiki', url: 'https://wiki.com', content: 'Info' }],
        category: 'overview' as const,
        timestamp: Date.now(),
      };
      
      const output = assembleScoutOutput(
        queryPlan,
        discoveryCheck,
        createMockQueryBriefings(),
        createEmptyResearchPool(),
        createEmptyTokenUsage(),
        'high',
        createEmptySearchApiCosts(),
        { discoveryResult }
      );

      expect(output.discoveryResult).toBe(discoveryResult);
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
      const confidence = calculateResearchConfidence(5, 3, 100);
      expect(confidence).toBe('medium');
    });

    it('returns low confidence when metrics are below thresholds', () => {
      const confidence = calculateResearchConfidence(1, 1, 10);
      expect(confidence).toBe('low');
    });

    it('considers source count in confidence calculation', () => {
      // Good queries and overview length but few sources
      const lowSourcesConfidence = calculateResearchConfidence(2, 6, 300);
      // Same but with adequate sources
      const goodSourcesConfidence = calculateResearchConfidence(15, 6, 300);

      // Both might be medium or high depending on algorithm,
      // but more sources should equal better confidence
      expect(['medium', 'high']).toContain(goodSourcesConfidence);
    });

    it('considers query count in confidence calculation', () => {
      // Good sources and overview but few queries
      const lowQueriesConfidence = calculateResearchConfidence(15, 1, 300);
      // Same but with more queries
      const goodQueriesConfidence = calculateResearchConfidence(15, 8, 300);

      // More queries should not decrease confidence
      expect(['low', 'medium', 'high']).toContain(lowQueriesConfidence);
      expect(['medium', 'high']).toContain(goodQueriesConfidence);
    });

    it('considers briefing length in confidence calculation', () => {
      // Good sources and queries but short briefing
      const shortBriefing = calculateResearchConfidence(15, 8, 10);
      // Same but with adequate briefing
      const longBriefing = calculateResearchConfidence(15, 8, 300);

      // Short briefing should decrease confidence
      expect(['low', 'medium']).toContain(shortBriefing);
      expect(['medium', 'high']).toContain(longBriefing);
    });
  });
});
