/**
 * AI Configuration Index
 * 
 * This file exports all AI task configurations.
 * To add a new AI task:
 * 1. Create a new file in this folder (e.g., 'tag-generation.ts')
 * 2. Define the config following AITaskConfig interface
 * 3. Export it from this index file
 * 
 * @example
 * // To use a config:
 * import { gameDescriptionsConfig } from '@/ai/config';
 * const model = gameDescriptionsConfig.model;
 * const prompt = gameDescriptionsConfig.buildPrompt(context, 'en');
 */

// Types
export * from './types';

// Utilities
export * from './utils';

// Configurations
export { gameDescriptionsConfig } from './game-descriptions';
export { platformDescriptionsConfig } from './platform-descriptions';
export { companyDescriptionsConfig } from './company-descriptions';
export { franchiseDescriptionsConfig } from './franchise-descriptions';
export { collectionDescriptionsConfig } from './collection-descriptions';
export { genreDescriptionsConfig } from './genre-descriptions';
export { themeDescriptionsConfig } from './theme-descriptions';
export { gameModeDescriptionsConfig } from './game-mode-descriptions';

// Future configurations (uncomment when implemented):
// export { tagGenerationConfig } from './tag-generation';
// export { seoMetaConfig } from './seo-meta';
// export { articleSummaryConfig } from './article-summary';

/**
 * All available AI configurations
 * Useful for admin panels or debugging
 */
export const allConfigs = {
  'game-descriptions': () => import('./game-descriptions').then(m => m.gameDescriptionsConfig),
  'platform-descriptions': () => import('./platform-descriptions').then(m => m.platformDescriptionsConfig),
  'company-descriptions': () => import('./company-descriptions').then(m => m.companyDescriptionsConfig),
  'franchise-descriptions': () => import('./franchise-descriptions').then(m => m.franchiseDescriptionsConfig),
  'collection-descriptions': () => import('./collection-descriptions').then(m => m.collectionDescriptionsConfig),
  'genre-descriptions': () => import('./genre-descriptions').then(m => m.genreDescriptionsConfig),
  'theme-descriptions': () => import('./theme-descriptions').then(m => m.themeDescriptionsConfig),
  'game-mode-descriptions': () => import('./game-mode-descriptions').then(m => m.gameModeDescriptionsConfig),
  // 'tag-generation': () => import('./tag-generation').then(m => m.tagGenerationConfig),
  // 'seo-meta': () => import('./seo-meta').then(m => m.seoMetaConfig),
} as const;

/**
 * Get a list of all available AI task names
 */
export function getAvailableTasks(): string[] {
  return Object.keys(allConfigs);
}

