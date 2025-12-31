import type { GameArticleContext } from '../../types';

export interface ScoutPromptContext {
  readonly gameName: string;
  readonly releaseDate?: string | null;
  readonly genres?: readonly string[];
  readonly platforms?: readonly string[];
  readonly developer?: string | null;
  readonly publisher?: string | null;
  readonly igdbDescription?: string | null;
  readonly instruction?: string | null;
  readonly localeInstruction: string;
  readonly searchContext: string;
  /** Context from category-specific queries (category-specific, tips, etc.) */
  readonly categoryContext: string;
  /** Context from supplementary queries (recent, meta, etc.) - may be empty */
  readonly supplementaryContext: string;
}

export interface ExaQueryConfig {
  /** Semantic queries for Exa neural search */
  readonly semantic: string[];
  /** Domains to prioritize */
  readonly preferredDomains: readonly string[];
}

/**
 * Query slot categories for Scout research.
 * Each article type uses different combinations of these.
 */
export type QuerySlotCategory =
  | 'overview'           // General overview (all article types)
  | 'category-specific'  // Specific to user instruction/focus (all)
  | 'tips'               // Tips, tricks, secrets (guides)
  | 'recent'             // Latest news, patches (news, reviews)
  | 'meta'               // Tier changes, meta shifts (lists)
  | 'critic';            // Professional critic opinions (reviews - future)

/**
 * A single search query slot with full configuration.
 * Article types define their own slots for maximum flexibility.
 */
export interface QuerySlot {
  /** The search query string */
  readonly query: string;
  /** Category for result organization and briefing generation */
  readonly category: QuerySlotCategory;
  /** Maximum results to fetch (default: 10) */
  readonly maxResults?: number;
  /** Search depth: 'basic' is faster, 'advanced' is more thorough (default: 'basic') */
  readonly searchDepth?: 'basic' | 'advanced';
}

/**
 * Scout query configuration returned by each article type.
 * Uses flexible slots instead of hardcoded overview/category/recent structure.
 */
export interface ScoutQueryConfig {
  /** Array of search query slots to execute */
  readonly slots: readonly QuerySlot[];
}

/**
 * Prompt function for supplementary context (tips, recent, meta, etc.)
 * Returns user prompt for the LLM briefing generation.
 */
export type SupplementaryPromptFn = (gameName: string, context: string) => string;

/**
 * Query optimization prompt context for the LLM query optimizer.
 */
export interface QueryOptimizationContext {
  readonly gameName: string;
  readonly genres?: readonly string[];
  readonly instruction?: string | null;
  readonly articleType: string;
}

/**
 * Query optimization prompt for LLM-based query generation.
 * Each article type defines what query categories should be generated.
 */
export interface QueryOptimizationPrompt {
  /** Description of what queries to generate (article-type specific) */
  readonly queryStructure: string;
  /** Examples of good Tavily queries for this article type */
  readonly tavilyExamples: readonly string[];
  /** Examples of good Exa queries for this article type */
  readonly exaExamples: readonly string[];
}

/**
 * Interface that all category-specific Scout prompt modules must implement.
 */
export interface ScoutPrompts {
  /** System prompt for all Scout briefings */
  getSystemPrompt(localeInstruction: string): string;
  /** User prompt for overview briefing */
  getOverviewUserPrompt(ctx: ScoutPromptContext): string;
  /** User prompt for category-specific briefing */
  getCategoryUserPrompt(gameName: string, instruction: string | null | undefined, categoryContext: string): string;
  /**
   * User prompt for supplementary briefing (tips/recent/meta).
   * The category determines what kind of context is provided.
   */
  getSupplementaryUserPrompt(gameName: string, supplementaryContext: string): string;
  /** Build search query slots for this article type */
  buildQueries(context: GameArticleContext): ScoutQueryConfig;
  /** Optional: Build Exa semantic queries for this article type */
  buildExaQueries?(context: GameArticleContext): ExaQueryConfig | null;
  /** Optional: Get query optimization prompt for LLM-based query generation */
  getQueryOptimizationPrompt?(ctx: QueryOptimizationContext): QueryOptimizationPrompt;
}
