/**
 * Franchise Description Service
 * 
 * Handles generating AI descriptions for franchises and syncing locales.
 * Extracted from lifecycle for testability.
 */

import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import type { FranchiseDescriptionContext } from '../../../ai';
import type { FranchiseLocaleData, FranchiseLocaleSyncResult } from '../locale-sync';

/**
 * Franchise data from the lifecycle event
 */
export interface FranchiseEventData {
  id: number;
  documentId: string;
  locale: string;
  name: string;
  slug: string;
  description: string | null;
  igdbId: number | null;
  igdbUrl: string | null;
}

/**
 * Dependencies that can be injected for testing
 */
export interface FranchiseDescriptionDependencies {
  isAIConfigured: () => boolean;
  generateFranchiseDescriptions: (context: FranchiseDescriptionContext) => Promise<{ en: string; es: string }>;
  syncFranchiseLocales: (strapi: Core.Strapi, data: FranchiseLocaleData) => Promise<FranchiseLocaleSyncResult[]>;
  log: {
    info: (message: string) => void;
    error: (message: string) => void;
    debug: (message: string) => void;
  };
}

/**
 * Result of the franchise description generation
 */
export interface FranchiseDescriptionResult {
  success: boolean;
  englishDescriptionUpdated: boolean;
  localesSynced: FranchiseLocaleSyncResult[];
  error?: string;
}

/**
 * Generate descriptions for a franchise and sync locales
 * 
 * @param knex - Database connection
 * @param strapi - Strapi instance (for locale sync)
 * @param franchise - Franchise data from lifecycle event
 * @param deps - Injectable dependencies
 * @returns Result of the operation
 */
export async function generateFranchiseDescriptionsAndSync(
  knex: Knex,
  strapi: Core.Strapi,
  franchise: FranchiseEventData,
  deps: FranchiseDescriptionDependencies
): Promise<FranchiseDescriptionResult> {
  const { isAIConfigured, generateFranchiseDescriptions, syncFranchiseLocales, log } = deps;

  let englishDescriptionUpdated = false;
  let spanishDescription: string | null = null;

  // Generate AI descriptions if configured
  if (isAIConfigured()) {
    try {
      log.info(`[FranchiseDescription] Generating AI descriptions for franchise: ${franchise.name}`);

      // Build context for AI
      const context: FranchiseDescriptionContext = {
        name: franchise.name,
      };

      // Generate descriptions for both locales in parallel
      const descriptions = await generateFranchiseDescriptions(context);

      log.info(`[FranchiseDescription] Generated EN description (length: ${descriptions.en.length})`);
      log.info(`[FranchiseDescription] Generated ES description (length: ${descriptions.es.length})`);

      // Update English entry using Strapi's document service (not raw SQL)
      const franchiseService = strapi.documents('api::franchise.franchise');
      await franchiseService.update({
        documentId: franchise.documentId,
        locale: 'en',
        data: { description: descriptions.en },
      } as any);

      // Publish to sync draft changes to published version
      await (franchiseService as any).publish({
        documentId: franchise.documentId,
        locale: 'en',
      });

      log.info(`[FranchiseDescription] Updated and published English description for: ${franchise.name}`);
      englishDescriptionUpdated = true;
      spanishDescription = descriptions.es;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[FranchiseDescription] AI description error for "${franchise.name}": ${errorMessage}`);
      // Continue to locale sync even if AI fails
    }
  } else {
    log.info(`[FranchiseDescription] AI not configured, skipping description generation for: ${franchise.name}`);
  }

  // ALWAYS sync locales (create Spanish entry) regardless of AI configuration
  // This ensures bidirectional relationships work correctly
  try {
    const localeData: FranchiseLocaleData = {
      documentId: franchise.documentId,
      sourceId: franchise.id,
      name: franchise.name,
      franchiseData: {
        slug: franchise.slug,
        igdbId: franchise.igdbId,
        igdbUrl: franchise.igdbUrl,
      },
      aiDescription: spanishDescription,
    };

    // Sync locales (create Spanish entry)
    const localeResults = await syncFranchiseLocales(strapi, localeData);

    for (const localeResult of localeResults) {
      if (localeResult.success) {
        log.info(`[FranchiseDescription] ${localeResult.locale.toUpperCase()} locale created for: ${franchise.name}`);
      } else {
        log.error(`[FranchiseDescription] Failed to create ${localeResult.locale.toUpperCase()} locale: ${localeResult.error}`);
      }
    }

    log.info(`[FranchiseDescription] Completed processing for: ${franchise.name}`);

    return {
      success: true,
      englishDescriptionUpdated,
      localesSynced: localeResults,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`[FranchiseDescription] Locale sync error for "${franchise.name}": ${errorMessage}`);
    
    return {
      success: false,
      englishDescriptionUpdated,
      localesSynced: [],
      error: errorMessage,
    };
  }
}

/**
 * Check if we should process this franchise event
 * Only process English locale entries (base locale)
 */
export function shouldProcessFranchiseEvent(
  paramsLocale: string | undefined,
  resultLocale: string
): boolean {
  const locale = paramsLocale || resultLocale;
  return locale === 'en';
}

