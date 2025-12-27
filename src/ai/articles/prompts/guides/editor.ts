import type { EditorPromptContext, EditorPrompts } from '../shared/editor';
import { buildRequiredElementHints } from '../shared/editor-utils';

export const editorPrompts: EditorPrompts = {
  getSystemPrompt(localeInstruction: string): string {
    return `You are the Editor agent specializing in GAME GUIDES.
    
Your mission: Structure a logical, step-by-step guide that solves player problems.

Core principles:
- STRUCTURE: Use logical progression (Start -> Middle -> End)
- COMPLETENESS: Ensure all prerequisites and requirements are listed
- CLARITY: Headlines should be actionable ("How to unlock X", "Where to find Y")
- FOCUS: Stick to the specific guide topic requested

${localeInstruction}`;
  },

  getUserPrompt(ctx: EditorPromptContext): string {
    const validationFeedbackSection = ctx.validationFeedback?.length
      ? `\n=== ⚠️ VALIDATION FEEDBACK ===\n${ctx.validationFeedback.map((msg, i) => `${i + 1}. ${msg}`).join('\n')}\n`
      : '';

    return `Design a GUIDE article plan for "${ctx.gameName}".
${validationFeedbackSection}

=== USER DIRECTIVE ===
${ctx.instruction?.trim() || 'Create a comprehensive guide'}

=== SCOUT INTELLIGENCE ===
${ctx.scoutBriefing.fullContext}

=== ${ctx.existingResearchSummary}

=== GUIDE STRUCTURE ===
The article MUST be a 'guides' category.
Plan a structure that logically leads the player from "What is this?" to "How do I master it?".

Suggested Flow:
1. Introduction / Overview (What are we doing?)
2. Prerequisites / Preparation (What do I need?)
3. Step-by-Step Instructions (The core content)
4. Advanced Tips / Optimization (How to do it better)
5. Troubleshooting / FAQ (Common issues)

Negative Constraints:
- DO NOT repeat the section headline as a subheading (e.g., if H2 is "Combat", do not start with H3 "Combat").
- DO NOT plan overlapping topics (e.g., don't cover "Shrine 4" in "First 3 Shrines").

=== RESEARCH QUERIES ===
Create specific queries to fill gaps.
Examples:
- "exact location of [item] map coordinates"
- "list of materials needed for [recipe]"
- "boss [name] attack patterns phase 2"

=== REQUIRED ELEMENTS ===
${buildRequiredElementHints(ctx.instruction, ctx.genres)}

=== OUTPUT FORMAT ===
Return JSON matching ArticlePlanSchema.
IMPORTANT: Set "categorySlug": "guides".
`;
  }
};
