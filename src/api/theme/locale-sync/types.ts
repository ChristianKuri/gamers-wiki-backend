import type { Core } from '@strapi/strapi';

/**
 * Data required for creating a localized theme entry
 */
export interface ThemeLocaleData {
  /** The document ID shared across all locales */
  documentId: string;
  /** The database row ID of the source (English) entry */
  sourceId: number;
  /** Theme name (not localized - same across all locales) */
  name: string;
  /** Theme data from the English entry */
  themeData: {
    slug: string;
    igdbId: number | null;
  };
}

/**
 * Strategy interface for creating localized theme entries
 * Each locale implements this interface
 */
export interface ThemeLocaleStrategy {
  /** The locale code (e.g., 'es', 'fr', 'de') */
  readonly locale: string;
  
  /**
   * Create a localized version of the theme
   * @param strapi - Strapi instance
   * @param data - Theme locale data
   * @returns Promise that resolves when locale is created
   */
  createLocale(strapi: Core.Strapi, data: ThemeLocaleData): Promise<void>;
}

/**
 * Result of locale sync operation
 */
export interface ThemeLocaleSyncResult {
  locale: string;
  success: boolean;
  error?: string;
}

