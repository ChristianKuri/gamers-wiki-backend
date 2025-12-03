/**
 * IGDB API Types
 * 
 * Based on https://api-docs.igdb.com/#endpoints
 * These types represent the data structures returned by the IGDB API.
 */

// ============================================================================
// ENUMS - Based on https://api-docs.igdb.com/#game-enums
// ============================================================================

/**
 * Game Type (replaces deprecated category)
 * https://api-docs.igdb.com/#game-type
 */
export enum IGDBGameType {
  MainGame = 0,
  DLCAddon = 1,
  Expansion = 2,
  Bundle = 3,
  StandaloneExpansion = 4,
  Mod = 5,
  Episode = 6,
  Season = 7,
  Remake = 8,
  Remaster = 9,
  ExpandedGame = 10,
  Port = 11,
  Fork = 12,
  Pack = 13,
  Update = 14,
}

export const IGDB_GAME_TYPE_MAP: Record<number, string> = {
  [IGDBGameType.MainGame]: 'main_game',
  [IGDBGameType.DLCAddon]: 'dlc_addon',
  [IGDBGameType.Expansion]: 'expansion',
  [IGDBGameType.Bundle]: 'bundle',
  [IGDBGameType.StandaloneExpansion]: 'standalone_expansion',
  [IGDBGameType.Mod]: 'mod',
  [IGDBGameType.Episode]: 'episode',
  [IGDBGameType.Season]: 'season',
  [IGDBGameType.Remake]: 'remake',
  [IGDBGameType.Remaster]: 'remaster',
  [IGDBGameType.ExpandedGame]: 'expanded_game',
  [IGDBGameType.Port]: 'port',
  [IGDBGameType.Fork]: 'fork',
  [IGDBGameType.Pack]: 'pack',
  [IGDBGameType.Update]: 'update',
};

/**
 * Game Status
 * https://api-docs.igdb.com/#game-status
 */
export enum IGDBGameStatus {
  Released = 0,
  Alpha = 2,
  Beta = 3,
  EarlyAccess = 4,
  Offline = 5,
  Cancelled = 6,
  Rumored = 7,
  Delisted = 8,
}

export const IGDB_GAME_STATUS_MAP: Record<number, string> = {
  [IGDBGameStatus.Released]: 'released',
  [IGDBGameStatus.Alpha]: 'alpha',
  [IGDBGameStatus.Beta]: 'beta',
  [IGDBGameStatus.EarlyAccess]: 'early_access',
  [IGDBGameStatus.Offline]: 'offline',
  [IGDBGameStatus.Cancelled]: 'cancelled',
  [IGDBGameStatus.Rumored]: 'rumored',
  [IGDBGameStatus.Delisted]: 'delisted',
};

/**
 * Age Rating Organization (DEPRECATED: category)
 * https://api-docs.igdb.com/#age-rating-organization
 * 
 * Note: The old `category` enum is deprecated. Use `organization` reference instead.
 * But we keep the enum for backwards compatibility with games using old data.
 */
export enum IGDBAgeRatingOrganization {
  ESRB = 1,
  PEGI = 2,
  CERO = 3,
  USK = 4,
  GRAC = 5,
  ClassInd = 6,
  ACB = 7,
}

// Mapping for deprecated `category` field (backwards compatibility)
export const IGDB_AGE_RATING_CATEGORY_MAP: Record<number, string> = {
  [IGDBAgeRatingOrganization.ESRB]: 'ESRB',
  [IGDBAgeRatingOrganization.PEGI]: 'PEGI',
  [IGDBAgeRatingOrganization.CERO]: 'CERO',
  [IGDBAgeRatingOrganization.USK]: 'USK',
  [IGDBAgeRatingOrganization.GRAC]: 'GRAC',
  [IGDBAgeRatingOrganization.ClassInd]: 'CLASS_IND',
  [IGDBAgeRatingOrganization.ACB]: 'ACB',
};

/**
 * Age Rating (DEPRECATED: rating enum)
 * https://api-docs.igdb.com/#age-rating-rating
 * 
 * Note: The `rating` field is DEPRECATED. Use `rating_category` reference instead.
 * But we keep this mapping for backwards compatibility.
 */
export enum IGDBAgeRatingRating {
  // PEGI ratings (1-5)
  Three = 1,
  Seven = 2,
  Twelve = 3,
  Sixteen = 4,
  Eighteen = 5,
  // ESRB ratings (6-12)
  RP = 6,    // Rating Pending
  EC = 7,    // Early Childhood
  E = 8,     // Everyone
  E10 = 9,   // Everyone 10+
  T = 10,    // Teen
  M = 11,    // Mature 17+
  AO = 12,   // Adults Only 18+
  // CERO ratings (13-17)
  CERO_A = 13,
  CERO_B = 14,
  CERO_C = 15,
  CERO_D = 16,
  CERO_Z = 17,
  // USK ratings (18-22)
  USK_0 = 18,
  USK_6 = 19,
  USK_12 = 20,
  USK_16 = 21,
  USK_18 = 22,
  // GRAC ratings (23-27)
  GRAC_ALL = 23,
  GRAC_Twelve = 24,
  GRAC_Fifteen = 25,
  GRAC_Eighteen = 26,
  GRAC_TESTING = 27,
  // CLASS_IND ratings (28-33)
  CLASS_IND_L = 28,
  CLASS_IND_Ten = 29,
  CLASS_IND_Twelve = 30,
  CLASS_IND_Fourteen = 31,
  CLASS_IND_Sixteen = 32,
  CLASS_IND_Eighteen = 33,
  // ACB ratings (34-39)
  ACB_G = 34,
  ACB_PG = 35,
  ACB_M = 36,
  ACB_MA15 = 37,
  ACB_R18 = 38,
  ACB_RC = 39,
}

// Mapping for deprecated `rating` field (backwards compatibility)
export const IGDB_AGE_RATING_MAP: Record<number, string> = {
  // PEGI
  [IGDBAgeRatingRating.Three]: '3',
  [IGDBAgeRatingRating.Seven]: '7',
  [IGDBAgeRatingRating.Twelve]: '12',
  [IGDBAgeRatingRating.Sixteen]: '16',
  [IGDBAgeRatingRating.Eighteen]: '18',
  // ESRB
  [IGDBAgeRatingRating.RP]: 'RP',
  [IGDBAgeRatingRating.EC]: 'EC',
  [IGDBAgeRatingRating.E]: 'E',
  [IGDBAgeRatingRating.E10]: 'E10+',
  [IGDBAgeRatingRating.T]: 'T',
  [IGDBAgeRatingRating.M]: 'M',
  [IGDBAgeRatingRating.AO]: 'AO',
  // CERO
  [IGDBAgeRatingRating.CERO_A]: 'A',
  [IGDBAgeRatingRating.CERO_B]: 'B',
  [IGDBAgeRatingRating.CERO_C]: 'C',
  [IGDBAgeRatingRating.CERO_D]: 'D',
  [IGDBAgeRatingRating.CERO_Z]: 'Z',
  // USK
  [IGDBAgeRatingRating.USK_0]: '0',
  [IGDBAgeRatingRating.USK_6]: '6',
  [IGDBAgeRatingRating.USK_12]: '12',
  [IGDBAgeRatingRating.USK_16]: '16',
  [IGDBAgeRatingRating.USK_18]: '18',
  // GRAC
  [IGDBAgeRatingRating.GRAC_ALL]: 'ALL',
  [IGDBAgeRatingRating.GRAC_Twelve]: '12',
  [IGDBAgeRatingRating.GRAC_Fifteen]: '15',
  [IGDBAgeRatingRating.GRAC_Eighteen]: '18',
  [IGDBAgeRatingRating.GRAC_TESTING]: 'TESTING',
  // CLASS_IND
  [IGDBAgeRatingRating.CLASS_IND_L]: 'L',
  [IGDBAgeRatingRating.CLASS_IND_Ten]: '10',
  [IGDBAgeRatingRating.CLASS_IND_Twelve]: '12',
  [IGDBAgeRatingRating.CLASS_IND_Fourteen]: '14',
  [IGDBAgeRatingRating.CLASS_IND_Sixteen]: '16',
  [IGDBAgeRatingRating.CLASS_IND_Eighteen]: '18',
  // ACB
  [IGDBAgeRatingRating.ACB_G]: 'G',
  [IGDBAgeRatingRating.ACB_PG]: 'PG',
  [IGDBAgeRatingRating.ACB_M]: 'M',
  [IGDBAgeRatingRating.ACB_MA15]: 'MA15+',
  [IGDBAgeRatingRating.ACB_R18]: 'R18+',
  [IGDBAgeRatingRating.ACB_RC]: 'RC',
};

/**
 * Website Category
 * https://api-docs.igdb.com/#website-category
 */
export enum IGDBWebsiteCategory {
  Official = 1,
  Wikia = 2,
  Wikipedia = 3,
  Facebook = 4,
  Twitter = 5,
  Twitch = 6,
  Instagram = 8,
  YouTube = 9,
  iPhone = 10,
  iPad = 11,
  Android = 12,
  Steam = 13,
  Reddit = 14,
  Itch = 15,
  EpicGames = 16,
  GOG = 17,
  Discord = 18,
}

export const IGDB_WEBSITE_CATEGORY_MAP: Record<number, string> = {
  [IGDBWebsiteCategory.Official]: 'official',
  [IGDBWebsiteCategory.Wikia]: 'wikia',
  [IGDBWebsiteCategory.Wikipedia]: 'wikipedia',
  [IGDBWebsiteCategory.Facebook]: 'facebook',
  [IGDBWebsiteCategory.Twitter]: 'twitter',
  [IGDBWebsiteCategory.Twitch]: 'twitch',
  [IGDBWebsiteCategory.Instagram]: 'instagram',
  [IGDBWebsiteCategory.YouTube]: 'youtube',
  [IGDBWebsiteCategory.iPhone]: 'iphone',
  [IGDBWebsiteCategory.iPad]: 'ipad',
  [IGDBWebsiteCategory.Android]: 'android',
  [IGDBWebsiteCategory.Steam]: 'steam',
  [IGDBWebsiteCategory.Reddit]: 'reddit',
  [IGDBWebsiteCategory.Itch]: 'itch',
  [IGDBWebsiteCategory.EpicGames]: 'epic',
  [IGDBWebsiteCategory.GOG]: 'gog',
  [IGDBWebsiteCategory.Discord]: 'discord',
};

/**
 * Platform Type
 * https://api-docs.igdb.com/#platform-type
 */
export enum IGDBPlatformType {
  Console = 1,
  Arcade = 2,
  Platform = 3,
  OperatingSystem = 4,
  PortableConsole = 5,
  Computer = 6,
}

export const IGDB_PLATFORM_TYPE_MAP: Record<number, string> = {
  [IGDBPlatformType.Console]: 'console',
  [IGDBPlatformType.Arcade]: 'console',
  [IGDBPlatformType.Platform]: 'console',
  [IGDBPlatformType.OperatingSystem]: 'pc',
  [IGDBPlatformType.PortableConsole]: 'handheld',
  [IGDBPlatformType.Computer]: 'pc',
};

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * IGDB Image reference
 */
export interface IGDBImage {
  id: number;
  image_id: string;
}

/**
 * IGDB Video reference
 */
export interface IGDBVideo {
  id: number;
  video_id: string;
}

/**
 * IGDB Cover
 */
export interface IGDBCover extends IGDBImage {}

/**
 * IGDB Screenshot
 */
export interface IGDBScreenshot extends IGDBImage {}

/**
 * IGDB Artwork
 */
export interface IGDBArtwork extends IGDBImage {}

/**
 * IGDB Genre
 */
export interface IGDBGenre {
  id: number;
  name: string;
  slug?: string;
}

/**
 * IGDB Theme
 */
export interface IGDBTheme {
  id: number;
  name: string;
  slug?: string;
}

/**
 * IGDB Game Mode
 */
export interface IGDBGameMode {
  id: number;
  name: string;
  slug?: string;
}

/**
 * IGDB Player Perspective
 */
export interface IGDBPlayerPerspective {
  id: number;
  name: string;
  slug?: string;
}

/**
 * IGDB Platform (basic)
 */
export interface IGDBPlatformBasic {
  id: number;
  name: string;
  abbreviation?: string;
}

/**
 * IGDB Platform (full)
 */
export interface IGDBPlatformFull extends IGDBPlatformBasic {
  slug: string;
  generation?: number;
  platform_type?: number;
  platform_logo?: IGDBImage;
  platform_family?: {
    id: number;
    name: string;
  };
}

/**
 * IGDB Company
 */
export interface IGDBCompany {
  id: number;
  name: string;
  slug: string;
  description?: string;
  logo?: IGDBImage;
  country?: number;
  start_date?: number;
}

/**
 * IGDB Involved Company
 */
export interface IGDBInvolvedCompany {
  id: number;
  company: IGDBCompany;
  developer: boolean;
  publisher: boolean;
  porting?: boolean;
  supporting?: boolean;
}

/**
 * IGDB Franchise
 */
export interface IGDBFranchise {
  id: number;
  name: string;
  slug: string;
  url?: string;
}

/**
 * IGDB Collection (similar to Franchise)
 */
export interface IGDBCollection {
  id: number;
  name: string;
  slug: string;
  url?: string;
}

/**
 * IGDB Website
 */
export interface IGDBWebsite {
  id: number;
  url: string;
  category: number;
  trusted?: boolean;
}

/**
 * IGDB Language
 */
export interface IGDBLanguage {
  id: number;
  name: string;
  native_name?: string;
  locale?: string;
}

/**
 * IGDB Language Support Type
 */
export interface IGDBLanguageSupportType {
  id: number;
  name: string;
}

/**
 * IGDB Language Support
 */
export interface IGDBLanguageSupport {
  id: number;
  language: IGDBLanguage;
  language_support_type: IGDBLanguageSupportType;
}

/**
 * IGDB Age Rating Organization (expanded reference)
 */
export interface IGDBAgeRatingOrganizationRef {
  id: number;
  name: string;
}

/**
 * IGDB Age Rating Category (expanded reference)
 * This contains the actual rating string
 */
export interface IGDBAgeRatingCategoryRef {
  id: number;
  rating: string;  // The actual rating string like "M", "18", "T", etc.
  organization?: IGDBAgeRatingOrganizationRef;
}

/**
 * IGDB Age Rating
 * 
 * Note: `category` and `rating` are DEPRECATED.
 * Use `organization` and `rating_category` instead.
 */
export interface IGDBAgeRating {
  id: number;
  // DEPRECATED fields (may still be present for backwards compatibility)
  category?: number;
  rating?: number;
  // NEW fields (use these)
  organization?: IGDBAgeRatingOrganizationRef;
  rating_category?: IGDBAgeRatingCategoryRef;
  // Common fields
  synopsis?: string;
  rating_cover_url?: string;
  content_descriptions?: Array<{
    id: number;
    category: number;
    description: string;
  }>;
  rating_content_descriptions?: Array<{
    id: number;
    description: string;
    description_type?: {
      id: number;
      name: string;
    };
  }>;
}

/**
 * IGDB Game Engine
 */
export interface IGDBGameEngine {
  id: number;
  name: string;
  slug: string;
  description?: string;
  logo?: IGDBImage;
  url?: string;
}

/**
 * IGDB Game (full response)
 */
export interface IGDBGame {
  id: number;
  name: string;
  slug: string;
  summary?: string;
  storyline?: string;
  first_release_date?: number;
  aggregated_rating?: number;
  aggregated_rating_count?: number;
  rating?: number;
  rating_count?: number;
  total_rating?: number;
  hypes?: number;
  category?: number;
  game_status?: number;
  url?: string;
  parent_game?: number;
  cover?: IGDBCover;
  screenshots?: IGDBScreenshot[];
  artworks?: IGDBArtwork[];
  videos?: IGDBVideo[];
  genres?: IGDBGenre[];
  themes?: IGDBTheme[];
  game_modes?: IGDBGameMode[];
  player_perspectives?: IGDBPlayerPerspective[];
  platforms?: IGDBPlatformBasic[];
  involved_companies?: IGDBInvolvedCompany[];
  franchise?: IGDBFranchise;
  franchises?: IGDBFranchise[];
  collections?: IGDBCollection[];
  websites?: IGDBWebsite[];
  language_supports?: IGDBLanguageSupport[];
  age_ratings?: IGDBAgeRating[];
  game_engines?: IGDBGameEngine[];
  dlcs?: number[];
  expansions?: number[];
  remakes?: number[];
  remasters?: number[];
  similar_games?: number[];
  game_localizations?: IGDBGameLocalization[];
}

/**
 * IGDB Search Result (minimal game data)
 */
export interface IGDBSearchResult {
  id: number;
  name: string;
  slug?: string;
  cover?: IGDBCover;
  first_release_date?: number;
  platforms?: IGDBPlatformBasic[];
  rating?: number;
  total_rating?: number;
  hypes?: number;
}

// ============================================================================
// GAME LOCALIZATION TYPES
// ============================================================================

/**
 * IGDB Region
 * https://api-docs.igdb.com/#region
 */
export interface IGDBRegion {
  id: number;
  name: string;
  identifier: string;
  category: 'locale' | 'continent';
}

/**
 * IGDB Game Localization
 * https://api-docs.igdb.com/#game-localization
 */
export interface IGDBGameLocalization {
  id: number;
  game: number;
  name: string;
  region?: IGDBRegion;
  cover?: IGDBCover;
}

// ============================================================================
// TWITCH AUTH TYPES
// ============================================================================

/**
 * Twitch OAuth Response
 */
export interface TwitchAuthResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

