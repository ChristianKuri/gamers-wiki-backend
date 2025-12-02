import type { Core } from '@strapi/strapi';

/**
 * Base interface for all seeders
 */
export interface Seeder {
  /** Unique name for logging purposes */
  name: string;
  
  /** 
   * Run the seeder. Should be idempotent (safe to run multiple times).
   * @param strapi - Strapi instance
   */
  run: (strapi: Core.Strapi) => Promise<void>;
}

/**
 * Localized content data structure for bilingual content
 */
export interface LocalizedData<T> {
  en: T;
  es: T;
}

/**
 * Helper type for content with name, slug, and description
 */
export interface TaxonomyData {
  name: string;
  slug: string;
  description?: string;
}

