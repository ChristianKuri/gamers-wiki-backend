import type { Core } from '@strapi/strapi';
import type { PlatformLocaleStrategy, PlatformLocaleData } from '../types';

/**
 * Spanish (es) locale strategy for platforms
 * Creates Spanish locale entries for platforms with AI-generated descriptions
 */
export const spanishPlatformLocaleStrategy: PlatformLocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: PlatformLocaleData): Promise<void> {
    const knex = strapi.db.connection;
    const now = new Date().toISOString();

    // Check if Spanish locale already exists for this document
    const existing = await knex('platforms')
      .where({ document_id: data.documentId, locale: 'es' })
      .first();

    if (existing) {
      strapi.log.info(`[PlatformLocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    // Insert Spanish locale entry with same document_id
    const [insertedRow] = await knex('platforms').insert({
      document_id: data.documentId,
      locale: 'es',
      name: data.name, // Name is not localized
      slug: data.platformData.slug, // Slug is not localized
      abbreviation: data.platformData.abbreviation,
      description: data.aiDescription, // AI-generated Spanish description
      manufacturer: data.platformData.manufacturer,
      release_year: data.platformData.releaseYear,
      category: data.platformData.category,
      igdb_id: data.platformData.igdbId,
      logo_url: data.platformData.logoUrl,
      generation: data.platformData.generation,
      published_at: null,
      created_at: now,
      updated_at: now,
    }).returning('id');

    const spanishEntryId = insertedRow?.id ?? insertedRow;
    strapi.log.info(`[PlatformLocaleSync:ES] Spanish locale entry created (id: ${spanishEntryId}) for platform: ${data.name}`);
  },
};

