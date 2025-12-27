import type { EditorPromptContext, EditorPrompts } from './editor';
import { buildRequiredElementHints } from './editor-utils';

export const genericEditorPrompts: EditorPrompts = {
  getSystemPrompt(localeInstruction: string): string {
    return `You are the Editor agent — a strategic article architect for game journalism.

Your mission: Design a compelling, well-researched article outline that balances reader value with journalistic rigor.

Core competencies:
- STRATEGIC STRUCTURE: Organize information in a logical, engaging flow
- RESEARCH EFFICIENCY: Create queries that complement existing research (not duplicate it)
- CATEGORY EXPERTISE: Select the format that best serves the content and reader
- AUDIENCE AWARENESS: Tailor depth and tone to reader expectations
- QUALITY GATEKEEPING: Plan only what can be factually supported

${localeInstruction}`;
  },

  getUserPrompt(ctx: EditorPromptContext): string {
    const validationFeedbackSection = ctx.validationFeedback?.length
      ? `\n=== ⚠️ VALIDATION FEEDBACK (FIX THESE ISSUES) ===\nYour previous plan failed validation. Fix these specific issues:\n${ctx.validationFeedback.map((msg, i) => `${i + 1}. ${msg}`).join('\n')}\n`
      : '';

    return `Design an article plan for "${ctx.gameName}".
${validationFeedbackSection}

=== USER DIRECTIVE ===
${ctx.instruction?.trim() || '(No specific directive — determine best article type from context)'}

=== COMPREHENSIVE SCOUT INTELLIGENCE ===
${ctx.scoutBriefing.fullContext}

=== ${ctx.existingResearchSummary}

=== GAME METADATA ===
- Name: ${ctx.gameName}
- Genre: ${ctx.genres?.join(', ') || 'unknown'}

=== CATEGORY SELECTION GUIDE ===
Choose the categorySlug that delivers maximum reader value:
• news: Breaking announcements, updates
• reviews: Critical analysis, scoring
• guides: How-to content, tutorials
• lists: Ranked compilations

${ctx.categoryHintsSection}

=== STRUCTURAL REQUIREMENTS ===
- title: Compelling headline
- excerpt: Meta description (120-160 chars)
- tags: 3-8 topic tags
- sections: ${ctx.targetSectionCount ? `Target ${ctx.targetSectionCount} sections` : '4-8 sections'}

=== REQUIRED ELEMENTS ===
${buildRequiredElementHints(ctx.instruction, ctx.genres)}

=== OUTPUT FORMAT ===
Return JSON matching ArticlePlanSchema.
`;
  }
};
