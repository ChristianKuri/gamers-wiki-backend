/**
 * Article Generation Types
 *
 * Shared types for the multi-agent article generation system.
 * Articles are always generated in English; translation to other languages is a separate process.
 */

import type { ArticleCategorySlug, ArticlePlan } from './article-plan';

// ============================================================================
// Phase Constants
// ============================================================================

/**
 * All phases of article generation as a const array.
 * Used to derive the ArticleGenerationPhase type.
 */
export const ARTICLE_GENERATION_PHASES = ['scout', 'editor', 'specialist', 'validation'] as const;

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for article generation failures.
 * Each code corresponds to a specific phase or validation step.
 */
export type ArticleGenerationErrorCode =
  | 'CONFIG_ERROR'
  | 'CONTEXT_INVALID'
  | 'SCOUT_FAILED'
  | 'EDITOR_FAILED'
  | 'SPECIALIST_FAILED'
  | 'VALIDATION_FAILED'
  | 'TIMEOUT'
  | 'CANCELLED';

/**
 * Custom error class for article generation failures.
 * Provides structured error information for programmatic handling.
 *
 * @example
 * try {
 *   await generateGameArticleDraft(context);
 * } catch (error) {
 *   if (error instanceof ArticleGenerationError) {
 *     switch (error.code) {
 *       case 'SCOUT_FAILED':
 *         // Handle research failure
 *         break;
 *       case 'VALIDATION_FAILED':
 *         // Handle validation failure
 *         break;
 *     }
 *   }
 * }
 */
export class ArticleGenerationError extends Error {
  readonly name = 'ArticleGenerationError';

  constructor(
    readonly code: ArticleGenerationErrorCode,
    message: string,
    readonly cause?: Error
  ) {
    super(message);
    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ArticleGenerationError);
    }
  }
}

/**
 * Type guard to check if an error is an ArticleGenerationError.
 */
export function isArticleGenerationError(error: unknown): error is ArticleGenerationError {
  return error instanceof ArticleGenerationError;
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
 * Confidence level for research quality.
 * Used by downstream agents to adjust behavior when research is limited.
 */
export type ResearchConfidence = 'high' | 'medium' | 'low';

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
  /** Token usage for Scout phase LLM calls */
  readonly tokenUsage: TokenUsage;
  /**
   * Confidence level based on research quality.
   * - 'high': Good source count and briefing quality
   * - 'medium': Some concerns but usable
   * - 'low': Limited research, article quality may be compromised
   */
  readonly confidence: ResearchConfidence;
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
// Token Usage Types
// ============================================================================

/**
 * Token usage for a single LLM call or phase.
 */
export interface TokenUsage {
  /** Number of input (prompt) tokens */
  readonly input: number;
  /** Number of output (completion) tokens */
  readonly output: number;
}

/**
 * Aggregated token usage across all phases.
 */
export interface AggregatedTokenUsage {
  readonly scout: TokenUsage;
  readonly editor: TokenUsage;
  readonly specialist: TokenUsage;
  readonly total: TokenUsage;
  /** Estimated total cost in USD (if pricing data is available) */
  readonly estimatedCostUsd?: number;
}

/**
 * Creates an empty token usage object.
 */
export function createEmptyTokenUsage(): TokenUsage {
  return { input: 0, output: 0 };
}

/**
 * Adds two token usage objects together.
 */
export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
  };
}

// ============================================================================
// Draft Types
// ============================================================================

/**
 * Metadata about the article generation process.
 */
export interface ArticleGenerationMetadata {
  /** ISO timestamp when generation completed */
  readonly generatedAt: string;
  /** Total generation time in milliseconds */
  readonly totalDurationMs: number;
  /** Duration of each phase in milliseconds */
  readonly phaseDurations: {
    readonly scout: number;
    readonly editor: number;
    readonly specialist: number;
    readonly validation: number;
  };
  /** Number of search queries executed */
  readonly queriesExecuted: number;
  /** Number of unique sources collected */
  readonly sourcesCollected: number;
  /** Token usage by phase (optional - may not be available if API doesn't report it) */
  readonly tokenUsage?: AggregatedTokenUsage;
  /** Correlation ID for log tracing */
  readonly correlationId: string;
  /** Research confidence level from Scout phase */
  readonly researchConfidence: ResearchConfidence;
}

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
  /** Generation metadata for debugging and analytics */
  readonly metadata: ArticleGenerationMetadata;
}

// ============================================================================
// Progress Callback Types
// ============================================================================

/** Phases of article generation, derived from ARTICLE_GENERATION_PHASES constant */
export type ArticleGenerationPhase = (typeof ARTICLE_GENERATION_PHASES)[number];

/**
 * Progress callback for monitoring article generation.
 *
 * @param phase - Current phase of generation
 * @param progress - Progress percentage (0-100) within the phase
 * @param message - Optional status message
 */
export type ArticleProgressCallback = (
  phase: ArticleGenerationPhase,
  progress: number,
  message?: string
) => void;

/**
 * Callback for monitoring section writing progress within the Specialist phase.
 *
 * @param current - Current section number (1-indexed)
 * @param total - Total number of sections
 * @param headline - Headline of the section being written
 */
export type SectionProgressCallback = (current: number, total: number, headline: string) => void;

/**
 * Callback for monitoring batch research progress within the Specialist phase.
 *
 * @param completed - Number of completed queries
 * @param total - Total number of queries to execute
 */
export type ResearchProgressCallback = (completed: number, total: number) => void;

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

// ============================================================================
// Clock Abstraction (for testability)
// ============================================================================

/**
 * Clock interface for time-related operations.
 * Enables deterministic testing by allowing time to be mocked.
 *
 * @example
 * // Production usage (default)
 * const clock = systemClock;
 * const now = clock.now();
 *
 * @example
 * // Test usage
 * const mockClock: Clock = { now: () => 1234567890000 };
 */
export interface Clock {
  /** Returns current timestamp in milliseconds (like Date.now()) */
  now(): number;
}

/**
 * Default clock implementation using system time.
 */
export const systemClock: Clock = {
  now: () => Date.now(),
};

/**
 * Creates a mock clock for testing with a fixed or advancing time.
 *
 * @param initialTime - Starting timestamp in milliseconds
 * @param autoAdvance - If provided, advances time by this many ms on each call
 * @returns A Clock instance for testing
 *
 * @example
 * // Fixed time
 * const clock = createMockClock(1000000);
 * clock.now(); // 1000000
 * clock.now(); // 1000000
 *
 * @example
 * // Auto-advancing time (100ms per call)
 * const clock = createMockClock(1000000, 100);
 * clock.now(); // 1000000
 * clock.now(); // 1000100
 * clock.now(); // 1000200
 */
export function createMockClock(initialTime: number, autoAdvance?: number): Clock {
  let currentTime = initialTime;
  return {
    now: () => {
      const time = currentTime;
      if (autoAdvance !== undefined) {
        currentTime += autoAdvance;
      }
      return time;
    },
  };
}

