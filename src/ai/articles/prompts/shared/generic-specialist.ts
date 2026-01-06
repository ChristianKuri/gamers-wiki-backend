import type { ArticlePlan } from '../../article-plan';
import type { SpecialistPrompts, SpecialistSectionContext } from './specialist';
import { SPECIALIST_CONFIG } from '../../config';

/**
 * Gets category-specific tone guidance for the Specialist.
 */
export function getCategoryToneGuide(categorySlug: string): string {
  // Simplified map for generic fallback
  const guides: Record<string, string> = {
    news: `Professional and objective reporting tone.`,
    reviews: `Critical but balanced editorial voice.`,
    guides: `Instructional and helpful tone using second person ("you").`,
    lists: `Engaging and comparative tone with consistent criteria.`,
  };

  return guides[categorySlug] || `Professional and engaging tone suitable for game journalism.`;
}

export const genericSpecialistPrompts: SpecialistPrompts = {
  getSystemPrompt(localeInstruction: string): string {
    return `You are the Specialist agent — an expert gaming journalist who writes engaging, accurate, well-researched content.

Your mission: Transform research into compelling prose that informs and engages readers while maintaining strict factual integrity.

Core writing principles:
- EVIDENCE-BASED: Every claim must be grounded in the provided research
- READER-FIRST: Write for human readers, not search engines. Be engaging but never sensational.
- FLOW & CONTINUITY: Each section should connect naturally to the article's narrative arc
- VOICE CONSISTENCY: Maintain appropriate tone throughout
- INTELLECTUAL HONESTY: Acknowledge uncertainty rather than fabricate details

PRECISION RULES (CRITICAL):
When stating numbers, durations, or statistics:
- NEVER invent exact numbers without explicit source verification
- Use hedging language: "approximately", "around", "typically", "roughly", "about"

${localeInstruction}`;
  },

  getSectionUserPrompt(
    ctx: SpecialistSectionContext,
    plan: ArticlePlan,
    gameName: string
  ): string {
    // Build source summaries section
    const maxSummaries = SPECIALIST_CONFIG.MAX_SOURCE_SUMMARIES_IN_PROMPT;
    const sourceSummariesSection = (ctx.sourceSummaries ?? []).length > 0
      ? ctx.sourceSummaries!.slice(0, maxSummaries).map((s, i) => 
          `Source ${i + 1}: "${s.title}"
Summary: ${s.detailedSummary}
Key Facts: ${s.keyFacts.length > 0 ? s.keyFacts.slice(0, 10).join('; ') : '(none)'}`
        ).join('\n\n')
      : '(No source summaries available)';

    const positionText = ctx.isFirst
      ? 'Opening section (set the stage, no preamble needed)'
      : ctx.isLast
        ? 'Closing section (provide satisfying conclusion)'
        : 'Middle section (develop key points)';

    return `Write section ${ctx.sectionIndex + 1} of ${ctx.totalSections} for this article.

=== ARTICLE CONTEXT ===
Category: ${plan.categorySlug}
Game: ${gameName}
Full Outline: ${plan.sections.map((s, idx) => `${idx + 1}. ${s.headline}`).join(', ')}

=== CURRENT SECTION ===
Headline: ${ctx.headline}
Internal Goal: ${ctx.goal}
Position: ${positionText}

=== SOURCE SUMMARIES ===
${sourceSummariesSection}

Section-Specific Research:
${ctx.researchContext || '(Using Scout research only for this section)'}

=== WRITING GUIDELINES ===
- Write as many paragraphs as needed—completeness > word count
- Use **bold** for key terms
- Write flowing prose, not bullet points

Write the section now (markdown only):`;
  }
};
