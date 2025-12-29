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
import { findCorruptedPlanField } from '../validation';
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

  const targetWordCount = deps.targetWordCount ?? context.targetWordCount;

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
    validationFeedback: deps.validationFeedback,
    categorySlug: effectiveCategorySlug,
  };

  // Build prompts and log sizes for debugging
  const systemPrompt = getEditorSystemPrompt(localeInstruction, effectiveCategorySlug);
  const userPrompt = getEditorUserPrompt(promptContext);
  
  log.info(`Generating article plan...`);
  log.info(`  System prompt: ${systemPrompt.length} chars`);
  log.info(`  User prompt: ${userPrompt.length} chars`);
  log.info(`  Category: ${effectiveCategorySlug || 'auto-detect'}`);
  
  const startTime = Date.now();
  log.info(`  Calling generateObject (timeout: ${EDITOR_CONFIG.TIMEOUT_MS}ms per attempt)...`);

  // Helper to create a fresh timeout signal for each attempt
  // This ensures each retry gets its own 30s window
  const createTimeoutSignal = (): AbortSignal => {
    const timeoutSignal = AbortSignal.timeout(EDITOR_CONFIG.TIMEOUT_MS);
    return deps.signal 
      ? AbortSignal.any([deps.signal, timeoutSignal])
      : timeoutSignal;
  };

  const { object: rawPlan, usage } = await withRetry(
    () => {
      const attemptSignal = createTimeoutSignal();
      return deps.generateObject({
        model: deps.model,
        temperature,
        schema: ArticlePlanSchema,
        system: systemPrompt,
        prompt: userPrompt,
        abortSignal: attemptSignal,
      });
    },
    { context: 'Editor article plan generation', signal: deps.signal }
  );

  const elapsed = Date.now() - startTime;
  log.info(`  generateObject completed in ${elapsed}ms`);
  log.info(`  Raw plan received: ${rawPlan.sections?.length || 0} sections, ${rawPlan.requiredElements?.length || 0} required elements`);

  // Check for LLM output corruption (token repetition bug)
  // This MUST happen before any other processing - corrupted output cannot be used
  log.info(`  Checking for output corruption...`);
  const corruptedField = findCorruptedPlanField(rawPlan);
  if (corruptedField) {
    const errorMsg =
      `LLM output corruption detected in ${corruptedField.field}: ` +
      `pattern "${corruptedField.pattern}" repeated ${corruptedField.repetitions} times. ` +
      `This is a known LLM failure mode.`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }
  log.info(`  No corruption detected`);

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

