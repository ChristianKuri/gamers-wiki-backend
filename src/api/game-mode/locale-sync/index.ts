import type { Core } from '@strapi/strapi';
import type { GameModeLocaleData, GameModeLocaleStrategy, GameModeLocaleSyncResult } from './types';
import { spanishGameModeLocaleStrategy } from './strategies/spanish';

const strategies: GameModeLocaleStrategy[] = [
  spanishGameModeLocaleStrategy,
];

export async function syncGameModeLocales(
  strapi: Core.Strapi,
  data: GameModeLocaleData
): Promise<GameModeLocaleSyncResult[]> {
  const results: GameModeLocaleSyncResult[] = [];

  for (const strategy of strategies) {
    try {
      await strategy.createLocale(strapi, data);
      results.push({ locale: strategy.locale, success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[GameModeLocaleSync] Failed to sync ${strategy.locale} locale: ${errorMessage}`);
      results.push({ locale: strategy.locale, success: false, error: errorMessage });
    }
  }

  return results;
}

export function getConfiguredGameModeLocales(): string[] {
  return strategies.map(s => s.locale);
}

export function isGameModeLocaleConfigured(locale: string): boolean {
  return strategies.some(s => s.locale === locale);
}

export type { GameModeLocaleData, GameModeLocaleStrategy, GameModeLocaleSyncResult } from './types';

