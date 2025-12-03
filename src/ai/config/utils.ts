/**
 * AI Configuration Utilities
 * 
 * Helper functions for AI configuration management.
 */

/**
 * Get the model for a specific AI task from environment variable
 * Falls back to the provided default if not set.
 * 
 * @param envKey - The environment variable name (e.g., 'AI_MODEL_GAME_DESCRIPTIONS')
 * @param defaultModel - The default model to use if env var is not set
 * @returns The model identifier string
 * 
 * @example
 * // Uses AI_MODEL_GAME_DESCRIPTIONS env var, or falls back to claude-sonnet-4
 * const model = getModelFromEnv('AI_MODEL_GAME_DESCRIPTIONS', 'anthropic/claude-sonnet-4');
 * 
 * @example
 * // For a task that should use a cheaper model by default
 * const model = getModelFromEnv('AI_MODEL_TAG_GENERATION', 'openai/gpt-4o-mini');
 */
export function getModelFromEnv(envKey: string, defaultModel: string): string {
  return process.env[envKey] || defaultModel;
}

/**
 * Environment variable names for each AI task
 * Each task checks only its own env var and uses its own default
 */
export const AI_ENV_KEYS = {
  GAME_DESCRIPTIONS: 'AI_MODEL_GAME_DESCRIPTIONS',
  TAG_GENERATION: 'AI_MODEL_TAG_GENERATION',
  SEO_META: 'AI_MODEL_SEO_META',
  ARTICLE_SUMMARY: 'AI_MODEL_ARTICLE_SUMMARY',
} as const;

export type AIEnvKey = typeof AI_ENV_KEYS[keyof typeof AI_ENV_KEYS];
