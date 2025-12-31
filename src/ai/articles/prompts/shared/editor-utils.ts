import type { ArticleCategorySlug } from '../../article-plan';
import type { CategoryHint, ScoutOutput } from '../../types';

// ============================================================================ 
// Required Elements Hints
// ============================================================================ 

/**
 * Instruction keywords that suggest specific required element types.
 */
export const INSTRUCTION_ELEMENT_HINTS: ReadonlyArray<{
  readonly keywords: readonly string[];
  readonly elements: readonly string[];
  readonly note: string;
}> = [
  {
    keywords: ['beginner', 'first hour', 'starting', 'new player', 'getting started'],
    elements: ['ALL core abilities/mechanics', 'starting location', 'first objectives', 'essential controls', 'early game tips'],
    note: 'For beginner content, ensure ALL fundamental mechanics are listed - missing one is a critical gap.',
  },
  {
    keywords: ['walkthrough', 'guide', 'how to'],
    elements: ['key items/equipment', 'important NPCs', 'critical locations', 'step-by-step objectives'],
    note: 'Walkthroughs need complete coverage - readers will be stuck if you skip a step.',
  },
  {
    keywords: ['build', 'class', 'character'],
    elements: ['recommended stats', 'skill priorities', 'equipment choices', 'playstyle description'],
    note: 'Build guides need specific stat/skill recommendations, not vague suggestions.',
  },
  {
    keywords: ['boss', 'defeat', 'beat', 'strategy'],
    elements: ['boss weaknesses', 'recommended level/gear', 'attack patterns', 'phase changes'],
    note: 'Boss guides need tactical details - readers want to win, not just survive.',
  },
  {
    keywords: ['collectible', 'location', 'find', 'where'],
    elements: ['exact locations', 'prerequisites', 'rewards', 'missable warnings'],
    note: 'Location guides need precision - "somewhere in the cave" is not helpful.',
  },
  {
    keywords: ['review', 'worth', 'should i'],
    elements: ['gameplay strengths', 'gameplay weaknesses', 'target audience', 'value proposition', 'comparison to similar games'],
    note: 'Reviews need balanced analysis - don\'t just praise or criticize.',
  },
  {
    keywords: ['news', 'announced', 'update', 'patch', 'release'],
    elements: ['what changed/announced', 'when it happens', 'who is affected', 'official source'],
    note: 'News needs the 5 Ws - incomplete news is misleading news.',
  },
  {
    keywords: ['best', 'top', 'ranking', 'tier'],
    elements: ['ranking criteria', 'at least 5-7 items', 'pros/cons for each', 'use case for each'],
    note: 'Lists need clear criteria - "best" is meaningless without context.',
  },
];

/**
 * Genre-specific element hints that apply regardless of instruction.
 */
export const GENRE_ELEMENT_HINTS: ReadonlyMap<string, readonly string[]> = new Map([
  ['rpg', ['character progression', 'skill/ability system', 'equipment/gear']],
  ['action rpg', ['combat mechanics', 'build options', 'boss encounters']],
  ['open world', ['key locations', 'exploration mechanics', 'fast travel points']],
  ['puzzle', ['core puzzle mechanics', 'hint system', 'difficulty progression']],
  ['shooter', ['weapons/loadouts', 'map knowledge', 'game modes']],
  ['strategy', ['resource management', 'unit types', 'win conditions']],
  ['survival', ['resource gathering', 'crafting basics', 'threat management']],
  ['platformer', ['movement mechanics', 'collectibles', 'level progression']],
]);

/**
 * Builds instruction-aware required element hints.
 */
export function buildRequiredElementHints(
  instruction: string | null | undefined,
  genres: readonly string[] | undefined
): string {
  const hints: string[] = [];
  const instructionLower = (instruction ?? '').toLowerCase();

  // Find matching instruction hints
  const matchedInstructionHints = INSTRUCTION_ELEMENT_HINTS.filter((hint) =>
    hint.keywords.some((keyword) => instructionLower.includes(keyword))
  );

  if (matchedInstructionHints.length > 0) {
    hints.push('Based on the user instruction, you MUST include:');
    for (const hint of matchedInstructionHints) {
      hints.push(`• ${hint.elements.join(', ')}`);
      hints.push(`  ⚠️ ${hint.note}`);
    }
  }

  // Find matching genre hints
  if (genres && genres.length > 0) {
    const genreElements: string[] = [];
    for (const genre of genres) {
      const genreLower = genre.toLowerCase();
      for (const [key, elements] of GENRE_ELEMENT_HINTS) {
        if (genreLower.includes(key)) {
          genreElements.push(...elements);
        }
      }
    }

    if (genreElements.length > 0) {
      const uniqueGenreElements = [...new Set(genreElements)];
      hints.push(`
Based on the game's genre (${genres.slice(0, 3).join(', ')}), consider including:`);
      hints.push(`• ${uniqueGenreElements.slice(0, 5).join(', ')}`);
    }
  }

  return hints.join('\n');
}

/**
 * Builds the category hints section for the Editor prompt.
 */
export function buildCategoryHintsSection(
  hints: readonly CategoryHint[] | undefined
): string {
  if (!hints || hints.length === 0) return '';
  const lines = hints.map((h) => {
    const p = (h.systemPrompt || '').trim();
    return p.length > 0 ? `- ${h.slug}: ${p}` : `- ${h.slug}`;
  });
  return `\n\nAvailable categories (pick ONE categorySlug):\n${lines.join('\n')}`;
}

/**
 * Builds the existing research summary for Editor context.
 */
export function buildExistingResearchSummary(
  scoutOutput: ScoutOutput,
  overviewPreviewLines: number
): string {
  const overviewSearches = scoutOutput.researchPool.scoutFindings.overview.map((s) => `"${s.query}"`).join(', ');
  const categorySearches = scoutOutput.researchPool.scoutFindings.categorySpecific.map((s) => `"${s.query}"`).join(', ');
  const recentSearches = scoutOutput.researchPool.scoutFindings.recent.map((s) => `"${s.query}"`).join(', ');
  const totalSources = scoutOutput.researchPool.allUrls.size;
  const overviewPreview = scoutOutput.briefing.overview.split('\n').slice(0, overviewPreviewLines).join('\n');

  return `EXISTING RESEARCH COVERAGE:\nOverview searches: ${overviewSearches}\nCategory searches: ${categorySearches}\nRecent searches: ${recentSearches}\nTotal sources: ${totalSources}\n\nThe research pool already contains comprehensive information on:\n${overviewPreview}\n...\n\nWhen creating research queries, focus on SPECIFIC details not yet fully covered.`;
}

/**
 * Builds the top sources content for Editor context.
 * Shows the FULL cleaned content from the best source (highest quality + relevance) 
 * from each search query so the Editor can see actual content when planning.
 *
 * Note: Gemini Flash 3 has 1M token context, so we can include full articles
 * from all 6 queries (~6 full web pages) without truncation.
 *
 * @param scoutOutput - The Scout output containing topSourcesPerQuery
 * @returns Formatted string with top sources, or empty string if none available
 */
export function buildTopSourcesSummary(scoutOutput: ScoutOutput): string {
  const topSources = scoutOutput.topSourcesPerQuery;
  if (!topSources || topSources.length === 0) {
    return '';
  }

  const sections: string[] = [
    '=== TOP SOURCES FROM RESEARCH (Full content from best source per query) ===',
    'These are the FULL cleaned articles from the highest-quality, most relevant source for each search.',
    'Use this actual content to extract items, locations, NPCs, mechanics, and plan comprehensive sections.',
    '',
  ];

  for (let i = 0; i < topSources.length; i++) {
    const source = topSources[i];

    sections.push(`--- SOURCE ${i + 1}: "${source.query}" (${source.searchSource}) ---`);
    sections.push(`Title: ${source.title}`);
    sections.push(`URL: ${source.url}`);
    sections.push(`Quality: ${source.qualityScore}/100, Relevance: ${source.relevanceScore}/100`);
    sections.push(`Character count: ${source.content.length.toLocaleString()}`);
    sections.push('');
    sections.push(source.content);
    sections.push('');
    sections.push('--- END OF SOURCE ---');
    sections.push('');
  }

  return sections.join('\n');
}
