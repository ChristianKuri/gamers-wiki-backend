import type { ArticleCategorySlug } from '../../article-plan';

export interface EditorPromptContext {
  readonly gameName: string;
  readonly releaseDate?: string | null;
  readonly genres?: readonly string[];
  readonly platforms?: readonly string[];
  readonly developer?: string | null;
  readonly publisher?: string | null;
  readonly instruction?: string | null;
  readonly localeInstruction: string;
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
  /**
   * Formatted summary of per-query briefings from Scout.
   * Contains synthesized findings, key facts, and gaps for each query.
   */
  readonly queryBriefingsSummary: string;
  /**
   * Top detailed summaries from best sources (ranked by quality + relevance).
   * Contains comprehensive source-level summaries with key facts and data points.
   */
  readonly topDetailedSummaries?: string;
  /**
   * Draft title suggested by the Scout Query Planner.
   * Editor can use this as a starting point or create a new one.
   */
  readonly draftTitle: string;
}

export interface EditorPrompts {
  getSystemPrompt(localeInstruction: string): string;
  getUserPrompt(ctx: EditorPromptContext): string;
}
