import type { Core } from '@strapi/strapi';
import type { LanguageLocaleStrategy, LanguageLocaleData } from '../types';

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

    const created = await service.update({
      documentId: data.documentId,
      locale: 'es',
      data: {
        name: data.name,
        nativeName: data.languageData.nativeName,
        locale: data.languageData.locale,
        igdbId: data.languageData.igdbId,
      },
      status: 'published',
    } as any);

    strapi.log.info(`[LanguageLocaleSync:ES] Spanish locale entry created (id: ${created?.id}) for: ${data.name}`);

    await (service as any).publish({
      documentId: data.documentId,
      locale: 'es',
    });

    strapi.log.info(`[LanguageLocaleSync:ES] Spanish locale published for: ${data.name}`);
  },
};

