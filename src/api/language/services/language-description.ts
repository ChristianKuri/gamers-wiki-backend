/**
 * Language Description Service
 * 
 * Handles generating AI descriptions for languages and syncing locales.
 * Extracted from lifecycle for testability.
 * 
 * IMPORTANT: Spanish descriptions are generated using the TRANSLATED name
 * so the AI writes "El **inglés** es..." not "El **English** es..."
 */

import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import type { LanguageDescriptionContext } from '../../../ai';
import type { LanguageLocaleData, LanguageLocaleSyncResult } from '../locale-sync';

/**
 * Common language name translations (English to Spanish)
 * These are the language names as they appear in game localization
 */
const LANGUAGE_TRANSLATIONS: Record<string, string> = {
  // Major gaming languages
  'English': 'Inglés',
  'Spanish': 'Español',
  'Japanese': 'Japonés',
  'French': 'Francés',
  'German': 'Alemán',
  'Italian': 'Italiano',
  'Portuguese': 'Portugués',
  'Brazilian Portuguese': 'Portugués brasileño',
  'Russian': 'Ruso',
  'Chinese': 'Chino',
  'Simplified Chinese': 'Chino simplificado',
  'Traditional Chinese': 'Chino tradicional',
  'Korean': 'Coreano',
  'Polish': 'Polaco',
  'Dutch': 'Neerlandés',
  'Swedish': 'Sueco',
  'Norwegian': 'Noruego',
  'Danish': 'Danés',
  'Finnish': 'Finlandés',
  'Turkish': 'Turco',
  'Arabic': 'Árabe',
  'Thai': 'Tailandés',
  'Vietnamese': 'Vietnamita',
  'Indonesian': 'Indonesio',
  'Czech': 'Checo',
  'Hungarian': 'Húngaro',
  'Greek': 'Griego',
  'Romanian': 'Rumano',
  'Ukrainian': 'Ucraniano',
  'Hindi': 'Hindi',
  'Hebrew': 'Hebreo',
  'Latin American Spanish': 'Español latinoamericano',
  'Castilian Spanish': 'Español castellano',
};

/**
 * Supported locales for description generation
 */
type SupportedLocale = 'en' | 'es';

/**
 * Get Spanish translation for a language name
 */
export function getSpanishLanguageName(englishName: string): string {
  return LANGUAGE_TRANSLATIONS[englishName] || englishName;
}

/**
 * Generate a Spanish slug from the localized name
 */
function generateSpanishSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .trim();
}

/**
 * Language data from the lifecycle event
 */
export interface LanguageEventData {
  id: number;
  documentId: string;
  locale: string;
  name: string;
  slug: string;
  description: string | null;
  nativeName: string | null;
  isoCode: string | null;
  igdbId: number | null;
}

/**
 * Dependencies that can be injected for testing
 */
export interface LanguageDescriptionDependencies {
  isAIConfigured: () => boolean;
  generateLanguageDescription: (context: LanguageDescriptionContext, locale: SupportedLocale) => Promise<string>;
  syncLanguageLocales: (strapi: Core.Strapi, data: LanguageLocaleData) => Promise<LanguageLocaleSyncResult[]>;
  log: {
    info: (message: string) => void;
    error: (message: string) => void;
    debug: (message: string) => void;
  };
}

/**
 * Result of the language description generation
 */
export interface LanguageDescriptionResult {
  success: boolean;
  englishDescriptionUpdated: boolean;
  localesSynced: LanguageLocaleSyncResult[];
  error?: string;
}

/**
 * Generate descriptions for a language and sync locales
 * 
 * IMPORTANT: Spanish description is generated using the TRANSLATED name
 * so the AI writes "El **inglés** es..." not "El **English** es..."
 */
export async function generateLanguageDescriptionsAndSync(
  _knex: Knex,
  strapi: Core.Strapi,
  language: LanguageEventData,
  deps: LanguageDescriptionDependencies
): Promise<LanguageDescriptionResult> {
  const { isAIConfigured, generateLanguageDescription, syncLanguageLocales, log } = deps;

  let englishDescriptionUpdated = false;
  let spanishDescription: string | null = null;

  // Get Spanish name FIRST - needed for Spanish description generation
  const spanishName = getSpanishLanguageName(language.name);

  // Generate AI descriptions if configured
  if (isAIConfigured()) {
    try {
      log.info(`[LanguageDescription] Generating AI descriptions for language: ${language.name}`);

      // Generate EN description with English name
      const enContext: LanguageDescriptionContext = {
        name: language.name,
        nativeName: language.nativeName,
        isoCode: language.isoCode,
      };
      const enDescription = await generateLanguageDescription(enContext, 'en');
      log.info(`[LanguageDescription] Generated EN description (length: ${enDescription.length})`);

      // Generate ES description with SPANISH name (translated)
      // This ensures the AI writes "El **inglés** es..." not "El **English** es..."
      const esContext: LanguageDescriptionContext = {
        name: spanishName,
        nativeName: language.nativeName,
        isoCode: language.isoCode,
      };
      const esDescription = await generateLanguageDescription(esContext, 'es');
      log.info(`[LanguageDescription] Generated ES description (length: ${esDescription.length}) using name: ${spanishName}`);

      // Update English entry
      const languageService = strapi.documents('api::language.language');
      await languageService.update({
        documentId: language.documentId,
        locale: 'en',
        data: { description: enDescription },
      } as any);

      await (languageService as any).publish({
        documentId: language.documentId,
        locale: 'en',
      });

      log.info(`[LanguageDescription] Updated and published English description for: ${language.name}`);
      englishDescriptionUpdated = true;
      spanishDescription = esDescription;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[LanguageDescription] AI description error for "${language.name}": ${errorMessage}`);
    }
  } else {
    log.info(`[LanguageDescription] AI not configured, skipping description generation for: ${language.name}`);
  }

  // ALWAYS sync locales
  try {
    const localeData: LanguageLocaleData = {
      documentId: language.documentId,
      sourceId: language.id,
      name: language.name,
      languageData: {
        slug: language.slug,
        nativeName: language.nativeName,
        isoCode: language.isoCode,
        igdbId: language.igdbId,
      },
      aiDescription: spanishDescription,
      localizedName: spanishName,
    };

    // Sync locales (create Spanish entry)
    const localeResults = await syncLanguageLocales(strapi, localeData);

    for (const localeResult of localeResults) {
      if (localeResult.success) {
        log.info(`[LanguageDescription] ${localeResult.locale.toUpperCase()} locale created for: ${language.name}`);
      } else {
        log.error(`[LanguageDescription] Failed to create ${localeResult.locale.toUpperCase()} locale: ${localeResult.error}`);
      }
    }

    log.info(`[LanguageDescription] Completed processing for: ${language.name}`);

    return {
      success: true,
      englishDescriptionUpdated,
      localesSynced: localeResults,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`[LanguageDescription] Locale sync error for "${language.name}": ${errorMessage}`);
    
    return {
      success: false,
      englishDescriptionUpdated,
      localesSynced: [],
      error: errorMessage,
    };
  }
}

/**
 * Check if we should process this language event
 * Only process English locale entries (base locale)
 */
export function shouldProcessLanguageEvent(
  paramsLocale: string | undefined,
  resultLocale: string
): boolean {
  const locale = paramsLocale || resultLocale;
  return locale === 'en';
}

