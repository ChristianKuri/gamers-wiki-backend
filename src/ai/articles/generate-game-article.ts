/**
 * Game Article Generator
 *
 * Multi-agent article generation system that produces high-quality,
 * well-researched gaming articles.
 *
 * Architecture:
 * - Scout: Gathers comprehensive research from multiple sources
 * - Editor: Plans article structure based on research
 * - Specialist: Writes sections using research and plan
 *
 * @example
 * import { generateGameArticleDraft } from '@/ai/articles';
 *
 * const draft = await generateGameArticleDraft({
 *   gameName: 'Elden Ring',
 *   genres: ['Action RPG', 'Soulslike'],
 *   instruction: 'Write a beginner guide',
 * }, 'en');
 */

import { createOpenAI } from '@ai-sdk/openai';
import { generateObject, generateText } from 'ai';

import type { SupportedLocale } from '../config';
import { getModel } from '../config';
import { tavilySearch } from '../tools/tavily';
import { createPrefixedLogger } from '../../utils/logger';
import { runScout, runEditor, runSpecialist } from './agents';
import { countContentH2Sections } from './markdown-utils';
import type { GameArticleContext, GameArticleDraft } from './types';
import { validateArticleDraft, validateGameArticleContext, getErrors, getWarnings } from './validation';

// Re-export types for consumers
export type { GameArticleContext, GameArticleDraft } from './types';
export type { ArticlePlan, ArticleCategorySlug } from './article-plan';

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

// ============================================================================
// Default Dependencies
// ============================================================================

function createDefaultDeps(): ArticleGeneratorDeps {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  return {
    openrouter: createOpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
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
 *
 * @param context - Game context including name, metadata, and optional instruction
 * @param locale - Target locale ('en' or 'es')
 * @param deps - Optional dependencies for testing (defaults to production deps)
 * @returns Complete article draft with markdown, sources, and metadata
 *
 * @throws Error if OPENROUTER_API_KEY is not configured (when using default deps)
 * @throws Error if context validation fails
 * @throws Error if article validation fails (errors, not warnings)
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
 * }, 'en');
 *
 * @example
 * // Testing with mocked dependencies
 * const draft = await generateGameArticleDraft(context, 'en', {
 *   openrouter: mockOpenRouter,
 *   search: mockSearch,
 *   generateText: mockGenerateText,
 *   generateObject: mockGenerateObject,
 * });
 */
export async function generateGameArticleDraft(
  context: GameArticleContext,
  locale: SupportedLocale,
  deps?: ArticleGeneratorDeps
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
  const totalStartTime = Date.now();

  log.info(`=== Starting Multi-Agent Article Generation for "${context.gameName}" ===`);

  // ===== PHASE 1: SCOUT =====
  const scoutStartTime = Date.now();
  log.info('Phase 1: Scout - Deep multi-query research...');

  const scoutOutput = await runScout(context, locale, {
    search,
    generateText: genText,
    model: openrouter(scoutModel),
    logger: createPrefixedLogger('[Scout]'),
  });

  log.info(
    `Scout complete in ${Date.now() - scoutStartTime}ms: ` +
      `${scoutOutput.researchPool.allUrls.size} sources, ` +
      `${scoutOutput.researchPool.queryCache.size} unique queries`
  );

  // ===== PHASE 2: EDITOR =====
  const editorStartTime = Date.now();
  log.info('Phase 2: Editor - Planning article with full research context...');

  const plan = await runEditor(context, locale, scoutOutput, {
    generateObject: genObject,
    model: openrouter(editorModel),
    logger: createPrefixedLogger('[Editor]'),
  });

  log.info(
    `Editor complete in ${Date.now() - editorStartTime}ms: ` +
      `${plan.categorySlug} article with ${plan.sections.length} sections`
  );

  // ===== PHASE 3: SPECIALIST =====
  const specialistStartTime = Date.now();
  log.info('Phase 3: Specialist - Batch research + section writing...');

  const { markdown, sources, researchPool: finalResearchPool } = await runSpecialist(
    context,
    locale,
    scoutOutput,
    plan,
    {
      search,
      generateText: genText,
      model: openrouter(specialistModel),
      logger: createPrefixedLogger('[Specialist]'),
    }
  );

  log.info(
    `Specialist complete in ${Date.now() - specialistStartTime}ms: ` +
      `${countContentH2Sections(markdown)} sections written, ${sources.length} total sources`
  );

  // ===== PHASE 4: VALIDATION =====
  log.info('Phase 4: Validating generated content...');

  const draft = {
    title: plan.title,
    categorySlug: plan.categorySlug,
    excerpt: plan.excerpt,
    tags: plan.tags,
    markdown,
    sources,
    plan,
  };

  const validationIssues = validateArticleDraft(draft, locale);
  const errors = getErrors(validationIssues);
  const warnings = getWarnings(validationIssues);

  if (warnings.length > 0) {
    log.warn(`Article validation warnings: ${warnings.map((w) => w.message).join('; ')}`);
  }

  if (errors.length > 0) {
    log.error(`Article validation errors: ${errors.map((e) => e.message).join('; ')}`);
    throw new Error(`Article validation failed: ${errors.map((e) => e.message).join('; ')}`);
  }

  log.info(`=== Article Generation Complete in ${Date.now() - totalStartTime}ms ===`);
  log.info(
    `Final research pool: ${finalResearchPool.queryCache.size} total queries, ` +
      `${finalResearchPool.allUrls.size} unique sources`
  );

  return {
    ...draft,
    models: {
      scout: scoutModel,
      editor: editorModel,
      specialist: specialistModel,
    },
  };
}
