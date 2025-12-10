/**
 * AI Module
 * 
 * This module provides AI-powered content generation for Gamers.Wiki.
 * 
 * ## Structure
 * 
 * - `/config/` - All AI prompts and model configurations
 *   - `types.ts` - TypeScript types for configurations
 *   - `game-descriptions.ts` - Config for game description generation
 *   - (Add more configs here for new AI tasks)
 * 
 * - `service.ts` - Core AI service that executes tasks
 * - `index.ts` - This file, exports everything
 * 
 * ## Usage
 * 
 * ```typescript
 * import { generateGameDescriptions, isAIConfigured } from '@/ai';
 * 
 * if (isAIConfigured()) {
 *   const descriptions = await generateGameDescriptions({
 *     name: 'Hollow Knight',
 *     genres: ['Metroidvania', 'Action'],
 *     // ...
 *   });
 * }
 * ```
 * 
 * ## Adding New AI Tasks
 * 
 * 1. Create a new config file in `/config/` (e.g., `tag-generation.ts`)
 * 2. Define the context interface in `types.ts`
 * 3. Export the config from `config/index.ts`
 * 4. Add a helper function in `service.ts`
 * 5. Export from this index file
 */

// Re-export everything from service
export {
  isAIConfigured,
  executeAITask,
  generateGameDescription,
  generateGameDescriptions,
  generatePlatformDescription,
  generatePlatformDescriptions,
  generateCompanyDescription,
  generateCompanyDescriptions,
  generateFranchiseDescription,
  generateFranchiseDescriptions,
  generateCollectionDescription,
  generateCollectionDescriptions,
  generateGenreDescription,
  generateGenreDescriptions,
  generateThemeDescription,
  generateThemeDescriptions,
  generateGameModeDescription,
  generateGameModeDescriptions,
  generatePlayerPerspectiveDescription,
  generatePlayerPerspectiveDescriptions,
  generateLanguageDescription,
  generateLanguageDescriptions,
  getAIStatus,
} from './service';

// Re-export types and configs for direct access
export type {
  SupportedLocale,
  GameDescriptionContext,
  PlatformDescriptionContext,
  CompanyDescriptionContext,
  FranchiseDescriptionContext,
  CollectionDescriptionContext,
  GenreDescriptionContext,
  ThemeDescriptionContext,
  GameModeDescriptionContext,
  PlayerPerspectiveDescriptionContext,
  LanguageDescriptionContext,
  AITaskConfig,
  TagGenerationContext,
  SEOMetaContext,
  AIEnvKey,
  AITaskKey,
} from './config';

export { 
  gameDescriptionsConfig,
  platformDescriptionsConfig,
  companyDescriptionsConfig,
  franchiseDescriptionsConfig,
  collectionDescriptionsConfig,
  genreDescriptionsConfig,
  themeDescriptionsConfig,
  gameModeDescriptionsConfig,
  playerPerspectiveDescriptionsConfig,
  languageDescriptionsConfig,
  getModel,
  getModelFromEnv,
  AI_ENV_KEYS,
  AI_DEFAULT_MODELS,
} from './config';

