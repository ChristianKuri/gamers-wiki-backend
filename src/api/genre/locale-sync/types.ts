import type { Core } from '@strapi/strapi';

/**
 * Data required for creating a localized genre entry
 */
export interface GenreLocaleData {
  /** The document ID shared across all locales */
  documentId: string;
  /** The database row ID of the source (English) entry */
  sourceId: number;
  /** Genre name (can be localized for translation) */
  name: string;
  /** Genre data from the English entry */
  genreData: {
    slug: string;
    igdbId: number | null;
  };
  /** AI-generated description for this locale */
  aiDescription: string | null;
  /** Localized genre name for this locale */
  localizedName?: string;
}

/**
 * Strategy interface for creating localized genre entries
 * Each locale implements this interface
 */
export interface GenreLocaleStrategy {
  /** The locale code (e.g., 'es', 'fr', 'de') */
  readonly locale: string;
  
  /**
   * Create a localized version of the genre
   * @param strapi - Strapi instance
   * @param data - Genre locale data
   * @returns Promise that resolves when locale is created
   */
  createLocale(strapi: Core.Strapi, data: GenreLocaleData): Promise<void>;
}

/**
 * Result of locale sync operation
 */
export interface GenreLocaleSyncResult {
  locale: string;
  success: boolean;
  error?: string;
}

