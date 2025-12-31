import type { ArticleCategorySlug, ArticlePlan } from '../../article-plan';
import type { QueryBriefing, SourceSummary } from '../../types';

export interface ReviewerPromptContext {
  readonly plan: ArticlePlan;
  readonly markdown: string;
  readonly researchSummary: string;
  readonly categorySlug: ArticleCategorySlug;
  /**
   * Per-query briefings from Scout.
   * Contains synthesized findings for fact-checking.
   */
  readonly queryBriefings?: readonly QueryBriefing[];
  /**
   * Detailed per-source summaries from Scout.
   * Contains specific facts for verification.
   */
  readonly sourceSummaries?: readonly SourceSummary[];
}

/**
 * Builds a research summary from per-query briefings for the Reviewer.
 * Provides more structured information for fact-checking.
 */
export function buildResearchSummaryWithBriefings(
  queryBriefings: readonly QueryBriefing[],
  maxLength: number
): string {
  const parts: string[] = ['=== RESEARCH BRIEFINGS (Per-Query Synthesis) ==='];

  for (const briefing of queryBriefings) {
    const section: string[] = [
      `--- Query: "${briefing.query}" [${briefing.engine}] ---`,
      `Purpose: ${briefing.purpose}`,
      `Sources: ${briefing.sourceCount}`,
      '',
      'FINDINGS:',
      briefing.findings,
    ];

    if (briefing.keyFacts.length > 0) {
      section.push('', 'KEY FACTS:');
      for (const fact of briefing.keyFacts) {
        section.push(`• ${fact}`);
      }
    }

    if (briefing.gaps.length > 0) {
      section.push('', 'GAPS:');
      for (const gap of briefing.gaps) {
        section.push(`⚠️ ${gap}`);
      }
    }

    parts.push(section.join('\n'));
    parts.push('');
  }

  const combined = parts.join('\n');

  if (combined.length > maxLength) {
    return combined.slice(0, maxLength) + '\n...(truncated)';
  }

  return combined;
}
