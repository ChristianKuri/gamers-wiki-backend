import type { Core } from '@strapi/strapi';
import type { CollectionLocaleStrategy, CollectionLocaleData } from '../types';

/**
 * Spanish (es) locale strategy for collections
 * Creates Spanish locale entries for collections with AI-generated descriptions
 */
export const spanishCollectionLocaleStrategy: CollectionLocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: CollectionLocaleData): Promise<void> {
    const knex = strapi.db.connection;
    const now = new Date().toISOString();

    // Check if Spanish locale already exists for this document
    const existing = await knex('collections')
      .where({ document_id: data.documentId, locale: 'es' })
      .first();

    if (existing) {
      strapi.log.info(`[CollectionLocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    // Insert Spanish locale entry with same document_id
    const [insertedRow] = await knex('collections').insert({
      document_id: data.documentId,
      locale: 'es',
      name: data.name, // Name is not localized
      slug: data.collectionData.slug, // Slug is not localized
      description: data.aiDescription, // AI-generated Spanish description
      igdb_id: data.collectionData.igdbId,
      igdb_url: data.collectionData.igdbUrl,
      published_at: null,
      created_at: now,
      updated_at: now,
    }).returning('id');

    const spanishEntryId = insertedRow?.id ?? insertedRow;
    strapi.log.info(`[CollectionLocaleSync:ES] Spanish locale entry created (id: ${spanishEntryId}) for collection: ${data.name}`);

    // Handle parent collection relation if exists
    if (data.collectionData.parentCollectionDocumentId) {
      // Find the Spanish locale entry of the parent collection
      const parentSpanish = await knex('collections')
        .where({ document_id: data.collectionData.parentCollectionDocumentId, locale: 'es' })
        .first();

      if (parentSpanish) {
        // Link this Spanish entry to the Spanish parent
        await knex('collections_parent_collection_lnk').insert({
          collection_id: spanishEntryId,
          inv_collection_id: parentSpanish.id,
        }).onConflict().ignore();
        strapi.log.info(`[CollectionLocaleSync:ES] Linked to parent collection for: ${data.name}`);
      }
    }
  },
};

