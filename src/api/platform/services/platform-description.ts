/**
 * Platform Description Service
 * 
 * Handles generating AI descriptions for platforms and syncing locales.
 * Extracted from lifecycle for testability.
 */

import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import type { PlatformDescriptionContext } from '../../../ai';
import type { PlatformLocaleData, PlatformLocaleSyncResult } from '../locale-sync';

/**
 * Platform data from the lifecycle event
 */
export interface PlatformEventData {
  id: number;
  documentId: string;
  locale: string;
  name: string;
  slug: string;
  abbreviation: string | null;
  manufacturer: string | null;
  releaseYear: number | null;
  category: string | null;
  igdbId: number | null;
  logoUrl: string | null;
  generation: number | null;
}

/**
 * Dependencies that can be injected for testing
 */
export interface PlatformDescriptionDependencies {
  isAIConfigured: () => boolean;
  generatePlatformDescriptions: (context: PlatformDescriptionContext) => Promise<{ en: string; es: string }>;
  syncPlatformLocales: (strapi: Core.Strapi, data: PlatformLocaleData) => Promise<PlatformLocaleSyncResult[]>;
  log: {
    info: (message: string) => void;
    error: (message: string) => void;
    debug: (message: string) => void;
  };
}

/**
 * Result of the platform description generation
 */
export interface PlatformDescriptionResult {
  success: boolean;
  englishDescriptionUpdated: boolean;
  localesSynced: PlatformLocaleSyncResult[];
  error?: string;
}

/**
 * Generate descriptions for a platform and sync locales
 * 
 * @param knex - Database connection
 * @param strapi - Strapi instance (for locale sync)
 * @param platform - Platform data from lifecycle event
 * @param deps - Injectable dependencies
 * @returns Result of the operation
 */
export async function generatePlatformDescriptionsAndSync(
  knex: Knex,
  strapi: Core.Strapi,
  platform: PlatformEventData,
  deps: PlatformDescriptionDependencies
): Promise<PlatformDescriptionResult> {
  const { isAIConfigured, generatePlatformDescriptions, syncPlatformLocales, log } = deps;

  // Check if AI is configured
  if (!isAIConfigured()) {
    log.info(`[PlatformDescription] AI not configured, skipping description generation`);
    return {
      success: true,
      englishDescriptionUpdated: false,
      localesSynced: [],
    };
  }

  try {
    log.info(`[PlatformDescription] Generating AI descriptions for platform: ${platform.name}`);

    // Build context for AI
    const context: PlatformDescriptionContext = {
      name: platform.name,
      manufacturer: platform.manufacturer,
      releaseYear: platform.releaseYear,
      category: platform.category,
      generation: platform.generation,
      abbreviation: platform.abbreviation,
    };

    // Generate descriptions for both locales
    const descriptions = await generatePlatformDescriptions(context);

    log.info(`[PlatformDescription] Generated EN description (length: ${descriptions.en.length})`);
    log.info(`[PlatformDescription] Generated ES description (length: ${descriptions.es.length})`);

    // Update English entry using Strapi's document service (not raw SQL)
    const platformService = strapi.documents('api::platform.platform');
    await platformService.update({
      documentId: platform.documentId,
      locale: 'en',
      data: { description: descriptions.en },
    });

    // Publish the English entry so it's not stuck in "Modified" state
    await platformService.publish({
      documentId: platform.documentId,
      locale: 'en',
    });

    log.info(`[PlatformDescription] Updated and published English description for: ${platform.name}`);

    // Prepare data for locale sync
    const localeData: PlatformLocaleData = {
      documentId: platform.documentId,
      sourceId: platform.id,
      name: platform.name,
      platformData: {
        slug: platform.slug,
        abbreviation: platform.abbreviation,
        manufacturer: platform.manufacturer,
        releaseYear: platform.releaseYear,
        category: platform.category,
        igdbId: platform.igdbId,
        logoUrl: platform.logoUrl,
        generation: platform.generation,
      },
      aiDescription: descriptions.es,
    };

    // Sync locales (create Spanish entry with AI description)
    const localeResults = await syncPlatformLocales(strapi, localeData);

    for (const localeResult of localeResults) {
      if (localeResult.success) {
        log.info(`[PlatformDescription] ${localeResult.locale.toUpperCase()} locale created for: ${platform.name}`);
      } else {
        log.error(`[PlatformDescription] Failed to create ${localeResult.locale.toUpperCase()} locale: ${localeResult.error}`);
      }
    }

    log.info(`[PlatformDescription] Completed AI description generation for: ${platform.name}`);

    return {
      success: true,
      englishDescriptionUpdated: true,
      localesSynced: localeResults,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`[PlatformDescription] AI description error for "${platform.name}": ${errorMessage}`);
    
    return {
      success: false,
      englishDescriptionUpdated: false,
      localesSynced: [],
      error: errorMessage,
    };
  }
}

/**
 * Check if we should process this platform event
 * Only process English locale entries (base locale)
 */
export function shouldProcessPlatformEvent(
  paramsLocale: string | undefined,
  resultLocale: string
): boolean {
  const locale = paramsLocale || resultLocale;
  return locale === 'en';
}

