/**
 * Article Generation Module
 *
 * Multi-agent system for generating high-quality game articles in English.
 * Translation to other languages is handled separately.
 *
 * @example
 * import { generateGameArticleDraft } from '@/ai/articles';
 *
 * const draft = await generateGameArticleDraft({
 *   gameName: 'Elden Ring',
 *   instruction: 'Write a beginner guide',
 * });
 */

// Main generator
export {
  generateGameArticleDraft,
  type ArticleGeneratorDeps,
  type ArticleGeneratorOptions,
  type TemperatureOverrides,
} from './generate-game-article';

// Types and error classes
export {
  ArticleGenerationError,
  isArticleGenerationError,
  ARTICLE_GENERATION_PHASES,
  systemClock,
  createMockClock,
  type ArticleGenerationErrorCode,
  type GameArticleContext,
  type GameArticleDraft,
  type ScoutOutput,
  type ResearchPool,
  type CategorizedSearchResult,
  type SearchResultItem,
  type ValidationIssue,
  type CategoryHint,
  type ArticleGenerationMetadata,
  type ArticleProgressCallback,
  type ArticleGenerationPhase,
  type SectionProgressCallback,
  type Clock,
  // Scout Query Planning types
  type DiscoveryCheck,
  type DiscoveryReason,
  type PlannedQuery,
  type QueryPlan,
  type SourceSummary,
  type SourceContentType,
} from './types';

// Unified configuration
export {
  CONFIG,
  GENERATOR_CONFIG,
  SCOUT_CONFIG,
  EDITOR_CONFIG,
  SPECIALIST_CONFIG,
  RETRY_CONFIG,
} from './config';

// Article plan types and utilities
export {
  ArticlePlanSchema,
  ArticleCategorySlugSchema,
  normalizeArticleCategorySlug,
  ARTICLE_PLAN_CONSTRAINTS,
  DEFAULT_ARTICLE_SAFETY,
  type ArticlePlan,
  type ArticleCategorySlug,
  type ArticleCategorySlugInput,
  type ArticleSectionPlan,
} from './article-plan';

// Markdown utilities
export {
  parseMarkdownH2Sections,
  getContentH2Sections,
  countContentH2Sections,
  stripSourcesSection,
  type MarkdownH2Section,
} from './markdown-utils';

// Validation
export {
  validateArticleDraft,
  validateGameArticleContext,
  getErrors,
  getWarnings,
  AI_CLICHES,
  PLACEHOLDER_PATTERNS,
} from './validation';

// Research pool utilities
export {
  ResearchPoolBuilder,
  createEmptyResearchPool,
  deduplicateQueries,
  normalizeQuery,
  normalizeUrl,
  extractResearchForQueries,
  processSearchResults,
} from './research-pool';

// Retry utilities
export {
  withRetry,
  createRetryWrapper,
  isRetryableError,
  type RetryOptions,
} from './retry';

// Agents (for advanced usage / testing)
export {
  runScout,
  runEditor,
  runSpecialist,
} from './agents';

// Prompts (for customization / testing)
export * from './prompts';

