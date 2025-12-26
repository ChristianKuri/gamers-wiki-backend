/**
 * Reviewer Agent Prompts
 *
 * Prompts for the quality control Reviewer agent.
 * The Reviewer checks for redundancy, coverage, factual accuracy, style, and SEO basics.
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
- Are item names, locations, and abilities consistently named?`,

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

Your mission: Review the completed article draft against the original plan and research to identify issues that need correction before publication.

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

4. STYLE CONSISTENCY
   - Tone shifts that don't match the article category
   - Formatting inconsistencies (heading levels, bold usage)
   - Voice inconsistencies (switching between "you" and "players")

5. SEO BASICS
   - Title length and game name presence
   - Heading hierarchy (no skipped levels)
   - Primary keyword presence in content

OUTPUT FORMAT:
You must respond with a JSON object containing:
{
  "approved": boolean,           // true if publishable with at most minor issues
  "issues": [                    // Array of identified issues
    {
      "severity": "critical" | "major" | "minor",
      "category": "redundancy" | "coverage" | "factual" | "style" | "seo",
      "location": string,        // Section headline or "title", "excerpt", etc.
      "message": string,         // Description of the issue
      "suggestion": string       // How to fix it (optional)
    }
  ],
  "suggestions": string[]        // General improvement suggestions (optional)
}

SEVERITY LEVELS:
- critical: Must be fixed before publication (factual errors, major missing elements)
- major: Should be fixed (redundancy, style issues, coverage gaps)
- minor: Nice to fix (small formatting issues, minor SEO improvements)

IMPORTANT:
- Only flag issues you can specifically identify and locate
- Don't flag stylistic preferences as issues
- Be specific about locations and problems
- Suggest concrete fixes when possible
- Approve articles that are publishable even with minor issues`;
}

/**
 * User prompt for the Reviewer agent.
 */
export function getReviewerUserPrompt(ctx: ReviewerPromptContext): string {
  const categoryReviewCriteria = getCategoryReviewCriteria(ctx.categorySlug);

  const requiredElementsList = ctx.plan.requiredElements?.length
    ? `\nREQUIRED ELEMENTS TO VERIFY:\n${ctx.plan.requiredElements.map((e, i) => `${i + 1}. ${e}`).join('\n')}`
    : '';

  return `Review the following article draft for quality and accuracy.

=== ARTICLE PLAN ===
Title: ${ctx.plan.title}
Category: ${ctx.categorySlug}
Game: ${ctx.plan.gameName}
Excerpt: ${ctx.plan.excerpt}
Tags: ${ctx.plan.tags.join(', ')}

Planned Sections:
${ctx.plan.sections.map((s, i) => `${i + 1}. "${s.headline}" - Goal: ${s.goal}`).join('\n')}
${requiredElementsList}

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
2. Coverage (required elements missing, section goals unmet)
3. Factual accuracy (claims not supported by research)
4. Style consistency (tone, formatting, voice)
5. SEO basics (title, headings, keywords)

Return ONLY valid JSON matching the format specified in the system prompt.`;
}

/**
 * Builds a concise research summary for the Reviewer.
 * Focuses on key facts that can be used to verify claims.
 *
 * @param researchPool - All research from Scout and Specialist phases
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

