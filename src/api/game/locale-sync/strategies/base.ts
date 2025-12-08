import type { Knex } from 'knex';
import type { LinkTableConfig } from '../types';

/**
 * Base utilities for locale sync strategies
 * Contains shared database helpers that all locale strategies can use
 */

/**
 * Get the database row IDs for related entities by their document IDs
 * Uses MIN(id) to avoid duplicates when entities have multiple locale entries
 * 
 * @param knex - Knex connection
 * @param tableName - The table to query (e.g., 'platforms', 'genres')
 * @param documentIds - Array of document IDs to look up
 * @returns Array of database row IDs
 */
export async function getRelationDbIds(
  knex: Knex,
  tableName: string,
  documentIds: string[]
): Promise<number[]> {
  if (documentIds.length === 0) return [];
  
  // Use MIN(id) grouped by document_id to avoid duplicates
  // (some entities may have multiple locale entries with same document_id)
  const query = await knex(tableName)
    .select(knex.raw('MIN(id) as id'))
    .whereIn('document_id', documentIds)
    .groupBy('document_id');
  
  const results = query as unknown as Array<{ id: number }>;
  return results.map(r => r.id);
}

/**
 * Insert links into a junction/link table
 * 
 * @param knex - Knex connection
 * @param tableName - The link table name (e.g., 'games_platforms_lnk')
 * @param gameField - The game foreign key field name (usually 'game_id')
 * @param relatedField - The related entity foreign key field name (e.g., 'platform_id')
 * @param gameId - The database row ID of the game entry
 * @param relatedIds - Array of related entity database row IDs
 */
export async function insertLinks(
  knex: Knex,
  tableName: string,
  gameField: string,
  relatedField: string,
  gameId: number,
  relatedIds: number[]
): Promise<void> {
  if (relatedIds.length === 0) return;
  
  // Build link records with ordering
  const links = relatedIds.map((relatedId, index) => ({
    [gameField]: gameId,
    [relatedField]: relatedId,
    // Order field: replace '_id' suffix with '_ord' (e.g., platform_id -> platform_ord)
    [relatedField.replace('_id', '_ord')]: index + 1,
  }));
  
  await knex(tableName).insert(links);
}

/**
 * Copy all relations from source game to a new locale entry
 * 
 * @param knex - Knex connection
 * @param newGameId - The database row ID of the new locale entry
 * @param relationDocIds - Object containing document IDs for each relation type
 */
export async function copyAllRelations(
  knex: Knex,
  newGameId: number,
  relationDocIds: {
    developers: string[];
    publishers: string[];
    franchises: string[];
    collections: string[];
    platforms: string[];
    genres: string[];
    languages: string[];
    ageRatings: string[];
    gameEngines: string[];
    gameModes: string[];
    playerPerspectives: string[];
    themes: string[];
    keywords: string[];
  }
): Promise<number> {
  // Link table configurations
  const linkConfigs: Array<LinkTableConfig & { docIds: string[] }> = [
    { tableName: 'games_platforms_lnk', gameField: 'game_id', relatedField: 'platform_id', relatedTable: 'platforms', docIds: relationDocIds.platforms },
    { tableName: 'games_genres_lnk', gameField: 'game_id', relatedField: 'genre_id', relatedTable: 'genres', docIds: relationDocIds.genres },
    { tableName: 'games_developers_lnk', gameField: 'game_id', relatedField: 'company_id', relatedTable: 'companies', docIds: relationDocIds.developers },
    { tableName: 'games_publishers_lnk', gameField: 'game_id', relatedField: 'company_id', relatedTable: 'companies', docIds: relationDocIds.publishers },
    { tableName: 'games_franchises_lnk', gameField: 'game_id', relatedField: 'franchise_id', relatedTable: 'franchises', docIds: relationDocIds.franchises },
    { tableName: 'games_collections_lnk', gameField: 'game_id', relatedField: 'collection_id', relatedTable: 'collections', docIds: relationDocIds.collections },
    { tableName: 'games_languages_lnk', gameField: 'game_id', relatedField: 'language_id', relatedTable: 'languages', docIds: relationDocIds.languages },
    { tableName: 'games_game_modes_lnk', gameField: 'game_id', relatedField: 'game_mode_id', relatedTable: 'game_modes', docIds: relationDocIds.gameModes },
    { tableName: 'games_player_perspectives_lnk', gameField: 'game_id', relatedField: 'player_perspective_id', relatedTable: 'player_perspectives', docIds: relationDocIds.playerPerspectives },
    { tableName: 'games_themes_lnk', gameField: 'game_id', relatedField: 'theme_id', relatedTable: 'themes', docIds: relationDocIds.themes },
    { tableName: 'games_keywords_lnk', gameField: 'game_id', relatedField: 'keyword_id', relatedTable: 'keywords', docIds: relationDocIds.keywords },
    { tableName: 'games_age_ratings_lnk', gameField: 'game_id', relatedField: 'age_rating_id', relatedTable: 'age_ratings', docIds: relationDocIds.ageRatings },
    { tableName: 'games_game_engines_lnk', gameField: 'game_id', relatedField: 'game_engine_id', relatedTable: 'game_engines', docIds: relationDocIds.gameEngines },
  ];
  
  let totalRelations = 0;
  
  for (const config of linkConfigs) {
    if (config.docIds.length === 0) continue;
    
    const dbIds = await getRelationDbIds(knex, config.relatedTable, config.docIds);
    if (dbIds.length > 0) {
      await insertLinks(knex, config.tableName, config.gameField, config.relatedField, newGameId, dbIds);
      totalRelations += dbIds.length;
    }
  }
  
  return totalRelations;
}

/**
 * Generate a URL-safe slug from a localized name
 * Removes accents, converts to lowercase, replaces non-alphanumeric with dashes
 * 
 * @param name - The localized name
 * @returns URL-safe slug
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]+/g, '-')     // Replace non-alphanumeric with dashes
    .replace(/^-|-$/g, '');          // Remove leading/trailing dashes
}

