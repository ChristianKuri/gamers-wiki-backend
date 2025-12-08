/**
 * Company Content Type Lifecycle Hooks
 * 
 * This file handles lifecycle events for the Company content type.
 * The actual logic is extracted to company-description service for testability.
 * 
 * When a company is created:
 * 1. Generate AI description for English locale
 * 2. Update the English entry with the description
 * 3. Generate AI description for Spanish locale
 * 4. Create Spanish locale entry with the description
 * 
 * IMPORTANT: AI description generation runs asynchronously (fire-and-forget).
 * This allows multiple companies to be created in parallel during game imports
 * without blocking on each AI generation completing.
 */

import type { Core } from '@strapi/strapi';
import { 
  isAIConfigured, 
  generateCompanyDescriptions,
} from '../../../../ai';
import { syncCompanyLocales } from '../../locale-sync';
import {
  generateCompanyDescriptionsAndSync,
  shouldProcessCompanyEvent,
  type CompanyEventData,
} from '../../services/company-description';

// Event types for better TypeScript support
interface CompanyLifecycleEvent {
  result: {
    id: number;
    documentId: string;
    locale: string;
    name: string;
    slug: string;
    description: string | null;
    logoUrl: string | null;
    country: string | null;
    foundedYear: number | null;
    igdbId: number | null;
    igdbUrl: string | null;
    [key: string]: unknown;
  };
  params: {
    data: Record<string, unknown>;
    locale?: string;
    [key: string]: unknown;
  };
}

export default {
  /**
   * Called after a company entry is created
   * Generates AI description and creates locale entries
   * 
   * Runs asynchronously (fire-and-forget) to allow parallel processing
   * of multiple companies during game imports.
   */
  async afterCreate(event: CompanyLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;
    
    // Only process English locale entries (base locale)
    if (!shouldProcessCompanyEvent(params.locale, result.locale)) {
      strapi.log.debug(`[Company:Lifecycle] Skipping non-English locale: ${params.locale || result.locale}`);
      return;
    }
    
    // Skip if company already has a description (event data check)
    if (result.description) {
      strapi.log.debug(`[Company:Lifecycle] Company "${result.name}" already has description (event data), skipping`);
      return;
    }
    
    // Double-check database to prevent race conditions and re-triggering
    // This handles cases where publish() might trigger afterCreate with stale event data
    const existingCompany = await strapi.db.connection('companies')
      .where({ document_id: result.documentId, locale: 'en' })
      .whereNotNull('description')
      .first();
    
    if (existingCompany) {
      strapi.log.debug(`[Company:Lifecycle] Company "${result.name}" already has description (DB check), skipping`);
      return;
    }
    
    strapi.log.info(`[Company:Lifecycle] Company created: "${result.name}" (${result.locale}) - documentId: ${result.documentId}`);
    
    // Extract company data for the service
    const companyData: CompanyEventData = {
      id: result.id,
      documentId: result.documentId,
      locale: result.locale,
      name: result.name,
      slug: result.slug,
      description: result.description,
      logoUrl: result.logoUrl,
      country: result.country,
      foundedYear: result.foundedYear,
      igdbId: result.igdbId,
      igdbUrl: result.igdbUrl,
    };
    
    // Fire-and-forget: Start AI generation asynchronously
    // This allows multiple companies to process their AI descriptions in parallel
    // without blocking the main import flow
    generateCompanyDescriptionsAndSync(
      strapi.db.connection,
      strapi,
      companyData,
      {
        isAIConfigured,
        generateCompanyDescriptions,
        syncCompanyLocales,
        log: strapi.log,
      }
    ).catch((error) => {
      // Log but don't throw - we don't want to break the import
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[Company:Lifecycle] Async AI generation failed for "${result.name}": ${errorMessage}`);
    });
    
    // Don't await - return immediately to allow parallel processing
    strapi.log.debug(`[Company:Lifecycle] Started async AI description generation for: ${result.name}`);
  },

  /**
   * Called after a company entry is updated
   * Could be used in the future for re-syncing locales when English content changes
   */
  async afterUpdate(event: CompanyLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;
    
    // Only log for now - future: trigger locale sync on EN updates
    if (params.locale === 'en' || result.locale === 'en') {
      strapi.log.debug(`[Company:Lifecycle] English company updated: "${result.name}" - documentId: ${result.documentId}`);
    }
  },
};

