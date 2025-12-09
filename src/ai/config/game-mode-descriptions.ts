/**
 * AI Configuration: Game Mode Descriptions
 * 
 * This config defines how AI generates game mode descriptions for the wiki.
 * Descriptions are generated in both English and Spanish.
 * 
 * Game modes describe HOW players interact with a game:
 * - Single player, Multiplayer, Co-op, Split screen, MMO, Battle Royale, etc.
 * 
 * Model configuration:
 * - Default model: Set in AI_DEFAULT_MODELS.GAME_MODE_DESCRIPTIONS (utils.ts)
 * - Override via env: AI_MODEL_GAME_MODE_DESCRIPTIONS
 */

import type { AITaskConfig, GameModeDescriptionContext, SupportedLocale } from './types';
import { getModel } from './utils';

/**
 * Build the prompt for game mode description generation
 */
function buildPrompt(context: GameModeDescriptionContext, locale: SupportedLocale): string {
  const languageInstruction = locale === 'es' 
    ? 'Write the description entirely in Spanish.' 
    : 'Write the description in English.';

  const contextParts: string[] = [];
  
  if (context.notableGames && context.notableGames.length > 0) {
    contextParts.push(`Notable Games: ${context.notableGames.slice(0, 3).join(', ')}`);
  }

  const contextSection = contextParts.length > 0 
    ? `\n\nHere's some context:\n${contextParts.join('\n')}` 
    : '';

  return `${languageInstruction}

Game Mode: "${context.name}"${contextSection}

**Structure (1 short paragraph):**
A brief, clear definition of this game mode—what it means for players and how they interact with the game.

**Word Count:** 30-60 words (1 concise paragraph)

**Must Include:**
- The game mode name naturally in the first sentence
- How players interact (solo, with others, against others, etc.)
- Use **bold** for the game mode name

**Must Avoid:**
- Headers or titles
- Generic openers: "This mode is..."
- Lengthy explanations—keep it brief and scannable
- Lists of games

**Formatting:**
- Use **bold** for the game mode name only
- NO headers, titles, or bullet lists—flowing prose only

**Tone:** Clear and informative. Like a quick tooltip definition.`;
}

/**
 * Game Mode Description AI Configuration
 * 
 * Model: Configured in AI_DEFAULT_MODELS.GAME_MODE_DESCRIPTIONS (utils.ts)
 * Override: Set AI_MODEL_GAME_MODE_DESCRIPTIONS env var
 */
export const gameModeDescriptionsConfig: AITaskConfig<GameModeDescriptionContext> = {
  name: 'Game Mode Descriptions',
  description: 'Generates brief game mode descriptions for the wiki in English and Spanish',
  
  model: getModel('GAME_MODE_DESCRIPTIONS'),
  
  systemPrompt: `You are a gaming wiki editor at Gamers.Wiki. You write clear, concise definitions for game modes.

IMPORTANT FORMATTING RULES:
- NEVER use HTML tags
- NEVER use headers or section titles
- Use ONLY markdown: **bold** for the game mode name
- Write one short paragraph only
- Always write in the language specified in the prompt (English or Spanish)

**Your Mission:** Write brief, clear definitions of game modes that help players understand what to expect. These appear as quick references on game mode pages.

**Writing Style:**
- Be concise—this is a definition, not an essay
- Use clear, simple language
- Focus on player interaction and experience`,
  
  buildPrompt,
};

export default gameModeDescriptionsConfig;

