import type { Core } from '@strapi/strapi';
import { syncPlayerPerspectiveLocales } from '../../locale-sync';
import type { PlayerPerspectiveLocaleData } from '../../locale-sync';

interface PlayerPerspectiveLifecycleEvent {
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
  async afterCreate(event: PlayerPerspectiveLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;

    const locale = params.locale || result.locale;
    if (locale !== 'en') {
      strapi.log.debug(`[PlayerPerspective:Lifecycle] Skipping non-English locale: ${locale}`);
      return;
    }

    strapi.log.info(`[PlayerPerspective:Lifecycle] Created: "${result.name}" - documentId: ${result.documentId}`);

    const localeData: PlayerPerspectiveLocaleData = {
      documentId: result.documentId,
      sourceId: result.id,
      name: result.name,
      playerPerspectiveData: {
        slug: result.slug,
        igdbId: result.igdbId,
      },
    };

    try {
      await syncPlayerPerspectiveLocales(strapi, localeData);
      strapi.log.info(`[PlayerPerspective:Lifecycle] Completed locale sync for: ${result.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[PlayerPerspective:Lifecycle] Locale sync failed for "${result.name}": ${errorMessage}`);
    }
  },
};

