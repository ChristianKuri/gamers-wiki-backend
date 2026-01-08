/**
 * Tests for headline matching utilities
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeHeadline,
  findMatchingHeadline,
  findH2LineNumber,
} from '../../../src/ai/articles/utils/headline-utils';

describe('headline-utils', () => {
  describe('normalizeHeadline', () => {
    it('converts to lowercase', () => {
      expect(normalizeHeadline('Boss Strategy')).toBe('boss strategy');
    });

    it('removes special characters', () => {
      expect(normalizeHeadline('Tips & Tricks!')).toBe('tips  tricks');
    });

    it('trims whitespace', () => {
      expect(normalizeHeadline('  Weapons Guide  ')).toBe('weapons guide');
    });

    it('handles empty string', () => {
      expect(normalizeHeadline('')).toBe('');
    });
  });

  describe('findMatchingHeadline', () => {
    const headlineMap = new Map([
      ['Boss Strategy', 10],
      ['Weapons Guide', 25],
      ['Final Boss Tips', 40],
      ['Combat Basics', 55],
    ]);

    it('finds exact match', () => {
      const result = findMatchingHeadline('Boss Strategy', headlineMap);
      expect(result).toEqual({
        headline: 'Boss Strategy',
        lineNumber: 10,
        matchType: 'exact',
      });
    });

    it('finds normalized match (case insensitive)', () => {
      const result = findMatchingHeadline('boss strategy', headlineMap);
      expect(result).toEqual({
        headline: 'Boss Strategy',
        lineNumber: 10,
        matchType: 'normalized',
      });
    });

    it('finds normalized match (ignores punctuation)', () => {
      const result = findMatchingHeadline('weapons guide!', headlineMap);
      expect(result).toEqual({
        headline: 'Weapons Guide',
        lineNumber: 25,
        matchType: 'normalized',
      });
    });

    it('finds partial match with high similarity', () => {
      // "Final Boss" is 67% of "Final Boss Tips"
      const result = findMatchingHeadline('Final Boss', headlineMap);
      expect(result).toEqual({
        headline: 'Final Boss Tips',
        lineNumber: 40,
        matchType: 'partial',
      });
    });

    it('rejects partial match with low similarity', () => {
      // "Boss" is only 33% of "Boss Strategy" - too loose
      const result = findMatchingHeadline('Boss', headlineMap);
      expect(result).toBeNull();
    });

    it('returns null for non-existent headline', () => {
      const result = findMatchingHeadline('Armor Sets', headlineMap);
      expect(result).toBeNull();
    });

    it('prefers exact over normalized', () => {
      const mapWithBoth = new Map([
        ['boss strategy', 5],
        ['Boss Strategy', 10],
      ]);
      const result = findMatchingHeadline('Boss Strategy', mapWithBoth);
      expect(result?.matchType).toBe('exact');
      expect(result?.lineNumber).toBe(10);
    });
  });

  describe('findH2LineNumber', () => {
    const markdownLines = [
      '# Main Title',
      '',
      '## Boss Strategy',
      'Content about bosses...',
      '',
      '## Weapons Guide',
      'Content about weapons...',
      '',
      '## Final Boss Tips',
      'More content...',
    ];

    it('finds H2 by exact match', () => {
      const result = findH2LineNumber(markdownLines, 'Boss Strategy');
      expect(result).toBe(2);
    });

    it('finds H2 by normalized match', () => {
      const result = findH2LineNumber(markdownLines, 'weapons guide');
      expect(result).toBe(5);
    });

    it('finds H2 by partial match with high similarity', () => {
      const result = findH2LineNumber(markdownLines, 'Final Boss');
      expect(result).toBe(8);
    });

    it('returns -1 for non-existent H2', () => {
      const result = findH2LineNumber(markdownLines, 'Armor Sets');
      expect(result).toBe(-1);
    });

    it('ignores H1 headers', () => {
      const result = findH2LineNumber(markdownLines, 'Main Title');
      expect(result).toBe(-1);
    });

    it('handles empty lines array', () => {
      const result = findH2LineNumber([], 'Boss Strategy');
      expect(result).toBe(-1);
    });
  });
});
