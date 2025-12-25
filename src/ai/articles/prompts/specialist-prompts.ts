/**
 * Specialist Agent Prompts
 *
 * Prompts for the article-writing Specialist agent.
 */

import type { ArticleCategorySlug, ArticlePlan } from '../article-plan';
import type { CategorizedSearchResult, GameArticleContext } from '../types';

/**
 * Gets category-specific tone guidance for the Specialist.
 * Includes both tone and format rules for each category.
 */
export function getCategoryToneGuide(categorySlug: ArticleCategorySlug): string {
  const guides: Record<ArticleCategorySlug, string> = {
    news: `Professional and objective reporting tone.
- Use inverted pyramid structure: most important information first
- Attribute all claims to sources ("according to developer", "announced on Twitter")
- State facts clearly without editorializing or personal opinion
- Use active voice and concise sentences
- Lead with what happened, when, and why it matters

FORMAT RULES:
- Short, punchy paragraphs (2-4 sentences each)
- Bold the key news element in the opening paragraph
- Include quotes from official sources when available
- End with context about what this means for players`,

    reviews: `Critical but balanced editorial voice.
- Support all opinions with specific examples from the game
- Provide balanced analysis: acknowledge both strengths and weaknesses
- Use concrete details, not vague praise ("tight controls" vs "feels good")
- Compare to similar games when relevant for context
- Make clear recommendations based on player preferences

FORMAT RULES:
- Longer, more analytical paragraphs (4-6 sentences)
- Bold key praise or criticism points on first mention
- Use specific examples: "the boss in Chapter 3" not "the bosses"
- Structure as: observation → evidence → implication`,

    guides: `Instructional and helpful tone using second person ("you").
- Be specific with numbers, stats, and exact steps
- Use sequential language: "First," "Next," "Finally"
- Include precise details: "equip the Fire Sword, not the Ice Blade"
- Anticipate common mistakes and warn readers
- Organize information hierarchically: overview → details → advanced tips

FORMAT RULES:
- Use **bold** for key terms, item names, and ability names on first mention
- Consider numbered steps for sequential processes
- Use subheadings (###) within sections when covering multiple distinct topics
- End each section with an actionable takeaway
- Warn about common pitfalls: "Be careful not to..."`,

    lists: `Engaging and comparative tone with consistent criteria.
- Justify each ranking or selection with clear reasoning
- Use consistent evaluation criteria across all items
- Provide context: "Best for beginners" vs "Best for endgame"
- Balance objective facts with subjective assessment
- End each entry with a clear takeaway or recommendation

FORMAT RULES:
- Each list item should follow the same structure
- Bold the item name/title at the start of each entry
- Include a brief "why it's here" justification
- Consider using ### subheadings for each list item`,
  };

  return guides[categorySlug];
}

export interface SpecialistSectionContext {
  readonly sectionIndex: number;
  readonly totalSections: number;
  readonly headline: string;
  readonly goal: string;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly previousContext: string;
  readonly researchContext: string;
  readonly scoutOverview: string;
  readonly categoryInsights: string;
  readonly isThinResearch: boolean;
  readonly researchContentLength: number;
  /**
   * Key elements that MUST be covered in the article.
   * Only passed to the last section for final verification checklist.
   */
  readonly requiredElements?: readonly string[];
}

/**
 * System prompt for the Specialist agent.
 */
export function getSpecialistSystemPrompt(
  localeInstruction: string,
  categoryToneGuide: string
): string {
  return `You are the Specialist agent — an expert gaming journalist who writes engaging, accurate, well-researched content.

Your mission: Transform research into compelling prose that informs and engages readers while maintaining strict factual integrity.

Core writing principles:
- EVIDENCE-BASED: Every claim must be grounded in the provided research
- READER-FIRST: Write for human readers, not search engines. Be engaging but never sensational.
- FLOW & CONTINUITY: Each section should connect naturally to the article's narrative arc
- VOICE CONSISTENCY: Maintain appropriate tone throughout (see category guide below)
- INTELLECTUAL HONESTY: Acknowledge uncertainty rather than fabricate details

PRECISION RULES (CRITICAL):
When stating numbers, durations, or statistics:
- NEVER invent exact numbers without explicit source verification
- BAD: "grants twelve minutes and thirty seconds of cold resistance"
- GOOD: "grants approximately 10-13 minutes of cold resistance"
- GOOD: "grants several minutes of cold resistance"
- Use hedging language: "approximately", "around", "typically", "roughly", "about"
- Exception: Official stats directly from the game's UI or documentation are fine
- When in doubt, round or use ranges instead of precise numbers

${localeInstruction}

CATEGORY-SPECIFIC TONE:
${categoryToneGuide}`;
}

/**
 * User prompt for the Specialist agent to write a section.
 */
export function getSpecialistSectionUserPrompt(
  ctx: SpecialistSectionContext,
  plan: ArticlePlan,
  gameName: string,
  maxScoutOverviewLength: number,
  minParagraphs: number,
  maxParagraphs: number
): string {
  const truncatedOverview =
    ctx.scoutOverview.length > maxScoutOverviewLength
      ? `${ctx.scoutOverview.slice(0, maxScoutOverviewLength)}\n...(truncated for brevity)`
      : ctx.scoutOverview;

  const positionText = ctx.isFirst
    ? 'Opening section (set the stage, no preamble needed)'
    : ctx.isLast
      ? 'Closing section (provide satisfying conclusion)'
      : 'Middle section (develop key points)';

  const continuityText = ctx.previousContext
    ? `Previous section's closing:\n${ctx.previousContext}\n\n→ Build natural transitions. Reference previous points when relevant.`
    : '(First section — establish strong opening)';

  const thinResearchWarning = ctx.isThinResearch
    ? `⚠️ THIN RESEARCH WARNING ⚠️
This section has limited research content (${ctx.researchContentLength} characters).
- Write a concise ${minParagraphs}-paragraph section
- Do NOT pad or speculate to fill space
- Focus on the most important verified facts only
- If there's not enough information, acknowledge it briefly

`
    : '';

  const transitionGuidance = ctx.isFirst
    ? `- Open strong: Hook the reader with the most compelling aspect
- No meta-commentary ("In this article..." or "Let's explore...")`
    : `- Connect to previous section theme when relevant
- Use transitional phrases: "Building on this foundation...", "In contrast to...", "This ties directly to..."`;

  const closingGuidance = ctx.isLast
    ? `- Provide closure without being formulaic
- Avoid clichés like "In conclusion..." or "Overall..."`
    : `- End with a natural bridge to the next topic`;

  return `Write section ${ctx.sectionIndex + 1} of ${ctx.totalSections} for this article.

=== ARTICLE CONTEXT ===
Title: ${plan.title}
Category: ${plan.categorySlug}
Game: ${gameName}
Full Outline: ${plan.sections.map((s, idx) => `${idx + 1}. ${s.headline}`).join(', ')}

=== CURRENT SECTION ===
Headline: ${ctx.headline}
Internal Goal: ${ctx.goal}
Position: ${positionText}

=== COMPREHENSIVE RESEARCH CONTEXT ===
You have access to extensive research from Scout and section-specific searches.

Scout Overview:
${truncatedOverview}

${ctx.categoryInsights ? `Category Insights:\n${ctx.categoryInsights}\n\n` : ''}

Section-Specific Research:
${ctx.researchContext || '(Using Scout research only for this section)'}

=== CONTINUITY CONTEXT ===
${continuityText}

=== WRITING GUIDELINES ===

${thinResearchWarning}Paragraph structure:
- ${ctx.isThinResearch ? minParagraphs : minParagraphs}-${maxParagraphs} paragraphs based on content depth
- Simple facts = ${minParagraphs} paragraphs
- Analysis or mechanics = 3-4 paragraphs
- Complex systems = ${maxParagraphs} paragraphs
- Each paragraph should develop ONE clear idea

Handling uncertain information:
- If research is sparse → Acknowledge gaps: "Details remain limited..."
- If sources conflict → Present both views: "While some reports suggest X, others indicate Y..."
- If speculation is needed → Frame carefully: "Based on early previews..." or "According to developer interviews..."
- Never invent: player counts, sales figures, release dates, technical specs, or review scores

Markdown formatting:
- Use **bold** for key game mechanics, features, or important terms (sparingly)
- Use natural language, not listicles (unless category is "lists")
- No code blocks, no tables (unless absolutely essential for guides)
- Write flowing prose, not bullet points

Transitions & flow:
${transitionGuidance}
${closingGuidance}

Content restrictions (STRICT):
✗ NO pricing, purchase links, or "buy now" language
✗ NO numeric review scores unless categorySlug === "reviews"
✗ NO marketing superlatives ("revolutionary", "game-changing") unless directly quoted from sources
✗ NO fabricated statistics, dates, or technical specifications
✗ NO personal opinions framed as facts ("players will love..." → "early impressions suggest...")
✗ NO precise numbers (durations, percentages, counts) unless explicitly verified in sources
${ctx.requiredElements && ctx.requiredElements.length > 0 ? `
=== REQUIRED ELEMENTS CHECKLIST ===
The following elements MUST be addressed somewhere in this article.
If this is the final section and any elements haven't been covered yet, ensure they are mentioned here.
If you cannot cover an element due to insufficient research, acknowledge it:
"While details on [element] remain limited, players should explore this on their own."

Required elements to verify coverage:
${ctx.requiredElements.map((el, i) => `${i + 1}. ${el}`).join('\n')}
` : ''}
=== OUTPUT FORMAT ===
Write ONLY the markdown prose for this section.
- Do NOT include the section heading (system adds it)
- Do NOT wrap in code fences
- Do NOT add meta-commentary
- Output plain markdown paragraphs, ready to publish

Write the section now:`;
}

/**
 * Builds research context for a section.
 */
export function buildResearchContext(
  research: readonly CategorizedSearchResult[],
  resultsPerResearch: number,
  contentPerResult: number
): string {
  if (research.length === 0) return '';

  return research
    .map((r, idx) => {
      const topResults = r.results
        .slice(0, resultsPerResearch)
        .map(
          (result) =>
            `  - ${result.title} (${result.url})\n    ${result.content.slice(0, contentPerResult)}`
        )
        .join('\n');

      return `Research ${idx + 1} [${r.category}]: "${r.query}"
AI Summary: ${r.answer || '(none)'}
Results:
${topResults}`;
    })
    .join('\n\n---\n\n');
}

