/**
 * Game Article Generator
 *
 * Multi-agent article generation system that produces high-quality,
 * well-researched gaming articles in English.
 *
 * Architecture:
 * - Scout: Gathers comprehensive research from multiple sources
 * - Editor: Plans article structure based on research
 * - Specialist: Writes sections using research and plan
 *
 * Note: Articles are always generated in English. Translation to other
 * languages (e.g., Spanish) is handled by a separate translation agent.
 *
 * @example
 * import { generateGameArticleDraft } from '@/ai/articles';
 *
 * const draft = await generateGameArticleDraft({
 *   gameName: 'Elden Ring',
 *   genres: ['Action RPG', 'Soulslike'],
 *   instruction: 'Write a beginner guide',
 * });
 *
 * @example
 * // With progress callback
 * const draft = await generateGameArticleDraft(context, undefined, {
 *   onProgress: (phase, progress, message) => {
 *     console.log(`[${phase}] ${progress}%: ${message}`);
 *   },
 * });
 *
 * @example
 * // With timeout (2 minutes)
 * const draft = await generateGameArticleDraft(context, undefined, {
 *   timeoutMs: 120000,
 * });
 *
 * @example
 * // With AbortController for cancellation
 * const controller = new AbortController();
 * setTimeout(() => controller.abort(), 60000); // Cancel after 60s
 *
 * const draft = await generateGameArticleDraft(context, undefined, {
 *   signal: controller.signal,
 * });
 */

import type { Core } from '@strapi/strapi';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject, generateText } from 'ai';

import { getModel } from '../config';
import { tavilySearch } from '../tools/tavily';
import {
  createContextualLogger,
  createPrefixedLogger,
  generateCorrelationId,
  type ContextualLogger,
  type Logger,
} from '../../utils/logger';
import { runScout, runEditor, runSpecialist, runReviewer, type EditorOutput, type ReviewerOutput } from './agents';
import type { CleaningDeps } from './research-pool';
import { getAllExcludedDomains, getAllExcludedDomainsForEngine } from './source-cache';
import type { SpecialistOutput } from './agents/specialist';
import type { ArticlePlan, ArticleCategorySlug } from './article-plan';
import { GENERATOR_CONFIG, WORD_COUNT_DEFAULTS, WORD_COUNT_CONSTRAINTS, REVIEWER_CONFIG, FIXER_CONFIG } from './config';
import { runFixer, type FixerContext, type FixerDeps } from './fixer';
import { countContentH2Sections } from './markdown-utils';
import { withRetry } from './retry';
import {
  addSourceUsage,
  addTokenUsage,
  ArticleGenerationError,
  createEmptySourceContentUsage,
  createEmptyTokenUsage,
  systemClock,
  type AggregatedTokenUsage,
  type ArticleGenerationErrorCode,
  type ArticleGenerationMetadata,
  type ArticleProgressCallback,
  type Clock,
  type FixApplied,
  type FixerOutcomeMetrics,
  extractScoutSourceUsage,
  type GameArticleContext,
  type GameArticleDraft,
  type RecoveryMetadata,
  type ScoutOutput,
  type SearchApiCosts,
  type SourceContentUsage,
  type TokenUsage,
} from './types';
import { PhaseTimer } from './phase-timer';
import { ProgressTracker } from './progress-tracker';
import { validateArticleDraft, validateArticlePlan, validateGameArticleContext, getErrors, getWarnings } from './validation';

// ============================================================================
// Dependencies Interface
// ============================================================================

/**
 * Dependencies for article generation (enables testing with mocks).
 * All properties are optional - defaults are used when not provided.
 * Commonly, only `strapi` is passed to enable content cleaning.
 */
export interface ArticleGeneratorDeps {
  readonly openrouter?: ReturnType<typeof createOpenRouter>;
  readonly search?: typeof tavilySearch;
  readonly generateText?: typeof generateText;
  readonly generateObject?: typeof generateObject;
  /**
   * Optional Strapi instance for content cleaning and caching.
   * When provided, search results are cleaned by the Cleaner agent
   * and cached in the database for future reuse.
   */
  readonly strapi?: Core.Strapi;
}

/**
 * Valid temperature range for LLM calls.
 * Most models support 0-2, with 0 being deterministic and 2 being highly creative.
 */
const TEMPERATURE_RANGE = { min: 0, max: 2 } as const;

/**
 * Temperature overrides for individual agents.
 * Useful for experimentation or tuning specific phases.
 */
export interface TemperatureOverrides {
  /** Override Scout agent temperature (default: 0.2 - factual accuracy) */
  readonly scout?: number;
  /** Override Editor agent temperature (default: 0.4 - balanced creativity) */
  readonly editor?: number;
  /** Override Specialist agent temperature (default: 0.6 - engaging prose) */
  readonly specialist?: number;
}

/**
 * Validates temperature overrides are within acceptable range.
 *
 * @param overrides - Temperature overrides to validate
 * @throws ArticleGenerationError with 'CONFIG_ERROR' if any temperature is invalid
 */
function validateTemperatureOverrides(overrides?: TemperatureOverrides): void {
  if (!overrides) return;

  const entries: Array<[string, number | undefined]> = [
    ['scout', overrides.scout],
    ['editor', overrides.editor],
    ['specialist', overrides.specialist],
  ];

  for (const [agent, temp] of entries) {
    if (temp !== undefined) {
      if (typeof temp !== 'number' || Number.isNaN(temp)) {
        throw new ArticleGenerationError(
          'CONFIG_ERROR',
          `Invalid temperature for ${agent}: ${temp} (must be a number)`
        );
      }
      if (temp < TEMPERATURE_RANGE.min || temp > TEMPERATURE_RANGE.max) {
        throw new ArticleGenerationError(
          'CONFIG_ERROR',
          `Invalid temperature for ${agent}: ${temp} (must be between ${TEMPERATURE_RANGE.min} and ${TEMPERATURE_RANGE.max})`
        );
      }
    }
  }
}

/**
 * Options for article generation.
 */
export interface ArticleGeneratorOptions {
  /**
   * Optional callback for monitoring generation progress.
   * Called at the start and end of each phase, and for each section during Specialist phase.
   */
  readonly onProgress?: ArticleProgressCallback;

  /**
   * Optional timeout in milliseconds for the entire generation process.
   * If exceeded, throws ArticleGenerationError with code 'TIMEOUT'.
   * Default: 0 (no timeout).
   */
  readonly timeoutMs?: number;

  /**
   * Optional AbortSignal for cancellation support.
   * If aborted, throws ArticleGenerationError with code 'CANCELLED'.
   *
   * @example
   * const controller = new AbortController();
   * setTimeout(() => controller.abort(), 60000); // Cancel after 60s
   *
   * const draft = await generateGameArticleDraft(context, undefined, {
   *   signal: controller.signal,
   * });
   */
  readonly signal?: AbortSignal;

  /**
   * Override parallel section writing mode.
   * - undefined: auto-decide based on category (parallel for 'lists')
   * - true: force parallel (faster, sections written independently)
   * - false: force sequential (maintains narrative flow between sections)
   */
  readonly parallelSections?: boolean;

  /**
   * Optional clock for time operations.
   * Defaults to systemClock. Override for deterministic testing.
   *
   * @example
   * // Testing with fixed time
   * const mockClock = { now: () => 1700000000000 };
   * const draft = await generateGameArticleDraft(context, undefined, {
   *   clock: mockClock,
   * });
   */
  readonly clock?: Clock;

  /**
   * Optional temperature overrides for individual agents.
   * Useful for experimentation or tuning specific phases.
   *
   * @example
   * // More creative specialist, more factual scout
   * const draft = await generateGameArticleDraft(context, undefined, {
   *   temperatureOverrides: {
   *     scout: 0.1,      // Very factual
   *     specialist: 0.8, // More creative prose
   *   },
   * });
   */
  readonly temperatureOverrides?: TemperatureOverrides;

  /**
   * Optional correlation ID for log tracing.
   * If not provided, a unique ID will be generated.
   * Useful for correlating logs across distributed systems.
   *
   * @example
   * // Use existing correlation ID from request
   * const draft = await generateGameArticleDraft(context, undefined, {
   *   correlationId: req.headers['x-correlation-id'],
   * });
   */
  readonly correlationId?: string;

  /**
   * Whether to run the Reviewer agent for quality control.
   *
   * Default behavior (when not specified):
   * - guides: true (enabled by default)
   * - reviews, news, lists: false (disabled by default)
   *
   * The Reviewer checks for:
   * - Redundancy (repeated explanations)
   * - Coverage (required elements)
   * - Factual accuracy (against research)
   * - Style consistency
   * - SEO basics
   *
   * **Cost implications**: Reviewer adds one additional LLM call per article.
   * Estimated cost: ~$0.001-0.005 USD per article (varies by model and article length).
   * Token usage: Typically 500-2000 input tokens, 100-500 output tokens.
   *
   * @example
   * // Force reviewer on for all article types
   * const draft = await generateGameArticleDraft(context, undefined, {
   *   enableReviewer: true,
   * });
   *
   * @example
   * // Disable reviewer for faster generation (even for guides)
   * const draft = await generateGameArticleDraft(context, undefined, {
   *   enableReviewer: false,
   * });
   */
  readonly enableReviewer?: boolean;
}

// ============================================================================
// Timeout and Cancellation Helpers
// ============================================================================

/**
 * Throws if the operation should not proceed due to cancellation or timeout.
 * Call this before starting any long-running phase.
 *
 * @param userSignal - Optional user-provided AbortSignal
 * @param startTime - Start time of the overall operation
 * @param timeoutMs - Total timeout in ms (0 = no timeout)
 * @param gameName - Game name for error messages
 * @param clock - Clock interface for time operations
 * @throws ArticleGenerationError with 'CANCELLED' if signal is aborted
 * @throws ArticleGenerationError with 'TIMEOUT' if timeout exceeded
 */
function assertCanProceed(
  userSignal: AbortSignal | undefined,
  startTime: number,
  timeoutMs: number,
  gameName: string,
  clock: Clock
): void {
  if (userSignal?.aborted) {
    throw new ArticleGenerationError(
      'CANCELLED',
      `Article generation for "${gameName}" was cancelled`
    );
  }
  if (timeoutMs > 0 && clock.now() - startTime > timeoutMs) {
    throw new ArticleGenerationError(
      'TIMEOUT',
      `Article generation for "${gameName}" timed out after ${timeoutMs}ms`
    );
  }
}

/**
 * Wraps a promise with timeout and cancellation support using Promise.race.
 *
 * Uses a cleaner Promise.race approach with proper cleanup via finally block.
 * Handles both user-provided AbortSignal and timeout-based cancellation.
 *
 * @param promise - The promise to wrap
 * @param userSignal - Optional user-provided AbortSignal for cancellation
 * @param startTime - Start time of the overall operation (for calculating remaining timeout)
 * @param timeoutMs - Total timeout in ms (0 = no timeout)
 * @param gameName - Game name for error messages
 * @param phaseName - Phase name for error messages
 * @param clock - Clock interface for time operations
 * @returns The resolved value or throws ArticleGenerationError
 */
async function withTimeoutAndCancellation<T>(
  promise: Promise<T>,
  userSignal: AbortSignal | undefined,
  startTime: number,
  timeoutMs: number,
  gameName: string,
  phaseName: string,
  clock: Clock
): Promise<T> {
  // Pre-check: verify we can proceed before setting up race
  assertCanProceed(userSignal, startTime, timeoutMs, gameName, clock);

  // No timeout or cancellation needed - return promise directly
  if (!userSignal && timeoutMs <= 0) {
    return promise;
  }

  // Set up cancellation machinery
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;

  const cleanup = () => {
    if (timeoutId) clearTimeout(timeoutId);
    if (abortHandler && userSignal) {
      userSignal.removeEventListener('abort', abortHandler);
    }
  };

  // Create a promise that rejects on cancellation (user signal or timeout)
  const cancellationPromise = new Promise<T>((_, reject) => {
    // Handle user abort signal
    if (userSignal) {
      abortHandler = () =>
        reject(
          new ArticleGenerationError(
            'CANCELLED',
            `Article generation for "${gameName}" was cancelled during ${phaseName} phase`
          )
        );
      userSignal.addEventListener('abort', abortHandler, { once: true });
    }

    // Handle timeout
    if (timeoutMs > 0) {
      const remaining = Math.max(0, timeoutMs - (clock.now() - startTime));
      timeoutId = setTimeout(
        () =>
          reject(
            new ArticleGenerationError(
              'TIMEOUT',
              `Article generation for "${gameName}" timed out during ${phaseName} phase after ${timeoutMs}ms`
            )
          ),
        remaining
      );
    }
  });

  try {
    // Race the original promise against the cancellation promise
    return await Promise.race([promise, cancellationPromise]);
  } finally {
    // Always clean up event listeners and timeouts
    cleanup();
  }
}

// ============================================================================
// Phase Execution Helper
// ============================================================================

/**
 * Options for running a phase with error handling.
 */
interface RunPhaseOptions {
  readonly signal: AbortSignal | undefined;
  readonly startTime: number;
  readonly timeoutMs: number;
  readonly gameName: string;
  readonly modelName: string;
  readonly clock: Clock;
  /**
   * If true, skip top-level retry wrapper.
   * Use for long-running phases where retry is applied internally to individual operations.
   */
  readonly skipRetry?: boolean;
}

/**
 * Result of a phase execution including the output and duration.
 */
interface PhaseResult<T> {
  readonly output: T;
  readonly durationMs: number;
}

/**
 * Runs a phase with timeout/cancellation support and standardized error handling.
 *
 * @param phaseName - Human-readable phase name (e.g., "Scout", "Editor")
 * @param errorCode - Error code to use if the phase fails
 * @param fn - Async function to execute
 * @param options - Timeout, signal, context, and retry options
 * @returns Phase result with output and duration
 *
 * @throws ArticleGenerationError with 'TIMEOUT' if timeout exceeded
 * @throws ArticleGenerationError with 'CANCELLED' if signal aborted
 * @throws ArticleGenerationError with provided errorCode for other failures
 */
async function runPhase<T>(
  phaseName: string,
  errorCode: ArticleGenerationErrorCode,
  fn: () => Promise<T>,
  options: RunPhaseOptions
): Promise<PhaseResult<T>> {
  const phaseStartTime = options.clock.now();

  // Optionally wrap with retry logic (skip for long-running phases with internal retry)
  const wrappedFn = options.skipRetry
    ? fn()
    : withRetry(fn, { context: `${phaseName} phase (model: ${options.modelName})` });

  try {
    const output = await withTimeoutAndCancellation(
      wrappedFn,
      options.signal,
      options.startTime,
      options.timeoutMs,
      options.gameName,
      phaseName,
      options.clock
    );

    return {
      output,
      durationMs: options.clock.now() - phaseStartTime,
    };
  } catch (error) {
    // Re-throw timeout/cancellation errors directly
    if (
      error instanceof ArticleGenerationError &&
      (error.code === 'TIMEOUT' || error.code === 'CANCELLED')
    ) {
      throw error;
    }

    throw new ArticleGenerationError(
      errorCode,
      `Article generation failed during ${phaseName} phase for "${options.gameName}" (model: ${options.modelName}): ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined
    );
  }
}

// ============================================================================
// Phase Execution Functions
// ============================================================================

/**
 * Base phase options without model name (added by each phase).
 */
interface BasePhaseOptions {
  readonly signal: AbortSignal | undefined;
  readonly startTime: number;
  readonly timeoutMs: number;
  readonly gameName: string;
  readonly clock: Clock;
}

/**
 * Context shared across all phase executions.
 */
interface PhaseContext {
  readonly context: GameArticleContext;
  readonly deps: ArticleGeneratorDeps;
  readonly basePhaseOptions: BasePhaseOptions;
  readonly log: ContextualLogger;
  readonly progressTracker: ProgressTracker;
  readonly phaseTimer: PhaseTimer;
  readonly temperatureOverrides?: TemperatureOverrides;
  /**
   * Target word count for the article.
   * If provided by context, used directly; otherwise category defaults apply after Editor phase.
   */
  readonly targetWordCount?: number;
  /**
   * Optional cleaning dependencies for content cleaning and caching.
   * When provided, search results are cleaned and cached in the database.
   */
  readonly cleaningDeps?: CleaningDeps;
}

/**
 * Executes the Scout phase: gathers research from multiple sources.
 */
async function executeScoutPhase(
  phaseContext: PhaseContext,
  scoutModel: string
): Promise<PhaseResult<ScoutOutput>> {
  const { context, deps, basePhaseOptions, log, progressTracker, phaseTimer, temperatureOverrides, cleaningDeps } = phaseContext;

  log.info(`Phase 1: Scout - Deep multi-query research (model: ${scoutModel})...`);
  progressTracker.startPhase('scout');
  phaseTimer.start('scout');

  const result = await runPhase(
    'Scout',
    'SCOUT_FAILED',
    () =>
      runScout(context, {
        search: deps.search,
        generateText: deps.generateText,
        generateObject: deps.generateObject,
        model: deps.openrouter(scoutModel),
        logger: createPrefixedLogger('[Scout]'),
        signal: basePhaseOptions.signal,
        temperature: temperatureOverrides?.scout,
        cleaningDeps,
      }),
    { ...basePhaseOptions, modelName: scoutModel }
  );

  phaseTimer.end('scout');
  log.info(
    `Scout (${scoutModel}) complete in ${result.durationMs}ms: ` +
      `${result.output.researchPool.allUrls.size} sources, ` +
      `${result.output.researchPool.queryCache.size} unique queries, ` +
      `confidence: ${result.output.confidence}`
  );
  progressTracker.completePhase('scout', `Found ${result.output.researchPool.allUrls.size} sources`);

  return result;
}

/**
 * Result from Editor phase including plan and token usage.
 */
interface EditorPhaseResult {
  readonly result: PhaseResult<EditorOutput>;
  readonly plan: ArticlePlan;
  readonly tokenUsage: TokenUsage;
}

/**
 * Executes the Editor phase: plans article structure and validates the plan.
 * Throws if plan validation fails.
 */
async function executeEditorPhase(
  phaseContext: PhaseContext,
  scoutOutput: ScoutOutput,
  editorModel: string
): Promise<EditorPhaseResult> {
  const { context, deps, basePhaseOptions, log, progressTracker, phaseTimer, temperatureOverrides, targetWordCount } = phaseContext;

  log.info(`Phase 2: Editor - Planning article (model: ${editorModel})...`);
  progressTracker.startPhase('editor');
  phaseTimer.start('editor');

  const result = await runPhase(
    'Editor',
    'EDITOR_FAILED',
    () =>
      runEditor(context, scoutOutput, {
        generateObject: deps.generateObject,
        model: deps.openrouter(editorModel),
        logger: createPrefixedLogger('[Editor]'),
        signal: basePhaseOptions.signal,
        temperature: temperatureOverrides?.editor,
        targetWordCount,
      }),
    { ...basePhaseOptions, modelName: editorModel }
  );

  phaseTimer.end('editor');
  const { plan, tokenUsage } = result.output;
  log.info(
    `Editor (${editorModel}) complete in ${result.durationMs}ms: ` +
      `${plan.categorySlug} article with ${plan.sections.length} sections`
  );
  progressTracker.completePhase('editor', `Planned ${plan.sections.length} sections`);

  // Validate plan structure before expensive Specialist phase
  const planIssues = validateArticlePlan(plan);
  const planErrors = getErrors(planIssues);
  const planWarnings = getWarnings(planIssues);

  if (planWarnings.length > 0) {
    log.warn(`Plan validation warnings: ${planWarnings.map((w) => w.message).join('; ')}`);
  }

  if (planErrors.length > 0) {
    log.error(`Plan validation errors: ${planErrors.map((e) => e.message).join('; ')}`);
    throw new ArticleGenerationError(
      'EDITOR_FAILED',
      `Article plan validation failed: ${planErrors.map((e) => e.message).join('; ')}`
    );
  }

  return { result, plan, tokenUsage };
}

/**
 * A plan that was rejected during validation, captured for debugging.
 */
interface RejectedPlanRecord {
  readonly plan: ArticlePlan;
  readonly validationErrors: readonly string[];
  readonly timestamp: string;
}

/**
 * Result from Editor phase with retry, including retry count.
 */
interface EditorPhaseWithRetryResult extends EditorPhaseResult {
  /** Number of retries performed (0 if succeeded on first attempt) */
  readonly planRetries: number;
  /** Total token usage including all retry attempts */
  readonly totalTokenUsage: TokenUsage;
  /** Plans that were rejected during validation (for comparison) */
  readonly rejectedPlans: readonly RejectedPlanRecord[];
}

/**
 * Executes the Editor phase with retry on validation failure.
 * Passes validation error messages as feedback on retry attempts.
 *
 * @param phaseContext - Shared phase context
 * @param scoutOutput - Research from Scout phase
 * @param editorModel - Model to use for Editor
 * @param maxRetries - Maximum retry attempts (default: FIXER_CONFIG.MAX_PLAN_RETRIES)
 * @returns Editor phase result with retry metadata
 */
async function executeEditorPhaseWithRetry(
  phaseContext: PhaseContext,
  scoutOutput: ScoutOutput,
  editorModel: string,
  maxRetries: number = FIXER_CONFIG.MAX_PLAN_RETRIES
): Promise<EditorPhaseWithRetryResult> {
  const { context, deps, basePhaseOptions, log, progressTracker, phaseTimer, temperatureOverrides, targetWordCount } = phaseContext;

  let lastErrors: string[] = [];
  let totalTokenUsage = createEmptyTokenUsage();
  let attempt = 0;
  const rejectedPlans: RejectedPlanRecord[] = [];

  while (attempt <= maxRetries) {
    const isRetry = attempt > 0;

    if (isRetry) {
      log.warn(`Editor phase retry ${attempt}/${maxRetries} with validation feedback...`);
    } else {
      log.info(`Phase 2: Editor - Planning article (model: ${editorModel})...`);
      progressTracker.startPhase('editor');
      phaseTimer.start('editor');
    }

    try {
      const result = await runPhase(
        'Editor',
        'EDITOR_FAILED',
        () =>
          runEditor(context, scoutOutput, {
            generateObject: deps.generateObject,
            model: deps.openrouter(editorModel),
            logger: createPrefixedLogger('[Editor]'),
            signal: basePhaseOptions.signal,
            temperature: temperatureOverrides?.editor,
            targetWordCount,
            validationFeedback: isRetry ? lastErrors : undefined,
          }),
        { ...basePhaseOptions, modelName: editorModel }
      );

      const { plan, tokenUsage } = result.output;
      totalTokenUsage = addTokenUsage(totalTokenUsage, tokenUsage);

      // Always end timer (includes retry time since timer started on first attempt)
      const editorDurationMs = phaseTimer.end('editor');

      // Report progress (user-visible completion message)
      if (!isRetry) {
        log.info(
          `Editor (${editorModel}) complete in ${editorDurationMs}ms: ` +
            `${plan.categorySlug} article with ${plan.sections.length} sections`
        );
      } else {
        log.info(
          `Editor (${editorModel}) complete in ${editorDurationMs}ms after ${attempt} retry(s): ` +
            `${plan.categorySlug} article with ${plan.sections.length} sections`
        );
      }
      progressTracker.completePhase('editor', `Planned ${plan.sections.length} sections`);

      // Validate plan structure before expensive Specialist phase
      const planIssues = validateArticlePlan(plan);
      const planErrors = getErrors(planIssues);
      const planWarnings = getWarnings(planIssues);

      if (planWarnings.length > 0) {
        log.warn(`Plan validation warnings: ${planWarnings.map((w) => w.message).join('; ')}`);
      }

      if (planErrors.length === 0) {
        // Success! Return with retry metadata
        return {
          result,
          plan,
          tokenUsage,
          planRetries: attempt,
          totalTokenUsage,
          rejectedPlans,
        };
      }

      // Validation failed - capture the rejected plan for debugging
      const errorMessages = planErrors.map((e) => e.message);
      rejectedPlans.push({
        plan,
        validationErrors: errorMessages,
        timestamp: new Date().toISOString(),
      });
      log.error(`Plan validation errors (attempt ${attempt + 1}): ${errorMessages.join('; ')}`);

      // Prepare for retry
      lastErrors = errorMessages;
      attempt++;
    } catch (error) {
      // If error is timeout/cancelled, don't retry
      if (
        error instanceof ArticleGenerationError &&
        (error.code === 'TIMEOUT' || error.code === 'CANCELLED')
      ) {
        throw error;
      }

      // Other errors during Editor phase - could be transient, try retry
      lastErrors = [error instanceof Error ? error.message : String(error)];
      log.error(`Editor phase error (attempt ${attempt + 1}): ${lastErrors[0]}`);
      attempt++;
    }
  }

  // Exhausted all retries
  throw new ArticleGenerationError(
    'EDITOR_FAILED',
    `Article plan validation failed after ${maxRetries} retries: ${lastErrors.join('; ')}`
  );
}

/**
 * Calculates the effective target word count for an article.
 * Uses the context-provided value if available, otherwise falls back to category defaults.
 *
 * @param contextWordCount - Word count from context (may be undefined)
 * @param categorySlug - The article category (determines default)
 * @returns Effective target word count, validated against constraints
 */
function getEffectiveWordCount(
  contextWordCount: number | undefined,
  categorySlug: ArticleCategorySlug
): number {
  // Use context-provided value if available, otherwise use category default
  const targetWordCount = contextWordCount ?? WORD_COUNT_DEFAULTS[categorySlug];

  // Clamp to valid range
  return Math.max(
    WORD_COUNT_CONSTRAINTS.MIN_WORD_COUNT,
    Math.min(WORD_COUNT_CONSTRAINTS.MAX_WORD_COUNT, targetWordCount)
  );
}

/**
 * Executes the Specialist phase: writes article sections based on plan.
 */
async function executeSpecialistPhase(
  phaseContext: PhaseContext,
  scoutOutput: ScoutOutput,
  plan: ArticlePlan,
  specialistModel: string,
  parallelSections: boolean,
  effectiveWordCount: number
): Promise<PhaseResult<SpecialistOutput>> {
  const { context, deps, basePhaseOptions, log, progressTracker, phaseTimer, temperatureOverrides, cleaningDeps } = phaseContext;

  const modeLabel = parallelSections ? 'parallel' : 'sequential';
  log.info(
    `Phase 3: Specialist - Batch research + section writing in ${modeLabel} mode (model: ${specialistModel})...`
  );
  log.info(`Target word count: ~${effectiveWordCount} words`);
  progressTracker.startPhase('specialist');
  phaseTimer.start('specialist');

  // Note: Specialist doesn't use top-level retry because it's a long operation.
  // Retry logic is applied to individual search/generateText calls inside the agent.
  const result = await runPhase(
    'Specialist',
    'SPECIALIST_FAILED',
    () =>
      runSpecialist(context, scoutOutput, plan, {
        search: deps.search,
        generateText: deps.generateText,
        model: deps.openrouter(specialistModel),
        logger: createPrefixedLogger('[Specialist]'),
        parallelSections,
        signal: basePhaseOptions.signal,
        temperature: temperatureOverrides?.specialist,
        targetWordCount: effectiveWordCount,
        cleaningDeps,
        onSectionProgress: (current, total, headline) => {
          // Delegate to ProgressTracker for consistent progress calculation
          progressTracker.reportSectionProgress(current, total, headline);
        },
      }),
    { ...basePhaseOptions, modelName: specialistModel, skipRetry: true }
  );

  phaseTimer.end('specialist');
  log.info(
    `Specialist (${specialistModel}) complete in ${result.durationMs}ms: ` +
      `${countContentH2Sections(result.output.markdown)} sections written, ${result.output.sources.length} total sources`
  );
  progressTracker.completePhase('specialist', `Wrote ${countContentH2Sections(result.output.markdown)} sections`);

  return result;
}

// ============================================================================
// Default Dependencies
// ============================================================================

function createDefaultDeps(): ArticleGeneratorDeps {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new ArticleGenerationError(
      'CONFIG_ERROR',
      'OPENROUTER_API_KEY environment variable is required'
    );
  }

  // Use dedicated OpenRouter provider for accurate cost tracking
  // providerMetadata.openrouter.usage.cost gives actual cost per call
  return {
    openrouter: createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
      // Optional: custom base URL for proxies (uncomment if needed)
      // baseUrl: process.env.OPENROUTER_BASE_URL,
    }),
    search: tavilySearch,
    generateText,
    generateObject,
  };
}

// ============================================================================
// Core Generator Function
// ============================================================================

/**
 * Generates a complete game article draft using the multi-agent system.
 * Articles are always generated in English.
 *
 * @param context - Game context including name, metadata, and optional instruction
 * @param deps - Optional dependencies for testing (defaults to production deps)
 * @param options - Optional configuration (progress callback, etc.)
 * @returns Complete article draft with markdown, sources, and metadata
 *
 * @throws ArticleGenerationError with code 'CONTEXT_INVALID' if context validation fails
 * @throws ArticleGenerationError with code 'SCOUT_FAILED' if research phase fails
 * @throws ArticleGenerationError with code 'EDITOR_FAILED' if planning phase fails
 * @throws ArticleGenerationError with code 'SPECIALIST_FAILED' if writing phase fails
 * @throws ArticleGenerationError with code 'VALIDATION_FAILED' if validation fails
 * @throws ArticleGenerationError with code 'TIMEOUT' if timeoutMs is exceeded
 * @throws ArticleGenerationError with code 'CANCELLED' if signal is aborted
 * @throws ArticleGenerationError with code 'CONFIG_ERROR' if OPENROUTER_API_KEY is not configured
 *
 * @example
 * // Production usage
 * const draft = await generateGameArticleDraft({
 *   gameName: 'The Legend of Zelda: Tears of the Kingdom',
 *   releaseDate: '2023-05-12',
 *   genres: ['Adventure', 'Action'],
 *   platforms: ['Nintendo Switch'],
 *   developer: 'Nintendo',
 *   instruction: 'Write a beginner guide for the first 5 hours.',
 * });
 *
 * @example
 * // Testing with mocked dependencies
 * const draft = await generateGameArticleDraft(context, {
 *   openrouter: mockOpenRouter,
 *   search: mockSearch,
 *   generateText: mockGenerateText,
 *   generateObject: mockGenerateObject,
 * });
 *
 * @example
 * // With progress callback
 * const draft = await generateGameArticleDraft(context, undefined, {
 *   onProgress: (phase, progress, message) => {
 *     console.log(`[${phase}] ${progress}%: ${message}`);
 *   },
 * });
 */
export async function generateGameArticleDraft(
  context: GameArticleContext,
  deps?: ArticleGeneratorDeps,
  options?: ArticleGeneratorOptions
): Promise<GameArticleDraft> {
  // Validate input context FIRST (before creating deps which may throw CONFIG_ERROR)
  // This ensures user gets CONTEXT_INVALID errors before CONFIG_ERROR
  const contextIssues = validateGameArticleContext(context);
  const contextErrors = getErrors(contextIssues);
  if (contextErrors.length > 0) {
    throw new ArticleGenerationError(
      'CONTEXT_INVALID',
      `Invalid article context: ${contextErrors.map((e) => e.message).join('; ')}`
    );
  }

  // Validate temperature overrides early (before expensive operations)
  validateTemperatureOverrides(options?.temperatureOverrides);

  // Use provided deps merged with defaults
  // This allows passing just { strapi } without replacing all deps
  const mergedDeps = { ...createDefaultDeps(), ...deps };
  const { openrouter, search, generateText: genText, generateObject: genObject, strapi } = mergedDeps;

  const scoutModel = getModel('ARTICLE_SCOUT');
  const editorModel = getModel('ARTICLE_EDITOR');
  const specialistModel = getModel('ARTICLE_SPECIALIST');
  const cleanerModel = getModel('ARTICLE_CLEANER');

  // Create contextual logger with correlation ID for tracing
  const correlationId = options?.correlationId ?? generateCorrelationId();
  const log = createContextualLogger('[ArticleGen]', {
    correlationId,
    gameName: context.gameName,
  });

  const progressTracker = new ProgressTracker(options?.onProgress);
  const phaseTimer = new PhaseTimer(options?.clock ?? systemClock);
  const timeoutMs = options?.timeoutMs ?? GENERATOR_CONFIG.DEFAULT_TIMEOUT_MS;
  const signal = options?.signal;
  const clock = options?.clock ?? systemClock;
  const temperatureOverrides = options?.temperatureOverrides;
  const totalStartTime = clock.now();

  // Base options for all phases (modelName added by each phase function)
  const basePhaseOptions: BasePhaseOptions = {
    signal,
    startTime: totalStartTime,
    timeoutMs,
    gameName: context.gameName,
    clock,
  };

  log.info(`=== Starting Multi-Agent Article Generation for "${context.gameName}" ===`);
  if (timeoutMs > 0) {
    log.info(`Timeout configured: ${timeoutMs}ms`);
  }
  if (temperatureOverrides) {
    log.info(`Temperature overrides: ${JSON.stringify(temperatureOverrides)}`);
  }

  // Build shared phase context
  const resolvedDeps: ArticleGeneratorDeps = {
    openrouter,
    search,
    generateText: genText,
    generateObject: genObject,
    strapi,
  };

  // Build cleaning deps only when Strapi is available
  // This enables content cleaning and caching for search results
  // Also fetch excluded domains from DB to combine with static list
  // Per-engine exclusions include scrape failure exclusions specific to each search engine
  let cleaningDeps: CleaningDeps | undefined;
  if (strapi) {
    // Fetch exclusions in parallel for efficiency
    const [excludedDomains, tavilyExcludedDomains, exaExcludedDomains] = await Promise.all([
      getAllExcludedDomains(strapi),
      getAllExcludedDomainsForEngine(strapi, 'tavily'),
      getAllExcludedDomainsForEngine(strapi, 'exa'),
    ]);
    cleaningDeps = {
      strapi,
      generateObject: genObject,
      model: openrouter(cleanerModel),
      logger: createPrefixedLogger('[Cleaner]'),
      signal,
      gameName: context.gameName,
      gameDocumentId: context.gameDocumentId,
      excludedDomains,
      tavilyExcludedDomains,
      exaExcludedDomains,
    };
    log.info(`Content cleaning enabled (model: ${cleanerModel})`);
    log.debug(`Excluded domains: ${excludedDomains.length} global, Tavily: ${tavilyExcludedDomains.length}, Exa: ${exaExcludedDomains.length}`);
  }

  const phaseContext: PhaseContext = {
    context,
    deps: resolvedDeps,
    basePhaseOptions,
    log,
    progressTracker,
    phaseTimer,
    temperatureOverrides,
    targetWordCount: context.targetWordCount,
    cleaningDeps,
  };

  // ===== PHASE 1: SCOUT =====
  const scoutResult = await executeScoutPhase(phaseContext, scoutModel);
  const scoutOutput = scoutResult.output;

  // ===== PHASE 2: EDITOR (with retry) =====
  const {
    result: editorResult,
    plan,
    tokenUsage: editorTokenUsage,
    planRetries,
    totalTokenUsage: editorTotalTokenUsage,
    rejectedPlans,
  } = await executeEditorPhaseWithRetry(phaseContext, scoutOutput, editorModel);

  // ===== PHASE 3: SPECIALIST =====
  // Use option override if provided, otherwise auto-decide based on category
  // (parallel for 'lists' category where sections are independent)
  const useParallelSections = options?.parallelSections ?? (plan.categorySlug === 'lists');

  // Calculate effective word count based on context or category defaults
  const effectiveWordCount = getEffectiveWordCount(context.targetWordCount, plan.categorySlug);

  const specialistResult = await executeSpecialistPhase(
    phaseContext,
    scoutOutput,
    plan,
    specialistModel,
    useParallelSections,
    effectiveWordCount
  );

  // Track markdown as mutable for Fixer phase
  let currentMarkdown = specialistResult.output.markdown;
  const { sources, researchPool: finalResearchPool, tokenUsage: specialistTokenUsage, sourceUsage: specialistSourceUsage } = specialistResult.output;

  // Recovery tracking
  const allFixesApplied: FixApplied[] = [];
  let fixerIterations = 0;
  let fixerTokenUsage = createEmptyTokenUsage();
  const sectionRetries: Record<string, number> = {}; // Track section-level retries (future use)

  // Capture original markdown before any Fixer modifications (for comparison)
  let originalMarkdownBeforeFixer: string | undefined;
  const markdownHistory: string[] = [];

  // ===== PHASE 4: REVIEWER + FIXER LOOP =====
  // Determine if reviewer should run:
  // 1. If enableReviewer is explicitly set, use that value (takes precedence)
  // 2. Otherwise, use default from REVIEWER_CONFIG.ENABLED_BY_CATEGORY based on article category
  const shouldRunReviewer =
    options?.enableReviewer !== undefined
      ? options.enableReviewer
      : REVIEWER_CONFIG.ENABLED_BY_CATEGORY[plan.categorySlug];
  const reviewerModel = getModel('ARTICLE_REVIEWER');

  let reviewerOutput: ReviewerOutput | undefined;
  let reviewerTokenUsage: TokenUsage = { input: 0, output: 0 };
  // Track all issues found across all iterations (not just final remaining issues)
  let initialReviewerIssues: ReviewerOutput['issues'] | undefined;

  if (shouldRunReviewer) {
    log.info(`Phase 4: Reviewer - Quality control check (model: ${reviewerModel})...`);
    progressTracker.startPhase('reviewer');
    phaseTimer.start('reviewer');

    // Build Fixer context (used if Fixer loop is needed)
    const fixerContext: FixerContext = {
      gameContext: context,
      scoutOutput,
      plan,
      enrichedPool: finalResearchPool,
    };

    const fixerDeps: FixerDeps = {
      generateText: resolvedDeps.generateText,
      generateObject: resolvedDeps.generateObject,
      model: resolvedDeps.openrouter(reviewerModel), // Reuse reviewer model for fixer
      logger: createPrefixedLogger('[Fixer]'),
      signal: basePhaseOptions.signal,
      temperature: FIXER_CONFIG.TEMPERATURE,
    };

    // Initial review
    // Note: Reviewer uses its own config temperature, NOT specialist override.
    // Reviewer should be consistent and analytical, not creative.
    let reviewerResult = await runPhase(
      'Reviewer',
      'VALIDATION_FAILED',
      () =>
        runReviewer(currentMarkdown, plan, scoutOutput, {
          generateObject: resolvedDeps.generateObject,
          model: resolvedDeps.openrouter(reviewerModel),
          logger: createPrefixedLogger('[Reviewer]'),
          signal: basePhaseOptions.signal,
          // Don't pass temperature override - let Reviewer use its default (REVIEWER_CONFIG.TEMPERATURE)
        }),
      { ...basePhaseOptions, modelName: reviewerModel }
    );

    reviewerOutput = reviewerResult.output;
    reviewerTokenUsage = addTokenUsage(reviewerTokenUsage, reviewerOutput.tokenUsage);
    // Capture initial issues before any fixes (for complete history in output)
    initialReviewerIssues = [...reviewerOutput.issues];

    const logIssueCounts = (issues: readonly { severity: string }[]) => {
      const critical = issues.filter((i) => i.severity === 'critical').length;
      const major = issues.filter((i) => i.severity === 'major').length;
      const minor = issues.filter((i) => i.severity === 'minor').length;
      return `${critical} critical, ${major} major, ${minor} minor`;
    };

    log.info(
      `Reviewer (${reviewerModel}) complete in ${reviewerResult.durationMs}ms: ` +
        `${reviewerOutput.approved ? 'APPROVED' : 'NEEDS ATTENTION'} ` +
        `(${logIssueCounts(reviewerOutput.issues)} issues)`
    );

    // ===== FIXER LOOP =====
    // Run Fixer if there are ANY actionable issues (even minor ones for quality polish)
    // This allows the article to go from 9/10 → 10/10, not just fix critical failures
    // Limited to MAX_FIXER_ITERATIONS (default: 2) to avoid infinite loops
    const actionableIssues = reviewerOutput.issues.filter((i) => i.fixStrategy !== 'no_action');

    // Capture original markdown before any fixes (if we have improvements to make)
    if (actionableIssues.length > 0) {
      originalMarkdownBeforeFixer = currentMarkdown;
    }

    // Helper to count critical issues
    const countCritical = (issues: readonly { severity: string }[]) =>
      issues.filter((i) => i.severity === 'critical').length;

    // Helper to run a fix iteration
    const runFixIteration = async (issuesToFix: typeof reviewerOutput.issues) => {
      const fixerResult = await runFixer(
        currentMarkdown,
        issuesToFix,
        fixerContext,
        fixerDeps,
        fixerIterations
      );

      currentMarkdown = fixerResult.markdown;
      allFixesApplied.push(...fixerResult.fixesApplied);
      fixerTokenUsage = addTokenUsage(fixerTokenUsage, fixerResult.tokenUsage);
      markdownHistory.push(currentMarkdown);

      return fixerResult;
    };

    // Helper to re-review
    const reReview = async () => {
      log.info('Re-reviewing article after fixes...');
      reviewerResult = await runPhase(
        'Reviewer',
        'VALIDATION_FAILED',
        () =>
          runReviewer(currentMarkdown, plan, scoutOutput, {
            generateObject: resolvedDeps.generateObject,
            model: resolvedDeps.openrouter(reviewerModel),
            logger: createPrefixedLogger('[Reviewer]'),
            signal: basePhaseOptions.signal,
          }),
        { ...basePhaseOptions, modelName: reviewerModel }
      );

      reviewerOutput = reviewerResult.output;
      reviewerTokenUsage = addTokenUsage(reviewerTokenUsage, reviewerOutput.tokenUsage);

      log.info(
        `Re-review complete: ${reviewerOutput.approved ? 'APPROVED' : 'NEEDS ATTENTION'} ` +
          `(${logIssueCounts(reviewerOutput.issues)} issues)`
      );

      // Update actionable issues
      actionableIssues.length = 0;
      actionableIssues.push(...reviewerOutput.issues.filter((i) => i.fixStrategy !== 'no_action'));
    };

    // PHASE 1: Fix all issues (up to MAX_FIXER_ITERATIONS)
    // Stop early if article is APPROVED - don't risk introducing regressions
    while (
      !reviewerOutput.approved &&
      actionableIssues.length > 0 &&
      fixerIterations < FIXER_CONFIG.MAX_FIXER_ITERATIONS
    ) {
      fixerIterations++;
      log.info(`Fixer iteration ${fixerIterations}/${FIXER_CONFIG.MAX_FIXER_ITERATIONS}...`);

      const fixerResult = await runFixIteration(reviewerOutput.issues);
      const successfulFixes = fixerResult.fixesApplied.filter((f) => f.success).length;
      log.info(
        `Fixer iteration ${fixerIterations}: ${successfulFixes}/${fixerResult.fixesApplied.length} fixes applied`
      );

      if (successfulFixes > 0) {
        await reReview();
      } else {
        log.warn('No fixes were successful, stopping Fixer loop');
        break;
      }
    }

    // PHASE 2: Continue fixing ONLY critical issues (up to MAX_CRITICAL_FIX_ITERATIONS total)
    let criticalIssues = reviewerOutput.issues.filter((i) => i.severity === 'critical');
    
    while (
      criticalIssues.length > 0 &&
      fixerIterations < FIXER_CONFIG.MAX_CRITICAL_FIX_ITERATIONS
    ) {
      fixerIterations++;
      log.info(
        `Critical fix iteration ${fixerIterations}/${FIXER_CONFIG.MAX_CRITICAL_FIX_ITERATIONS} ` +
          `(${criticalIssues.length} critical issues remaining)...`
      );

      const fixerResult = await runFixIteration(criticalIssues);
      const successfulFixes = fixerResult.fixesApplied.filter((f) => f.success).length;
      log.info(
        `Critical fix iteration ${fixerIterations}: ${successfulFixes}/${fixerResult.fixesApplied.length} fixes applied`
      );

      if (successfulFixes > 0) {
        await reReview();
        criticalIssues = reviewerOutput.issues.filter((i) => i.severity === 'critical');
      } else {
        log.warn('No critical fixes were successful, stopping');
        break;
      }
    }

    // Final warning if critical issues remain
    if (countCritical(reviewerOutput.issues) > 0) {
      log.warn(
        `⚠️ ${countCritical(reviewerOutput.issues)} critical issue(s) remain after ${fixerIterations} iterations!`
      );
    }

    phaseTimer.end('reviewer');

    if (fixerIterations > 0) {
      const opsSucceeded = allFixesApplied.filter((f) => f.success).length;
      const beforeCounts = initialReviewerIssues
        ? `${initialReviewerIssues.filter((i) => i.severity === 'critical').length}C/${initialReviewerIssues.filter((i) => i.severity === 'major').length}M`
        : '?';
      const afterCounts = reviewerOutput
        ? `${reviewerOutput.issues.filter((i) => i.severity === 'critical').length}C/${reviewerOutput.issues.filter((i) => i.severity === 'major').length}M`
        : '?';
      log.info(
        `Fixer complete: ${fixerIterations} iteration(s), ${allFixesApplied.length} operations ` +
          `(${opsSucceeded} succeeded). Issues: ${beforeCounts} → ${afterCounts} (critical/major)`
      );
    }

    progressTracker.completePhase(
      'reviewer',
      reviewerOutput.approved
        ? 'Approved'
        : `${fixerIterations} fix iterations, ${reviewerOutput.issues.length} remaining issues`
    );
  } else {
    log.debug('Reviewer phase skipped (not enabled for this article type)');
    phaseTimer.start('reviewer');
    phaseTimer.end('reviewer'); // Record 0 duration
  }

  // ===== PHASE 5: VALIDATION =====
  log.info('Phase 5: Validation - Checking content quality...');
  progressTracker.startPhase('validation');
  phaseTimer.start('validation');

  const draft = {
    title: plan.title,
    categorySlug: plan.categorySlug,
    excerpt: plan.excerpt,
    tags: plan.tags,
    markdown: currentMarkdown,
    sources,
    plan,
  };

  // Pass gameName to enable SEO validation (game name in title, keyword density, etc.)
  const validationIssues = validateArticleDraft(draft, context.gameName);
  const errors = getErrors(validationIssues);
  const warnings = getWarnings(validationIssues);

  phaseTimer.end('validation');

  if (warnings.length > 0) {
    log.warn(`Article validation warnings: ${warnings.map((w) => w.message).join('; ')}`);
  }

  if (errors.length > 0) {
    log.error(`Article validation errors: ${errors.map((e) => e.message).join('; ')}`);
    throw new ArticleGenerationError(
      'VALIDATION_FAILED',
      `Article validation failed: ${errors.map((e) => e.message).join('; ')}`
    );
  }

  const totalDurationMs = clock.now() - totalStartTime;
  log.info(`=== Article Generation Complete in ${totalDurationMs}ms ===`);
  log.info(
    `Final research pool: ${finalResearchPool.queryCache.size} total queries, ` +
      `${finalResearchPool.allUrls.size} unique sources`
  );
  progressTracker.completePhase('validation', 'Article validated successfully');

  // Aggregate token usage from all phases (use total editor usage for retries)
  const scoutTokenUsage = scoutOutput.tokenUsage;
  const cleanerTokenUsage = scoutOutput.cleaningTokenUsage;
  let totalTokenUsage = addTokenUsage(
    addTokenUsage(scoutTokenUsage, editorTotalTokenUsage),
    specialistTokenUsage
  );

  // Add reviewer token usage if available (includes Fixer re-reviews)
  if (shouldRunReviewer && reviewerTokenUsage) {
    totalTokenUsage = addTokenUsage(totalTokenUsage, reviewerTokenUsage);
  }

  // Add fixer token usage if any fixes were applied
  if (fixerTokenUsage.input > 0 || fixerTokenUsage.output > 0) {
    totalTokenUsage = addTokenUsage(totalTokenUsage, fixerTokenUsage);
  }

  // Add cleaner token usage if content was cleaned
  if (cleanerTokenUsage && (cleanerTokenUsage.input > 0 || cleanerTokenUsage.output > 0)) {
    totalTokenUsage = addTokenUsage(totalTokenUsage, cleanerTokenUsage);
  }

  // Check if any tokens were reported (some APIs may not report usage)
  const hasTokenUsage = totalTokenUsage.input > 0 || totalTokenUsage.output > 0;

  // Get actual LLM cost from OpenRouter (aggregated via addTokenUsage)
  // This is the real cost from providerMetadata.openrouter.usage.cost
  const actualCostUsd = totalTokenUsage.actualCostUsd;

  if (actualCostUsd !== undefined) {
    log.info(`Actual LLM generation cost: $${actualCostUsd.toFixed(4)} USD (from OpenRouter)`);
  } else if (hasTokenUsage) {
    log.warn('No actual cost data from OpenRouter - cost tracking may be incomplete');
  }

  // Log cleaning costs separately for visibility
  if (cleanerTokenUsage && cleanerTokenUsage.actualCostUsd !== undefined) {
    log.info(`Content cleaning cost: $${cleanerTokenUsage.actualCostUsd.toFixed(4)} USD`);
  }

  const tokenUsage: AggregatedTokenUsage | undefined = hasTokenUsage
    ? {
        scout: scoutTokenUsage,
        editor: editorTotalTokenUsage,
        specialist: specialistTokenUsage,
        ...(shouldRunReviewer ? { reviewer: reviewerTokenUsage } : {}),
        ...(cleanerTokenUsage && (cleanerTokenUsage.input > 0 || cleanerTokenUsage.output > 0)
          ? { cleaner: cleanerTokenUsage }
          : {}),
        total: totalTokenUsage,
        actualCostUsd,
        // Keep estimatedCostUsd for backwards compatibility (deprecated)
        estimatedCostUsd: actualCostUsd,
      }
    : undefined;

  // Helper to count issues by severity
  const countBySeverity = (issues: readonly { severity: string }[]): FixerOutcomeMetrics['issuesBefore'] => ({
    critical: issues.filter((i) => i.severity === 'critical').length,
    major: issues.filter((i) => i.severity === 'major').length,
    minor: issues.filter((i) => i.severity === 'minor').length,
    total: issues.length,
  });

  // Build outcome metrics if fixer ran
  const buildOutcomeMetrics = (): FixerOutcomeMetrics | undefined => {
    if (fixerIterations === 0 || !initialReviewerIssues || !reviewerOutput) {
      return undefined;
    }

    const issuesBefore = countBySeverity(initialReviewerIssues);
    const issuesAfter = countBySeverity(reviewerOutput.issues);
    const netChange = {
      critical: issuesAfter.critical - issuesBefore.critical,
      major: issuesAfter.major - issuesBefore.major,
      minor: issuesAfter.minor - issuesBefore.minor,
      total: issuesAfter.total - issuesBefore.total,
    };

    return {
      operationsAttempted: allFixesApplied.length,
      operationsSucceeded: allFixesApplied.filter((f) => f.success).length,
      issuesBefore,
      issuesAfter,
      netChange,
      reviewerApproved: reviewerOutput.approved,
      note:
        'Operations count markdown changes, not issues resolved. ' +
        'Reviewer may identify new issues after each fix, causing issue drift.',
    };
  };

  // Build recovery metadata if any retries or fixes were applied
  const hasRecovery = planRetries > 0 || fixerIterations > 0 || Object.keys(sectionRetries).length > 0;
  const outcomeMetrics = buildOutcomeMetrics();
  const recovery: RecoveryMetadata | undefined = hasRecovery
    ? {
        planRetries,
        sectionRetries,
        fixerIterations,
        fixesApplied: allFixesApplied,
        // Include rejected plans for comparison (only if there were plan retries)
        ...(rejectedPlans.length > 0 ? { rejectedPlans } : {}),
        // Include original markdown before Fixer (only if Fixer was applied)
        ...(originalMarkdownBeforeFixer ? { originalMarkdown: originalMarkdownBeforeFixer } : {}),
        // Include markdown history if multiple Fixer iterations (for incremental comparison)
        ...(markdownHistory.length > 1 ? { markdownHistory } : {}),
        // Include honest outcome metrics
        ...(outcomeMetrics ? { outcomeMetrics } : {}),
      }
    : undefined;

  // ===== AGGREGATE SEARCH API COSTS =====
  const specialistSearchCosts = specialistResult.output.searchApiCosts;
  const searchApiCosts: SearchApiCosts = {
    totalUsd: scoutOutput.searchApiCosts.totalUsd + specialistSearchCosts.totalUsd,
    exaSearchCount:
      scoutOutput.searchApiCosts.exaSearchCount + specialistSearchCosts.exaSearchCount,
    tavilySearchCount:
      scoutOutput.searchApiCosts.tavilySearchCount + specialistSearchCosts.tavilySearchCount,
    exaCostUsd: scoutOutput.searchApiCosts.exaCostUsd + specialistSearchCosts.exaCostUsd,
    tavilyCostUsd:
      scoutOutput.searchApiCosts.tavilyCostUsd + specialistSearchCosts.tavilyCostUsd,
    tavilyCredits:
      scoutOutput.searchApiCosts.tavilyCredits + specialistSearchCosts.tavilyCredits,
  };

  // Calculate total cost (LLM + Search APIs)
  // Use actual cost from OpenRouter when available
  const llmCostUsd = tokenUsage?.actualCostUsd ?? 0;
  const totalEstimatedCostUsd = llmCostUsd + searchApiCosts.totalUsd;

  // Build source content usage tracking (Scout + Specialist phases)
  const scoutSourceUsage = extractScoutSourceUsage(scoutOutput.researchPool);
  const sourceContentUsage: SourceContentUsage = addSourceUsage(
    addSourceUsage(createEmptySourceContentUsage(), scoutSourceUsage),
    specialistSourceUsage
  );

  // Merge filtered sources from Scout and Specialist phases, adding phase info
  const allFilteredSources = [
    ...scoutOutput.filteredSources.map(s => ({ ...s, phase: 'scout' as const })),
    ...specialistResult.output.filteredSources.map(s => ({ ...s, phase: 'specialist' as const })),
  ];

  // Build immutable metadata for debugging and analytics
  const metadata: ArticleGenerationMetadata = {
    generatedAt: new Date().toISOString(),
    totalDurationMs,
    phaseDurations: phaseTimer.getDurations(),
    queriesExecuted: finalResearchPool.queryCache.size,
    sourcesCollected: finalResearchPool.allUrls.size,
    tokenUsage,
    searchApiCosts,
    totalEstimatedCostUsd,
    sourceContentUsage,
    correlationId,
    researchConfidence: scoutOutput.confidence,
    ...(recovery ? { recovery } : {}),
    // Include filtered sources from both Scout and Specialist phases
    ...(allFilteredSources.length > 0
      ? { filteredSources: allFilteredSources }
      : {}),
    // Include duplicate tracking from Scout phase
    ...(scoutOutput.duplicatedUrls && scoutOutput.duplicatedUrls.length > 0
      ? { duplicatedUrls: scoutOutput.duplicatedUrls }
      : {}),
    ...(scoutOutput.queryStats && scoutOutput.queryStats.length > 0
      ? { queryStats: scoutOutput.queryStats }
      : {}),
  };

  return {
    ...draft,
    models: {
      scout: scoutModel,
      editor: editorModel,
      specialist: specialistModel,
      ...(shouldRunReviewer ? { reviewer: reviewerModel } : {}),
    },
    metadata,
    ...(shouldRunReviewer && reviewerOutput
      ? {
          reviewerIssues: reviewerOutput.issues, // Final remaining issues after all fixes
          reviewerApproved: reviewerOutput.approved,
          // Include initial issues if different from final (i.e., some were fixed)
          ...(initialReviewerIssues &&
          initialReviewerIssues.length !== reviewerOutput.issues.length
            ? { reviewerInitialIssues: initialReviewerIssues }
            : {}),
        }
      : {}),
  };
}
