import type { GameArticleContext } from '../../types';
import type { ScoutPromptContext, ScoutPrompts, ScoutQueryConfig } from '../shared/scout';

export const scoutPrompts: ScoutPrompts = {
  getSystemPrompt(localeInstruction: string): string {
    return `You are the Scout agent specialized in GAME REVIEWS and CRITIQUE.
    
Your mission: Gather critical consensus, performance data, and detailed analysis.

Core focus:
- CRITIQUE: What critics and players like/dislike (Pros & Cons)
- PERFORMANCE: Framerate, bugs, technical state
- VALUE: Content amount, replayability, price-to-value ratio
- COMPARISON: How it compares to similar games in the genre

${localeInstruction}`;
  },

  getOverviewUserPrompt(ctx: ScoutPromptContext): string {
    return `Create a comprehensive briefing for a REVIEW of "${ctx.gameName}".

=== GAME METADATA ===
- Name: ${ctx.gameName}
- Genre: ${ctx.genres?.join(', ') || 'unknown'}

=== SEARCH RESULTS ===
${ctx.searchContext}

=== BRIEFING STRUCTURE ===
1. CRITICAL CONSENSUS
   - Overall reception (Metacritic/OpenCritic vibes)
   - Major points of praise
   - Major points of criticism

2. GAMEPLAY LOOP ANALYSIS
   - Is it fun? Repetitive? Innovative?
   - Difficulty balance

3. TECHNICAL STATE
   - Bugs, crashes, performance issues
   - Graphics and sound quality

4. NARRATIVE & ART (if applicable)
   - Story quality, writing, acting
   - Art style and direction

Output your review briefing:`;
  },

  getCategoryUserPrompt(gameName: string, instruction: string | null | undefined, categoryContext: string): string {
    return `Analyze review-specific research for "${gameName}".

=== RESEARCH ===
${categoryContext}

Identify:
- The specific "Pros" and "Cons" listed by multiple sources
- Any controversial design decisions
- Performance differences between platforms (PC vs Console)
- Final verdict themes (e.g., "Good but buggy", "Masterpiece", "Wait for sale")`;
  },

  getRecentUserPrompt(gameName: string, recentContext: string): string {
    return `Summarize recent updates relevant to a REVIEW for "${gameName}".
Focus on: Fixes for reported bugs, performance patches, post-launch content that changes the value proposition.
Ignore: Minor cosmetic DLC, esports news.

=== RECENT NEWS ===
${recentContext}`;
  },

  buildQueries(context: GameArticleContext): ScoutQueryConfig {
    const overview = `"${context.gameName}" review analysis critique pros cons`;
    const category: string[] = [];

    // Base review queries
    category.push(`"${context.gameName}" review score verdict`);
    category.push(`"${context.gameName}" performance technical review bugs`);
    category.push(`"${context.gameName}" worth it review opinion`);
    category.push(`"${context.gameName}" reddit player reviews`);

    // Instruction specific
    if (context.instruction) {
      category.push(`"${context.gameName}" ${context.instruction} review`);
    }

    // Recent updates (is it fixed?)
    const recent = `"${context.gameName}" current state review ${new Date().getFullYear()} after updates`;

    return { overview, category, recent };
  }
};
