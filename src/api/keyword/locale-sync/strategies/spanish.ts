import type { Core } from '@strapi/strapi';
import type { KeywordLocaleStrategy, KeywordLocaleData } from '../types';

/**
 * Spanish (es) locale strategy for keywords
 * Creates Spanish locale entries for keywords using Strapi Document Service.
 * 
 * Keyword is a simple entity without AI descriptions - just copies the data.
 */
export const spanishKeywordLocaleStrategy: KeywordLocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: KeywordLocaleData): Promise<void> {
    const keywordService = strapi.documents('api::keyword.keyword');

    // Check if Spanish locale already exists for this document
    const existing = await keywordService.findOne({
      documentId: data.documentId,
      locale: 'es',
    });

    if (existing) {
      strapi.log.info(`[KeywordLocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    // Create Spanish locale entry using Document Service update()
    // In Strapi 5, update() with a new locale creates that locale version
    const created = await keywordService.update({
      documentId: data.documentId,
      locale: 'es',
      data: {
        name: data.name,
        slug: data.keywordData.slug,
        igdbId: data.keywordData.igdbId,
      },
      status: 'published',
    } as any);

    strapi.log.info(`[KeywordLocaleSync:ES] Spanish locale entry created (id: ${created?.id}) for keyword: ${data.name}`);

    // Publish to sync draft to published
    await (keywordService as any).publish({
      documentId: data.documentId,
      locale: 'es',
    });

    strapi.log.info(`[KeywordLocaleSync:ES] Spanish locale published for keyword: ${data.name}`);
  },
};

