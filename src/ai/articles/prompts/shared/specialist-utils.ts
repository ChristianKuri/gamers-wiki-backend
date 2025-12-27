import type { CategorizedSearchResult } from '../../types';

/**
 * Builds research context for a section.
 */
export function buildResearchContext(
  research: readonly CategorizedSearchResult[],
  resultsPerResearch: number,
  contentPerResult: number
): string {
  if (research.length === 0) return '';

  return research
    .map((r, idx) => {
      const topResults = r.results
        .slice(0, resultsPerResearch)
        .map(
          (result) =>
            `  - ${result.title} (${result.url})\n    ${result.content.slice(0, contentPerResult)}`
        )
        .join('\n');

      return `Research ${idx + 1} [${r.category}]: "${r.query}"
AI Summary: ${r.answer || '(none)'}
Results:
${topResults}`;
    })
    .join('\n\n---\n\n');
}
