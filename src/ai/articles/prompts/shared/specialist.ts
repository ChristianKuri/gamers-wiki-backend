import type { ArticlePlan } from '../../article-plan';
import type { SourceSummary } from '../../types';

export interface SpecialistSectionContext {
  readonly sectionIndex: number;
  readonly totalSections: number;
  readonly headline: string;
  readonly goal: string;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly previousContext: string;
  readonly researchContext: string;
  readonly isThinResearch: boolean;
  readonly researchContentLength: number;
  readonly crossReferenceContext?: string;
  /**
   * Elements this specific section MUST cover.
   * Assigned by the Editor from the global requiredElements list.
   * The Specialist sees only these elements for the current section,
   * enabling targeted accountability instead of cognitive overload.
   * Required since ArticleSectionPlanSchema enforces mustCover.
   */
  readonly mustCover: readonly string[];
  /**
   * Detailed per-source summaries from Scout (via Cleaner).
   * Contains specific facts, numbers, and data points from each source.
   * Used for writing with high specificity.
   */
  readonly sourceSummaries?: readonly SourceSummary[];
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
