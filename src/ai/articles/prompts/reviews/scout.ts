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

  getSupplementaryUserPrompt(gameName: string, supplementaryContext: string): string {
    return `Summarize recent updates relevant to a REVIEW for "${gameName}".
Focus on: Fixes for reported bugs, performance patches, post-launch content that changes the value proposition.
Ignore: Minor cosmetic DLC, esports news.

=== RECENT UPDATES ===
${supplementaryContext}`;
  },

  buildQueries(context: GameArticleContext): ScoutQueryConfig {
    const currentYear = new Date().getFullYear();

    // Build instruction-specific category query
    let categoryQuery = `"${context.gameName}" review score verdict pros cons`;
    if (context.instruction) {
      categoryQuery = `"${context.gameName}" ${context.instruction} review`;
    }

    return {
      slots: [
        // Slot 1: Overview - Critical consensus
        {
          query: `"${context.gameName}" review analysis critique pros cons`,
          category: 'overview',
          maxResults: 10,
          searchDepth: 'advanced',
        },
        // Slot 2: Category-specific - Player opinions and technical state
        {
          query: categoryQuery,
          category: 'category-specific',
          maxResults: 10,
          searchDepth: 'basic',
        },
        // Slot 3: Recent - Current state after patches
        {
          query: `"${context.gameName}" current state review ${currentYear} after updates patches`,
          category: 'recent',
          maxResults: 10,
          searchDepth: 'basic',
        },
      ],
    };
  },

  getQueryOptimizationPrompt(ctx: QueryOptimizationContext): QueryOptimizationPrompt {
    const currentYear = new Date().getFullYear();
    const focus = ctx.instruction || 'overall game quality';
    
    return {
      queryStructure: `For a REVIEW article, generate 3 complementary queries covering:

1. OVERVIEW QUERY: Critical consensus and general reception
   - Focus on pros and cons from multiple reviewers
   - Metacritic/OpenCritic style consensus
   
2. FOCUS-SPECIFIC QUERY: Directly about "${focus}"
   - This is the MAIN query - the specific review angle
   - Look for detailed analysis of this aspect
   
3. CURRENT STATE QUERY: How the game is NOW after patches
   - Critical for reviews - games change post-launch
   - Bug fixes, performance patches, new content
   - Must include current year (${currentYear})`,

      tavilyExamples: [
        `"${ctx.gameName}" review analysis pros cons verdict`,
        `"${ctx.gameName}" ${focus} review critique`,
        `"${ctx.gameName}" current state ${currentYear} after patches updates`,
      ],

      exaExamples: [
        `What do critics and players think about ${ctx.gameName}?`,
        `How good is the ${focus} in ${ctx.gameName}?`,
        `Is ${ctx.gameName} worth playing now after all the patches?`,
      ],
    };
  },
};
