/**
 * Game Content Type Lifecycle Hooks
 * 
 * This file handles lifecycle events for the Game content type.
 * 
 * NOTE: Locale sync is NOT triggered automatically via afterCreate because:
 * 1. The IGDB localized names are not available in the lifecycle event
 * 2. Relation IDs (document IDs) are collected during import, not stored in the game
 * 3. The game-fetcher has all the context needed for locale creation
 * 
 * Instead, locale sync is triggered explicitly by the game-fetcher controller
 * after creating the English game entry. See:
 * - src/api/game/locale-sync/index.ts - syncLocales() function
 * - src/api/game-fetcher/controllers/game-fetcher.ts - importGame() method
 * 
 * This file can be used for future lifecycle needs such as:
 * - Auto-syncing locales when English content is updated
 * - Clearing caches on publish
 * - Sending notifications on game creation
 */

import type { Core } from '@strapi/strapi';

// Event types for better TypeScript support
interface LifecycleEvent {
  result: {
    id: number;
    documentId: string;
    locale: string;
    name: string;
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
   * Called after a game entry is created
   * Currently used for logging; locale sync is handled by game-fetcher
   */
  async afterCreate(event: LifecycleEvent) {
    const { result } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;
    
    // Log game creation for monitoring
    strapi.log.debug(`[Game:Lifecycle] Game created: "${result.name}" (${result.locale}) - documentId: ${result.documentId}`);
  },

  /**
   * Called after a game entry is updated
   * Future: Could trigger locale re-sync when English content changes
   */
  async afterUpdate(event: LifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;
    
    // Only log for now - future: trigger locale sync on EN updates
    if (params.locale === 'en' || result.locale === 'en') {
      strapi.log.debug(`[Game:Lifecycle] English game updated: "${result.name}" - documentId: ${result.documentId}`);
    }
  },
};

