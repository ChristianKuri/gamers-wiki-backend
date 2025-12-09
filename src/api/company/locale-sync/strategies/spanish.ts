import type { Core } from '@strapi/strapi';
import type { CompanyLocaleStrategy, CompanyLocaleData } from '../types';

/**
 * Spanish (es) locale strategy for companies
 * Creates Spanish locale entries for companies with AI-generated descriptions
 */
export const spanishCompanyLocaleStrategy: CompanyLocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: CompanyLocaleData): Promise<void> {
    const knex = strapi.db.connection;
    const now = new Date().toISOString();

    // Check if Spanish locale already exists for this document
    const existing = await knex('companies')
      .where({ document_id: data.documentId, locale: 'es' })
      .first();

    if (existing) {
      strapi.log.info(`[CompanyLocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    // Insert Spanish locale entry with same document_id (as published)
    const [insertedRow] = await knex('companies').insert({
      document_id: data.documentId,
      locale: 'es',
      name: data.name, // Name is not localized
      slug: data.companyData.slug, // Slug is not localized
      description: data.aiDescription, // AI-generated Spanish description
      logo_url: data.companyData.logoUrl,
      country: data.companyData.country,
      founded_year: data.companyData.foundedYear,
      igdb_id: data.companyData.igdbId,
      igdb_url: data.companyData.igdbUrl,
      published_at: now, // Create as published (no draft)
      created_at: now,
      updated_at: now,
    }).returning('id');

    const spanishEntryId = insertedRow?.id ?? insertedRow;
    strapi.log.info(`[CompanyLocaleSync:ES] Spanish locale entry created (id: ${spanishEntryId}) for company: ${data.name}`);
  },
};

