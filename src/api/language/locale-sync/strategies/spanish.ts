import type { Core } from '@strapi/strapi';
import type { LanguageLocaleStrategy, LanguageLocaleData } from '../types';

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

export const spanishLanguageLocaleStrategy: LanguageLocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: LanguageLocaleData): Promise<void> {
    const service = strapi.documents('api::language.language');

    const existing = await service.findOne({
      documentId: data.documentId,
      locale: 'es',
    });

    if (existing) {
      strapi.log.info(`[LanguageLocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    // Use localized name if provided, otherwise fall back to original name
    const spanishName = data.localizedName || data.name;
    // Generate Spanish slug from the Spanish name
    const spanishSlug = generateSpanishSlug(spanishName);

    const created = await service.update({
      documentId: data.documentId,
      locale: 'es',
      data: {
        name: spanishName,
        slug: spanishSlug,
        nativeName: data.languageData.nativeName,
        isoCode: data.languageData.isoCode,
        igdbId: data.languageData.igdbId,
        ...(data.aiDescription && { description: data.aiDescription }),
      },
      status: 'published',
    } as any);

    strapi.log.info(`[LanguageLocaleSync:ES] Spanish locale entry created (id: ${created?.id}) for: ${spanishName}`);

    await (service as any).publish({
      documentId: data.documentId,
      locale: 'es',
    });

    strapi.log.info(`[LanguageLocaleSync:ES] Spanish locale published for: ${spanishName}`);
  },
};

