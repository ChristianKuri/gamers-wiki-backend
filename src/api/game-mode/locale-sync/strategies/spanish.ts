import type { Core } from '@strapi/strapi';
import type { GameModeLocaleStrategy, GameModeLocaleData } from '../types';
import { slugify } from '../../../../utils/slug';

/**
 * Spanish (es) locale strategy for game modes
 */
export const spanishGameModeLocaleStrategy: GameModeLocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: GameModeLocaleData): Promise<void> {
    const gameModeService = strapi.documents('api::game-mode.game-mode');

    const existing = await gameModeService.findOne({
      documentId: data.documentId,
      locale: 'es',
    });

    if (existing) {
      strapi.log.info(`[GameModeLocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    // Use localized name if provided, otherwise use original name
    const spanishName = data.localizedName || data.name;
    const spanishSlug = slugify(spanishName);

    const created = await gameModeService.update({
      documentId: data.documentId,
      locale: 'es',
      data: {
        name: spanishName,
        slug: spanishSlug,
        description: data.aiDescription,
        igdbId: data.gameModeData.igdbId,
      },
      status: 'published',
    } as any);

    strapi.log.info(`[GameModeLocaleSync:ES] Spanish locale entry created (id: ${created?.id}) for game mode: ${spanishName}`);

    // Update description separately if it exists
    if (data.aiDescription) {
      await gameModeService.update({
        documentId: data.documentId,
        locale: 'es',
        data: { description: data.aiDescription },
      } as any);
    }

    await (gameModeService as any).publish({
      documentId: data.documentId,
      locale: 'es',
    });

    strapi.log.info(`[GameModeLocaleSync:ES] Spanish locale published for game mode: ${spanishName}`);
  },
};

