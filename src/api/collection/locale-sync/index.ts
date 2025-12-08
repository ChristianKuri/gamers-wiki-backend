import type { Core } from '@strapi/strapi';
import type { CollectionLocaleData, CollectionLocaleStrategy, CollectionLocaleSyncResult } from './types';
import { spanishCollectionLocaleStrategy } from './strategies/spanish';

/**
 * Registered locale strategies for collections
 * Add new locales here (e.g., frenchCollectionLocaleStrategy)
 */
const strategies: CollectionLocaleStrategy[] = [
  spanishCollectionLocaleStrategy,
  // Future locales:
  // frenchCollectionLocaleStrategy,
  // germanCollectionLocaleStrategy,
];

/**
 * Sync all configured locales for a collection
 * Runs each locale strategy independently - one failure doesn't block others
 * 
 * @param strapi - Strapi instance
 * @param data - Collection locale data with all required information
 * @returns Array of results for each locale
 */
export async function syncCollectionLocales(
  strapi: Core.Strapi,
  data: CollectionLocaleData
): Promise<CollectionLocaleSyncResult[]> {
  const results: CollectionLocaleSyncResult[] = [];

  for (const strategy of strategies) {
    try {
      await strategy.createLocale(strapi, data);
      results.push({
        locale: strategy.locale,
        success: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[CollectionLocaleSync] Failed to sync ${strategy.locale} locale: ${errorMessage}`);
      results.push({
        locale: strategy.locale,
        success: false,
        error: errorMessage,
      });
    }
  }

  return results;
}

/**
 * Get list of configured locale codes for collections
 */
export function getConfiguredCollectionLocales(): string[] {
  return strategies.map(s => s.locale);
}

/**
 * Check if a locale is configured for collection sync
 */
export function isCollectionLocaleConfigured(locale: string): boolean {
  return strategies.some(s => s.locale === locale);
}

// Re-export types for convenience
export type { CollectionLocaleData, CollectionLocaleStrategy, CollectionLocaleSyncResult } from './types';

