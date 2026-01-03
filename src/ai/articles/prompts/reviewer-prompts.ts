/**
 * Reviewer Agent Prompts - Facade
 */

import { 
  buildResearchSummaryForReviewer,
} from './shared/reviewer-utils';
import type { ReviewerPromptContext, ReviewerPrompts } from './shared/reviewer';
import type { ArticleCategorySlug } from '../article-plan';

// Import strategies
import { reviewerPrompts as guidesPrompts } from './guides/reviewer';
import { reviewerPrompts as reviewsPrompts } from './reviews/reviewer';
import { reviewerPrompts as newsPrompts } from './news/reviewer';
import { reviewerPrompts as listsPrompts } from './lists/reviewer';

// Re-export utils
export { buildResearchSummaryForReviewer };
export type { ReviewerPromptContext };

const strategies: Record<ArticleCategorySlug, ReviewerPrompts> = {
  guides: guidesPrompts,
  reviews: reviewsPrompts,
  news: newsPrompts,
  lists: listsPrompts,
};

function getStrategy(categorySlug: ArticleCategorySlug): ReviewerPrompts {
  if (strategies[categorySlug]) {
    return strategies[categorySlug];
  }
  // Default fallback (though category should always be valid)
  return guidesPrompts;
}

/**
 * System prompt for the Reviewer agent.
 */
export function getReviewerSystemPrompt(categorySlug?: ArticleCategorySlug): string {
  const strategy = getStrategy(categorySlug || 'guides');
  return strategy.getSystemPrompt();
}

/**
 * User prompt for the Reviewer agent.
 */
export function getReviewerUserPrompt(ctx: ReviewerPromptContext): string {
  const strategy = getStrategy(ctx.categorySlug);
  return strategy.getUserPrompt(ctx);
}