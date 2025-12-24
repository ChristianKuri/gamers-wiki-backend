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
}

// ============================================================================
// Default Dependencies
// ============================================================================

// ============================================================================
// Timeout and Cancellation Helpers
// ============================================================================

/**
 * Checks if the operation should be cancelled due to timeout or AbortSignal.
 * @throws ArticleGenerationError if cancelled or timed out
 */
function checkCancellation(
  signal: AbortSignal | undefined,
  startTime: number,
  timeoutMs: number,
  gameName: string
): void {
  if (signal?.aborted) {
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
 * Wraps a promise with timeout and cancellation support.
 */
async function withTimeoutAndCancellation<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  startTime: number,
  timeoutMs: number,
  gameName: string,
  phaseName: string
): Promise<T> {
  // Check before starting
  checkCancellation(signal, startTime, timeoutMs, gameName);

  if (!signal && timeoutMs <= 0) {
    // No timeout or cancellation needed
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const cleanup = () => {
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      if (settled) return;
      cleanup();
      reject(
        new ArticleGenerationError(
          'CANCELLED',
          `Article generation for "${gameName}" was cancelled during ${phaseName} phase`
        )
      );
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    // Calculate remaining time for timeout
    if (timeoutMs > 0) {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, timeoutMs - elapsed);

      if (remaining <= 0) {
        cleanup();
        reject(
          new ArticleGenerationError(
            'TIMEOUT',
            `Article generation for "${gameName}" timed out during ${phaseName} phase`
          )
        );
        return;
      }

      timeoutId = setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(
          new ArticleGenerationError(
            'TIMEOUT',
            `Article generation for "${gameName}" timed out during ${phaseName} phase after ${timeoutMs}ms`
          )
        );
      }, remaining);
    }

    promise
      .then((result) => {
        if (settled) return;
        cleanup();
        resolve(result);
      })
      .catch((error) => {
        if (settled) return;
        cleanup();
        reject(error);
      });
  });
}

// ============================================================================
// Default Dependencies
// ============================================================================

function createDefaultDeps(): ArticleGeneratorDeps {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not configured');
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
 * @throws Error if OPENROUTER_API_KEY is not configured (when using default deps)
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

  // Validate input
  validateGameArticleContext(context);

  const scoutModel = getModel('ARTICLE_SCOUT');
  const editorModel = getModel('ARTICLE_EDITOR');
  const specialistModel = getModel('ARTICLE_SPECIALIST');

  const log = createPrefixedLogger('[ArticleGen]');
  const onProgress = options?.onProgress;
  const timeoutMs = options?.timeoutMs ?? GENERATOR_CONFIG.DEFAULT_TIMEOUT_MS;
  const signal = options?.signal;
  const totalStartTime = Date.now();

  // Phase durations will be collected as immutable values
  let scoutDuration = 0;
  let editorDuration = 0;
  let specialistDuration = 0;
  let validationDuration = 0;

  log.info(`=== Starting Multi-Agent Article Generation for "${context.gameName}" ===`);
  if (timeoutMs > 0) {
    log.info(`Timeout configured: ${timeoutMs}ms`);
  }

  // ===== PHASE 1: SCOUT =====
  const scoutStartTime = Date.now();
  log.info(`Phase 1: Scout - Deep multi-query research (model: ${scoutModel})...`);
  onProgress?.('scout', 0, 'Starting research phase');

  let scoutOutput;
  try {
    scoutOutput = await withTimeoutAndCancellation(
      withRetry(
        () =>
          runScout(context, {
            search,
            generateText: genText,
            model: openrouter(scoutModel),
            logger: createPrefixedLogger('[Scout]'),
          }),
        { context: `Scout phase (model: ${scoutModel})` }
      ),
      signal,
      totalStartTime,
      timeoutMs,
      context.gameName,
      'Scout'
    );
  } catch (error) {
    // Re-throw timeout/cancellation errors directly
    if (error instanceof ArticleGenerationError && (error.code === 'TIMEOUT' || error.code === 'CANCELLED')) {
      throw error;
    }
    throw new ArticleGenerationError(
      'SCOUT_FAILED',
      `Article generation failed during Scout phase for "${context.gameName}" (model: ${scoutModel}): ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined
    );
  }

  scoutDuration = Date.now() - scoutStartTime;
  log.info(
    `Scout complete in ${scoutDuration}ms: ` +
      `${scoutOutput.researchPool.allUrls.size} sources, ` +
      `${scoutOutput.researchPool.queryCache.size} unique queries`
  );
  onProgress?.('scout', 100, `Found ${scoutOutput.researchPool.allUrls.size} sources`);

  // ===== PHASE 2: EDITOR =====
  const editorStartTime = Date.now();
  log.info(`Phase 2: Editor - Planning article (model: ${editorModel})...`);
  onProgress?.('editor', 0, 'Planning article structure');

  let plan;
  try {
    plan = await withTimeoutAndCancellation(
      withRetry(
        () =>
          runEditor(context, scoutOutput, {
            generateObject: genObject,
            model: openrouter(editorModel),
            logger: createPrefixedLogger('[Editor]'),
          }),
        { context: `Editor phase (model: ${editorModel})` }
      ),
      signal,
      totalStartTime,
      timeoutMs,
      context.gameName,
      'Editor'
    );
  } catch (error) {
    // Re-throw timeout/cancellation errors directly
    if (error instanceof ArticleGenerationError && (error.code === 'TIMEOUT' || error.code === 'CANCELLED')) {
      throw error;
    }
    throw new ArticleGenerationError(
      'EDITOR_FAILED',
      `Article generation failed during Editor phase for "${context.gameName}" (model: ${editorModel}): ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined
    );
  }

  editorDuration = Date.now() - editorStartTime;
  log.info(
    `Editor complete in ${editorDuration}ms: ` +
      `${plan.categorySlug} article with ${plan.sections.length} sections`
  );
  onProgress?.('editor', 100, `Planned ${plan.sections.length} sections`);

  // ===== PHASE 3: SPECIALIST =====
  const specialistStartTime = Date.now();
  log.info(`Phase 3: Specialist - Batch research + section writing (model: ${specialistModel})...`);
  onProgress?.('specialist', 0, 'Writing article sections');

  let markdown: string;
  let sources: readonly string[];
  let finalResearchPool;
  try {
    // Note: We don't wrap the entire Specialist in retry because it's a long operation.
    // Instead, retry logic is applied to individual search/generateText calls inside the agent.
    const specialistResult = await withTimeoutAndCancellation(
      runSpecialist(context, scoutOutput, plan, {
        search,
        generateText: genText,
        model: openrouter(specialistModel),
        logger: createPrefixedLogger('[Specialist]'),
        onSectionProgress: (current, total, headline) => {
          // Report granular progress during section writing (10-90% of specialist phase)
          const sectionProgress = Math.round(10 + (current / total) * 80);
          onProgress?.('specialist', sectionProgress, `Writing section ${current}/${total}: ${headline}`);
        },
      }),
      signal,
      totalStartTime,
      timeoutMs,
      context.gameName,
      'Specialist'
    );
    markdown = specialistResult.markdown;
    sources = specialistResult.sources;
    finalResearchPool = specialistResult.researchPool;
  } catch (error) {
    // Re-throw timeout/cancellation errors directly
    if (error instanceof ArticleGenerationError && (error.code === 'TIMEOUT' || error.code === 'CANCELLED')) {
      throw error;
    }
    throw new ArticleGenerationError(
      'SPECIALIST_FAILED',
      `Article generation failed during Specialist phase for "${context.gameName}" (model: ${specialistModel}): ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined
    );
  }

  specialistDuration = Date.now() - specialistStartTime;
  log.info(
    `Specialist complete in ${specialistDuration}ms: ` +
      `${countContentH2Sections(markdown)} sections written, ${sources.length} total sources`
  );
  onProgress?.('specialist', 100, `Wrote ${countContentH2Sections(markdown)} sections`);

  // ===== PHASE 4: VALIDATION =====
  const validationStartTime = Date.now();
  log.info('Phase 4: Validating generated content...');
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

  validationDuration = Date.now() - validationStartTime;

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
      scout: scoutDuration,
      editor: editorDuration,
      specialist: specialistDuration,
      validation: validationDuration,
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
