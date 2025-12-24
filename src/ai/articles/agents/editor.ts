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
  DEFAULT_ARTICLE_SAFETY,
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
  /** Optional AbortSignal for cancellation support */
  readonly signal?: AbortSignal;
  /** Optional temperature override (default: EDITOR_CONFIG.TEMPERATURE) */
  readonly temperature?: number;
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
  const temperature = deps.temperature ?? EDITOR_CONFIG.TEMPERATURE;
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
        temperature,
        schema: ArticlePlanSchema,
        system: getEditorSystemPrompt(localeInstruction),
        prompt: getEditorUserPrompt(promptContext),
      }),
    { context: 'Editor article plan generation', signal: deps.signal }
  );

  // Normalize categorySlug (AI may output aliases like 'guide' instead of 'guides')
  const normalizedCategorySlug = normalizeArticleCategorySlug(
    rawPlan.categorySlug as ArticleCategorySlugInput
  );

  // Apply default safety settings if AI omitted them
  // (Zod .default() doesn't work with AI SDK's JSON Schema conversion)
  const plan: ArticlePlan = {
    ...rawPlan,
    categorySlug: normalizedCategorySlug,
    safety: rawPlan.safety ?? DEFAULT_ARTICLE_SAFETY,
  };

  log.debug(
    `Plan generated: ${plan.categorySlug} article with ${plan.sections.length} sections`
  );

  return plan;
}

