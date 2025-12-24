import { describe, it, expect } from 'vitest';

import {
  ArticlePlanSchema,
  ARTICLE_PLAN_CONSTRAINTS,
  normalizeArticleCategorySlug,
} from '../../../src/ai/articles/article-plan';

describe('ArticlePlanSchema', () => {
  it('accepts a valid plan shape', () => {
    const plan = ArticlePlanSchema.parse({
      title: 'Elden Ring: Beginner Guide for the First 5 Hours',
      categorySlug: 'guide',
      excerpt:
        'Start strong in Elden Ring with early routes, safe upgrades, and the key mistakes most new Tarnished make—so you level faster and stay alive.',
      tags: ['beginner tips', 'early game', 'build advice'],
      sections: [
        {
          headline: 'What You Should Do First',
          goal: 'Give a safe opening path and immediate priorities.',
          researchQueries: ['Elden Ring early game best route'],
        },
        {
          headline: 'Starter Class and Keepsake',
          goal: 'Explain starter choices and why they matter.',
          researchQueries: ['Elden Ring best starting class'],
        },
        {
          headline: 'Leveling and Stat Priorities',
          goal: 'Teach new players the core stats and early targets.',
          researchQueries: ['Elden Ring vigor early game recommendation'],
        },
      ],
      safety: {
        noPrices: true,
        noScoresUnlessReview: true,
      },
    });

    expect(plan.categorySlug).toBe('guide');
    expect(plan.sections.length).toBeGreaterThanOrEqual(3);
  });

  describe('tag length validation', () => {
    const validPlanBase = {
      title: 'Test Article Title That Is Long Enough',
      categorySlug: 'guides',
      excerpt:
        'Start strong in Elden Ring with early routes, safe upgrades, and the key mistakes most new Tarnished make—so you level faster and stay alive.',
      sections: [
        { headline: 'Section 1', goal: 'Goal', researchQueries: ['query1'] },
        { headline: 'Section 2', goal: 'Goal', researchQueries: ['query2'] },
        { headline: 'Section 3', goal: 'Goal', researchQueries: ['query3'] },
      ],
      safety: { noScoresUnlessReview: true },
    };

    it('accepts tags within max length', () => {
      const plan = ArticlePlanSchema.parse({
        ...validPlanBase,
        tags: ['short tag', 'another tag', 'third tag'],
      });

      expect(plan.tags).toEqual(['short tag', 'another tag', 'third tag']);
    });

    it('accepts tag at exactly max length', () => {
      const maxLengthTag = 'a'.repeat(ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH);
      const plan = ArticlePlanSchema.parse({
        ...validPlanBase,
        tags: [maxLengthTag],
      });

      expect(plan.tags[0]).toBe(maxLengthTag);
    });

    it('rejects tag exceeding max length', () => {
      const tooLongTag = 'a'.repeat(ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH + 1);

      expect(() =>
        ArticlePlanSchema.parse({
          ...validPlanBase,
          tags: [tooLongTag],
        })
      ).toThrow();
    });

    it('rejects plan when any tag exceeds max length', () => {
      const tooLongTag = 'a'.repeat(ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH + 5);

      expect(() =>
        ArticlePlanSchema.parse({
          ...validPlanBase,
          tags: ['valid', tooLongTag, 'also valid'],
        })
      ).toThrow();
    });
  });
});

describe('ARTICLE_PLAN_CONSTRAINTS', () => {
  it('has TAG_MAX_LENGTH defined', () => {
    expect(ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH).toBeDefined();
    expect(typeof ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH).toBe('number');
    expect(ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH).toBeGreaterThan(0);
  });

  it('has reasonable TAG_MAX_LENGTH value', () => {
    // Should be long enough for reasonable tags but not excessive
    expect(ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH).toBeGreaterThanOrEqual(20);
    expect(ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH).toBeLessThanOrEqual(100);
  });
});

describe('normalizeArticleCategorySlug', () => {
  it('normalizes singular aliases to plural form', () => {
    expect(normalizeArticleCategorySlug('review')).toBe('reviews');
    expect(normalizeArticleCategorySlug('guide')).toBe('guides');
    expect(normalizeArticleCategorySlug('list')).toBe('lists');
  });

  it('passes through canonical plural forms unchanged', () => {
    expect(normalizeArticleCategorySlug('news')).toBe('news');
    expect(normalizeArticleCategorySlug('reviews')).toBe('reviews');
    expect(normalizeArticleCategorySlug('guides')).toBe('guides');
    expect(normalizeArticleCategorySlug('lists')).toBe('lists');
  });
});
