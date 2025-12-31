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

    return `Write section ${ctx.sectionIndex + 1}/${ctx.totalSections} for a LIST article.

=== ARTICLE CONTEXT ===
Title: ${plan.title}
Game: ${gameName}
Full Outline: ${plan.sections.map((s, idx) => `${idx + 1}. ${s.headline}`).join(', ')}

=== SECTION GOAL ===
Headline: ${ctx.headline}
Goal: ${ctx.goal}

=== RESEARCH ===
${ctx.researchContext || '(Using general context only)'}

General Overview:
${truncatedOverview}

=== WRITING INSTRUCTIONS ===
- Write as many paragraphs as needed to fully cover each list item.
- COMPLETENESS > WORD COUNT: Every item deserves proper justification, but don't pad.
- If this section covers a list item, make sure to highlight its key stats/features.
- Explain *why* it belongs in this list/rank with specific reasoning.
- Use comparison points from other list items if possible.
- Be thorough but concise—quality explanations, not filler text.

Write the section now (markdown only):`;
  }
};
