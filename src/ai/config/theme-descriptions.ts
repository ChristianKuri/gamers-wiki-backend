/**
 * AI Configuration: Theme Descriptions
 * 
 * This config defines how AI generates theme descriptions for the wiki.
 * Descriptions are generated in both English and Spanish.
 * 
 * Themes are universal concepts that define the setting, atmosphere, or 
 * subject matter of games (e.g., Fantasy, Sci-Fi, Horror, Post-Apocalyptic).
 * 
 * Model configuration:
 * - Default model: Set in AI_DEFAULT_MODELS.THEME_DESCRIPTIONS (utils.ts)
 * - Override via env: AI_MODEL_THEME_DESCRIPTIONS
 */

import type { AITaskConfig, ThemeDescriptionContext, SupportedLocale } from './types';
import { getModel } from './utils';

/**
 * Build the prompt for theme description generation
 */
function buildPrompt(context: ThemeDescriptionContext, locale: SupportedLocale): string {
  const languageInstruction = locale === 'es' 
    ? 'Write the description entirely in Spanish.' 
    : 'Write the description in English.';

  const contextParts: string[] = [];
  
  if (context.notableGames && context.notableGames.length > 0) {
    contextParts.push(`Notable Games: ${context.notableGames.slice(0, 5).join(', ')}`);
  }
  if (context.relatedThemes && context.relatedThemes.length > 0) {
    contextParts.push(`Related Themes: ${context.relatedThemes.join(', ')}`);
  }
  if (context.relatedGenres && context.relatedGenres.length > 0) {
    contextParts.push(`Common Genres: ${context.relatedGenres.join(', ')}`);
  }

  const contextSection = contextParts.length > 0 
    ? `\n\nHere's some context about the theme:\n${contextParts.join('\n')}` 
    : '';

  return `${languageInstruction}

Theme: "${context.name}"${contextSection}

**Structure (1-2 paragraphs):**
1. **Definition** (2-3 sentences): What defines this theme—its core setting, atmosphere, or subject matter
2. **Characteristics & examples** (2-3 sentences): Key visual, narrative, or tonal elements with notable game examples

**Word Count:** 60-100 words (1-2 concise paragraphs)

**Must Include:**
- The theme's exact name naturally in the first sentence
- Core defining characteristics (setting, atmosphere, narrative elements)
- 1-2 well-known game examples that exemplify the theme
- Use **bold** to emphasize the theme name and key defining features

**Must Avoid:**
- Headers or titles (H1, H2, etc.)
- Generic openers: "Welcome to...", "This theme is..."
- Subjective claims: "the best", "the most exciting"
- Confusing themes with genres (themes are settings/concepts, genres are gameplay styles)
- Lists of every game with this theme

**Formatting:**
- Use **bold** for emphasis on the theme name and key characteristics
- Use *italics* for game titles
- NO headers, titles, or bullet lists—flowing prose only

**Tone:** Informative and evocative. Describe the atmosphere and feel of games with this theme.`;
}

/**
 * Theme Description AI Configuration
 * 
 * Model: Configured in AI_DEFAULT_MODELS.THEME_DESCRIPTIONS (utils.ts)
 * Override: Set AI_MODEL_THEME_DESCRIPTIONS env var
 */
export const themeDescriptionsConfig: AITaskConfig<ThemeDescriptionContext> = {
  name: 'Theme Descriptions',
  description: 'Generates informative theme descriptions for the wiki in English and Spanish',
  
  model: getModel('THEME_DESCRIPTIONS'),
  
  systemPrompt: `You are a senior gaming journalist and wiki editor at Gamers.Wiki, a comprehensive video game encyclopedia. You have deep expertise in game themes, their aesthetics, narratives, and how they shape player experiences.

IMPORTANT: Themes are NOT genres. 
- Themes describe WHAT the game is about (setting, atmosphere, subject matter): Fantasy, Sci-Fi, Horror, Post-Apocalyptic, Steampunk
- Genres describe HOW you play (mechanics, gameplay style): RPG, FPS, Strategy, Platformer

IMPORTANT FORMATTING RULES:
- NEVER use HTML tags (no <p>, <h1>, <h2>, <h3>, <div>, <span>, etc.)
- NEVER use headers or section titles of any kind (no #, ##, ###, no "Definition:", no labels)
- Use ONLY markdown: **bold** for emphasis, *italics* for game titles
- Write in flowing prose paragraphs only
- Always write in the language specified in the prompt (English or Spanish)

**Your Mission:** Craft concise, evocative theme definitions that help players understand the atmosphere and setting of games with this theme. These descriptions appear on theme pages—serving as a quick reference for what to expect thematically.

**Writing Style:**
- Write with confident expertise, like a knowledgeable game curator
- Be concise—themes need quick, atmospheric descriptions
- Use vivid, specific details—paint a picture of the theme
- Focus on what makes this theme distinct and immersive

**SEO Best Practices:**
- Naturally incorporate the theme name within the first sentence
- Include terms players search for when looking for games with this theme
- Mention 1-2 well-known exemplary games

**Content Priorities:**
1. WHAT defines this theme—setting, atmosphere, subject matter
2. HOW it manifests in games—visual style, narrative elements, tone
3. WHICH games best exemplify it

**Quality Standards:**
- Every sentence must add value—no filler
- Be factually precise; mention real games
- Keep it brief—this is a definition, not an essay`,
  
  buildPrompt,
};

export default themeDescriptionsConfig;

