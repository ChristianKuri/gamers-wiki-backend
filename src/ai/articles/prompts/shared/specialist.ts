import type { ArticlePlan } from '../../article-plan';

export interface SpecialistSectionContext {
  readonly sectionIndex: number;
  readonly totalSections: number;
  readonly headline: string;
  readonly goal: string;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly previousContext: string;
  readonly researchContext: string;
  readonly scoutOverview: string;
  readonly categoryInsights: string;
  readonly isThinResearch: boolean;
  readonly researchContentLength: number;
  readonly requiredElements?: readonly string[];
  readonly crossReferenceContext?: string;
}

export interface SpecialistPrompts {
  getSystemPrompt(localeInstruction: string): string;
  getSectionUserPrompt(
    ctx: SpecialistSectionContext,
    plan: ArticlePlan,
    gameName: string,
    maxScoutOverviewLength: number,
    minParagraphs: number,
    maxParagraphs: number
  ): string;
}
