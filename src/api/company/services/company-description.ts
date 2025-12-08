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

  // Check if AI is configured
  if (!isAIConfigured()) {
    log.info(`[CompanyDescription] AI not configured, skipping description generation`);
    return {
      success: true,
      englishDescriptionUpdated: false,
      localesSynced: [],
    };
  }

  try {
    log.info(`[CompanyDescription] Generating AI descriptions for company: ${company.name}`);

    // Build context for AI
    const context: CompanyDescriptionContext = {
      name: company.name,
      country: company.country,
      foundedYear: company.foundedYear,
      // Note: We could enhance this with notable games, but that would require
      // additional queries. For now, let the AI work with what we have.
      // isDeveloper and isPublisher could be determined by checking relations,
      // but that adds complexity. The AI will make reasonable assumptions.
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
    });

    // Publish the English entry so it's not stuck in "Modified" state
    await companyService.publish({
      documentId: company.documentId,
      locale: 'en',
    });

    log.info(`[CompanyDescription] Updated and published English description for: ${company.name}`);

    // Prepare data for locale sync
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
      aiDescription: descriptions.es,
    };

    // Sync locales (create Spanish entry with AI description)
    const localeResults = await syncCompanyLocales(strapi, localeData);

    for (const localeResult of localeResults) {
      if (localeResult.success) {
        log.info(`[CompanyDescription] ${localeResult.locale.toUpperCase()} locale created for: ${company.name}`);
      } else {
        log.error(`[CompanyDescription] Failed to create ${localeResult.locale.toUpperCase()} locale: ${localeResult.error}`);
      }
    }

    log.info(`[CompanyDescription] Completed AI description generation for: ${company.name}`);

    return {
      success: true,
      englishDescriptionUpdated: true,
      localesSynced: localeResults,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`[CompanyDescription] AI description error for "${company.name}": ${errorMessage}`);
    
    return {
      success: false,
      englishDescriptionUpdated: false,
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

