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
 * Detects the likely article type from the user instruction.
 * Used to tailor search queries and avoid irrelevant content.
 */
export function detectArticleIntent(instruction: string | null | undefined): 'guide' | 'review' | 'news' | 'list' | 'general' {
  if (!instruction) return 'general';

  const lowerInstruction = instruction.toLowerCase();

  // Guide indicators
  if (
    lowerInstruction.includes('guide') ||
    lowerInstruction.includes('how to') ||
    lowerInstruction.includes('walkthrough') ||
    lowerInstruction.includes('tutorial') ||
    lowerInstruction.includes('tips') ||
    lowerInstruction.includes('beginner') ||
    lowerInstruction.includes('strategy') ||
    lowerInstruction.includes('build')
  ) {
    return 'guide';
  }

  // Review indicators
  if (
    lowerInstruction.includes('review') ||
    lowerInstruction.includes('opinion') ||
    lowerInstruction.includes('analysis') ||
    lowerInstruction.includes('worth') ||
    lowerInstruction.includes('critique')
  ) {
    return 'review';
  }

  // News indicators
  if (
    lowerInstruction.includes('news') ||
    lowerInstruction.includes('announcement') ||
    lowerInstruction.includes('update') ||
    lowerInstruction.includes('release') ||
    lowerInstruction.includes('launch')
  ) {
    return 'news';
  }

  // List indicators
  if (
    lowerInstruction.includes('best') ||
    lowerInstruction.includes('top') ||
    lowerInstruction.includes('ranking') ||
    lowerInstruction.includes('list') ||
    lowerInstruction.includes('compared')
  ) {
    return 'list';
  }

  return 'general';
}

/**
 * Exa semantic query configuration for guide articles.
 * These queries are designed for Exa's neural search, which understands meaning rather than keywords.
 */
export interface ExaQueryConfig {
  /** Semantic queries for Exa neural search */
  readonly semantic: string[];
  /** Domains to prioritize for guide content (wikis, authoritative gaming sites) */
  readonly preferredDomains: readonly string[];
}

/**
 * Builds Exa-specific queries for guide articles.
 * Exa excels at semantic/meaning-based queries like "how does X work".
 *
 * @param context - Game article context
 * @returns Exa query configuration for guides, or null if not a guide
 */
export function buildExaQueriesForGuides(context: GameArticleContext): ExaQueryConfig | null {
  const intent = detectArticleIntent(context.instruction);

  // Only use Exa for guide articles (for now)
  if (intent !== 'guide') {
    return null;
  }

  const semanticQueries: string[] = [];

  // Core semantic queries for guides - natural language that Exa handles well
  semanticQueries.push(`how does gameplay work in ${context.gameName}`);
  semanticQueries.push(`beginner tips and essential mechanics for ${context.gameName}`);

  // Extract specific mechanics from instruction if present
  if (context.instruction) {
    const lowerInstruction = context.instruction.toLowerCase();

    // Add instruction-specific semantic queries
    if (lowerInstruction.includes('first hour') || lowerInstruction.includes('beginner')) {
      semanticQueries.push(`what to do first when starting ${context.gameName}`);
      semanticQueries.push(`essential early game tips for ${context.gameName}`);
    }
    if (lowerInstruction.includes('build') || lowerInstruction.includes('class')) {
      semanticQueries.push(`best character builds and loadouts in ${context.gameName}`);
    }
    if (lowerInstruction.includes('boss') || lowerInstruction.includes('combat')) {
      semanticQueries.push(`combat strategies and boss tips for ${context.gameName}`);
    }
  }

  // Add genre-specific semantic queries
  if (context.genres) {
    const genresLower = context.genres.map((g) => g.toLowerCase());
    if (genresLower.some((g) => g.includes('rpg') || g.includes('role-playing'))) {
      semanticQueries.push(`character progression and leveling guide for ${context.gameName}`);
    }
    if (genresLower.some((g) => g.includes('open world') || g.includes('adventure'))) {
      semanticQueries.push(`exploration tips and key locations in ${context.gameName}`);
    }
    if (genresLower.some((g) => g.includes('action') || g.includes('souls'))) {
      semanticQueries.push(`combat mechanics and controls in ${context.gameName}`);
    }
  }

  // Limit to 3 Exa queries to balance cost and coverage
  const limitedQueries = semanticQueries.slice(0, 3);

  // Preferred domains for guide content (wikis and authoritative gaming sites)
  const preferredDomains = [
    'fandom.com',
    'ign.com',
    'polygon.com',
    'gamespot.com',
    'eurogamer.net',
    'kotaku.com',
    'pcgamer.com',
    'rockpapershotgun.com',
  ] as const;

  return {
    semantic: limitedQueries,
    preferredDomains,
  };
}

/**
 * Builds search queries for Scout with category-aware filtering.
 * Tailors queries based on detected article intent to avoid irrelevant content.
 */
export function buildScoutQueries(context: GameArticleContext): {
  overview: string;
  category: string[];
  recent: string;
} {
  const currentYear = new Date().getFullYear();
  const intent = detectArticleIntent(context.instruction);

  // Base overview query - always needed
  const overview = `"${context.gameName}" game overview gameplay mechanics ${context.genres?.join(' ') || ''}`;

  const categoryQueries: string[] = [];

  // Category-specific search strategies
  switch (intent) {
    case 'guide':
      // For guides: focus on walkthroughs, tutorials, strategies
      // Avoid: patch notes, news, reviews, announcements
      categoryQueries.push(`"${context.gameName}" walkthrough tutorial "how to"`);
      categoryQueries.push(`"${context.gameName}" tips strategies beginners guide`);
      if (context.instruction) {
        // Add the specific instruction query, but filter out news-like terms
        const cleanedInstruction = context.instruction
          .replace(/patch|update|news|changelog/gi, '')
          .trim();
        if (cleanedInstruction) {
          categoryQueries.push(`"${context.gameName}" ${cleanedInstruction}`);
        }
      }
      break;

    case 'review':
      // For reviews: focus on critical analysis, opinions, comparisons
      categoryQueries.push(`"${context.gameName}" review analysis opinion`);
      categoryQueries.push(`"${context.gameName}" pros cons verdict`);
      if (context.instruction) {
        categoryQueries.push(`"${context.gameName}" ${context.instruction}`);
      }
      break;

    case 'news':
      // For news: focus on recent announcements, official sources
      categoryQueries.push(`"${context.gameName}" announcement official ${currentYear}`);
      categoryQueries.push(`"${context.gameName}" news release ${currentYear}`);
      if (context.instruction) {
        categoryQueries.push(`"${context.gameName}" ${context.instruction}`);
      }
      break;

    case 'list':
      // For lists: focus on rankings, comparisons, collections
      categoryQueries.push(`"${context.gameName}" best ranking top`);
      categoryQueries.push(`"${context.gameName}" compared versus alternatives`);
      if (context.instruction) {
        categoryQueries.push(`"${context.gameName}" ${context.instruction}`);
      }
      break;

    default:
      // General: balanced approach
      if (context.instruction) {
        categoryQueries.push(`"${context.gameName}" ${context.instruction}`);
      } else {
        categoryQueries.push(`"${context.gameName}" review analysis opinion`);
        categoryQueries.push(`"${context.gameName}" guide tips strategies`);
      }
  }

  // Add category hints if provided
  if (context.categoryHints?.length) {
    for (const hint of context.categoryHints) {
      categoryQueries.push(`"${context.gameName}" ${hint.systemPrompt || hint.slug}`);
    }
  }

  // Recent query - adjusted based on intent
  // For evergreen content (guides), de-emphasize patch notes
  const recentQuery = intent === 'guide'
    ? `"${context.gameName}" latest content features ${currentYear}`
    : `"${context.gameName}" latest news updates patches ${currentYear}`;

  return { overview, category: categoryQueries, recent: recentQuery };
}

