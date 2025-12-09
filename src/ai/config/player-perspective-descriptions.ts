/**
 * AI Configuration: Player Perspective Descriptions
 * 
 * This config defines how AI generates player perspective descriptions for the wiki.
 * Descriptions are generated in both English and Spanish.
 * 
 * Player perspectives describe the camera viewpoint in games:
 * - First person, Third person, Bird's-eye / Isometric, Side view, etc.
 * 
 * Model configuration:
 * - Default model: Set in AI_DEFAULT_MODELS.PLAYER_PERSPECTIVE_DESCRIPTIONS (utils.ts)
 * - Override via env: AI_MODEL_PLAYER_PERSPECTIVE_DESCRIPTIONS
 */

import type { AITaskConfig, PlayerPerspectiveDescriptionContext, SupportedLocale } from './types';
import { getModel } from './utils';

/**
 * Build the prompt for player perspective description generation
 */
function buildPrompt(context: PlayerPerspectiveDescriptionContext, locale: SupportedLocale): string {
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

Player Perspective: "${context.name}"${contextSection}

**Structure (1 short paragraph):**
A brief, clear definition of this camera perspective—how players view the game world and character.

**Word Count:** 30-60 words (1 concise paragraph)

**Must Include:**
- The perspective name naturally in the first sentence
- How the camera is positioned relative to the character/action
- Use **bold** for the perspective name

**Must Avoid:**
- Headers or titles
- Generic openers: "This perspective is..."
- Lengthy explanations—keep it brief and scannable
- Lists of games

**Formatting:**
- Use **bold** for the perspective name only
- NO headers, titles, or bullet lists—flowing prose only

**Tone:** Clear and informative. Like a quick tooltip definition.`;
}

/**
 * Player Perspective Description AI Configuration
 * 
 * Model: Configured in AI_DEFAULT_MODELS.PLAYER_PERSPECTIVE_DESCRIPTIONS (utils.ts)
 * Override: Set AI_MODEL_PLAYER_PERSPECTIVE_DESCRIPTIONS env var
 */
export const playerPerspectiveDescriptionsConfig: AITaskConfig<PlayerPerspectiveDescriptionContext> = {
  name: 'Player Perspective Descriptions',
  description: 'Generates brief player perspective descriptions for the wiki in English and Spanish',
  
  model: getModel('PLAYER_PERSPECTIVE_DESCRIPTIONS'),
  
  systemPrompt: `You are a gaming wiki editor at Gamers.Wiki. You write clear, concise definitions for player perspectives.

IMPORTANT FORMATTING RULES:
- NEVER use HTML tags
- NEVER use headers or section titles
- Use ONLY markdown: **bold** for the perspective name
- Write one short paragraph only
- Always write in the language specified in the prompt (English or Spanish)

**Your Mission:** Write brief, clear definitions of camera perspectives that help players understand what to expect visually. These appear as quick references on perspective pages.

**Writing Style:**
- Be concise—this is a definition, not an essay
- Use clear, simple language
- Focus on visual experience and how players see the game world`,
  
  buildPrompt,
};

export default playerPerspectiveDescriptionsConfig;

