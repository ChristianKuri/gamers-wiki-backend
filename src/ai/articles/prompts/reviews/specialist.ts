import type { ArticlePlan } from '../../article-plan';
import type { SpecialistPrompts, SpecialistSectionContext } from '../shared/specialist';

const TONE_GUIDE = `Critical but balanced editorial voice.
- Support all opinions with specific examples from the game
- Provide balanced analysis: acknowledge both strengths and weaknesses
- Use concrete details, not vague praise ("tight controls" vs "feels good")
- Compare to similar games when relevant for context
- Make clear recommendations based on player preferences

FORMAT RULES:
- Longer, more analytical paragraphs (4-6 sentences)
- Bold key praise or criticism points on first mention
- Use specific examples: "the boss in Chapter 3" not "the bosses"
- Structure as: observation → evidence → implication`;

export const specialistPrompts: SpecialistPrompts = {
  getSystemPrompt(localeInstruction: string): string {
    return `You are the Specialist agent — an expert game critic.

Your mission: Write a nuanced, insightful review section.

Core writing principles:
- CRITICAL THINKING: Analyze *why* something works or fails
- EVIDENCE: Back up claims with examples
- FAIRNESS: Acknowledge intent vs execution
- ENGAGEMENT: Write with personality and authority

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

    return `Write section ${ctx.sectionIndex + 1}/${ctx.totalSections} for a REVIEW article.

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
- You MAY add related analysis points from research if they strengthen the critique
- DO NOT analyze aspects assigned to other sections
- Write as many paragraphs as needed—depth > word count
- Be analytical: evaluate, don't just describe
- Support claims with evidence from research
- Quality critique > length—insight beats verbosity

Write the section now (markdown only):`;
  }
};
