import type { ArticlePlan } from '../../article-plan';
import type { SpecialistPrompts, SpecialistSectionContext } from '../shared/specialist';

const TONE_GUIDE = `Engaging and comparative tone with consistent criteria.
- Justify each ranking or selection with clear reasoning
- Use consistent evaluation criteria across all items
- Provide context: "Best for beginners" vs "Best for endgame"
- Balance objective facts with subjective assessment
- End each entry with a clear takeaway or recommendation

FORMAT RULES:
- Each list item should follow the same structure
- Bold the item name/title at the start of each entry
- Include a brief "why it's here" justification
- Consider using ### subheadings for each list item if the section covers multiple items`;

export const specialistPrompts: SpecialistPrompts = {
  getSystemPrompt(localeInstruction: string): string {
    return `You are the Specialist agent — a curator of game lists.

Your mission: Write engaging entries that justify their place on the list.

Core writing principles:
- CONSISTENCY: Treat every entry with the same depth
- COMPARISON: Explain why X is better than Y
- AUTHORITY: Show you understand the meta/gameplay
- FLAVOR: Make descriptions fun to read

${localeInstruction}

CATEGORY-SPECIFIC TONE:
${TONE_GUIDE}`;
  },

  getSectionUserPrompt(
    ctx: SpecialistSectionContext,
    plan: ArticlePlan,
    gameName: string,
    maxScoutOverviewLength: number,
    minParagraphs: number,
    maxParagraphs: number
  ): string {
    const truncatedOverview =
      ctx.scoutOverview.length > maxScoutOverviewLength
        ? `${ctx.scoutOverview.slice(0, maxScoutOverviewLength)}
...(truncated)`
        : ctx.scoutOverview;

    // Build awareness of what OTHER sections will cover
    const otherSectionsCoverage = plan.sections
      .filter((_, idx) => idx !== ctx.sectionIndex)
      .map((s) => `• ${s.headline}: ${s.mustCover.slice(0, 2).join(', ')}${s.mustCover.length > 2 ? '...' : ''}`)
      .join('\n');

    const mustCoverList = ctx.mustCover.length > 0
      ? `\n=== MUST COVER (Non-negotiable) ===\n${ctx.mustCover.map((item) => `• ${item}`).join('\n')}\n`
      : '';

    return `Write section ${ctx.sectionIndex + 1}/${ctx.totalSections} for a LIST article.

=== ARTICLE CONTEXT ===
Title: ${plan.title}
Game: ${gameName}
Full Outline: ${plan.sections.map((s, idx) => `${idx + 1}. ${s.headline}`).join(', ')}

=== SECTION GOAL ===
Headline: ${ctx.headline}
Goal: ${ctx.goal}
${mustCoverList}
=== OTHER SECTIONS COVER (Don't duplicate) ===
${otherSectionsCoverage}

=== RESEARCH ===
${ctx.researchContext || '(Using general context only)'}

General Overview:
${truncatedOverview}

=== WRITING INSTRUCTIONS ===
- You MUST cover everything in "MUST COVER" above
- You MAY add 1-2 related items from research if they naturally fit this section's theme
- DO NOT cover items assigned to other sections
- Write as many paragraphs as needed—completeness > word count
- Highlight key stats/features for each list item
- Explain *why* each item belongs with specific reasoning
- Be thorough but concise—quality > filler

Write the section now (markdown only):`;
  }
};
