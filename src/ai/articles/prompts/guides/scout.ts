import type { GameArticleContext } from '../../types';
import type { ExaQueryConfig, ScoutPromptContext, ScoutPrompts, ScoutQueryConfig } from '../shared/scout';

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

  getRecentUserPrompt(gameName: string, recentContext: string): string {
    return `Summarize recent changes relevant to a GUIDE for "${gameName}".
Focus on: Patch notes that changed mechanics, new content/DLC, or balance changes (nerfs/buffs).
Ignore: Sales numbers, corporate news, unrelated announcements.

=== RECENT NEWS ===
${recentContext}`;
  },

  buildQueries(context: GameArticleContext): ScoutQueryConfig {
    const overview = `"${context.gameName}" gameplay mechanics guide walkthrough tutorial`;
    const category: string[] = [];

    // Base guide queries
    category.push(`"${context.gameName}" beginner guide tips tricks`);
    category.push(`"${context.gameName}" full walkthrough strategy`);
    category.push(`"${context.gameName}" how to play mechanics explained`);

    // Instruction specific
    if (context.instruction) {
      const cleaned = context.instruction.replace(/guide|walkthrough|how to/gi, '').trim();
      if (cleaned) {
        category.push(`"${context.gameName}" ${cleaned} guide steps`);
        category.push(`"${context.gameName}" ${cleaned} location solution`);
      }
    }

    // Genre specific
    if (context.genres?.some(g => g.toLowerCase().includes('rpg'))) {
      category.push(`"${context.gameName}" best build stats leveling`);
    }

    // Recent updates for guides
    const recent = `"${context.gameName}" latest patch notes mechanics changes ${new Date().getFullYear()}`;

    return { overview, category, recent };
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
  }
};
