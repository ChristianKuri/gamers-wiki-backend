/**
 * GameMode Content Type Lifecycle Hooks
 */

import type { Core } from '@strapi/strapi';
import { syncGameModeLocales } from '../../locale-sync';
import type { GameModeLocaleData } from '../../locale-sync';

interface GameModeLifecycleEvent {
  result: {
    id: number;
    documentId: string;
    locale: string;
    name: string;
    slug: string;
    igdbId: number | null;
    [key: string]: unknown;
  };
  params: {
    data: Record<string, unknown>;
    locale?: string;
    [key: string]: unknown;
  };
}

export default {
  async afterCreate(event: GameModeLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;

    const locale = params.locale || result.locale;
    if (locale !== 'en') {
      strapi.log.debug(`[GameMode:Lifecycle] Skipping non-English locale: ${locale}`);
      return;
    }

    strapi.log.info(`[GameMode:Lifecycle] GameMode created: "${result.name}" - documentId: ${result.documentId}`);

    const localeData: GameModeLocaleData = {
      documentId: result.documentId,
      sourceId: result.id,
      name: result.name,
      gameModeData: {
        slug: result.slug,
        igdbId: result.igdbId,
      },
    };

    try {
      await syncGameModeLocales(strapi, localeData);
      strapi.log.info(`[GameMode:Lifecycle] Completed locale sync for: ${result.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[GameMode:Lifecycle] Locale sync failed for "${result.name}": ${errorMessage}`);
    }
  },
};

