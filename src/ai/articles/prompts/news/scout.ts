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
    return `You are the Scout agent specialized in GAME NEWS and JOURNALISM.
    
Your mission: Gather accurate, time-sensitive facts from official sources and reputable reporting.

Core focus:
- THE 5 Ws: Who, What, When, Where, Why
- ACCURACY: Verify dates, names, and quotes exactly
- SOURCES: Prioritize official announcements (dev blogs, trailers) and primary sources
- CONTEXT: What came before this news, and what comes next

${localeInstruction}`;
  },

  getOverviewUserPrompt(ctx: ScoutPromptContext): string {
    return `Create a comprehensive briefing for a NEWS article about "${ctx.gameName}".

=== GAME METADATA ===
- Name: ${ctx.gameName}
- Date: ${new Date().toLocaleDateString()}

=== SEARCH RESULTS ===
${ctx.searchContext}

=== BRIEFING STRUCTURE ===
1. THE CORE STORY
   - What exactly happened or was announced?
   - Key dates and deadlines

2. OFFICIAL DETAILS
   - Direct quotes from developers/publishers
   - Specific features/content listed in the announcement

3. CONTEXT & BACKGROUND
   - Previous related events
   - Why this matters to the community

4. COMMUNITY REACTION
   - Initial player response (hype, anger, confusion)

Output your news briefing:`;
  },

  getCategoryUserPrompt(gameName: string, instruction: string | null | undefined, categoryContext: string): string {
    return `Analyze news-specific research for "${gameName}".

=== RESEARCH ===
${categoryContext}

Identify:
- The primary source of the news (who said it first?)
- Any conflicting reports or confusion
- Specific details that might be buried (patch sizes, exact times, region restrictions)`;
  },

  getSupplementaryUserPrompt(gameName: string, supplementaryContext: string): string {
    return `Summarize the very latest developments for "${gameName}".
For NEWS, this is the most important section. Ensure nothing from the last 24-48 hours is missed.

=== RECENT NEWS ===
${supplementaryContext}`;
  },

  buildQueries(context: GameArticleContext): ScoutQueryConfig {
    const currentYear = new Date().getFullYear();

    // Build instruction-specific category query
    let categoryQuery = `"${context.gameName}" press release official announcement`;
    if (context.instruction) {
      categoryQuery = `"${context.gameName}" ${context.instruction} news announcement`;
    }

    return {
      slots: [
        // Slot 1: Overview - Latest news and announcements
        {
          query: `"${context.gameName}" latest news announcement official ${currentYear}`,
          category: 'overview',
          maxResults: 10,
          searchDepth: 'advanced',
        },
        // Slot 2: Category-specific - Official sources
        {
          query: categoryQuery,
          category: 'category-specific',
          maxResults: 10,
          searchDepth: 'basic',
        },
        // Slot 3: Recent - Very latest developments (critical for news)
        {
          query: `"${context.gameName}" news last week ${currentYear}`,
          category: 'recent',
          maxResults: 10,
          searchDepth: 'advanced',
        },
      ],
    };
  },

  getQueryOptimizationPrompt(ctx: QueryOptimizationContext): QueryOptimizationPrompt {
    const currentYear = new Date().getFullYear();
    const intent = ctx.instruction || 'latest announcements';
    
    return {
      queryStructure: `For a NEWS article, generate 3 complementary queries covering:

1. OVERVIEW QUERY: General latest news and official announcements
   - Focus on recent official statements, press releases
   - Include the current year (${currentYear})
   
2. INTENT-SPECIFIC QUERY: Directly about "${intent}"
   - This is the MAIN query - the specific news topic
   - Look for official sources and primary reports
   
3. RECENT QUERY: Very latest developments (last 24-48 hours)
   - Critical for news articles - must be current
   - Check for updates, follow-ups, community reactions`,

      tavilyExamples: [
        `"${ctx.gameName}" latest news announcement official ${currentYear}`,
        `"${ctx.gameName}" ${intent} news announcement`,
        `"${ctx.gameName}" news this week ${currentYear}`,
      ],

      exaExamples: [
        `What is the latest official news about ${ctx.gameName}?`,
        `What was announced about ${intent} for ${ctx.gameName}?`,
        `What are players saying about the recent ${ctx.gameName} news?`,
      ],
    };
  },
};
