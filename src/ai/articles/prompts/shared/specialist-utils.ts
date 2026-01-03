import type { CategorizedSearchResult, ContentType, SearchResultItem, SearchSource, SourceUsageItem } from '../../types';
import { SPECIALIST_CONFIG } from '../../config';

/**
 * Result of content selection.
 */
interface ContentResult {
  readonly content: string;
  readonly contentType: ContentType;
}

/**
 * Builds compact context from detailedSummary + keyFacts + dataPoints.
 * This provides ~70% token reduction while preserving key information.
 *
 * @param result - The search result item with summary data
 * @returns Formatted compact context string
 */
function buildCompactContext(result: SearchResultItem): string {
  const sections: string[] = [];

  // 1. Detailed summary (primary content)
  if (result.detailedSummary) {
    sections.push(result.detailedSummary);
  }

  // 2. Key facts as bullet points
  if (result.keyFacts && result.keyFacts.length > 0) {
    sections.push(`\nKEY FACTS:\n${result.keyFacts.map((f) => `• ${f}`).join('\n')}`);
  }

  // 3. Data points (compact, pipe-separated)
  if (result.dataPoints && result.dataPoints.length > 0) {
    sections.push(`\nDATA: ${result.dataPoints.join(' | ')}`);
  }

  return sections.join('\n');
}

/**
 * Gets the display content for a search result.
 * Uses compact context (detailedSummary + structured data) when enabled and available,
 * otherwise falls back to full cleanedContent.
 *
 * @param result - The search result item
 * @param contentPerResult - Maximum length for content (used for full content fallback)
 * @returns Content and content type
 */
function getSourceContent(
  result: SearchResultItem,
  contentPerResult: number
): ContentResult {
  // Use compact context if enabled and detailedSummary is available
  if (SPECIALIST_CONFIG.USE_COMPACT_CONTEXT && result.detailedSummary) {
    return {
      content: buildCompactContext(result),
      contentType: 'summary',
    };
  }

  // Fallback: use full cleanedContent
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
 * 
 * When SPECIALIST_USE_COMPACT_CONTEXT=true:
 * - Uses detailedSummary + keyFacts + dataPoints (~5K chars per source)
 * - ~70% token reduction while preserving key information
 * 
 * When disabled (default):
 * - Uses full cleanedContent (up to contentPerResult chars)
 *
 * @param research - Array of categorized search results
 * @param resultsPerResearch - Number of results to include per research query
 * @param contentPerResult - Maximum characters of content per result (for full mode)
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
          
          // Track usage - include search source and quality/relevance if known
          allSourceUsage.push({
            url: result.url,
            title: result.title,
            contentType: source.contentType,
            phase: 'specialist',
            section: sectionHeadline,
            query: r.query,
            // Only include searchSource if explicitly set (don't guess)
            ...(r.searchSource ? { searchSource: r.searchSource } : {}),
            // Include quality/relevance scores if available (from cleaned sources)
            ...(result.qualityScore !== undefined ? { qualityScore: result.qualityScore } : {}),
            ...(result.relevanceScore !== undefined ? { relevanceScore: result.relevanceScore } : {}),
            // Track actual content length used (compact or full)
            cleanedCharCount: source.content.length,
            // Include cache status if available
            ...(result.wasCached !== undefined ? { wasCached: result.wasCached } : {}),
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
