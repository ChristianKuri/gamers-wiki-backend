import type { Core } from '@strapi/strapi';
import { syncAgeRatingLocales } from '../../locale-sync';
import type { AgeRatingLocaleData } from '../../locale-sync';

interface AgeRatingLifecycleEvent {
  result: {
    id: number;
    documentId: string;
    locale: string;
    category: string;
    rating: string;
    ratingCoverUrl: string | null;
    synopsis: string | null;
    igdbId: number | null;
    contentDescriptions: string[] | null;
    [key: string]: unknown;
  };
  params: {
    data: Record<string, unknown>;
    locale?: string;
    [key: string]: unknown;
  };
}

export default {
  async afterCreate(event: AgeRatingLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;

    const locale = params.locale || result.locale;
    if (locale !== 'en') {
      strapi.log.debug(`[AgeRating:Lifecycle] Skipping non-English locale: ${locale}`);
      return;
    }

    strapi.log.info(`[AgeRating:Lifecycle] Created: "${result.category} ${result.rating}" - documentId: ${result.documentId}`);

    const localeData: AgeRatingLocaleData = {
      documentId: result.documentId,
      sourceId: result.id,
      ageRatingData: {
        category: result.category,
        rating: result.rating,
        ratingCoverUrl: result.ratingCoverUrl,
        synopsis: result.synopsis,
        igdbId: result.igdbId,
        contentDescriptions: result.contentDescriptions,
      },
    };

    try {
      await syncAgeRatingLocales(strapi, localeData);
      strapi.log.info(`[AgeRating:Lifecycle] Completed locale sync for: ${result.category} ${result.rating}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[AgeRating:Lifecycle] Locale sync failed for "${result.category} ${result.rating}": ${errorMessage}`);
    }
  },
};

