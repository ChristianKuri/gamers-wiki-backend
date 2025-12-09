import type { Core } from '@strapi/strapi';
import type { CollectionLocaleStrategy, CollectionLocaleData } from '../types';

/**
 * Spanish (es) locale strategy for collections
 * Creates Spanish locale entries for collections using Strapi Document Service
 */
export const spanishCollectionLocaleStrategy: CollectionLocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: CollectionLocaleData): Promise<void> {
    const collectionService = strapi.documents('api::collection.collection');

    // Check if Spanish locale already exists for this document
    const existing = await collectionService.findOne({
      documentId: data.documentId,
      locale: 'es',
    });

    if (existing) {
      strapi.log.info(`[CollectionLocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    // Create Spanish locale entry using Document Service update()
    // In Strapi 5, update() with a new locale creates that locale version
    // Note: update() creates the locale but may not properly set all fields
    const created = await collectionService.update({
      documentId: data.documentId,
      locale: 'es',
      data: {
        name: data.name,
        slug: data.collectionData.slug,
        description: data.aiDescription,
        igdbId: data.collectionData.igdbId,
        igdbUrl: data.collectionData.igdbUrl,
        // Parent collection relation - Strapi handles document-level relations
        parentCollection: data.collectionData.parentCollectionDocumentId || undefined,
      },
      status: 'published',
    } as any);

    strapi.log.info(`[CollectionLocaleSync:ES] Spanish locale entry created (id: ${created?.id}) for collection: ${data.name}`);
    
    // update() when creating new locale may not set all fields properly
    // Update the description separately if it exists
    if (data.aiDescription) {
      await collectionService.update({
        documentId: data.documentId,
        locale: 'es',
        data: { description: data.aiDescription },
      } as any);
    }

    // Publish to sync draft to published
    await (collectionService as any).publish({
      documentId: data.documentId,
      locale: 'es',
    });

    strapi.log.info(`[CollectionLocaleSync:ES] Spanish locale published for collection: ${data.name}`);
  },
};

