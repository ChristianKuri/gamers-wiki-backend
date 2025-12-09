import type { Knex } from 'knex';
import type { LinkTableConfig } from '../types';

/**
 * Base utilities for locale sync strategies
 * Contains shared database helpers that all locale strategies can use
 */

/**
 * Get the database row IDs for related entities by their document IDs
 * 
 * For localized entities (platforms, companies, franchises, collections):
 * - Gets the entry matching the target locale if it exists
 * - Falls back to any available entry if target locale doesn't exist
 * 
 * For non-localized entities (genres, etc.):
 * - Uses MIN(id) to get a consistent entry
 * 
 * @param knex - Knex connection
 * @param tableName - The table to query (e.g., 'platforms', 'genres')
 * @param documentIds - Array of document IDs to look up
 * @param targetLocale - The target locale to prefer (e.g., 'es' for Spanish game entries)
 * @returns Array of database row IDs
 */
export async function getRelationDbIds(
  knex: Knex,
  tableName: string,
  documentIds: string[],
  targetLocale: string = 'en'
): Promise<number[]> {
  if (documentIds.length === 0) return [];
  
  // Tables that have locale entries
  const localizedTables = ['platforms', 'companies', 'franchises', 'collections'];
  
  if (localizedTables.includes(tableName)) {
    // For localized tables: prefer PUBLISHED entries matching target locale
    // First, get PUBLISHED entries matching the target locale
    const localeMatches = await knex(tableName)
      .select('id', 'document_id')
      .whereIn('document_id', documentIds)
      .where('locale', targetLocale)
      .whereNotNull('published_at'); // Only published entries
    
    const matchedDocIds = new Set((localeMatches as Array<{ id: number; document_id: string }>).map(r => r.document_id));
    const results: number[] = (localeMatches as Array<{ id: number; document_id: string }>).map(r => r.id);
    
    // For any document_ids that don't have the target locale, fall back to PUBLISHED EN entry
    const missingDocIds = documentIds.filter(docId => !matchedDocIds.has(docId));
    if (missingDocIds.length > 0) {
      // Fall back to published EN entries (not MIN which gets draft)
      const fallbackQuery = await knex(tableName)
        .select('id', 'document_id')
        .whereIn('document_id', missingDocIds)
        .where('locale', 'en')
        .whereNotNull('published_at'); // Only published entries
      
      const fallbackResults = fallbackQuery as unknown as Array<{ id: number; document_id: string }>;
      results.push(...fallbackResults.map(r => r.id));
    }
    
    return results;
  }
  
  // For non-localized tables: get published entries, grouped by document_id
  const query = await knex(tableName)
    .select('id', 'document_id')
    .whereIn('document_id', documentIds)
    .whereNotNull('published_at'); // Only published entries
  
  // Deduplicate by document_id (take first/any since non-localized)
  const seenDocIds = new Set<string>();
  const results: number[] = [];
  for (const row of query as unknown as Array<{ id: number; document_id: string }>) {
    if (!seenDocIds.has(row.document_id)) {
      seenDocIds.add(row.document_id);
      results.push(row.id);
    }
  }
  return results;
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
 * @param targetLocale - The target locale for the new entry (to link to correct locale versions)
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
  },
  targetLocale: string = 'en'
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
    
    // Pass targetLocale to get locale-specific entries for localized tables
    const dbIds = await getRelationDbIds(knex, config.relatedTable, config.docIds, targetLocale);
    
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

