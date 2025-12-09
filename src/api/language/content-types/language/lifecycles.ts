import type { Core } from '@strapi/strapi';
import { syncLanguageLocales } from '../../locale-sync';
import type { LanguageLocaleData } from '../../locale-sync';

// Note: The Language entity has a 'locale' field (ISO language code like "en-US")
// which conflicts with Strapi's internal 'locale' field.
// In the lifecycle result, both are present - we use params.locale for Strapi's locale
// and access the Language's locale via result (it's there under the same name).
interface LanguageLifecycleEvent {
  result: {
    id: number;
    documentId: string;
    name: string;
    nativeName: string | null;
    igdbId: number | null;
    [key: string]: unknown;
  };
  params: {
    data: Record<string, unknown>;
    locale?: string;
    [key: string]: unknown;
  };
}

export default {
  async afterCreate(event: LanguageLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;

    // Use params.locale for Strapi's locale (en/es)
    const strapiLocale = params.locale || (result as any).locale;
    if (strapiLocale !== 'en') {
      strapi.log.debug(`[Language:Lifecycle] Skipping non-English locale: ${strapiLocale}`);
      return;
    }

    strapi.log.info(`[Language:Lifecycle] Created: "${result.name}" - documentId: ${result.documentId}`);

    // The Language entity's 'locale' field (ISO code) is accessed from result
    // It's in the result object alongside other fields
    const languageIsoLocale = (result as any).locale as string | null;

    const localeData: LanguageLocaleData = {
      documentId: result.documentId,
      sourceId: result.id,
      name: result.name,
      languageData: {
        nativeName: result.nativeName,
        locale: languageIsoLocale,
        igdbId: result.igdbId,
      },
    };

    try {
      await syncLanguageLocales(strapi, localeData);
      strapi.log.info(`[Language:Lifecycle] Completed locale sync for: ${result.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[Language:Lifecycle] Locale sync failed for "${result.name}": ${errorMessage}`);
    }
  },
};

