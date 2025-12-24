import { z } from 'zod';

import { ARTICLE_PLAN_CONSTRAINTS } from './config';

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
 *
 * NOTE: This is intentionally an object (not a single boolean) to allow future
 * extensibility. Planned additions include:
 * - noSpoilers: Avoid plot spoilers without warning
 * - noPriceGuesses: Avoid speculating on current prices (historical prices are fine)
 * - noUnverifiedClaims: Flag statements that can't be backed by sources
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
 *
 * NOTE: gameName and gameSlug are NOT part of this schema because they come from context,
 * not from AI output. The Editor agent adds these after parsing.
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
  /** The game this article is about (from context, not AI output) */
  readonly gameName: string;
  /** URL-friendly slug for the game (from context, optional) */
  readonly gameSlug?: string;
  readonly title: string;
  readonly categorySlug: ArticleCategorySlug;
  readonly excerpt: string;
  readonly tags: readonly string[];
  readonly sections: readonly ArticleSectionPlan[];
  /**
   * Safety constraints for article generation.
   * Structured as an object for future extensibility (see DEFAULT_ARTICLE_SAFETY).
   */
  readonly safety: {
    /** If true, avoid numerical scores/ratings unless this is a review article */
    readonly noScoresUnlessReview: boolean;
  };
}
