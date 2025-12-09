/**
 * Player Perspective Content Type Lifecycle Hooks
 * 
 * This file handles lifecycle events for the Player Perspective content type.
 * The actual logic is extracted to player-perspective-description service for testability.
 * 
 * When a player perspective is created:
 * 1. Generate AI description for English locale
 * 2. Update the English entry with the description
 * 3. Generate AI description for Spanish locale (translated name)
 * 4. Create Spanish locale entry with the description
 */

import type { Core } from '@strapi/strapi';
import { 
  isAIConfigured, 
  generatePlayerPerspectiveDescription,
} from '../../../../ai';
import { syncPlayerPerspectiveLocales } from '../../locale-sync';
import {
  generatePlayerPerspectiveDescriptionsAndSync,
  shouldProcessPlayerPerspectiveEvent,
  type PlayerPerspectiveEventData,
} from '../../services/player-perspective-description';

interface PlayerPerspectiveLifecycleEvent {
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
   * Called after a player perspective entry is created
   * Generates AI description and creates locale entries
   * 
   * Runs synchronously to ensure locale entries exist before game relations are created.
   */
  async afterCreate(event: PlayerPerspectiveLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;

    // Only process English locale entries (base locale)
    if (!shouldProcessPlayerPerspectiveEvent(params.locale, result.locale)) {
      strapi.log.debug(`[PlayerPerspective:Lifecycle] Skipping non-English locale: ${params.locale || result.locale}`);
      return;
    }

    // Skip if player perspective already has a description (event data check)
    if (result.description) {
      strapi.log.debug(`[PlayerPerspective:Lifecycle] Player perspective "${result.name}" already has description (event data), skipping`);
      return;
    }

    // Double-check database to prevent race conditions and re-triggering
    const existingPerspective = await strapi.db.connection('player_perspectives')
      .where({ document_id: result.documentId, locale: 'en' })
      .whereNotNull('description')
      .first();

    if (existingPerspective) {
      strapi.log.debug(`[PlayerPerspective:Lifecycle] Player perspective "${result.name}" already has description (DB check), skipping`);
      return;
    }

    strapi.log.info(`[PlayerPerspective:Lifecycle] Created: "${result.name}" (${result.locale}) - documentId: ${result.documentId}`);

    // Extract player perspective data for the service
    const playerPerspectiveData: PlayerPerspectiveEventData = {
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
      await generatePlayerPerspectiveDescriptionsAndSync(
        strapi.db.connection,
        strapi,
        playerPerspectiveData,
        {
          isAIConfigured,
          generatePlayerPerspectiveDescription,
          syncPlayerPerspectiveLocales,
          log: strapi.log,
        }
      );
      strapi.log.info(`[PlayerPerspective:Lifecycle] Completed AI description and locale sync for: ${result.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[PlayerPerspective:Lifecycle] AI generation failed for "${result.name}": ${errorMessage}`);
    }
  },

  /**
   * Called after a player perspective entry is updated
   * Could be used in the future for re-syncing locales when English content changes
   */
  async afterUpdate(event: PlayerPerspectiveLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;

    // Only log for now - future: trigger locale sync on EN updates
    if (params.locale === 'en' || result.locale === 'en') {
      strapi.log.debug(`[PlayerPerspective:Lifecycle] English player perspective updated: "${result.name}" - documentId: ${result.documentId}`);
    }
  },
};

