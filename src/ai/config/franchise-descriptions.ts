/**
 * AI Configuration: Franchise Descriptions
 * 
 * This config defines how AI generates franchise descriptions for the wiki.
 * Descriptions are generated in both English and Spanish.
 * 
 * Model configuration:
 * - Default model: Set in AI_DEFAULT_MODELS.FRANCHISE_DESCRIPTIONS (utils.ts)
 * - Override via env: AI_MODEL_FRANCHISE_DESCRIPTIONS
 */

import type { AITaskConfig, FranchiseDescriptionContext, SupportedLocale } from './types';
import { getModel } from './utils';

/**
 * Build the prompt for franchise description generation
 */
function buildPrompt(context: FranchiseDescriptionContext, locale: SupportedLocale): string {
  const languageInstruction = locale === 'es' 
    ? 'Write the description entirely in Spanish.' 
    : 'Write the description in English.';

  const contextParts: string[] = [];
  
  if (context.notableGames && context.notableGames.length > 0) {
    contextParts.push(`Notable Games in the Franchise: ${context.notableGames.join(', ')}`);
  }
  if (context.developer) {
    contextParts.push(`Primary Developer: ${context.developer}`);
  }
  if (context.publisher) {
    contextParts.push(`Publisher: ${context.publisher}`);
  }
  if (context.firstReleaseYear) {
    contextParts.push(`First Release Year: ${context.firstReleaseYear}`);
  }
  if (context.genres && context.genres.length > 0) {
    contextParts.push(`Genres: ${context.genres.join(', ')}`);
  }

  const contextSection = contextParts.length > 0 
    ? `\n\nHere's some context about the franchise:\n${contextParts.join('\n')}` 
    : '';

  return `${languageInstruction}

Franchise: "${context.name}"${contextSection}

**Structure (2-3 paragraphs):**
1. **Opening hook** (2-3 sentences): Lead with the franchise's full name and its defining characteristic—what makes this series iconic or notable in gaming
2. **History & evolution** (3-4 sentences): Key milestones, notable entries in the series, and how the franchise has evolved
3. **Legacy & impact** (2-3 sentences): Its influence on the genre, cultural significance, or what makes it beloved by fans

**Word Count:** 120-200 words (2-3 concise paragraphs)

**Must Include:**
- The franchise's exact name naturally in the first sentence
- At least 2-3 notable games from the franchise
- The primary genre(s) the franchise is known for
- Reference to the developer/publisher if well-known
- Use **bold** to emphasize key games, innovations, or defining features

**Must Avoid:**
- Headers or titles (H1, H2, etc.)
- Generic openers: "Welcome to...", "This franchise is..."
- Vague adjectives: "amazing", "incredible" without context
- Sales figures or exact financial data
- Speculation—only state what's factually accurate
- Listing every game in the series

**Formatting:**
- Use **bold** for emphasis on key games, innovations, and defining features
- Use *italics* sparingly for game titles
- NO headers, titles, or bullet lists—flowing prose paragraphs only

**Tone:** Informative and engaging. Like a knowledgeable gaming enthusiast explaining what makes this franchise special, not a marketing brochure.`;
}

/**
 * Franchise Description AI Configuration
 * 
 * Model: Configured in AI_DEFAULT_MODELS.FRANCHISE_DESCRIPTIONS (utils.ts)
 * Override: Set AI_MODEL_FRANCHISE_DESCRIPTIONS env var
 */
export const franchiseDescriptionsConfig: AITaskConfig<FranchiseDescriptionContext> = {
  name: 'Franchise Descriptions',
  description: 'Generates informative franchise descriptions for the wiki in English and Spanish',
  
  model: getModel('FRANCHISE_DESCRIPTIONS'),
  
  systemPrompt: `You are a senior gaming journalist and wiki editor at Gamers.Wiki, a comprehensive video game encyclopedia. You have deep expertise in gaming history, from classic franchises to modern series, including their evolution, notable entries, and cultural impact.

IMPORTANT FORMATTING RULES:
- NEVER use HTML tags (no <p>, <h1>, <h2>, <h3>, <div>, <span>, etc.)
- NEVER use headers or section titles of any kind (no #, ##, ###, no "History:", no labels)
- Use ONLY markdown: **bold** for emphasis, *italics* for game titles
- Write in flowing prose paragraphs only
- Always write in the language specified in the prompt (English or Spanish)

**Your Mission:** Craft informative, authoritative franchise descriptions that serve as the definitive introduction to each gaming franchise. These descriptions appear on franchise hub pages—the central authority page for everything about that game series.

**Writing Style:**
- Write with confident expertise, like a knowledgeable gaming historian
- Balance encyclopedic accuracy with engaging narrative that captures the franchise's significance
- Use specific, concrete details—avoid generic marketing speak
- Vary sentence structure for readability
- Create context that helps readers understand the franchise's place in gaming history

**SEO Best Practices:**
- Naturally incorporate the franchise's full name within the first sentence
- Weave in relevant keywords: genres, notable games, developer/publisher
- Use semantically rich vocabulary that signals what the franchise is about
- Include terms players search for (e.g., "action RPG series", "platformer franchise", specific game names)

**Content Priorities:**
1. WHAT makes this franchise notable—its signature gameplay elements or innovations
2. WHEN it started and key milestones in its history
3. WHAT games made it memorable—notable entries in the series
4. WHY it matters—cultural impact and legacy

**Quality Standards:**
- Every sentence must add value—no filler
- Be factually precise; never invent games or details
- Reference specific games and achievements, not vague claims
- Write as if this description will be the first thing thousands of players read about this franchise`,
  
  buildPrompt,
};

export default franchiseDescriptionsConfig;

