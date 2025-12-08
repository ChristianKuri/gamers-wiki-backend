/**
 * Strapi Test Utilities
 * 
 * Helper functions for setting up and tearing down Strapi in tests.
 * Note: Full Strapi integration tests require the Strapi instance to be running.
 */

import type { Core } from '@strapi/strapi';

/**
 * Database cleanup utilities
 * These can be used to clean up test data between tests
 */
export const dbCleanup = {
  /**
   * Clean all game-related data
   * Use this before/after integration tests
   */
  async cleanGames(knex: Core.Strapi['db']['connection']): Promise<void> {
    // Delete in correct order due to foreign key constraints
    await knex.raw(`
      DELETE FROM games_age_ratings_lnk;
      DELETE FROM games_developers_lnk;
      DELETE FROM games_franchises_lnk;
      DELETE FROM games_game_engines_lnk;
      DELETE FROM games_game_modes_lnk;
      DELETE FROM games_genres_lnk;
      DELETE FROM games_keywords_lnk;
      DELETE FROM games_languages_lnk;
      DELETE FROM games_parent_game_lnk;
      DELETE FROM games_platforms_lnk;
      DELETE FROM games_player_perspectives_lnk;
      DELETE FROM games_publishers_lnk;
      DELETE FROM games_remakes_lnk;
      DELETE FROM games_remasters_lnk;
      DELETE FROM games_similar_games_lnk;
      DELETE FROM games_themes_lnk;
      DELETE FROM games;
    `);
  },

  /**
   * Clean all platform data
   */
  async cleanPlatforms(knex: Core.Strapi['db']['connection']): Promise<void> {
    await knex.raw(`
      DELETE FROM games_platforms_lnk;
      DELETE FROM platforms;
    `);
  },

  /**
   * Clean all related entity data
   */
  async cleanRelatedEntities(knex: Core.Strapi['db']['connection']): Promise<void> {
    await knex.raw(`
      DELETE FROM age_ratings;
      DELETE FROM companies;
      DELETE FROM franchises;
      DELETE FROM game_engines;
      DELETE FROM game_modes;
      DELETE FROM genres;
      DELETE FROM keywords;
      DELETE FROM languages;
      DELETE FROM player_perspectives;
      DELETE FROM themes;
    `);
  },

  /**
   * Clean everything for a fresh start
   */
  async cleanAll(knex: Core.Strapi['db']['connection']): Promise<void> {
    await this.cleanGames(knex);
    await this.cleanPlatforms(knex);
    await this.cleanRelatedEntities(knex);
  },
};

/**
 * Wait for a condition to be true
 * Useful for waiting for async operations to complete
 */
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 100 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Delay execution
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

