/**
 * E2E Test Setup
 * 
 * Setup and utilities for end-to-end tests that require a running Strapi instance.
 * These tests make real API calls and database queries.
 * 
 * IMPORTANT: E2E tests use a separate test database (strapi_test) to avoid
 * affecting development or production data.
 */

import type { Knex } from 'knex';

// Forbidden database name patterns - E2E tests will refuse to run against these
const FORBIDDEN_DB_PATTERNS = ['dev', 'prod', 'production', 'staging', 'live'];

// Configuration - defaults to test database
// Uses same env var names as Strapi's config/database.ts for consistency
export const E2E_CONFIG = {
  strapiUrl: process.env.STRAPI_TEST_URL || 'http://localhost:1338',
  dbHost: process.env.DATABASE_HOST || 'localhost',
  dbPort: parseInt(process.env.DATABASE_PORT || '5432', 10),
  dbName: process.env.TEST_DB_NAME || 'strapi_test', // ✅ Defaults to test DB
  dbUser: process.env.DATABASE_USERNAME || 'strapi',
  dbPassword: process.env.DATABASE_PASSWORD || 'strapi_dev_password',
};

/**
 * Validate that we're not accidentally running against a dev/prod database
 */
function validateDatabaseName(dbName: string): void {
  const lowerName = dbName.toLowerCase();
  
  for (const pattern of FORBIDDEN_DB_PATTERNS) {
    if (lowerName.includes(pattern) && !lowerName.includes('test')) {
      throw new Error(
        `🛑 SAFETY CHECK FAILED: Refusing to run E2E tests against database "${dbName}"\n` +
        `   Database name contains "${pattern}" which suggests it's not a test database.\n` +
        `   E2E tests will DELETE ALL DATA in the target database.\n\n` +
        `   To fix this:\n` +
        `   1. Use the test database: strapi_test (default)\n` +
        `   2. Or set TEST_DB_NAME to a database containing "test" in its name\n` +
        `   3. Run: docker compose -f docker-compose.dev.yml down -v && docker compose -f docker-compose.dev.yml up -d\n` +
        `      to recreate the PostgreSQL container with the test database`
      );
    }
  }
}

/**
 * Check if Strapi is running and accessible
 */
export async function isStrapiRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${E2E_CONFIG.strapiUrl}/api/game-fetcher/status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for Strapi to be ready
 */
export async function waitForStrapi(timeoutMs = 30000): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    if (await isStrapiRunning()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  throw new Error(`Strapi not ready after ${timeoutMs}ms. Is it running at ${E2E_CONFIG.strapiUrl}?`);
}

/**
 * Create a database connection for E2E tests
 * Includes safety check to prevent connecting to dev/prod databases
 */
export async function createDbConnection(): Promise<Knex> {
  // Safety check before connecting
  validateDatabaseName(E2E_CONFIG.dbName);
  
  const knexModule = await import('knex');
  const knex = knexModule.default;
  
  return knex({
    client: 'pg',
    connection: {
      host: E2E_CONFIG.dbHost,
      port: E2E_CONFIG.dbPort,
      database: E2E_CONFIG.dbName,
      user: E2E_CONFIG.dbUser,
      password: E2E_CONFIG.dbPassword,
    },
  });
}

/**
 * Clean game-related data from the database
 * 
 * PRESERVES:
 * - Admin users (admin_users, admin_permissions, admin_roles, etc.)
 * - Strapi system tables (strapi_*, up_*)
 * - Categories, tags, authors (seeded data)
 * - i18n locales
 * 
 * DELETES:
 * - Games and all related data
 * - Platforms
 * - Companies, genres, themes, etc. (imported from IGDB)
 * 
 * Includes safety check to prevent accidental deletion of dev/prod data
 * Gracefully handles missing tables (e.g., first run before Strapi creates schema)
 */
export async function cleanDatabase(knex: Knex): Promise<void> {
  // Double-check safety before deleting anything
  validateDatabaseName(E2E_CONFIG.dbName);
  
  // Tables to clean in order (foreign keys first, then main tables)
  // NOTE: We ONLY delete game-related data, not admin users or seeded content
  const tables = [
    // Link tables (foreign keys)
    'games_age_ratings_lnk',
    'games_developers_lnk',
    'games_franchises_lnk',
    'games_collections_lnk',
    'games_game_engines_lnk',
    'games_game_modes_lnk',
    'games_genres_lnk',
    'games_keywords_lnk',
    'games_languages_lnk',
    'games_parent_game_lnk',
    'games_platforms_lnk',
    'games_player_perspectives_lnk',
    'games_publishers_lnk',
    'games_remakes_lnk',
    'games_remasters_lnk',
    'games_similar_games_lnk',
    'games_themes_lnk',
    'affiliate_links_game_lnk',
    'collections_parent_collection_lnk',
    // Main tables (game-related only)
    'affiliate_links',
    'games',
    'age_ratings',
    'companies',
    'collections',
    'franchises',
    'game_engines',
    'game_modes',
    'genres',
    'keywords',
    'languages',
    'platforms',
    'player_perspectives',
    'themes',
    // NOTE: We DO NOT delete these tables:
    // - admin_users, admin_permissions, admin_roles, etc. (admin users)
    // - up_users, up_permissions, up_roles (frontend users)
    // - categories, tags, authors (seeded content)
    // - i18n_locale (locales)
    // - strapi_* tables (system)
  ];

  for (const table of tables) {
    try {
      await knex(table).del();
    } catch (error) {
      // Ignore errors for tables that don't exist yet
      // (e.g., first run before Strapi creates schema)
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('does not exist')) {
        throw error;
      }
    }
  }
}

// API Response Types
interface ImportGameResponse {
  success: boolean;
  message: string;
  game?: Record<string, unknown>;
  aiGenerated?: boolean;
  stats?: Record<string, number>;
  error?: { message: string };
}

interface AIStatusResponse {
  configured: boolean;
  tasks: Record<string, { name: string; model: string }>;
}

interface SearchGamesResponse {
  results: Array<{ id: number; name: string }>;
}

/**
 * API helper functions
 */
export const api = {
  /**
   * Import a game by IGDB ID
   */
  async importGame(igdbId: number): Promise<ImportGameResponse> {
    const response = await fetch(`${E2E_CONFIG.strapiUrl}/api/game-fetcher/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ igdbId }),
    });
    
    return response.json() as Promise<ImportGameResponse>;
  },

  /**
   * Get AI status
   */
  async getAIStatus(): Promise<AIStatusResponse> {
    const response = await fetch(`${E2E_CONFIG.strapiUrl}/api/game-fetcher/ai-status`);
    return response.json() as Promise<AIStatusResponse>;
  },

  /**
   * Search for games
   */
  async searchGames(query: string, limit = 5): Promise<SearchGamesResponse> {
    const response = await fetch(
      `${E2E_CONFIG.strapiUrl}/api/game-fetcher/search?q=${encodeURIComponent(query)}&limit=${limit}`
    );
    return response.json() as Promise<SearchGamesResponse>;
  },
};

/**
 * Database query helpers
 * 
 * All entries are created as published (published_at is set).
 * We filter for published entries (whereNotNull('published_at')) to query the actual data.
 */
export const db = {
  /**
   * Get all platforms (published entries)
   */
  async getPlatforms(knex: Knex) {
    return knex('platforms')
      .select('id', 'document_id', 'name', 'locale', 'description', 'created_at')
      .whereNotNull('published_at')
      .orderBy(['document_id', 'locale']);
  },

  /**
   * Get platforms by document ID (published entries)
   */
  async getPlatformsByDocumentId(knex: Knex, documentId: string) {
    return knex('platforms')
      .select('id', 'document_id', 'name', 'locale', 'description')
      .where('document_id', documentId)
      .whereNotNull('published_at')
      .orderBy('locale');
  },

  /**
   * Get games with their locales (published entries)
   */
  async getGames(knex: Knex) {
    return knex('games')
      .select('id', 'document_id', 'name', 'locale', 'description', 'created_at')
      .whereNotNull('published_at')
      .orderBy(['document_id', 'locale']);
  },

  /**
   * Get all companies (published entries)
   */
  async getCompanies(knex: Knex) {
    return knex('companies')
      .select('id', 'document_id', 'name', 'locale', 'description', 'country', 'founded_year', 'created_at')
      .whereNotNull('published_at')
      .orderBy(['document_id', 'locale']);
  },

  /**
   * Get companies by document ID (published entries)
   */
  async getCompaniesByDocumentId(knex: Knex, documentId: string) {
    return knex('companies')
      .select('id', 'document_id', 'name', 'locale', 'description', 'country', 'founded_year')
      .where('document_id', documentId)
      .whereNotNull('published_at')
      .orderBy('locale');
  },

  /**
   * Get all franchises (published entries)
   */
  async getFranchises(knex: Knex) {
    return knex('franchises')
      .select('id', 'document_id', 'name', 'locale', 'description', 'igdb_id', 'created_at')
      .whereNotNull('published_at')
      .orderBy(['document_id', 'locale']);
  },

  /**
   * Get franchises by document ID (published entries)
   */
  async getFranchisesByDocumentId(knex: Knex, documentId: string) {
    return knex('franchises')
      .select('id', 'document_id', 'name', 'locale', 'description', 'igdb_id')
      .where('document_id', documentId)
      .whereNotNull('published_at')
      .orderBy('locale');
  },

  /**
   * Get all collections (published entries)
   */
  async getCollections(knex: Knex) {
    return knex('collections')
      .select('id', 'document_id', 'name', 'locale', 'description', 'igdb_id', 'created_at')
      .whereNotNull('published_at')
      .orderBy(['document_id', 'locale']);
  },

  /**
   * Get collections by document ID (published entries)
   */
  async getCollectionsByDocumentId(knex: Knex, documentId: string) {
    return knex('collections')
      .select('id', 'document_id', 'name', 'locale', 'description', 'igdb_id')
      .where('document_id', documentId)
      .whereNotNull('published_at')
      .orderBy('locale');
  },

  /**
   * Get game relationship counts by game database ID
   * Returns counts for all relationship types linked to a specific game entry
   */
  async getGameRelationshipCounts(knex: Knex, gameId: number): Promise<GameRelationshipCounts> {
    const relationTables = [
      { table: 'games_platforms_lnk', fkColumn: 'game_id', name: 'platforms' },
      { table: 'games_genres_lnk', fkColumn: 'game_id', name: 'genres' },
      { table: 'games_themes_lnk', fkColumn: 'game_id', name: 'themes' },
      { table: 'games_keywords_lnk', fkColumn: 'game_id', name: 'keywords' },
      { table: 'games_developers_lnk', fkColumn: 'game_id', name: 'developers' },
      { table: 'games_publishers_lnk', fkColumn: 'game_id', name: 'publishers' },
      { table: 'games_franchises_lnk', fkColumn: 'game_id', name: 'franchises' },
      { table: 'games_collections_lnk', fkColumn: 'game_id', name: 'collections' },
      { table: 'games_game_modes_lnk', fkColumn: 'game_id', name: 'gameModes' },
      { table: 'games_player_perspectives_lnk', fkColumn: 'game_id', name: 'playerPerspectives' },
      { table: 'games_game_engines_lnk', fkColumn: 'game_id', name: 'gameEngines' },
      { table: 'games_age_ratings_lnk', fkColumn: 'game_id', name: 'ageRatings' },
      { table: 'games_languages_lnk', fkColumn: 'game_id', name: 'languages' },
    ];

    const counts: GameRelationshipCounts = {
      platforms: 0,
      genres: 0,
      themes: 0,
      keywords: 0,
      developers: 0,
      publishers: 0,
      franchises: 0,
      collections: 0,
      gameModes: 0,
      playerPerspectives: 0,
      gameEngines: 0,
      ageRatings: 0,
      languages: 0,
    };

    for (const { table, fkColumn, name } of relationTables) {
      try {
        const result = await knex(table)
          .count('* as count')
          .where(fkColumn, gameId)
          .first();
        counts[name as keyof GameRelationshipCounts] = Number(result?.count || 0);
      } catch {
        // Table might not exist
        counts[name as keyof GameRelationshipCounts] = 0;
      }
    }

    return counts;
  },

  /**
   * Get franchise game relationship counts by franchise database ID
   * Returns the number of games linked to a specific franchise entry
   */
  async getFranchiseGameCount(knex: Knex, franchiseId: number): Promise<number> {
    try {
      const result = await knex('games_franchises_lnk')
        .count('* as count')
        .where('franchise_id', franchiseId)
        .first();
      return Number(result?.count || 0);
    } catch {
      return 0;
    }
  },

  /**
   * Get company game relationship counts by company database ID
   * Returns the number of games where this company is developer or publisher
   */
  async getCompanyGameCounts(knex: Knex, companyId: number): Promise<{ asDeveloper: number; asPublisher: number }> {
    try {
      const devResult = await knex('games_developers_lnk')
        .count('* as count')
        .where('company_id', companyId)
        .first();
      const pubResult = await knex('games_publishers_lnk')
        .count('* as count')
        .where('company_id', companyId)
        .first();
      return {
        asDeveloper: Number(devResult?.count || 0),
        asPublisher: Number(pubResult?.count || 0),
      };
    } catch {
      return { asDeveloper: 0, asPublisher: 0 };
    }
  },

  /**
   * Get collection game relationship counts by collection database ID
   * Returns the number of games linked to a specific collection entry
   */
  async getCollectionGameCount(knex: Knex, collectionId: number): Promise<number> {
    try {
      const result = await knex('games_collections_lnk')
        .count('* as count')
        .where('collection_id', collectionId)
        .first();
      return Number(result?.count || 0);
    } catch {
      return 0;
    }
  },

  /**
   * Get all game entries (both draft and published) for a document
   * Returns all rows with their status for testing draft/published parity
   */
  async getGameEntriesByDocument(knex: Knex, documentId: string) {
    return knex('games')
      .select('id', 'document_id', 'locale', 'name', 'published_at')
      .where('document_id', documentId)
      .orderBy(['locale', 'id']);
  },

  /**
   * Get platform game relationship counts by platform database ID
   * Returns the number of games linked to a specific platform entry
   */
  async getPlatformGameCount(knex: Knex, platformId: number): Promise<number> {
    try {
      const result = await knex('games_platforms_lnk')
        .count('* as count')
        .where('platform_id', platformId)
        .first();
      return Number(result?.count || 0);
    } catch {
      return 0;
    }
  },
};

// Type definitions
export interface GameRelationshipCounts {
  platforms: number;
  genres: number;
  themes: number;
  keywords: number;
  developers: number;
  publishers: number;
  franchises: number;
  collections: number;
  gameModes: number;
  playerPerspectives: number;
  gameEngines: number;
  ageRatings: number;
  languages: number;
}
