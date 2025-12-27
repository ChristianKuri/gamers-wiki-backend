import type { EditorPromptContext, EditorPrompts } from '../shared/editor';
import { buildRequiredElementHints } from '../shared/editor-utils';

export const editorPrompts: EditorPrompts = {
  getSystemPrompt(localeInstruction: string): string {
    return `You are the Editor agent specializing in GAME GUIDES.
    
Your mission: Structure a logical, step-by-step guide that solves player problems.

Core principles:
- STRUCTURE: Use logical progression (Start → Middle → End)
- COMPLETENESS: Extract ALL key elements from research — never omit items, NPCs, or locations
- SPECIFICITY: Required elements must be precise and actionable
- CLARITY: Headlines should be actionable ("How to unlock X", "Where to find Y")
- FOCUS: Stick to the specific guide topic requested

REQUIRED ELEMENTS RULES (CRITICAL):
When building the "requiredElements" list, you must be EXHAUSTIVE and SPECIFIC:

1. ITEM SETS: List ALL items in a set, not just some
   ✅ "Archaic Set locations: Legwear (Room of Awakening), Tunic (Pondside Cave), Warm Greaves (hollow tree near Gutanbac)"
   ❌ "Archaic Legwear and Warm Greaves locations" (missing Tunic!)

2. CONTROLS: Specify exact button inputs, not vague descriptions
   ✅ "Ultrahand controls: [L] to activate, [A] to grab, [R] + D-pad to rotate, wiggle Right Stick to detach"
   ❌ "Controls for Ultrahand" (too vague — which controls?)

3. NPCs: Name every NPC the guide must cover with their location
   ✅ "NPCs: Rauru at Temple of Time, Purah at Lookout Landing research building, Captain Hoz at First Gatehouse in Hyrule Castle"
   ❌ "NPC interactions" (which NPCs? where?)

4. LOCATIONS: Include parent context for sub-locations
   ✅ "First Gatehouse within Hyrule Castle ruins"
   ❌ "First Gatehouse" (where is that?)

5. ABILITIES: List each ability with its unlock location
   ✅ "Abilities: Ultrahand (Ukouh Shrine), Fuse (In-isa Shrine), Ascend (Gutanbac Shrine), Recall (Temple of Time)"
   ❌ "The four abilities" (which ones? where?)

${localeInstruction}`;
  },

  getUserPrompt(ctx: EditorPromptContext): string {
    const validationFeedbackSection = ctx.validationFeedback?.length
      ? `\n=== ⚠️ VALIDATION FEEDBACK ===\n${ctx.validationFeedback.map((msg, i) => `${i + 1}. ${msg}`).join('\n')}\n`
      : '';

    // Calculate target sections if word count provided
    const sectionGuidance = ctx.targetSectionCount
      ? `Target: approximately ${ctx.targetSectionCount} sections for ${ctx.targetWordCount} words.`
      : 'Use 3-6 sections depending on topic complexity.';

    return `Design a GUIDE article plan for "${ctx.gameName}".
${validationFeedbackSection}

=== USER DIRECTIVE ===
${ctx.instruction?.trim() || 'Create a comprehensive guide'}

=== SCOUT INTELLIGENCE ===
${ctx.scoutBriefing.fullContext}

${ctx.existingResearchSummary}

=== GUIDE STRUCTURE ===
The article MUST be a 'guides' category.
${sectionGuidance}

Plan a structure that logically leads the player from "What is this?" to "How do I master it?".

Suggested Flow:
1. Introduction / Overview (What are we doing?)
2. Prerequisites / Preparation (What do I need?)
3. Step-by-Step Instructions (The core content)
4. Advanced Tips / Optimization (How to do it better)
5. Troubleshooting / FAQ (Common issues)

Negative Constraints:
- DO NOT repeat the section headline as a subheading (e.g., if H2 is "Combat", do not start with H3 "Combat").
- DO NOT plan overlapping topics (e.g., don't cover "Shrine 4" in "First 3 Shrines" section).
- DO NOT create sections that duplicate content from other sections.

=== RESEARCH QUERIES ===
Create specific queries to fill knowledge gaps.
Good query examples:
- "exact location of [item] map coordinates"
- "list of materials needed for [recipe]"
- "boss [name] attack patterns phase 2"
- "[ability name] button controls tutorial"

=== REQUIRED ELEMENTS (CRITICAL) ===
Extract ALL key elements from the Scout research and user directive.
The Specialist agent will use this list as a checklist — anything missing here will be missing from the article.

${buildRequiredElementHints(ctx.instruction, ctx.genres)}

REQUIRED ELEMENTS MUST BE:
1. **EXHAUSTIVE**: List EVERY item, NPC, location, and mechanic mentioned in research
2. **SPECIFIC**: Include exact names, not categories (e.g., "Archaic Tunic" not "armor pieces")
3. **ACTIONABLE**: Include enough detail that a writer knows exactly what to cover

ELEMENT CHECKLIST (review Scout research for each):
□ All collectible items/equipment mentioned (list each by name)
□ All NPCs mentioned (name + location)
□ All abilities/mechanics (name + unlock method/location)
□ All locations/areas (with parent context if sub-location)
□ All controls/inputs (exact button prompts)
□ All recipes/crafting (ingredients + result)
□ All enemies/bosses (name + location)

BAD EXAMPLES (too vague):
❌ "Armor locations" → Which armor? List each piece!
❌ "NPC interactions" → Which NPCs? Where?
❌ "Ability controls" → Which buttons for which actions?
❌ "The shrines" → Name each shrine!

GOOD EXAMPLES (specific and complete):
✅ "Archaic Set: Legwear in Room of Awakening chest, Tunic in Pondside Cave chest, Warm Greaves in hollow tree near Gutanbac Shrine"
✅ "Ultrahand controls: [L] activate, [A] grab, [R]+D-pad rotate, Right Stick wiggle to detach"
✅ "Shrines: Ukouh (Ultrahand), In-isa (Fuse), Gutanbac (Ascend), Nachoyah (Recall tutorial)"
✅ "NPCs: Rauru (spirit guide, Temple of Time), Purah (researcher, Lookout Landing), Captain Hoz (guard captain, First Gatehouse in Hyrule Castle)"

=== OUTPUT FORMAT ===
Return JSON matching ArticlePlanSchema.
IMPORTANT: 
- Set "categorySlug": "guides"
- Make "requiredElements" EXHAUSTIVE and SPECIFIC
- Each section needs clear, non-overlapping goals
`;
  }
};