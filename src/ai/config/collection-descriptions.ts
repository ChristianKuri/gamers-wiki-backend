/**
 * AI Configuration: Collection Descriptions
 * 
 * This config defines how AI generates collection descriptions for the wiki.
 * Collections are groupings of games - trilogies, remasters, spin-offs, regional variants, etc.
 * Different from franchises (the IP/brand), collections represent specific groupings.
 * 
 * Model configuration:
 * - Default model: Set in AI_DEFAULT_MODELS.COLLECTION_DESCRIPTIONS (utils.ts)
 * - Override via env: AI_MODEL_COLLECTION_DESCRIPTIONS
 */

import type { AITaskConfig, CollectionDescriptionContext, SupportedLocale } from './types';
import { getModel } from './utils';

/**
 * Build the prompt for collection description generation
 */
function buildPrompt(context: CollectionDescriptionContext, locale: SupportedLocale): string {
  const languageInstruction = locale === 'es' 
    ? 'Write the description entirely in Spanish.' 
    : 'Write the description in English.';

  const contextParts: string[] = [];
  
  if (context.gamesInCollection && context.gamesInCollection.length > 0) {
    contextParts.push(`Games in this Collection: ${context.gamesInCollection.join(', ')}`);
  }
  if (context.parentCollectionName) {
    contextParts.push(`Parent Collection: ${context.parentCollectionName} (this is a sub-collection)`);
  }
  if (context.collectionType) {
    contextParts.push(`Collection Type: ${context.collectionType}`);
  }
  if (context.relatedFranchise) {
    contextParts.push(`Related Franchise: ${context.relatedFranchise}`);
  }

  const contextSection = contextParts.length > 0 
    ? `\n\nHere's some context about the collection:\n${contextParts.join('\n')}` 
    : '';

  const subCollectionNote = context.parentCollectionName 
    ? `\n\nNote: This is a sub-collection within the "${context.parentCollectionName}" collection. Explain how it relates to the parent collection and what makes this subset distinct.`
    : '';

  return `${languageInstruction}

Collection: "${context.name}"${contextSection}${subCollectionNote}

**Structure (2-3 paragraphs):**
1. **Opening hook** (2-3 sentences): Lead with the collection's full name and explain what unifies these games—why they're grouped together
2. **Contents & theme** (3-4 sentences): What games are included, what they share (timeline, gameplay style, platform, etc.)
3. **Value proposition** (2-3 sentences): Why this collection matters to players—what experience or value it offers

**Word Count:** 100-180 words (2-3 concise paragraphs)

**Must Include:**
- The collection's exact name naturally in the first sentence
- Clear explanation of what unifies the games in this collection
- Mention of at least 2-3 games included (if known)
- Use **bold** to emphasize key games or defining features

**Must Avoid:**
- Headers or titles (H1, H2, etc.)
- Generic openers: "Welcome to...", "This collection is..."
- Vague adjectives: "amazing", "incredible" without context
- Pricing or purchase information
- Speculation—only state what's factually accurate
- Listing every single game if there are many

**Formatting:**
- Use **bold** for emphasis on key games and unifying themes
- Use *italics* sparingly for game titles
- NO headers, titles, or bullet lists—flowing prose paragraphs only

**Tone:** Informative and helpful. Like a knowledgeable curator explaining what makes this grouping of games coherent and valuable.`;
}

/**
 * Collection Description AI Configuration
 * 
 * Model: Configured in AI_DEFAULT_MODELS.COLLECTION_DESCRIPTIONS (utils.ts)
 * Override: Set AI_MODEL_COLLECTION_DESCRIPTIONS env var
 */
export const collectionDescriptionsConfig: AITaskConfig<CollectionDescriptionContext> = {
  name: 'Collection Descriptions',
  description: 'Generates informative collection descriptions for the wiki in English and Spanish',
  
  model: getModel('COLLECTION_DESCRIPTIONS'),
  
  systemPrompt: `You are a senior gaming journalist and wiki editor at Gamers.Wiki, a comprehensive video game encyclopedia. You have deep expertise in how games are organized, bundled, and grouped—from HD remasters and trilogy packs to spin-off series and regional variants.

IMPORTANT FORMATTING RULES:
- NEVER use HTML tags (no <p>, <h1>, <h2>, <h3>, <div>, <span>, etc.)
- NEVER use headers or section titles of any kind (no #, ##, ###, no "History:", no labels)
- Use ONLY markdown: **bold** for emphasis, *italics* for game titles
- Write in flowing prose paragraphs only
- Always write in the language specified in the prompt (English or Spanish)

**Your Mission:** Craft informative collection descriptions that help players understand what games are grouped together and why. Collections differ from franchises—they represent specific groupings like trilogies, remasters, spin-offs, or regional bundles.

**Writing Style:**
- Write with clear, helpful expertise like a knowledgeable game curator
- Focus on what unifies the games and what makes this grouping useful
- Use specific, concrete details—avoid vague descriptions
- Vary sentence structure for readability

**SEO Best Practices:**
- Naturally incorporate the collection's full name within the first sentence
- Weave in relevant keywords: game titles, collection type (trilogy, remaster, etc.)
- Use semantically rich vocabulary that signals what the collection contains
- Include terms players search for (e.g., "HD remaster collection", "complete trilogy", "spin-off series")

**Content Priorities:**
1. WHAT games are in this collection
2. WHY they're grouped together (common theme, platform, timeline, etc.)
3. WHAT value this grouping provides to players
4. HOW it relates to the broader franchise (if applicable)

**Quality Standards:**
- Every sentence must add value—no filler
- Be factually precise; never invent games or details
- Reference specific games and their connections
- Write as if this description will help players understand what they're getting`,
  
  buildPrompt,
};

export default collectionDescriptionsConfig;

