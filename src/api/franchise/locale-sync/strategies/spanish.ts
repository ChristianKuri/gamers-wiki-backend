import type { Core } from '@strapi/strapi';
import type { FranchiseLocaleStrategy, FranchiseLocaleData } from '../types';

/**
 * Spanish (es) locale strategy for franchises
 * Creates Spanish locale entries for franchises using Strapi Document Service
 */
export const spanishFranchiseLocaleStrategy: FranchiseLocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: FranchiseLocaleData): Promise<void> {
    const franchiseService = strapi.documents('api::franchise.franchise');

    // Check if Spanish locale already exists for this document
    const existing = await franchiseService.findOne({
      documentId: data.documentId,
      locale: 'es',
    });

    if (existing) {
      strapi.log.info(`[FranchiseLocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    // Create Spanish locale entry using Document Service update()
    // In Strapi 5, update() with a new locale creates that locale version
    // Note: update() creates the locale but may not properly set all fields
    strapi.log.info(`[FranchiseLocaleSync:ES] Creating ES locale with description length: ${data.aiDescription?.length || 0}`);
    
    const created = await franchiseService.update({
      documentId: data.documentId,
      locale: 'es',
      data: {
        name: data.name,
        slug: data.franchiseData.slug,
        description: data.aiDescription,
        igdbId: data.franchiseData.igdbId,
        igdbUrl: data.franchiseData.igdbUrl,
      },
      status: 'published',
    } as any);

    strapi.log.info(`[FranchiseLocaleSync:ES] Spanish locale entry created (id: ${created?.id}) for franchise: ${data.name}`);
    
    // update() when creating new locale may not set all fields properly
    // Update the description separately if it exists
    if (data.aiDescription) {
      await franchiseService.update({
        documentId: data.documentId,
        locale: 'es',
        data: { description: data.aiDescription },
      } as any);
      strapi.log.info(`[FranchiseLocaleSync:ES] Updated ES description for: ${data.name}`);
    }

    // Publish to sync draft to published
    await (franchiseService as any).publish({
      documentId: data.documentId,
      locale: 'es',
    });

    strapi.log.info(`[FranchiseLocaleSync:ES] Spanish locale published for franchise: ${data.name}`);
  },
};

