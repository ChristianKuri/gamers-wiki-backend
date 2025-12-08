import type { Core } from '@strapi/strapi';

/**
 * Data required for creating a localized platform entry
 */
export interface PlatformLocaleData {
  /** The document ID shared across all locales */
  documentId: string;
  /** The database row ID of the source (English) entry */
  sourceId: number;
  /** Platform name (not localized) */
  name: string;
  /** Platform data from the English entry */
  platformData: {
    slug: string;
    abbreviation: string | null;
    manufacturer: string | null;
    releaseYear: number | null;
    category: string | null;
    igdbId: number | null;
    logoUrl: string | null;
    generation: number | null;
  };
  /** AI-generated description for this locale */
  aiDescription: string;
}

/**
 * Strategy interface for creating localized platform entries
 * Each locale implements this interface
 */
export interface PlatformLocaleStrategy {
  /** The locale code (e.g., 'es', 'fr', 'de') */
  readonly locale: string;
  
  /**
   * Create a localized version of the platform
   * @param strapi - Strapi instance
   * @param data - Platform locale data
   * @returns Promise that resolves when locale is created
   */
  createLocale(strapi: Core.Strapi, data: PlatformLocaleData): Promise<void>;
}

/**
 * Result of locale sync operation
 */
export interface PlatformLocaleSyncResult {
  locale: string;
  success: boolean;
  error?: string;
}

