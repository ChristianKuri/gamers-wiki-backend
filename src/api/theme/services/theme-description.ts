/**
 * Theme Description Service
 * 
 * Handles generating AI descriptions for themes and syncing locales.
 * Extracted from lifecycle for testability.
 */

import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import type { ThemeDescriptionContext } from '../../../ai';
import type { ThemeLocaleData, ThemeLocaleSyncResult } from '../locale-sync';

/**
 * Common theme name translations (English to Spanish)
 * Used for translating theme names
 */
const THEME_TRANSLATIONS: Record<string, string> = {
  // Universal themes
  'Fantasy': 'Fantasía',
  'Science fiction': 'Ciencia ficción',
  'Sci-Fi': 'Ciencia ficción',
  'Horror': 'Terror',
  'Action': 'Acción',
  'Thriller': 'Suspense',
  'Survival': 'Supervivencia',
  'Historical': 'Histórico',
  'Steampunk': 'Steampunk',
  'Cyberpunk': 'Cyberpunk',
  'Post-apocalyptic': 'Post-apocalíptico',
  'Western': 'Oeste',
  'Comedy': 'Comedia',
  'Drama': 'Drama',
  'Mystery': 'Misterio',
  'Romance': 'Romance',
  'War': 'Guerra',
  'Warfare': 'Guerra',
  'Open world': 'Mundo abierto',
  'Sandbox': 'Sandbox',
  'Educational': 'Educativo',
  'Kids': 'Niños',
  'Business': 'Negocios',
  'Non-fiction': 'No ficción',
  'Erotic': 'Erótico',
  'Party': 'Fiesta',
  '4X (explore, expand, exploit, and exterminate)': '4X (explorar, expandir, explotar, exterminar)',
};

/**
 * Get Spanish translation for a theme name
 */
function getSpanishThemeName(englishName: string): string {
  return THEME_TRANSLATIONS[englishName] || englishName;
}

/**
 * Theme data from the lifecycle event
 */
export interface ThemeEventData {
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
export interface ThemeDescriptionDependencies {
  isAIConfigured: () => boolean;
  generateThemeDescriptions: (context: ThemeDescriptionContext) => Promise<{ en: string; es: string }>;
  syncThemeLocales: (strapi: Core.Strapi, data: ThemeLocaleData) => Promise<ThemeLocaleSyncResult[]>;
  log: {
    info: (message: string) => void;
    error: (message: string) => void;
    debug: (message: string) => void;
  };
}

/**
 * Result of the theme description generation
 */
export interface ThemeDescriptionResult {
  success: boolean;
  englishDescriptionUpdated: boolean;
  localesSynced: ThemeLocaleSyncResult[];
  error?: string;
}

/**
 * Generate descriptions for a theme and sync locales
 * 
 * @param knex - Database connection (unused but kept for consistency)
 * @param strapi - Strapi instance (for locale sync)
 * @param theme - Theme data from lifecycle event
 * @param deps - Injectable dependencies
 * @returns Result of the operation
 */
export async function generateThemeDescriptionsAndSync(
  _knex: Knex,
  strapi: Core.Strapi,
  theme: ThemeEventData,
  deps: ThemeDescriptionDependencies
): Promise<ThemeDescriptionResult> {
  const { isAIConfigured, generateThemeDescriptions, syncThemeLocales, log } = deps;

  let englishDescriptionUpdated = false;
  let spanishDescription: string | null = null;

  // Generate AI descriptions if configured
  if (isAIConfigured()) {
    try {
      log.info(`[ThemeDescription] Generating AI descriptions for theme: ${theme.name}`);

      // Build context for AI
      const context: ThemeDescriptionContext = {
        name: theme.name,
      };

      // Generate descriptions for both locales
      const descriptions = await generateThemeDescriptions(context);

      log.info(`[ThemeDescription] Generated EN description (length: ${descriptions.en.length})`);
      log.info(`[ThemeDescription] Generated ES description (length: ${descriptions.es.length})`);

      // Update English entry using Strapi's document service
      const themeService = strapi.documents('api::theme.theme');
      await themeService.update({
        documentId: theme.documentId,
        locale: 'en',
        data: { description: descriptions.en },
      } as any);

      // Publish to sync draft changes to published version
      await (themeService as any).publish({
        documentId: theme.documentId,
        locale: 'en',
      });

      log.info(`[ThemeDescription] Updated and published English description for: ${theme.name}`);
      englishDescriptionUpdated = true;
      spanishDescription = descriptions.es;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[ThemeDescription] AI description error for "${theme.name}": ${errorMessage}`);
      // Continue to locale sync even if AI fails
    }
  } else {
    log.info(`[ThemeDescription] AI not configured, skipping description generation for: ${theme.name}`);
  }

  // ALWAYS sync locales (create Spanish entry) regardless of AI configuration
  // This ensures bidirectional relationships work correctly
  try {
    // Get Spanish translation of the theme name
    const spanishName = getSpanishThemeName(theme.name);

    const localeData: ThemeLocaleData = {
      documentId: theme.documentId,
      sourceId: theme.id,
      name: theme.name,
      themeData: {
        slug: theme.slug,
        igdbId: theme.igdbId,
      },
      aiDescription: spanishDescription,
      localizedName: spanishName,
    };

    // Sync locales (create Spanish entry)
    const localeResults = await syncThemeLocales(strapi, localeData);

    for (const localeResult of localeResults) {
      if (localeResult.success) {
        log.info(`[ThemeDescription] ${localeResult.locale.toUpperCase()} locale created for: ${theme.name}`);
      } else {
        log.error(`[ThemeDescription] Failed to create ${localeResult.locale.toUpperCase()} locale: ${localeResult.error}`);
      }
    }

    log.info(`[ThemeDescription] Completed processing for: ${theme.name}`);

    return {
      success: true,
      englishDescriptionUpdated,
      localesSynced: localeResults,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`[ThemeDescription] Locale sync error for "${theme.name}": ${errorMessage}`);
    
    return {
      success: false,
      englishDescriptionUpdated,
      localesSynced: [],
      error: errorMessage,
    };
  }
}

/**
 * Check if we should process this theme event
 * Only process English locale entries (base locale)
 */
export function shouldProcessThemeEvent(
  paramsLocale: string | undefined,
  resultLocale: string
): boolean {
  const locale = paramsLocale || resultLocale;
  return locale === 'en';
}

