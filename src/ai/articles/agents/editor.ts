/**
 * Editor Agent
 *
 * Responsible for planning article structure based on Scout research.
 * Determines article category, creates section outline, and assigns research queries.
 */

import type { LanguageModel } from 'ai';

import { createPrefixedLogger, type Logger } from '../../../utils/logger';
import {
  ArticlePlanSchema,
  normalizeArticleCategorySlug,
  type ArticlePlan,
  type ArticleCategorySlugInput,
} from '../article-plan';
import { EDITOR_CONFIG } from '../config';
import { withRetry } from '../retry';
import {
  buildCategoryHintsSection,
  buildExistingResearchSummary,
  getEditorSystemPrompt,
  getEditorUserPrompt,
  type EditorPromptContext,
} from '../prompts';
import type { GameArticleContext, ScoutOutput } from '../types';

// Re-export config for backwards compatibility
export { EDITOR_CONFIG } from '../config';

// ============================================================================
// Types
// ============================================================================

export interface EditorDeps {
  readonly generateObject: typeof import('ai').generateObject;
  readonly model: LanguageModel;
  readonly logger?: Logger;
}

// ============================================================================
// Main Editor Function
// ============================================================================

/**
 * Runs the Editor agent to create an article plan.
 * Plans are always generated in English.
 *
 * @param context - Game context for the article
 * @param scoutOutput - Research from Scout agent
 * @param deps - Dependencies (generateObject, model)
 * @returns Article plan with sections and metadata
 */
export async function runEditor(
  context: GameArticleContext,
  scoutOutput: ScoutOutput,
  deps: EditorDeps
): Promise<ArticlePlan> {
  const log = deps.logger ?? createPrefixedLogger('[Editor]');
  const localeInstruction = 'Write all strings in English.';

  const categoryHintsSection = buildCategoryHintsSection(context.categoryHints);
  const existingResearchSummary = buildExistingResearchSummary(
    scoutOutput,
    EDITOR_CONFIG.OVERVIEW_LINES_IN_PROMPT
  );

  const promptContext: EditorPromptContext = {
    gameName: context.gameName,
    releaseDate: context.releaseDate,
    genres: context.genres,
    platforms: context.platforms,
    developer: context.developer,
    publisher: context.publisher,
    instruction: context.instruction,
    localeInstruction,
    scoutBriefing: scoutOutput.briefing,
    existingResearchSummary,
    categoryHintsSection,
  };

  log.debug('Generating article plan...');

  const { object: rawPlan } = await withRetry(
    () =>
      deps.generateObject({
        model: deps.model,
        temperature: EDITOR_CONFIG.TEMPERATURE,
        schema: ArticlePlanSchema,
        system: getEditorSystemPrompt(localeInstruction),
        prompt: getEditorUserPrompt(promptContext),
      }),
    { context: 'Editor article plan generation' }
  );

  // Normalize categorySlug (AI may output aliases like 'guide' instead of 'guides')
  const normalizedCategorySlug = normalizeArticleCategorySlug(
    rawPlan.categorySlug as ArticleCategorySlugInput
  );

  const plan: ArticlePlan = {
    ...rawPlan,
    categorySlug: normalizedCategorySlug,
  };

  log.debug(
    `Plan generated: ${plan.categorySlug} article with ${plan.sections.length} sections`
  );

  return plan;
}

