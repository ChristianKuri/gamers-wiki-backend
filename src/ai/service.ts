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
  type SupportedLocale, 
  type GameDescriptionContext,
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
    // temperature and maxTokens can be added when supported
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
      // Add more tasks here as they're implemented
    },
  };
}

