/**
 * Franchise Content Type Lifecycle Hooks
 * 
 * This file handles lifecycle events for the Franchise content type.
 * The actual logic is extracted to franchise-description service for testability.
 * 
 * When a franchise is created:
 * 1. Generate AI description for English locale
 * 2. Update the English entry with the description
 * 3. Generate AI description for Spanish locale
 * 4. Create Spanish locale entry with the description
 * 
 * IMPORTANT: Lifecycle processing is treated as synchronous for reliability.
 * This ensures ES locale entries exist before game locale sync links relations.
 */

import type { Core } from '@strapi/strapi';
import { 
  isAIConfigured, 
  generateFranchiseDescriptions,
} from '../../../../ai';
import { syncFranchiseLocales } from '../../locale-sync';
import {
  generateFranchiseDescriptionsAndSync,
  shouldProcessFranchiseEvent,
  type FranchiseEventData,
} from '../../services/franchise-description';

// Event types for better TypeScript support
interface FranchiseLifecycleEvent {
  result: {
    id: number;
    documentId: string;
    locale: string;
    name: string;
    slug: string;
    description: string | null;
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
   * Called after a franchise entry is created
   * Generates AI description and creates locale entries
   * 
   * Runs synchronously to avoid race conditions during imports.
   */
  async afterCreate(event: FranchiseLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;
    
    // Only process English locale entries (base locale)
    if (!shouldProcessFranchiseEvent(params.locale, result.locale)) {
      strapi.log.debug(`[Franchise:Lifecycle] Skipping non-English locale: ${params.locale || result.locale}`);
      return;
    }
    
    // Skip if franchise already has a description (event data check)
    if (result.description) {
      strapi.log.debug(`[Franchise:Lifecycle] Franchise "${result.name}" already has description (event data), skipping`);
      return;
    }
    
    // Double-check database to prevent race conditions and re-triggering
    // This handles cases where publish() might trigger afterCreate with stale event data
    const existingFranchise = await strapi.db.connection('franchises')
      .where({ document_id: result.documentId, locale: 'en' })
      .whereNotNull('description')
      .first();
    
    if (existingFranchise) {
      strapi.log.debug(`[Franchise:Lifecycle] Franchise "${result.name}" already has description (DB check), skipping`);
      return;
    }
    
    strapi.log.info(`[Franchise:Lifecycle] Franchise created: "${result.name}" (${result.locale}) - documentId: ${result.documentId}`);
    
    // Extract franchise data for the service
    const franchiseData: FranchiseEventData = {
      id: result.id,
      documentId: result.documentId,
      locale: result.locale,
      name: result.name,
      slug: result.slug,
      description: result.description,
      igdbId: result.igdbId,
      igdbUrl: result.igdbUrl,
    };
    
    // Synchronous: Wait for AI generation and locale sync to complete
    // This ensures ES locale entries exist before game relations are created
    try {
      await generateFranchiseDescriptionsAndSync(
        strapi.db.connection,
        strapi,
        franchiseData,
        {
          isAIConfigured,
          generateFranchiseDescriptions,
          syncFranchiseLocales,
          log: strapi.log,
        }
      );
      strapi.log.info(`[Franchise:Lifecycle] Completed AI description and locale sync for: ${result.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[Franchise:Lifecycle] AI generation failed for "${result.name}": ${errorMessage}`);
    }
  },

  /**
   * Called after a franchise entry is updated
   * Could be used in the future for re-syncing locales when English content changes
   */
  async afterUpdate(event: FranchiseLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;
    
    // Only log for now - future: trigger locale sync on EN updates
    if (params.locale === 'en' || result.locale === 'en') {
      strapi.log.debug(`[Franchise:Lifecycle] English franchise updated: "${result.name}" - documentId: ${result.documentId}`);
    }
  },
};

