import type { EditorPromptContext, EditorPrompts } from '../shared/editor';
import { buildRequiredElementHints, SEO_TITLE_GUIDANCE, SEO_EXCERPT_DESCRIPTION_GUIDANCE } from '../shared/editor-utils';

export const editorPrompts: EditorPrompts = {
  getSystemPrompt(localeInstruction: string): string {
    return `You are the Editor agent specializing in GAME REVIEWS.
    
Your mission: Structure a comprehensive, critical analysis of the game.

Core principles:
- BALANCE: Ensure both positives and negatives are covered
- DEPTH: Plan sections for deep dives into mechanics, not just surface impressions
- COMPARISON: Include context from the genre
- VERDICT: Build towards a definitive conclusion

${localeInstruction}`;
  },

  getUserPrompt(ctx: EditorPromptContext): string {
    const validationFeedbackSection = ctx.validationFeedback?.length
      ? `\n=== ⚠️ VALIDATION FEEDBACK ===\n${ctx.validationFeedback.map((msg, i) => `${i + 1}. ${msg}`).join('\n')}\n`
      : '';

    return `Design a REVIEW article plan for "${ctx.gameName}".
${validationFeedbackSection}
Suggested title from Scout (STARTING POINT ONLY): "${ctx.draftTitle}"

=== SOURCE SUMMARIES ===
${ctx.sourceSummariesSection}

${ctx.topDetailedSummaries ? `${ctx.topDetailedSummaries}\n` : ''}
=== ${ctx.existingResearchSummary}
${ctx.topSourcesSummary ? `\n${ctx.topSourcesSummary}\n` : ''}
${SEO_TITLE_GUIDANCE}

${SEO_EXCERPT_DESCRIPTION_GUIDANCE}

=== REVIEW STRUCTURE ===
The article MUST be a 'reviews' category.
Standard review structure:
1. Introduction (Hook & Context)
2. Gameplay & Mechanics (The core loop)
3. Story & World (Narrative, atmosphere)
4. Technical Performance (Graphics, sound, bugs)
5. Verdict / Conclusion (Final thoughts)

=== RESEARCH QUERIES ===
Focus on consensus and technical details.
Examples:
- "community consensus on story ending"
- "performance issues PS5 vs PC"
- "campaign length hours to beat"

=== REQUIRED ELEMENTS ===
${buildRequiredElementHints(ctx.instruction, ctx.genres)}
Ensure "Pros" and "Cons" are planned for discussion.

=== OUTPUT FORMAT ===
Return JSON matching ArticlePlanSchema.
IMPORTANT: Set "categorySlug": "reviews".
`;
  }
};
