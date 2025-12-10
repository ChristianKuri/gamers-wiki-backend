/**
 * AI Configuration: Language Descriptions
 * 
 * This config defines how AI generates language descriptions for the wiki.
 * Descriptions are generated in both English and Spanish.
 * 
 * Languages represent the languages that games support:
 * - English, Spanish, Japanese, French, German, etc.
 * 
 * Model configuration:
 * - Default model: Set in AI_DEFAULT_MODELS.LANGUAGE_DESCRIPTIONS (utils.ts)
 * - Override via env: AI_MODEL_LANGUAGE_DESCRIPTIONS
 */

import type { AITaskConfig, LanguageDescriptionContext, SupportedLocale } from './types';
import { getModel } from './utils';

/**
 * Build the prompt for language description generation
 */
function buildPrompt(context: LanguageDescriptionContext, locale: SupportedLocale): string {
  const languageInstruction = locale === 'es' 
    ? 'Write the description entirely in Spanish.' 
    : 'Write the description in English.';

  const contextParts: string[] = [];
  
  if (context.nativeName) {
    contextParts.push(`Native Name: ${context.nativeName}`);
  }
  if (context.isoCode) {
    contextParts.push(`ISO Code: ${context.isoCode}`);
  }

  const contextSection = contextParts.length > 0 
    ? `\n\nHere's some context:\n${contextParts.join('\n')}` 
    : '';

  return `${languageInstruction}

Language: "${context.name}"${contextSection}

**Structure (1 short paragraph):**
A brief description of this language in the context of gaming—its prevalence in game localization, notable regions where it's spoken, and its significance for gamers.

**Word Count:** 30-60 words (1 concise paragraph)

**Must Include:**
- The language name naturally in the first sentence
- Brief mention of where it's commonly spoken or used in gaming
- Use **bold** for the language name

**Must Avoid:**
- Headers or titles
- Generic openers: "This language is..."
- Lengthy explanations—keep it brief and scannable
- Detailed linguistic history

**Formatting:**
- Use **bold** for the language name only
- NO headers, titles, or bullet lists—flowing prose only

**Tone:** Clear and informative. Like a quick reference for gamers checking language support.`;
}

/**
 * Language Description AI Configuration
 * 
 * Model: Configured in AI_DEFAULT_MODELS.LANGUAGE_DESCRIPTIONS (utils.ts)
 * Override: Set AI_MODEL_LANGUAGE_DESCRIPTIONS env var
 */
export const languageDescriptionsConfig: AITaskConfig<LanguageDescriptionContext> = {
  name: 'Language Descriptions',
  description: 'Generates brief language descriptions for the wiki in English and Spanish',
  
  model: getModel('LANGUAGE_DESCRIPTIONS'),
  
  systemPrompt: `You are a gaming wiki editor at Gamers.Wiki. You write clear, concise descriptions of languages as they relate to gaming and game localization.

IMPORTANT FORMATTING RULES:
- NEVER use HTML tags
- NEVER use headers or section titles
- Use ONLY markdown: **bold** for the language name
- Write one short paragraph only
- Always write in the language specified in the prompt (English or Spanish)

**Your Mission:** Write brief, informative descriptions of languages that help gamers understand their significance in game localization. These appear as quick references on language support pages.

**Writing Style:**
- Be concise—this is a brief description, not a linguistic study
- Use clear, simple language
- Focus on gaming context and regional relevance`,
  
  buildPrompt,
};

export default languageDescriptionsConfig;

