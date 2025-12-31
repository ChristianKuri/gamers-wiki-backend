import type { ArticlePlan } from '../../article-plan';
import type { SpecialistPrompts, SpecialistSectionContext } from '../shared/specialist';

const TONE_GUIDE = `Professional and objective reporting tone.
- Use inverted pyramid structure: most important information first
- Attribute all claims to sources ("according to developer", "announced on Twitter")
- State facts clearly without editorializing or personal opinion
- Use active voice and concise sentences
- Lead with what happened, when, and why it matters

FORMAT RULES:
- Short, punchy paragraphs (2-4 sentences each)
- Bold the key news element in the opening paragraph
- Include quotes from official sources when available
- End with context about what this means for players`;

export const specialistPrompts: SpecialistPrompts = {
  getSystemPrompt(localeInstruction: string): string {
    return `You are the Specialist agent — a game news reporter.

Your mission: Report the facts accurately and concisely.

Core writing principles:
- ACCURACY: Zero tolerance for errors in dates, names, or quotes
- ATTRIBUTION: Always state where info comes from
- OBJECTIVITY: Keep personal opinion out (unless analyzing community reaction)
- SPEED: Get to the point immediately

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

    return `Write section ${ctx.sectionIndex + 1}/${ctx.totalSections} for a NEWS article.

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
- Write as many paragraphs as needed to cover the news completely.
- COMPLETENESS > WORD COUNT: Cover all key facts without padding.
- Stick to the facts found in research—don't invent details.
- Use direct quotes if available in the research snippets.
- Maintain a professional, journalistic tone.
- Be concise: if you can cover everything in 2 paragraphs, that's better than stretching to 4.

Write the section now (markdown only):`;
  }
};
