import type { Core } from '@strapi/strapi';
import type { LocaleStrategy, GameLocaleData } from '../types';
import { copyAllRelations, generateSlug } from './base';

/**
 * Spanish (es) locale strategy
 * Creates Spanish locale entries for games with data from IGDB localizations
 */
export const spanishLocaleStrategy: LocaleStrategy = {
  locale: 'es',

  async createLocale(strapi: Core.Strapi, data: GameLocaleData): Promise<void> {
    const knex = strapi.db.connection;
    const now = new Date().toISOString();

    // Get Spanish localized data
    const spanishData = data.localizedNames.es;
    const spanishName = spanishData.name;
    const spanishCoverUrl = spanishData.coverUrl;
    const spanishSlug = generateSlug(spanishName);

    // Check if Spanish locale already exists for this document
    const existing = await knex('games')
      .where({ document_id: data.documentId, locale: 'es' })
      .first();

    if (existing) {
      strapi.log.info(`[LocaleSync:ES] Spanish locale already exists for document ${data.documentId}`);
      return;
    }

    // Insert Spanish locale entry with same document_id (as published)
    const [insertedRow] = await knex('games').insert({
      document_id: data.documentId,
      locale: 'es',
      name: spanishName,
      slug: spanishSlug,
      description: data.aiDescription || data.gameData.description,
      release_date: data.gameData.releaseDate,
      game_category: data.gameData.gameCategory,
      game_status: data.gameData.gameStatus,
      cover_image_url: spanishCoverUrl || data.gameData.coverImageUrl,
      screenshot_urls: JSON.stringify(data.gameData.screenshotUrls),
      trailer_ids: JSON.stringify(data.gameData.trailerIds),
      metacritic_score: data.gameData.metacriticScore,
      user_rating: data.gameData.userRating,
      user_rating_count: data.gameData.userRatingCount,
      total_rating: data.gameData.totalRating,
      total_rating_count: data.gameData.totalRatingCount,
      hypes: data.gameData.hypes,
      multiplayer_modes: JSON.stringify(data.gameData.multiplayerModes),
      official_website: data.gameData.officialWebsite,
      steam_url: data.gameData.steamUrl,
      epic_url: data.gameData.epicUrl,
      gog_url: data.gameData.gogUrl,
      itch_url: data.gameData.itchUrl,
      discord_url: data.gameData.discordUrl,
      igdb_id: data.gameData.igdbId,
      igdb_url: data.gameData.igdbUrl,
      published_at: now, // Create as published (no draft)
      created_at: now,
      updated_at: now,
    }).returning('id');

    const spanishEntryId = insertedRow?.id || insertedRow;
    strapi.log.info(`[LocaleSync:ES] Spanish locale entry created (id: ${spanishEntryId})`);

    // Copy all relations to the Spanish locale entry
    // Pass 'es' to link to Spanish locale versions of related entities
    const totalRelations = await copyAllRelations(knex, spanishEntryId, data.relationIds, 'es');

    // Log success with details
    const englishName = data.localizedNames.en.name;
    if (spanishName !== englishName) {
      strapi.log.info(`[LocaleSync:ES] Spanish name: "${spanishName}" (localized from "${englishName}")`);
    }
    if (spanishCoverUrl && spanishCoverUrl !== data.gameData.coverImageUrl) {
      strapi.log.info(`[LocaleSync:ES] Spanish cover: ${spanishCoverUrl}`);
    }
    strapi.log.info(`[LocaleSync:ES] Spanish locale created with ${totalRelations} total relations`);
  },
};

