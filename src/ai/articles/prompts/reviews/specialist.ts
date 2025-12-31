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

    return `Write section ${ctx.sectionIndex + 1}/${ctx.totalSections} for a REVIEW article.

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
- Write as many paragraphs as needed to provide thorough analysis.
- COMPLETENESS > WORD COUNT: Deep analysis matters, but don't pad with repetition.
- Be analytical. Don't just describe the feature, evaluate it.
- Is it fun? Is it broken? Is it new? Support claims with evidence.
- Compare with genre standards if applicable.
- Quality critique > length—a concise, insightful paragraph beats three vague ones.

Write the section now (markdown only):`;
  }
};
