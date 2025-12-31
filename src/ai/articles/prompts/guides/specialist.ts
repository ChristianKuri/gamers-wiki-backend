import type { ArticlePlan } from '../../article-plan';
import type { SpecialistPrompts, SpecialistSectionContext } from '../shared/specialist';

// =============================================================================
// Complete example showing ideal output structure
// =============================================================================
const COMPLETE_EXAMPLE = `
EXAMPLE OF PERFECT SECTION:

### Unlocking Your First Abilities

Begin your adventure by acquiring essential abilities on the **Great Sky Island**. Head to the **Ukouh Shrine**, located on the island's western side near the **Temple of Time**. Inside, you'll unlock **Ultrahand**, your first Zonai ability. Press **[L]** to activate it and **[A]** to attach objects together—this ability is essential for solving environmental puzzles throughout your journey.

After clearing the shrine, explore the surrounding area to find the **Room of Awakening** within the temple's lower caverns. Here you'll discover a chest containing **Archaic Legwear**, providing basic defense for early encounters. Be careful not to miss the **Old Wooden Shield** leaning against the wall near the exit, as shields are crucial for surviving your first combat scenarios.

Next, travel to **Lookout Landing**, the settlement southeast of the Great Sky Island. At the **Research Center**, meet **Purah**, the director of ancient technology research, who provides the **Paraglider**—your primary tool for traversing Hyrule's vast landscapes. She'll also explain the importance of activating Skyview Towers to reveal map regions.

With these foundational abilities and equipment, you're ready to explore Hyrule's surface and begin tackling shrines and quests across the kingdom.
`;

// =============================================================================
// Core writing rules (consolidated and simplified)
// =============================================================================
const CORE_WRITING_RULES = `
WRITING PRINCIPLES:
You are writing a game guide section that helps players succeed. Your output should be:

• CLEAR: Players know exactly what to do next
• ACCURATE: Every specific detail comes from the research provided
• HELPFUL: Focus on practical information players need
• NATURAL: Write like a knowledgeable human sharing tips, not a robot following templates

TONE AND STRUCTURE:
• Use second person ("you") with an instructional, helpful tone
• Be specific with numbers, steps, and item names: "equip the Fire Sword" not "equip a weapon"
• Use sequential language when appropriate: "First," "Next," "After that," "Finally"
• Anticipate common mistakes: "Be careful not to miss..."
• Keep paragraphs focused (3-5 sentences) and end sections with actionable takeaways
• Write naturally—vary your sentence structure and avoid repetitive patterns
`;

// =============================================================================
// Precision rules (the most critical part)
// =============================================================================
const PRECISION_RULES = `
PRECISION REQUIREMENTS:

**1. Name Things Immediately**
When introducing anything with a proper name, lead with the name:
✅ "the **Shadow Temple**, the fourth dungeon in the region"
✅ "**Commander Vance**, leader of the Royal Guard, directs you to the fortress"
✅ "**Thornwood Village**, a fortified settlement south of the capital"

Not like this:
"the fourth dungeon in the region, known as the Shadow Temple" (name arrives too late)
"the commander directs you" (which commander?)

**2. NPCs Need Full Context**
Every NPC introduction must include four elements:
• Name (bolded): **Captain Roderick**
• Location: at the **Fortress Gate**
• Role/title: commander of the southern garrison
• Purpose: who briefs you on the invasion plans

✅ "At the **Sanctuary Entrance**, speak with **High Priestess Elara**, keeper of ancient knowledge, who grants you the **Blessing of Light**"
✅ "Inside the **Research Center** at **Lookout Landing**, meet **Purah**, the director of ancient technology research, who provides the **Paraglider**"

**3. Nested Locations Need Parent Context**
Sub-locations must include their parent location:
✅ "the **East Gatehouse** within the **Royal Castle** grounds"
✅ "the **Room of Awakening** inside the **Great Sky Island** caverns"
✅ "**Captain Mira** at the **Watch Tower** inside **Fort Helgen**"

**4. MustCover Elements Use EXACT Phrasing**
When the research specifies mustCover requirements, copy location names, controls, and stats verbatim:
• If it says "western side" → write "western side" (not "west area" or "southwest coast")
• If it says "Room of Awakening" → write "Room of Awakening" (not "awakening chamber" or "before the cave exit")
• If it says "[L] to activate" → write "[L] to activate" (not "press the ability button")

✅ mustCover: "Inn-isa Shrine on the island's western side" → you write: "on the island's western side"
✅ mustCover: "[L] to activate and [A] to attach" → you write: "Press [L] to activate and [A] to attach"
`;

// =============================================================================
// Factual accuracy (anti-hallucination)
// =============================================================================
const FACTUAL_ACCURACY = `
FACTUAL ACCURACY (Anti-Hallucination):

Only include specific details that appear in your research. Never invent:
• UI elements (icon colors, menu layouts, map markers)
• Exact numbers (damage stats, percentages, coordinates)
• Visual descriptions (chest appearance, lighting effects)
• Compass directions not stated in research

EXAMPLES - Safe vs Risky:
✅ SAFE: "found in a chest near the shrine exit" (general location)
❌ RISKY: "in a green glowing chest with gold trim" (visual detail not in research)

✅ SAFE: "growing on bushes in the cold region" (general area)
❌ RISKY: "marked by blue and white icons on your map" (UI detail not verified)

✅ SAFE: "located near the ancient ruins" (relative description)
❌ RISKY: "at coordinates (-2156, 145, 1678)" (exact numbers not in research)

✅ SAFE: "south of the main temple" (only if research says "south")
❌ RISKY: "northwest of the temple" (direction not confirmed in research)

When in doubt, be LESS specific rather than inventing details.
`;

// =============================================================================
// Natural language (avoiding AI patterns)
// =============================================================================
const NATURAL_LANGUAGE = `
WRITE LIKE A HUMAN:

Use direct, conversational language. Avoid these common AI phrases:
• "dive into" / "delve into" → instead: "explore", "examine", "start"
• "embark on a journey" / "your journey" → instead: "adventure", "playthrough", "quest"
• "without further ado" → just remove this
• "it's important to note" / "it's worth noting" → just state the fact directly
• "in order to" → use "to"
• "first and foremost" → use "first" or remove
• "a plethora of" / "a myriad of" → use "many", "several"

Good natural writing:
"Head to the northern fortress to find Captain Roderick, who'll brief you on the siege."
"After defeating the boss, you'll obtain the Fire Medallion—keep this safe as you'll need it later."
"This ability lets you manipulate metal objects from a distance, which is essential for several upcoming puzzles."
`;

export const specialistPrompts: SpecialistPrompts = {
  getSystemPrompt(localeInstruction: string): string {
    return `You are an expert gaming guide writer who creates clear, helpful instructions for players.

${CORE_WRITING_RULES}

${PRECISION_RULES}

${FACTUAL_ACCURACY}

${NATURAL_LANGUAGE}

${COMPLETE_EXAMPLE}

${localeInstruction}

Remember: Your goal is to help players succeed. Be precise with names and locations, accurate with details from research, and natural in your writing style.`;
  },

  getSectionUserPrompt(
    ctx: SpecialistSectionContext,
    plan: ArticlePlan,
    gameName: string,
    maxScoutOverviewLength: number,
    minParagraphs: number,
    maxParagraphs: number
  ): string {
    const truncatedOverview =
      ctx.scoutOverview.length > maxScoutOverviewLength
        ? `${ctx.scoutOverview.slice(0, maxScoutOverviewLength)}
...(truncated)`
        : ctx.scoutOverview;

    const mustCoverSection = ctx.mustCover.length > 0 ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  CRITICAL: REQUIRED COVERAGE (Non-Negotiable)  ⚠️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Include ALL of the following with EXACT precision.
Copy location names, controls, and stats VERBATIM — do not paraphrase.

${ctx.mustCover.map((el, i) => `${i + 1}. ${el}`).join('\n')}

REQUIREMENTS FOR EACH ELEMENT ABOVE:
• Location phrases: Copy WORD-FOR-WORD (e.g., "western side" not "west area")
• Controls: Copy EXACTLY (e.g., "[L] to activate" not "press the ability button")
• Stats/numbers: Copy VERBATIM (e.g., "2 damage", "Cold Resistance")
• Proper names: Use EXACTLY as written (no synonyms or paraphrasing)
• Context: Don't just list—explain each element naturally within your writing

⚠️ MANDATORY VERIFICATION (Do this BEFORE finishing):
For EACH numbered item above, search your output:
  □ Item 1 — appears in my text? YES/NO
  □ Item 2 — appears in my text? YES/NO
  ... and so on
If ANY item shows NO → ADD IT before submitting!

Missing even ONE mustCover item = INCOMPLETE SECTION = article fails review.
` : '';

    const sectionScope = `
SECTION INFORMATION:
This section: "${ctx.headline}"
Goal: ${ctx.goal}
${ctx.isFirst ? 'Position: Opening section—briefly explain what this guide covers' : ''}
${ctx.isLast ? 'Position: Final section—include a summary takeaway' : ''}

All sections in this article:
${plan.sections.map((s, idx) => `${idx + 1}. ${s.headline}${idx === ctx.sectionIndex ? ' ← YOU ARE WRITING THIS ONE' : ''}`).join('\n')}
`;

    const researchSection = `
RESEARCH (Your Source of Truth):
${ctx.researchContext || '(Using general knowledge only)'}

General Overview:
${truncatedOverview}
`;

    const previouslyWritten = ctx.crossReferenceContext ? `
PREVIOUSLY COVERED (Do Not Repeat):
${ctx.crossReferenceContext}
` : '';

    // Build awareness of what OTHER sections will cover (to avoid duplication)
    const otherSectionsCoverage = plan.sections
      .filter((_, idx) => idx !== ctx.sectionIndex)
      .map((s) => `• ${s.headline}: ${s.mustCover.slice(0, 3).join(', ')}${s.mustCover.length > 3 ? '...' : ''}`)
      .join('\n');

    const otherSectionsContext = otherSectionsCoverage ? `
OTHER SECTIONS WILL COVER (Do NOT duplicate these topics):
${otherSectionsCoverage}
` : '';

    return `Write section ${ctx.sectionIndex + 1} of ${ctx.totalSections} for a guide about ${gameName}.

ARTICLE: ${plan.title}

${sectionScope}

${researchSection}

${previouslyWritten}
${otherSectionsContext}
${mustCoverSection}

SMART EXPANSION (Use Judgment):
• You MUST cover everything in mustCover—this is non-negotiable
• You MAY add 1-2 closely related items IF they naturally fit AND appear in your research
• DO NOT add items that belong in other sections (see "OTHER SECTIONS WILL COVER" above)
• When in doubt, leave it out—better to be focused than bloated

WRITING GUIDELINES:

Format:
• Do NOT include the section headline (##)—it's added automatically
• Start with content or a subheading (###)
• Write as many paragraphs as needed to fully cover ALL mustCover elements
• Use **bold** for item/ability/location names on FIRST mention only
• End with an actionable takeaway

COMPLETENESS > WORD COUNT:
• Every mustCover element MUST be thoroughly explained
• Don't pad with filler—be concise but complete
• If an element needs 2 paragraphs to explain properly, use 2 paragraphs
• If you can cover everything in 3 paragraphs, that's fine—don't stretch to fill space

Precision checklist (verify before submitting):
✓ Every named element leads with its proper name
✓ Every NPC has: name + location + role + purpose
✓ Every sub-location includes its parent location
✓ All mustCover elements included with exact phrasing
✓ No specific details invented (only from research above)
✓ Natural, conversational tone (not robotic patterns)

Write the section now (markdown format):`;
  }
};
