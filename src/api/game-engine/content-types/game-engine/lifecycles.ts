import type { Core } from '@strapi/strapi';
import { syncGameEngineLocales } from '../../locale-sync';
import type { GameEngineLocaleData } from '../../locale-sync';

interface GameEngineLifecycleEvent {
  result: {
    id: number;
    documentId: string;
    locale: string;
    name: string;
    slug: string;
    description: string | null;
    logoUrl: string | null;
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
  async afterCreate(event: GameEngineLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;

    const locale = params.locale || result.locale;
    if (locale !== 'en') {
      strapi.log.debug(`[GameEngine:Lifecycle] Skipping non-English locale: ${locale}`);
      return;
    }

    strapi.log.info(`[GameEngine:Lifecycle] Created: "${result.name}" - documentId: ${result.documentId}`);

    const localeData: GameEngineLocaleData = {
      documentId: result.documentId,
      sourceId: result.id,
      name: result.name,
      gameEngineData: {
        slug: result.slug,
        description: result.description,
        logoUrl: result.logoUrl,
        igdbId: result.igdbId,
      },
    };

    try {
      await syncGameEngineLocales(strapi, localeData);
      strapi.log.info(`[GameEngine:Lifecycle] Completed locale sync for: ${result.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[GameEngine:Lifecycle] Locale sync failed for "${result.name}": ${errorMessage}`);
    }
  },
};

