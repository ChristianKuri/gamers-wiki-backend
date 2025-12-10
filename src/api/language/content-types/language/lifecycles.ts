/**
 * Language Content Type Lifecycle Hooks
 * 
 * This file handles lifecycle events for the Language content type.
 * The actual logic is extracted to language-description service for testability.
 * 
 * When a language is created:
 * 1. Generate AI description for English locale
 * 2. Update the English entry with the description
 * 3. Generate AI description for Spanish locale (translated name)
 * 4. Create Spanish locale entry with the description
 * 
 * Note: The Language entity has an 'isoCode' field (ISO language code like "en-US")
 * which is separate from Strapi's internal 'locale' field for i18n.
 */

import type { Core } from '@strapi/strapi';
import { 
  isAIConfigured, 
  generateLanguageDescription,
} from '../../../../ai';
import { syncLanguageLocales } from '../../locale-sync';
import {
  generateLanguageDescriptionsAndSync,
  shouldProcessLanguageEvent,
  type LanguageEventData,
} from '../../services/language-description';

interface LanguageLifecycleEvent {
  result: {
    id: number;
    documentId: string;
    locale: string;
    name: string;
    slug: string;
    description: string | null;
    nativeName: string | null;
    isoCode: string | null;
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
   * Called after a language entry is created
   * Generates AI description and creates locale entries
   * 
   * Runs synchronously to ensure locale entries exist before game relations are created.
   */
  async afterCreate(event: LanguageLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;

    // Only process English locale entries (base locale)
    // Use params.locale for Strapi's locale (en/es), not result.isoCode
    if (!shouldProcessLanguageEvent(params.locale, result.locale)) {
      strapi.log.debug(`[Language:Lifecycle] Skipping non-English locale: ${params.locale || result.locale}`);
      return;
    }

    // Skip if language already has a description (event data check)
    if (result.description) {
      strapi.log.debug(`[Language:Lifecycle] Language "${result.name}" already has description (event data), skipping`);
      return;
    }

    // Double-check database to prevent race conditions and re-triggering
    const existingLanguage = await strapi.db.connection('languages')
      .where({ document_id: result.documentId, locale: 'en' })
      .whereNotNull('description')
      .first();

    if (existingLanguage) {
      strapi.log.debug(`[Language:Lifecycle] Language "${result.name}" already has description (DB check), skipping`);
      return;
    }

    strapi.log.info(`[Language:Lifecycle] Created: "${result.name}" (${result.locale}) - documentId: ${result.documentId}`);

    // Extract language data for the service
    const languageData: LanguageEventData = {
      id: result.id,
      documentId: result.documentId,
      locale: result.locale,
      name: result.name,
      slug: result.slug,
      description: result.description,
      nativeName: result.nativeName,
      isoCode: result.isoCode,
      igdbId: result.igdbId,
    };

    // Synchronous: Wait for AI generation and locale sync to complete
    // This ensures ES locale entries exist before game relations are created
    try {
      await generateLanguageDescriptionsAndSync(
        strapi.db.connection,
        strapi,
        languageData,
        {
          isAIConfigured,
          generateLanguageDescription,
          syncLanguageLocales,
          log: strapi.log,
        }
      );
      strapi.log.info(`[Language:Lifecycle] Completed AI description and locale sync for: ${result.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[Language:Lifecycle] AI generation failed for "${result.name}": ${errorMessage}`);
    }
  },

  /**
   * Called after a language entry is updated
   * Could be used in the future for re-syncing locales when English content changes
   */
  async afterUpdate(event: LanguageLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;

    // Only log for now - future: trigger locale sync on EN updates
    if (params.locale === 'en' || result.locale === 'en') {
      strapi.log.debug(`[Language:Lifecycle] English language updated: "${result.name}" - documentId: ${result.documentId}`);
    }
  },
};

