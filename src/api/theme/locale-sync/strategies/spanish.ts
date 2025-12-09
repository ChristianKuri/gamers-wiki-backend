import type { Core } from '@strapi/strapi';
import type { ThemeLocaleStrategy, ThemeLocaleData } from '../types';

/**
 * Spanish (es) locale strategy for themes
 * Creates Spanish locale entries for themes using Strapi Document Service.
 * 
 * Theme is a simple entity without AI descriptions - just copies the data.
 */
export const spanishThemeLocaleStrategy: ThemeLocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: ThemeLocaleData): Promise<void> {
    const themeService = strapi.documents('api::theme.theme');

    // Check if Spanish locale already exists for this document
    const existing = await themeService.findOne({
      documentId: data.documentId,
      locale: 'es',
    });

    if (existing) {
      strapi.log.info(`[ThemeLocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    // Create Spanish locale entry using Document Service update()
    // In Strapi 5, update() with a new locale creates that locale version
    const created = await themeService.update({
      documentId: data.documentId,
      locale: 'es',
      data: {
        name: data.name,
        slug: data.themeData.slug,
        igdbId: data.themeData.igdbId,
      },
      status: 'published',
    } as any);

    strapi.log.info(`[ThemeLocaleSync:ES] Spanish locale entry created (id: ${created?.id}) for theme: ${data.name}`);

    // Publish to sync draft to published
    await (themeService as any).publish({
      documentId: data.documentId,
      locale: 'es',
    });

    strapi.log.info(`[ThemeLocaleSync:ES] Spanish locale published for theme: ${data.name}`);
  },
};

