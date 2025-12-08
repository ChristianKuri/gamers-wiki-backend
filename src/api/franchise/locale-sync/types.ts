import type { Core } from '@strapi/strapi';

/**
 * Data required for creating a localized franchise entry
 */
export interface FranchiseLocaleData {
  /** The document ID shared across all locales */
  documentId: string;
  /** The database row ID of the source (English) entry */
  sourceId: number;
  /** Franchise name (not localized) */
  name: string;
  /** Franchise data from the English entry */
  franchiseData: {
    slug: string;
    igdbId: number | null;
    igdbUrl: string | null;
  };
  /** AI-generated description for this locale */
  aiDescription: string;
}

/**
 * Strategy interface for creating localized franchise entries
 * Each locale implements this interface
 */
export interface FranchiseLocaleStrategy {
  /** The locale code (e.g., 'es', 'fr', 'de') */
  readonly locale: string;
  
  /**
   * Create a localized version of the franchise
   * @param strapi - Strapi instance
   * @param data - Franchise locale data
   * @returns Promise that resolves when locale is created
   */
  createLocale(strapi: Core.Strapi, data: FranchiseLocaleData): Promise<void>;
}

/**
 * Result of locale sync operation
 */
export interface FranchiseLocaleSyncResult {
  locale: string;
  success: boolean;
  error?: string;
}

