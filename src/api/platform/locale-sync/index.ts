import type { Core } from '@strapi/strapi';
import type { PlatformLocaleData, PlatformLocaleStrategy, PlatformLocaleSyncResult } from './types';
import { spanishPlatformLocaleStrategy } from './strategies/spanish';

/**
 * Registered locale strategies for platforms
 * Add new locales here (e.g., frenchPlatformLocaleStrategy)
 */
const strategies: PlatformLocaleStrategy[] = [
  spanishPlatformLocaleStrategy,
  // Future locales:
  // frenchPlatformLocaleStrategy,
  // germanPlatformLocaleStrategy,
];

/**
 * Sync all configured locales for a platform
 * Runs each locale strategy independently - one failure doesn't block others
 * 
 * @param strapi - Strapi instance
 * @param data - Platform locale data with all required information
 * @returns Array of results for each locale
 */
export async function syncPlatformLocales(
  strapi: Core.Strapi,
  data: PlatformLocaleData
): Promise<PlatformLocaleSyncResult[]> {
  const results: PlatformLocaleSyncResult[] = [];

  for (const strategy of strategies) {
    try {
      await strategy.createLocale(strapi, data);
      results.push({
        locale: strategy.locale,
        success: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[PlatformLocaleSync] Failed to sync ${strategy.locale} locale: ${errorMessage}`);
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
 * Get list of configured locale codes for platforms
 */
export function getConfiguredPlatformLocales(): string[] {
  return strategies.map(s => s.locale);
}

/**
 * Check if a locale is configured for platform sync
 */
export function isPlatformLocaleConfigured(locale: string): boolean {
  return strategies.some(s => s.locale === locale);
}

// Re-export types for convenience
export type { PlatformLocaleData, PlatformLocaleStrategy, PlatformLocaleSyncResult } from './types';

