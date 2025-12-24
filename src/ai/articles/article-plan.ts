import { z } from 'zod';

// ============================================================================
// Constraints (shared with validation and prompts)
// ============================================================================

/**
 * Constraints for article plan validation.
 * Used by Zod schema, validation.ts, and prompts for consistency.
 */
export const ARTICLE_PLAN_CONSTRAINTS = {
  TITLE_MIN_LENGTH: 1,
  TITLE_MAX_LENGTH: 100,
  EXCERPT_MIN_LENGTH: 120,
  EXCERPT_MAX_LENGTH: 160,
  MIN_SECTIONS: 3,
  MAX_SECTIONS: 12,
  MAX_TAGS: 10,
  MIN_RESEARCH_QUERIES_PER_SECTION: 1,
  MAX_RESEARCH_QUERIES_PER_SECTION: 6,
} as const;

// ============================================================================
// Category Slug Schema (with auto-normalization)
// ============================================================================

/** Canonical category slugs (plural form) */
export type ArticleCategorySlug = 'news' | 'reviews' | 'guides' | 'lists';

/** Input accepts both canonical and alias forms */
const ArticleCategorySlugInputSchema = z.enum([
  'news',
  'reviews',
  'guides',
  'lists',
  // Backwards-compatible aliases (some prompts/models may still output these)
  'review',
  'guide',
  'list',
]);

export type ArticleCategorySlugInput = z.infer<typeof ArticleCategorySlugInputSchema>;

/**
 * Normalizes category slug aliases to canonical form.
 */
export function normalizeArticleCategorySlug(value: ArticleCategorySlugInput): ArticleCategorySlug {
  if (value === 'review') return 'reviews';
  if (value === 'guide') return 'guides';
  if (value === 'list') return 'lists';
  return value;
}

/**
 * Schema that validates and auto-normalizes category slugs.
 * Accepts aliases ('guide', 'review', 'list') and outputs canonical form ('guides', 'reviews', 'lists').
 */
export const ArticleCategorySlugSchema = ArticleCategorySlugInputSchema.transform(
  normalizeArticleCategorySlug
);

// ============================================================================
// Section Plan Schema
// ============================================================================

export const ArticleSectionPlanSchema = z.object({
  headline: z.string().min(1),
  goal: z.string().min(1),
  researchQueries: z
    .array(z.string().min(1))
    .min(ARTICLE_PLAN_CONSTRAINTS.MIN_RESEARCH_QUERIES_PER_SECTION)
    .max(ARTICLE_PLAN_CONSTRAINTS.MAX_RESEARCH_QUERIES_PER_SECTION),
});

export type ArticleSectionPlan = z.infer<typeof ArticleSectionPlanSchema>;

// ============================================================================
// Article Plan Schema
// ============================================================================

export const ArticlePlanSchema = z.object({
  title: z
    .string()
    .min(ARTICLE_PLAN_CONSTRAINTS.TITLE_MIN_LENGTH)
    .max(ARTICLE_PLAN_CONSTRAINTS.TITLE_MAX_LENGTH),
  categorySlug: ArticleCategorySlugSchema,
  excerpt: z
    .string()
    .min(ARTICLE_PLAN_CONSTRAINTS.EXCERPT_MIN_LENGTH)
    .max(ARTICLE_PLAN_CONSTRAINTS.EXCERPT_MAX_LENGTH),
  tags: z.array(z.string().min(1)).max(ARTICLE_PLAN_CONSTRAINTS.MAX_TAGS).default([]),
  sections: z
    .array(ArticleSectionPlanSchema)
    .min(ARTICLE_PLAN_CONSTRAINTS.MIN_SECTIONS)
    .max(ARTICLE_PLAN_CONSTRAINTS.MAX_SECTIONS),
  safety: z
    .object({
      noPrices: z.literal(true),
      noScoresUnlessReview: z.boolean(),
    })
    .default({ noPrices: true, noScoresUnlessReview: true }),
});

/**
 * Article plan type - inferred from schema with auto-normalized categorySlug.
 */
export type ArticlePlan = z.infer<typeof ArticlePlanSchema>;
