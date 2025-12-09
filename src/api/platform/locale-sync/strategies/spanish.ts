import type { Core } from '@strapi/strapi';
import type { PlatformLocaleStrategy, PlatformLocaleData } from '../types';

/**
 * Spanish (es) locale strategy for platforms
 * Creates Spanish locale entries for platforms using Strapi Document Service
 */
export const spanishPlatformLocaleStrategy: PlatformLocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: PlatformLocaleData): Promise<void> {
    const platformService = strapi.documents('api::platform.platform');

    // Check if Spanish locale already exists for this document
    const existing = await platformService.findOne({
      documentId: data.documentId,
      locale: 'es',
    });

    if (existing) {
      strapi.log.info(`[PlatformLocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    // Create Spanish locale entry using Document Service update()
    // In Strapi 5, update() with a new locale creates that locale version
    // Note: update() creates the locale but may not properly set all fields
    const created = await platformService.update({
      documentId: data.documentId,
      locale: 'es',
      data: {
        name: data.name,
        slug: data.platformData.slug,
        abbreviation: data.platformData.abbreviation,
        description: data.aiDescription,
        manufacturer: data.platformData.manufacturer,
        releaseYear: data.platformData.releaseYear,
        category: data.platformData.category,
        igdbId: data.platformData.igdbId,
        logoUrl: data.platformData.logoUrl,
        generation: data.platformData.generation,
      },
      status: 'published',
    } as any);

    strapi.log.info(`[PlatformLocaleSync:ES] Spanish locale entry created (id: ${created?.id}) for platform: ${data.name}`);
    
    // update() when creating new locale may not set all fields properly
    // Update the description separately if it exists
    if (data.aiDescription) {
      await platformService.update({
        documentId: data.documentId,
        locale: 'es',
        data: { description: data.aiDescription },
      } as any);
    }

    // Publish to sync draft to published
    await (platformService as any).publish({
      documentId: data.documentId,
      locale: 'es',
    });

    strapi.log.info(`[PlatformLocaleSync:ES] Spanish locale published for platform: ${data.name}`);
  },
};

