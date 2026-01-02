import { describe, it, expect } from 'vitest';

import {
  validateGameArticleContext,
  validateArticleDraft,
  validateArticlePlan,
  getErrors,
  getWarnings,
  detectRepetitiveText,
  findCorruptedPlanField,
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
    description:
      'A user-friendly card preview that describes what readers will learn from this guide.',
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
    description:
      'Comprehensive beginner guide for new Tarnished with early game tips, builds, and exploration strategies.',
    tags: ['beginner', 'guide', 'tips'],
    sections: [
      {
        headline: 'Getting Started',
        goal: 'Help new players understand the basics',
        researchQueries: ['Elden Ring beginner tips', 'Elden Ring first steps'],
        mustCover: ['Game controls', 'UI overview'],
      },
      {
        headline: 'Character Creation',
        goal: 'Guide players through class selection',
        researchQueries: ['Elden Ring best starting class'],
        mustCover: ['Starting classes'],
      },
      {
        headline: 'Early Game Exploration',
        goal: 'Show safe early areas to explore',
        researchQueries: ['Elden Ring Limgrave guide'],
        mustCover: ['Limgrave locations'],
      },
      {
        headline: 'Combat Basics',
        goal: 'Teach fundamental combat mechanics',
        researchQueries: ['Elden Ring combat tips'],
        mustCover: ['Combat mechanics'],
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
            mustCover: ['item'],
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
        mustCover: ['item'],
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
          { headline: 'Introduction', goal: 'Goal 1', researchQueries: ['q1'], mustCover: ['i1'] },
          { headline: 'Getting Started', goal: 'Goal 2', researchQueries: ['q2'], mustCover: ['i2'] },
          { headline: 'Introduction', goal: 'Goal 3', researchQueries: ['q3'], mustCover: ['i3'] },
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
          { headline: 'Introduction', goal: 'Goal 1', researchQueries: ['q1'], mustCover: ['i1'] },
          { headline: 'Getting Started', goal: 'Goal 2', researchQueries: ['q2'], mustCover: ['i2'] },
          { headline: 'INTRODUCTION', goal: 'Goal 3', researchQueries: ['q3'], mustCover: ['i3'] },
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
          { headline: '', goal: 'Goal', researchQueries: ['query'], mustCover: ['i1'] },
          { headline: 'Valid', goal: 'Goal', researchQueries: ['query'], mustCover: ['i2'] },
          { headline: 'Another', goal: 'Goal', researchQueries: ['query'], mustCover: ['i3'] },
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
          { headline: '   ', goal: 'Goal', researchQueries: ['query'], mustCover: ['i1'] },
          { headline: 'Valid', goal: 'Goal', researchQueries: ['query'], mustCover: ['i2'] },
          { headline: 'Another', goal: 'Goal', researchQueries: ['query'], mustCover: ['i3'] },
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
          { headline: 'Section 1', goal: '', researchQueries: ['query'], mustCover: ['i1'] },
          { headline: 'Section 2', goal: 'Valid', researchQueries: ['query'], mustCover: ['i2'] },
          { headline: 'Section 3', goal: 'Valid', researchQueries: ['query'], mustCover: ['i3'] },
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
          { headline: 'Section 1', goal: 'Goal', researchQueries: [], mustCover: ['i1'] },
          { headline: 'Section 2', goal: 'Goal', researchQueries: ['query'], mustCover: ['i2'] },
          { headline: 'Section 3', goal: 'Goal', researchQueries: ['query'], mustCover: ['i3'] },
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
          { headline: 'Section 1', goal: 'Goal', researchQueries: ['valid', '', '  '], mustCover: ['i1'] },
          { headline: 'Section 2', goal: 'Goal', researchQueries: ['query'], mustCover: ['i2'] },
          { headline: 'Section 3', goal: 'Goal', researchQueries: ['query'], mustCover: ['i3'] },
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
          { headline: 'Getting Started', goal: 'Goal 1', researchQueries: ['q1'], mustCover: ['i1'] },
          { headline: 'Section 2', goal: 'Goal 2', researchQueries: ['q2'], mustCover: ['i2'] },
          { headline: 'Section 3', goal: 'Goal 3', researchQueries: ['q3'], mustCover: ['i3'] },
          { headline: 'Section 4', goal: 'Goal 4', researchQueries: ['q4'], mustCover: ['i4'] },
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
          { headline: 'getting started', goal: 'Goal 1', researchQueries: ['q1'], mustCover: ['i1'] },
          { headline: 'Section 2', goal: 'Goal 2', researchQueries: ['q2'], mustCover: ['i2'] },
          { headline: 'Section 3', goal: 'Goal 3', researchQueries: ['q3'], mustCover: ['i3'] },
          { headline: 'Section 4', goal: 'Goal 4', researchQueries: ['q4'], mustCover: ['i4'] },
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

  describe('token repetition corruption detection', () => {
    it('returns error for corrupted requiredElements', () => {
      const corruptedText = 'Normal text if needededededededededededededededededededededededededededededededededededededededededededededede';
      const plan = {
        ...createValidPlan(),
        requiredElements: [corruptedText],
      };

      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('LLM output corruption');
      expect(errors[0].message).toContain('requiredElements[0]');
    });

    it('returns error for corrupted section goal', () => {
      const corruptedGoal = 'Help players with the basicsededededededededededededededededededededededededededededededede' +
        'edededededededededededededededededededededededededededededededededededededededededed';
      const plan = {
        ...createValidPlan(),
        sections: [
          { headline: 'Section 1', goal: corruptedGoal, researchQueries: ['q1'], mustCover: ['item1'] },
          { headline: 'Section 2', goal: 'Valid goal', researchQueries: ['q2'], mustCover: ['item2'] },
          { headline: 'Section 3', goal: 'Valid goal', researchQueries: ['q3'], mustCover: ['item3'] },
          { headline: 'Section 4', goal: 'Valid goal', researchQueries: ['q4'], mustCover: ['item4'] },
        ],
      };

      const issues = validateArticlePlan(plan);
      const errors = getErrors(issues);

      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('LLM output corruption');
      expect(errors[0].message).toContain('sections[0].goal');
    });

    it('does not flag normal text as corrupted', () => {
      const plan = createValidPlan();
      const issues = validateArticlePlan(plan);
      const corruptionErrors = getErrors(issues).filter((e) =>
        e.message.includes('corruption')
      );

      expect(corruptionErrors).toHaveLength(0);
    });
  });
});

describe('detectRepetitiveText', () => {
  it('returns false for normal text', () => {
    const result = detectRepetitiveText('This is a normal piece of text without any repetition issues.');
    expect(result.isCorrupted).toBe(false);
  });

  it('returns false for short strings', () => {
    // Short strings are not checked for efficiency
    const result = detectRepetitiveText('short');
    expect(result.isCorrupted).toBe(false);
  });

  it('detects classic LLM repetition pattern (ede...)', () => {
    // Simulates the actual bug pattern from the E2E test
    const corrupted = 'Normal text if needededededededededededededededededededededededededededededededededededededededededededededede' +
      'edededededededededededededededededededededededededededededededededededededededed';
    const result = detectRepetitiveText(corrupted);

    expect(result.isCorrupted).toBe(true);
    // Algorithm may find 'ed', 'de', or 'ede' as the repeating pattern (shortest first)
    expect(['ed', 'de', 'ede']).toContain(result.pattern);
    expect(result.repetitions).toBeGreaterThan(15);
  });

  it('detects single character repetition', () => {
    const corrupted = 'Text with eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' +
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const result = detectRepetitiveText(corrupted);

    expect(result.isCorrupted).toBe(true);
  });

  it('detects longer pattern repetition', () => {
    // Test with a 5-char pattern
    const corrupted = 'Start' + 'abcde'.repeat(50) + 'end';
    const result = detectRepetitiveText(corrupted);

    expect(result.isCorrupted).toBe(true);
    expect(result.pattern).toBe('abcde');
  });

  it('does not flag legitimate repetition in prose', () => {
    // Some words naturally repeat in normal writing
    const normal = 'The game is good. The graphics are great. The sound is excellent. ' +
      'The controls are tight. The story is compelling. The characters are memorable. ' +
      'The world is vast. The combat is satisfying. The progression is rewarding.';
    const result = detectRepetitiveText(normal);

    expect(result.isCorrupted).toBe(false);
  });

  it('does not flag markdown formatting', () => {
    const markdown = '## Section One\n\n**Bold text** and **more bold** and **another bold**\n\n' +
      '## Section Two\n\n- Item one\n- Item two\n- Item three\n\n' +
      '## Section Three\n\nMore content here.';
    const result = detectRepetitiveText(markdown);

    expect(result.isCorrupted).toBe(false);
  });
});

describe('findCorruptedPlanField', () => {
  const validPlan = {
    title: 'Valid Title For Testing',
    excerpt: 'This is a valid excerpt that meets all requirements and is not corrupted in any way.',
    description: 'A card preview that helps users browsing the site decide what to read.',
    tags: ['tag1', 'tag2', 'tag3'],
    sections: [
      { headline: 'Section 1', goal: 'Goal 1', researchQueries: ['query1'], mustCover: ['item1'] },
      { headline: 'Section 2', goal: 'Goal 2', researchQueries: ['query2'], mustCover: ['item2'] },
    ],
    requiredElements: ['Element 1', 'Element 2'],
  };

  it('returns null for valid plan', () => {
    const result = findCorruptedPlanField(validPlan);
    expect(result).toBeNull();
  });

  it('detects corruption in title', () => {
    const plan = {
      ...validPlan,
      title: 'Valid' + 'xyz'.repeat(100),
    };
    const result = findCorruptedPlanField(plan);

    expect(result).not.toBeNull();
    expect(result!.field).toBe('title');
  });

  it('detects corruption in excerpt', () => {
    const plan = {
      ...validPlan,
      excerpt: 'Starting text' + 'abc'.repeat(100),
    };
    const result = findCorruptedPlanField(plan);

    expect(result).not.toBeNull();
    expect(result!.field).toBe('excerpt');
  });

  it('detects corruption in tags', () => {
    const plan = {
      ...validPlan,
      tags: ['valid', 'tag' + 'xyz'.repeat(100), 'another'],
    };
    const result = findCorruptedPlanField(plan);

    expect(result).not.toBeNull();
    expect(result!.field).toBe('tags[1]');
  });

  it('detects corruption in requiredElements', () => {
    const plan = {
      ...validPlan,
      requiredElements: ['Valid element', 'Corrupted' + 'ede'.repeat(100)],
    };
    const result = findCorruptedPlanField(plan);

    expect(result).not.toBeNull();
    expect(result!.field).toBe('requiredElements[1]');
  });

  it('detects corruption in section headline', () => {
    const plan = {
      ...validPlan,
      sections: [
        { headline: 'Corrupted' + 'abc'.repeat(100), goal: 'Goal', researchQueries: ['q'], mustCover: ['i'] },
        { headline: 'Valid', goal: 'Goal', researchQueries: ['q'], mustCover: ['i'] },
      ],
    };
    const result = findCorruptedPlanField(plan);

    expect(result).not.toBeNull();
    expect(result!.field).toBe('sections[0].headline');
  });

  it('detects corruption in section goal', () => {
    const plan = {
      ...validPlan,
      sections: [
        { headline: 'Valid', goal: 'Goal' + 'xyz'.repeat(100), researchQueries: ['q'], mustCover: ['i'] },
        { headline: 'Valid 2', goal: 'Goal 2', researchQueries: ['q2'], mustCover: ['i2'] },
      ],
    };
    const result = findCorruptedPlanField(plan);

    expect(result).not.toBeNull();
    expect(result!.field).toBe('sections[0].goal');
  });

  it('detects corruption in research queries', () => {
    const plan = {
      ...validPlan,
      sections: [
        { headline: 'Valid', goal: 'Goal', researchQueries: ['valid', 'query' + 'ede'.repeat(100)], mustCover: ['i'] },
        { headline: 'Valid 2', goal: 'Goal 2', researchQueries: ['q2'], mustCover: ['i2'] },
      ],
    };
    const result = findCorruptedPlanField(plan);

    expect(result).not.toBeNull();
    expect(result!.field).toBe('sections[0].researchQueries[1]');
  });

  it('detects corruption in mustCover', () => {
    const plan = {
      ...validPlan,
      sections: [
        { headline: 'Valid', goal: 'Goal', researchQueries: ['q'], mustCover: ['item' + 'abc'.repeat(100)] },
        { headline: 'Valid 2', goal: 'Goal 2', researchQueries: ['q2'], mustCover: ['i2'] },
      ],
    };
    const result = findCorruptedPlanField(plan);

    expect(result).not.toBeNull();
    expect(result!.field).toBe('sections[0].mustCover[0]');
  });
});

