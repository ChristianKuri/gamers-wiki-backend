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
  readonly categoryContext: string;
  readonly recentContext: string;
}

export interface ExaQueryConfig {
  /** Semantic queries for Exa neural search */
  readonly semantic: string[];
  /** Domains to prioritize */
  readonly preferredDomains: readonly string[];
}

export interface ScoutQueryConfig {
  readonly overview: string;
  readonly category: string[];
  readonly recent: string;
}

/**
 * Interface that all category-specific Scout prompt modules must implement.
 */
export interface ScoutPrompts {
  getSystemPrompt(localeInstruction: string): string;
  getOverviewUserPrompt(ctx: ScoutPromptContext): string;
  getCategoryUserPrompt(gameName: string, instruction: string | null | undefined, categoryContext: string): string;
  getRecentUserPrompt(gameName: string, recentContext: string): string;
  buildQueries(context: GameArticleContext): ScoutQueryConfig;
  buildExaQueries?(context: GameArticleContext): ExaQueryConfig | null;
}
