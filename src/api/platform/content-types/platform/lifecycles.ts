/**
 * Platform Content Type Lifecycle Hooks
 * 
 * This file handles lifecycle events for the Platform content type.
 * The actual logic is extracted to platform-description service for testability.
 * 
 * When a platform is created:
 * 1. Generate AI description for English locale
 * 2. Update the English entry with the description
 * 3. Generate AI description for Spanish locale
 * 4. Create Spanish locale entry with the description
 */

import type { Core } from '@strapi/strapi';
import { 
  isAIConfigured, 
  generatePlatformDescriptions,
} from '../../../../ai';
import { syncPlatformLocales } from '../../locale-sync';
import {
  generatePlatformDescriptionsAndSync,
  shouldProcessPlatformEvent,
  type PlatformEventData,
} from '../../services/platform-description';

// Event types for better TypeScript support
interface PlatformLifecycleEvent {
  result: {
    id: number;
    documentId: string;
    locale: string;
    name: string;
    slug: string;
    abbreviation: string | null;
    description: string | null;
    manufacturer: string | null;
    releaseYear: number | null;
    category: string | null;
    igdbId: number | null;
    logoUrl: string | null;
    generation: number | null;
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
   * Called after a platform entry is created
   * Generates AI description and creates locale entries
   */
  async afterCreate(event: PlatformLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;
    
    // Only process English locale entries (base locale)
    if (!shouldProcessPlatformEvent(params.locale, result.locale)) {
      strapi.log.debug(`[Platform:Lifecycle] Skipping non-English locale: ${params.locale || result.locale}`);
      return;
    }
    
    // Skip if platform already has a description (event data check)
    if (result.description) {
      strapi.log.debug(`[Platform:Lifecycle] Platform "${result.name}" already has description (event data), skipping`);
      return;
    }
    
    // Double-check database to prevent race conditions and re-triggering
    // This handles cases where publish() might trigger afterCreate with stale event data
    const existingPlatform = await strapi.db.connection('platforms')
      .where({ document_id: result.documentId, locale: 'en' })
      .whereNotNull('description')
      .first();
    
    if (existingPlatform) {
      strapi.log.debug(`[Platform:Lifecycle] Platform "${result.name}" already has description (DB check), skipping`);
      return;
    }
    
    strapi.log.info(`[Platform:Lifecycle] Platform created: "${result.name}" (${result.locale}) - documentId: ${result.documentId}`);
    
    // Extract platform data for the service
    const platformData: PlatformEventData = {
      id: result.id,
      documentId: result.documentId,
      locale: result.locale,
      name: result.name,
      slug: result.slug,
      abbreviation: result.abbreviation,
      manufacturer: result.manufacturer,
      releaseYear: result.releaseYear,
      category: result.category,
      igdbId: result.igdbId,
      logoUrl: result.logoUrl,
      generation: result.generation,
    };
    
    // Call the service with production dependencies
    await generatePlatformDescriptionsAndSync(
      strapi.db.connection,
      strapi,
      platformData,
      {
        isAIConfigured,
        generatePlatformDescriptions,
        syncPlatformLocales,
        log: strapi.log,
      }
    );
  },

  /**
   * Called after a platform entry is updated
   * Could be used in the future for re-syncing locales when English content changes
   */
  async afterUpdate(event: PlatformLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;
    
    // Only log for now - future: trigger locale sync on EN updates
    if (params.locale === 'en' || result.locale === 'en') {
      strapi.log.debug(`[Platform:Lifecycle] English platform updated: "${result.name}" - documentId: ${result.documentId}`);
    }
  },
};
