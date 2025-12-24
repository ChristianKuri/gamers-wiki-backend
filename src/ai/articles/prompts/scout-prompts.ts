/**
 * Scout Agent Prompts
 *
 * Prompts for the research-gathering Scout agent.
 */

import type { GameArticleContext } from '../types';

export interface ScoutPromptContext {
  readonly gameName: string;
  readonly releaseDate?: string | null;
  readonly genres?: readonly string[];
  readonly platforms?: readonly string[];
  readonly developer?: string | null;
  readonly publisher?: string | null;
  readonly igdbDescription?: string | null;
  readonly instruction?: string | null;
  readonly localeInstruction: string;
  readonly searchContext: string;
  readonly categoryContext: string;
  readonly recentContext: string;
}

/**
 * System prompt for Scout overview briefing.
 */
export function getScoutOverviewSystemPrompt(localeInstruction: string): string {
  return `You are the Scout agent — a precision research specialist for game journalism.

Your mission: Create a comprehensive overview briefing with all essential facts about the game.

Core principles:
- FACTS ONLY: Never invent, speculate, or extrapolate beyond the sources
- COMPREHENSIVE: Include ALL relevant details, no word limits
- STRUCTURED: Organize by topic for easy reference
- VERIFICATION: Mark uncertain claims as "according to [source]"

${localeInstruction}`;
}

/**
 * User prompt for Scout overview briefing.
 */
export function getScoutOverviewUserPrompt(ctx: ScoutPromptContext): string {
  return `Create a comprehensive overview briefing for "${ctx.gameName}".

=== GAME METADATA ===
- Name: ${ctx.gameName}
- Release Date: ${ctx.releaseDate || 'unknown'}
- Genres: ${ctx.genres?.join(', ') || 'unknown'}
- Platforms: ${ctx.platforms?.join(', ') || 'unknown'}
- Developer: ${ctx.developer || 'unknown'}
- Publisher: ${ctx.publisher || 'unknown'}
${ctx.igdbDescription ? `- IGDB Description: ${ctx.igdbDescription}` : ''}

=== SEARCH RESULTS ===
${ctx.searchContext}

=== BRIEFING STRUCTURE ===
Organize your briefing with these sections (use bullet points):

1. CORE GAME IDENTITY
   - Genre(s) and gameplay style
   - Core gameplay loop
   - Primary appeal (what players praise most, per sources)

2. RELEASE & AVAILABILITY
   - Release status and date
   - Available platforms
   - Development stage (released/early access/upcoming)

3. KEY FEATURES & MECHANICS
   - Standout gameplay mechanics
   - Unique selling points
   - Innovation or notable systems

4. TECHNICAL & CONTENT DETAILS
   - Game modes (single/multiplayer)
   - Content scope
   - Technical specifications (if relevant)

5. RECEPTION & COMMUNITY
   - Critical reception (review scores if available)
   - Player sentiment
   - Notable praise or criticism

6. CURRENT STATE & HISTORY
   - Recent updates or patches
   - Development timeline
   - Controversies or ongoing issues (if any)

IMPORTANT:
- NO word limits - be thorough
- Ground all claims in sources
- Note conflicting information
- Acknowledge gaps in knowledge

Output your comprehensive briefing:`;
}

/**
 * System prompt for Scout category insights.
 */
export function getScoutCategorySystemPrompt(localeInstruction: string): string {
  return `You are the Scout agent analyzing category-specific research.

${localeInstruction}`;
}

/**
 * User prompt for Scout category insights.
 */
export function getScoutCategoryUserPrompt(
  gameName: string,
  instruction: string | null | undefined,
  categoryContext: string
): string {
  return `Analyze the category-specific research for "${gameName}".

${instruction ? `User wants: ${instruction}` : 'General analysis requested'}

=== CATEGORY RESEARCH ===
${categoryContext || '(No category-specific research available)'}

Provide insights on:
- What angle would make the best article (news/review/guide/list)?
- What specific aspects should be highlighted?
- What gaps exist in current coverage?

Keep it factual and brief (3-5 bullet points):`;
}

/**
 * System prompt for Scout recent developments.
 */
export function getScoutRecentSystemPrompt(localeInstruction: string): string {
  return `You are the Scout agent tracking recent developments.

${localeInstruction}`;
}

/**
 * User prompt for Scout recent developments.
 */
export function getScoutRecentUserPrompt(gameName: string, recentContext: string): string {
  return `Summarize recent news and updates for "${gameName}".

=== RECENT FINDINGS ===
${recentContext || '(No recent news found)'}

Provide:
- Latest announcements or updates
- Recent patch notes or changes
- Current community discussions
- Time-sensitive information

Brief summary (3-5 bullet points, or state if nothing significant):`;
}

/**
 * Builds search queries for Scout.
 */
export function buildScoutQueries(context: GameArticleContext): {
  overview: string;
  category: string[];
  recent: string;
} {
  const currentYear = new Date().getFullYear();

  const overview = `"${context.gameName}" game overview gameplay mechanics ${context.genres?.join(' ') || ''}`;

  const categoryQueries: string[] = [];
  if (context.instruction) {
    categoryQueries.push(`"${context.gameName}" ${context.instruction}`);
  } else {
    categoryQueries.push(`"${context.gameName}" review analysis opinion`);
    categoryQueries.push(`"${context.gameName}" guide tips strategies`);
  }

  if (context.categoryHints?.length) {
    for (const hint of context.categoryHints) {
      categoryQueries.push(`"${context.gameName}" ${hint.systemPrompt || hint.slug}`);
    }
  }

  const recent = `"${context.gameName}" latest news updates patches ${currentYear}`;

  return { overview, category: categoryQueries, recent };
}

