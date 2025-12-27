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
import { EDITOR_CONFIG, WORD_COUNT_CONSTRAINTS } from '../config';
import { withRetry } from '../retry';
import {
  buildCategoryHintsSection,
  buildExistingResearchSummary,
  detectArticleIntent,
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
  /**
   * Target word count for the article.
   * Used to calculate recommended section count.
   * If not provided, category defaults will be applied later.
   */
  readonly targetWordCount?: number;
  /**
   * Validation feedback from a previous plan attempt.
   * Present when retrying after plan validation failed.
   * Contains error messages to help the Editor fix issues.
   */
  readonly validationFeedback?: readonly string[];
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
/**
 * Calculates the recommended number of sections based on target word count.
 * Uses WORD_COUNT_CONSTRAINTS.WORDS_PER_SECTION as the baseline.
 *
 * @param targetWordCount - Target word count for the article
 * @returns Recommended number of sections (minimum 4)
 */
function calculateTargetSectionCount(targetWordCount: number | undefined): number | undefined {
  if (!targetWordCount) return undefined;

  const sectionCount = Math.round(targetWordCount / WORD_COUNT_CONSTRAINTS.WORDS_PER_SECTION);
  // Enforce minimum of 4 sections, maximum of 10 for readability
  return Math.max(4, Math.min(10, sectionCount));
}

export async function runEditor(
  context: GameArticleContext,
  scoutOutput: ScoutOutput,
  deps: EditorDeps
): Promise<EditorOutput> {
  const log = deps.logger ?? createPrefixedLogger('[Editor]');
  const temperature = deps.temperature ?? EDITOR_CONFIG.TEMPERATURE;
  const localeInstruction = 'Write all strings in English.';

  // Resolve effective category to tailor the prompt
  let effectiveCategorySlug = context.categorySlug;
  if (!effectiveCategorySlug) {
    const intent = detectArticleIntent(context.instruction);
    if (intent !== 'general') {
      effectiveCategorySlug = intent;
    }
  }

  const categoryHintsSection = buildCategoryHintsSection(context.categoryHints);
  const existingResearchSummary = buildExistingResearchSummary(
    scoutOutput,
    EDITOR_CONFIG.OVERVIEW_LINES_IN_PROMPT
  );

  // Calculate target section count from word count
  const targetWordCount = deps.targetWordCount ?? context.targetWordCount;
  const targetSectionCount = calculateTargetSectionCount(targetWordCount);

  if (targetWordCount) {
    log.debug(`Target word count: ${targetWordCount}, recommended sections: ${targetSectionCount}`);
  }

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
    targetWordCount,
    targetSectionCount,
    validationFeedback: deps.validationFeedback,
    categorySlug: effectiveCategorySlug,
  };

  log.debug('Generating article plan...');

  const { object: rawPlan, usage } = await withRetry(
    () =>
      deps.generateObject({
        model: deps.model,
        temperature,
        schema: ArticlePlanSchema,
        system: getEditorSystemPrompt(localeInstruction, effectiveCategorySlug),
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

