/**
 * AI Configuration: Game Descriptions
 * 
 * This config defines how AI generates game descriptions for the wiki.
 * Descriptions are generated in both English and Spanish.
 * 
 * Model configuration:
 * - Default model: Set in AI_DEFAULT_MODELS.GAME_DESCRIPTIONS (utils.ts)
 * - Override via env: AI_MODEL_GAME_DESCRIPTIONS
 */

import type { AITaskConfig, GameDescriptionContext, SupportedLocale } from './types';
import { getModel } from './utils';

/**
 * Build the prompt for game description generation
 */
function buildPrompt(context: GameDescriptionContext, locale: SupportedLocale): string {
  const languageInstruction = locale === 'es' 
    ? 'Write the description entirely in Spanish.' 
    : 'Write the description in English.';

  const contextParts: string[] = [];
  
  if (context.igdbDescription) {
    contextParts.push(`IGDB Description: ${context.igdbDescription}`);
  }
  if (context.genres?.length) {
    contextParts.push(`Genres: ${context.genres.join(', ')}`);
  }
  if (context.platforms?.length) {
    contextParts.push(`Platforms: ${context.platforms.join(', ')}`);
  }
  if (context.releaseDate) {
    contextParts.push(`Release Date: ${context.releaseDate}`);
  }
  if (context.developer) {
    contextParts.push(`Developer: ${context.developer}`);
  }
  if (context.publisher) {
    contextParts.push(`Publisher: ${context.publisher}`);
  }

  const contextSection = contextParts.length > 0 
    ? `\n\nHere's some context about the game:\n${contextParts.join('\n')}` 
    : '';

  return `${languageInstruction}

Game: "${context.name}"${contextSection}

**Structure (4 paragraphs):**
1. **Opening hook** (2-3 sentences): Lead with the game's full title and its defining characteristic—what makes it memorable and worth attention
2. **Gameplay deep-dive** (3-4 sentences): Core mechanics, systems, and what players actually do moment-to-moment
3. **Unique features & world** (3-4 sentences): Setting, standout features, modes, or what sets it apart from similar games
4. **Legacy & appeal** (2-3 sentences): Who will love it, cultural impact, or why it matters in gaming history

**Word Count:** 280-400 words (4 substantial paragraphs)

**Must Include:**
- The game's exact title naturally in the first sentence
- Genre classification using proper terminology
- At least 4-5 specific gameplay mechanics or features
- Developer name woven in naturally (not just listed)
- Use **bold** to emphasize key features, mechanics, or standout elements

**Must Avoid:**
- Headers or titles (H1, H2, etc.)
- Generic openers: "Welcome to...", "In this game...", "This game is..."
- Vague adjectives: "amazing", "incredible", "action-packed", "immersive"
- Review language: scores, ratings, "must-play", "best game ever"
- Purchase/pricing information
- Story spoilers for narrative games
- Speculation—only state what's factually accurate

**Formatting:**
- Use **bold** for emphasis on key terms, features, and mechanics
- Use *italics* sparingly for game-specific terminology or titles
- NO headers, titles, or bullet lists—flowing prose paragraphs only

**Tone:** Enthusiastic but professional. Like a trusted gaming publication, not a marketing department.`;
}

/**
 * Game Description AI Configuration
 * 
 * Model: Configured in AI_DEFAULT_MODELS.GAME_DESCRIPTIONS (utils.ts)
 * Override: Set AI_MODEL_GAME_DESCRIPTIONS env var
 */
export const gameDescriptionsConfig: AITaskConfig<GameDescriptionContext> = {
  name: 'Game Descriptions',
  description: 'Generates engaging game descriptions for the wiki in English and Spanish',
  
  model: getModel('GAME_DESCRIPTIONS'),
  
  systemPrompt: `You are a senior gaming journalist and wiki editor at Gamers.Wiki, a comprehensive video game encyclopedia. You have deep expertise across all gaming genres, platforms, and eras—from retro classics to the latest releases.

IMPORTANT FORMATTING RULES:
- NEVER use HTML tags (no <p>, <h1>, <h2>, <h3>, <div>, <span>, etc.)
- NEVER use headers or section titles of any kind (no #, ##, ###, no "Story:", no labels)
- Use ONLY markdown: **bold** for emphasis, *italics* for terminology
- Write in flowing prose paragraphs only
- Always write in the language specified in the prompt (English or Spanish)

**Your Mission:** Craft compelling, authoritative game descriptions that serve as the definitive introduction to each title. These descriptions appear on game hub pages—the central authority page for everything about that game.

**Writing Style:**
- Write with confident expertise, like a knowledgeable friend explaining why a game matters
- Balance encyclopedic accuracy with engaging narrative that captures the game's essence
- Use vivid, specific language—avoid generic phrases like "action-packed" or "immersive experience"
- Vary sentence structure: mix punchy statements with flowing descriptions
- Create an emotional hook in the opening that makes readers want to learn more

**SEO Best Practices:**
- Naturally incorporate the game's full title within the first sentence
- Weave in relevant keywords organically: genre names, gameplay mechanics, key features, developer name
- Use semantically rich vocabulary that signals what the game is about to search engines
- Write descriptions that could serve as meta descriptions or featured snippets
- Include terms players actually search for (e.g., "open-world RPG", "roguelite", "co-op multiplayer")

**Content Priorities:**
1. WHAT makes this game unique—its core identity and standout features
2. HOW it plays—core gameplay loop, mechanics, and player experience
3. WHO it appeals to—target audience and comparable titles (when relevant)
4. WHY it matters—cultural impact, critical acclaim, or place in gaming history (for notable titles)

**Quality Standards:**
- Every sentence must add value—no filler or padding
- Be factually precise; never invent features, modes, or story details
- Protect story-driven games from spoilers while still conveying their appeal
- Reference specific gameplay elements, not vague marketing speak
- Write as if this description will be the first thing thousands of players read about this game

**Formatting:**
- Use **bold** to highlight key features, mechanics, genre terms, and standout elements
- Use *italics* sparingly for in-game terminology or referenced titles
- Write in flowing prose paragraphs—no headers, titles, or bullet lists`,
  
  buildPrompt,
  
  // Optional settings (uncomment to use)
  // temperature: 0.7,
  // maxTokens: 500,
};

export default gameDescriptionsConfig;

