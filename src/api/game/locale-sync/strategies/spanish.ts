import type { Core } from '@strapi/strapi';
import type { LocaleStrategy, GameLocaleData } from '../types';
import { copyAllRelations, generateSlug } from './base';

/**
 * Spanish (es) locale strategy
 * Creates Spanish locale entries for games using Strapi Document Service
 */
export const spanishLocaleStrategy: LocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: GameLocaleData): Promise<void> {
    const gameService = strapi.documents('api::game.game');

    // Get Spanish localized data
    const spanishData = data.localizedNames.es;
    const spanishName = spanishData.name;
    const spanishCoverUrl = spanishData.coverUrl;
    const spanishSlug = generateSlug(spanishName);

    // Check if Spanish locale already exists for this document
    const existing = await gameService.findOne({
      documentId: data.documentId,
      locale: 'es',
    });

    if (existing) {
      strapi.log.info(`[LocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    // Create Spanish locale entry using Document Service update()
    // In Strapi 5, update() with a new locale creates that locale version
    // Note: Relations are NOT included here - they are at document level, not entry level
    // Strapi handles relations automatically when creating locale versions
    const created = await gameService.update({
      documentId: data.documentId,
      locale: 'es',
      data: {
        name: spanishName,
        slug: spanishSlug,
        description: data.aiDescription || data.gameData.description,
        releaseDate: data.gameData.releaseDate,
        gameCategory: data.gameData.gameCategory,
        gameStatus: data.gameData.gameStatus,
        coverImageUrl: spanishCoverUrl || data.gameData.coverImageUrl,
        screenshotUrls: data.gameData.screenshotUrls,
        trailerIds: data.gameData.trailerIds,
        metacriticScore: data.gameData.metacriticScore,
        userRating: data.gameData.userRating,
        userRatingCount: data.gameData.userRatingCount,
        totalRating: data.gameData.totalRating,
        totalRatingCount: data.gameData.totalRatingCount,
        hypes: data.gameData.hypes,
        multiplayerModes: data.gameData.multiplayerModes,
        officialWebsite: data.gameData.officialWebsite,
        steamUrl: data.gameData.steamUrl,
        epicUrl: data.gameData.epicUrl,
        gogUrl: data.gameData.gogUrl,
        itchUrl: data.gameData.itchUrl,
        discordUrl: data.gameData.discordUrl,
        igdbId: data.gameData.igdbId,
        igdbUrl: data.gameData.igdbUrl,
      },
      status: 'published',
    } as any);

    strapi.log.info(`[LocaleSync:ES] Spanish locale entry created (id: ${created?.id})`);

    // Publish to sync draft to published
    await (gameService as any).publish({
      documentId: data.documentId,
      locale: 'es',
    });

    // Get the published ES entry ID for relation copying
    const publishedEs = await gameService.findOne({
      documentId: data.documentId,
      locale: 'es',
      status: 'published',
    });

    if (publishedEs) {
      // Copy relations to the Spanish locale entry using raw SQL
      // Relations are stored at the entry level, not document level
      const knex = strapi.db.connection;
      const entryId = typeof publishedEs.id === 'string' ? parseInt(publishedEs.id, 10) : publishedEs.id;
      const totalRelations = await copyAllRelations(knex, entryId, data.relationIds, 'es');
      strapi.log.info(`[LocaleSync:ES] Copied ${totalRelations} relations to Spanish entry`);
    }

    // Log success with details
    const englishName = data.localizedNames.en.name;
    if (spanishName !== englishName) {
      strapi.log.info(`[LocaleSync:ES] Spanish name: "${spanishName}" (localized from "${englishName}")`);
    }
    if (spanishCoverUrl && spanishCoverUrl !== data.gameData.coverImageUrl) {
      strapi.log.info(`[LocaleSync:ES] Spanish cover: ${spanishCoverUrl}`);
    }
    strapi.log.info(`[LocaleSync:ES] Spanish locale created and published`);
  },
};

