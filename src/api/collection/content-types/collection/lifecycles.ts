/**
 * Collection Content Type Lifecycle Hooks
 * 
 * This file handles lifecycle events for the Collection content type.
 * The actual logic is extracted to collection-description service for testability.
 * 
 * When a collection is created:
 * 1. Generate AI description for English locale
 * 2. Update the English entry with the description
 * 3. Generate AI description for Spanish locale
 * 4. Create Spanish locale entry with the description
 * 
 * IMPORTANT: AI description generation runs asynchronously (fire-and-forget).
 * This allows multiple collections to be created in parallel during game imports
 * without blocking on each AI generation completing.
 */

import type { Core } from '@strapi/strapi';
import { 
  isAIConfigured, 
  generateCollectionDescriptions,
} from '../../../../ai';
import { syncCollectionLocales } from '../../locale-sync';
import {
  generateCollectionDescriptionsAndSync,
  shouldProcessCollectionEvent,
  type CollectionEventData,
} from '../../services/collection-description';

// Event types for better TypeScript support
interface CollectionLifecycleEvent {
  result: {
    id: number;
    documentId: string;
    locale: string;
    name: string;
    slug: string;
    description: string | null;
    igdbId: number | null;
    igdbUrl: string | null;
    parentCollection?: { documentId: string } | null;
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
   * Called after a collection entry is created
   * Generates AI description and creates locale entries
   * 
   * Runs asynchronously (fire-and-forget) to allow parallel processing
   * of multiple collections during game imports.
   */
  async afterCreate(event: CollectionLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;
    
    // Only process English locale entries (base locale)
    if (!shouldProcessCollectionEvent(params.locale, result.locale)) {
      strapi.log.debug(`[Collection:Lifecycle] Skipping non-English locale: ${params.locale || result.locale}`);
      return;
    }
    
    // Skip if collection already has a description (event data check)
    if (result.description) {
      strapi.log.debug(`[Collection:Lifecycle] Collection "${result.name}" already has description (event data), skipping`);
      return;
    }
    
    // Double-check database to prevent race conditions and re-triggering
    // This handles cases where publish() might trigger afterCreate with stale event data
    const existingCollection = await strapi.db.connection('collections')
      .where({ document_id: result.documentId, locale: 'en' })
      .whereNotNull('description')
      .first();
    
    if (existingCollection) {
      strapi.log.debug(`[Collection:Lifecycle] Collection "${result.name}" already has description (DB check), skipping`);
      return;
    }
    
    strapi.log.info(`[Collection:Lifecycle] Collection created: "${result.name}" (${result.locale}) - documentId: ${result.documentId}`);
    
    // Extract parent collection document ID if available
    const parentCollectionDocumentId = result.parentCollection?.documentId || null;
    
    // Extract collection data for the service
    const collectionData: CollectionEventData = {
      id: result.id,
      documentId: result.documentId,
      locale: result.locale,
      name: result.name,
      slug: result.slug,
      description: result.description,
      igdbId: result.igdbId,
      igdbUrl: result.igdbUrl,
      parentCollectionDocumentId,
    };
    
    // Synchronous: Wait for AI generation and locale sync to complete
    // This ensures ES locale entries exist before game relations are created
    try {
      await generateCollectionDescriptionsAndSync(
        strapi.db.connection,
        strapi,
        collectionData,
        {
          isAIConfigured,
          generateCollectionDescriptions,
          syncCollectionLocales,
          log: strapi.log,
        }
      );
      strapi.log.info(`[Collection:Lifecycle] Completed AI description and locale sync for: ${result.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[Collection:Lifecycle] AI generation failed for "${result.name}": ${errorMessage}`);
    }
  },

  /**
   * Called after a collection entry is updated
   * Could be used in the future for re-syncing locales when English content changes
   */
  async afterUpdate(event: CollectionLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;
    
    // Only log for now - future: trigger locale sync on EN updates
    if (params.locale === 'en' || result.locale === 'en') {
      strapi.log.debug(`[Collection:Lifecycle] English collection updated: "${result.name}" - documentId: ${result.documentId}`);
    }
  },
};

