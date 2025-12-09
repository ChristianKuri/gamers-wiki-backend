/**
 * Theme Content Type Lifecycle Hooks
 * 
 * This file handles lifecycle events for the Theme content type.
 * The actual logic is extracted to theme-description service for testability.
 * 
 * When a theme is created:
 * 1. Generate AI description for English locale
 * 2. Update the English entry with the description
 * 3. Generate AI description for Spanish locale (translated name)
 * 4. Create Spanish locale entry with the description
 */

import type { Core } from '@strapi/strapi';
import { 
  isAIConfigured, 
  generateThemeDescriptions,
} from '../../../../ai';
import { syncThemeLocales } from '../../locale-sync';
import {
  generateThemeDescriptionsAndSync,
  shouldProcessThemeEvent,
  type ThemeEventData,
} from '../../services/theme-description';

// Event types for better TypeScript support
interface ThemeLifecycleEvent {
  result: {
    id: number;
    documentId: string;
    locale: string;
    name: string;
    slug: string;
    description: string | null;
    igdbId: number | null;
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
   * Called after a theme entry is created
   * Generates AI description and creates locale entries
   * 
   * Runs synchronously to ensure locale entries exist before game relations are created.
   */
  async afterCreate(event: ThemeLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;
    
    // Only process English locale entries (base locale)
    if (!shouldProcessThemeEvent(params.locale, result.locale)) {
      strapi.log.debug(`[Theme:Lifecycle] Skipping non-English locale: ${params.locale || result.locale}`);
      return;
    }
    
    // Skip if theme already has a description (event data check)
    if (result.description) {
      strapi.log.debug(`[Theme:Lifecycle] Theme "${result.name}" already has description (event data), skipping`);
      return;
    }
    
    // Double-check database to prevent race conditions and re-triggering
    // This handles cases where publish() might trigger afterCreate with stale event data
    const existingTheme = await strapi.db.connection('themes')
      .where({ document_id: result.documentId, locale: 'en' })
      .whereNotNull('description')
      .first();
    
    if (existingTheme) {
      strapi.log.debug(`[Theme:Lifecycle] Theme "${result.name}" already has description (DB check), skipping`);
      return;
    }
    
    strapi.log.info(`[Theme:Lifecycle] Theme created: "${result.name}" (${result.locale}) - documentId: ${result.documentId}`);
    
    // Extract theme data for the service
    const themeData: ThemeEventData = {
      id: result.id,
      documentId: result.documentId,
      locale: result.locale,
      name: result.name,
      slug: result.slug,
      description: result.description,
      igdbId: result.igdbId,
    };
    
    // Synchronous: Wait for AI generation and locale sync to complete
    // This ensures ES locale entries exist before game relations are created
    try {
      await generateThemeDescriptionsAndSync(
        strapi.db.connection,
        strapi,
        themeData,
        {
          isAIConfigured,
          generateThemeDescriptions,
          syncThemeLocales,
          log: strapi.log,
        }
      );
      strapi.log.info(`[Theme:Lifecycle] Completed AI description and locale sync for: ${result.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[Theme:Lifecycle] AI generation failed for "${result.name}": ${errorMessage}`);
    }
  },

  /**
   * Called after a theme entry is updated
   * Could be used in the future for re-syncing locales when English content changes
   */
  async afterUpdate(event: ThemeLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;
    
    // Only log for now - future: trigger locale sync on EN updates
    if (params.locale === 'en' || result.locale === 'en') {
      strapi.log.debug(`[Theme:Lifecycle] English theme updated: "${result.name}" - documentId: ${result.documentId}`);
    }
  },
};

