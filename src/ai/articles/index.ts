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
} from './generate-game-article';

// Types
export type {
  GameArticleContext,
  GameArticleDraft,
  ScoutOutput,
  ResearchPool,
  CategorizedSearchResult,
  SearchResultItem,
  ValidationIssue,
  CategoryHint,
  ArticleGenerationMetadata,
  ArticleProgressCallback,
  ArticleGenerationPhase,
  SectionProgressCallback,
} from './types';

// Article plan types and utilities
export {
  ArticlePlanSchema,
  ArticleCategorySlugSchema,
  normalizeArticleCategorySlug,
  ARTICLE_PLAN_CONSTRAINTS,
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

// Agents (for advanced usage / testing)
export {
  runScout,
  runEditor,
  runSpecialist,
  SCOUT_CONFIG,
  EDITOR_CONFIG,
  SPECIALIST_CONFIG,
} from './agents';

// Prompts (for customization / testing)
export * from './prompts';

