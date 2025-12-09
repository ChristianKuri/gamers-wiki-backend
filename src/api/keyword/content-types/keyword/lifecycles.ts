/**
 * Keyword Content Type Lifecycle Hooks
 * 
 * Creates Spanish locale entries for keywords when English entries are created.
 * Keyword is a simple entity without AI descriptions - just copies the data.
 */

import type { Core } from '@strapi/strapi';
import { syncKeywordLocales } from '../../locale-sync';
import type { KeywordLocaleData } from '../../locale-sync';

interface KeywordLifecycleEvent {
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
   * Called after a keyword entry is created
   * Creates locale entries for configured locales (ES)
   */
  async afterCreate(event: KeywordLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;

    // Only process English locale creations
    const locale = params.locale || result.locale;
    if (locale !== 'en') {
      strapi.log.debug(`[Keyword:Lifecycle] Skipping non-English locale: ${locale}`);
      return;
    }

    strapi.log.info(`[Keyword:Lifecycle] Keyword created: "${result.name}" - documentId: ${result.documentId}`);

    const localeData: KeywordLocaleData = {
      documentId: result.documentId,
      sourceId: result.id,
      name: result.name,
      keywordData: {
        slug: result.slug,
        igdbId: result.igdbId,
      },
    };

    try {
      await syncKeywordLocales(strapi, localeData);
      strapi.log.info(`[Keyword:Lifecycle] Completed locale sync for: ${result.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[Keyword:Lifecycle] Locale sync failed for "${result.name}": ${errorMessage}`);
    }
  },
};

