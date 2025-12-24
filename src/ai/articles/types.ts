/**
 * Article Generation Types
 *
 * Shared types for the multi-agent article generation system.
 */

import type { ArticleCategorySlug, ArticlePlan } from './article-plan';

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error with cause for proper error chaining.
 * Compatible with ES2022+ Error cause property.
 */
export interface ErrorWithCause extends Error {
  cause?: unknown;
}

/**
 * Creates an error with cause for proper error chaining.
 */
export function createErrorWithCause(message: string, cause?: Error): ErrorWithCause {
  const error = new Error(message) as ErrorWithCause;
  error.cause = cause;
  return error;
}

// ============================================================================
// Search Result Types
// ============================================================================

/**
 * A single search result item from Tavily or similar search API.
 */
export interface SearchResultItem {
  readonly title: string;
  readonly url: string;
  readonly content: string;
  readonly score?: number;
}

/**
 * Category of a search result, indicating its source/purpose.
 */
export type SearchCategory = 'overview' | 'category-specific' | 'recent' | 'section-specific';

/**
 * A categorized search result with metadata.
 */
export interface CategorizedSearchResult {
  readonly query: string;
  readonly answer: string | null;
  readonly results: readonly SearchResultItem[];
  readonly category: SearchCategory;
  readonly timestamp: number;
}

// ============================================================================
// Research Pool Types
// ============================================================================

/**
 * Immutable research pool containing all gathered research.
 */
export interface ResearchPool {
  readonly scoutFindings: {
    readonly overview: readonly CategorizedSearchResult[];
    readonly categorySpecific: readonly CategorizedSearchResult[];
    readonly recent: readonly CategorizedSearchResult[];
  };
  readonly allUrls: ReadonlySet<string>;
  readonly queryCache: ReadonlyMap<string, CategorizedSearchResult>;
}

// ============================================================================
// Scout Agent Types
// ============================================================================

/**
 * Output from the Scout agent containing research briefings and sources.
 */
export interface ScoutOutput {
  readonly briefing: {
    readonly overview: string;
    readonly categoryInsights: string;
    readonly recentDevelopments: string;
    readonly fullContext: string;
  };
  readonly researchPool: ResearchPool;
  readonly sourceUrls: readonly string[];
}

// ============================================================================
// Context Types
// ============================================================================

/**
 * Context required to generate a game article.
 *
 * @property gameName - The game's display name (required)
 * @property gameSlug - URL-friendly slug for the game
 * @property releaseDate - ISO date string of release
 * @property genres - Array of genre names
 * @property platforms - Array of platform names
 * @property developer - Primary developer name
 * @property publisher - Primary publisher name
 * @property igdbDescription - Description from IGDB
 * @property instruction - User directive for article focus
 * @property categoryHints - Preferred article categories to consider
 */
export interface GameArticleContext {
  readonly gameName: string;
  readonly gameSlug?: string | null;
  readonly releaseDate?: string | null;
  readonly genres?: readonly string[];
  readonly platforms?: readonly string[];
  readonly developer?: string | null;
  readonly publisher?: string | null;
  readonly igdbDescription?: string | null;
  readonly instruction?: string | null;
  readonly categoryHints?: readonly CategoryHint[];
}

/**
 * A hint for article category selection.
 */
export interface CategoryHint {
  readonly slug: ArticleCategorySlug;
  readonly systemPrompt?: string | null;
}

// ============================================================================
// Draft Types
// ============================================================================

/**
 * A generated article draft ready for review/publishing.
 */
export interface GameArticleDraft {
  readonly title: string;
  readonly categorySlug: ArticleCategorySlug;
  readonly excerpt: string;
  readonly tags: readonly string[];
  readonly markdown: string;
  readonly sources: readonly string[];
  readonly plan: ArticlePlan;
  readonly models: {
    readonly scout: string;
    readonly editor: string;
    readonly specialist: string;
  };
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Severity level for validation issues.
 */
export type ValidationSeverity = 'error' | 'warning';

/**
 * A validation issue found during draft validation.
 */
export interface ValidationIssue {
  readonly severity: ValidationSeverity;
  readonly message: string;
}

// ============================================================================
// Dependency Injection Types
// ============================================================================

/**
 * Search function type for dependency injection.
 */
export type SearchFunction = (
  query: string,
  options?: {
    searchDepth?: 'basic' | 'advanced';
    maxResults?: number;
    includeAnswer?: boolean;
    includeRawContent?: boolean;
  }
) => Promise<{
  query: string;
  answer: string | null;
  results: readonly { title: string; url: string; content?: string; score?: number }[];
}>;

/**
 * Dependencies for article generation, enabling testability.
 */
export interface ArticleGeneratorDeps {
  readonly search: SearchFunction;
  readonly generateText: typeof import('ai').generateText;
  readonly generateObject: typeof import('ai').generateObject;
  readonly openrouterModel: (model: string) => import('ai').LanguageModel;
}

