import type { EditorPromptContext, EditorPrompts } from '../shared/editor';
import { buildRequiredElementHints } from '../shared/editor-utils';

export const editorPrompts: EditorPrompts = {
  getSystemPrompt(localeInstruction: string): string {
    return `You are the Editor agent for AI-generated game guides across ALL game types (RPG, FPS, strategy, puzzle, etc.).

MISSION: Create complete, actionable guide structures that solve player problems step-by-step.

CORE PRINCIPLES:
• COMPLETENESS: Every element MUST include WHAT + WHERE + HOW
• EXHAUSTIVE: Extract ALL key elements from research, no omissions
• CLARITY: Actionable headlines ("How to X", "Where to find Y")
• STRUCTURE: Adapt flow to guide type (walkthrough vs boss vs collectibles vs builds)

⚠️ CRITICAL: mustCover ACCOUNTABILITY ⚠️
Every requiredElement MUST be assigned to exactly ONE section's mustCover array.
The Specialist agent ONLY sees mustCover — omitted elements disappear from the final article.
Missing assignments = missing content in final article.

ELEMENT FORMAT RULE: "[Type]: [NAME] ([WHERE], [HOW])"
Each element needs 3 parts:
1. WHAT: Type + specific name (not categories)
2. WHERE: Precise location with context
3. HOW: Acquisition method/purpose/controls

✅ "Item: Archaic Tunic (chest in Pondside Cave southeast of Temple, accessible after Ultrahand unlock)"
✅ "NPC: Rauru (Temple of Time main entrance, provides story exposition and Recall ability)"
✅ "Ability: Ultrahand (Ukouh Shrine on Great Sky Island, [L] activate → [A] grab → [R]+D-pad rotate)"
❌ "Archaic Set locations" ← Vague! WHERE exactly? HOW to get each piece?
❌ "NPC interactions" ← WHO? WHERE? WHAT do they do?
❌ "Ultrahand" ← WHERE unlocked? HOW to use?

${localeInstruction}`;
  },

  getUserPrompt(ctx: EditorPromptContext): string {
    const validationFeedbackSection = ctx.validationFeedback?.length
      ? `\n=== ⚠️ VALIDATION FEEDBACK ===\n${ctx.validationFeedback.map((msg, i) => `${i + 1}. ${msg}`).join('\n')}\n`
      : '';

    const sectionGuidance = ctx.targetSectionCount
      ? `Target: ~${ctx.targetSectionCount} sections for ${ctx.targetWordCount} words.`
      : 'Use 3-6 sections depending on complexity.';

    return `Design a GUIDE article plan for "${ctx.gameName}".
${validationFeedbackSection}
=== USER REQUEST ===
${ctx.instruction?.trim() || 'Create a comprehensive guide'}

=== SCOUT RESEARCH ===
${ctx.scoutBriefing.fullContext}

${ctx.existingResearchSummary}

=== STRUCTURE ===
Category: 'guides' | ${sectionGuidance}

Adapt structure to guide type:
• Walkthrough/Quest: Overview → Prerequisites → Step-by-step → Tips → Troubleshooting
• Boss/Combat: Preparation → Phase breakdown → Strategy → Rewards
• Collectibles/Items: Overview → Location list (grouped logically) → Acquisition methods
• Build/Loadout: Concept → Core items → Alternatives → Playstyle tips

=== REQUIRED ELEMENTS (EXTRACT FROM RESEARCH) ===
⚠️ CRITICAL: Format EVERY element as "[Type]: [NAME] ([WHERE], [HOW])" ⚠️

Element type templates (WHAT + WHERE + HOW):
• Items: "Item: Iron Sword (chest in Dungeon Level 2 east wing, behind locked door requiring Bronze Key)"
• NPCs: "NPC: Merchant Beedle (Kakariko Village east entrance, sells arrows and elixirs)"
• Abilities: "Ability: Double Jump (unlocked at Sky Tower after defeating Wind Boss, press A twice)"
• Locations: "Location: Hidden Cave (north of Zora's Domain past waterfall, accessible via Zephyr ability)"
• Enemies: "Enemy: Lynel (Coliseum Ruins in Central Hyrule, weak to ice arrows and perfect dodges)"

${buildRequiredElementHints(ctx.instruction, ctx.genres)}

=== OUTPUT FORMAT ===
⚠️ VALIDATION BEFORE OUTPUT ⚠️
1. Every section MUST have mustCover array (no exceptions)
2. Every requiredElement MUST appear in EXACTLY ONE mustCover (no duplicates, no orphans)
3. mustCover strings MUST match requiredElements exactly (copy/paste)
4. Every element MUST have all 3 parts: WHAT (Type: Name) + WHERE (location) + HOW (method/purpose)
5. Distribute elements evenly across sections (avoid one section with 10 items, another with 1)

Output structure validated by ArticlePlanSchema. Example of good output:
{
  "title": "Actionable guide title (e.g., 'How to Get the Master Sword in Tears of the Kingdom')",
  "categorySlug": "guides",
  "excerpt": "Single sentence describing what the guide accomplishes",
  "tags": ["relevant-topic", "game-mechanic", "item-name"],
  "requiredElements": [
    "Item: Master Sword (Korok Forest Sacred Grove, complete 13 hearts requirement)",
    "Item: Heart Container (various shrines, 4 spirit orbs each)",
    "Location: Korok Forest (north of Hyrule Castle through Lost Woods, follow torch pattern)"
  ],
  "sections": [
    {
      "headline": "Preparing for the Master Sword",
      "goal": "Ensure player has required health and knows where to go",
      "researchQueries": [
        "Master Sword heart requirement Tears of the Kingdom",
        "fastest shrines for heart containers TOTK"
      ],
      "mustCover": [
        "Item: Heart Container (various shrines, 4 spirit orbs each)"
      ]
    },
    {
      "headline": "Navigating the Lost Woods to Korok Forest",
      "goal": "Guide player through Lost Woods maze to reach the sword location",
      "researchQueries": [
        "Lost Woods torch pattern solution TOTK",
        "Korok Forest entrance map location"
      ],
      "mustCover": [
        "Location: Korok Forest (north of Hyrule Castle through Lost Woods, follow torch pattern)",
        "Item: Master Sword (Korok Forest Sacred Grove, complete 13 hearts requirement)"
      ]
    }
  ]
}
`;
  }
};
