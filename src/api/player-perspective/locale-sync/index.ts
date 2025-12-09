import type { Core } from '@strapi/strapi';
import type { PlayerPerspectiveLocaleData, PlayerPerspectiveLocaleStrategy, PlayerPerspectiveLocaleSyncResult } from './types';
import { spanishPlayerPerspectiveLocaleStrategy } from './strategies/spanish';

const strategies: PlayerPerspectiveLocaleStrategy[] = [
  spanishPlayerPerspectiveLocaleStrategy,
];

export async function syncPlayerPerspectiveLocales(
  strapi: Core.Strapi,
  data: PlayerPerspectiveLocaleData
): Promise<PlayerPerspectiveLocaleSyncResult[]> {
  const results: PlayerPerspectiveLocaleSyncResult[] = [];

  for (const strategy of strategies) {
    try {
      await strategy.createLocale(strapi, data);
      results.push({ locale: strategy.locale, success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[PlayerPerspectiveLocaleSync] Failed to sync ${strategy.locale} locale: ${errorMessage}`);
      results.push({ locale: strategy.locale, success: false, error: errorMessage });
    }
  }

  return results;
}

export function getConfiguredPlayerPerspectiveLocales(): string[] {
  return strategies.map(s => s.locale);
}

export function isPlayerPerspectiveLocaleConfigured(locale: string): boolean {
  return strategies.some(s => s.locale === locale);
}

export type { PlayerPerspectiveLocaleData, PlayerPerspectiveLocaleStrategy, PlayerPerspectiveLocaleSyncResult } from './types';

