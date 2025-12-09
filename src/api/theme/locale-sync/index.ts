import type { Core } from '@strapi/strapi';
import type { ThemeLocaleData, ThemeLocaleStrategy, ThemeLocaleSyncResult } from './types';
import { spanishThemeLocaleStrategy } from './strategies/spanish';

/**
 * Registered locale strategies for themes
 * Add new locales here (e.g., frenchThemeLocaleStrategy)
 */
const strategies: ThemeLocaleStrategy[] = [
  spanishThemeLocaleStrategy,
];

/**
 * Sync all configured locales for a theme
 * Runs each locale strategy independently - one failure doesn't block others
 * 
 * @param strapi - Strapi instance
 * @param data - Theme locale data with all required information
 * @returns Array of results for each locale
 */
export async function syncThemeLocales(
  strapi: Core.Strapi,
  data: ThemeLocaleData
): Promise<ThemeLocaleSyncResult[]> {
  const results: ThemeLocaleSyncResult[] = [];

  for (const strategy of strategies) {
    try {
      await strategy.createLocale(strapi, data);
      results.push({
        locale: strategy.locale,
        success: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[ThemeLocaleSync] Failed to sync ${strategy.locale} locale: ${errorMessage}`);
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
 * Get list of configured locale codes for themes
 */
export function getConfiguredThemeLocales(): string[] {
  return strategies.map(s => s.locale);
}

/**
 * Check if a locale is configured for theme sync
 */
export function isThemeLocaleConfigured(locale: string): boolean {
  return strategies.some(s => s.locale === locale);
}

// Re-export types for convenience
export type { ThemeLocaleData, ThemeLocaleStrategy, ThemeLocaleSyncResult } from './types';

