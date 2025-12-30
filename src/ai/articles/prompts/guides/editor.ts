import type { EditorPromptContext, EditorPrompts } from '../shared/editor';
import { buildRequiredElementHints } from '../shared/editor-utils';

export const editorPrompts: EditorPrompts = {
  getSystemPrompt(localeInstruction: string): string {
    return `You are the Editor agent for AI-generated game guides. Your job is to create COMPLETE article plans.

██████████████████████████████████████████████████████████████████████████████
██  COMPLETENESS IS YOUR #1 PRIORITY                                        ██
██  A missing item in the plan = missing content in the final article       ██
██  The Specialist ONLY writes what's in mustCover — nothing else           ██
██████████████████████████████████████████████████████████████████████████████

=== TWO-PHASE PROCESS (MANDATORY) ===

PHASE 1: EXTRACT EVERYTHING
Before planning sections, you MUST exhaustively extract from Scout research:
• Every armor piece, weapon, consumable, key item
• Every ability, power, or skill unlock
• Every shrine, dungeon, cave, landmark
• Every NPC who gives items, quests, or critical info
• Every game mechanic that needs explanation

Ask yourself: "If I were a player following this guide, what would I be upset to discover I missed?"

PHASE 2: PLAN SECTIONS
Only AFTER extraction, organize elements into sections.
• Sections are FLEXIBLE — add more if needed for completeness
• Completeness > brevity — a longer complete guide beats a short incomplete one
• Every extracted element MUST appear in exactly one section's mustCover

=== ELEMENT FORMAT (STRICT) ===

Format: "[Type]: [NAME] ([PARENT LOCATION] > [SPECIFIC LOCATION], [HOW/CONTROLS])"

CONTROLS FORMAT — Use [X] brackets with action verbs:
✅ "[L] hold to activate → [A] press to grab → [R] hold + D-pad to rotate"
✅ "[ZR] hold to aim → [A] press to fire"
❌ "hold L to activate and R+D-pad to rotate" ← Ambiguous!
❌ "press the ability button" ← Too vague!

LOCATION FORMAT — Parent > Child hierarchy:
✅ "Great Sky Island > Pondside Cave, chest inside main chamber"
✅ "Lookout Landing > Research Center second floor"
❌ "in a cave nearby" ← WHERE nearby?
❌ "west of the temple" ← WHICH temple? What region?

NPC FORMAT — 4 required parts:
✅ "NPC: Purah (Lookout Landing > Research Center, lead researcher, provides Paraglider after quest)"
✅ "NPC: Rauru (Great Sky Island > Temple of Time entrance, first King of Hyrule, grants Recall ability)"
❌ "NPC: Purah (gives paraglider)" ← Missing WHERE and ROLE

EXAMPLES:
✅ "Item: Archaic Tunic (Great Sky Island > Pondside Cave, chest in main chamber after Ultrahand)"
✅ "Ability: Ultrahand (Great Sky Island > Ukouh Shrine, [L] hold activate → [A] grab → [R] hold + D-pad rotate)"
✅ "Location: Mining Cave (Great Sky Island > south of snowy peaks, cooking pot at entrance for cold resistance)"

${localeInstruction}`;
  },

  getUserPrompt(ctx: EditorPromptContext): string {
    const validationFeedbackSection = ctx.validationFeedback?.length
      ? `\n=== ⚠️ VALIDATION FEEDBACK (FIX THESE) ===\n${ctx.validationFeedback.map((msg, i) => `${i + 1}. ${msg}`).join('\n')}\n`
      : '';


    return `Create a COMPLETE guide plan for "${ctx.gameName}".
${validationFeedbackSection}
=== USER REQUEST ===
${ctx.instruction?.trim() || 'Create a comprehensive guide'}

=== SCOUT RESEARCH (YOUR SOURCE — EXTRACT EVERYTHING) ===
${ctx.scoutBriefing.fullContext}

${ctx.existingResearchSummary}

██████████████████████████████████████████████████████████████████████████████
██  PHASE 1: EXHAUSTIVE EXTRACTION (Do this mentally BEFORE planning)       ██
██████████████████████████████████████████████████████████████████████████████

Scan the Scout research above and identify EVERY:

□ ITEMS: Armor pieces, weapons, shields, consumables, key items, materials
  → For each: What's the EXACT name? WHERE is it? HOW do you get it?
  
□ ABILITIES: Powers, skills, unlockable moves
  → For each: What's the name? WHERE unlocked? WHAT are the EXACT controls?
  
□ LOCATIONS: Shrines, dungeons, caves, landmarks, settlements
  → For each: What's the name? WHERE is it relative to known landmarks?
  
□ NPCs: Characters who give items, quests, info, or tutorials
  → For each: Name? WHERE do they appear? Role? What do they provide?
  
□ MECHANICS: Systems that need explanation (cooking, crafting, combat)
  → For each: What's the mechanic? WHERE is it introduced? HOW does it work?

⚠️ COMMON MISTAKES TO AVOID:
• Listing "Archaic Set" instead of each piece separately (Tunic, Legwear, Warm Greaves)
• Forgetting NPCs who only appear briefly but give critical items
• Missing the cooking pot location when cold resistance is needed
• Vague controls like "use the ability" instead of exact button inputs

██████████████████████████████████████████████████████████████████████████████
██  PHASE 2: SECTION PLANNING                                               ██
██████████████████████████████████████████████████████████████████████████████

Category: 'guides'

SECTION PLANNING:
• Create as many sections as the content requires
• Each section should have 2-4 mustCover elements
• Every extracted element must have a home in exactly one section

STRUCTURE TEMPLATES:
• Walkthrough: Opening → Phase 1 → Phase 2 → ... → Conclusion
• Boss Guide: Preparation → Phase breakdown → Strategy → Rewards
• Area Guide: Overview → Subarea 1 → Subarea 2 → ... → Secrets

${buildRequiredElementHints(ctx.instruction, ctx.genres)}

=== OUTPUT REQUIREMENTS ===

The "requiredElements" array must contain EVERY element you extracted in Phase 1.
Each section's "mustCover" must contain elements from requiredElements (copy EXACT strings).

██████████████████████████████████████████████████████████████████████████████
██  CRITICAL VALIDATION STEP (DO THIS BEFORE OUTPUTTING JSON!)              ██
██████████████████████████████████████████████████████████████████████████████

Before generating the final JSON, mentally verify this mapping:

For EACH item in requiredElements, confirm it appears in EXACTLY ONE section's mustCover:
  requiredElements[0] → sections[?].mustCover  (which section?)
  requiredElements[1] → sections[?].mustCover  (which section?)
  ... and so on for ALL elements

⚠️ COMMON BUG: Adding an item to requiredElements but forgetting to put it in ANY mustCover!
This causes the Specialist to NOT write about that item, making the article incomplete.

VERIFICATION CHECKLIST:
□ Count requiredElements: N items
□ Sum all mustCover arrays: should also equal N items
□ If counts don't match → FIX IT before outputting!
□ Every item from Scout research is in requiredElements
□ Every requiredElement appears in EXACTLY ONE section's mustCover
□ No section has 0 mustCover items
□ All controls use [X] bracket format with action verbs
□ All locations have Parent > Child hierarchy

OUTPUT STRUCTURE:
{
  "title": "Clear, actionable title with game name",
  "categorySlug": "guides",
  "excerpt": "120-160 char description of what the guide accomplishes",
  "tags": ["game-name", "topic", "key-item-or-ability"],
  "requiredElements": [
    "Item: Archaic Tunic (Great Sky Island > Pondside Cave, chest in main chamber)",
    "Item: Archaic Legwear (Great Sky Island > Room of Awakening, chest near exit)",
    "Item: Archaic Warm Greaves (Great Sky Island > near Gutanbac Shrine, chest in hollowed tree)",
    "Ability: Ultrahand (Great Sky Island > Ukouh Shrine, [L] hold → [A] grab → [R] hold + D-pad rotate)",
    "Ability: Fuse (Great Sky Island > In-isa Shrine, [L] hold → select material → attach to weapon)",
    "NPC: Rauru (Great Sky Island > Temple of Time entrance, first King of Hyrule, grants abilities)"
  ],
  "sections": [
    {
      "headline": "Clear section title",
      "goal": "What player accomplishes in this section",
      "researchQueries": [
        "\"Game Name\" specific topic guide",
        "Game Name how to do specific thing"
      ],
      "mustCover": [
        "Item: Archaic Tunic (Great Sky Island > Pondside Cave, chest in main chamber)",
        "Item: Archaic Legwear (Great Sky Island > Room of Awakening, chest near exit)"
      ]
    }
  ]
}

RESEARCH QUERY FORMAT (CRITICAL):
• ALWAYS include the game name at the START of every query
• Use quotes around game name for exact match: "Elden Ring" how to get Torrent
• Be specific: "Elden Ring" Torrent mount unlock location (NOT just "how to get Torrent")
• Bad: "How to get Torrent" → returns mod sites, unrelated results
• Good: "Elden Ring" Torrent spectral steed how to unlock location
`;
  }
};
