/**
 * Collection Description Service
 * 
 * Handles generating AI descriptions for collections and syncing locales.
 * Extracted from lifecycle for testability.
 */

import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import type { CollectionDescriptionContext } from '../../../ai';
import type { CollectionLocaleData, CollectionLocaleSyncResult } from '../locale-sync';

/**
 * Collection data from the lifecycle event
 */
export interface CollectionEventData {
  id: number;
  documentId: string;
  locale: string;
  name: string;
  slug: string;
  description: string | null;
  igdbId: number | null;
  igdbUrl: string | null;
  parentCollectionDocumentId: string | null;
}

/**
 * Dependencies that can be injected for testing
 */
export interface CollectionDescriptionDependencies {
  isAIConfigured: () => boolean;
  generateCollectionDescriptions: (context: CollectionDescriptionContext) => Promise<{ en: string; es: string }>;
  syncCollectionLocales: (strapi: Core.Strapi, data: CollectionLocaleData) => Promise<CollectionLocaleSyncResult[]>;
  log: {
    info: (message: string) => void;
    error: (message: string) => void;
    debug: (message: string) => void;
  };
}

/**
 * Result of the collection description generation
 */
export interface CollectionDescriptionResult {
  success: boolean;
  englishDescriptionUpdated: boolean;
  localesSynced: CollectionLocaleSyncResult[];
  error?: string;
}

/**
 * Generate descriptions for a collection and sync locales
 * 
 * @param knex - Database connection
 * @param strapi - Strapi instance (for locale sync)
 * @param collection - Collection data from lifecycle event
 * @param deps - Injectable dependencies
 * @returns Result of the operation
 */
export async function generateCollectionDescriptionsAndSync(
  knex: Knex,
  strapi: Core.Strapi,
  collection: CollectionEventData,
  deps: CollectionDescriptionDependencies
): Promise<CollectionDescriptionResult> {
  const { isAIConfigured, generateCollectionDescriptions, syncCollectionLocales, log } = deps;

  // Check if AI is configured
  if (!isAIConfigured()) {
    log.info(`[CollectionDescription] AI not configured, skipping description generation`);
    return {
      success: true,
      englishDescriptionUpdated: false,
      localesSynced: [],
    };
  }

  try {
    log.info(`[CollectionDescription] Generating AI descriptions for collection: ${collection.name}`);

    // Build context for AI
    // Optionally fetch parent collection name for more context
    let parentCollectionName: string | null = null;
    if (collection.parentCollectionDocumentId) {
      const parentCollection = await knex('collections')
        .where({ document_id: collection.parentCollectionDocumentId, locale: 'en' })
        .select('name')
        .first();
      parentCollectionName = parentCollection?.name || null;
    }

    const context: CollectionDescriptionContext = {
      name: collection.name,
      parentCollectionName,
      // These fields could be populated by querying the games relation
      // if we want more context. For now, let the AI work with the name.
    };

    // Generate descriptions for both locales in parallel
    const descriptions = await generateCollectionDescriptions(context);

    log.info(`[CollectionDescription] Generated EN description (length: ${descriptions.en.length})`);
    log.info(`[CollectionDescription] Generated ES description (length: ${descriptions.es.length})`);

    // Update English entry using Strapi's document service (not raw SQL)
    const collectionService = strapi.documents('api::collection.collection');
    await collectionService.update({
      documentId: collection.documentId,
      locale: 'en',
      data: { description: descriptions.en },
    });

    // Publish the English entry so it's not stuck in "Modified" state
    await collectionService.publish({
      documentId: collection.documentId,
      locale: 'en',
    });

    log.info(`[CollectionDescription] Updated and published English description for: ${collection.name}`);

    // Prepare data for locale sync
    const localeData: CollectionLocaleData = {
      documentId: collection.documentId,
      sourceId: collection.id,
      name: collection.name,
      collectionData: {
        slug: collection.slug,
        igdbId: collection.igdbId,
        igdbUrl: collection.igdbUrl,
        parentCollectionDocumentId: collection.parentCollectionDocumentId,
      },
      aiDescription: descriptions.es,
    };

    // Sync locales (create Spanish entry with AI description)
    const localeResults = await syncCollectionLocales(strapi, localeData);

    for (const localeResult of localeResults) {
      if (localeResult.success) {
        log.info(`[CollectionDescription] ${localeResult.locale.toUpperCase()} locale created for: ${collection.name}`);
      } else {
        log.error(`[CollectionDescription] Failed to create ${localeResult.locale.toUpperCase()} locale: ${localeResult.error}`);
      }
    }

    log.info(`[CollectionDescription] Completed AI description generation for: ${collection.name}`);

    return {
      success: true,
      englishDescriptionUpdated: true,
      localesSynced: localeResults,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`[CollectionDescription] AI description error for "${collection.name}": ${errorMessage}`);
    
    return {
      success: false,
      englishDescriptionUpdated: false,
      localesSynced: [],
      error: errorMessage,
    };
  }
}

/**
 * Check if we should process this collection event
 * Only process English locale entries (base locale)
 */
export function shouldProcessCollectionEvent(
  paramsLocale: string | undefined,
  resultLocale: string
): boolean {
  const locale = paramsLocale || resultLocale;
  return locale === 'en';
}

