/**
 * Genre Description Service
 * 
 * Handles generating AI descriptions for genres and syncing locales.
 * Extracted from lifecycle for testability.
 * 
 * IMPORTANT: Spanish descriptions are generated using the TRANSLATED name
 * so the AI writes "El género **Acción**..." not "El género **Action**..."
 */

import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import type { GenreDescriptionContext } from '../../../ai';
import type { GenreLocaleData, GenreLocaleSyncResult } from '../locale-sync';

/**
 * Common genre name translations (English to Spanish)
 * Used for translating genre names
 */
const GENRE_TRANSLATIONS: Record<string, string> = {
  // Main genres
  'Action': 'Acción',
  'Adventure': 'Aventura',
  'Role-playing (RPG)': 'Rol (RPG)',
  'RPG': 'RPG',
  'Shooter': 'Disparos',
  'Simulation': 'Simulación',
  'Strategy': 'Estrategia',
  'Sports': 'Deportes',
  'Racing': 'Carreras',
  'Puzzle': 'Puzzle',
  'Platform': 'Plataformas',
  'Fighting': 'Lucha',
  'Horror': 'Terror',
  'Music': 'Música',
  'Arcade': 'Arcade',
  'Card & Board Game': 'Juegos de Cartas y Mesa',
  'Educational': 'Educativo',
  'Trivia': 'Trivia',
  'Pinball': 'Pinball',
  'Quiz': 'Quiz',
  'Visual Novel': 'Novela Visual',
  'Hack and slash/Beat \'em up': 'Hack and slash/Beat \'em up',
  'Point-and-click': 'Point-and-click',
  'Turn-based strategy (TBS)': 'Estrategia por turnos (TBS)',
  'Real Time Strategy (RTS)': 'Estrategia en tiempo real (RTS)',
  'Tactical': 'Táctico',
  'Indie': 'Indie',
  'MOBA': 'MOBA',
};

/**
 * Supported locales for description generation
 */
type SupportedLocale = 'en' | 'es';

/**
 * Get Spanish translation for a genre name
 */
export function getSpanishGenreName(englishName: string): string {
  return GENRE_TRANSLATIONS[englishName] || englishName;
}

/**
 * Genre data from the lifecycle event
 */
export interface GenreEventData {
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
export interface GenreDescriptionDependencies {
  isAIConfigured: () => boolean;
  generateGenreDescription: (context: GenreDescriptionContext, locale: SupportedLocale) => Promise<string>;
  syncGenreLocales: (strapi: Core.Strapi, data: GenreLocaleData) => Promise<GenreLocaleSyncResult[]>;
  log: {
    info: (message: string) => void;
    error: (message: string) => void;
    debug: (message: string) => void;
  };
}

/**
 * Result of the genre description generation
 */
export interface GenreDescriptionResult {
  success: boolean;
  englishDescriptionUpdated: boolean;
  localesSynced: GenreLocaleSyncResult[];
  error?: string;
}

/**
 * Generate descriptions for a genre and sync locales
 * 
 * IMPORTANT: Spanish description is generated using the TRANSLATED name
 * so the AI writes "El género **Acción**..." not "El género **Action**..."
 * 
 * @param knex - Database connection (unused but kept for consistency)
 * @param strapi - Strapi instance (for locale sync)
 * @param genre - Genre data from lifecycle event
 * @param deps - Injectable dependencies
 * @returns Result of the operation
 */
export async function generateGenreDescriptionsAndSync(
  _knex: Knex,
  strapi: Core.Strapi,
  genre: GenreEventData,
  deps: GenreDescriptionDependencies
): Promise<GenreDescriptionResult> {
  const { isAIConfigured, generateGenreDescription, syncGenreLocales, log } = deps;

  let englishDescriptionUpdated = false;
  let spanishDescription: string | null = null;

  // Get Spanish name FIRST - needed for Spanish description generation
  const spanishName = getSpanishGenreName(genre.name);

  // Generate AI descriptions if configured
  if (isAIConfigured()) {
    try {
      log.info(`[GenreDescription] Generating AI descriptions for genre: ${genre.name}`);

      // Generate EN description with English name
      const enContext: GenreDescriptionContext = {
        name: genre.name,
      };
      const enDescription = await generateGenreDescription(enContext, 'en');
      log.info(`[GenreDescription] Generated EN description (length: ${enDescription.length})`);

      // Generate ES description with SPANISH name (translated)
      // This ensures the AI writes "El género **Acción**..." not "El género **Action**..."
      const esContext: GenreDescriptionContext = {
        name: spanishName,
      };
      const esDescription = await generateGenreDescription(esContext, 'es');
      log.info(`[GenreDescription] Generated ES description (length: ${esDescription.length}) using name: ${spanishName}`);

      // Update English entry using Strapi's document service
      const genreService = strapi.documents('api::genre.genre');
      await genreService.update({
        documentId: genre.documentId,
        locale: 'en',
        data: { description: enDescription },
      } as any);

      // Publish to sync draft changes to published version
      await (genreService as any).publish({
        documentId: genre.documentId,
        locale: 'en',
      });

      log.info(`[GenreDescription] Updated and published English description for: ${genre.name}`);
      englishDescriptionUpdated = true;
      spanishDescription = esDescription;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[GenreDescription] AI description error for "${genre.name}": ${errorMessage}`);
      // Continue to locale sync even if AI fails
    }
  } else {
    log.info(`[GenreDescription] AI not configured, skipping description generation for: ${genre.name}`);
  }

  // ALWAYS sync locales (create Spanish entry) regardless of AI configuration
  // This ensures bidirectional relationships work correctly
  try {

    const localeData: GenreLocaleData = {
      documentId: genre.documentId,
      sourceId: genre.id,
      name: genre.name,
      genreData: {
        slug: genre.slug,
        igdbId: genre.igdbId,
      },
      aiDescription: spanishDescription,
      localizedName: spanishName,
    };

    // Sync locales (create Spanish entry)
    const localeResults = await syncGenreLocales(strapi, localeData);

    for (const localeResult of localeResults) {
      if (localeResult.success) {
        log.info(`[GenreDescription] ${localeResult.locale.toUpperCase()} locale created for: ${genre.name}`);
      } else {
        log.error(`[GenreDescription] Failed to create ${localeResult.locale.toUpperCase()} locale: ${localeResult.error}`);
      }
    }

    log.info(`[GenreDescription] Completed processing for: ${genre.name}`);

    return {
      success: true,
      englishDescriptionUpdated,
      localesSynced: localeResults,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`[GenreDescription] Locale sync error for "${genre.name}": ${errorMessage}`);
    
    return {
      success: false,
      englishDescriptionUpdated,
      localesSynced: [],
      error: errorMessage,
    };
  }
}

/**
 * Check if we should process this genre event
 * Only process English locale entries (base locale)
 */
export function shouldProcessGenreEvent(
  paramsLocale: string | undefined,
  resultLocale: string
): boolean {
  const locale = paramsLocale || resultLocale;
  return locale === 'en';
}

