/**
 * Theme Content Type Lifecycle Hooks
 * 
 * Creates Spanish locale entries for themes when English entries are created.
 * Theme is a simple entity without AI descriptions - just copies the data.
 */

import type { Core } from '@strapi/strapi';
import { syncThemeLocales } from '../../locale-sync';
import type { ThemeLocaleData } from '../../locale-sync';

interface ThemeLifecycleEvent {
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
  /**
   * Called after a theme entry is created
   * Creates locale entries for configured locales (ES)
   * 
   * Runs synchronously to ensure locale entries exist before game relations are created.
   */
  async afterCreate(event: ThemeLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;

    // Only process English locale creations
    const locale = params.locale || result.locale;
    if (locale !== 'en') {
      strapi.log.debug(`[Theme:Lifecycle] Skipping non-English locale: ${locale}`);
      return;
    }

    strapi.log.info(`[Theme:Lifecycle] Theme created: "${result.name}" - documentId: ${result.documentId}`);

    const localeData: ThemeLocaleData = {
      documentId: result.documentId,
      sourceId: result.id,
      name: result.name,
      themeData: {
        slug: result.slug,
        igdbId: result.igdbId,
      },
    };

    try {
      await syncThemeLocales(strapi, localeData);
      strapi.log.info(`[Theme:Lifecycle] Completed locale sync for: ${result.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[Theme:Lifecycle] Locale sync failed for "${result.name}": ${errorMessage}`);
    }
  },
};

