import { describe, it, expect } from 'vitest';

import { ArticlePlanSchema } from '../../../src/ai/articles/article-plan';

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
});
