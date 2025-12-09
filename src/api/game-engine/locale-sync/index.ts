import type { Core } from '@strapi/strapi';
import type { GameEngineLocaleData, GameEngineLocaleStrategy, GameEngineLocaleSyncResult } from './types';
import { spanishGameEngineLocaleStrategy } from './strategies/spanish';

const strategies: GameEngineLocaleStrategy[] = [
  spanishGameEngineLocaleStrategy,
];

export async function syncGameEngineLocales(
  strapi: Core.Strapi,
  data: GameEngineLocaleData
): Promise<GameEngineLocaleSyncResult[]> {
  const results: GameEngineLocaleSyncResult[] = [];

  for (const strategy of strategies) {
    try {
      await strategy.createLocale(strapi, data);
      results.push({ locale: strategy.locale, success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[GameEngineLocaleSync] Failed to sync ${strategy.locale} locale: ${errorMessage}`);
      results.push({ locale: strategy.locale, success: false, error: errorMessage });
    }
  }

  return results;
}

export function getConfiguredGameEngineLocales(): string[] {
  return strategies.map(s => s.locale);
}

export function isGameEngineLocaleConfigured(locale: string): boolean {
  return strategies.some(s => s.locale === locale);
}

export type { GameEngineLocaleData, GameEngineLocaleStrategy, GameEngineLocaleSyncResult } from './types';

