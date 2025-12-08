import type { Core } from '@strapi/strapi';

/**
 * Data required for creating a localized company entry
 */
export interface CompanyLocaleData {
  /** The document ID shared across all locales */
  documentId: string;
  /** The database row ID of the source (English) entry */
  sourceId: number;
  /** Company name (not localized) */
  name: string;
  /** Company data from the English entry */
  companyData: {
    slug: string;
    logoUrl: string | null;
    country: string | null;
    foundedYear: number | null;
    igdbId: number | null;
    igdbUrl: string | null;
  };
  /** AI-generated description for this locale */
  aiDescription: string;
}

/**
 * Strategy interface for creating localized company entries
 * Each locale implements this interface
 */
export interface CompanyLocaleStrategy {
  /** The locale code (e.g., 'es', 'fr', 'de') */
  readonly locale: string;
  
  /**
   * Create a localized version of the company
   * @param strapi - Strapi instance
   * @param data - Company locale data
   * @returns Promise that resolves when locale is created
   */
  createLocale(strapi: Core.Strapi, data: CompanyLocaleData): Promise<void>;
}

/**
 * Result of locale sync operation
 */
export interface CompanyLocaleSyncResult {
  locale: string;
  success: boolean;
  error?: string;
}

