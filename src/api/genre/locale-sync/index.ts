import type { Core } from '@strapi/strapi';
import type { GenreLocaleData, GenreLocaleStrategy, GenreLocaleSyncResult } from './types';
import { spanishGenreLocaleStrategy } from './strategies/spanish';

/**
 * Registered locale strategies for genres
 * Add new locales here (e.g., frenchGenreLocaleStrategy)
 */
const strategies: GenreLocaleStrategy[] = [
  spanishGenreLocaleStrategy,
  // Future locales:
  // frenchGenreLocaleStrategy,
  // germanGenreLocaleStrategy,
];

/**
 * Sync all configured locales for a genre
 * Runs each locale strategy independently - one failure doesn't block others
 * 
 * @param strapi - Strapi instance
 * @param data - Genre locale data with all required information
 * @returns Array of results for each locale
 */
export async function syncGenreLocales(
  strapi: Core.Strapi,
  data: GenreLocaleData
): Promise<GenreLocaleSyncResult[]> {
  const results: GenreLocaleSyncResult[] = [];

  for (const strategy of strategies) {
    try {
      await strategy.createLocale(strapi, data);
      results.push({
        locale: strategy.locale,
        success: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[GenreLocaleSync] Failed to sync ${strategy.locale} locale: ${errorMessage}`);
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
 * Get list of configured locale codes for genres
 */
export function getConfiguredGenreLocales(): string[] {
  return strategies.map(s => s.locale);
}

/**
 * Check if a locale is configured for genre sync
 */
export function isGenreLocaleConfigured(locale: string): boolean {
  return strategies.some(s => s.locale === locale);
}

// Re-export types for convenience
export type { GenreLocaleData, GenreLocaleStrategy, GenreLocaleSyncResult } from './types';

