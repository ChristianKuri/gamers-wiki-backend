import { z } from 'zod';

// ============================================================================
// Constraints (shared with validation and prompts)
// ============================================================================

/**
 * Constraints for article plan validation.
 * Used by Zod schema, validation.ts, and prompts for consistency.
 * ALL validation constants should live here - no magic numbers elsewhere.
 */
export const ARTICLE_PLAN_CONSTRAINTS = {
  // Title constraints
  TITLE_MIN_LENGTH: 10,
  TITLE_MAX_LENGTH: 100,
  TITLE_RECOMMENDED_MAX_LENGTH: 70,

  // Excerpt constraints (for SEO meta description)
  EXCERPT_MIN_LENGTH: 120,
  EXCERPT_MAX_LENGTH: 160,

  // Section constraints
  MIN_SECTIONS: 3,
  MAX_SECTIONS: 12,
  MIN_SECTION_LENGTH: 100,

  // Tags constraints
  MIN_TAGS: 1,
  MAX_TAGS: 10,
  TAG_MAX_LENGTH: 50,

  // Research query constraints
  MIN_RESEARCH_QUERIES_PER_SECTION: 1,
  MAX_RESEARCH_QUERIES_PER_SECTION: 6,

  // Markdown constraints
  MIN_MARKDOWN_LENGTH: 500,
} as const;

// ============================================================================
// Category Slug Schema
// ============================================================================

/** Canonical category slugs (plural form) */
export type ArticleCategorySlug = 'news' | 'reviews' | 'guides' | 'lists';

/** Input that also accepts alias forms for backwards compatibility */
export type ArticleCategorySlugInput = ArticleCategorySlug | 'review' | 'guide' | 'list';

/**
 * Schema for category slugs that accepts canonical and alias forms.
 *
 * NOTE: This schema does NOT use .transform() because Zod transforms
 * cannot be represented in JSON Schema (required by AI SDK's generateObject).
 * Use normalizeArticleCategorySlug() to convert aliases after parsing.
 */
export const ArticleCategorySlugSchema = z.enum([
  'news',
  'reviews',
  'guides',
  'lists',
  // Backwards-compatible aliases (some prompts/models may still output these)
  'review',
  'guide',
  'list',
]);

/**
 * Normalizes category slug aliases to canonical form.
 * Call this AFTER parsing with ArticleCategorySlugSchema.
 *
 * @example
 * const parsed = ArticleCategorySlugSchema.parse(input);
 * const normalized = normalizeArticleCategorySlug(parsed);
 */
export function normalizeArticleCategorySlug(value: ArticleCategorySlugInput): ArticleCategorySlug {
  if (value === 'review') return 'reviews';
  if (value === 'guide') return 'guides';
  if (value === 'list') return 'lists';
  return value;
}

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

/**
 * Default safety settings for article plans.
 * Applied by Editor agent when AI omits the safety field.
 */
export const DEFAULT_ARTICLE_SAFETY = {
  noScoresUnlessReview: true,
} as const;

/**
 * Article plan schema for AI SDK's generateObject.
 *
 * NOTE: categorySlug accepts aliases but does NOT auto-normalize.
 * The Editor agent normalizes after parsing.
 *
 * NOTE: safety is optional because Zod's .default() doesn't translate to JSON Schema
 * for AI SDK's generateObject. The Editor agent applies DEFAULT_ARTICLE_SAFETY if omitted.
 */
export const ArticlePlanSchema = z.object({
  title: z
    .string()
    .min(ARTICLE_PLAN_CONSTRAINTS.TITLE_MIN_LENGTH, `Title too short (minimum ${ARTICLE_PLAN_CONSTRAINTS.TITLE_MIN_LENGTH} characters)`)
    .max(ARTICLE_PLAN_CONSTRAINTS.TITLE_MAX_LENGTH, `Title too long (maximum ${ARTICLE_PLAN_CONSTRAINTS.TITLE_MAX_LENGTH} characters)`),
  categorySlug: ArticleCategorySlugSchema,
  excerpt: z
    .string()
    .min(ARTICLE_PLAN_CONSTRAINTS.EXCERPT_MIN_LENGTH)
    .max(ARTICLE_PLAN_CONSTRAINTS.EXCERPT_MAX_LENGTH),
  tags: z
    .array(
      z.string()
        .min(1)
        .regex(/\S/, 'Tag cannot be whitespace only')
        .max(ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH, `Tag too long (maximum ${ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH} characters)`)
    )
    .min(ARTICLE_PLAN_CONSTRAINTS.MIN_TAGS, `At least ${ARTICLE_PLAN_CONSTRAINTS.MIN_TAGS} tag is required`)
    .max(ARTICLE_PLAN_CONSTRAINTS.MAX_TAGS, `Maximum ${ARTICLE_PLAN_CONSTRAINTS.MAX_TAGS} tags allowed`),
  sections: z
    .array(ArticleSectionPlanSchema)
    .min(ARTICLE_PLAN_CONSTRAINTS.MIN_SECTIONS)
    .max(ARTICLE_PLAN_CONSTRAINTS.MAX_SECTIONS),
  safety: z
    .object({
      noScoresUnlessReview: z.boolean(),
    })
    .optional(),
});

/**
 * Article plan type with normalized categorySlug (canonical form).
 * This is the type used throughout the system after Editor normalizes the plan.
 */
export interface ArticlePlan {
  readonly title: string;
  readonly categorySlug: ArticleCategorySlug;
  readonly excerpt: string;
  readonly tags: readonly string[];
  readonly sections: readonly ArticleSectionPlan[];
  readonly safety: {
    /** If true, avoid numerical scores/ratings unless this is a review article */
    readonly noScoresUnlessReview: boolean;
  };
}
