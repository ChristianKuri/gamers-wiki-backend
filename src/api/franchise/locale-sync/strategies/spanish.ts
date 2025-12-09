import type { Core } from '@strapi/strapi';
import type { FranchiseLocaleStrategy, FranchiseLocaleData } from '../types';

/**
 * Spanish (es) locale strategy for franchises
 * Creates Spanish locale entries for franchises with AI-generated descriptions
 */
export const spanishFranchiseLocaleStrategy: FranchiseLocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: FranchiseLocaleData): Promise<void> {
    const knex = strapi.db.connection;
    const now = new Date().toISOString();

    // Check if Spanish locale already exists for this document
    const existing = await knex('franchises')
      .where({ document_id: data.documentId, locale: 'es' })
      .first();

    if (existing) {
      strapi.log.info(`[FranchiseLocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    // Insert Spanish locale entry with same document_id (as published)
    const [insertedRow] = await knex('franchises').insert({
      document_id: data.documentId,
      locale: 'es',
      name: data.name, // Name is not localized
      slug: data.franchiseData.slug, // Slug is not localized
      description: data.aiDescription, // AI-generated Spanish description
      igdb_id: data.franchiseData.igdbId,
      igdb_url: data.franchiseData.igdbUrl,
      published_at: now, // Create as published (no draft)
      created_at: now,
      updated_at: now,
    }).returning('id');

    const spanishEntryId = insertedRow?.id ?? insertedRow;
    strapi.log.info(`[FranchiseLocaleSync:ES] Spanish locale entry created (id: ${spanishEntryId}) for franchise: ${data.name}`);
  },
};

