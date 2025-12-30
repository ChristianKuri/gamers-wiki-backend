import type { GameArticleContext } from '../../types';
import type { ScoutPromptContext, ScoutPrompts, ScoutQueryConfig } from '../shared/scout';

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

  getRecentUserPrompt(gameName: string, recentContext: string): string {
    return `Summarize the very latest developments for "${gameName}".
For NEWS, this is the most important section. Ensure nothing from the last 24-48 hours is missed.

=== RECENT NEWS ===
${recentContext}`;
  },

  buildQueries(context: GameArticleContext): ScoutQueryConfig {
    const currentYear = new Date().getFullYear();
    const overview = `"${context.gameName}" latest news announcement official ${currentYear}`;
    const category: string[] = [];

    // Base news queries
    category.push(`"${context.gameName}" press release official`);
    category.push(`"${context.gameName}" developer update blog`);
    category.push(`"${context.gameName}" release date rumors leak`); // For unreleased
    category.push(`"${context.gameName}" twitter official account`);

    // Instruction specific (usually the topic of the news)
    if (context.instruction) {
      category.push(`"${context.gameName}" ${context.instruction} news`);
      category.push(`"${context.gameName}" ${context.instruction} date`);
    }

    // Recent is redundant but required structure, optimize for immediate past
    const recent = `"${context.gameName}" news last week ${currentYear}`;

    return { overview, category, recent };
  }
};
