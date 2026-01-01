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
    _maxScoutOverviewLength: number,
    minParagraphs: number,
    maxParagraphs: number
  ): string {
    // Build query briefings section
    const queryBriefingsSection = ctx.queryBriefings.length > 0
      ? ctx.queryBriefings.map((b, i) => 
          `Query ${i + 1}: "${b.query}"
Findings: ${b.findings}
Key Facts: ${b.keyFacts.length > 0 ? b.keyFacts.join('; ') : '(none)'}`
        ).join('\n\n')
      : '(No briefings available)';

    // Build awareness of what OTHER sections will cover
    const otherSectionsCoverage = plan.sections
      .filter((_, idx) => idx !== ctx.sectionIndex)
      .map((s) => `• ${s.headline}: ${s.mustCover.slice(0, 2).join(', ')}${s.mustCover.length > 2 ? '...' : ''}`)
      .join('\n');

    const mustCoverList = ctx.mustCover.length > 0
      ? `\n=== MUST COVER (Non-negotiable) ===\n${ctx.mustCover.map((item) => `• ${item}`).join('\n')}\n`
      : '';

    return `Write section ${ctx.sectionIndex + 1}/${ctx.totalSections} for a NEWS article.

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

=== SCOUT BRIEFINGS ===
${queryBriefingsSection}

=== WRITING INSTRUCTIONS ===
- You MUST cover everything in "MUST COVER" above
- You MAY add 1-2 related facts from research if they naturally fit
- DO NOT cover topics assigned to other sections
- Write as many paragraphs as needed—completeness > word count
- Stick to facts found in research—don't invent details
- Use direct quotes if available
- Professional, journalistic tone

Write the section now (markdown only):`;
  }
};
