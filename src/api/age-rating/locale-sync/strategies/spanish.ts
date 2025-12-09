import type { Core } from '@strapi/strapi';
import type { AgeRatingLocaleStrategy, AgeRatingLocaleData } from '../types';

export const spanishAgeRatingLocaleStrategy: AgeRatingLocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: AgeRatingLocaleData): Promise<void> {
    const service = strapi.documents('api::age-rating.age-rating');

    const existing = await service.findOne({
      documentId: data.documentId,
      locale: 'es',
    });

    if (existing) {
      strapi.log.info(`[AgeRatingLocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    const created = await service.update({
      documentId: data.documentId,
      locale: 'es',
      data: {
        category: data.ageRatingData.category,
        rating: data.ageRatingData.rating,
        ratingCoverUrl: data.ageRatingData.ratingCoverUrl,
        synopsis: data.ageRatingData.synopsis,
        igdbId: data.ageRatingData.igdbId,
        contentDescriptions: data.ageRatingData.contentDescriptions,
      },
      status: 'published',
    } as any);

    strapi.log.info(`[AgeRatingLocaleSync:ES] Spanish locale entry created (id: ${created?.id}) for: ${data.ageRatingData.category} ${data.ageRatingData.rating}`);

    await (service as any).publish({
      documentId: data.documentId,
      locale: 'es',
    });

    strapi.log.info(`[AgeRatingLocaleSync:ES] Spanish locale published for: ${data.ageRatingData.category} ${data.ageRatingData.rating}`);
  },
};

