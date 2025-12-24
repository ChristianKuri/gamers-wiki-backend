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
import { createPrefixedLogger } from '../../utils/logger';
import { runScout, runEditor, runSpecialist } from './agents';
import { countContentH2Sections } from './markdown-utils';
import { withRetry } from './retry';
import {
  ArticleGenerationError,
  type ArticleGenerationErrorCode,
  type ArticleGenerationMetadata,
  type ArticleProgressCallback,
  type GameArticleContext,
  type GameArticleDraft,
} from './types';
import { validateArticleDraft, validateGameArticleContext, getErrors, getWarnings } from './validation';

import { GENERATOR_CONFIG } from './config';

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
 * @throws ArticleGenerationError with 'CANCELLED' if signal is aborted
 * @throws ArticleGenerationError with 'TIMEOUT' if timeout exceeded
 */
function assertCanProceed(
  userSignal: AbortSignal | undefined,
  startTime: number,
  timeoutMs: number,
  gameName: string
): void {
  if (userSignal?.aborted) {
    throw new ArticleGenerationError(
      'CANCELLED',
      `Article generation for "${gameName}" was cancelled`
    );
  }
  if (timeoutMs > 0 && Date.now() - startTime > timeoutMs) {
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
 * @returns The resolved value or throws ArticleGenerationError
 */
async function withTimeoutAndCancellation<T>(
  promise: Promise<T>,
  userSignal: AbortSignal | undefined,
  startTime: number,
  timeoutMs: number,
  gameName: string,
  phaseName: string
): Promise<T> {
  // Pre-check: verify we can proceed before setting up race
  assertCanProceed(userSignal, startTime, timeoutMs, gameName);

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
      const remaining = Math.max(0, timeoutMs - (Date.now() - startTime));
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
  const phaseStartTime = Date.now();

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
      phaseName
    );

    return {
      output,
      durationMs: Date.now() - phaseStartTime,
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
  // Use provided deps or create default production deps
  const { openrouter, search, generateText: genText, generateObject: genObject } =
    deps ?? createDefaultDeps();

  // Validate input context
  const contextIssues = validateGameArticleContext(context);
  const contextErrors = getErrors(contextIssues);
  if (contextErrors.length > 0) {
    throw new ArticleGenerationError(
      'CONTEXT_INVALID',
      `Invalid article context: ${contextErrors.map((e) => e.message).join('; ')}`
    );
  }

  const scoutModel = getModel('ARTICLE_SCOUT');
  const editorModel = getModel('ARTICLE_EDITOR');
  const specialistModel = getModel('ARTICLE_SPECIALIST');

  const log = createPrefixedLogger('[ArticleGen]');
  const onProgress = options?.onProgress;
  const timeoutMs = options?.timeoutMs ?? GENERATOR_CONFIG.DEFAULT_TIMEOUT_MS;
  const signal = options?.signal;
  const totalStartTime = Date.now();

  // Shared options for all phases
  const phaseOptions = {
    signal,
    startTime: totalStartTime,
    timeoutMs,
    gameName: context.gameName,
  };

  log.info(`=== Starting Multi-Agent Article Generation for "${context.gameName}" ===`);
  if (timeoutMs > 0) {
    log.info(`Timeout configured: ${timeoutMs}ms`);
  }

  // ===== PHASE 1: SCOUT =====
  log.info(`Phase 1: Scout - Deep multi-query research (model: ${scoutModel})...`);
  onProgress?.('scout', 0, 'Starting research phase');

  const scoutResult = await runPhase(
    'Scout',
    'SCOUT_FAILED',
    () =>
      runScout(context, {
        search,
        generateText: genText,
        model: openrouter(scoutModel),
        logger: createPrefixedLogger('[Scout]'),
        signal,
      }),
    { ...phaseOptions, modelName: scoutModel }
  );

  const scoutOutput = scoutResult.output;
  log.info(
    `Scout (${scoutModel}) complete in ${scoutResult.durationMs}ms: ` +
      `${scoutOutput.researchPool.allUrls.size} sources, ` +
      `${scoutOutput.researchPool.queryCache.size} unique queries`
  );
  onProgress?.('scout', 100, `Found ${scoutOutput.researchPool.allUrls.size} sources`);

  // ===== PHASE 2: EDITOR =====
  log.info(`Phase 2: Editor - Planning article (model: ${editorModel})...`);
  onProgress?.('editor', 0, 'Planning article structure');

  const editorResult = await runPhase(
    'Editor',
    'EDITOR_FAILED',
    () =>
      runEditor(context, scoutOutput, {
        generateObject: genObject,
        model: openrouter(editorModel),
        logger: createPrefixedLogger('[Editor]'),
        signal,
      }),
    { ...phaseOptions, modelName: editorModel }
  );

  const plan = editorResult.output;
  log.info(
    `Editor (${editorModel}) complete in ${editorResult.durationMs}ms: ` +
      `${plan.categorySlug} article with ${plan.sections.length} sections`
  );
  onProgress?.('editor', 100, `Planned ${plan.sections.length} sections`);

  // ===== PHASE 3: SPECIALIST =====
  // Use option override if provided, otherwise auto-decide based on category
  // (parallel for 'lists' category where sections are independent)
  const useParallelSections = options?.parallelSections ?? (plan.categorySlug === 'lists');
  const modeLabel = useParallelSections ? 'parallel' : 'sequential';
  log.info(
    `Phase 3: Specialist - Batch research + section writing in ${modeLabel} mode (model: ${specialistModel})...`
  );
  onProgress?.('specialist', 0, 'Writing article sections');

  // Note: Specialist doesn't use top-level retry because it's a long operation.
  // Retry logic is applied to individual search/generateText calls inside the agent.
  const specialistResult = await runPhase(
    'Specialist',
    'SPECIALIST_FAILED',
    () =>
      runSpecialist(context, scoutOutput, plan, {
        search,
        generateText: genText,
        model: openrouter(specialistModel),
        logger: createPrefixedLogger('[Specialist]'),
        parallelSections: useParallelSections,
        signal,
        onSectionProgress: (current, total, headline) => {
          // Report granular progress during section writing
          const { SPECIALIST_PROGRESS_START, SPECIALIST_PROGRESS_END } = GENERATOR_CONFIG;
          const progressRange = SPECIALIST_PROGRESS_END - SPECIALIST_PROGRESS_START;
          const sectionProgress = Math.round(SPECIALIST_PROGRESS_START + (current / total) * progressRange);
          onProgress?.('specialist', sectionProgress, `Writing section ${current}/${total}: ${headline}`);
        },
      }),
    { ...phaseOptions, modelName: specialistModel, skipRetry: true }
  );

  const { markdown, sources, researchPool: finalResearchPool } = specialistResult.output;
  log.info(
    `Specialist (${specialistModel}) complete in ${specialistResult.durationMs}ms: ` +
      `${countContentH2Sections(markdown)} sections written, ${sources.length} total sources`
  );
  onProgress?.('specialist', 100, `Wrote ${countContentH2Sections(markdown)} sections`);

  // ===== PHASE 4: VALIDATION =====
  const validationStartTime = Date.now();
  log.info('Phase 4: Validation - Checking content quality...');
  onProgress?.('validation', 0, 'Validating article quality');

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

  const validationDurationMs = Date.now() - validationStartTime;

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

  const totalDurationMs = Date.now() - totalStartTime;
  log.info(`=== Article Generation Complete in ${totalDurationMs}ms ===`);
  log.info(
    `Final research pool: ${finalResearchPool.queryCache.size} total queries, ` +
      `${finalResearchPool.allUrls.size} unique sources`
  );
  onProgress?.('validation', 100, 'Article validated successfully');

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
