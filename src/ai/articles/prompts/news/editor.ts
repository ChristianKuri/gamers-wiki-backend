import type { EditorPromptContext, EditorPrompts } from '../shared/editor';
import { buildRequiredElementHints } from '../shared/editor-utils';

export const editorPrompts: EditorPrompts = {
  getSystemPrompt(localeInstruction: string): string {
    return `You are the Editor agent specializing in GAME NEWS.
    
Your mission: Structure a news report that prioritizes the most important facts first (Inverted Pyramid).

Core principles:
- HIERARCHY: Most critical info (5 Ws) in the first section
- CONTEXT: Follow up with background and implications
- ACCURACY: Stick strictly to the announced facts
- BREVITY: Don't fluff. Get to the point.

${localeInstruction}`;
  },

  getUserPrompt(ctx: EditorPromptContext): string {
    const validationFeedbackSection = ctx.validationFeedback?.length
      ? `\n=== ⚠️ VALIDATION FEEDBACK ===\n${ctx.validationFeedback.map((msg, i) => `${i + 1}. ${msg}`).join('\n')}\n`
      : '';

    return `Design a NEWS article plan for "${ctx.gameName}".
${validationFeedbackSection}

=== SCOUT INTELLIGENCE ===
${ctx.scoutBriefing.fullContext}

=== ${ctx.existingResearchSummary}

=== NEWS STRUCTURE ===
The article MUST be a 'news' category.
Inverted Pyramid structure:
1. The Lead (Who, What, When, Where, Why)
2. Important Details (Features, Quotes, Specs)
3. Background / Context (Previous events, development history)
4. Community Reaction / Impact (What does this mean?)

=== RESEARCH QUERIES ===
Focus on verifying exact details.
Examples:
- "official release date [region]"
- "exact quote from [developer] interview"
- "patch note v1.2 changes list"

=== REQUIRED ELEMENTS ===
${buildRequiredElementHints(ctx.instruction, ctx.genres)}

=== OUTPUT FORMAT ===
Return JSON matching ArticlePlanSchema.
IMPORTANT: Set "categorySlug": "news".
`;
  }
};
