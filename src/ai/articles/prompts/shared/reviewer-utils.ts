import type { ArticleCategorySlug, ArticlePlan } from '../../article-plan';

export interface ReviewerPromptContext {
  readonly plan: ArticlePlan;
  readonly markdown: string;
  readonly researchSummary: string;
  readonly categorySlug: ArticleCategorySlug;
}

/**
 * Builds a concise research summary for the Reviewer.
 */
export function buildResearchSummaryForReview(
  overview: string,
  categoryInsights: string,
  maxLength: number
): string {
  const parts: string[] = [];

  if (overview) parts.push('OVERVIEW:\n' + overview);
  if (categoryInsights) parts.push('CATEGORY INSIGHTS:\n' + categoryInsights);

  const combined = parts.join('\n\n---\n\n');

  if (combined.length > maxLength) {
    return combined.slice(0, maxLength) + '\n...(truncated)';
  }

  return combined;
}
