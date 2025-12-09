import type { Core } from '@strapi/strapi';
import type { LanguageLocaleData, LanguageLocaleStrategy, LanguageLocaleSyncResult } from './types';
import { spanishLanguageLocaleStrategy } from './strategies/spanish';

const strategies: LanguageLocaleStrategy[] = [
  spanishLanguageLocaleStrategy,
];

export async function syncLanguageLocales(
  strapi: Core.Strapi,
  data: LanguageLocaleData
): Promise<LanguageLocaleSyncResult[]> {
  const results: LanguageLocaleSyncResult[] = [];

  for (const strategy of strategies) {
    try {
      await strategy.createLocale(strapi, data);
      results.push({ locale: strategy.locale, success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[LanguageLocaleSync] Failed to sync ${strategy.locale} locale: ${errorMessage}`);
      results.push({ locale: strategy.locale, success: false, error: errorMessage });
    }
  }

  return results;
}

export function getConfiguredLanguageLocales(): string[] {
  return strategies.map(s => s.locale);
}

export function isLanguageLocaleConfigured(locale: string): boolean {
  return strategies.some(s => s.locale === locale);
}

export type { LanguageLocaleData, LanguageLocaleStrategy, LanguageLocaleSyncResult } from './types';

