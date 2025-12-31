import type { ArticleCategorySlug } from '../../article-plan';
import type { ScoutOutput } from '../../types';

export interface EditorPromptContext {
  readonly gameName: string;
  readonly releaseDate?: string | null;
  readonly genres?: readonly string[];
  readonly platforms?: readonly string[];
  readonly developer?: string | null;
  readonly publisher?: string | null;
  readonly instruction?: string | null;
  readonly localeInstruction: string;
  readonly scoutBriefing: ScoutOutput['briefing'];
  readonly existingResearchSummary: string;
  readonly categoryHintsSection: string;
  readonly targetWordCount?: number;
  readonly validationFeedback?: readonly string[];
  readonly categorySlug?: ArticleCategorySlug;
  /**
   * Formatted summary of the best sources from each search query.
   * Contains actual cleaned content to help the Editor plan better.
   */
  readonly topSourcesSummary?: string;
}

export interface EditorPrompts {
  getSystemPrompt(localeInstruction: string): string;
  getUserPrompt(ctx: EditorPromptContext): string;
}
