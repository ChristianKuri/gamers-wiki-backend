/**
 * Editor Agent Prompts
 *
 * Prompts for the article planning Editor agent.
 */

import type { ArticleCategorySlug } from '../article-plan';
import type { CategoryHint, ScoutOutput } from '../types';

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

sections: 4-8 sections (3 minimum, 12 maximum allowed by schema)
  - Each section has: headline, goal, researchQueries[]
  - headline: Section title (2-5 words)
  - goal: Internal note on section purpose (1 sentence)
  - researchQueries: 1-6 specific questions to research

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
  ]
}

Design your article plan now:`;
}

