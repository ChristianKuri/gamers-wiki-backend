import { z } from 'zod';

export const ArticleCategorySlugInputSchema = z.enum([
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

export const ArticleCategorySlugSchema = ArticleCategorySlugInputSchema;

export type ArticleCategorySlug = 'news' | 'reviews' | 'guides' | 'lists';

export function normalizeArticleCategorySlug(value: ArticleCategorySlugInput): ArticleCategorySlug {
  if (value === 'review') return 'reviews';
  if (value === 'guide') return 'guides';
  if (value === 'list') return 'lists';
  return value;
}

export const ArticleSectionPlanSchema = z.object({
  headline: z.string().min(1),
  goal: z.string().min(1),
  researchQueries: z.array(z.string().min(1)).min(1).max(6),
});

export type ArticleSectionPlan = z.infer<typeof ArticleSectionPlanSchema>;

export const ArticlePlanSchema = z.object({
  title: z.string().min(1),
  categorySlug: ArticleCategorySlugSchema,
  excerpt: z.string().min(120).max(160),
  tags: z.array(z.string().min(1)).max(10).default([]),
  sections: z.array(ArticleSectionPlanSchema).min(3).max(12),
  safety: z
    .object({
      noPrices: z.literal(true),
      noScoresUnlessReview: z.boolean(),
    })
    .default({ noPrices: true, noScoresUnlessReview: true }),
});

export type ArticlePlanInput = z.infer<typeof ArticlePlanSchema>;

export type ArticlePlan = Omit<ArticlePlanInput, 'categorySlug'> & {
  categorySlug: ArticleCategorySlug;
};
