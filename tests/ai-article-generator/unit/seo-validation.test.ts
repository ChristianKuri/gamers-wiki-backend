/**
 * SEO Validation Tests
 *
 * Tests for SEO-related validation functions including:
 * - Title and excerpt length optimization
 * - Heading hierarchy validation
 * - Keyword density checks
 */

import { describe, it, expect } from 'vitest';
import { validateSEO, validateHeadingHierarchy } from '../../../src/ai/articles/validation';
import { SEO_CONSTRAINTS } from '../../../src/ai/articles/config';

describe('validateHeadingHierarchy', () => {
  it('should return no issues for correct heading hierarchy', () => {
    const markdown = `# Title
## Section 1
Some content
### Subsection 1.1
More content
## Section 2
Final content`;

    const issues = validateHeadingHierarchy(markdown);
    expect(issues).toHaveLength(0);
  });

  it('should warn when H3 appears before any H2', () => {
    const markdown = `# Title
### Subsection without parent H2
Some content
## Section 1
More content`;

    const issues = validateHeadingHierarchy(markdown);
    // Should have: H3 before H2 warning + skipped level (H1 → H3)
    expect(issues.length).toBeGreaterThanOrEqual(1);
    const h3BeforeH2Issue = issues.find((i) => i.message.includes('H3 heading') && i.message.includes('before any H2'));
    expect(h3BeforeH2Issue).toBeDefined();
    expect(h3BeforeH2Issue?.severity).toBe('warning');
  });

  it('should warn when skipping heading levels', () => {
    const markdown = `# Title
## Section 1
Content
#### Subsection (skipped H3)
More content`;

    const issues = validateHeadingHierarchy(markdown);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message).toContain('Skipped heading level');
    expect(issues[0].message).toContain('H2');
    expect(issues[0].message).toContain('H4');
  });

  it('should warn about multiple H1 tags', () => {
    const markdown = `# Title 1
## Section 1
# Title 2
## Section 2`;

    const issues = validateHeadingHierarchy(markdown);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message).toContain('Multiple H1 tags');
  });

  it('should return no issues for empty content', () => {
    const issues = validateHeadingHierarchy('');
    expect(issues).toHaveLength(0);
  });

  it('should return no issues for content without headings', () => {
    const markdown = `Just some regular content without any headings.
More content here.`;

    const issues = validateHeadingHierarchy(markdown);
    expect(issues).toHaveLength(0);
  });

  it('should handle deep heading nesting correctly', () => {
    const markdown = `# Title
## H2
### H3
#### H4
##### H5
###### H6`;

    const issues = validateHeadingHierarchy(markdown);
    expect(issues).toHaveLength(0);
  });

  it('should detect multiple heading hierarchy issues', () => {
    const markdown = `# Title
# Another Title
### H3 before H2
## Section
#### H4 after H2 (skipped H3)`;

    const issues = validateHeadingHierarchy(markdown);
    // Should have: multiple H1 + H3 before H2 + skipped level
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });
});

describe('validateSEO', () => {
  const createDraft = (overrides: Partial<{
    title: string;
    excerpt: string;
    markdown: string;
    tags: string[];
  }> = {}) => ({
    title: 'Elden Ring Beginner Guide: Tips for New Players',
    excerpt: 'A comprehensive guide for new Elden Ring players with tips on combat, exploration, and character building.',
    markdown: `# Elden Ring Beginner Guide

## Getting Started

If you're new to **Elden Ring**, this guide will help you survive your first hours in the Lands Between.

## Combat Basics

Combat in Elden Ring requires patience and timing.

## Exploration Tips

The world of Elden Ring is vast and full of secrets.

## Sources

- Source 1`,
    tags: ['beginner guide', 'tips', 'combat'],
    ...overrides,
  });

  describe('title validation', () => {
    it('should pass for optimal title length', () => {
      const draft = createDraft({ title: 'Elden Ring Beginner Guide: Essential Tips' }); // ~43 chars
      const issues = validateSEO(draft, 'Elden Ring');
      const titleIssues = issues.filter((i) => i.message.includes('Title'));
      expect(titleIssues).toHaveLength(0);
    });

    it('should warn when title is too short', () => {
      const draft = createDraft({ title: 'Elden Ring Tips' }); // ~16 chars
      const issues = validateSEO(draft, 'Elden Ring');
      const shortTitleIssue = issues.find((i) => i.message.includes('too short for SEO'));
      expect(shortTitleIssue).toBeDefined();
      expect(shortTitleIssue?.severity).toBe('warning');
    });

    it('should warn when title is too long', () => {
      const draft = createDraft({
        title: 'The Ultimate Complete Comprehensive Elden Ring Guide for Beginners Who Want to Learn Everything',
      }); // ~95 chars
      const issues = validateSEO(draft, 'Elden Ring');
      const longTitleIssue = issues.find((i) => i.message.includes('truncated in search results'));
      expect(longTitleIssue).toBeDefined();
      expect(longTitleIssue?.severity).toBe('warning');
    });

    it('should warn when title missing game name', () => {
      const draft = createDraft({ title: 'Beginner Guide: Tips for New Players' });
      const issues = validateSEO(draft, 'Elden Ring');
      const missingGameName = issues.find((i) => i.message.includes('game name'));
      expect(missingGameName).toBeDefined();
      expect(missingGameName?.severity).toBe('warning');
    });

    it('should pass when title contains base game name (before colon)', () => {
      const draft = createDraft({ title: 'Dark Souls III Guide: Complete Walkthrough' });
      const issues = validateSEO(draft, 'Dark Souls III: The Ringed City');
      const missingGameName = issues.find((i) => i.message.includes('game name'));
      expect(missingGameName).toBeUndefined();
    });
  });

  describe('excerpt validation', () => {
    it('should pass for optimal excerpt length', () => {
      const draft = createDraft({
        excerpt: 'A comprehensive beginner guide for Elden Ring covering combat basics, exploration tips, and character building strategies for new players.',
      }); // ~140 chars
      const issues = validateSEO(draft, 'Elden Ring');
      const excerptIssues = issues.filter((i) => i.message.includes('Excerpt'));
      expect(excerptIssues).toHaveLength(0);
    });

    it('should warn when excerpt is too short', () => {
      const draft = createDraft({ excerpt: 'Tips for new Elden Ring players.' }); // ~33 chars
      const issues = validateSEO(draft, 'Elden Ring');
      const shortExcerpt = issues.find((i) => i.message.includes('Excerpt below optimal'));
      expect(shortExcerpt).toBeDefined();
      expect(shortExcerpt?.severity).toBe('warning');
    });
  });

  describe('keyword density validation', () => {
    it('should pass for optimal keyword usage', () => {
      const draft = createDraft({
        tags: ['guide'],
        markdown: `# Elden Ring Guide

## Getting Started

This guide will help you navigate the world.

## Combat Guide

Following this guide section improves your combat.

## Exploration Guide

The guide continues with exploration tips.

## Sources

- Source 1`,
      });
      const issues = validateSEO(draft, 'Elden Ring');
      const keywordIssues = issues.filter((i) => i.message.includes('Primary tag'));
      expect(keywordIssues).toHaveLength(0);
    });

    it('should warn when primary keyword appears too few times', () => {
      const draft = createDraft({
        tags: ['speedrun'],
        markdown: `# Elden Ring Tips

## Getting Started

This will help you with the game.

## Combat Basics

Learn to fight better.

## Sources

- Source 1`,
      });
      const issues = validateSEO(draft, 'Elden Ring');
      const lowKeyword = issues.find((i) => i.message.includes('appears only'));
      expect(lowKeyword).toBeDefined();
      expect(lowKeyword?.severity).toBe('warning');
    });

    it('should warn when primary keyword appears too many times (stuffing)', () => {
      const draft = createDraft({
        tags: ['guide'],
        markdown: `# Guide to Elden Ring

## Guide Section 1

This guide is a guide for guide readers. The guide covers guide topics.

## Guide Section 2

Another guide section with guide content and guide tips in this guide.

## Guide Conclusion

This guide concludes the guide.

## Sources

- Guide source`,
      });
      const issues = validateSEO(draft, 'Elden Ring');
      const stuffing = issues.find((i) => i.message.includes('keyword stuffing'));
      expect(stuffing).toBeDefined();
      expect(stuffing?.severity).toBe('warning');
    });
  });

  describe('heading hierarchy via validateSEO', () => {
    it('should include heading hierarchy issues', () => {
      const draft = createDraft({
        markdown: `# Title
### H3 without H2
## Section 1

## Sources

- Source`,
      });
      const issues = validateSEO(draft, 'Elden Ring');
      const headingIssue = issues.find((i) => i.message.includes('H3 heading'));
      expect(headingIssue).toBeDefined();
    });
  });

  describe('SEO constraint values', () => {
    it('should use SEO_CONSTRAINTS from config', () => {
      expect(SEO_CONSTRAINTS.TITLE_OPTIMAL_MIN).toBe(30);
      expect(SEO_CONSTRAINTS.TITLE_OPTIMAL_MAX).toBe(60);
      expect(SEO_CONSTRAINTS.EXCERPT_OPTIMAL_MIN).toBe(120);
      expect(SEO_CONSTRAINTS.EXCERPT_OPTIMAL_MAX).toBe(160);
      expect(SEO_CONSTRAINTS.MIN_KEYWORD_OCCURRENCES).toBe(2);
      expect(SEO_CONSTRAINTS.MAX_KEYWORD_OCCURRENCES).toBe(8);
    });
  });
});

