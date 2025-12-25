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
import { createEmptyTokenUsage, type GameArticleContext, type ScoutOutput, type TokenUsage } from '../types';

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

/**
 * Output from the Editor agent containing the article plan and token usage.
 */
export interface EditorOutput {
  readonly plan: ArticlePlan;
  readonly tokenUsage: TokenUsage;
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
 * @returns Editor output with article plan and token usage
 */
export async function runEditor(
  context: GameArticleContext,
  scoutOutput: ScoutOutput,
  deps: EditorDeps
): Promise<EditorOutput> {
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

  const { object: rawPlan, usage } = await withRetry(
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

  // Build final plan with:
  // - Game context (gameName, gameSlug) from input
  // - Normalized categorySlug
  // - Default safety settings if AI omitted them
  // (Zod .default() doesn't work with AI SDK's JSON Schema conversion)
  const plan: ArticlePlan = {
    gameName: context.gameName,
    gameSlug: context.gameSlug ?? undefined,
    ...rawPlan,
    categorySlug: normalizedCategorySlug,
    safety: rawPlan.safety ?? DEFAULT_ARTICLE_SAFETY,
  };

  // Track token usage (AI SDK v4 uses inputTokens/outputTokens)
  const tokenUsage: TokenUsage = usage
    ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
    : createEmptyTokenUsage();

  log.debug(
    `Plan generated: ${plan.categorySlug} article with ${plan.sections.length} sections`
  );

  return { plan, tokenUsage };
}

