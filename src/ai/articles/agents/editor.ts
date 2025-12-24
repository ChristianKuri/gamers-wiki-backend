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
  type ArticlePlanInput,
} from '../article-plan';
import {
  buildCategoryHintsSection,
  buildExistingResearchSummary,
  getEditorSystemPrompt,
  getEditorUserPrompt,
  type EditorPromptContext,
} from '../prompts';
import type { CategoryHint, GameArticleContext, ScoutOutput } from '../types';

// ============================================================================
// Configuration
// ============================================================================

export const EDITOR_CONFIG = {
  TEMPERATURE: 0.4,
  OVERVIEW_LINES_IN_PROMPT: 10,
};

// ============================================================================
// Types
// ============================================================================

export interface EditorDeps {
  readonly generateObject: typeof import('ai').generateObject;
  readonly model: LanguageModel;
  readonly logger?: Logger;
}

export type SupportedLocale = 'en' | 'es';

// ============================================================================
// Main Editor Function
// ============================================================================

/**
 * Runs the Editor agent to create an article plan.
 *
 * @param context - Game context for the article
 * @param locale - Target locale
 * @param scoutOutput - Research from Scout agent
 * @param deps - Dependencies (generateObject, model)
 * @returns Article plan with sections and metadata
 */
export async function runEditor(
  context: GameArticleContext,
  locale: SupportedLocale,
  scoutOutput: ScoutOutput,
  deps: EditorDeps
): Promise<ArticlePlan> {
  const log = deps.logger ?? createPrefixedLogger('[Editor]');
  const localeInstruction =
    locale === 'es' ? 'Write all strings in Spanish.' : 'Write all strings in English.';

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

  const { object } = await deps.generateObject({
    model: deps.model,
    temperature: EDITOR_CONFIG.TEMPERATURE,
    schema: ArticlePlanSchema,
    system: getEditorSystemPrompt(localeInstruction),
    prompt: getEditorUserPrompt(promptContext),
  });

  const plan: ArticlePlanInput = object;

  log.debug(
    `Plan generated: ${plan.categorySlug} article with ${plan.sections.length} sections`
  );

  return {
    ...plan,
    categorySlug: normalizeArticleCategorySlug(plan.categorySlug),
  };
}

