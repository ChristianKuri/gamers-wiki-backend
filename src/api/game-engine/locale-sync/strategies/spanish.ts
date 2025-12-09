import type { Core } from '@strapi/strapi';
import type { GameEngineLocaleStrategy, GameEngineLocaleData } from '../types';

export const spanishGameEngineLocaleStrategy: GameEngineLocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: GameEngineLocaleData): Promise<void> {
    const service = strapi.documents('api::game-engine.game-engine');

    const existing = await service.findOne({
      documentId: data.documentId,
      locale: 'es',
    });

    if (existing) {
      strapi.log.info(`[GameEngineLocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    const created = await service.update({
      documentId: data.documentId,
      locale: 'es',
      data: {
        name: data.name,
        slug: data.gameEngineData.slug,
        description: data.gameEngineData.description,
        logoUrl: data.gameEngineData.logoUrl,
        igdbId: data.gameEngineData.igdbId,
      },
      status: 'published',
    } as any);

    strapi.log.info(`[GameEngineLocaleSync:ES] Spanish locale entry created (id: ${created?.id}) for: ${data.name}`);

    await (service as any).publish({
      documentId: data.documentId,
      locale: 'es',
    });

    strapi.log.info(`[GameEngineLocaleSync:ES] Spanish locale published for: ${data.name}`);
  },
};

