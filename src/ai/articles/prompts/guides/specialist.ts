import type { ArticlePlan } from '../../article-plan';
import type { SpecialistPrompts, SpecialistSectionContext } from '../shared/specialist';

const TONE_GUIDE = `Instructional and helpful tone using second person ("you").
- Be specific with numbers, stats, and exact steps
- Use sequential language: "First," "Next," "Finally"
- Include precise details: "equip the Fire Sword, not the Ice Blade"
- Anticipate common mistakes and warn readers
- Organize information hierarchically: overview → details → advanced tips

FORMAT RULES:
- Use **bold** for key terms, item names, and ability names on first mention
- Consider numbered steps for sequential processes
- Use subheadings (###) within sections when covering multiple distinct topics
- End each section with an actionable takeaway
- Warn about common pitfalls: "Be careful not to..."`;

export const specialistPrompts: SpecialistPrompts = {
  getSystemPrompt(localeInstruction: string): string {
    return `You are the Specialist agent — an expert gaming guide writer.

Your mission: Transform research into clear, actionable instructions.

Core writing principles:
- CLARITY: Steps must be unambiguous
- ACCURACY: Every number and name must be verified
- UTILITY: Focus on helping the player succeed
- FLOW: Guide the player naturally through the process

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

    return `Write section ${ctx.sectionIndex + 1}/${ctx.totalSections} for a GUIDE article.

=== ARTICLE CONTEXT ===
Title: ${plan.title}
Game: ${gameName}
Full Outline: ${plan.sections.map((s, idx) => `${idx + 1}. ${s.headline}`).join(', ')}

=== SECTION GOAL ===
Headline: ${ctx.headline}
Goal: ${ctx.goal}
${ctx.isFirst ? 'Position: Opening (Explain what this guide covers)' : ''}
${ctx.isLast ? 'Position: Conclusion (Summarize key takeaways)' : ''}

=== RESEARCH ===
${ctx.researchContext || '(Using general context only)'}

General Overview:
${truncatedOverview}

=== PREVIOUSLY COVERED (DO NOT REPEAT) ===
${ctx.crossReferenceContext || '(None)'}

=== WRITING INSTRUCTIONS ===
- Write ${minParagraphs}-${maxParagraphs} paragraphs (unless research is thin).
- Focus on "How-To". Use imperative verbs ("Go here", "Press X").
- **Bold** important item names or locations.
- **CRITICAL:** For every key item, ability, or NPC, you MUST state the EXACT LOCATION (e.g., "in the chest behind the waterfall", "at coordinates 0250, 0145").
- **ANTI-REDUNDANCY:** Check the "PREVIOUSLY COVERED" list above. Do NOT re-explain mechanics or locations already covered. Reference them briefly if needed ("As mentioned in the previous section...").
- Do NOT repeat the section headline as a subheading.

${ctx.requiredElements ? `
Ensure you cover: ${ctx.requiredElements.join(', ')}` : ''}

Write the section now (markdown only):`;
  }
};
