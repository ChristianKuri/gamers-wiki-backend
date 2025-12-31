/**
 * Scout Agent Prompts - Facade
 *
 * Dispatches to category-specific prompt implementations.
 */

import type { GameArticleContext } from '../types';
import type { ExaQueryConfig, ScoutPromptContext, ScoutPrompts, ScoutQueryConfig } from './shared/scout';
import { detectArticleIntent } from './shared/utils';

// Import strategies
import { scoutPrompts as guidesPrompts } from './guides/scout';
import { scoutPrompts as reviewsPrompts } from './reviews/scout';
import { scoutPrompts as newsPrompts } from './news/scout';
import { scoutPrompts as listsPrompts } from './lists/scout';
import { ArticleCategorySlug } from '../article-plan';

// Re-export shared types and utils
export * from './shared/scout';
export { detectArticleIntent } from './shared/utils';

const strategies: Record<ArticleCategorySlug, ScoutPrompts> = {
  guides: guidesPrompts,
  reviews: reviewsPrompts,
  news: newsPrompts,
  lists: listsPrompts,
};

/**
 * Resolves the strategy to use based on context or instruction.
 */
function getStrategy(categorySlug?: ArticleCategorySlug, instruction?: string | null): ScoutPrompts {
  if (categorySlug && strategies[categorySlug]) {
    return strategies[categorySlug];
  }
  
  // Fallback to detection if no explicit category
  const detected = detectArticleIntent(instruction);
  if (detected !== 'general' && strategies[detected]) {
    return strategies[detected];
  }

  // Default to guides as the most generic/safe fallback for now, 
  // or maybe we should have a 'general' strategy?
  // Using guides logic for general queries is usually safe as it seeks facts.
  return guidesPrompts;
}

/**
 * System prompt for Scout overview briefing.
 */
export function getScoutOverviewSystemPrompt(localeInstruction: string, categorySlug?: ArticleCategorySlug): string {
  // We can't detect intent easily here without instruction, so we rely on categorySlug.
  // If missing, we default to generic guide-like behavior.
  const strategy = categorySlug ? strategies[categorySlug] : guidesPrompts;
  return strategy.getSystemPrompt(localeInstruction);
}

/**
 * User prompt for Scout overview briefing.
 */
export function getScoutOverviewUserPrompt(ctx: ScoutPromptContext, categorySlug?: ArticleCategorySlug): string {
  const strategy = getStrategy(categorySlug, ctx.instruction);
  return strategy.getOverviewUserPrompt(ctx);
}

/**
 * System prompt for Scout category insights.
 */
export function getScoutCategorySystemPrompt(localeInstruction: string, categorySlug?: ArticleCategorySlug): string {
  // Reuse main system prompt or we could add specific ones to the interface
  // For now, let's just use the main system prompt text but tailored
  const strategy = categorySlug ? strategies[categorySlug] : guidesPrompts;
  // Note: The interface currently has getSystemPrompt. 
  // We might want to separate category system prompt in the interface later.
  // For now, using the main system prompt is safer than hardcoding.
  return strategy.getSystemPrompt(localeInstruction);
}

/**
 * User prompt for Scout category insights.
 */
export function getScoutCategoryUserPrompt(
  gameName: string,
  instruction: string | null | undefined,
  categoryContext: string,
  categorySlug?: ArticleCategorySlug
): string {
  const strategy = getStrategy(categorySlug, instruction);
  return strategy.getCategoryUserPrompt(gameName, instruction, categoryContext);
}

/**
 * System prompt for Scout supplementary briefing (tips/recent/meta).
 */
export function getScoutSupplementarySystemPrompt(localeInstruction: string, categorySlug?: ArticleCategorySlug): string {
  const strategy = categorySlug ? strategies[categorySlug] : guidesPrompts;
  return strategy.getSystemPrompt(localeInstruction);
}

/**
 * User prompt for Scout supplementary briefing (tips/recent/meta).
 */
export function getScoutSupplementaryUserPrompt(
  gameName: string,
  supplementaryContext: string,
  categorySlug?: ArticleCategorySlug,
  instruction?: string | null
): string {
  const strategy = getStrategy(categorySlug, instruction);
  return strategy.getSupplementaryUserPrompt(gameName, supplementaryContext);
}

/**
 * Builds Exa-specific queries.
 */
export function buildExaQueriesForGuides(context: GameArticleContext): ExaQueryConfig | null {
  const strategy = getStrategy(context.categorySlug, context.instruction);
  if (strategy.buildExaQueries) {
    return strategy.buildExaQueries(context);
  }
  return null;
}

/**
 * Builds search queries for Scout with category-aware filtering.
 */
export function buildScoutQueries(context: GameArticleContext): ScoutQueryConfig {
  const strategy = getStrategy(context.categorySlug, context.instruction);
  return strategy.buildQueries(context);
}

/**
 * Gets query optimization prompt for LLM-based query generation.
 * Returns article-type-specific guidance for the LLM.
 */
export function getQueryOptimizationPrompt(
  gameName: string,
  instruction: string | null | undefined,
  genres: readonly string[] | undefined,
  articleType: string,
  categorySlug?: ArticleCategorySlug
): import('./shared/scout').QueryOptimizationPrompt | null {
  const strategy = getStrategy(categorySlug, instruction);
  if (!strategy.getQueryOptimizationPrompt) {
    return null;
  }
  return strategy.getQueryOptimizationPrompt({
    gameName,
    genres,
    instruction,
    articleType,
  });
}