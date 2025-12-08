/**
 * AI Configuration: Company Descriptions
 * 
 * This config defines how AI generates company descriptions for the wiki.
 * Descriptions are generated in both English and Spanish.
 * 
 * Model configuration:
 * - Default model: Set in AI_DEFAULT_MODELS.COMPANY_DESCRIPTIONS (utils.ts)
 * - Override via env: AI_MODEL_COMPANY_DESCRIPTIONS
 */

import type { AITaskConfig, CompanyDescriptionContext, SupportedLocale } from './types';
import { getModel } from './utils';

/**
 * Build the prompt for company description generation
 */
function buildPrompt(context: CompanyDescriptionContext, locale: SupportedLocale): string {
  const languageInstruction = locale === 'es' 
    ? 'Write the description entirely in Spanish.' 
    : 'Write the description in English.';

  const contextParts: string[] = [];
  
  if (context.country) {
    contextParts.push(`Headquarters: ${context.country}`);
  }
  if (context.foundedYear) {
    contextParts.push(`Founded: ${context.foundedYear}`);
  }
  if (context.notableGames && context.notableGames.length > 0) {
    contextParts.push(`Notable Games: ${context.notableGames.join(', ')}`);
  }
  if (context.isDeveloper && context.isPublisher) {
    contextParts.push(`Role: Both developer and publisher`);
  } else if (context.isDeveloper) {
    contextParts.push(`Role: Game developer`);
  } else if (context.isPublisher) {
    contextParts.push(`Role: Game publisher`);
  }

  const contextSection = contextParts.length > 0 
    ? `\n\nHere's some context about the company:\n${contextParts.join('\n')}` 
    : '';

  return `${languageInstruction}

Company: "${context.name}"${contextSection}

**Structure (2-3 paragraphs):**
1. **Opening hook** (2-3 sentences): Lead with the company's full name and its defining characteristic—what they're best known for in the gaming industry
2. **History & achievements** (3-4 sentences): Key milestones, major game releases, and significant contributions to gaming
3. **Legacy & current status** (2-3 sentences): Their impact on the industry, current focus areas, or lasting influence

**Word Count:** 120-200 words (2-3 concise paragraphs)

**Must Include:**
- The company's exact name naturally in the first sentence
- Country/region of origin if available
- At least 2-3 notable games or franchises they're associated with
- Whether they're primarily a developer, publisher, or both
- Use **bold** to emphasize key games, franchises, or innovations

**Must Avoid:**
- Headers or titles (H1, H2, etc.)
- Generic openers: "Welcome to...", "This company is..."
- Vague adjectives: "amazing", "incredible" without context
- Exact financial figures or stock information
- Speculation—only state what's factually accurate
- Employee counts or organizational details

**Formatting:**
- Use **bold** for emphasis on key games, franchises, and innovations
- Use *italics* sparingly for game titles
- NO headers, titles, or bullet lists—flowing prose paragraphs only

**Tone:** Informative and professional. Like a knowledgeable gaming industry analyst, not a marketing brochure.`;
}

/**
 * Company Description AI Configuration
 * 
 * Model: Configured in AI_DEFAULT_MODELS.COMPANY_DESCRIPTIONS (utils.ts)
 * Override: Set AI_MODEL_COMPANY_DESCRIPTIONS env var
 */
export const companyDescriptionsConfig: AITaskConfig<CompanyDescriptionContext> = {
  name: 'Company Descriptions',
  description: 'Generates informative company descriptions for the wiki in English and Spanish',
  
  model: getModel('COMPANY_DESCRIPTIONS'),
  
  systemPrompt: `You are a senior gaming journalist and wiki editor at Gamers.Wiki, a comprehensive video game encyclopedia. You have deep expertise in the gaming industry, from indie studios to major publishers, including their histories, notable releases, and industry impact.

IMPORTANT FORMATTING RULES:
- NEVER use HTML tags (no <p>, <h1>, <h2>, <h3>, <div>, <span>, etc.)
- NEVER use headers or section titles of any kind (no #, ##, ###, no "History:", no labels)
- Use ONLY markdown: **bold** for emphasis, *italics* for game titles
- Write in flowing prose paragraphs only
- Always write in the language specified in the prompt (English or Spanish)

**Your Mission:** Craft informative, authoritative company descriptions that serve as the definitive introduction to each gaming company. These descriptions appear on company hub pages—the central authority page for everything about that developer or publisher.

**Writing Style:**
- Write with confident expertise, like a knowledgeable industry analyst
- Balance encyclopedic accuracy with engaging narrative that captures the company's significance
- Use specific, concrete details—avoid generic marketing speak
- Vary sentence structure for readability
- Create context that helps readers understand the company's place in gaming history

**SEO Best Practices:**
- Naturally incorporate the company's full name within the first sentence
- Weave in relevant keywords: location, notable games, genres they specialize in
- Use semantically rich vocabulary that signals what the company is about
- Include terms players search for (e.g., "game developer", "publisher", specific game franchises)

**Content Priorities:**
1. WHAT makes this company notable—their signature games or innovations
2. WHEN they were founded and key milestones in their history
3. WHAT games made them memorable—notable titles and franchises
4. WHY they matter—industry impact and legacy

**Quality Standards:**
- Every sentence must add value—no filler
- Be factually precise; never invent games or details
- Reference specific games and achievements, not vague claims
- Write as if this description will be the first thing thousands of players read about this company`,
  
  buildPrompt,
};

export default companyDescriptionsConfig;

