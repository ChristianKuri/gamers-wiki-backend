import type { Core } from '@strapi/strapi';
import type { KeywordLocaleData, KeywordLocaleStrategy, KeywordLocaleSyncResult } from './types';
import { spanishKeywordLocaleStrategy } from './strategies/spanish';

/**
 * Registered locale strategies for keywords
 */
const strategies: KeywordLocaleStrategy[] = [
  spanishKeywordLocaleStrategy,
];

/**
 * Sync all configured locales for a keyword
 * Runs each locale strategy independently - one failure doesn't block others
 */
export async function syncKeywordLocales(
  strapi: Core.Strapi,
  data: KeywordLocaleData
): Promise<KeywordLocaleSyncResult[]> {
  const results: KeywordLocaleSyncResult[] = [];

  for (const strategy of strategies) {
    try {
      await strategy.createLocale(strapi, data);
      results.push({
        locale: strategy.locale,
        success: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[KeywordLocaleSync] Failed to sync ${strategy.locale} locale: ${errorMessage}`);
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
 * Get list of configured locale codes for keywords
 */
export function getConfiguredKeywordLocales(): string[] {
  return strategies.map(s => s.locale);
}

/**
 * Check if a locale is configured for keyword sync
 */
export function isKeywordLocaleConfigured(locale: string): boolean {
  return strategies.some(s => s.locale === locale);
}

export type { KeywordLocaleData, KeywordLocaleStrategy, KeywordLocaleSyncResult } from './types';

