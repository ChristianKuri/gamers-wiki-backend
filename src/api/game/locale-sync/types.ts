import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';

/**
 * Localized data for a specific locale (from IGDB)
 */
export interface LocalizedData {
  /** Localized name */
  name: string;
  /** Localized cover URL (if available) */
  coverUrl: string | null;
}

/**
 * Localized names map by locale code
 */
export interface LocalizedNames {
  en: LocalizedData;
  es: LocalizedData;
  // Future locales can be added here
}

/**
 * Data required for creating a localized game entry
 */
export interface GameLocaleData {
  /** The document ID shared across all locales */
  documentId: string;
  /** The database row ID of the source (English) entry */
  sourceId: number;
  /** Localized names from IGDB */
  localizedNames: LocalizedNames;
  /** Original game data for non-localized fields */
  gameData: {
    description: string;
    releaseDate: string | null;
    gameCategory: string;
    gameStatus: string;
    coverImageUrl: string | null;
    screenshotUrls: string[];
    trailerIds: string[];
    metacriticScore: number | null;
    userRating: number | null;
    userRatingCount: number | null;
    totalRating: number | null;
    totalRatingCount: number | null;
    hypes: number | null;
    multiplayerModes: unknown[];
    officialWebsite: string | null;
    steamUrl: string | null;
    epicUrl: string | null;
    gogUrl: string | null;
    itchUrl: string | null;
    discordUrl: string | null;
    igdbId: number;
    igdbUrl: string | null;
  };
  /** Relation document IDs (for copying to new locale) */
  relationIds: {
    developers: string[];
    publishers: string[];
    franchises: string[];
    platforms: string[];
    genres: string[];
    languages: string[];
    ageRatings: string[];
    gameEngines: string[];
    gameModes: string[];
    playerPerspectives: string[];
    themes: string[];
    keywords: string[];
  };
  /** AI-generated description for this locale (optional) */
  aiDescription?: string;
}

/**
 * Strategy interface for creating localized game entries
 * Each locale implements this interface
 */
export interface LocaleStrategy {
  /** The locale code (e.g., 'es', 'fr', 'de') */
  readonly locale: string;
  
  /**
   * Create or update a localized version of the game
   * @param strapi - Strapi instance
   * @param data - Game locale data
   * @returns Promise that resolves when locale is created
   */
  createLocale(strapi: Core.Strapi, data: GameLocaleData): Promise<void>;
}

/**
 * Database helper context passed to strategies
 */
export interface DbHelperContext {
  knex: Knex;
  strapi: Core.Strapi;
}

/**
 * Link table configuration for copying relations
 */
export interface LinkTableConfig {
  tableName: string;
  gameField: string;
  relatedField: string;
  relatedTable: string;
}

/**
 * Result of locale sync operation
 */
export interface LocaleSyncResult {
  locale: string;
  success: boolean;
  error?: string;
}

