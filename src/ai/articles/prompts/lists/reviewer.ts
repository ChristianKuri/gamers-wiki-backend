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
Return JSON with 'approved' status and 'issues'.`;
  },

  getUserPrompt(ctx: ReviewerPromptContext): string {
    return `Review this LIST article draft.

=== PLAN ===
Title: ${ctx.plan.title}
Sections: ${ctx.plan.sections.length} planned

=== CONTENT ===
${ctx.markdown}

=== RESEARCH ===
${ctx.researchSummary}

=== INSTRUCTIONS ===
Identify issues specific to LISTS:
1. Inconsistent formatting between items
2. Missing justification for rankings
3. Factual errors in item stats

Return JSON.`;
  }
};
