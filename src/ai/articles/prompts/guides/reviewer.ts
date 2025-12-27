import type { ReviewerPromptContext, ReviewerPrompts } from '../shared/reviewer';

export const reviewerPrompts: ReviewerPrompts = {
  getSystemPrompt(): string {
    return `You are the Reviewer agent — a meticulous quality control specialist for GAME GUIDES.

Your mission: Ensure the guide is ACCURATE, ACTIONABLE, and COMPLETE.

REVIEW CRITERIA (GUIDES):
1. LOCATION NAMING (CRITICAL):
   - Every ability, item, or unlock MUST state WHERE it is obtained.
   - Accept context from the IMMEDIATE preceding sentence (e.g. "Enter the Temple. Inside, you find the Map" is OK).

2. SPECIFICITY:
   - Flag vague references like "the fourth shrine" or "the final ability".
   - Guides must use proper names.

3. CONSISTENCY:
   - Section titles must match content (e.g. "Three Shrines" vs 4 items listed).

4. COVERAGE:
   - Are all required elements (from plan) covered?
   - Are instructions clear and sequential?

OUTPUT FORMAT:
Return JSON with 'approved' status and 'issues'.
For every issue, you MUST provide:
- location: MUST match an EXACT headline from the PLAN or be "global".
- fixStrategy: Choose the best recovery method.
- fixInstruction: CLEAR step-by-step for the Fixer.`;
  },

  getUserPrompt(ctx: ReviewerPromptContext): string {
    // Build required elements checklist with location requirements
    const requiredElementsChecklist = ctx.plan.requiredElements?.length
      ? `
=== REQUIRED ELEMENTS VERIFICATION (CRITICAL) ===
For each element below, verify it meets ALL criteria:
${ctx.plan.requiredElements.map((e, i) => `${i + 1}. ${e}`).join('\n')}

VERIFICATION CRITERIA:
□ NAMED EXPLICITLY (No vague references)
□ LOCATION STATED (Where is it obtained?)
□ EXPLAINED (Not just listed)
□ ACTIONABLE (How to use it)`
      : '';

    // Build list of valid headlines for location matching
    const validHeadlines = ctx.plan.sections.map(s => s.headline);

    return `Review this GUIDE article draft.

=== PLAN ===
Title: ${ctx.plan.title}
Sections:
${validHeadlines.map(h => `- ${h}`).join('\n')}

${requiredElementsChecklist}

=== CONTENT ===
${ctx.markdown}

=== RESEARCH ===
${ctx.researchSummary}

=== INSTRUCTIONS ===
Identify issues specific to GUIDES:
1. Missing locations for items/abilities (Flag as MAJOR coverage issue)
   - Note: Check surrounding sentences before flagging. If context is clear, do NOT flag.
2. Vague references ("the item", "the shrine") instead of proper names
3. Unclear instructions
4. Missing required elements

CRITICAL: For the 'location' field in your JSON output, you MUST use one of the exact headlines listed above.
If an issue spans multiple sections or the whole article, use "global".
DO NOT invent location names or combine headlines.

Decide fixStrategy:
- direct_edit: For vague names, missing locations, typos, or minor factual errors
- expand: For missing details/explanations within a section
- regenerate: For sections that are fundamentally broken or outdated

Return JSON`;
  }
};
