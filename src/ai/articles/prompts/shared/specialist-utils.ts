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
 * Info about a discarded research result.
 * Used for logging and debugging to understand what content was excluded.
 */
export interface DiscardedSource {
  /** URL of the discarded source */
  readonly url: string;
  /** Title of the discarded source */
  readonly title: string;
  /** Query that returned this source */
  readonly query: string;
  /** Reason for discarding */
  readonly reason: 'duplicate_url' | 'exceeded_limit';
  /** For exceeded_limit: position in results after deduplication (e.g., 6 means it was the 6th result, limit was 5) */
  readonly position?: number;
}

/**
 * Statistics about research context building.
 * Useful for logging and tuning configuration.
 */
export interface ResearchContextStats {
  /** Total number of sources available across all queries */
  readonly totalAvailable: number;
  /** Number of sources actually used in the context */
  readonly used: number;
  /** Number of sources removed due to duplicate URLs */
  readonly duplicatesRemoved: number;
  /** Number of sources removed due to exceeding the per-query limit */
  readonly limitExceeded: number;
  /** Number of sources from Scout phase (category: 'overview') */
  readonly fromScout: number;
  /** Number of sources from Specialist phase (section-specific queries) */
  readonly fromSpecialist: number;
}

/**
 * Result of building research context, includes tracking info.
 */
export interface ResearchContextResult {
  /** Formatted research context for LLM prompt */
  readonly context: string;
  /** Tracking of which content type was used for each source */
  readonly sourceUsage: readonly SourceUsageItem[];
  /** Sources that were discarded and why */
  readonly discardedSources: readonly DiscardedSource[];
  /** Summary stats for logging */
  readonly stats: ResearchContextStats;
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
 * URL Deduplication:
 * - If the same URL appears in multiple research results (from different queries),
 *   only the first occurrence is included to prevent token bloat.
 * - First occurrence wins (preserves relevance ordering from earlier queries).
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
    return {
      context: '',
      sourceUsage: [],
      discardedSources: [],
      stats: { totalAvailable: 0, used: 0, duplicatesRemoved: 0, limitExceeded: 0, fromScout: 0, fromSpecialist: 0 },
    };
  }

  const allSourceUsage: SourceUsageItem[] = [];
  const discardedSources: DiscardedSource[] = [];
  // Track seen URLs to prevent duplicates across research results
  const seenUrls = new Set<string>();
  
  // Stats tracking
  let totalAvailable = 0;
  let duplicatesRemoved = 0;
  let limitExceeded = 0;
  let fromScout = 0;
  let fromSpecialist = 0;

  const context = research
    .map((r, idx) => {
      // Count total available before any filtering
      totalAvailable += r.results.length;
      
      // First pass: filter duplicates and track them
      const dedupedResults: { result: SearchResultItem; positionAfterDedup: number }[] = [];
      for (const result of r.results) {
        if (seenUrls.has(result.url)) {
          duplicatesRemoved++;
          discardedSources.push({
            url: result.url,
            title: result.title,
            query: r.query,
            reason: 'duplicate_url',
          });
        } else {
          seenUrls.add(result.url);
          dedupedResults.push({ result, positionAfterDedup: dedupedResults.length + 1 });
        }
      }
      
      // Track results that exceed the limit (after dedup)
      for (let i = resultsPerResearch; i < dedupedResults.length; i++) {
        const { result, positionAfterDedup } = dedupedResults[i];
        limitExceeded++;
        discardedSources.push({
          url: result.url,
          title: result.title,
          query: r.query,
          reason: 'exceeded_limit',
          position: positionAfterDedup,
        });
      }
      
      // Take only the top N results
      // Determine phase based on category: 'overview' = scout, else specialist
      const phase = r.category === 'overview' ? 'scout' : 'specialist';
      
      const topResults = dedupedResults
        .slice(0, resultsPerResearch)
        .map(({ result }) => {
          const source = getSourceContent(result, contentPerResult);
          
          // Track origin for stats
          if (phase === 'scout') {
            fromScout++;
          } else {
            fromSpecialist++;
          }
          
          // Track usage - include search source and quality/relevance if known
          allSourceUsage.push({
            url: result.url,
            title: result.title,
            contentType: source.contentType,
            phase,
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

  return {
    context,
    sourceUsage: allSourceUsage,
    discardedSources,
    stats: {
      totalAvailable,
      used: allSourceUsage.length,
      duplicatesRemoved,
      limitExceeded,
      fromScout,
      fromSpecialist,
    },
  };
}
