/**
 * AI Configuration: Platform Descriptions
 * 
 * This config defines how AI generates platform descriptions for the wiki.
 * Descriptions are generated in both English and Spanish.
 * 
 * Model configuration:
 * - Default model: Set in AI_DEFAULT_MODELS.PLATFORM_DESCRIPTIONS (utils.ts)
 * - Override via env: AI_MODEL_PLATFORM_DESCRIPTIONS
 */

import type { AITaskConfig, PlatformDescriptionContext, SupportedLocale } from './types';
import { getModel } from './utils';

/**
 * Build the prompt for platform description generation
 */
function buildPrompt(context: PlatformDescriptionContext, locale: SupportedLocale): string {
  const languageInstruction = locale === 'es' 
    ? 'Write the description entirely in Spanish.' 
    : 'Write the description in English.';

  const contextParts: string[] = [];
  
  if (context.manufacturer) {
    contextParts.push(`Manufacturer: ${context.manufacturer}`);
  }
  if (context.releaseYear) {
    contextParts.push(`Release Year: ${context.releaseYear}`);
  }
  if (context.category) {
    contextParts.push(`Category: ${context.category}`);
  }
  if (context.generation) {
    contextParts.push(`Generation: ${context.generation}`);
  }
  if (context.abbreviation) {
    contextParts.push(`Common Abbreviation: ${context.abbreviation}`);
  }

  const contextSection = contextParts.length > 0 
    ? `\n\nHere's some context about the platform:\n${contextParts.join('\n')}` 
    : '';

  return `${languageInstruction}

Platform: "${context.name}"${contextSection}

**Structure (3-4 paragraphs):**
1. **Opening hook** (2-3 sentences): Lead with the platform's full name and its defining characteristic—what made it iconic or noteworthy in gaming history
2. **Technical & features** (3-4 sentences): Key hardware specs, innovations, controllers, or unique features that defined the platform
3. **Game library & legacy** (3-4 sentences): Notable games, exclusive titles, and the platform's impact on gaming culture
4. **Market position** (2-3 sentences, optional): Sales performance, competition, or lasting influence on the industry

**Word Count:** 180-300 words (3-4 substantial paragraphs)

**Must Include:**
- The platform's exact name naturally in the first sentence
- Manufacturer name woven in naturally
- At least 2-3 notable exclusive games or franchises
- Key technical innovations or features
- Use **bold** to emphasize key features, innovations, or standout elements

**Must Avoid:**
- Headers or titles (H1, H2, etc.)
- Generic openers: "Welcome to...", "This platform is..."
- Vague adjectives: "amazing", "incredible", "revolutionary" without context
- Sales figures or exact statistics (unless very notable)
- Speculation—only state what's factually accurate

**Formatting:**
- Use **bold** for emphasis on key terms, games, and features
- Use *italics* sparingly for game titles
- NO headers, titles, or bullet lists—flowing prose paragraphs only

**Tone:** Informative and nostalgic where appropriate. Like a knowledgeable gaming historian, not a marketing brochure.`;
}

/**
 * Platform Description AI Configuration
 * 
 * Model: Configured in AI_DEFAULT_MODELS.PLATFORM_DESCRIPTIONS (utils.ts)
 * Override: Set AI_MODEL_PLATFORM_DESCRIPTIONS env var
 */
export const platformDescriptionsConfig: AITaskConfig<PlatformDescriptionContext> = {
  name: 'Platform Descriptions',
  description: 'Generates informative platform descriptions for the wiki in English and Spanish',
  
  model: getModel('PLATFORM_DESCRIPTIONS'),
  
  systemPrompt: `You are a senior gaming journalist and wiki editor at Gamers.Wiki, a comprehensive video game encyclopedia. You have deep expertise in gaming hardware history, from early consoles to modern platforms, including handhelds, PCs, and VR devices.

IMPORTANT FORMATTING RULES:
- NEVER use HTML tags (no <p>, <h1>, <h2>, <h3>, <div>, <span>, etc.)
- NEVER use headers or section titles of any kind (no #, ##, ###, no "History:", no labels)
- Use ONLY markdown: **bold** for emphasis, *italics* for game titles
- Write in flowing prose paragraphs only
- Always write in the language specified in the prompt (English or Spanish)

**Your Mission:** Craft informative, authoritative platform descriptions that serve as the definitive introduction to each gaming platform. These descriptions appear on platform hub pages—the central authority page for everything about that platform.

**Writing Style:**
- Write with confident expertise, like a knowledgeable gaming historian
- Balance encyclopedic accuracy with engaging narrative that captures the platform's significance
- Use specific, concrete details—avoid generic marketing speak
- Vary sentence structure for readability
- Create context that helps readers understand the platform's place in gaming history

**SEO Best Practices:**
- Naturally incorporate the platform's full name within the first sentence
- Weave in relevant keywords: manufacturer, category, notable games, key features
- Use semantically rich vocabulary that signals what the platform is about
- Include terms players search for (e.g., "Nintendo console", "Sony PlayStation", "handheld gaming")

**Content Priorities:**
1. WHAT makes this platform unique—its core identity and standout features
2. WHEN it launched and what gaming era it defined
3. WHAT games made it memorable—notable exclusives and popular titles
4. WHY it matters—historical impact and legacy in gaming

**Quality Standards:**
- Every sentence must add value—no filler
- Be factually precise; never invent specs or features
- Reference specific games and features, not vague claims
- Write as if this description will be the first thing thousands of players read about this platform`,
  
  buildPrompt,
};

export default platformDescriptionsConfig;

