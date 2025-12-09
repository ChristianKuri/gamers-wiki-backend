import type { Core } from '@strapi/strapi';
import type { GenreLocaleStrategy, GenreLocaleData } from '../types';

/**
 * Generate a URL-safe slug from a localized name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]+/g, '-')     // Replace non-alphanumeric with dashes
    .replace(/^-|-$/g, '');          // Remove leading/trailing dashes
}

/**
 * Spanish (es) locale strategy for genres
 * Creates Spanish locale entries for genres using Strapi Document Service
 */
export const spanishGenreLocaleStrategy: GenreLocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: GenreLocaleData): Promise<void> {
    const genreService = strapi.documents('api::genre.genre');

    // Check if Spanish locale already exists for this document
    const existing = await genreService.findOne({
      documentId: data.documentId,
      locale: 'es',
    });

    if (existing) {
      strapi.log.info(`[GenreLocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    // Use localized name if provided, otherwise use original name
    const spanishName = data.localizedName || data.name;
    const spanishSlug = generateSlug(spanishName);

    // Create Spanish locale entry using Document Service update()
    // In Strapi 5, update() with a new locale creates that locale version
    const created = await genreService.update({
      documentId: data.documentId,
      locale: 'es',
      data: {
        name: spanishName,
        slug: spanishSlug,
        description: data.aiDescription,
        igdbId: data.genreData.igdbId,
      },
      status: 'published',
    } as any);

    strapi.log.info(`[GenreLocaleSync:ES] Spanish locale entry created (id: ${created?.id}) for genre: ${spanishName}`);
    
    // update() when creating new locale may not set all fields properly
    // Update the description separately if it exists
    if (data.aiDescription) {
      await genreService.update({
        documentId: data.documentId,
        locale: 'es',
        data: { description: data.aiDescription },
      } as any);
    }

    // Publish to sync draft to published
    await (genreService as any).publish({
      documentId: data.documentId,
      locale: 'es',
    });

    strapi.log.info(`[GenreLocaleSync:ES] Spanish locale published for genre: ${spanishName}`);
  },
};

