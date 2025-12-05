import type { Core } from '@strapi/strapi';
import type { GameLocaleData, LocaleStrategy, LocaleSyncResult } from './types';
import { spanishLocaleStrategy } from './strategies/spanish';

/**
 * Registered locale strategies
 * Add new locales here (e.g., frenchLocaleStrategy, germanLocaleStrategy)
 */
const strategies: LocaleStrategy[] = [
  spanishLocaleStrategy,
  // Future locales:
  // frenchLocaleStrategy,
  // germanLocaleStrategy,
  // portugueseLocaleStrategy,
];

/**
 * Sync all configured locales for a game
 * Runs each locale strategy independently - one failure doesn't block others
 * 
 * @param strapi - Strapi instance
 * @param data - Game locale data with all required information
 * @returns Array of results for each locale
 */
export async function syncLocales(
  strapi: Core.Strapi,
  data: GameLocaleData
): Promise<LocaleSyncResult[]> {
  const results: LocaleSyncResult[] = [];

  for (const strategy of strategies) {
    try {
      await strategy.createLocale(strapi, data);
      results.push({
        locale: strategy.locale,
        success: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[LocaleSync] Failed to sync ${strategy.locale} locale: ${errorMessage}`);
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
 * Get list of configured locale codes
 */
export function getConfiguredLocales(): string[] {
  return strategies.map(s => s.locale);
}

/**
 * Check if a locale is configured for sync
 */
export function isLocaleConfigured(locale: string): boolean {
  return strategies.some(s => s.locale === locale);
}

// Re-export types for convenience
export type { GameLocaleData, LocaleStrategy, LocaleSyncResult } from './types';

