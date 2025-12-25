import { describe, it, expect } from 'vitest';

import {
  validateGameArticleContext,
  validateArticleDraft,
  validateArticlePlan,
  getErrors,
  getWarnings,
} from '../../../src/ai/articles/validation';
import { ARTICLE_PLAN_CONSTRAINTS } from '../../../src/ai/articles/config';
import type { ArticlePlan } from '../../../src/ai/articles/article-plan';

describe('validateGameArticleContext', () => {
  describe('gameName validation', () => {
    it('returns error when gameName is missing', () => {
      const issues = validateGameArticleContext({});
      const errors = getErrors(issues);

      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('gameName is required');
    });

    it('returns error when gameName is null', () => {
      const issues = validateGameArticleContext({ gameName: null });
      const errors = getErrors(issues);

      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('gameName is required');
    });

    it('returns error when gameName is empty string', () => {
      const issues = validateGameArticleContext({ gameName: '' });
      const errors = getErrors(issues);

      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('gameName is required');
    });

    it('returns error when gameName is whitespace only', () => {
      const issues = validateGameArticleContext({ gameName: '   ' });
      const errors = getErrors(issues);

      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('gameName is required');
    });

    it('returns no errors for valid gameName', () => {
      const issues = validateGameArticleContext({ gameName: 'Elden Ring' });
      const errors = getErrors(issues);

      expect(errors.length).toBe(0);
    });
  });

  describe('genres validation', () => {
    it('returns error when genres is not an array', () => {
      const issues = validateGameArticleContext({
        gameName: 'Test Game',
        genres: 'Action' as unknown,
      });
      const errors = getErrors(issues);

      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('genres must be an array');
    });

    it('accepts genres as array', () => {
      const issues = validateGameArticleContext({
        gameName: 'Test Game',
        genres: ['Action', 'RPG'],
      });
      const errors = getErrors(issues);

      expect(errors.length).toBe(0);
    });

    it('accepts undefined genres', () => {
      const issues = validateGameArticleContext({
        gameName: 'Test Game',
      });
      const errors = getErrors(issues);

      expect(errors.length).toBe(0);
    });
  });

  describe('platforms validation', () => {
    it('returns error when platforms is not an array', () => {
      const issues = validateGameArticleContext({
        gameName: 'Test Game',
        platforms: 'PC' as unknown,
      });
      const errors = getErrors(issues);

      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('platforms must be an array');
    });

    it('accepts platforms as array', () => {
      const issues = validateGameArticleContext({
        gameName: 'Test Game',
        platforms: ['PC', 'PlayStation 5'],
      });
      const errors = getErrors(issues);

      expect(errors.length).toBe(0);
    });
  });

  describe('categoryHints validation', () => {
    it('returns error when categoryHints is not an array', () => {
      const issues = validateGameArticleContext({
        gameName: 'Test Game',
        categoryHints: { slug: 'guides' } as unknown,
      });
      const errors = getErrors(issues);

      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('categoryHints must be an array');
    });

    it('returns error when categoryHint is missing slug', () => {
      const issues = validateGameArticleContext({
        gameName: 'Test Game',
        categoryHints: [{ systemPrompt: 'Test' }] as unknown,
      });
      const errors = getErrors(issues);

      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('categoryHints[0] must have a slug');
    });

    it('returns error when categoryHint has empty slug', () => {
      const issues = validateGameArticleContext({
        gameName: 'Test Game',
        categoryHints: [{ slug: '' }] as unknown,
      });
      const errors = getErrors(issues);

      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('categoryHints[0] must have a slug');
    });

    it('returns error for each invalid categoryHint', () => {
      const issues = validateGameArticleContext({
        gameName: 'Test Game',
        categoryHints: [
          { slug: 'guides' },
          { systemPrompt: 'Missing slug' },
          { slug: '' },
        ] as unknown,
      });
      const errors = getErrors(issues);

      expect(errors.length).toBe(2);
      expect(errors[0].message).toContain('categoryHints[1]');
      expect(errors[1].message).toContain('categoryHints[2]');
    });

    it('accepts valid categoryHints', () => {
      const issues = validateGameArticleContext({
        gameName: 'Test Game',
        categoryHints: [
          { slug: 'guides', systemPrompt: 'Write a guide' },
          { slug: 'reviews' },
        ],
      });
      const errors = getErrors(issues);

      expect(errors.length).toBe(0);
    });
  });

  describe('multiple validation errors', () => {
    it('returns all errors when multiple validations fail', () => {
      const issues = validateGameArticleContext({
        gameName: '',
        genres: 'Action' as unknown,
        platforms: 'PC' as unknown,
        categoryHints: { slug: 'guides' } as unknown,
      });
      const errors = getErrors(issues);

      expect(errors.length).toBe(4);
    });
  });
});

describe('validateArticleDraft tag length validation', () => {
  const validDraft = {
    title: 'Test Article Title That Is Long Enough',
    categorySlug: 'guides',
    excerpt:
      'This is a test excerpt that meets the minimum length requirement of 120 characters and is also under the maximum of 160 characters.',
    tags: ['tag1', 'tag2'],
    markdown: `# Test Article

## Introduction

${' '.repeat(500)}Content that meets minimum length requirements with plenty of filler text to ensure validation passes.

## Sources

- https://example.com`,
    sources: ['https://example.com'],
    plan: {
      title: 'Test',
      categorySlug: 'guides' as const,
      excerpt: 'Test excerpt',
      tags: ['tag1'],
      sections: [
        { headline: 'Section 1', goal: 'Goal 1', researchQueries: ['q1'] },
        { headline: 'Section 2', goal: 'Goal 2', researchQueries: ['q2'] },
        { headline: 'Section 3', goal: 'Goal 3', researchQueries: ['q3'] },
      ],
      safety: { noScoresUnlessReview: true },
    },
  };

  it('validates tags under max length', () => {
    const draft = {
      ...validDraft,
      tags: ['short tag', 'another tag'],
    };
    const issues = validateArticleDraft(draft);
    const tagLengthErrors = getErrors(issues).filter((e) =>
      e.message.includes('Tag') && e.message.includes('too long')
    );

    expect(tagLengthErrors.length).toBe(0);
  });

  it('returns error for tag exceeding max length', () => {
    const longTag = 'a'.repeat(ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH + 1);
    const draft = {
      ...validDraft,
      tags: ['valid tag', longTag],
    };
    const issues = validateArticleDraft(draft);
    const tagLengthErrors = getErrors(issues).filter((e) =>
      e.message.includes('too long')
    );

    expect(tagLengthErrors.length).toBe(1);
    // Zod uses 0-based array indices: tags.1 = second tag
    expect(tagLengthErrors[0].message).toContain('tags.1');
    expect(tagLengthErrors[0].message).toContain(
      `maximum ${ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH}`
    );
  });

  it('returns error for each tag exceeding max length', () => {
    const longTag1 = 'a'.repeat(ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH + 10);
    const longTag2 = 'b'.repeat(ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH + 5);
    const draft = {
      ...validDraft,
      tags: [longTag1, 'valid', longTag2],
    };
    const issues = validateArticleDraft(draft);
    const tagLengthErrors = getErrors(issues).filter((e) =>
      e.message.includes('too long')
    );

    expect(tagLengthErrors.length).toBe(2);
    // Zod uses 0-based array indices
    expect(tagLengthErrors[0].message).toContain('tags.0');
    expect(tagLengthErrors[1].message).toContain('tags.2');
  });

  it('accepts tags at exactly max length', () => {
    const maxLengthTag = 'a'.repeat(ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH);
    const draft = {
      ...validDraft,
      tags: [maxLengthTag],
    };
    const issues = validateArticleDraft(draft);
    const tagLengthErrors = getErrors(issues).filter((e) =>
      e.message.includes('Tag') && e.message.includes('too long')
    );

    expect(tagLengthErrors.length).toBe(0);
  });

  it('rejects whitespace-only tags', () => {
    const draft = {
      ...validDraft,
      tags: ['valid tag', '   ', 'another valid'],
    };
    const issues = validateArticleDraft(draft);
    const whitespaceErrors = getErrors(issues).filter((e) =>
      e.message.includes('whitespace')
    );

    expect(whitespaceErrors.length).toBe(1);
  });

  it('rejects empty string tags', () => {
    const draft = {
      ...validDraft,
      tags: ['valid tag', ''],
    };
    const issues = validateArticleDraft(draft);
    // Empty string fails min(1) check, not whitespace check
    const errors = getErrors(issues);

    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('getErrors and getWarnings', () => {
  it('filters only error severity issues', () => {
    const issues = [
      { severity: 'error' as const, message: 'Error 1' },
      { severity: 'warning' as const, message: 'Warning 1' },
      { severity: 'error' as const, message: 'Error 2' },
    ];

    const errors = getErrors(issues);

    expect(errors.length).toBe(2);
    expect(errors[0].message).toBe('Error 1');
    expect(errors[1].message).toBe('Error 2');
  });

  it('filters only warning severity issues', () => {
    const issues = [
      { severity: 'error' as const, message: 'Error 1' },
      { severity: 'warning' as const, message: 'Warning 1' },
      { severity: 'warning' as const, message: 'Warning 2' },
    ];

    const warnings = getWarnings(issues);

    expect(warnings.length).toBe(2);
    expect(warnings[0].message).toBe('Warning 1');
    expect(warnings[1].message).toBe('Warning 2');
  });

  it('returns empty array when no matching severity', () => {
    const issues = [{ severity: 'warning' as const, message: 'Warning 1' }];

    const errors = getErrors(issues);

    expect(errors.length).toBe(0);
  });
});

describe('validateArticlePlan', () => {
  const createValidPlan = (): ArticlePlan => ({
    gameName: 'Elden Ring',
    title: 'Elden Ring: Complete Beginner Guide',
    categorySlug: 'guides',
    excerpt:
      'Master the Lands Between with this comprehensive beginner guide covering early game strategies, builds, and exploration tips.',
    tags: ['beginner', 'guide', 'tips'],
    sections: [
      {
        headline: 'Getting Started',
        goal: 'Help new players understand the basics',
        researchQueries: ['Elden Ring beginner tips', 'Elden Ring first steps'],
      },
      {
        headline: 'Character Creation',
        goal: 'Guide players through class selection',
        researchQueries: ['Elden Ring best starting class'],
      },
      {
        headline: 'Early Game Exploration',
        goal: 'Show safe early areas to explore',
        researchQueries: ['Elden Ring Limgrave guide'],
      },
      {
        headline: 'Combat Basics',
        goal: 'Teach fundamental combat mechanics',
        researchQueries: ['Elden Ring combat tips'],
      },
    ],
    safety: { noScoresUnlessReview: true },
  });

  describe('section count validation', () => {
    it('accepts plan with valid number of sections', () => {
      const plan = createValidPlan();
      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors.filter((e) => e.message.includes('sections'))).toHaveLength(0);
    });

    it('returns error when fewer than minimum sections', () => {
      const plan = {
        ...createValidPlan(),
        sections: [
          {
            headline: 'Only Section',
            goal: 'The only section',
            researchQueries: ['query'],
          },
        ],
      };

      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors.some((e) => e.message.includes('sections') && e.message.includes('minimum'))).toBe(true);
    });

    it('returns error when more than maximum sections', () => {
      const manySection = {
        headline: 'Section',
        goal: 'A goal',
        researchQueries: ['query'],
      };
      const plan = {
        ...createValidPlan(),
        sections: Array.from({ length: ARTICLE_PLAN_CONSTRAINTS.MAX_SECTIONS + 1 }, (_, i) => ({
          ...manySection,
          headline: `Section ${i + 1}`,
        })),
      };

      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors.some((e) => e.message.includes('sections') && e.message.includes('maximum'))).toBe(true);
    });
  });

  describe('duplicate headline validation', () => {
    it('returns error for duplicate section headlines', () => {
      const plan = {
        ...createValidPlan(),
        sections: [
          { headline: 'Introduction', goal: 'Goal 1', researchQueries: ['q1'] },
          { headline: 'Getting Started', goal: 'Goal 2', researchQueries: ['q2'] },
          { headline: 'Introduction', goal: 'Goal 3', researchQueries: ['q3'] },
        ],
      };

      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors.some((e) => e.message.includes('Duplicate'))).toBe(true);
    });

    it('detects case-insensitive duplicate headlines', () => {
      const plan = {
        ...createValidPlan(),
        sections: [
          { headline: 'Introduction', goal: 'Goal 1', researchQueries: ['q1'] },
          { headline: 'Getting Started', goal: 'Goal 2', researchQueries: ['q2'] },
          { headline: 'INTRODUCTION', goal: 'Goal 3', researchQueries: ['q3'] },
        ],
      };

      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors.some((e) => e.message.includes('Duplicate'))).toBe(true);
    });

    it('accepts plan with unique headlines', () => {
      const plan = createValidPlan();
      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors.filter((e) => e.message.includes('Duplicate'))).toHaveLength(0);
    });
  });

  describe('section content validation', () => {
    it('returns error for empty headline', () => {
      const plan = {
        ...createValidPlan(),
        sections: [
          { headline: '', goal: 'Goal', researchQueries: ['query'] },
          { headline: 'Valid', goal: 'Goal', researchQueries: ['query'] },
          { headline: 'Another', goal: 'Goal', researchQueries: ['query'] },
        ],
      };

      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors.some((e) => e.message.includes('empty headline'))).toBe(true);
    });

    it('returns error for whitespace-only headline', () => {
      const plan = {
        ...createValidPlan(),
        sections: [
          { headline: '   ', goal: 'Goal', researchQueries: ['query'] },
          { headline: 'Valid', goal: 'Goal', researchQueries: ['query'] },
          { headline: 'Another', goal: 'Goal', researchQueries: ['query'] },
        ],
      };

      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors.some((e) => e.message.includes('empty headline'))).toBe(true);
    });

    it('returns error for empty goal', () => {
      const plan = {
        ...createValidPlan(),
        sections: [
          { headline: 'Section 1', goal: '', researchQueries: ['query'] },
          { headline: 'Section 2', goal: 'Valid', researchQueries: ['query'] },
          { headline: 'Section 3', goal: 'Valid', researchQueries: ['query'] },
        ],
      };

      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors.some((e) => e.message.includes('empty goal'))).toBe(true);
    });

    it('returns error for missing research queries', () => {
      const plan = {
        ...createValidPlan(),
        sections: [
          { headline: 'Section 1', goal: 'Goal', researchQueries: [] },
          { headline: 'Section 2', goal: 'Goal', researchQueries: ['query'] },
          { headline: 'Section 3', goal: 'Goal', researchQueries: ['query'] },
        ],
      };

      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors.some((e) => e.message.includes('research queries') && e.message.includes('minimum'))).toBe(true);
    });

    it('returns error for empty research query strings', () => {
      const plan = {
        ...createValidPlan(),
        sections: [
          { headline: 'Section 1', goal: 'Goal', researchQueries: ['valid', '', '  '] },
          { headline: 'Section 2', goal: 'Goal', researchQueries: ['query'] },
          { headline: 'Section 3', goal: 'Goal', researchQueries: ['query'] },
        ],
      };

      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors.some((e) => e.message.includes('empty research query'))).toBe(true);
    });
  });

  describe('title duplicate warning', () => {
    it('returns warning when title matches a section headline', () => {
      const plan = {
        ...createValidPlan(),
        title: 'Getting Started',
        sections: [
          { headline: 'Getting Started', goal: 'Goal 1', researchQueries: ['q1'] },
          { headline: 'Section 2', goal: 'Goal 2', researchQueries: ['q2'] },
          { headline: 'Section 3', goal: 'Goal 3', researchQueries: ['q3'] },
        ],
      };

      const issues = validateArticlePlan(plan);
      const warnings = getWarnings(issues);

      expect(warnings.some((w) => w.message.includes('title duplicates section headline'))).toBe(true);
    });

    it('detects case-insensitive title-headline duplicates', () => {
      const plan = {
        ...createValidPlan(),
        title: 'GETTING STARTED',
        sections: [
          { headline: 'getting started', goal: 'Goal 1', researchQueries: ['q1'] },
          { headline: 'Section 2', goal: 'Goal 2', researchQueries: ['q2'] },
          { headline: 'Section 3', goal: 'Goal 3', researchQueries: ['q3'] },
        ],
      };

      const issues = validateArticlePlan(plan);
      const warnings = getWarnings(issues);

      expect(warnings.some((w) => w.message.includes('title duplicates section headline'))).toBe(true);
    });
  });

  describe('tag validation', () => {
    it('returns error when fewer than minimum tags', () => {
      const plan = {
        ...createValidPlan(),
        tags: [],
      };

      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors.some((e) => e.message.includes('tags') && e.message.includes('minimum'))).toBe(true);
    });

    it('returns error for empty tag strings', () => {
      const plan = {
        ...createValidPlan(),
        tags: ['valid', '', '  '],
      };

      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors.some((e) => e.message.includes('empty tag'))).toBe(true);
    });

    it('accepts valid tags', () => {
      const plan = createValidPlan();
      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors.filter((e) => e.message.includes('tag'))).toHaveLength(0);
    });
  });

  describe('complete valid plan', () => {
    it('returns no errors for a valid plan', () => {
      const plan = createValidPlan();
      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors).toHaveLength(0);
    });

    it('accepts plan with optional gameSlug', () => {
      const plan = {
        ...createValidPlan(),
        gameSlug: 'elden-ring',
      };
      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors).toHaveLength(0);
    });
  });
});

