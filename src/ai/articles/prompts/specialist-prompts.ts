/**
 * Specialist Agent Prompts - Facade
 */

import { buildResearchContext } from './shared/specialist-utils';
import type { SpecialistPrompts, SpecialistSectionContext } from './shared/specialist';
import type { ArticlePlan, ArticleCategorySlug } from '../article-plan';

// Import strategies
import { specialistPrompts as guidesPrompts } from './guides/specialist';
import { specialistPrompts as reviewsPrompts } from './reviews/specialist';
import { specialistPrompts as newsPrompts } from './news/specialist';
import { specialistPrompts as listsPrompts } from './lists/specialist';
import { genericSpecialistPrompts } from './shared/generic-specialist';

// Re-export utils
export { buildResearchContext };
export type { SpecialistSectionContext };

// Re-export getCategoryToneGuide for backwards compatibility if needed, 
// though strategies handle this internally now.
export { getCategoryToneGuide } from './shared/generic-specialist'; 

const strategies: Record<ArticleCategorySlug, SpecialistPrompts> = {
  guides: guidesPrompts,
  reviews: reviewsPrompts,
  news: newsPrompts,
  lists: listsPrompts,
};

function getStrategy(categorySlug: ArticleCategorySlug): SpecialistPrompts {
  if (strategies[categorySlug]) {
    return strategies[categorySlug];
  }
  return genericSpecialistPrompts;
}

/**
 * System prompt for the Specialist agent.
 */
export function getSpecialistSystemPrompt(
  localeInstruction: string,
  // Note: We ignore the old categoryToneGuide param if strategy is used, 
  // but keep it for signature compatibility if we fallback to generic.
  categoryToneGuide: string, 
  categorySlug?: ArticleCategorySlug
): string {
  if (categorySlug) {
    const strategy = getStrategy(categorySlug);
    return strategy.getSystemPrompt(localeInstruction);
  }
  return genericSpecialistPrompts.getSystemPrompt(localeInstruction);
}

/**
 * User prompt for the Specialist agent.
 */
export function getSpecialistSectionUserPrompt(
  ctx: SpecialistSectionContext,
  plan: ArticlePlan,
  gameName: string
): string {
  // Plan always has the categorySlug
  const strategy = getStrategy(plan.categorySlug);
  return strategy.getSectionUserPrompt(ctx, plan, gameName);
}