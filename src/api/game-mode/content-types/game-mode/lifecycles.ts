/**
 * GameMode Content Type Lifecycle Hooks
 * 
 * When a game mode is created:
 * 1. Generate AI description for English locale
 * 2. Update the English entry with the description
 * 3. Generate AI description for Spanish locale (translated name)
 * 4. Create Spanish locale entry with the description
 */

import type { Core } from '@strapi/strapi';
import { 
  isAIConfigured, 
  generateGameModeDescription,
} from '../../../../ai';
import { syncGameModeLocales } from '../../locale-sync';
import {
  generateGameModeDescriptionsAndSync,
  shouldProcessGameModeEvent,
  type GameModeEventData,
} from '../../services/game-mode-description';

interface GameModeLifecycleEvent {
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
  async afterCreate(event: GameModeLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;

    // Only process English locale entries
    if (!shouldProcessGameModeEvent(params.locale, result.locale)) {
      strapi.log.debug(`[GameMode:Lifecycle] Skipping non-English locale: ${params.locale || result.locale}`);
      return;
    }

    // Skip if already has description
    if (result.description) {
      strapi.log.debug(`[GameMode:Lifecycle] GameMode "${result.name}" already has description, skipping`);
      return;
    }

    // Double-check database
    const existingGameMode = await strapi.db.connection('game_modes')
      .where({ document_id: result.documentId, locale: 'en' })
      .whereNotNull('description')
      .first();

    if (existingGameMode) {
      strapi.log.debug(`[GameMode:Lifecycle] GameMode "${result.name}" already has description (DB check), skipping`);
      return;
    }

    strapi.log.info(`[GameMode:Lifecycle] GameMode created: "${result.name}" (${result.locale}) - documentId: ${result.documentId}`);

    const gameModeData: GameModeEventData = {
      id: result.id,
      documentId: result.documentId,
      locale: result.locale,
      name: result.name,
      slug: result.slug,
      description: result.description,
      igdbId: result.igdbId,
    };

    try {
      await generateGameModeDescriptionsAndSync(
        strapi.db.connection,
        strapi,
        gameModeData,
        {
          isAIConfigured,
          generateGameModeDescription,
          syncGameModeLocales,
          log: strapi.log,
        }
      );
      strapi.log.info(`[GameMode:Lifecycle] Completed AI description and locale sync for: ${result.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[GameMode:Lifecycle] AI generation failed for "${result.name}": ${errorMessage}`);
    }
  },

  async afterUpdate(event: GameModeLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;

    if (params.locale === 'en' || result.locale === 'en') {
      strapi.log.debug(`[GameMode:Lifecycle] English game mode updated: "${result.name}" - documentId: ${result.documentId}`);
    }
  },
};

