/**
 * Editor Agent
 *
 * Responsible for planning article structure based on Scout research.
 * Determines article category, creates section outline, and assigns research queries.
 */

import type { LanguageModel } from 'ai';
import type { z } from 'zod';

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
  buildSourceSummariesSection,
  buildTopSourcesSummary,
  buildTopDetailedSummaries,
  detectArticleIntent,
  getEditorSystemPrompt,
  getEditorUserPrompt,
  type EditorPromptContext,
} from '../prompts';
import { createEmptyTokenUsage, createTokenUsageFromResult, type GameArticleContext, type ScoutOutput, type TokenUsage } from '../types';

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
  const topSourcesSummary = buildTopSourcesSummary(scoutOutput);
  
  // Build research summary from source summaries
  const sourceSummariesSection = buildSourceSummariesSection(scoutOutput.sourceSummaries);
  
  // Build top detailed summaries from best sources (top 3 by quality + relevance)
  const topDetailedSummaries = buildTopDetailedSummaries(scoutOutput, 3);

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
    existingResearchSummary,
    categoryHintsSection,
    targetWordCount,
    validationFeedback: deps.validationFeedback,
    categorySlug: effectiveCategorySlug,
    topSourcesSummary,
    sourceSummariesSection,
    topDetailedSummaries,
    draftTitle: scoutOutput.queryPlan.draftTitle,
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

  let rawPlan: z.infer<typeof ArticlePlanSchema>;
  let generationResult: {
    usage?: { inputTokens?: number; outputTokens?: number };
    providerMetadata?: Record<string, unknown>;
  } | undefined;

  try {
    const result = await withRetry(
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
    rawPlan = result.object;
    generationResult = { usage: result.usage, providerMetadata: result.providerMetadata };
  } catch (error) {
    // Log detailed error information for schema validation failures
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`  generateObject failed: ${errorMessage}`);
    
    // Check if the error contains partial response data
    if (error && typeof error === 'object') {
      const errorObj = error as Record<string, unknown>;
      
      // AI SDK may include the text/response in the error
      if ('text' in errorObj && errorObj.text) {
        log.error(`  Raw LLM response (first 2000 chars):`);
        log.error(`  ${String(errorObj.text).slice(0, 2000)}`);
      }
      
      // Log any cause or additional details
      if ('cause' in errorObj && errorObj.cause) {
        log.error(`  Error cause: ${JSON.stringify(errorObj.cause, null, 2).slice(0, 1000)}`);
      }
      
      // Log validation issues if available
      if ('issues' in errorObj && Array.isArray(errorObj.issues)) {
        log.error(`  Schema validation issues:`);
        for (const issue of errorObj.issues.slice(0, 5)) {
          log.error(`    - ${JSON.stringify(issue)}`);
        }
      }
    }
    
    throw error;
  }

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

  // Track token usage and actual cost from OpenRouter
  const tokenUsage: TokenUsage = generationResult
    ? createTokenUsageFromResult(generationResult)
    : createEmptyTokenUsage();

  log.debug(
    `Plan generated: ${plan.categorySlug} article with ${plan.sections.length} sections`
  );

  return { plan, tokenUsage };
}

