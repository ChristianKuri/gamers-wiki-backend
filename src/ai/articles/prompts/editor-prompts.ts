/**
 * Editor Agent Prompts - Facade
 */

import { buildRequiredElementHints, buildCategoryHintsSection, buildExistingResearchSummary, buildTopSourcesSummary } from './shared/editor-utils';
import type { EditorPromptContext, EditorPrompts } from './shared/editor';
import { ArticleCategorySlug } from '../article-plan';

// Import strategies
import { editorPrompts as guidesPrompts } from './guides/editor';
import { editorPrompts as reviewsPrompts } from './reviews/editor';
import { editorPrompts as newsPrompts } from './news/editor';
import { editorPrompts as listsPrompts } from './lists/editor';
import { genericEditorPrompts } from './shared/generic-editor';

// Re-export utils
export { buildRequiredElementHints, buildCategoryHintsSection, buildExistingResearchSummary, buildTopSourcesSummary };
export type { EditorPromptContext };

const strategies: Record<ArticleCategorySlug, EditorPrompts> = {
  guides: guidesPrompts,
  reviews: reviewsPrompts,
  news: newsPrompts,
  lists: listsPrompts,
};

function getStrategy(categorySlug?: ArticleCategorySlug): EditorPrompts {
  if (categorySlug && strategies[categorySlug]) {
    return strategies[categorySlug];
  }
  return genericEditorPrompts;
}

/**
 * System prompt for the Editor agent.
 */
export function getEditorSystemPrompt(localeInstruction: string, categorySlug?: ArticleCategorySlug): string {
  const strategy = getStrategy(categorySlug);
  return strategy.getSystemPrompt(localeInstruction);
}

/**
 * User prompt for the Editor agent.
 */
export function getEditorUserPrompt(ctx: EditorPromptContext): string {
  const strategy = getStrategy(ctx.categorySlug);
  return strategy.getUserPrompt(ctx);
}