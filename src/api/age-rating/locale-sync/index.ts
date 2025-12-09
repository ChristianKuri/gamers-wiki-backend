import type { Core } from '@strapi/strapi';
import type { AgeRatingLocaleData, AgeRatingLocaleStrategy, AgeRatingLocaleSyncResult } from './types';
import { spanishAgeRatingLocaleStrategy } from './strategies/spanish';

const strategies: AgeRatingLocaleStrategy[] = [
  spanishAgeRatingLocaleStrategy,
];

export async function syncAgeRatingLocales(
  strapi: Core.Strapi,
  data: AgeRatingLocaleData
): Promise<AgeRatingLocaleSyncResult[]> {
  const results: AgeRatingLocaleSyncResult[] = [];

  for (const strategy of strategies) {
    try {
      await strategy.createLocale(strapi, data);
      results.push({ locale: strategy.locale, success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[AgeRatingLocaleSync] Failed to sync ${strategy.locale} locale: ${errorMessage}`);
      results.push({ locale: strategy.locale, success: false, error: errorMessage });
    }
  }

  return results;
}

export function getConfiguredAgeRatingLocales(): string[] {
  return strategies.map(s => s.locale);
}

export function isAgeRatingLocaleConfigured(locale: string): boolean {
  return strategies.some(s => s.locale === locale);
}

export type { AgeRatingLocaleData, AgeRatingLocaleStrategy, AgeRatingLocaleSyncResult } from './types';

