import type { GameArticleContext } from '../../types';
import type {
  ExaQueryConfig,
  QueryOptimizationContext,
  QueryOptimizationPrompt,
  ScoutPromptContext,
  ScoutPrompts,
  ScoutQueryConfig,
} from '../shared/scout';

export const scoutPrompts: ScoutPrompts = {
  getSystemPrompt(localeInstruction: string): string {
    return `You are the Scout agent specialized in GAME GUIDES and WALKTHROUGHS.
    
Your mission: Gather practical, actionable information that helps players overcome challenges.

Core focus:
- MECHANICS: How things work, exact numbers, cooldowns, requirements
- SOLUTIONS: Step-by-step instructions, puzzle solutions, boss strategies
- LOCATIONS: Where to find items, NPCs, or hidden areas
- PROGRESSION: Unlock criteria, leveling paths, skill trees

${localeInstruction}`;
  },

  getOverviewUserPrompt(ctx: ScoutPromptContext): string {
    return `Create a comprehensive briefing for a GUIDE about "${ctx.gameName}".

=== GAME METADATA ===
- Name: ${ctx.gameName}
- Genre: ${ctx.genres?.join(', ') || 'unknown'}
${ctx.instruction ? `- Specific Goal: ${ctx.instruction}` : ''}

=== SEARCH RESULTS ===
${ctx.searchContext}

=== BRIEFING STRUCTURE ===
1. CORE MECHANICS
   - How the specific systems relevant to this guide work
   - Controls and inputs

2. STEP-BY-STEP DETAILS
   - Chronological walkthrough or logical progression
   - Prerequisites and requirements

3. TIPS & STRATEGIES
   - Optimal approaches
   - Common mistakes to avoid
   - "Pro" tips from high-level play

4. DATA & STATS
   - Exact numbers (damage, health, costs) if available
   - Item locations and descriptions

Output your comprehensive guide briefing:`;
  },

  getCategoryUserPrompt(gameName: string, instruction: string | null | undefined, categoryContext: string): string {
    return `Analyze guide-specific research for "${gameName}".
${instruction ? `User wants: ${instruction}` : 'General guide coverage'}

=== RESEARCH ===
${categoryContext}

Identify:
- The most difficult steps/parts players get stuck on
- Key mechanics that need detailed explanation
- Essential items or requirements
- Any gaps where we need more specific "how-to" info`;
  },

  getSupplementaryUserPrompt(gameName: string, supplementaryContext: string): string {
    return `Analyze tips, tricks, and secrets for a GUIDE about "${gameName}".
Focus on: Practical advice, common mistakes to avoid, hidden mechanics, pro strategies.
Ignore: News, patch notes, corporate announcements.

=== TIPS & TRICKS ===
${supplementaryContext}`;
  },

  buildQueries(context: GameArticleContext): ScoutQueryConfig {
    // Build instruction-specific category query
    let categoryQuery = `"${context.gameName}" beginner guide walkthrough`;
    if (context.instruction) {
      const cleaned = context.instruction.replace(/guide|walkthrough|how to/gi, '').trim();
      if (cleaned) {
        categoryQuery = `"${context.gameName}" ${cleaned} guide walkthrough`;
      }
    }

    return {
      slots: [
        // Slot 1: Overview - General game mechanics
        {
          query: `"${context.gameName}" gameplay mechanics guide tutorial`,
          category: 'overview',
          maxResults: 10,
          searchDepth: 'advanced',
        },
        // Slot 2: Category-specific - Based on instruction or general beginner guide
        {
          query: categoryQuery,
          category: 'category-specific',
          maxResults: 10,
          searchDepth: 'basic',
        },
        // Slot 3: Tips - Practical advice (NOT recent news)
        {
          query: `"${context.gameName}" tips tricks secrets mistakes to avoid`,
          category: 'tips',
          maxResults: 10,
          searchDepth: 'basic',
        },
      ],
    };
  },

  buildExaQueries(context: GameArticleContext): ExaQueryConfig | null {
    const semanticQueries: string[] = [];
    
    // Core semantic queries
    semanticQueries.push(`how does gameplay work in ${context.gameName}`);
    semanticQueries.push(`beginner tips and essential mechanics for ${context.gameName}`);

    if (context.instruction) {
      semanticQueries.push(`how to ${context.instruction} in ${context.gameName}`);
    }

    // Limit to 3
    const limitedQueries = semanticQueries.slice(0, 3);

    return {
      semantic: limitedQueries,
      preferredDomains: [
        'fandom.com', 'ign.com', 'polygon.com', 'gamespot.com', 
        'eurogamer.net', 'kotaku.com', 'pcgamer.com', 'rockpapershotgun.com'
      ]
    };
  },

  getQueryOptimizationPrompt(ctx: QueryOptimizationContext): QueryOptimizationPrompt {
    const intent = ctx.instruction || 'general gameplay';
    
    return {
      queryStructure: `For a GUIDE article, generate 3 complementary queries covering:

1. OVERVIEW QUERY: General game mechanics and systems
   - Focus on core gameplay, controls, fundamental systems
   - NOT specific to the user's intent yet
   
2. INTENT-SPECIFIC QUERY: Directly about "${intent}"
   - This is the MAIN query - most relevant to what the user wants
   - Be very specific to the user's goal
   
3. TIPS & TRICKS QUERY: Practical advice and secrets
   - Common mistakes to avoid
   - Pro tips, hidden mechanics, shortcuts
   - Should complement the intent query, not duplicate it`,

      tavilyExamples: [
        `"${ctx.gameName}" gameplay mechanics controls tutorial guide`,
        `"${ctx.gameName}" ${intent} guide walkthrough strategies`,
        `"${ctx.gameName}" tips tricks secrets mistakes to avoid`,
      ],

      exaExamples: [
        `How do the core gameplay systems work in ${ctx.gameName}?`,
        `What's the best way to ${intent} in ${ctx.gameName}?`,
        `What are common mistakes beginners make in ${ctx.gameName} and how to avoid them?`,
      ],
    };
  },
};
