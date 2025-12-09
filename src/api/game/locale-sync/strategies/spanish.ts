import type { Core } from '@strapi/strapi';
import type { LocaleStrategy, GameLocaleData } from '../types';
import { generateSlug } from './base';

/**
 * Spanish (es) locale strategy
 * Creates Spanish locale entries for games using Strapi Document Service.
 * 
 * RELATIONS:
 * Uses Document Service `connect` with shorthand syntax (just document IDs).
 * This works when all related entities (Theme, Keyword, etc.) have ES locales.
 * 
 * ⚠️ CURRENT STATUS:
 * This strategy FAILS if any related entity doesn't have an ES locale because
 * Strapi's Document Service requires related entities to have the same locale.
 * 
 * Error: "Document with id X, locale 'es' not found"
 * 
 * FIX REQUIRED:
 * Implement locale sync for: Theme, Keyword, GameMode, PlayerPerspective,
 * Language, AgeRating, GameEngine. Once all entities have ES locales created
 * via their lifecycle hooks (which run BEFORE this game locale sync),
 * the Document Service connect will work and both draft/published will have
 * identical relations.
 * 
 * See: docs/locale-sync-implementation-guide.md
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

    // Build relations using shorthand syntax (just document IDs)
    // Strapi will connect to the default locale (EN) of related entities
    const relations: Record<string, { connect: string[] }> = {};
    
    if (data.relationIds.platforms.length > 0) {
      relations.platforms = { connect: data.relationIds.platforms };
    }
    if (data.relationIds.developers.length > 0) {
      relations.developers = { connect: data.relationIds.developers };
    }
    if (data.relationIds.publishers.length > 0) {
      relations.publishers = { connect: data.relationIds.publishers };
    }
    if (data.relationIds.franchises.length > 0) {
      relations.franchises = { connect: data.relationIds.franchises };
    }
    if (data.relationIds.collections.length > 0) {
      relations.collections = { connect: data.relationIds.collections };
    }
    if (data.relationIds.genres.length > 0) {
      relations.genres = { connect: data.relationIds.genres };
    }
    if (data.relationIds.themes.length > 0) {
      relations.themes = { connect: data.relationIds.themes };
    }
    if (data.relationIds.keywords.length > 0) {
      relations.keywords = { connect: data.relationIds.keywords };
    }
    if (data.relationIds.gameModes.length > 0) {
      relations.gameModes = { connect: data.relationIds.gameModes };
    }
    if (data.relationIds.playerPerspectives.length > 0) {
      relations.playerPerspectives = { connect: data.relationIds.playerPerspectives };
    }
    if (data.relationIds.languages.length > 0) {
      relations.languages = { connect: data.relationIds.languages };
    }
    if (data.relationIds.ageRatings.length > 0) {
      relations.ageRatings = { connect: data.relationIds.ageRatings };
    }
    if (data.relationIds.gameEngines.length > 0) {
      relations.gameEngines = { connect: data.relationIds.gameEngines };
    }

    // Step 1: Create Spanish locale entry as DRAFT with all data and relations
    const created = await gameService.update({
      documentId: data.documentId,
      locale: 'es',
      data: {
        name: spanishName,
        slug: spanishSlug,
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
        // Relations via Document Service connect with shorthand syntax
        ...relations,
      },
    } as any);

    const totalRelations = Object.values(data.relationIds).reduce((sum, arr) => sum + arr.length, 0);
    strapi.log.info(`[LocaleSync:ES] Spanish locale draft created with ${totalRelations} relations (id: ${created?.id})`);

    // Step 2: Update draft with description (rich text needs separate update)
    if (data.aiDescription) {
      await gameService.update({
        documentId: data.documentId,
        locale: 'es',
        data: { description: data.aiDescription },
      } as any);
      strapi.log.info(`[LocaleSync:ES] Description updated`);
    }

    // Step 3: Publish - Strapi copies draft to published including relations
    await (gameService as any).publish({
      documentId: data.documentId,
      locale: 'es',
    });

    strapi.log.info(`[LocaleSync:ES] Spanish locale published (draft and published have same relations)`);

    // Log success with details
    const englishName = data.localizedNames.en.name;
    if (spanishName !== englishName) {
      strapi.log.info(`[LocaleSync:ES] Spanish name: "${spanishName}" (localized from "${englishName}")`);
    }
  },
};
