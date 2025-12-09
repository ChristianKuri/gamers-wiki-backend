/**
 * AI Configuration: Genre Descriptions
 * 
 * This config defines how AI generates genre descriptions for the wiki.
 * Descriptions are generated in both English and Spanish.
 * 
 * Model configuration:
 * - Default model: Set in AI_DEFAULT_MODELS.GENRE_DESCRIPTIONS (utils.ts)
 * - Override via env: AI_MODEL_GENRE_DESCRIPTIONS
 */

import type { AITaskConfig, GenreDescriptionContext, SupportedLocale } from './types';
import { getModel } from './utils';

/**
 * Build the prompt for genre description generation
 */
function buildPrompt(context: GenreDescriptionContext, locale: SupportedLocale): string {
  const languageInstruction = locale === 'es' 
    ? 'Write the description entirely in Spanish.' 
    : 'Write the description in English.';

  const contextParts: string[] = [];
  
  if (context.notableGames && context.notableGames.length > 0) {
    contextParts.push(`Notable Games: ${context.notableGames.slice(0, 5).join(', ')}`);
  }
  if (context.parentGenre) {
    contextParts.push(`Parent Genre: ${context.parentGenre}`);
  }
  if (context.relatedGenres && context.relatedGenres.length > 0) {
    contextParts.push(`Related Genres: ${context.relatedGenres.join(', ')}`);
  }

  const contextSection = contextParts.length > 0 
    ? `\n\nHere's some context about the genre:\n${contextParts.join('\n')}` 
    : '';

  return `${languageInstruction}

Genre: "${context.name}"${contextSection}

**Structure (1-2 paragraphs):**
1. **Definition** (2-3 sentences): What defines this genre—its core gameplay mechanics, structure, or themes
2. **Characteristics & examples** (2-3 sentences): Key features that distinguish it, with notable game examples

**Word Count:** 60-100 words (1-2 concise paragraphs)

**Must Include:**
- The genre's exact name naturally in the first sentence
- Core defining mechanics or characteristics
- 1-2 well-known game examples that exemplify the genre
- Use **bold** to emphasize the genre name and key defining features

**Must Avoid:**
- Headers or titles (H1, H2, etc.)
- Generic openers: "Welcome to...", "This genre is..."
- Subjective claims: "the best", "the most exciting"
- Historical details unless essential to understanding the genre
- Lists of every game in the genre

**Formatting:**
- Use **bold** for emphasis on the genre name and key characteristics
- Use *italics* for game titles
- NO headers, titles, or bullet lists—flowing prose only

**Tone:** Informative and concise. Like a knowledgeable gaming encyclopedia, not a review.`;
}

/**
 * Genre Description AI Configuration
 * 
 * Model: Configured in AI_DEFAULT_MODELS.GENRE_DESCRIPTIONS (utils.ts)
 * Override: Set AI_MODEL_GENRE_DESCRIPTIONS env var
 */
export const genreDescriptionsConfig: AITaskConfig<GenreDescriptionContext> = {
  name: 'Genre Descriptions',
  description: 'Generates informative genre descriptions for the wiki in English and Spanish',
  
  model: getModel('GENRE_DESCRIPTIONS'),
  
  systemPrompt: `You are a senior gaming journalist and wiki editor at Gamers.Wiki, a comprehensive video game encyclopedia. You have deep expertise in game genres, their histories, mechanics, and how they've evolved over time.

IMPORTANT FORMATTING RULES:
- NEVER use HTML tags (no <p>, <h1>, <h2>, <h3>, <div>, <span>, etc.)
- NEVER use headers or section titles of any kind (no #, ##, ###, no "Definition:", no labels)
- Use ONLY markdown: **bold** for emphasis, *italics* for game titles
- Write in flowing prose paragraphs only
- Always write in the language specified in the prompt (English or Spanish)

**Your Mission:** Craft concise, authoritative genre definitions that help players understand what to expect from games in this category. These descriptions appear on genre pages—serving as a quick reference for classification.

**Writing Style:**
- Write with confident expertise, like a knowledgeable game taxonomy expert
- Be concise—genres need quick, scannable definitions
- Use specific, concrete details—avoid vague descriptions
- Focus on what makes this genre distinct from others

**SEO Best Practices:**
- Naturally incorporate the genre name within the first sentence
- Include terms players search for when looking for games of this type
- Mention 1-2 well-known exemplary games

**Content Priorities:**
1. WHAT defines this genre—core mechanics or themes
2. HOW it differs from similar genres
3. WHICH games best exemplify it

**Quality Standards:**
- Every sentence must add value—no filler
- Be factually precise; mention real games
- Keep it brief—this is a definition, not an essay`,
  
  buildPrompt,
};

export default genreDescriptionsConfig;

