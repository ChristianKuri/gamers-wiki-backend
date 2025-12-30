import type { EditorPromptContext, EditorPrompts } from '../shared/editor';
import { buildRequiredElementHints } from '../shared/editor-utils';

export const editorPrompts: EditorPrompts = {
  getSystemPrompt(localeInstruction: string): string {
    return `You are the Editor agent specializing in GAME LISTS.
    
Your mission: Structure a ranked or curated list with clear criteria.

Core principles:
- CONSISTENCY: Each item should have similar coverage
- CRITERIA: Why are things in this order?
- SELECTION: Ensure the "Best" items are actually included
- FLOW: Group or rank items logically

${localeInstruction}`;
  },

  getUserPrompt(ctx: EditorPromptContext): string {
    const validationFeedbackSection = ctx.validationFeedback?.length
      ? `
=== ⚠️ VALIDATION FEEDBACK ===
${ctx.validationFeedback.map((msg, i) => `${i + 1}. ${msg}`).join('\n')}
`
      : '';

    return `Design a LIST article plan for "${ctx.gameName}".
${validationFeedbackSection}

=== SCOUT INTELLIGENCE ===
${ctx.scoutBriefing.fullContext}

=== ${ctx.existingResearchSummary}

=== LIST STRUCTURE ===
The article MUST be a 'lists' category.
Structure:
1. Introduction (Criteria & Scope)
2. The List Items (One section per item/group, or grouped by tier)
   - Ensure you plan for at least 5-10 items
   - Section headlines should be the item names or rank groups
3. Conclusion / Summary

=== RESEARCH QUERIES ===
Focus on comparison data.
Examples:
- "stats for [weapon A]"
- "[character] tier list placement consensus"
- "pros and cons of [item]"

=== REQUIRED ELEMENTS ===
${buildRequiredElementHints(ctx.instruction, ctx.genres)}
Ensure the "Top" items identified in research are included.

=== OUTPUT FORMAT ===
Return JSON matching ArticlePlanSchema.
IMPORTANT: Set "categorySlug": "lists".
`;
  }
};
