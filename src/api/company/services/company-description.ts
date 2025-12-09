/**
 * Company Description Service
 * 
 * Handles generating AI descriptions for companies and syncing locales.
 * Extracted from lifecycle for testability.
 */

import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import type { CompanyDescriptionContext } from '../../../ai';
import type { CompanyLocaleData, CompanyLocaleSyncResult } from '../locale-sync';

/**
 * Company data from the lifecycle event
 */
export interface CompanyEventData {
  id: number;
  documentId: string;
  locale: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  country: string | null;
  foundedYear: number | null;
  igdbId: number | null;
  igdbUrl: string | null;
}

/**
 * Dependencies that can be injected for testing
 */
export interface CompanyDescriptionDependencies {
  isAIConfigured: () => boolean;
  generateCompanyDescriptions: (context: CompanyDescriptionContext) => Promise<{ en: string; es: string }>;
  syncCompanyLocales: (strapi: Core.Strapi, data: CompanyLocaleData) => Promise<CompanyLocaleSyncResult[]>;
  log: {
    info: (message: string) => void;
    error: (message: string) => void;
    debug: (message: string) => void;
  };
}

/**
 * Result of the company description generation
 */
export interface CompanyDescriptionResult {
  success: boolean;
  englishDescriptionUpdated: boolean;
  localesSynced: CompanyLocaleSyncResult[];
  error?: string;
}

/**
 * Generate descriptions for a company and sync locales
 * 
 * @param knex - Database connection
 * @param strapi - Strapi instance (for locale sync)
 * @param company - Company data from lifecycle event
 * @param deps - Injectable dependencies
 * @returns Result of the operation
 */
export async function generateCompanyDescriptionsAndSync(
  knex: Knex,
  strapi: Core.Strapi,
  company: CompanyEventData,
  deps: CompanyDescriptionDependencies
): Promise<CompanyDescriptionResult> {
  const { isAIConfigured, generateCompanyDescriptions, syncCompanyLocales, log } = deps;

  let englishDescriptionUpdated = false;
  let spanishDescription: string | null = null;

  // Generate AI descriptions if configured
  if (isAIConfigured()) {
    try {
      log.info(`[CompanyDescription] Generating AI descriptions for company: ${company.name}`);

      // Build context for AI
      const context: CompanyDescriptionContext = {
        name: company.name,
        country: company.country,
        foundedYear: company.foundedYear,
      };

      // Generate descriptions for both locales
      const descriptions = await generateCompanyDescriptions(context);

      log.info(`[CompanyDescription] Generated EN description (length: ${descriptions.en.length})`);
      log.info(`[CompanyDescription] Generated ES description (length: ${descriptions.es.length})`);

      // Update English entry using Strapi's document service (not raw SQL)
      const companyService = strapi.documents('api::company.company');
      await companyService.update({
        documentId: company.documentId,
        locale: 'en',
        data: { description: descriptions.en },
      } as any);

      // Publish to sync draft changes to published version
      await (companyService as any).publish({
        documentId: company.documentId,
        locale: 'en',
      });

      log.info(`[CompanyDescription] Updated and published English description for: ${company.name}`);
      englishDescriptionUpdated = true;
      spanishDescription = descriptions.es;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[CompanyDescription] AI description error for "${company.name}": ${errorMessage}`);
      // Continue to locale sync even if AI fails
    }
  } else {
    log.info(`[CompanyDescription] AI not configured, skipping description generation for: ${company.name}`);
  }

  // ALWAYS sync locales (create Spanish entry) regardless of AI configuration
  // This ensures bidirectional relationships work correctly
  try {
    const localeData: CompanyLocaleData = {
      documentId: company.documentId,
      sourceId: company.id,
      name: company.name,
      companyData: {
        slug: company.slug,
        logoUrl: company.logoUrl,
        country: company.country,
        foundedYear: company.foundedYear,
        igdbId: company.igdbId,
        igdbUrl: company.igdbUrl,
      },
      aiDescription: spanishDescription,
    };

    // Sync locales (create Spanish entry)
    const localeResults = await syncCompanyLocales(strapi, localeData);

    for (const localeResult of localeResults) {
      if (localeResult.success) {
        log.info(`[CompanyDescription] ${localeResult.locale.toUpperCase()} locale created for: ${company.name}`);
      } else {
        log.error(`[CompanyDescription] Failed to create ${localeResult.locale.toUpperCase()} locale: ${localeResult.error}`);
      }
    }

    log.info(`[CompanyDescription] Completed processing for: ${company.name}`);

    return {
      success: true,
      englishDescriptionUpdated,
      localesSynced: localeResults,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`[CompanyDescription] Locale sync error for "${company.name}": ${errorMessage}`);
    
    return {
      success: false,
      englishDescriptionUpdated,
      localesSynced: [],
      error: errorMessage,
    };
  }
}

/**
 * Check if we should process this company event
 * Only process English locale entries (base locale)
 */
export function shouldProcessCompanyEvent(
  paramsLocale: string | undefined,
  resultLocale: string
): boolean {
  const locale = paramsLocale || resultLocale;
  return locale === 'en';
}

