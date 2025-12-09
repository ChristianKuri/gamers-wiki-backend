import type { Core } from '@strapi/strapi';
import type { PlayerPerspectiveLocaleStrategy, PlayerPerspectiveLocaleData } from '../types';

export const spanishPlayerPerspectiveLocaleStrategy: PlayerPerspectiveLocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: PlayerPerspectiveLocaleData): Promise<void> {
    const service = strapi.documents('api::player-perspective.player-perspective');

    const existing = await service.findOne({
      documentId: data.documentId,
      locale: 'es',
    });

    if (existing) {
      strapi.log.info(`[PlayerPerspectiveLocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    const created = await service.update({
      documentId: data.documentId,
      locale: 'es',
      data: {
        name: data.name,
        slug: data.playerPerspectiveData.slug,
        igdbId: data.playerPerspectiveData.igdbId,
      },
      status: 'published',
    } as any);

    strapi.log.info(`[PlayerPerspectiveLocaleSync:ES] Spanish locale entry created (id: ${created?.id}) for: ${data.name}`);

    await (service as any).publish({
      documentId: data.documentId,
      locale: 'es',
    });

    strapi.log.info(`[PlayerPerspectiveLocaleSync:ES] Spanish locale published for: ${data.name}`);
  },
};

