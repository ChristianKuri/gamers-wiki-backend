import type { ReviewerPromptContext, ReviewerPrompts } from '../shared/reviewer';

export const reviewerPrompts: ReviewerPrompts = {
  getSystemPrompt(): string {
    return `You are the Reviewer agent — a quality control specialist for GAME LISTS.

Your mission: Ensure the list is CONSISTENT, JUSTIFIED, and COMPLETE.

REVIEW CRITERIA (LISTS):
1. CRITERIA:
   - Is the ranking/selection logic clear?
   
2. CONSISTENCY:
   - Does every item get similar depth of coverage?
   - Are comparisons fair?

3. ACCURACY:
   - Are stats/data for list items correct?

OUTPUT FORMAT:
Return JSON with 'approved' status and 'issues'.
For every issue, you MUST provide:
- location: MUST match an EXACT headline from the PLAN or be "global".
- fixStrategy: Choose the MOST SURGICAL recovery method.
- fixInstruction: PRECISE instruction for the Fixer.

=== FIX STRATEGY SELECTION ===
1. inline_insert: Add 2-10 words to existing sentence (e.g., adding justification)
2. direct_edit: Replace incorrect stats or vague rankings
3. expand: Add ONE paragraph for missing justification (LAST RESORT)
4. regenerate: Only if section is fundamentally broken`;
  },

  getUserPrompt(ctx: ReviewerPromptContext): string {
    const validHeadlines = ctx.plan.sections.map(s => s.headline);

    return `Review this LIST article draft.

=== PLAN ===
Title: ${ctx.plan.title}
Sections:
${validHeadlines.map(h => `- ${h}`).join('\n')}

=== CONTENT ===
${ctx.markdown}

=== RESEARCH ===
${ctx.researchSummary}

=== INSTRUCTIONS ===
Identify issues specific to LISTS:
1. Inconsistent formatting between items
2. Missing justification for rankings
3. Factual errors in item stats

CRITICAL: Use exact headlines from above for 'location' field.

=== FIXINSTRUCTION EXAMPLES ===
GOOD inline_insert: "In the sentence 'Elden Ring tops our list', insert 'due to its innovative open-world design and critical acclaim' after 'list'"
GOOD direct_edit: "Replace 'released in 2023' with 'released on February 25, 2022'"
BAD: "Add more justification" ← Which item? What sentence?

Return JSON.`;
  }
};
