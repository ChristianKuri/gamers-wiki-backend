import type { ArticleCategorySlug, ArticlePlan } from '../../article-plan';

export interface ReviewerPromptContext {
  readonly plan: ArticlePlan;
  readonly markdown: string;
  readonly researchSummary: string;
  readonly categorySlug: ArticleCategorySlug;
}

export interface ReviewerPrompts {
  getSystemPrompt(): string;
  getUserPrompt(ctx: ReviewerPromptContext): string;
}
