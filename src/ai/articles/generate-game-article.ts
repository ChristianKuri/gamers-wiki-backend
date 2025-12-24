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

import { createOpenAI } from '@ai-sdk/openai';
import { generateObject, generateText } from 'ai';

import { getModel } from '../config';
import { tavilySearch } from '../tools/tavily';
import { createPrefixedLogger, type Logger } from '../../utils/logger';
import { runScout, runEditor, runSpecialist, type EditorOutput } from './agents';
import type { SpecialistOutput } from './agents/specialist';
import type { ArticlePlan } from './article-plan';
import { GENERATOR_CONFIG } from './config';
import { countContentH2Sections } from './markdown-utils';
import { withRetry } from './retry';
import {
  addTokenUsage,
  ArticleGenerationError,
  systemClock,
  type AggregatedTokenUsage,
  type ArticleGenerationErrorCode,
  type ArticleGenerationMetadata,
  type ArticleProgressCallback,
  type Clock,
  type GameArticleContext,
  type GameArticleDraft,
  type ScoutOutput,
  type TokenUsage,
} from './types';
import { ProgressTracker } from './progress-tracker';
import { validateArticleDraft, validateArticlePlan, validateGameArticleContext, getErrors, getWarnings } from './validation';

// ============================================================================
// Dependencies Interface
// ============================================================================

/**
 * Dependencies for article generation (enables testing with mocks).
 */
export interface ArticleGeneratorDeps {
  readonly openrouter: ReturnType<typeof createOpenAI>;
  readonly search: typeof tavilySearch;
  readonly generateText: typeof generateText;
  readonly generateObject: typeof generateObject;
}

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
  readonly log: Logger;
  readonly progressTracker: ProgressTracker;
  readonly temperatureOverrides?: TemperatureOverrides;
}

/**
 * Executes the Scout phase: gathers research from multiple sources.
 */
async function executeScoutPhase(
  phaseContext: PhaseContext,
  scoutModel: string
): Promise<PhaseResult<ScoutOutput>> {
  const { context, deps, basePhaseOptions, log, progressTracker, temperatureOverrides } = phaseContext;

  log.info(`Phase 1: Scout - Deep multi-query research (model: ${scoutModel})...`);
  progressTracker.startPhase('scout');

  const result = await runPhase(
    'Scout',
    'SCOUT_FAILED',
    () =>
      runScout(context, {
        search: deps.search,
        generateText: deps.generateText,
        model: deps.openrouter(scoutModel),
        logger: createPrefixedLogger('[Scout]'),
        signal: basePhaseOptions.signal,
        temperature: temperatureOverrides?.scout,
      }),
    { ...basePhaseOptions, modelName: scoutModel }
  );

  log.info(
    `Scout (${scoutModel}) complete in ${result.durationMs}ms: ` +
      `${result.output.researchPool.allUrls.size} sources, ` +
      `${result.output.researchPool.queryCache.size} unique queries`
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
  const { context, deps, basePhaseOptions, log, progressTracker, temperatureOverrides } = phaseContext;

  log.info(`Phase 2: Editor - Planning article (model: ${editorModel})...`);
  progressTracker.startPhase('editor');

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
      }),
    { ...basePhaseOptions, modelName: editorModel }
  );

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
 * Executes the Specialist phase: writes article sections based on plan.
 */
async function executeSpecialistPhase(
  phaseContext: PhaseContext,
  scoutOutput: ScoutOutput,
  plan: ArticlePlan,
  specialistModel: string,
  parallelSections: boolean
): Promise<PhaseResult<SpecialistOutput>> {
  const { context, deps, basePhaseOptions, log, progressTracker, temperatureOverrides } = phaseContext;

  const modeLabel = parallelSections ? 'parallel' : 'sequential';
  log.info(
    `Phase 3: Specialist - Batch research + section writing in ${modeLabel} mode (model: ${specialistModel})...`
  );
  progressTracker.startPhase('specialist');

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
        onSectionProgress: (current, total, headline) => {
          // Delegate to ProgressTracker for consistent progress calculation
          progressTracker.reportSectionProgress(current, total, headline);
        },
      }),
    { ...basePhaseOptions, modelName: specialistModel, skipRetry: true }
  );

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

  // Support configurable base URL for proxies or alternative endpoints
  const baseURL = process.env.OPENROUTER_BASE_URL ?? GENERATOR_CONFIG.DEFAULT_OPENROUTER_BASE_URL;

  return {
    openrouter: createOpenAI({
      baseURL,
      apiKey: process.env.OPENROUTER_API_KEY,
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

  // Use provided deps or create default production deps
  const { openrouter, search, generateText: genText, generateObject: genObject } =
    deps ?? createDefaultDeps();

  const scoutModel = getModel('ARTICLE_SCOUT');
  const editorModel = getModel('ARTICLE_EDITOR');
  const specialistModel = getModel('ARTICLE_SPECIALIST');

  const log = createPrefixedLogger('[ArticleGen]');
  const progressTracker = new ProgressTracker(options?.onProgress);
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
  };

  const phaseContext: PhaseContext = {
    context,
    deps: resolvedDeps,
    basePhaseOptions,
    log,
    progressTracker,
    temperatureOverrides,
  };

  // ===== PHASE 1: SCOUT =====
  const scoutResult = await executeScoutPhase(phaseContext, scoutModel);
  const scoutOutput = scoutResult.output;

  // ===== PHASE 2: EDITOR =====
  const { result: editorResult, plan, tokenUsage: editorTokenUsage } = await executeEditorPhase(
    phaseContext,
    scoutOutput,
    editorModel
  );

  // ===== PHASE 3: SPECIALIST =====
  // Use option override if provided, otherwise auto-decide based on category
  // (parallel for 'lists' category where sections are independent)
  const useParallelSections = options?.parallelSections ?? (plan.categorySlug === 'lists');
  const specialistResult = await executeSpecialistPhase(
    phaseContext,
    scoutOutput,
    plan,
    specialistModel,
    useParallelSections
  );

  const { markdown, sources, researchPool: finalResearchPool, tokenUsage: specialistTokenUsage } = specialistResult.output;

  // ===== PHASE 4: VALIDATION =====
  const validationStartTime = clock.now();
  log.info('Phase 4: Validation - Checking content quality...');
  progressTracker.startPhase('validation');

  const draft = {
    title: plan.title,
    categorySlug: plan.categorySlug,
    excerpt: plan.excerpt,
    tags: plan.tags,
    markdown,
    sources,
    plan,
  };

  const validationIssues = validateArticleDraft(draft);
  const errors = getErrors(validationIssues);
  const warnings = getWarnings(validationIssues);

  const validationDurationMs = clock.now() - validationStartTime;

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

  // Aggregate token usage from all phases
  const scoutTokenUsage = scoutOutput.tokenUsage;
  const totalTokenUsage = addTokenUsage(
    addTokenUsage(scoutTokenUsage, editorTokenUsage),
    specialistTokenUsage
  );

  // Check if any tokens were reported (some APIs may not report usage)
  const hasTokenUsage = totalTokenUsage.input > 0 || totalTokenUsage.output > 0;

  const tokenUsage: AggregatedTokenUsage | undefined = hasTokenUsage
    ? {
        scout: scoutTokenUsage,
        editor: editorTokenUsage,
        specialist: specialistTokenUsage,
        total: totalTokenUsage,
      }
    : undefined;

  // Build immutable metadata for debugging and analytics
  const metadata: ArticleGenerationMetadata = {
    generatedAt: new Date().toISOString(),
    totalDurationMs,
    phaseDurations: {
      scout: scoutResult.durationMs,
      editor: editorResult.durationMs,
      specialist: specialistResult.durationMs,
      validation: validationDurationMs,
    },
    queriesExecuted: finalResearchPool.queryCache.size,
    sourcesCollected: finalResearchPool.allUrls.size,
    tokenUsage,
  };

  return {
    ...draft,
    models: {
      scout: scoutModel,
      editor: editorModel,
      specialist: specialistModel,
    },
    metadata,
  };
}
