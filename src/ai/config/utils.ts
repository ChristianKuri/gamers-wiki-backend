/**
 * AI Configuration Utilities
 * 
 * Centralized configuration for AI models and environment variables.
 * Change default models here - no need to modify individual config files.
 */

/**
 * Environment variable names for each AI task
 * Set these env vars to override the default models
 */
export const AI_ENV_KEYS = {
  GAME_DESCRIPTIONS: 'AI_MODEL_GAME_DESCRIPTIONS',
  PLATFORM_DESCRIPTIONS: 'AI_MODEL_PLATFORM_DESCRIPTIONS',
  COMPANY_DESCRIPTIONS: 'AI_MODEL_COMPANY_DESCRIPTIONS',
  FRANCHISE_DESCRIPTIONS: 'AI_MODEL_FRANCHISE_DESCRIPTIONS',
  COLLECTION_DESCRIPTIONS: 'AI_MODEL_COLLECTION_DESCRIPTIONS',
  GENRE_DESCRIPTIONS: 'AI_MODEL_GENRE_DESCRIPTIONS',
  THEME_DESCRIPTIONS: 'AI_MODEL_THEME_DESCRIPTIONS',
  GAME_MODE_DESCRIPTIONS: 'AI_MODEL_GAME_MODE_DESCRIPTIONS',
  PLAYER_PERSPECTIVE_DESCRIPTIONS: 'AI_MODEL_PLAYER_PERSPECTIVE_DESCRIPTIONS',
  LANGUAGE_DESCRIPTIONS: 'AI_MODEL_LANGUAGE_DESCRIPTIONS',
  ARTICLE_SCOUT: 'AI_MODEL_ARTICLE_SCOUT',
  ARTICLE_SCOUT_BRIEFING: 'AI_MODEL_ARTICLE_SCOUT_BRIEFING',
  ARTICLE_EDITOR: 'AI_MODEL_ARTICLE_EDITOR',
  ARTICLE_SPECIALIST: 'AI_MODEL_ARTICLE_SPECIALIST',
  ARTICLE_REVIEWER: 'AI_MODEL_ARTICLE_REVIEWER',
  ARTICLE_FIXER: 'AI_MODEL_ARTICLE_FIXER',
  ARTICLE_CLEANER: 'AI_MODEL_ARTICLE_CLEANER',
  ARTICLE_PREFILTER: 'AI_MODEL_ARTICLE_PREFILTER',
  GAME_MATCHER: 'AI_MODEL_GAME_MATCHER',
  POST_TRANSLATION: 'AI_MODEL_POST_TRANSLATION',
  TAG_GENERATION: 'AI_MODEL_TAG_GENERATION',
  SEO_META: 'AI_MODEL_SEO_META',
  ARTICLE_SUMMARY: 'AI_MODEL_ARTICLE_SUMMARY',
} as const;

/**
 * Default models for each AI task
 * 
 * Change these values to switch models globally.
 * Environment variables (AI_ENV_KEYS) take precedence over these defaults.
 * 
 * Available models (OpenRouter):
 * - google/gemini-3-pro-preview ($4.50/1M tokens)
 * - google/gemini-3-flash-preview ($0.50/1M input, $3/1M output)
 * - moonshotai/kimi-k2-thinking ($1.07/1M tokens)
 * - deepseek/deepseek-v3.2 ($0.32/1M tokens)
 * - openai/gpt-5-mini ($0.69/1M tokens)
 * - minimax/minimax-m2 ($0.53/1M tokens)
 */
export const AI_DEFAULT_MODELS = {
  GAME_DESCRIPTIONS: 'deepseek/deepseek-v3.2',
  PLATFORM_DESCRIPTIONS: 'deepseek/deepseek-v3.2',
  COMPANY_DESCRIPTIONS: 'deepseek/deepseek-v3.2',
  FRANCHISE_DESCRIPTIONS: 'deepseek/deepseek-v3.2',
  COLLECTION_DESCRIPTIONS: 'deepseek/deepseek-v3.2',
  GENRE_DESCRIPTIONS: 'deepseek/deepseek-v3.2',
  THEME_DESCRIPTIONS: 'deepseek/deepseek-v3.2',
  GAME_MODE_DESCRIPTIONS: 'deepseek/deepseek-v3.2',
  PLAYER_PERSPECTIVE_DESCRIPTIONS: 'deepseek/deepseek-v3.2',
  LANGUAGE_DESCRIPTIONS: 'deepseek/deepseek-v3.2',
  ARTICLE_SCOUT: 'google/gemini-3-flash-preview',
  ARTICLE_SCOUT_BRIEFING: 'google/gemini-3-flash-preview',
  ARTICLE_EDITOR: 'google/gemini-3-flash-preview',
  ARTICLE_SPECIALIST: 'x-ai/grok-4.1-fast',
  ARTICLE_REVIEWER: 'google/gemini-3-flash-preview',
  ARTICLE_FIXER: 'google/gemini-3-flash-preview',
  ARTICLE_CLEANER: 'google/gemini-3-flash-preview',
  ARTICLE_PREFILTER: 'google/gemini-2.5-flash-lite',
  GAME_MATCHER: 'google/gemini-3-flash-preview',
  POST_TRANSLATION: 'google/gemini-3-flash-preview',
  TAG_GENERATION: 'deepseek/deepseek-v3.2',
  SEO_META: 'deepseek/deepseek-v3.2',
  ARTICLE_SUMMARY: 'google/gemini-3-flash-preview',
} as const;

export type AITaskKey = keyof typeof AI_ENV_KEYS;
export type AIEnvKey = typeof AI_ENV_KEYS[keyof typeof AI_ENV_KEYS];

/**
 * Get the model for a specific AI task
 * Checks environment variable first, falls back to default model
 * 
 * @param taskKey - The AI task key (e.g., 'GAME_DESCRIPTIONS')
 * @returns The model identifier string
 * 
 * @example
 * const model = getModel('GAME_DESCRIPTIONS');
 * // Returns env var AI_MODEL_GAME_DESCRIPTIONS if set, otherwise 'deepseek/deepseek-v3.2'
 */
export function getModel(taskKey: AITaskKey): string {
  const envKey = AI_ENV_KEYS[taskKey];
  const defaultModel = AI_DEFAULT_MODELS[taskKey];
  return process.env[envKey] || defaultModel;
}

/**
 * @deprecated Use getModel(taskKey) instead
 * Get the model for a specific AI task from environment variable
 * Falls back to the provided default if not set.
 */
export function getModelFromEnv(envKey: string, defaultModel: string): string {
  return process.env[envKey] || defaultModel;
}
