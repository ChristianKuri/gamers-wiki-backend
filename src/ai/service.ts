/**
 * AI Service
 * 
 * Core service for executing AI tasks using OpenRouter.
 * All prompts and model configurations are managed in the config folder.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { 
  gameDescriptionsConfig,
  platformDescriptionsConfig,
  companyDescriptionsConfig,
  type SupportedLocale, 
  type GameDescriptionContext,
  type PlatformDescriptionContext,
  type CompanyDescriptionContext,
  type AITaskConfig,
} from './config';

// OpenRouter client configuration
const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || '',
});

/**
 * Check if OpenRouter API key is configured
 */
export function isAIConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/**
 * Execute any AI task with the given configuration
 * 
 * @param config - The AI task configuration
 * @param context - Context data for the task
 * @param locale - Target language
 * @returns Generated text
 */
export async function executeAITask<TContext>(
  config: AITaskConfig<TContext>,
  context: TContext,
  locale: SupportedLocale
): Promise<string> {
  if (!isAIConfigured()) {
    throw new Error('OpenRouter API key not configured');
  }

  const prompt = config.buildPrompt(context, locale);
  
  const { text } = await generateText({
    model: openrouter(config.model),
    system: config.systemPrompt,
    prompt,
  });

  return text.trim();
}

/**
 * Generate a game description using AI
 * 
 * @param context - Game information for context
 * @param locale - Target language ('en' or 'es')
 * @returns Generated description
 */
export async function generateGameDescription(
  context: GameDescriptionContext,
  locale: SupportedLocale
): Promise<string> {
  return executeAITask(gameDescriptionsConfig, context, locale);
}

/**
 * Generate descriptions for both English and Spanish locales
 * 
 * @param context - Game information for context
 * @returns Object with 'en' and 'es' descriptions
 */
export async function generateGameDescriptions(
  context: GameDescriptionContext
): Promise<{ en: string; es: string }> {
  // Generate both descriptions in parallel for speed
  const [enDescription, esDescription] = await Promise.all([
    generateGameDescription(context, 'en'),
    generateGameDescription(context, 'es'),
  ]);

  return {
    en: enDescription,
    es: esDescription,
  };
}

/**
 * Generate a platform description using AI
 * 
 * @param context - Platform information for context
 * @param locale - Target language ('en' or 'es')
 * @returns Generated description
 */
export async function generatePlatformDescription(
  context: PlatformDescriptionContext,
  locale: SupportedLocale
): Promise<string> {
  return executeAITask(platformDescriptionsConfig, context, locale);
}

/**
 * Generate platform descriptions for both English and Spanish locales
 * 
 * @param context - Platform information for context
 * @returns Object with 'en' and 'es' descriptions
 */
export async function generatePlatformDescriptions(
  context: PlatformDescriptionContext
): Promise<{ en: string; es: string }> {
  // Generate both descriptions in parallel for speed
  const [enDescription, esDescription] = await Promise.all([
    generatePlatformDescription(context, 'en'),
    generatePlatformDescription(context, 'es'),
  ]);

  return {
    en: enDescription,
    es: esDescription,
  };
}

/**
 * Generate a company description using AI
 * 
 * @param context - Company information for context
 * @param locale - Target language ('en' or 'es')
 * @returns Generated description
 */
export async function generateCompanyDescription(
  context: CompanyDescriptionContext,
  locale: SupportedLocale
): Promise<string> {
  return executeAITask(companyDescriptionsConfig, context, locale);
}

/**
 * Generate company descriptions for both English and Spanish locales
 * 
 * @param context - Company information for context
 * @returns Object with 'en' and 'es' descriptions
 */
export async function generateCompanyDescriptions(
  context: CompanyDescriptionContext
): Promise<{ en: string; es: string }> {
  // Generate both descriptions in parallel for speed
  const [enDescription, esDescription] = await Promise.all([
    generateCompanyDescription(context, 'en'),
    generateCompanyDescription(context, 'es'),
  ]);

  return {
    en: enDescription,
    es: esDescription,
  };
}

/**
 * Get information about the current AI configuration
 * Shows active models (resolved from environment or defaults)
 */
export function getAIStatus() {
  return {
    configured: isAIConfigured(),
    tasks: {
      'game-descriptions': {
        name: gameDescriptionsConfig.name,
        model: gameDescriptionsConfig.model,
        envVar: 'AI_MODEL_GAME_DESCRIPTIONS',
        isOverridden: Boolean(process.env.AI_MODEL_GAME_DESCRIPTIONS),
      },
      'platform-descriptions': {
        name: platformDescriptionsConfig.name,
        model: platformDescriptionsConfig.model,
        envVar: 'AI_MODEL_PLATFORM_DESCRIPTIONS',
        isOverridden: Boolean(process.env.AI_MODEL_PLATFORM_DESCRIPTIONS),
      },
      'company-descriptions': {
        name: companyDescriptionsConfig.name,
        model: companyDescriptionsConfig.model,
        envVar: 'AI_MODEL_COMPANY_DESCRIPTIONS',
        isOverridden: Boolean(process.env.AI_MODEL_COMPANY_DESCRIPTIONS),
      },
      // Add more tasks here as they're implemented
    },
  };
}

