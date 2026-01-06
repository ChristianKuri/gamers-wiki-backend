import type { ArticleCategorySlug } from '../../article-plan';
import type { SourceSummary } from '../../types';
import type { ReviewerPromptContext as BaseReviewerPromptContext } from './reviewer';

// Re-export base type and extend with sourceSummaries
export interface ReviewerPromptContext extends BaseReviewerPromptContext {
  /**
   * Detailed per-source summaries from Scout.
   * Contains specific facts for verification.
   */
  readonly sourceSummaries?: readonly SourceSummary[];
}

/**
 * Builds a research summary from source summaries for the Reviewer.
 * Provides detailed, structured information for fact-checking.
 */
export function buildResearchSummaryFromSourceSummaries(
  sourceSummaries: readonly SourceSummary[],
  maxLength: number
): string {
  const parts: string[] = ['=== RESEARCH SUMMARIES (Top Sources by Quality) ==='];

  for (const source of sourceSummaries) {
    const section: string[] = [
      `--- Source: "${source.title}" ---`,
      `URL: ${source.url}`,
      `Query: "${source.query}"`,
      `Quality: ${source.qualityScore}/100 | Relevance: ${source.relevanceScore}/100`,
      '',
      'DETAILED SUMMARY:',
      source.detailedSummary,
    ];

    if (source.keyFacts.length > 0) {
      section.push('', 'KEY FACTS:');
      for (const fact of source.keyFacts.slice(0, 7)) {
        section.push(`• ${fact}`);
      }
    }

    if (source.dataPoints.length > 0) {
      section.push('', 'DATA POINTS:');
      section.push(source.dataPoints.slice(0, 10).join(' | '));
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

/**
 * Builds a research summary for the Reviewer.
 * 
 * @param sourceSummaries - Source summaries from Scout
 * @param maxLength - Maximum length of the output
 */
export function buildResearchSummaryForReviewer(
  sourceSummaries: readonly SourceSummary[] | undefined,
  maxLength: number
): string {
  if (sourceSummaries && sourceSummaries.length > 0) {
    return buildResearchSummaryFromSourceSummaries(sourceSummaries, maxLength);
  }
  
  return '';
}
