import type { CategorizedSearchResult, ContentType, SearchResultItem, SearchSource, SourceUsageItem } from '../../types';

/**
 * Result of content selection.
 */
interface ContentResult {
  readonly content: string;
  readonly contentType: ContentType;
}

/**
 * Gets the display content for a search result.
 * Always uses full content (summary support removed as we don't use it).
 *
 * @param result - The search result item
 * @param contentPerResult - Maximum length for content
 * @returns Content and content type (always 'full')
 */
function getSourceContent(
  result: SearchResultItem,
  contentPerResult: number
): ContentResult {
  return {
    content: result.content.slice(0, contentPerResult),
    contentType: 'full',
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
 * Always uses full content for all results.
 *
 * @param research - Array of categorized search results
 * @param resultsPerResearch - Number of results to include per research query
 * @param contentPerResult - Maximum characters of content per result
 * @param sectionHeadline - Section headline for tracking (optional)
 */
export function buildResearchContext(
  research: readonly CategorizedSearchResult[],
  resultsPerResearch: number,
  contentPerResult: number,
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
        .map((result) => {
          const source = getSourceContent(result, contentPerResult);
          
          // Track usage - include search source if known
          allSourceUsage.push({
            url: result.url,
            title: result.title,
            contentType: source.contentType,
            phase: 'specialist',
            section: sectionHeadline,
            query: r.query,
            // Only include searchSource if explicitly set (don't guess)
            ...(r.searchSource ? { searchSource: r.searchSource } : {}),
          });

          return `  - ${result.title} (${result.url})\n    ${source.content}`;
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
