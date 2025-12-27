/**
 * Unit tests for Reviewer agent
 */

import { describe, it, expect } from 'vitest';

import {
  countIssuesBySeverity,
  shouldRejectArticle,
  getIssuesByCategory,
  type ReviewIssue,
} from '../../../src/ai/articles/agents/reviewer';

describe('Reviewer Agent', () => {
  describe('countIssuesBySeverity', () => {
    it('counts issues by severity correctly', () => {
      const issues: ReviewIssue[] = [
        { severity: 'critical', category: 'factual', message: 'Incorrect claim', fixStrategy: 'regenerate' },
        { severity: 'critical', category: 'coverage', message: 'Missing element', fixStrategy: 'add_section' },
        { severity: 'major', category: 'redundancy', message: 'Repeated explanation', fixStrategy: 'direct_edit' },
        { severity: 'minor', category: 'seo', message: 'Title could be longer', fixStrategy: 'no_action' },
        { severity: 'minor', category: 'style', message: 'Inconsistent voice', fixStrategy: 'no_action' },
      ];

      const counts = countIssuesBySeverity(issues);

      expect(counts.critical).toBe(2);
      expect(counts.major).toBe(1);
      expect(counts.minor).toBe(2);
    });

    it('handles empty issues array', () => {
      const counts = countIssuesBySeverity([]);

      expect(counts.critical).toBe(0);
      expect(counts.major).toBe(0);
      expect(counts.minor).toBe(0);
    });

    it('handles single severity', () => {
      const issues: ReviewIssue[] = [
        { severity: 'major', category: 'redundancy', message: 'Issue 1', fixStrategy: 'direct_edit' },
        { severity: 'major', category: 'style', message: 'Issue 2', fixStrategy: 'direct_edit' },
      ];

      const counts = countIssuesBySeverity(issues);

      expect(counts.critical).toBe(0);
      expect(counts.major).toBe(2);
      expect(counts.minor).toBe(0);
    });
  });

  describe('shouldRejectArticle', () => {
    it('returns true when there are critical issues', () => {
      const issues: ReviewIssue[] = [
        { severity: 'critical', category: 'factual', message: 'Incorrect claim', fixStrategy: 'regenerate' },
        { severity: 'minor', category: 'seo', message: 'Minor SEO issue', fixStrategy: 'no_action' },
      ];

      expect(shouldRejectArticle(issues)).toBe(true);
    });

    it('returns false when only major and minor issues', () => {
      const issues: ReviewIssue[] = [
        { severity: 'major', category: 'redundancy', message: 'Repeated content', fixStrategy: 'direct_edit' },
        { severity: 'minor', category: 'seo', message: 'Minor SEO issue', fixStrategy: 'no_action' },
      ];

      expect(shouldRejectArticle(issues)).toBe(false);
    });

    it('returns false for empty issues', () => {
      expect(shouldRejectArticle([])).toBe(false);
    });
  });

  describe('getIssuesByCategory', () => {
    it('filters issues by category', () => {
      const issues: ReviewIssue[] = [
        { severity: 'critical', category: 'factual', message: 'Factual issue 1', fixStrategy: 'regenerate' },
        { severity: 'major', category: 'redundancy', message: 'Redundancy issue', fixStrategy: 'direct_edit' },
        { severity: 'minor', category: 'factual', message: 'Factual issue 2', fixStrategy: 'expand' },
        { severity: 'minor', category: 'seo', message: 'SEO issue', fixStrategy: 'no_action' },
      ];

      const factualIssues = getIssuesByCategory(issues, 'factual');

      expect(factualIssues).toHaveLength(2);
      expect(factualIssues[0].message).toBe('Factual issue 1');
      expect(factualIssues[1].message).toBe('Factual issue 2');
    });

    it('returns empty array when no matching category', () => {
      const issues: ReviewIssue[] = [
        { severity: 'major', category: 'redundancy', message: 'Redundancy issue', fixStrategy: 'direct_edit' },
      ];

      const coverageIssues = getIssuesByCategory(issues, 'coverage');

      expect(coverageIssues).toHaveLength(0);
    });

    it('returns empty array for empty issues', () => {
      expect(getIssuesByCategory([], 'factual')).toHaveLength(0);
    });
  });
});
