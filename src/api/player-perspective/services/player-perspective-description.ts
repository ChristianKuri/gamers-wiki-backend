/**
 * Player Perspective Description Service
 * 
 * Handles generating AI descriptions for player perspectives and syncing locales.
 * Extracted from lifecycle for testability.
 * 
 * IMPORTANT: Spanish descriptions are generated using the TRANSLATED name
 * so the AI writes "La perspectiva **Primera persona**..." not "La perspectiva **First person**..."
 */

import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import type { PlayerPerspectiveDescriptionContext } from '../../../ai';
import type { PlayerPerspectiveLocaleData, PlayerPerspectiveLocaleSyncResult } from '../locale-sync';

/**
 * Common player perspective name translations (English to Spanish)
 */
const PLAYER_PERSPECTIVE_TRANSLATIONS: Record<string, string> = {
  'First person': 'Primera persona',
  'Third person': 'Tercera persona',
  'Bird view': 'Vista aérea',
  'Bird view / Isometric': 'Vista aérea / Isométrica',
  'Isometric': 'Isométrica',
  'Side view': 'Vista lateral',
  'Text': 'Texto',
  'Auditory': 'Auditivo',
  'Virtual Reality': 'Realidad virtual',
  'VR': 'RV',
};

/**
 * Supported locales for description generation
 */
type SupportedLocale = 'en' | 'es';

/**
 * Get Spanish translation for a player perspective name
 */
export function getSpanishPlayerPerspectiveName(englishName: string): string {
  return PLAYER_PERSPECTIVE_TRANSLATIONS[englishName] || englishName;
}

/**
 * Player Perspective data from the lifecycle event
 */
export interface PlayerPerspectiveEventData {
  id: number;
  documentId: string;
  locale: string;
  name: string;
  slug: string;
  description: string | null;
  igdbId: number | null;
}

/**
 * Dependencies that can be injected for testing
 */
export interface PlayerPerspectiveDescriptionDependencies {
  isAIConfigured: () => boolean;
  generatePlayerPerspectiveDescription: (context: PlayerPerspectiveDescriptionContext, locale: SupportedLocale) => Promise<string>;
  syncPlayerPerspectiveLocales: (strapi: Core.Strapi, data: PlayerPerspectiveLocaleData) => Promise<PlayerPerspectiveLocaleSyncResult[]>;
  log: {
    info: (message: string) => void;
    error: (message: string) => void;
    debug: (message: string) => void;
  };
}

/**
 * Result of the player perspective description generation
 */
export interface PlayerPerspectiveDescriptionResult {
  success: boolean;
  englishDescriptionUpdated: boolean;
  localesSynced: PlayerPerspectiveLocaleSyncResult[];
  error?: string;
}

/**
 * Generate descriptions for a player perspective and sync locales
 * 
 * IMPORTANT: Spanish description is generated using the TRANSLATED name
 * so the AI writes "La perspectiva **Primera persona**..." not "La perspectiva **First person**..."
 */
export async function generatePlayerPerspectiveDescriptionsAndSync(
  _knex: Knex,
  strapi: Core.Strapi,
  playerPerspective: PlayerPerspectiveEventData,
  deps: PlayerPerspectiveDescriptionDependencies
): Promise<PlayerPerspectiveDescriptionResult> {
  const { isAIConfigured, generatePlayerPerspectiveDescription, syncPlayerPerspectiveLocales, log } = deps;

  let englishDescriptionUpdated = false;
  let spanishDescription: string | null = null;

  // Get Spanish name FIRST - needed for Spanish description generation
  const spanishName = getSpanishPlayerPerspectiveName(playerPerspective.name);

  // Generate AI descriptions if configured
  if (isAIConfigured()) {
    try {
      log.info(`[PlayerPerspectiveDescription] Generating AI descriptions for player perspective: ${playerPerspective.name}`);

      // Generate EN description with English name
      const enContext: PlayerPerspectiveDescriptionContext = {
        name: playerPerspective.name,
      };
      const enDescription = await generatePlayerPerspectiveDescription(enContext, 'en');
      log.info(`[PlayerPerspectiveDescription] Generated EN description (length: ${enDescription.length})`);

      // Generate ES description with SPANISH name (translated)
      // This ensures the AI writes "La perspectiva **Primera persona**..." not "La perspectiva **First person**..."
      const esContext: PlayerPerspectiveDescriptionContext = {
        name: spanishName,
      };
      const esDescription = await generatePlayerPerspectiveDescription(esContext, 'es');
      log.info(`[PlayerPerspectiveDescription] Generated ES description (length: ${esDescription.length}) using name: ${spanishName}`);

      // Update English entry
      const playerPerspectiveService = strapi.documents('api::player-perspective.player-perspective');
      await playerPerspectiveService.update({
        documentId: playerPerspective.documentId,
        locale: 'en',
        data: { description: enDescription },
      } as any);

      await (playerPerspectiveService as any).publish({
        documentId: playerPerspective.documentId,
        locale: 'en',
      });

      log.info(`[PlayerPerspectiveDescription] Updated and published English description for: ${playerPerspective.name}`);
      englishDescriptionUpdated = true;
      spanishDescription = esDescription;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[PlayerPerspectiveDescription] AI description error for "${playerPerspective.name}": ${errorMessage}`);
    }
  } else {
    log.info(`[PlayerPerspectiveDescription] AI not configured, skipping description generation for: ${playerPerspective.name}`);
  }

  // ALWAYS sync locales
  try {
    const localeData: PlayerPerspectiveLocaleData = {
      documentId: playerPerspective.documentId,
      sourceId: playerPerspective.id,
      name: playerPerspective.name,
      playerPerspectiveData: {
        slug: playerPerspective.slug,
        igdbId: playerPerspective.igdbId,
      },
      aiDescription: spanishDescription,
      localizedName: spanishName,
    };

    // Sync locales (create Spanish entry)
    const localeResults = await syncPlayerPerspectiveLocales(strapi, localeData);

    for (const localeResult of localeResults) {
      if (localeResult.success) {
        log.info(`[PlayerPerspectiveDescription] ${localeResult.locale.toUpperCase()} locale created for: ${playerPerspective.name}`);
      } else {
        log.error(`[PlayerPerspectiveDescription] Failed to create ${localeResult.locale.toUpperCase()} locale: ${localeResult.error}`);
      }
    }

    log.info(`[PlayerPerspectiveDescription] Completed processing for: ${playerPerspective.name}`);

    return {
      success: true,
      englishDescriptionUpdated,
      localesSynced: localeResults,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`[PlayerPerspectiveDescription] Locale sync error for "${playerPerspective.name}": ${errorMessage}`);
    
    return {
      success: false,
      englishDescriptionUpdated,
      localesSynced: [],
      error: errorMessage,
    };
  }
}

/**
 * Check if we should process this player perspective event
 * Only process English locale entries (base locale)
 */
export function shouldProcessPlayerPerspectiveEvent(
  paramsLocale: string | undefined,
  resultLocale: string
): boolean {
  const locale = paramsLocale || resultLocale;
  return locale === 'en';
}

