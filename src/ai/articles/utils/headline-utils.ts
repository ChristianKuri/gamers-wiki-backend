/**
 * Headline Utilities
 *
 * Shared headline matching functions used across the article generation system.
 * Used by both image-curator.ts and image-inserter.ts for consistent matching.
 */

import type { Logger } from '../../../utils/logger';

// ============================================================================
// Constants
// ============================================================================

/**
 * Minimum similarity ratio (0-1) for partial headline matching.
 * Prevents loose matches like "Boss" matching "Boss Strategy Guide" (33% similarity).
 * Set to 0.6 (60%) to require substantial overlap.
 */
const PARTIAL_MATCH_THRESHOLD = 0.6;

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a headline match operation.
 */
export interface HeadlineMatch {
  /** The matched headline from the source */
  readonly headline: string;
  /** Line number where the headline was found */
  readonly lineNumber: number;
  /** How the match was made */
  readonly matchType: 'exact' | 'normalized' | 'partial';
}

/**
 * Normalizes a headline for comparison.
 * Removes special characters and converts to lowercase.
 *
 * @param headline - Headline to normalize
 * @returns Normalized headline
 *
 * @example
 * normalizeHeadline('Boss Strategy: Tips & Tricks') // 'boss strategy tips  tricks'
 */
export function normalizeHeadline(headline: string): string {
  return headline.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

/**
 * Finds the best matching headline from a map of headlines to line numbers.
 * Uses strict matching to avoid false positives with similar headlines.
 *
 * Matching priority:
 * 1. Exact match (case-sensitive)
 * 2. Normalized match (case-insensitive, ignores punctuation)
 * 3. Partial match (only if >60% similarity to prevent loose matches)
 *
 * @param targetHeadline - The headline to find
 * @param headlineMap - Map of headlines to their line numbers
 * @param logger - Optional logger for debug output
 * @returns Match result or null if not found
 *
 * @example
 * const sections = new Map([['Boss Strategy', 10], ['Weapons Guide', 25]]);
 * findMatchingHeadline('boss strategy', sections); // { headline: 'Boss Strategy', lineNumber: 10, matchType: 'normalized' }
 */
export function findMatchingHeadline(
  targetHeadline: string,
  headlineMap: Map<string, number>,
  logger?: Logger
): HeadlineMatch | null {
  const normalizedTarget = normalizeHeadline(targetHeadline);

  // First try exact match
  if (headlineMap.has(targetHeadline)) {
    return {
      headline: targetHeadline,
      lineNumber: headlineMap.get(targetHeadline)!,
      matchType: 'exact',
    };
  }

  // Try normalized match (preferred over partial)
  for (const [headline, lineNumber] of headlineMap) {
    if (normalizeHeadline(headline) === normalizedTarget) {
      return { headline, lineNumber, matchType: 'normalized' };
    }
  }

  // Partial match as last resort - but only if one side fully contains the other
  // AND the contained string is reasonably long (>50% of the container)
  // This prevents "Boss" from matching "Final Boss Strategy Guide"
  let bestPartialMatch: { headline: string; lineNumber: number; similarity: number } | null = null;

  for (const [headline, lineNumber] of headlineMap) {
    const normalizedHeadline = normalizeHeadline(headline);

    // Check if one contains the other
    let similarity = 0;
    if (normalizedHeadline.includes(normalizedTarget)) {
      similarity = normalizedTarget.length / normalizedHeadline.length;
    } else if (normalizedTarget.includes(normalizedHeadline)) {
      similarity = normalizedHeadline.length / normalizedTarget.length;
    }

    // Only accept partial matches above threshold (prevents loose matching)
    if (similarity > PARTIAL_MATCH_THRESHOLD && (!bestPartialMatch || similarity > bestPartialMatch.similarity)) {
      bestPartialMatch = { headline, lineNumber, similarity };
    }
  }

  if (bestPartialMatch) {
    logger?.debug(
      `[HeadlineUtils] Partial headline match: "${targetHeadline}" → "${bestPartialMatch.headline}" ` +
        `(${Math.round(bestPartialMatch.similarity * 100)}% similarity)`
    );
    return {
      headline: bestPartialMatch.headline,
      lineNumber: bestPartialMatch.lineNumber,
      matchType: 'partial',
    };
  }

  return null;
}

/**
 * Builds a map of H2 headlines to their line numbers from markdown.
 * Useful when you need to look up multiple headlines without re-parsing.
 *
 * @param markdown - Raw markdown string or array of lines
 * @returns Map of headline text to line number (1-indexed for display, 0-indexed for array access)
 *
 * @example
 * const h2Map = buildH2LineMap('# Title\n\n## Boss Strategy\nContent...');
 * // Map { 'Boss Strategy' => 2 } (1-indexed)
 */
export function buildH2LineMap(markdown: string | readonly string[]): Map<string, number> {
  const lines = typeof markdown === 'string' ? markdown.split('\n') : markdown;
  const h2Map = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^##\s+(.+)$/);
    if (match) {
      const headline = match[1].trim();
      h2Map.set(headline, i + 1); // 1-indexed for consistency with line numbers
    }
  }

  return h2Map;
}

/**
 * Finds the line number of an H2 header in markdown lines.
 * Uses the same strict matching logic as findMatchingHeadline.
 *
 * @param lines - Array of markdown lines
 * @param targetHeadline - The headline to find
 * @param logger - Optional logger for debug output
 * @returns Line number (0-indexed) or -1 if not found
 *
 * @example
 * const lines = ['# Title', '', '## Boss Strategy', 'Content...'];
 * findH2LineNumber(lines, 'boss strategy'); // 2
 */
export function findH2LineNumber(
  lines: readonly string[],
  targetHeadline: string,
  logger?: Logger
): number {
  // Build a map of H2 headlines to line numbers (0-indexed for array access)
  const h2Map = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^##\s+(.+)$/);
    if (match) {
      h2Map.set(match[1], i);
    }
  }

  // Use shared matching logic
  const result = findMatchingHeadline(targetHeadline, h2Map, logger);
  return result?.lineNumber ?? -1;
}
