import type { CategorizedSearchResult, ContentType, SearchResultItem, SourceUsageItem } from '../../types';

/**
 * Result of hybrid content selection.
 */
interface HybridContentResult {
  readonly content: string;
  readonly contentType: ContentType;
}

/**
 * Gets the display content for a search result using hybrid approach.
 * Top N results get full content, remaining get summary (if available).
 *
 * @param result - The search result item
 * @param index - Position in results (0-based)
 * @param fullTextCount - Number of top results to show full text
 * @param contentPerResult - Maximum length for content
 * @returns Content and which type was used
 */
function getHybridContent(
  result: SearchResultItem,
  index: number,
  fullTextCount: number,
  contentPerResult: number
): HybridContentResult {
  // Top N results: use full content (for maximum detail)
  if (index < fullTextCount) {
    return {
      content: result.content.slice(0, contentPerResult),
      contentType: 'full',
    };
  }
  // Remaining results: prefer summary (more efficient, query-aware)
  if (result.summary) {
    return {
      content: result.summary.slice(0, contentPerResult),
      contentType: 'summary',
    };
  }
  // Fallback to content if no summary
  return {
    content: result.content.slice(0, contentPerResult),
    contentType: 'content',
  };
}

/**
 * Result of building research context, includes tracking info.
 */
export interface ResearchContextResult {
  /** Formatted research context for LLM prompt */
  readonly context: string;
  /** Tracking of which content type was used for each source */
  readonly sourceUsage: readonly SourceUsageItem[];
}

/**
 * Builds research context for a section.
 * Uses hybrid approach: top N results get full text, rest get summaries.
 *
 * @param research - Array of categorized search results
 * @param resultsPerResearch - Number of results to include per research query
 * @param contentPerResult - Maximum characters of content per result
 * @param fullTextCount - Number of top results to show full text (default: 1)
 * @param sectionHeadline - Section headline for tracking (optional)
 */
export function buildResearchContext(
  research: readonly CategorizedSearchResult[],
  resultsPerResearch: number,
  contentPerResult: number,
  fullTextCount: number = 1,
  sectionHeadline?: string
): ResearchContextResult {
  if (research.length === 0) {
    return { context: '', sourceUsage: [] };
  }

  const allSourceUsage: SourceUsageItem[] = [];

  const context = research
    .map((r, idx) => {
      const topResults = r.results
        .slice(0, resultsPerResearch)
        .map((result, resultIndex) => {
          const hybrid = getHybridContent(result, resultIndex, fullTextCount, contentPerResult);
          const contentLabel = hybrid.contentType === 'full' ? '[FULL]' : 
                              (hybrid.contentType === 'summary' ? '[SUMMARY]' : '[CONTENT]');
          
          // Track usage
          allSourceUsage.push({
            url: result.url,
            title: result.title,
            contentType: hybrid.contentType,
            phase: 'specialist',
            section: sectionHeadline,
            query: r.query,
            hasSummary: !!result.summary,
          });

          return `  - ${result.title} (${result.url}) ${contentLabel}\n    ${hybrid.content}`;
        })
        .join('\n');

      return `Research ${idx + 1} [${r.category}]: "${r.query}"
AI Summary: ${r.answer || '(none)'}
Results:
${topResults}`;
    })
    .join('\n\n---\n\n');

  return { context, sourceUsage: allSourceUsage };
}
