import type { GameArticleContext } from '../../types';
import type {
  QueryOptimizationContext,
  QueryOptimizationPrompt,
  ScoutPromptContext,
  ScoutPrompts,
  ScoutQueryConfig,
} from '../shared/scout';

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

  getSupplementaryUserPrompt(gameName: string, supplementaryContext: string): string {
    return `Summarize recent meta changes for "${gameName}" that affect rankings.
Focus on: Buffs/nerfs, new items added, new strategies that changed the tier list.
Ignore: Unrelated news, corporate announcements.

=== META CHANGES ===
${supplementaryContext}`;
  },

  buildQueries(context: GameArticleContext): ScoutQueryConfig {
    const currentYear = new Date().getFullYear();

    // Build instruction-specific category query
    let categoryQuery = `"${context.gameName}" best items ranking tier list`;
    if (context.instruction) {
      const topic = context.instruction.replace(/list|ranking|best|top/gi, '').trim();
      if (topic) {
        categoryQuery = `"${context.gameName}" best ${topic} ranking tier list`;
      }
    }

    return {
      slots: [
        // Slot 1: Overview - General tier list and rankings
        {
          query: `"${context.gameName}" best top ranked tier list`,
          category: 'overview',
          maxResults: 10,
          searchDepth: 'advanced',
        },
        // Slot 2: Category-specific - Focused on the list topic
        {
          query: categoryQuery,
          category: 'category-specific',
          maxResults: 10,
          searchDepth: 'basic',
        },
        // Slot 3: Meta - Recent balance changes that affect rankings
        {
          query: `"${context.gameName}" meta changes patch notes buffs nerfs ${currentYear}`,
          category: 'meta',
          maxResults: 10,
          searchDepth: 'basic',
        },
      ],
    };
  },

  getQueryOptimizationPrompt(ctx: QueryOptimizationContext): QueryOptimizationPrompt {
    const currentYear = new Date().getFullYear();
    const topic = ctx.instruction?.replace(/list|ranking|best|top/gi, '').trim() || 'items';
    
    return {
      queryStructure: `For a LIST/RANKING article, generate 3 complementary queries covering:

1. OVERVIEW QUERY: General tier lists and rankings
   - Focus on community consensus rankings
   - Look for tier list images, ranking discussions
   
2. TOPIC-SPECIFIC QUERY: Directly about "best ${topic}"
   - This is the MAIN query - the specific ranking topic
   - Find detailed comparisons, pros/cons of each item
   
3. META QUERY: Recent balance changes affecting rankings
   - Buffs, nerfs, patches that changed the meta
   - New items/characters added recently
   - Must include current year (${currentYear})`,

      tavilyExamples: [
        `"${ctx.gameName}" tier list ranking best top`,
        `"${ctx.gameName}" best ${topic} ranking comparison`,
        `"${ctx.gameName}" meta changes buffs nerfs ${currentYear}`,
      ],

      exaExamples: [
        `What is the current tier list for ${ctx.gameName}?`,
        `What are the best ${topic} in ${ctx.gameName} and why?`,
        `How did recent patches change the meta in ${ctx.gameName}?`,
      ],
    };
  },
};
