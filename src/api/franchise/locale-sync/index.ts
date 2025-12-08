import type { Core } from '@strapi/strapi';
import type { FranchiseLocaleData, FranchiseLocaleStrategy, FranchiseLocaleSyncResult } from './types';
import { spanishFranchiseLocaleStrategy } from './strategies/spanish';

/**
 * Registered locale strategies for franchises
 * Add new locales here (e.g., frenchFranchiseLocaleStrategy)
 */
const strategies: FranchiseLocaleStrategy[] = [
  spanishFranchiseLocaleStrategy,
  // Future locales:
  // frenchFranchiseLocaleStrategy,
  // germanFranchiseLocaleStrategy,
];

/**
 * Sync all configured locales for a franchise
 * Runs each locale strategy independently - one failure doesn't block others
 * 
 * @param strapi - Strapi instance
 * @param data - Franchise locale data with all required information
 * @returns Array of results for each locale
 */
export async function syncFranchiseLocales(
  strapi: Core.Strapi,
  data: FranchiseLocaleData
): Promise<FranchiseLocaleSyncResult[]> {
  const results: FranchiseLocaleSyncResult[] = [];

  for (const strategy of strategies) {
    try {
      await strategy.createLocale(strapi, data);
      results.push({
        locale: strategy.locale,
        success: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[FranchiseLocaleSync] Failed to sync ${strategy.locale} locale: ${errorMessage}`);
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
 * Get list of configured locale codes for franchises
 */
export function getConfiguredFranchiseLocales(): string[] {
  return strategies.map(s => s.locale);
}

/**
 * Check if a locale is configured for franchise sync
 */
export function isFranchiseLocaleConfigured(locale: string): boolean {
  return strategies.some(s => s.locale === locale);
}

// Re-export types for convenience
export type { FranchiseLocaleData, FranchiseLocaleStrategy, FranchiseLocaleSyncResult } from './types';

