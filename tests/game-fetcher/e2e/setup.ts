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
    // Main tables (game-related only)
    'affiliate_links',
    'games',
    'age_ratings',
    'companies',
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
 */
export const db = {
  /**
   * Get all platforms with their descriptions
   */
  async getPlatforms(knex: Knex) {
    return knex('platforms')
      .select('id', 'document_id', 'name', 'locale', 'description', 'created_at')
      .orderBy(['document_id', 'locale']);
  },

  /**
   * Get platforms by document ID
   */
  async getPlatformsByDocumentId(knex: Knex, documentId: string) {
    return knex('platforms')
      .select('id', 'document_id', 'name', 'locale', 'description')
      .where('document_id', documentId)
      .orderBy('locale');
  },

  /**
   * Get games with their locales
   */
  async getGames(knex: Knex) {
    return knex('games')
      .select('id', 'document_id', 'name', 'locale', 'description', 'created_at')
      .orderBy(['document_id', 'locale']);
  },

  /**
   * Get all companies with their descriptions
   */
  async getCompanies(knex: Knex) {
    return knex('companies')
      .select('id', 'document_id', 'name', 'locale', 'description', 'country', 'founded_year', 'created_at')
      .orderBy(['document_id', 'locale']);
  },

  /**
   * Get companies by document ID
   */
  async getCompaniesByDocumentId(knex: Knex, documentId: string) {
    return knex('companies')
      .select('id', 'document_id', 'name', 'locale', 'description', 'country', 'founded_year')
      .where('document_id', documentId)
      .orderBy('locale');
  },
};
