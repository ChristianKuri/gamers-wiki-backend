import type { Core } from '@strapi/strapi';

/**
 * Data required for creating a localized keyword entry
 */
export interface KeywordLocaleData {
  /** The document ID shared across all locales */
  documentId: string;
  /** The database row ID of the source (English) entry */
  sourceId: number;
  /** Keyword name (not localized - same across all locales) */
  name: string;
  /** Keyword data from the English entry */
  keywordData: {
    slug: string;
    igdbId: number | null;
  };
}

/**
 * Strategy interface for creating localized keyword entries
 * Each locale implements this interface
 */
export interface KeywordLocaleStrategy {
  /** The locale code (e.g., 'es', 'fr', 'de') */
  readonly locale: string;
  
  /**
   * Create a localized version of the keyword
   * @param strapi - Strapi instance
   * @param data - Keyword locale data
   * @returns Promise that resolves when locale is created
   */
  createLocale(strapi: Core.Strapi, data: KeywordLocaleData): Promise<void>;
}

/**
 * Result of locale sync operation
 */
export interface KeywordLocaleSyncResult {
  locale: string;
  success: boolean;
  error?: string;
}

