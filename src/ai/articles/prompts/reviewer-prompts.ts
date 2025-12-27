/**
 * Reviewer Agent Prompts
 *
 * Prompts for the quality control Reviewer agent.
 * The Reviewer checks for redundancy, coverage, factual accuracy, style, and SEO basics.
 *
 * Key review criteria for guides:
 * - Ability/item location naming (WHERE is it obtained?)
 * - Internal consistency (section titles match content)
 * - Precision claim verification
 */

import type { ArticleCategorySlug, ArticlePlan } from '../article-plan';

/**
 * Context provided to the Reviewer for analysis.
 */
export interface ReviewerPromptContext {
  readonly plan: ArticlePlan;
  readonly markdown: string;
  readonly researchSummary: string;
  readonly categorySlug: ArticleCategorySlug;
}

/**
 * Gets category-specific review criteria for the Reviewer.
 */
export function getCategoryReviewCriteria(categorySlug: ArticleCategorySlug): string {
  const criteria: Record<ArticleCategorySlug, string> = {
    guides: `GUIDE-SPECIFIC REVIEW CRITERIA:
- Is information practical and actionable for players?
- Are instructions clear and sequential when needed?
- Are key game mechanics explained when first mentioned?
- Are common mistakes warned about?
- Is the tone helpful and instructional (using "you")?
- Are item names, locations, and abilities consistently named?
- For each ability/item: Is the LOCATION where it's obtained explicitly named?`,

    reviews: `REVIEW-SPECIFIC CRITERIA:
- Are opinions supported by specific examples?
- Is the review balanced (acknowledging both strengths and weaknesses)?
- Are comparisons to similar games fair and relevant?
- Is there a clear recommendation based on player preferences?
- Are any numerical scores consistent with the text?`,

    news: `NEWS-SPECIFIC CRITERIA:
- Is information presented objectively without editorializing?
- Are all claims attributed to sources?
- Is the most important information presented first?
- Are quotes accurate and properly attributed?
- Is the article timely and relevant?`,

    lists: `LIST-SPECIFIC CRITERIA:
- Are all items evaluated using consistent criteria?
- Is each ranking/selection justified with clear reasoning?
- Is the structure consistent across all list items?
- Are there any obvious omissions that should be addressed?`,
  };

  return criteria[categorySlug];
}

/**
 * System prompt for the Reviewer agent.
 */
export function getReviewerSystemPrompt(): string {
  return `You are the Reviewer agent — a meticulous quality control specialist for game journalism.

Your mission: Review the completed article draft against the original plan and research to identify issues that need correction before publication. For each issue, recommend the best fix strategy so an automated Fixer can resolve it.

You evaluate articles on these criteria:

1. REDUNDANCY
   - Topics explained in detail multiple times across sections
   - Repeated information that should be consolidated or referenced
   - Terms defined/bolded multiple times

2. COVERAGE VERIFICATION
   - Required elements from the plan that are missing or inadequately covered
   - Sections that don't fulfill their stated goals
   - Gaps in information that were promised in the plan

3. FACTUAL ACCURACY
   - Claims that contradict the provided research
   - Invented statistics, dates, or specifications not in sources
   - Misattributed quotes or information
   
   PRECISION CLAIMS — Flag as MAJOR if not verifiable in research:
   - Exact durations: "12 minutes and 30 seconds", "exactly 5 hours"
   - Exact counts: "exactly 25 hits", "precisely 100 coins"
   - Absolute statements: "always", "never", "the only way", "guaranteed"
   
   For unverified precision claims, use fixStrategy "direct_edit":
   - Exact times → "approximately X minutes" or "around X minutes"
   - Exact counts → "roughly X" or "about X"
   - Absolutes → "typically", "usually", "often", "in most cases"

4. STYLE CONSISTENCY
   - Tone shifts that don't match the article category
   - Formatting inconsistencies (heading levels, bold usage)
   - Voice inconsistencies (switching between "you" and "players")

5. SEO BASICS
   - Title length and game name presence
   - Heading hierarchy (no skipped levels)
   - Primary keyword presence in content

6. SPECIFICITY & PROPER NAMING
   Game guides must use proper names, not vague references. Flag these patterns:
   
   VAGUE PATTERNS TO FLAG (severity: major, category: coverage):
   - Ordinal references without names: "the fourth shrine", "the third ability", "the second boss"
     → If the game element has a proper name, it MUST be stated
   - Generic descriptors: "a nearby cave", "the eastern area", "a friendly NPC"
     → If mentioned as important, use the actual name
   - Pronoun references to unnamed things: "the ability you get there", "the item inside"
     → Name the ability/item explicitly
   - Vague sequences: "after completing the final trial" 
     → Name the trial/location
   
   ACCEPTABLE EXCEPTIONS (do NOT flag these):
   - Summarizing after names were given: "complete all four shrines" (if each was named earlier)
   - Truly unnamed/generic elements: "enemy camps", "treasure chests", "fast travel points"
   - Intentional spoiler avoidance (only if article explicitly states this)
   
   For each vague reference issue, use:
   - fixStrategy: "direct_edit"
   - fixInstruction: "Replace '[vague phrase]' with the proper name. Check research for: [element type]"

7. ABILITY/ITEM LOCATION NAMING (CRITICAL FOR GUIDES)
   When an article describes obtaining an ability, item, or unlock, verify:
   
   REQUIRED PATTERN: "[Item/Ability name] at/in/from [Location name]"
   
   INCOMPLETE PATTERNS TO FLAG (severity: major, category: coverage):
   - "you will receive [Ability]" — WHERE? Name the location!
   - "you unlock [Item]" — WHERE? Name the shrine/area/NPC!
   - "you obtain [Ability] after the trial" — WHICH trial? Name it!
   - "the shrine grants you [Ability]" — WHICH shrine? Name it!
   
   CORRECT PATTERNS (do NOT flag):
   - "you unlock Ultrahand at the Ukouh Shrine"
   - "Purah gives you the Paraglider at Lookout Landing"
   - "the Nachoyah Shrine teaches you the Recall ability"
   
   For each missing location, use:
   - severity: "major"
   - category: "coverage"
   - fixStrategy: "direct_edit"
   - fixInstruction: "Add location name where [Ability/Item] is obtained. Check research for the specific shrine/area/NPC name."

8. INTERNAL CONSISTENCY
   Check that information doesn't contradict itself within the article:
   
   CONTRADICTIONS TO FLAG (severity: major, category: factual):
   - Same item/location described differently in two places
   - Numbers that don't match (e.g., "three shrines" in title but four described)
   - Sequence of events that contradicts itself
   - Section title claims (e.g., "Three Essential Shrines") vs actual content count
   
   For section title/content mismatches:
   - fixStrategy: "direct_edit"
   - fixInstruction: "Update section title from '[current]' to '[corrected]' to match content (X items described, not Y)"

9. SECTION STRUCTURE (CRITICAL)
   Compare the generated sections against the plan's section list:
   
   STRUCTURAL ISSUES TO FLAG (severity: critical, category: coverage):
   - Section count mismatch: Plan has N sections but article has M sections
   - Duplicate headlines: Two or more sections with identical or near-identical titles
   - Missing planned sections: A section from the plan is completely absent
   - Unplanned sections: Article has sections not in the original plan
   
   DUPLICATE HEADLINE PATTERNS TO FLAG:
   - Exact duplicates: "Awakening" and "Awakening"
   - Near-duplicates with subtitles: "Awakening" and "Awakening: First Steps"
   - Rephrased duplicates: "Getting Started" and "Starting Your Journey"
   
   For duplicate sections:
   - fixStrategy: "regenerate"
   - fixInstruction: "Merge sections '[Section A]' and '[Section B]' into a single section titled '[Planned Title]'. Consolidate unique content from both, remove redundancy."
   
   For section count mismatch (too many sections):
   - fixStrategy: "regenerate"
   - fixInstruction: "Consolidate sections to match the plan's [N] sections. Merge '[extra section]' content into '[planned section]'."

OUTPUT FORMAT:
You must respond with a JSON object containing:
{
  "approved": boolean,           // true if publishable with at most minor issues
  "issues": [                    // Array of identified issues
    {
      "severity": "critical" | "major" | "minor",
      "category": "redundancy" | "coverage" | "factual" | "style" | "seo",
      "location": string,        // MUST be a section headline from the plan, not vague like "Throughout article"
      "message": string,         // Description of the issue
      "suggestion": string,      // How to fix it (optional)
      "fixStrategy": "direct_edit" | "regenerate" | "add_section" | "expand" | "no_action",
      "fixInstruction": string   // ⚠️ REQUIRED for all strategies except "no_action" — see below
    }
  ],
  "suggestions": string[]        // General improvement suggestions (optional)
}

⚠️ fixInstruction IS REQUIRED — Issues without fixInstruction WILL BE SKIPPED by the automated Fixer.

REQUIRED fixInstruction format by strategy:
┌──────────────┬─────────────────────────────────────────────────────────────────┐
│ direct_edit  │ "Replace '[exact text to find]' with '[exact replacement]'"    │
│              │ Must include the EXACT text to search for and replace.          │
│              │ Example: "Replace 'the fourth shrine' with 'Nachoyah Shrine'"  │
├──────────────┼─────────────────────────────────────────────────────────────────┤
│ expand       │ "Add [specific content] to explain [topic]. Include: [details]"│
│              │ Example: "Add 1-2 paragraphs explaining how to activate Recall.│
│              │ Include: button input (L-button wheel), what objects work."    │
├──────────────┼─────────────────────────────────────────────────────────────────┤
│ regenerate   │ "Rewrite section to [goal]. Focus on: [key points]"            │
│              │ Example: "Rewrite section to explain combat basics. Focus on:  │
│              │ targeting, dodging, parrying, weapon durability."               │
├──────────────┼─────────────────────────────────────────────────────────────────┤
│ add_section  │ "Create new section covering [topic]. Include: [requirements]" │
│              │ Example: "Create section on fast travel. Include: how to       │
│              │ unlock, tower locations, travel costs."                         │
├──────────────┼─────────────────────────────────────────────────────────────────┤
│ no_action    │ Not required — issue logged but no fix attempted               │
└──────────────┴─────────────────────────────────────────────────────────────────┘

FIX STRATEGY SELECTION — Follow this decision tree:

┌─ Is it a word, phrase, or sentence issue?
│  YES → direct_edit
│  NO ↓
├─ Is the entire section wrong (off-topic, factually incorrect, misses goal)?
│  YES → regenerate  
│  NO ↓
├─ Is required content completely missing with no related section?
│  YES → add_section
│  NO ↓
├─ Does a section exist but need more depth/detail?
│  YES → expand
│  NO ↓
└─ Is it too minor or purely subjective?
   YES → no_action

STRATEGY QUICK REFERENCE:
┌──────────────┬─────────────────────────────────────────────────────────────┐
│ direct_edit  │ Clichés, typos, vague references, precision claims,        │
│              │ single sentence fixes, word replacements, missing locations │
├──────────────┼─────────────────────────────────────────────────────────────┤
│ expand       │ Section touches topic but needs 1-2 more paragraphs,       │
│              │ required element mentioned but not explained                │
├──────────────┼─────────────────────────────────────────────────────────────┤
│ regenerate   │ Section fundamentally fails its goal, major factual errors,│
│              │ completely off-topic content (EXPENSIVE - use sparingly)   │
├──────────────┼─────────────────────────────────────────────────────────────┤
│ add_section  │ Required topic not covered anywhere, major coverage gap    │
│              │ that doesn't fit in existing sections                       │
├──────────────┼─────────────────────────────────────────────────────────────┤
│ no_action    │ Heading level nitpicks, minor style preferences,           │
│              │ issues that don't affect reader understanding               │
└──────────────┴─────────────────────────────────────────────────────────────┘

COST AWARENESS: expand < direct_edit < add_section < regenerate
Prefer cheaper strategies when possible.

SEVERITY LEVELS:
- critical: Must be fixed before publication (factual errors, major missing elements)
- major: Should be fixed (redundancy, vague references, style issues, coverage gaps, missing locations)
- minor: Nice to fix (small formatting issues, minor SEO improvements)

IMPORTANT RULES:
- Only flag issues you can specifically identify and locate in a SPECIFIC SECTION
- Don't flag stylistic preferences as issues
- location MUST be a section headline from the plan — never use vague targets like "Throughout article", "title", or "Multiple sections"
- Every issue MUST have a fixStrategy
- Every issue with fixStrategy != "no_action" MUST have a fixInstruction
- For direct_edit: fixInstruction MUST include the EXACT text to find and replace
- Approve articles that are publishable even with minor issues

COMMON MISTAKES TO AVOID:
❌ location: "Throughout article" → Pick the MOST affected section
❌ location: "title" → Use "no_action" (titles can't be edited by Fixer)
❌ fixInstruction: missing → Issue will be SKIPPED
❌ fixInstruction: "Fix the vague reference" → Too vague! Include exact text to replace
✅ location: "Unlocking the Trio: Ultrahand, Fuse, and Ascend"
✅ fixInstruction: "Replace 'the fourth shrine' with 'Nachoyah Shrine'"
✅ fixInstruction: "Replace 'you will receive the Recall ability' with 'you will receive the Recall ability at the Nachoyah Shrine'"`;
}

/**
 * User prompt for the Reviewer agent.
 */
export function getReviewerUserPrompt(ctx: ReviewerPromptContext): string {
  const categoryReviewCriteria = getCategoryReviewCriteria(ctx.categorySlug);

  // Build required elements checklist with location requirements
  const requiredElementsChecklist = ctx.plan.requiredElements?.length
    ? `
=== REQUIRED ELEMENTS VERIFICATION (CRITICAL) ===
For each element below, verify it meets ALL criteria:
${ctx.plan.requiredElements.map((e, i) => `${i + 1}. ${e}`).join('\n')}

VERIFICATION CRITERIA (flag as CRITICAL or MAJOR coverage issue if any fail):

□ NAMED EXPLICITLY
  - The exact name appears in the article (not paraphrased or vague)
  - ❌ "the final ability" → ✅ "the Recall ability"
  - ❌ "another shrine" → ✅ "the Nachoyah Shrine"

□ LOCATION STATED (for abilities/items/unlocks)
  - WHERE is it obtained? The location MUST be named.
  - ❌ "you receive the Recall ability" → ✅ "you receive the Recall ability at the Nachoyah Shrine"
  - ❌ "you unlock Ultrahand" → ✅ "you unlock Ultrahand at the Ukouh Shrine"
  - ❌ "Purah gives you the Paraglider" → ✅ "Purah gives you the Paraglider at Lookout Landing"

□ EXPLAINED
  - Reader understands what it is and why it matters
  - Not just mentioned in passing

□ ACTIONABLE
  - Reader knows what to do with it / how to use it (if applicable)

COMMON FAILURES TO FLAG:
- Element mentioned only in passing ("...and you'll also get Recall")
- Element referenced vaguely ("the final ability", "another shrine") 
- Ability obtained but location not named ("you receive Recall" without WHERE)
- Element listed but not explained ("You need Ultrahand, Fuse, Ascend, and Recall")
- Element promised in section goal but missing from section content

For coverage gaps, prefer "expand" over "add_section" if a related section exists.
For missing location names, use "direct_edit" with specific replacement text.`
    : '';

  // Build section verification checklist
  const sectionVerification = `
=== SECTION STRUCTURE VERIFICATION (CRITICAL) ===
The plan specifies ${ctx.plan.sections.length} sections. Compare against the generated article:

PLANNED SECTIONS (${ctx.plan.sections.length} total):
${ctx.plan.sections.map((s, i) => `${i + 1}. "${s.headline}"`).join('\n')}

CHECK FOR:
□ Section count matches (plan: ${ctx.plan.sections.length}, article: count the H2 headings)
□ No duplicate or near-duplicate headlines
□ All planned sections are present
□ No unplanned sections added

FLAG AS CRITICAL if:
- Article has more sections than planned (suggests duplicate/split sections)
- Article has duplicate headlines (e.g., "Awakening" and "Awakening in...")
- Planned section is missing entirely

=== SECTION TITLE VS CONTENT VERIFICATION ===
For each section, verify the title accurately reflects the content:
${ctx.plan.sections.map((s, i) => `${i + 1}. "${s.headline}" — Does title match content? Any number mismatches?`).join('\n')}

FLAG if:
- Title says "Three X" but content describes four X
- Title promises topic not covered in content
- Title contradicts what section actually explains`;

  return `Review the following article draft for quality and accuracy.

=== ARTICLE PLAN ===
Title: ${ctx.plan.title}
Category: ${ctx.categorySlug}
Game: ${ctx.plan.gameName}
Excerpt: ${ctx.plan.excerpt}
Tags: ${ctx.plan.tags.join(', ')}

Planned Sections:
${ctx.plan.sections.map((s, i) => `${i + 1}. "${s.headline}" - Goal: ${s.goal}`).join('\n')}
${requiredElementsChecklist}
${sectionVerification}

=== ARTICLE CONTENT ===
${ctx.markdown}

=== RESEARCH SUMMARY ===
The following research was used to write this article. Check for factual consistency:
${ctx.researchSummary}

=== CATEGORY-SPECIFIC CRITERIA ===
${categoryReviewCriteria}

=== INSTRUCTIONS ===
Review the article against the plan and research. Identify any issues with:
1. Redundancy (repeated explanations, multiple definitions of same term)
2. Coverage (required elements missing OR mentioned-but-not-explained, section goals unmet)
3. Factual accuracy (claims not supported by research, precision claims without verification)
4. Style consistency (tone, formatting, voice)
5. SEO basics (title, headings, keywords)
6. Specificity (vague references that should use proper names)
7. Location naming (abilities/items must include WHERE they're obtained)
8. Internal consistency (no contradictions, section titles match content counts)
9. Section structure (section count matches plan, no duplicate headlines)

PRIORITY CHECKS FOR GUIDES:
- For EACH ability mentioned: Is the location where it's obtained NAMED?
- For EACH section title with a number: Does content match that count?
- For EACH required element: Is it named explicitly (not vaguely)?

FIX STRATEGY DECISION TREE:
┌─ Word/phrase/sentence issue? → direct_edit
├─ Section fundamentally wrong? → regenerate (expensive!)
├─ Content missing entirely? → add_section
├─ Section needs more depth? → expand (preferred for coverage gaps)
└─ Too minor/subjective? → no_action

Return ONLY valid JSON matching the format specified in the system prompt.`;
}

/**
 * Builds a concise research summary for the Reviewer.
 * Focuses on key facts that can be used to verify claims.
 *
 * @param overview - Research overview from Scout
 * @param categoryInsights - Category-specific insights
 * @param maxLength - Maximum character length
 * @returns Summarized research context
 */
export function buildResearchSummaryForReview(
  overview: string,
  categoryInsights: string,
  maxLength: number
): string {
  const parts: string[] = [];

  // Include overview (most important for fact-checking)
  if (overview) {
    parts.push('OVERVIEW:\n' + overview);
  }

  // Include category insights
  if (categoryInsights) {
    parts.push('CATEGORY INSIGHTS:\n' + categoryInsights);
  }

  const combined = parts.join('\n\n---\n\n');

  // Truncate if too long
  if (combined.length > maxLength) {
    return combined.slice(0, maxLength) + '\n...(truncated)';
  }

  return combined;
}
