import type { Core } from '@strapi/strapi';

/**
 * Data required for creating a localized collection entry
 */
export interface CollectionLocaleData {
  /** The document ID shared across all locales */
  documentId: string;
  /** The database row ID of the source (English) entry */
  sourceId: number;
  /** Collection name (not localized) */
  name: string;
  /** Collection data from the English entry */
  collectionData: {
    slug: string;
    igdbId: number | null;
    igdbUrl: string | null;
    parentCollectionDocumentId: string | null;
  };
  /** AI-generated description for this locale */
  aiDescription: string;
}

/**
 * Strategy interface for creating localized collection entries
 * Each locale implements this interface
 */
export interface CollectionLocaleStrategy {
  /** The locale code (e.g., 'es', 'fr', 'de') */
  readonly locale: string;
  
  /**
   * Create a localized version of the collection
   * @param strapi - Strapi instance
   * @param data - Collection locale data
   * @returns Promise that resolves when locale is created
   */
  createLocale(strapi: Core.Strapi, data: CollectionLocaleData): Promise<void>;
}

/**
 * Result of locale sync operation
 */
export interface CollectionLocaleSyncResult {
  locale: string;
  success: boolean;
  error?: string;
}

