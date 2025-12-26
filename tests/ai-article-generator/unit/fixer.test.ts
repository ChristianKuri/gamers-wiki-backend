/**
 * Unit tests for Fixer module
 *
 * Tests pure functions and markdown manipulation utilities.
 * LLM-dependent functions are tested in integration tests with mocks.
 */

import { describe, it, expect } from 'vitest';

import {
  replaceSection,
  insertSection,
  getSectionContent,
} from '../../../src/ai/articles/fixer';
import type { ReviewIssue } from '../../../src/ai/articles/agents/reviewer';

// ============================================================================
// Test Fixtures
// ============================================================================

const SAMPLE_MARKDOWN = `# Test Article

## Introduction

This is the introduction paragraph.
It has multiple lines.

## Main Content

This is the main content section.
With some details here.

## Tips and Tricks

Here are some tips:
- Tip 1
- Tip 2
- Tip 3

## Sources

- https://example.com/source1
- https://example.com/source2
`;

const MARKDOWN_WITHOUT_SOURCES = `# Test Article

## First Section

Content of first section.

## Second Section

Content of second section.
`;

// ============================================================================
// replaceSection Tests
// ============================================================================

describe('Fixer Module', () => {
  describe('replaceSection', () => {
    it('replaces section content while preserving heading', () => {
      const result = replaceSection(
        SAMPLE_MARKDOWN,
        'Main Content',
        'This is completely new content.\nWith multiple paragraphs.'
      );

      expect(result).not.toBeNull();
      expect(result).toContain('## Main Content');
      expect(result).toContain('This is completely new content.');
      expect(result).toContain('With multiple paragraphs.');
      expect(result).not.toContain('This is the main content section.');
    });

    it('preserves sections before and after the replaced section', () => {
      const result = replaceSection(
        SAMPLE_MARKDOWN,
        'Main Content',
        'New content here.'
      );

      expect(result).not.toBeNull();
      expect(result).toContain('## Introduction');
      expect(result).toContain('This is the introduction paragraph.');
      expect(result).toContain('## Tips and Tricks');
      expect(result).toContain('Tip 1');
    });

    it('returns null when section not found', () => {
      const result = replaceSection(
        SAMPLE_MARKDOWN,
        'Nonexistent Section',
        'New content.'
      );

      expect(result).toBeNull();
    });

    it('handles case-insensitive section matching', () => {
      const result = replaceSection(
        SAMPLE_MARKDOWN,
        'main content',
        'New content.'
      );

      // Should find the section (case-insensitive regex)
      expect(result).not.toBeNull();
    });

    it('handles sections with special characters in headline', () => {
      const markdown = `# Article

## Tips & Tricks (Advanced)

Old tips content.

## Sources
`;

      const result = replaceSection(
        markdown,
        'Tips & Tricks (Advanced)',
        'New tips content.'
      );

      expect(result).not.toBeNull();
      expect(result).toContain('New tips content.');
    });

    it('handles replacing the last content section before Sources', () => {
      const result = replaceSection(
        SAMPLE_MARKDOWN,
        'Tips and Tricks',
        'Updated tips section.'
      );

      expect(result).not.toBeNull();
      expect(result).toContain('Updated tips section.');
      expect(result).toContain('## Sources');
      expect(result).not.toContain('Tip 1');
    });

    it('handles replacing the first section', () => {
      const result = replaceSection(
        SAMPLE_MARKDOWN,
        'Introduction',
        'A brand new introduction.'
      );

      expect(result).not.toBeNull();
      expect(result).toContain('A brand new introduction.');
      expect(result).not.toContain('This is the introduction paragraph.');
      expect(result).toContain('## Main Content');
    });
  });

  // ============================================================================
  // insertSection Tests
  // ============================================================================

  describe('insertSection', () => {
    it('inserts section at end when afterHeadline is null (before Sources)', () => {
      const result = insertSection(
        SAMPLE_MARKDOWN,
        null,
        'New Section',
        'Content for the new section.'
      );

      expect(result).toContain('## New Section');
      expect(result).toContain('Content for the new section.');

      // Should be before Sources
      const newSectionIndex = result.indexOf('## New Section');
      const sourcesIndex = result.indexOf('## Sources');
      expect(newSectionIndex).toBeLessThan(sourcesIndex);
    });

    it('inserts section at end when no Sources section exists', () => {
      const result = insertSection(
        MARKDOWN_WITHOUT_SOURCES,
        null,
        'Third Section',
        'Content of third section.'
      );

      expect(result).toContain('## Third Section');
      expect(result).toContain('Content of third section.');
      expect(result.endsWith('\n\n')).toBe(true);
    });

    it('inserts section after specified section', () => {
      const result = insertSection(
        SAMPLE_MARKDOWN,
        'Introduction',
        'Additional Context',
        'Some additional context here.'
      );

      expect(result).toContain('## Additional Context');
      expect(result).toContain('Some additional context here.');

      // Should be after Introduction but before Main Content
      const introIndex = result.indexOf('## Introduction');
      const newSectionIndex = result.indexOf('## Additional Context');
      const mainIndex = result.indexOf('## Main Content');

      expect(newSectionIndex).toBeGreaterThan(introIndex);
      expect(newSectionIndex).toBeLessThan(mainIndex);
    });

    it('falls back to end insertion when afterHeadline section not found', () => {
      const result = insertSection(
        SAMPLE_MARKDOWN,
        'Nonexistent Section',
        'New Section',
        'Content here.'
      );

      expect(result).toContain('## New Section');

      // Should be inserted before Sources (fallback behavior)
      const newSectionIndex = result.indexOf('## New Section');
      const sourcesIndex = result.indexOf('## Sources');
      expect(newSectionIndex).toBeLessThan(sourcesIndex);
    });

    it('handles empty content gracefully', () => {
      const result = insertSection(
        SAMPLE_MARKDOWN,
        null,
        'Empty Section',
        ''
      );

      expect(result).toContain('## Empty Section');
    });
  });

  // ============================================================================
  // getSectionContent Tests
  // ============================================================================

  describe('getSectionContent', () => {
    it('returns content of specified section', () => {
      const content = getSectionContent(SAMPLE_MARKDOWN, 'Main Content');

      expect(content).not.toBeNull();
      expect(content).toContain('This is the main content section.');
      expect(content).toContain('With some details here.');
    });

    it('returns null for nonexistent section', () => {
      const content = getSectionContent(SAMPLE_MARKDOWN, 'Nonexistent');

      expect(content).toBeNull();
    });

    it('handles case-insensitive headline matching', () => {
      const content = getSectionContent(SAMPLE_MARKDOWN, 'INTRODUCTION');

      expect(content).not.toBeNull();
      expect(content).toContain('This is the introduction paragraph.');
    });

    it('returns content without the heading', () => {
      const content = getSectionContent(SAMPLE_MARKDOWN, 'Tips and Tricks');

      expect(content).not.toBeNull();
      expect(content).not.toContain('## Tips and Tricks');
      expect(content).toContain('Tip 1');
    });

    it('handles section at end of document', () => {
      const content = getSectionContent(SAMPLE_MARKDOWN, 'Sources');

      expect(content).not.toBeNull();
      expect(content).toContain('https://example.com/source1');
    });
  });

  // ============================================================================
  // Issue/Strategy Tests (Pure Logic)
  // ============================================================================

  describe('ReviewIssue with FixStrategy', () => {
    it('validates ReviewIssue structure with fixStrategy', () => {
      const issue: ReviewIssue = {
        severity: 'major',
        category: 'style',
        location: 'Introduction',
        message: 'Article contains AI clichés',
        suggestion: 'Replace "dive into" with "explore"',
        fixStrategy: 'direct_edit',
        fixInstruction: 'Replace "dive into" with "explore"',
      };

      expect(issue.fixStrategy).toBe('direct_edit');
      expect(issue.fixInstruction).toBeDefined();
    });

    it('allows no_action fixStrategy', () => {
      const issue: ReviewIssue = {
        severity: 'minor',
        category: 'seo',
        message: 'Title could be slightly longer',
        fixStrategy: 'no_action',
      };

      expect(issue.fixStrategy).toBe('no_action');
      expect(issue.fixInstruction).toBeUndefined();
    });

    it('allows all fix strategy values', () => {
      const strategies: Array<ReviewIssue['fixStrategy']> = [
        'direct_edit',
        'regenerate',
        'add_section',
        'expand',
        'no_action',
      ];

      for (const strategy of strategies) {
        const issue: ReviewIssue = {
          severity: 'minor',
          category: 'style',
          message: 'Test issue',
          fixStrategy: strategy,
        };

        expect(issue.fixStrategy).toBe(strategy);
      }
    });
  });
});

