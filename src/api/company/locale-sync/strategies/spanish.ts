import type { Core } from '@strapi/strapi';
import type { CompanyLocaleStrategy, CompanyLocaleData } from '../types';

/**
 * Spanish (es) locale strategy for companies
 * Creates Spanish locale entries for companies using Strapi Document Service
 */
export const spanishCompanyLocaleStrategy: CompanyLocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: CompanyLocaleData): Promise<void> {
    const companyService = strapi.documents('api::company.company');

    // Check if Spanish locale already exists for this document
    const existing = await companyService.findOne({
      documentId: data.documentId,
      locale: 'es',
    });

    if (existing) {
      strapi.log.info(`[CompanyLocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    // Create Spanish locale entry using Document Service update()
    // In Strapi 5, update() with a new locale creates that locale version
    // Note: update() creates the locale but may not properly set all fields
    const created = await companyService.update({
      documentId: data.documentId,
      locale: 'es',
      data: {
        name: data.name,
        slug: data.companyData.slug,
        description: data.aiDescription,
        logoUrl: data.companyData.logoUrl,
        country: data.companyData.country,
        foundedYear: data.companyData.foundedYear,
        igdbId: data.companyData.igdbId,
        igdbUrl: data.companyData.igdbUrl,
      },
      status: 'published',
    } as any);

    strapi.log.info(`[CompanyLocaleSync:ES] Spanish locale entry created (id: ${created?.id}) for company: ${data.name}`);
    
    // update() when creating new locale may not set all fields properly
    // Update the description separately if it exists
    if (data.aiDescription) {
      await companyService.update({
        documentId: data.documentId,
        locale: 'es',
        data: { description: data.aiDescription },
      } as any);
    }

    // Publish to sync draft to published
    await (companyService as any).publish({
      documentId: data.documentId,
      locale: 'es',
    });

    strapi.log.info(`[CompanyLocaleSync:ES] Spanish locale published for company: ${data.name}`);
  },
};

