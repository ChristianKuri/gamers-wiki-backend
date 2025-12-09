/**
 * Theme Description Service
 * 
 * Handles generating AI descriptions for themes and syncing locales.
 * Extracted from lifecycle for testability.
 * 
 * IMPORTANT: Spanish descriptions are generated using the TRANSLATED name
 * so the AI writes "El tema **Fantasía**..." not "El tema **Fantasy**..."
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
 * Supported locales for description generation
 */
type SupportedLocale = 'en' | 'es';

/**
 * Get Spanish translation for a theme name
 */
export function getSpanishThemeName(englishName: string): string {
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
  generateThemeDescription: (context: ThemeDescriptionContext, locale: SupportedLocale) => Promise<string>;
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
 * IMPORTANT: Spanish description is generated using the TRANSLATED name
 * so the AI writes "El tema **Fantasía**..." not "El tema **Fantasy**..."
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
  const { isAIConfigured, generateThemeDescription, syncThemeLocales, log } = deps;

  let englishDescriptionUpdated = false;
  let spanishDescription: string | null = null;

  // Get Spanish name FIRST - needed for Spanish description generation
  const spanishName = getSpanishThemeName(theme.name);

  // Generate AI descriptions if configured
  if (isAIConfigured()) {
    try {
      log.info(`[ThemeDescription] Generating AI descriptions for theme: ${theme.name}`);

      // Generate EN description with English name
      const enContext: ThemeDescriptionContext = {
        name: theme.name,
      };
      const enDescription = await generateThemeDescription(enContext, 'en');
      log.info(`[ThemeDescription] Generated EN description (length: ${enDescription.length})`);

      // Generate ES description with SPANISH name (translated)
      // This ensures the AI writes "El tema **Fantasía**..." not "El tema **Fantasy**..."
      const esContext: ThemeDescriptionContext = {
        name: spanishName,
      };
      const esDescription = await generateThemeDescription(esContext, 'es');
      log.info(`[ThemeDescription] Generated ES description (length: ${esDescription.length}) using name: ${spanishName}`);

      // Update English entry using Strapi's document service
      const themeService = strapi.documents('api::theme.theme');
      await themeService.update({
        documentId: theme.documentId,
        locale: 'en',
        data: { description: enDescription },
      } as any);

      // Publish to sync draft changes to published version
      await (themeService as any).publish({
        documentId: theme.documentId,
        locale: 'en',
      });

      log.info(`[ThemeDescription] Updated and published English description for: ${theme.name}`);
      englishDescriptionUpdated = true;
      spanishDescription = esDescription;
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

