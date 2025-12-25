/**
 * Editor Agent Prompts
 *
 * Prompts for the article planning Editor agent.
 */

import type { ArticleCategorySlug } from '../article-plan';
import type { CategoryHint, ScoutOutput } from '../types';

// ============================================================================
// Required Elements Hints
// ============================================================================

/**
 * Instruction keywords that suggest specific required element types.
 * Used to generate more targeted hints for the Editor.
 */
const INSTRUCTION_ELEMENT_HINTS: ReadonlyArray<{
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
const GENRE_ELEMENT_HINTS: ReadonlyMap<string, readonly string[]> = new Map([
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
 * Builds instruction-aware required element hints for the Editor prompt.
 * Analyzes the user instruction and game genres to suggest specific elements
 * that MUST be covered in the article.
 *
 * @param instruction - The user's article instruction (e.g., "first hour beginner guide")
 * @param genres - The game's genres from IGDB
 * @returns Formatted string with specific element hints
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
      hints.push(`\nBased on the game's genre (${genres.slice(0, 3).join(', ')}), consider including:`);
      hints.push(`• ${uniqueGenreElements.slice(0, 5).join(', ')}`);
    }
  }

  // Default fallback if no specific hints matched
  if (hints.length === 0) {
    hints.push('Identify the core elements readers would expect based on the article type.');
  }

  return hints.join('\n');
}

export interface EditorPromptContext {
  readonly gameName: string;
  readonly releaseDate?: string | null;
  readonly genres?: readonly string[];
  readonly platforms?: readonly string[];
  readonly developer?: string | null;
  readonly publisher?: string | null;
  readonly instruction?: string | null;
  readonly localeInstruction: string;
  readonly scoutBriefing: ScoutOutput['briefing'];
  readonly existingResearchSummary: string;
  readonly categoryHintsSection: string;
  /** Target word count for the article (influences section count) */
  readonly targetWordCount?: number;
  /** Recommended number of sections based on word count */
  readonly targetSectionCount?: number;
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
  return `EXISTING RESEARCH COVERAGE:
Overview searches: ${scoutOutput.researchPool.scoutFindings.overview.map((s) => `"${s.query}"`).join(', ')}
Category searches: ${scoutOutput.researchPool.scoutFindings.categorySpecific.map((s) => `"${s.query}"`).join(', ')}
Recent searches: ${scoutOutput.researchPool.scoutFindings.recent.map((s) => `"${s.query}"`).join(', ')}
Total sources: ${scoutOutput.researchPool.allUrls.size}

The research pool already contains comprehensive information on:
${scoutOutput.briefing.overview.split('\n').slice(0, overviewPreviewLines).join('\n')}
...

When creating research queries, focus on SPECIFIC details not yet fully covered.`;
}

/**
 * System prompt for the Editor agent.
 */
export function getEditorSystemPrompt(localeInstruction: string): string {
  return `You are the Editor agent — a strategic article architect for game journalism.

Your mission: Design a compelling, well-researched article outline that balances reader value with journalistic rigor.

Core competencies:
- STRATEGIC STRUCTURE: Organize information in a logical, engaging flow
- RESEARCH EFFICIENCY: Create queries that complement existing research (not duplicate it)
- CATEGORY EXPERTISE: Select the format that best serves the content and reader
- AUDIENCE AWARENESS: Tailor depth and tone to reader expectations
- QUALITY GATEKEEPING: Plan only what can be factually supported

${localeInstruction}`;
}

/**
 * User prompt for the Editor agent.
 */
export function getEditorUserPrompt(ctx: EditorPromptContext): string {
  return `Design an article plan for "${ctx.gameName}".

=== USER DIRECTIVE ===
${ctx.instruction?.trim() || '(No specific directive — determine best article type from context)'}

=== COMPREHENSIVE SCOUT INTELLIGENCE ===
${ctx.scoutBriefing.fullContext}

=== ${ctx.existingResearchSummary}

=== GAME METADATA ===
- Name: ${ctx.gameName}
- Release Date: ${ctx.releaseDate || 'unknown'}
- Genres: ${ctx.genres?.join(', ') || 'unknown'}
- Platforms: ${ctx.platforms?.join(', ') || 'unknown'}
- Developer: ${ctx.developer || 'unknown'}
- Publisher: ${ctx.publisher || 'unknown'}

=== CATEGORY SELECTION GUIDE ===
Choose the categorySlug that delivers maximum reader value:

• news: Breaking announcements, updates, patches, release dates, industry events
  - Best for: Time-sensitive information, official announcements, recent developments
  - Avoid if: Information is evergreen or instructional

• reviews: Critical analysis, scoring, recommendation, pros/cons evaluation
  - Best for: Post-release assessment, comparative analysis, editorial opinion
  - Requires: Enough source material for substantive critique

• guides: How-to content, tutorials, strategies, walkthroughs, optimization tips
  - Best for: Helping players solve problems or improve performance
  - Requires: Actionable, step-by-step information

• lists: Ranked compilations, curated collections, comparison articles
  - Best for: Multiple items to compare, "top X" or "best of" formats
  - Requires: At least 5-7 items to list/compare

${ctx.categoryHintsSection}

=== RESEARCH QUERY CRAFTING ===
Each section needs 1-6 researchQueries. Make them SPECIFIC and TARGETED.

IMPORTANT: We already have extensive research from Scout. Create queries that:
1. Fill SPECIFIC gaps in existing knowledge
2. Target DETAILS needed for this particular section
3. AVOID repeating what Scout already covered

✓ GOOD: "What are the specific combo inputs for Elden Ring magic builds?"
✓ GOOD: "How long does it take to complete Hollow Knight 100%?"
✓ GOOD: "What weapons are in the latest Hades patch 1.5?"

✗ BAD: "Tell me about Elden Ring" (Scout already covered this)
✗ BAD: "Is it good?" (subjective, not researchable)
✗ BAD: "Elden Ring gameplay overview" (redundant with Scout overview)

Quality criteria for research queries:
- Complement (not duplicate) existing Scout research
- Target section-specific details, not general overviews
- Can be answered with specific facts from search results
- Target concrete information (mechanics, dates, features, specs)
- Each query should yield distinct, additive information

=== STRUCTURAL REQUIREMENTS ===

title: Compelling, SEO-friendly headline (50-70 characters ideal)
  - Include game name
  - Indicate article type/value prop
  - Avoid clickbait; be specific

excerpt: Meta description (MUST be 120-160 characters)
  - Summarize article value
  - Include primary keyword
  - Write for search results display

tags: 3-8 short topic tags (no hashtags, no @ symbols)
  - Examples: "action RPG", "PS5 exclusive", "multiplayer guide"
  - Use reader search terms, not marketing jargon

sections: ${ctx.targetSectionCount ? `Target ${ctx.targetSectionCount} sections` : '4-8 sections'} (4 minimum, 12 maximum allowed by schema)
  - Each section has: headline, goal, researchQueries[]
  - headline: Section title (2-5 words)
  - goal: Internal note on section purpose (1 sentence)
  - researchQueries: 1-6 specific questions to research
${ctx.targetWordCount ? `\nTarget word count: ~${ctx.targetWordCount} words total. Plan sections accordingly.` : ''}

=== REQUIRED ELEMENTS (CRITICAL) ===
Identify 3-8 KEY ELEMENTS that MUST be covered in the article.
These are non-negotiable facts, mechanics, locations, or topics that readers will expect.
Missing a required element will trigger a validation warning.

${buildRequiredElementHints(ctx.instruction, ctx.genres)}

Category-specific baseline (always include these types):
• guides: Core abilities, key locations, essential items, critical quests, important NPCs
• reviews: Main strengths, main weaknesses, key mechanics, target audience, comparison points
• news: Who, what, when, where, why - the key facts of the announcement/event
• lists: The items being ranked/listed (minimum 5-7 items)

IMPORTANT: For beginner/tutorial content, list ALL core abilities or mechanics the player will encounter.
Example for a Zelda first-hour guide (ALL 4 abilities listed):
"requiredElements": ["Ultrahand ability", "Fuse ability", "Ascend ability", "Recall ability", "Great Sky Island", "Temple of Time", "Paraglider"]

Output these in the "requiredElements" field. The Specialist will verify coverage.

=== CONTENT POLICY ===
The Specialist agent will enforce these rules, but plan accordingly:
- NO pricing information or "buy now" calls-to-action
- NO numeric review scores unless categorySlug is "reviews"
- NO speculation beyond what sources support
- NO release date promises unless officially confirmed

=== OUTPUT FORMAT ===
Return ONLY valid JSON matching ArticlePlanSchema. Structure:
{
  "title": "...",
  "categorySlug": "news|reviews|guides|lists",
  "excerpt": "...",
  "tags": ["...", "..."],
  "sections": [
    {
      "headline": "...",
      "goal": "...",
      "researchQueries": ["...", "..."]
    }
  ],
  "requiredElements": ["element1", "element2", "..."]
}

Design your article plan now:`;
}

