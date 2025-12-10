/**
 * AI Configuration Types
 * 
 * This file defines the structure for all AI configurations in the project.
 * Each AI task (descriptions, tags, etc.) should have its own config file
 * that exports an AITaskConfig object.
 */

export type SupportedLocale = 'en' | 'es';

/**
 * Base configuration for any AI task
 */
export interface AITaskConfig<TContext = unknown> {
  /** Human-readable name for this AI task */
  name: string;
  
  /** Description of what this task does */
  description: string;
  
  /** OpenRouter model identifier (e.g., 'anthropic/claude-sonnet-4') */
  model: string;
  
  /** Optional system prompt for the AI */
  systemPrompt?: string;
  
  /** 
   * Function that generates the user prompt given context and locale
   * This allows each task to define its own prompt structure
   */
  buildPrompt: (context: TContext, locale: SupportedLocale) => string;
  
  /** Optional temperature setting (0-2, default varies by model) */
  temperature?: number;
  
  /** Optional max tokens limit */
  maxTokens?: number;
}

/**
 * Context for game description generation
 */
export interface GameDescriptionContext {
  name: string;
  igdbDescription?: string | null;
  genres?: string[];
  platforms?: string[];
  releaseDate?: string | null;
  developer?: string | null;
  publisher?: string | null;
}

/**
 * Context for platform description generation
 */
export interface PlatformDescriptionContext {
  name: string;
  manufacturer?: string | null;
  releaseYear?: number | null;
  category?: string | null;
  generation?: number | null;
  abbreviation?: string | null;
}

/**
 * Context for company description generation
 */
export interface CompanyDescriptionContext {
  name: string;
  country?: string | null;
  foundedYear?: number | null;
  notableGames?: string[];
  isDeveloper?: boolean;
  isPublisher?: boolean;
}

/**
 * Context for franchise description generation
 */
export interface FranchiseDescriptionContext {
  name: string;
  notableGames?: string[];
  developer?: string | null;
  publisher?: string | null;
  firstReleaseYear?: number | null;
  genres?: string[];
}

/**
 * Context for collection description generation
 */
export interface CollectionDescriptionContext {
  name: string;
  gamesInCollection?: string[];
  parentCollectionName?: string | null;
  collectionType?: string | null;
  relatedFranchise?: string | null;
}

/**
 * Context for genre description generation
 */
export interface GenreDescriptionContext {
  name: string;
  notableGames?: string[];
  parentGenre?: string | null;
  relatedGenres?: string[];
}

/**
 * Context for theme description generation
 */
export interface ThemeDescriptionContext {
  name: string;
  notableGames?: string[];
  relatedThemes?: string[];
  relatedGenres?: string[];
}

/**
 * Context for game mode description generation
 */
export interface GameModeDescriptionContext {
  name: string;
  notableGames?: string[];
}

/**
 * Context for player perspective description generation
 */
export interface PlayerPerspectiveDescriptionContext {
  name: string;
  notableGames?: string[];
}

/**
 * Context for language description generation
 */
export interface LanguageDescriptionContext {
  name: string;
  nativeName?: string | null;
  isoCode?: string | null;
}

/**
 * Context for tag generation (future)
 */
export interface TagGenerationContext {
  gameName: string;
  description?: string;
  genres?: string[];
  themes?: string[];
}

/**
 * Context for SEO meta generation (future)
 */
export interface SEOMetaContext {
  title: string;
  description?: string;
  contentType: 'game' | 'article' | 'guide';
}

/**
 * Available AI task names
 */
export type AITaskName = 
  | 'game-descriptions'
  | 'tag-generation'
  | 'seo-meta'
  | 'article-summary';

