/**
 * IGDB Image Fetcher
 *
 * Lightweight utility to fetch only image URLs from IGDB.
 * Used by article generator to populate the image pool.
 */

import type { Core } from '@strapi/strapi';

// ============================================================================
// Types
// ============================================================================

/**
 * IGDB image response for screenshots/artworks
 */
interface IGDBImageEntity {
  id: number;
  image_id: string;
}

/**
 * Result of fetching IGDB images
 */
export interface IGDBImagesResult {
  readonly screenshotUrls: readonly string[];
  readonly artworkUrls: readonly string[];
  readonly coverUrl: string | null;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * IGDB image URL template.
 * t_screenshot_big provides 889x500 images (good balance of quality/size).
 */
const IGDB_IMAGE_BASE = 'https://images.igdb.com/igdb/image/upload';
const SCREENSHOT_SIZE = 't_screenshot_big';
const COVER_SIZE = 't_cover_big';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Builds an IGDB image URL from an image_id.
 */
function buildImageUrl(imageId: string, size: string): string {
  return `${IGDB_IMAGE_BASE}/${size}/${imageId}.jpg`;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Fetches image URLs from IGDB for a game.
 *
 * This is a lightweight query that only fetches image-related fields,
 * not the full game data. Used during article generation to populate
 * the image pool with IGDB assets.
 *
 * @param strapi - Strapi instance for service access
 * @param igdbId - IGDB game ID
 * @returns Object with screenshot URLs, artwork URLs, and cover URL
 */
export async function fetchIGDBImagesForGame(
  strapi: Core.Strapi,
  igdbId: number
): Promise<IGDBImagesResult> {
  const igdbService = strapi.service('api::game-fetcher.igdb') as {
    igdbRequest: <T>(endpoint: string, query: string) => Promise<T>;
  };

  // Query only image-related fields
  const query = `
    fields screenshots.image_id, artworks.image_id, cover.image_id;
    where id = ${igdbId};
  `;

  type GameImageResponse = Array<{
    screenshots?: Array<{ image_id: string }>;
    artworks?: Array<{ image_id: string }>;
    cover?: { image_id: string };
  }>;

  const results = await igdbService.igdbRequest<GameImageResponse>('games', query);

  if (!results || results.length === 0) {
    strapi.log.warn(`[IGDB-Images] No game found for IGDB ID: ${igdbId}`);
    return {
      screenshotUrls: [],
      artworkUrls: [],
      coverUrl: null,
    };
  }

  const game = results[0];

  // Build screenshot URLs
  const screenshotUrls = (game.screenshots ?? []).map((s) =>
    buildImageUrl(s.image_id, SCREENSHOT_SIZE)
  );

  // Build artwork URLs
  const artworkUrls = (game.artworks ?? []).map((a) =>
    buildImageUrl(a.image_id, SCREENSHOT_SIZE)
  );

  // Build cover URL
  const coverUrl = game.cover
    ? buildImageUrl(game.cover.image_id, COVER_SIZE)
    : null;

  strapi.log.debug(
    `[IGDB-Images] Fetched ${screenshotUrls.length} screenshots, ` +
    `${artworkUrls.length} artworks, cover: ${coverUrl ? 'yes' : 'no'} for IGDB ID: ${igdbId}`
  );

  return {
    screenshotUrls,
    artworkUrls,
    coverUrl,
  };
}
