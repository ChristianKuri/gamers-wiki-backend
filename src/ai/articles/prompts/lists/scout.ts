import type { GameArticleContext } from '../../types';
import type { ScoutPromptContext, ScoutPrompts, ScoutQueryConfig } from '../shared/scout';

export const scoutPrompts: ScoutPrompts = {
  getSystemPrompt(localeInstruction: string): string {
    return `You are the Scout agent specialized in GAME LISTS and RANKINGS.
    
Your mission: Gather enough candidates to create a robust list, along with comparison points for each.

Core focus:
- CANDIDATES: Find 10-20 potential items/games/characters to include
- DETAILS: Pros, cons, and stats for EACH candidate
- CRITERIA: Why is X better than Y?
- VARIETY: Ensure the pool covers different playstyles or preferences

${localeInstruction}`;
  },

  getOverviewUserPrompt(ctx: ScoutPromptContext): string {
    return `Create a comprehensive briefing for a LIST article about "${ctx.gameName}".

=== GAME METADATA ===
- Name: ${ctx.gameName}
- Genre: ${ctx.genres?.join(', ') || 'unknown'}

=== SEARCH RESULTS ===
${ctx.searchContext}

=== BRIEFING STRUCTURE ===
1. LIST THEME & CRITERIA
   - What is being ranked/listed? (e.g., Best Weapons, Top Bosses)
   - What makes an item "good" in this context?

2. TOP CANDIDATES (Detailed)
   - The clear winners that MUST be in the list
   - Key stats/reasons for their dominance

3. HONORABLE MENTIONS
   - Niche choices or strong contenders

4. COMPARISON DATA
   - Shared stats or attributes relevant for ranking

Output your list briefing:`;
  },

  getCategoryUserPrompt(gameName: string, instruction: string | null | undefined, categoryContext: string): string {
    return `Analyze list-specific research for "${gameName}".

=== RESEARCH ===
${categoryContext}

Identify:
- A pool of at least 10 valid candidates for the list
- Consensus on the "number 1" spot
- Common arguments/debates in the community (e.g., "Weapon A vs Weapon B")`;
  },

  getRecentUserPrompt(gameName: string, recentContext: string): string {
    return `Summarize recent meta changes for "${gameName}" that affect rankings.
Focus on: Buffs/nerfs, new items added, new strategies that changed the tier list.

=== RECENT NEWS ===
${recentContext}`;
  },

  buildQueries(context: GameArticleContext): ScoutQueryConfig {
    const overview = `"${context.gameName}" best top ranked tier list`;
    const category: string[] = [];

    // Base list queries
    category.push(`"${context.gameName}" best items ranking`);
    category.push(`"${context.gameName}" meta tier list`);
    category.push(`"${context.gameName}" comparison guide`);
    category.push(`"${context.gameName}" reddit best setup`);

    // Instruction specific (defines the list topic)
    if (context.instruction) {
      const topic = context.instruction.replace(/list|ranking|best|top/gi, '').trim();
      if (topic) {
        category.push(`"${context.gameName}" best ${topic} ranking`);
        category.push(`"${context.gameName}" top ${topic} list`);
        category.push(`"${context.gameName}" ${topic} tier list`);
      }
    }

    const recent = `"${context.gameName}" meta changes patch notes ${new Date().getFullYear()}`;

    return { overview, category, recent };
  }
};
