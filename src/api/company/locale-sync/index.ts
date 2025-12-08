import type { Core } from '@strapi/strapi';
import type { CompanyLocaleData, CompanyLocaleStrategy, CompanyLocaleSyncResult } from './types';
import { spanishCompanyLocaleStrategy } from './strategies/spanish';

/**
 * Registered locale strategies for companies
 * Add new locales here (e.g., frenchCompanyLocaleStrategy)
 */
const strategies: CompanyLocaleStrategy[] = [
  spanishCompanyLocaleStrategy,
  // Future locales:
  // frenchCompanyLocaleStrategy,
  // germanCompanyLocaleStrategy,
];

/**
 * Sync all configured locales for a company
 * Runs each locale strategy independently - one failure doesn't block others
 * 
 * @param strapi - Strapi instance
 * @param data - Company locale data with all required information
 * @returns Array of results for each locale
 */
export async function syncCompanyLocales(
  strapi: Core.Strapi,
  data: CompanyLocaleData
): Promise<CompanyLocaleSyncResult[]> {
  const results: CompanyLocaleSyncResult[] = [];

  for (const strategy of strategies) {
    try {
      await strategy.createLocale(strapi, data);
      results.push({
        locale: strategy.locale,
        success: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[CompanyLocaleSync] Failed to sync ${strategy.locale} locale: ${errorMessage}`);
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
 * Get list of configured locale codes for companies
 */
export function getConfiguredCompanyLocales(): string[] {
  return strategies.map(s => s.locale);
}

/**
 * Check if a locale is configured for company sync
 */
export function isCompanyLocaleConfigured(locale: string): boolean {
  return strategies.some(s => s.locale === locale);
}

// Re-export types for convenience
export type { CompanyLocaleData, CompanyLocaleStrategy, CompanyLocaleSyncResult } from './types';

