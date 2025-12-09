/**
 * Game Mode Description Service
 * 
 * Handles generating AI descriptions for game modes and syncing locales.
 * Extracted from lifecycle for testability.
 * 
 * IMPORTANT: Spanish descriptions are generated using the TRANSLATED name
 * so the AI writes "El modo **Un jugador**..." not "El modo **Single player**..."
 */

import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import type { GameModeDescriptionContext } from '../../../ai';
import type { GameModeLocaleData, GameModeLocaleSyncResult } from '../locale-sync';

/**
 * Common game mode name translations (English to Spanish)
 */
const GAME_MODE_TRANSLATIONS: Record<string, string> = {
  'Single player': 'Un jugador',
  'Multiplayer': 'Multijugador',
  'Co-operative': 'Cooperativo',
  'Co-op': 'Cooperativo',
  'Split screen': 'Pantalla dividida',
  'Massively Multiplayer Online (MMO)': 'Multijugador masivo en línea (MMO)',
  'MMO': 'MMO',
  'Battle Royale': 'Battle Royale',
};

/**
 * Get Spanish translation for a game mode name
 */
export function getSpanishGameModeName(englishName: string): string {
  return GAME_MODE_TRANSLATIONS[englishName] || englishName;
}

/**
 * Game mode data from the lifecycle event
 */
export interface GameModeEventData {
  id: number;
  documentId: string;
  locale: string;
  name: string;
  slug: string;
  description: string | null;
  igdbId: number | null;
}

/**
 * Supported locales for description generation
 */
type SupportedLocale = 'en' | 'es';

/**
 * Dependencies that can be injected for testing
 */
export interface GameModeDescriptionDependencies {
  isAIConfigured: () => boolean;
  generateGameModeDescription: (context: GameModeDescriptionContext, locale: SupportedLocale) => Promise<string>;
  syncGameModeLocales: (strapi: Core.Strapi, data: GameModeLocaleData) => Promise<GameModeLocaleSyncResult[]>;
  log: {
    info: (message: string) => void;
    error: (message: string) => void;
    debug: (message: string) => void;
  };
}

/**
 * Result of the game mode description generation
 */
export interface GameModeDescriptionResult {
  success: boolean;
  englishDescriptionUpdated: boolean;
  localesSynced: GameModeLocaleSyncResult[];
  error?: string;
}

/**
 * Generate descriptions for a game mode and sync locales
 * 
 * IMPORTANT: Spanish description is generated using the TRANSLATED name
 * so the AI writes "El modo **Un jugador**..." not "El modo **Single player**..."
 */
export async function generateGameModeDescriptionsAndSync(
  _knex: Knex,
  strapi: Core.Strapi,
  gameMode: GameModeEventData,
  deps: GameModeDescriptionDependencies
): Promise<GameModeDescriptionResult> {
  const { isAIConfigured, generateGameModeDescription, syncGameModeLocales, log } = deps;

  let englishDescriptionUpdated = false;
  let spanishDescription: string | null = null;

  // Get Spanish name FIRST - needed for Spanish description generation
  const spanishName = getSpanishGameModeName(gameMode.name);

  // Generate AI descriptions if configured
  if (isAIConfigured()) {
    try {
      log.info(`[GameModeDescription] Generating AI descriptions for game mode: ${gameMode.name}`);

      // Generate EN description with English name
      const enContext: GameModeDescriptionContext = {
        name: gameMode.name,
      };
      const enDescription = await generateGameModeDescription(enContext, 'en');
      log.info(`[GameModeDescription] Generated EN description (length: ${enDescription.length})`);

      // Generate ES description with SPANISH name (translated)
      // This ensures the AI writes "El modo **Un jugador**..." not "El modo **Single player**..."
      const esContext: GameModeDescriptionContext = {
        name: spanishName,
      };
      const esDescription = await generateGameModeDescription(esContext, 'es');
      log.info(`[GameModeDescription] Generated ES description (length: ${esDescription.length}) using name: ${spanishName}`);

      // Update English entry
      const gameModeService = strapi.documents('api::game-mode.game-mode');
      await gameModeService.update({
        documentId: gameMode.documentId,
        locale: 'en',
        data: { description: enDescription },
      } as any);

      await (gameModeService as any).publish({
        documentId: gameMode.documentId,
        locale: 'en',
      });

      log.info(`[GameModeDescription] Updated and published English description for: ${gameMode.name}`);
      englishDescriptionUpdated = true;
      spanishDescription = esDescription;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[GameModeDescription] AI description error for "${gameMode.name}": ${errorMessage}`);
    }
  } else {
    log.info(`[GameModeDescription] AI not configured, skipping description generation for: ${gameMode.name}`);
  }

  // ALWAYS sync locales
  try {

    const localeData: GameModeLocaleData = {
      documentId: gameMode.documentId,
      sourceId: gameMode.id,
      name: gameMode.name,
      gameModeData: {
        slug: gameMode.slug,
        igdbId: gameMode.igdbId,
      },
      aiDescription: spanishDescription,
      localizedName: spanishName,
    };

    const localeResults = await syncGameModeLocales(strapi, localeData);

    for (const localeResult of localeResults) {
      if (localeResult.success) {
        log.info(`[GameModeDescription] ${localeResult.locale.toUpperCase()} locale created for: ${gameMode.name}`);
      } else {
        log.error(`[GameModeDescription] Failed to create ${localeResult.locale.toUpperCase()} locale: ${localeResult.error}`);
      }
    }

    log.info(`[GameModeDescription] Completed processing for: ${gameMode.name}`);

    return {
      success: true,
      englishDescriptionUpdated,
      localesSynced: localeResults,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`[GameModeDescription] Locale sync error for "${gameMode.name}": ${errorMessage}`);
    
    return {
      success: false,
      englishDescriptionUpdated,
      localesSynced: [],
      error: errorMessage,
    };
  }
}

/**
 * Check if we should process this game mode event
 */
export function shouldProcessGameModeEvent(
  paramsLocale: string | undefined,
  resultLocale: string
): boolean {
  const locale = paramsLocale || resultLocale;
  return locale === 'en';
}

