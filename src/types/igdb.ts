/**
 * IGDB API Types
 *
 * Complete type definitions for the IGDB API v4.
 * Organized alphabetically to match the official documentation.
 *
 * @see https://api-docs.igdb.com/#endpoints
 *
 * Structure:
 * 1. Enums (grouped by category)
 * 2. Base Types
 * 3. Endpoint Response Types (A-Z)
 * 4. Helper Types & Utilities
 */

// ============================================================================
// ENUMS
// ============================================================================
// Enums are grouped by their related endpoint for easier reference.
// Each enum includes a corresponding mapping object for value-to-string conversion.

// -----------------------------------------------------------------------------
// Age Rating Enums
// -----------------------------------------------------------------------------

/**
 * Age Rating Category (DEPRECATED enum)
 *
 * The organization that has issued a specific rating.
 *
 * @deprecated Use `organization` reference field instead of `category` enum
 * @see https://api-docs.igdb.com/#age-rating-category-enum
 */
export enum IGDBAgeRatingCategoryEnum {
  ESRB = 1,
  PEGI = 2,
  CERO = 3,
  USK = 4,
  GRAC = 5,
  ClassInd = 6,
  ACB = 7,
}

export const IGDB_AGE_RATING_CATEGORY_MAP: Record<number, string> = {
  [IGDBAgeRatingCategoryEnum.ESRB]: 'ESRB',
  [IGDBAgeRatingCategoryEnum.PEGI]: 'PEGI',
  [IGDBAgeRatingCategoryEnum.CERO]: 'CERO',
  [IGDBAgeRatingCategoryEnum.USK]: 'USK',
  [IGDBAgeRatingCategoryEnum.GRAC]: 'GRAC',
  [IGDBAgeRatingCategoryEnum.ClassInd]: 'CLASS_IND',
  [IGDBAgeRatingCategoryEnum.ACB]: 'ACB',
};

/**
 * Age Rating Rating (DEPRECATED enum)
 *
 * The actual rating value.
 *
 * @deprecated Use `rating_category` reference field instead of `rating` enum
 * @see https://api-docs.igdb.com/#age-rating-rating-enum
 */
export enum IGDBAgeRatingRatingEnum {
  // PEGI ratings (1-5)
  Three = 1,
  Seven = 2,
  Twelve = 3,
  Sixteen = 4,
  Eighteen = 5,
  // ESRB ratings (6-12)
  RP = 6, // Rating Pending
  EC = 7, // Early Childhood
  E = 8, // Everyone
  E10 = 9, // Everyone 10+
  T = 10, // Teen
  M = 11, // Mature 17+
  AO = 12, // Adults Only 18+
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

export const IGDB_AGE_RATING_RATING_MAP: Record<number, string> = {
  // PEGI
  [IGDBAgeRatingRatingEnum.Three]: '3',
  [IGDBAgeRatingRatingEnum.Seven]: '7',
  [IGDBAgeRatingRatingEnum.Twelve]: '12',
  [IGDBAgeRatingRatingEnum.Sixteen]: '16',
  [IGDBAgeRatingRatingEnum.Eighteen]: '18',
  // ESRB
  [IGDBAgeRatingRatingEnum.RP]: 'RP',
  [IGDBAgeRatingRatingEnum.EC]: 'EC',
  [IGDBAgeRatingRatingEnum.E]: 'E',
  [IGDBAgeRatingRatingEnum.E10]: 'E10+',
  [IGDBAgeRatingRatingEnum.T]: 'T',
  [IGDBAgeRatingRatingEnum.M]: 'M',
  [IGDBAgeRatingRatingEnum.AO]: 'AO',
  // CERO
  [IGDBAgeRatingRatingEnum.CERO_A]: 'A',
  [IGDBAgeRatingRatingEnum.CERO_B]: 'B',
  [IGDBAgeRatingRatingEnum.CERO_C]: 'C',
  [IGDBAgeRatingRatingEnum.CERO_D]: 'D',
  [IGDBAgeRatingRatingEnum.CERO_Z]: 'Z',
  // USK
  [IGDBAgeRatingRatingEnum.USK_0]: '0',
  [IGDBAgeRatingRatingEnum.USK_6]: '6',
  [IGDBAgeRatingRatingEnum.USK_12]: '12',
  [IGDBAgeRatingRatingEnum.USK_16]: '16',
  [IGDBAgeRatingRatingEnum.USK_18]: '18',
  // GRAC
  [IGDBAgeRatingRatingEnum.GRAC_ALL]: 'ALL',
  [IGDBAgeRatingRatingEnum.GRAC_Twelve]: '12',
  [IGDBAgeRatingRatingEnum.GRAC_Fifteen]: '15',
  [IGDBAgeRatingRatingEnum.GRAC_Eighteen]: '18',
  [IGDBAgeRatingRatingEnum.GRAC_TESTING]: 'TESTING',
  // CLASS_IND
  [IGDBAgeRatingRatingEnum.CLASS_IND_L]: 'L',
  [IGDBAgeRatingRatingEnum.CLASS_IND_Ten]: '10',
  [IGDBAgeRatingRatingEnum.CLASS_IND_Twelve]: '12',
  [IGDBAgeRatingRatingEnum.CLASS_IND_Fourteen]: '14',
  [IGDBAgeRatingRatingEnum.CLASS_IND_Sixteen]: '16',
  [IGDBAgeRatingRatingEnum.CLASS_IND_Eighteen]: '18',
  // ACB
  [IGDBAgeRatingRatingEnum.ACB_G]: 'G',
  [IGDBAgeRatingRatingEnum.ACB_PG]: 'PG',
  [IGDBAgeRatingRatingEnum.ACB_M]: 'M',
  [IGDBAgeRatingRatingEnum.ACB_MA15]: 'MA15+',
  [IGDBAgeRatingRatingEnum.ACB_R18]: 'R18+',
  [IGDBAgeRatingRatingEnum.ACB_RC]: 'RC',
};

// -----------------------------------------------------------------------------
// Character Enums
// -----------------------------------------------------------------------------

/**
 * Character Gender
 *
 * @see https://api-docs.igdb.com/#character-gender
 */
export enum IGDBCharacterGenderEnum {
  Male = 0,
  Female = 1,
  Other = 2,
}

export const IGDB_CHARACTER_GENDER_MAP: Record<number, string> = {
  [IGDBCharacterGenderEnum.Male]: 'male',
  [IGDBCharacterGenderEnum.Female]: 'female',
  [IGDBCharacterGenderEnum.Other]: 'other',
};

/**
 * Character Species
 *
 * @see https://api-docs.igdb.com/#character-species
 */
export enum IGDBCharacterSpeciesEnum {
  Human = 1,
  Alien = 2,
  Animal = 3,
  Android = 4,
  Unknown = 5,
}

export const IGDB_CHARACTER_SPECIES_MAP: Record<number, string> = {
  [IGDBCharacterSpeciesEnum.Human]: 'human',
  [IGDBCharacterSpeciesEnum.Alien]: 'alien',
  [IGDBCharacterSpeciesEnum.Animal]: 'animal',
  [IGDBCharacterSpeciesEnum.Android]: 'android',
  [IGDBCharacterSpeciesEnum.Unknown]: 'unknown',
};

// -----------------------------------------------------------------------------
// Company Enums
// -----------------------------------------------------------------------------

/**
 * Company Status
 *
 * The operational status of a company.
 *
 * @see https://api-docs.igdb.com/#company-status
 */
export enum IGDBCompanyStatusEnum {
  Active = 0,
  Defunct = 1,
  Merged = 2,
}

export const IGDB_COMPANY_STATUS_MAP: Record<number, string> = {
  [IGDBCompanyStatusEnum.Active]: 'active',
  [IGDBCompanyStatusEnum.Defunct]: 'defunct',
  [IGDBCompanyStatusEnum.Merged]: 'merged',
};

// -----------------------------------------------------------------------------
// Date Format Enums
// -----------------------------------------------------------------------------

/**
 * Date Format Category
 *
 * The precision/format of a date field.
 *
 * @see https://api-docs.igdb.com/#date-format-category
 */
export enum IGDBDateFormatCategoryEnum {
  YYYYMMMMDD = 0, // Full date (e.g., 2021-01-15)
  YYYYMMMM = 1, // Year and month (e.g., 2021-01)
  YYYY = 2, // Year only (e.g., 2021)
  YYYYQ1 = 3, // Q1 of year
  YYYYQ2 = 4, // Q2 of year
  YYYYQ3 = 5, // Q3 of year
  YYYYQ4 = 6, // Q4 of year
  TBD = 7, // To be determined
}

export const IGDB_DATE_FORMAT_CATEGORY_MAP: Record<number, string> = {
  [IGDBDateFormatCategoryEnum.YYYYMMMMDD]: 'YYYYMMMMDD',
  [IGDBDateFormatCategoryEnum.YYYYMMMM]: 'YYYYMMMM',
  [IGDBDateFormatCategoryEnum.YYYY]: 'YYYY',
  [IGDBDateFormatCategoryEnum.YYYYQ1]: 'YYYYQ1',
  [IGDBDateFormatCategoryEnum.YYYYQ2]: 'YYYYQ2',
  [IGDBDateFormatCategoryEnum.YYYYQ3]: 'YYYYQ3',
  [IGDBDateFormatCategoryEnum.YYYYQ4]: 'YYYYQ4',
  [IGDBDateFormatCategoryEnum.TBD]: 'TBD',
};

// -----------------------------------------------------------------------------
// External Game Enums
// -----------------------------------------------------------------------------

/**
 * External Game Category
 *
 * The source/platform of an external game entry.
 *
 * @see https://api-docs.igdb.com/#external-game-category
 */
export enum IGDBExternalGameCategoryEnum {
  Steam = 1,
  GOG = 5,
  YouTube = 10,
  Microsoft = 11,
  Apple = 13,
  Twitch = 14,
  Android = 15,
  AmazonAsin = 20,
  AmazonLuna = 22,
  AmazonAdg = 23,
  EpicGameStore = 26,
  Oculus = 28,
  Utomik = 29,
  ItchIo = 30,
  XboxMarketplace = 31,
  Kartridge = 32,
  PlaystationStoreUs = 36,
  FocusEntertainment = 37,
  XboxGamePassUltimateCloud = 54,
  Gamejolt = 55,
}

export const IGDB_EXTERNAL_GAME_CATEGORY_MAP: Record<number, string> = {
  [IGDBExternalGameCategoryEnum.Steam]: 'steam',
  [IGDBExternalGameCategoryEnum.GOG]: 'gog',
  [IGDBExternalGameCategoryEnum.YouTube]: 'youtube',
  [IGDBExternalGameCategoryEnum.Microsoft]: 'microsoft',
  [IGDBExternalGameCategoryEnum.Apple]: 'apple',
  [IGDBExternalGameCategoryEnum.Twitch]: 'twitch',
  [IGDBExternalGameCategoryEnum.Android]: 'android',
  [IGDBExternalGameCategoryEnum.AmazonAsin]: 'amazon_asin',
  [IGDBExternalGameCategoryEnum.AmazonLuna]: 'amazon_luna',
  [IGDBExternalGameCategoryEnum.AmazonAdg]: 'amazon_adg',
  [IGDBExternalGameCategoryEnum.EpicGameStore]: 'epic_game_store',
  [IGDBExternalGameCategoryEnum.Oculus]: 'oculus',
  [IGDBExternalGameCategoryEnum.Utomik]: 'utomik',
  [IGDBExternalGameCategoryEnum.ItchIo]: 'itch_io',
  [IGDBExternalGameCategoryEnum.XboxMarketplace]: 'xbox_marketplace',
  [IGDBExternalGameCategoryEnum.Kartridge]: 'kartridge',
  [IGDBExternalGameCategoryEnum.PlaystationStoreUs]: 'playstation_store_us',
  [IGDBExternalGameCategoryEnum.FocusEntertainment]: 'focus_entertainment',
  [IGDBExternalGameCategoryEnum.XboxGamePassUltimateCloud]: 'xbox_game_pass_ultimate_cloud',
  [IGDBExternalGameCategoryEnum.Gamejolt]: 'gamejolt',
};

/**
 * External Game Media (DEPRECATED enum)
 *
 * The media type of an external game.
 *
 * @deprecated Use game_release_format reference instead
 * @see https://api-docs.igdb.com/#external-game
 */
export enum IGDBExternalGameMediaEnum {
  Digital = 1,
  Physical = 2,
}

export const IGDB_EXTERNAL_GAME_MEDIA_MAP: Record<number, string> = {
  [IGDBExternalGameMediaEnum.Digital]: 'digital',
  [IGDBExternalGameMediaEnum.Physical]: 'physical',
};

// -----------------------------------------------------------------------------
// Game Version Feature Enums
// -----------------------------------------------------------------------------

/**
 * Game Version Feature Category
 *
 * The data type of a game version feature.
 *
 * @see https://api-docs.igdb.com/#game-version-feature
 */
export enum IGDBGameVersionFeatureCategoryEnum {
  Boolean = 0,
  Description = 1,
}

export const IGDB_GAME_VERSION_FEATURE_CATEGORY_MAP: Record<number, string> = {
  [IGDBGameVersionFeatureCategoryEnum.Boolean]: 'boolean',
  [IGDBGameVersionFeatureCategoryEnum.Description]: 'description',
};

/**
 * Game Version Included Feature
 *
 * Whether a feature is included in a game version.
 *
 * @see https://api-docs.igdb.com/#game-version-feature-value
 */
export enum IGDBGameVersionIncludedFeatureEnum {
  NotIncluded = 0,
  Included = 1,
  PreOrderOnly = 2,
}

export const IGDB_GAME_VERSION_INCLUDED_FEATURE_MAP: Record<number, string> = {
  [IGDBGameVersionIncludedFeatureEnum.NotIncluded]: 'not_included',
  [IGDBGameVersionIncludedFeatureEnum.Included]: 'included',
  [IGDBGameVersionIncludedFeatureEnum.PreOrderOnly]: 'pre_order_only',
};

// -----------------------------------------------------------------------------
// Game Enums
// -----------------------------------------------------------------------------

/**
 * Game Status
 *
 * The release/development status of a game.
 *
 * @see https://api-docs.igdb.com/#game-status
 */
export enum IGDBGameStatusEnum {
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
  [IGDBGameStatusEnum.Released]: 'released',
  [IGDBGameStatusEnum.Alpha]: 'alpha',
  [IGDBGameStatusEnum.Beta]: 'beta',
  [IGDBGameStatusEnum.EarlyAccess]: 'early_access',
  [IGDBGameStatusEnum.Offline]: 'offline',
  [IGDBGameStatusEnum.Cancelled]: 'cancelled',
  [IGDBGameStatusEnum.Rumored]: 'rumored',
  [IGDBGameStatusEnum.Delisted]: 'delisted',
};

/**
 * Game Type (replaces deprecated `category`)
 *
 * Specifies what type of game entry this is.
 *
 * @see https://api-docs.igdb.com/#game-type
 */
export enum IGDBGameTypeEnum {
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
  [IGDBGameTypeEnum.MainGame]: 'main_game',
  [IGDBGameTypeEnum.DLCAddon]: 'dlc_addon',
  [IGDBGameTypeEnum.Expansion]: 'expansion',
  [IGDBGameTypeEnum.Bundle]: 'bundle',
  [IGDBGameTypeEnum.StandaloneExpansion]: 'standalone_expansion',
  [IGDBGameTypeEnum.Mod]: 'mod',
  [IGDBGameTypeEnum.Episode]: 'episode',
  [IGDBGameTypeEnum.Season]: 'season',
  [IGDBGameTypeEnum.Remake]: 'remake',
  [IGDBGameTypeEnum.Remaster]: 'remaster',
  [IGDBGameTypeEnum.ExpandedGame]: 'expanded_game',
  [IGDBGameTypeEnum.Port]: 'port',
  [IGDBGameTypeEnum.Fork]: 'fork',
  [IGDBGameTypeEnum.Pack]: 'pack',
  [IGDBGameTypeEnum.Update]: 'update',
};

// -----------------------------------------------------------------------------
// Platform Enums
// -----------------------------------------------------------------------------

/**
 * Platform Type
 *
 * The type of platform.
 *
 * @see https://api-docs.igdb.com/#platform-type
 */
export enum IGDBPlatformTypeEnum {
  Console = 1,
  Arcade = 2,
  Platform = 3,
  OperatingSystem = 4,
  PortableConsole = 5,
  Computer = 6,
}

/**
 * Maps IGDB platform types to Strapi platform category enum values
 * Strapi accepts: 'console', 'pc', 'mobile', 'handheld', 'vr'
 */
export const IGDB_PLATFORM_TYPE_MAP: Record<number, string | null> = {
  [IGDBPlatformTypeEnum.Console]: 'console',
  [IGDBPlatformTypeEnum.Arcade]: null, // No direct mapping, skip
  [IGDBPlatformTypeEnum.Platform]: 'mobile', // Platform/mobile devices
  [IGDBPlatformTypeEnum.OperatingSystem]: 'pc', // Windows, macOS, Linux
  [IGDBPlatformTypeEnum.PortableConsole]: 'handheld',
  [IGDBPlatformTypeEnum.Computer]: 'pc',
};

// -----------------------------------------------------------------------------
// Region Enums
// -----------------------------------------------------------------------------

/**
 * Region
 *
 * Geographic region for releases.
 *
 * @see https://api-docs.igdb.com/#region
 */
export enum IGDBRegionEnum {
  Europe = 1,
  NorthAmerica = 2,
  Australia = 3,
  NewZealand = 4,
  Japan = 5,
  China = 6,
  Asia = 7,
  Worldwide = 8,
  Korea = 9,
  Brazil = 10,
}

export const IGDB_REGION_MAP: Record<number, string> = {
  [IGDBRegionEnum.Europe]: 'europe',
  [IGDBRegionEnum.NorthAmerica]: 'north_america',
  [IGDBRegionEnum.Australia]: 'australia',
  [IGDBRegionEnum.NewZealand]: 'new_zealand',
  [IGDBRegionEnum.Japan]: 'japan',
  [IGDBRegionEnum.China]: 'china',
  [IGDBRegionEnum.Asia]: 'asia',
  [IGDBRegionEnum.Worldwide]: 'worldwide',
  [IGDBRegionEnum.Korea]: 'korea',
  [IGDBRegionEnum.Brazil]: 'brazil',
};

// -----------------------------------------------------------------------------
// Release Date Enums
// -----------------------------------------------------------------------------

/**
 * Release Date Status
 *
 * The status/precision of a release date.
 *
 * @see https://api-docs.igdb.com/#release-date-status
 */
export enum IGDBReleaseDateStatusEnum {
  Official = 0,
  Alpha = 2,
  Beta = 3,
  EarlyAccess = 4,
  Offline = 5,
  Cancelled = 6,
  Rumored = 7,
}

export const IGDB_RELEASE_DATE_STATUS_MAP: Record<number, string> = {
  [IGDBReleaseDateStatusEnum.Official]: 'official',
  [IGDBReleaseDateStatusEnum.Alpha]: 'alpha',
  [IGDBReleaseDateStatusEnum.Beta]: 'beta',
  [IGDBReleaseDateStatusEnum.EarlyAccess]: 'early_access',
  [IGDBReleaseDateStatusEnum.Offline]: 'offline',
  [IGDBReleaseDateStatusEnum.Cancelled]: 'cancelled',
  [IGDBReleaseDateStatusEnum.Rumored]: 'rumored',
};

// -----------------------------------------------------------------------------
// Website Enums
// -----------------------------------------------------------------------------

/**
 * Website Category
 *
 * The type/category of a website link.
 *
 * @see https://api-docs.igdb.com/#website-category
 */
export enum IGDBWebsiteCategoryEnum {
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
  [IGDBWebsiteCategoryEnum.Official]: 'official',
  [IGDBWebsiteCategoryEnum.Wikia]: 'wikia',
  [IGDBWebsiteCategoryEnum.Wikipedia]: 'wikipedia',
  [IGDBWebsiteCategoryEnum.Facebook]: 'facebook',
  [IGDBWebsiteCategoryEnum.Twitter]: 'twitter',
  [IGDBWebsiteCategoryEnum.Twitch]: 'twitch',
  [IGDBWebsiteCategoryEnum.Instagram]: 'instagram',
  [IGDBWebsiteCategoryEnum.YouTube]: 'youtube',
  [IGDBWebsiteCategoryEnum.iPhone]: 'iphone',
  [IGDBWebsiteCategoryEnum.iPad]: 'ipad',
  [IGDBWebsiteCategoryEnum.Android]: 'android',
  [IGDBWebsiteCategoryEnum.Steam]: 'steam',
  [IGDBWebsiteCategoryEnum.Reddit]: 'reddit',
  [IGDBWebsiteCategoryEnum.Itch]: 'itch',
  [IGDBWebsiteCategoryEnum.EpicGames]: 'epic',
  [IGDBWebsiteCategoryEnum.GOG]: 'gog',
  [IGDBWebsiteCategoryEnum.Discord]: 'discord',
};

// ============================================================================
// BASE TYPES
// ============================================================================

/**
 * Base interface for all IGDB entities
 *
 * All IGDB entities have an `id` field. Most also have a `checksum` for change detection.
 */
export interface IGDBBaseEntity {
  /** Unique identifier */
  id: number;
  /** Hash of the object for change detection (uuid) */
  checksum?: string;
}

// ============================================================================
// ENDPOINT RESPONSE TYPES (Alphabetical Order)
// ============================================================================
// Types are ordered alphabetically to match the IGDB API documentation.
// @see https://api-docs.igdb.com/#endpoints

// -----------------------------------------------------------------------------
// Age Rating
// https://api-docs.igdb.com/#age-rating
// -----------------------------------------------------------------------------

/**
 * Age Rating
 *
 * Age Rating according to various rating organisations.
 *
 * **Deprecated Fields:**
 * - `category`: Use `organization` instead
 * - `rating`: Use `rating_category` instead
 *
 * @see https://api-docs.igdb.com/#age-rating
 */
export interface IGDBAgeRating extends IGDBBaseEntity {
  /**
   * @deprecated Use `organization` instead
   */
  category?: number;
  /** Array of Age Rating Content Description IDs */
  content_descriptions?: number[] | IGDBAgeRatingContentDescription[];
  /** Reference to the Age Rating Organization */
  organization?: number | IGDBAgeRatingOrganization;
  /**
   * @deprecated Use `rating_category` instead
   */
  rating?: number;
  /** Reference to the Age Rating Category */
  rating_category?: number | IGDBAgeRatingCategory;
  /** Array of Age Rating Content Description V2 IDs */
  rating_content_descriptions?: number[] | IGDBAgeRatingContentDescriptionV2[];
  /** URL to the rating cover/logo image */
  rating_cover_url?: string;
  /** Synopsis/summary of the rating */
  synopsis?: string;
}

// -----------------------------------------------------------------------------
// Age Rating Category
// https://api-docs.igdb.com/#age-rating-category
// -----------------------------------------------------------------------------

/**
 * Age Rating Category
 *
 * The actual rating category (e.g., "M", "18", "T").
 * This replaces the deprecated `rating` enum field.
 *
 * @see https://api-docs.igdb.com/#age-rating-category
 */
export interface IGDBAgeRatingCategory extends IGDBBaseEntity {
  /** Reference to the Age Rating Organization */
  organization?: number | IGDBAgeRatingOrganization;
  /** The rating value/label (e.g., "M", "18", "T") */
  rating: string;
}

// -----------------------------------------------------------------------------
// Age Rating Content Description
// https://api-docs.igdb.com/#age-rating-content-description
// -----------------------------------------------------------------------------

/**
 * Age Rating Content Description
 *
 * Content descriptions explaining why a game received a particular rating.
 *
 * @deprecated Use Age Rating Content Description V2 instead
 * @see https://api-docs.igdb.com/#age-rating-content-description
 */
export interface IGDBAgeRatingContentDescription extends IGDBBaseEntity {
  /** Category of the content description */
  category?: number;
  /** Text description of the content */
  description: string;
}

// -----------------------------------------------------------------------------
// Age Rating Content Description Type
// https://api-docs.igdb.com/#age-rating-content-description-type
// -----------------------------------------------------------------------------

/**
 * Age Rating Content Description Type
 *
 * The type/category of content description.
 *
 * @see https://api-docs.igdb.com/#age-rating-content-description-type
 */
export interface IGDBAgeRatingContentDescriptionType extends IGDBBaseEntity {
  /** Name of the description type */
  name: string;
}

// -----------------------------------------------------------------------------
// Age Rating Content Description V2
// https://api-docs.igdb.com/#age-rating-content-description-v2
// -----------------------------------------------------------------------------

/**
 * Age Rating Content Description V2
 *
 * Updated version of content descriptions with organization reference.
 *
 * @see https://api-docs.igdb.com/#age-rating-content-description-v2
 */
export interface IGDBAgeRatingContentDescriptionV2 extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Text description of the content */
  description: string;
  /** Reference to the Age Rating Organization */
  organization?: number | IGDBAgeRatingOrganization;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Age Rating Organization
// https://api-docs.igdb.com/#age-rating-organization
// -----------------------------------------------------------------------------

/**
 * Age Rating Organization
 *
 * Organizations responsible for issuing age ratings (ESRB, PEGI, CERO, etc.)
 *
 * @see https://api-docs.igdb.com/#age-rating-organization
 */
export interface IGDBAgeRatingOrganization extends IGDBBaseEntity {
  /** Name of the organization (e.g., "ESRB", "PEGI") */
  name: string;
}

// -----------------------------------------------------------------------------
// Alternative Name
// https://api-docs.igdb.com/#alternative-name
// -----------------------------------------------------------------------------

/**
 * Alternative Name
 *
 * Alternative names or aliases for games, useful for search and localization.
 *
 * @see https://api-docs.igdb.com/#alternative-name
 */
export interface IGDBAlternativeName extends IGDBBaseEntity {
  /** Comment about the alternative name */
  comment?: string;
  /** Reference to the Game ID */
  game?: number;
  /** The alternative name */
  name: string;
}

// -----------------------------------------------------------------------------
// Artwork
// https://api-docs.igdb.com/#artwork
// -----------------------------------------------------------------------------

/**
 * Artwork
 *
 * Official artworks such as concept art, key visuals, and promotional art.
 *
 * @see https://api-docs.igdb.com/#artwork
 */
export interface IGDBArtwork extends IGDBBaseEntity {
  /** Whether the image contains alpha channel */
  alpha_channel?: boolean;
  /** Whether the image is animated (GIF) */
  animated?: boolean;
  /** Reference to the Game ID */
  game?: number;
  /** Height of the image in pixels */
  height?: number;
  /** The unique image identifier used to construct the image URL */
  image_id: string;
  /** Full URL to the image */
  url?: string;
  /** Width of the image in pixels */
  width?: number;
}

// -----------------------------------------------------------------------------
// Artwork Type
// https://api-docs.igdb.com/#artwork-type
// -----------------------------------------------------------------------------

/**
 * Artwork Type
 *
 * The type/category of artwork.
 *
 * @see https://api-docs.igdb.com/#artwork-type
 */
export interface IGDBArtworkType extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Name of the artwork type */
  name: string;
  /** URL-friendly slug */
  slug?: string;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Character
// https://api-docs.igdb.com/#character
// -----------------------------------------------------------------------------

/**
 * Character
 *
 * Video game characters.
 *
 * @see https://api-docs.igdb.com/#character
 */
export interface IGDBCharacter extends IGDBBaseEntity {
  /** Array of alternative names/aliases */
  akas?: string[];
  /**
   * Reference to Character Gender entity
   * @see IGDBCharacterGenderEntity
   */
  character_gender?: number | IGDBCharacterGenderEntity;
  /**
   * Reference to Character Species entity
   * @see IGDBCharacterSpeciesEntity
   */
  character_species?: number | IGDBCharacterSpeciesEntity;
  /** Country of origin name */
  country_name?: string;
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Description/biography of the character */
  description?: string;
  /** Array of Game IDs the character appears in */
  games?: number[];
  /**
   * Gender of the character
   * @deprecated Use character_gender reference instead
   * @see IGDBCharacterGenderEnum
   */
  gender?: number;
  /** Reference to the Character Mug Shot */
  mug_shot?: number | IGDBCharacterMugShot;
  /** Name of the character */
  name: string;
  /** URL-friendly slug */
  slug: string;
  /**
   * Species of the character
   * @deprecated Use character_species reference instead
   * @see IGDBCharacterSpeciesEnum
   */
  species?: number;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** IGDB URL */
  url?: string;
}

// -----------------------------------------------------------------------------
// Character Gender (Entity)
// https://api-docs.igdb.com/#character-gender
// -----------------------------------------------------------------------------

/**
 * Character Gender (Entity)
 *
 * Character gender as an entity type (replaces deprecated enum).
 *
 * @see https://api-docs.igdb.com/#character-gender
 */
export interface IGDBCharacterGenderEntity extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Name of the gender */
  name: string;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Character Species (Entity)
// https://api-docs.igdb.com/#character-species
// -----------------------------------------------------------------------------

/**
 * Character Species (Entity)
 *
 * Character species as an entity type (replaces deprecated enum).
 *
 * @see https://api-docs.igdb.com/#character-species
 */
export interface IGDBCharacterSpeciesEntity extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Name of the species */
  name: string;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Character Mug Shot
// https://api-docs.igdb.com/#character-mug-shot
// -----------------------------------------------------------------------------

/**
 * Character Mug Shot
 *
 * Portrait/mug shot images for characters.
 *
 * @see https://api-docs.igdb.com/#character-mug-shot
 */
export interface IGDBCharacterMugShot extends IGDBBaseEntity {
  /** Whether the image contains alpha channel */
  alpha_channel?: boolean;
  /** Whether the image is animated (GIF) */
  animated?: boolean;
  /** Height of the image in pixels */
  height?: number;
  /** The unique image identifier used to construct the image URL */
  image_id: string;
  /** Full URL to the image */
  url?: string;
  /** Width of the image in pixels */
  width?: number;
}

// -----------------------------------------------------------------------------
// Collection
// https://api-docs.igdb.com/#collection
// -----------------------------------------------------------------------------

/**
 * Collection
 *
 * Collection of games (e.g., series like "The Legend of Zelda", "Final Fantasy").
 *
 * @see https://api-docs.igdb.com/#collection
 */
export interface IGDBCollection extends IGDBBaseEntity {
  /** Related collections as child */
  as_child_relations?: number[] | IGDBCollectionRelation[];
  /** Related collections as parent */
  as_parent_relations?: number[] | IGDBCollectionRelation[];
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Array of Game IDs in this collection */
  games?: number[];
  /** Name of the collection */
  name: string;
  /** URL-friendly slug */
  slug: string;
  /** Reference to Collection Type */
  type?: number | IGDBCollectionType;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** IGDB URL */
  url?: string;
}

// -----------------------------------------------------------------------------
// Collection Membership
// https://api-docs.igdb.com/#collection-membership
// -----------------------------------------------------------------------------

/**
 * Collection Membership
 *
 * Represents membership of a game in a collection.
 *
 * @see https://api-docs.igdb.com/#collection-membership
 */
export interface IGDBCollectionMembership extends IGDBBaseEntity {
  /** Reference to the Collection */
  collection?: number | IGDBCollection;
  /** Reference to the Game */
  game?: number;
  /** Reference to the Collection Membership Type */
  type?: number | IGDBCollectionMembershipType;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Collection Membership Type
// https://api-docs.igdb.com/#collection-membership-type
// -----------------------------------------------------------------------------

/**
 * Collection Membership Type
 *
 * Type of membership in a collection.
 *
 * @see https://api-docs.igdb.com/#collection-membership-type
 */
export interface IGDBCollectionMembershipType extends IGDBBaseEntity {
  /** Allowed Collection Type */
  allowed_collection_type?: number | IGDBCollectionType;
  /** Description of the membership type */
  description?: string;
  /** Name of the membership type */
  name: string;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Collection Relation
// https://api-docs.igdb.com/#collection-relation
// -----------------------------------------------------------------------------

/**
 * Collection Relation
 *
 * Relationship between collections.
 *
 * @see https://api-docs.igdb.com/#collection-relation
 */
export interface IGDBCollectionRelation extends IGDBBaseEntity {
  /** Child Collection reference */
  child_collection?: number | IGDBCollection;
  /** Parent Collection reference */
  parent_collection?: number | IGDBCollection;
  /** Reference to Collection Relation Type */
  type?: number | IGDBCollectionRelationType;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Collection Relation Type
// https://api-docs.igdb.com/#collection-relation-type
// -----------------------------------------------------------------------------

/**
 * Collection Relation Type
 *
 * Type of relationship between collections.
 *
 * @see https://api-docs.igdb.com/#collection-relation-type
 */
export interface IGDBCollectionRelationType extends IGDBBaseEntity {
  /** Allowed child Collection Type */
  allowed_child_type?: number | IGDBCollectionType;
  /** Allowed parent Collection Type */
  allowed_parent_type?: number | IGDBCollectionType;
  /** Description of the relation type */
  description?: string;
  /** Name of the relation type */
  name: string;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Collection Type
// https://api-docs.igdb.com/#collection-type
// -----------------------------------------------------------------------------

/**
 * Collection Type
 *
 * Type/category of collection.
 *
 * @see https://api-docs.igdb.com/#collection-type
 */
export interface IGDBCollectionType extends IGDBBaseEntity {
  /** Description of the collection type */
  description?: string;
  /** Name of the collection type */
  name: string;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Company
// https://api-docs.igdb.com/#company
// -----------------------------------------------------------------------------

/**
 * Company
 *
 * Video game companies (developers, publishers).
 *
 * @see https://api-docs.igdb.com/#company
 */
export interface IGDBCompany extends IGDBBaseEntity {
  /** Date the company changed its name (Unix timestamp) */
  change_date?: number;
  /**
   * Category/precision of the change date
   * @deprecated Use change_date_format instead
   */
  change_date_category?: number;
  /** Reference to Date Format for change_date */
  change_date_format?: number | IGDBDateFormat;
  /** Reference to what the company changed to */
  changed_company_id?: number | IGDBCompany;
  /** Country code (ISO 3166-1 numeric) */
  country?: number;
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Text description of the company */
  description?: string;
  /** Array of developed Game IDs */
  developed?: number[];
  /** Reference to the Company Logo */
  logo?: number | IGDBCompanyLogo;
  /** Company name */
  name: string;
  /** Reference to parent Company */
  parent?: number | IGDBCompany;
  /** Array of published Game IDs */
  published?: number[];
  /** URL-friendly slug */
  slug: string;
  /** Date the company was founded (Unix timestamp) */
  start_date?: number;
  /**
   * Category/precision of the start date
   * @deprecated Use start_date_format instead
   */
  start_date_category?: number;
  /** Reference to Date Format for start_date */
  start_date_format?: number | IGDBDateFormat;
  /** Operational status (see IGDBCompanyStatusEnum) */
  status?: number;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** IGDB URL */
  url?: string;
  /** Array of Company Website references */
  websites?: number[] | IGDBCompanyWebsite[];
}

// -----------------------------------------------------------------------------
// Company Logo
// https://api-docs.igdb.com/#company-logo
// -----------------------------------------------------------------------------

/**
 * Company Logo
 *
 * Logo images for companies.
 *
 * @see https://api-docs.igdb.com/#company-logo
 */
export interface IGDBCompanyLogo extends IGDBBaseEntity {
  /** Whether the image contains alpha channel */
  alpha_channel?: boolean;
  /** Whether the image is animated (GIF) */
  animated?: boolean;
  /** Height of the image in pixels */
  height?: number;
  /** The unique image identifier used to construct the image URL */
  image_id: string;
  /** Full URL to the image */
  url?: string;
  /** Width of the image in pixels */
  width?: number;
}

// -----------------------------------------------------------------------------
// Company Website
// https://api-docs.igdb.com/#company-website
// -----------------------------------------------------------------------------

/**
 * Company Website
 *
 * Websites associated with companies.
 *
 * @see https://api-docs.igdb.com/#company-website
 */
export interface IGDBCompanyWebsite extends IGDBBaseEntity {
  /**
   * Category/type of the website
   * @deprecated Use type reference instead
   * @see IGDBWebsiteCategoryEnum
   */
  category?: number;
  /** Whether the website is trusted */
  trusted?: boolean;
  /** Reference to Website Type */
  type?: number | IGDBWebsiteType;
  /** The URL */
  url: string;
}

// -----------------------------------------------------------------------------
// Cover
// https://api-docs.igdb.com/#cover
// -----------------------------------------------------------------------------

/**
 * Cover
 *
 * Cover art/box art for games.
 *
 * @see https://api-docs.igdb.com/#cover
 */
export interface IGDBCover extends IGDBBaseEntity {
  /** Whether the image contains alpha channel */
  alpha_channel?: boolean;
  /** Whether the image is animated (GIF) */
  animated?: boolean;
  /** Reference to the Game ID */
  game?: number;
  /** Reference to the Game Localization ID */
  game_localization?: number;
  /** Height of the image in pixels */
  height?: number;
  /** The unique image identifier used to construct the image URL */
  image_id: string;
  /** Full URL to the image */
  url?: string;
  /** Width of the image in pixels */
  width?: number;
}

// -----------------------------------------------------------------------------
// Date Format
// https://api-docs.igdb.com/#date-format
// -----------------------------------------------------------------------------

/**
 * Date Format
 *
 * Format/precision of release dates.
 *
 * @see https://api-docs.igdb.com/#date-format
 */
export interface IGDBDateFormat extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Format string description */
  format: string;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Event
// https://api-docs.igdb.com/#event
// -----------------------------------------------------------------------------

/**
 * Event
 *
 * Gaming events (E3, Gamescom, TGS, etc.)
 *
 * @see https://api-docs.igdb.com/#event
 */
export interface IGDBEvent extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Description of the event */
  description?: string;
  /** End time (Unix timestamp) */
  end_time?: number;
  /** Reference to the Event Logo */
  event_logo?: number | IGDBEventLogo;
  /** Array of Event Network references */
  event_networks?: number[] | IGDBEventNetwork[];
  /** Array of Game IDs featured at the event */
  games?: number[];
  /** URL to the live stream */
  live_stream_url?: string;
  /** Name of the event */
  name: string;
  /** URL-friendly slug */
  slug: string;
  /** Start time (Unix timestamp) */
  start_time?: number;
  /** Time zone string */
  time_zone?: string;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** Array of Game Video references */
  videos?: number[] | IGDBGameVideo[];
}

// -----------------------------------------------------------------------------
// Event Logo
// https://api-docs.igdb.com/#event-logo
// -----------------------------------------------------------------------------

/**
 * Event Logo
 *
 * Logo images for events.
 *
 * @see https://api-docs.igdb.com/#event-logo
 */
export interface IGDBEventLogo extends IGDBBaseEntity {
  /** Whether the image contains alpha channel */
  alpha_channel?: boolean;
  /** Whether the image is animated (GIF) */
  animated?: boolean;
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Reference to the Event this logo belongs to */
  event?: number | IGDBEvent;
  /** Height of the image in pixels */
  height?: number;
  /** The unique image identifier used to construct the image URL */
  image_id: string;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** Full URL to the image */
  url?: string;
  /** Width of the image in pixels */
  width?: number;
}

// -----------------------------------------------------------------------------
// Event Network
// https://api-docs.igdb.com/#event-network
// -----------------------------------------------------------------------------

/**
 * Event Network
 *
 * Network/platform information for events (streaming platforms).
 *
 * @see https://api-docs.igdb.com/#event-network
 */
export interface IGDBEventNetwork extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Reference to the Event */
  event?: number | IGDBEvent;
  /** Reference to the Network Type */
  network_type?: number | IGDBNetworkType;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** URL to the network stream/page */
  url?: string;
}

// -----------------------------------------------------------------------------
// External Game
// https://api-docs.igdb.com/#external-game
// -----------------------------------------------------------------------------

/**
 * External Game
 *
 * Game references on external platforms (Steam, GOG, Epic, etc.)
 *
 * @see https://api-docs.igdb.com/#external-game
 */
export interface IGDBExternalGame extends IGDBBaseEntity {
  /**
   * Category/source
   * @deprecated Use external_game_source instead
   * @see IGDBExternalGameCategoryEnum
   */
  category?: number;
  /** Array of country codes where available */
  countries?: number[];
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Reference to the External Game Source */
  external_game_source?: number | IGDBExternalGameSource;
  /** Reference to the IGDB Game ID */
  game?: number;
  /** Reference to Game Release Format */
  game_release_format?: number | IGDBGameReleaseFormat;
  /**
   * Media type
   * @deprecated Use game_release_format instead
   * @see IGDBExternalGameMediaEnum
   */
  media?: number;
  /** Name on the external platform */
  name?: string;
  /** Reference to the Platform */
  platform?: number | IGDBPlatform;
  /** The unique identifier on the external platform */
  uid: string;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** URL to the game on the external platform */
  url?: string;
  /** Year of release on the platform */
  year?: number;
}

// -----------------------------------------------------------------------------
// External Game Source
// https://api-docs.igdb.com/#external-game-source
// -----------------------------------------------------------------------------

/**
 * External Game Source
 *
 * Source information for external game entries.
 *
 * @see https://api-docs.igdb.com/#external-game-source
 */
export interface IGDBExternalGameSource extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Name of the source */
  name: string;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Franchise
// https://api-docs.igdb.com/#franchise
// -----------------------------------------------------------------------------

/**
 * Franchise
 *
 * Video game franchises.
 *
 * @see https://api-docs.igdb.com/#franchise
 */
export interface IGDBFranchise extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Array of Game IDs in the franchise */
  games?: number[];
  /** Name of the franchise */
  name: string;
  /** URL-friendly slug */
  slug: string;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** IGDB URL */
  url?: string;
}

// -----------------------------------------------------------------------------
// Game
// https://api-docs.igdb.com/#game
// -----------------------------------------------------------------------------

/**
 * Game
 *
 * Video games! The primary entity containing comprehensive game information.
 *
 * **Deprecated Fields:**
 * - `category`: Use `game_type` instead
 * - `collection`: Use `collections` instead
 * - `follows`: To be removed
 * - `status`: Use `game_status` instead
 *
 * @see https://api-docs.igdb.com/#game
 */
export interface IGDBGame extends IGDBBaseEntity {
  /** Array of Age Rating references */
  age_ratings?: number[] | IGDBAgeRating[];
  /** Aggregated rating from external critics (0-100) */
  aggregated_rating?: number;
  /** Number of external critic scores */
  aggregated_rating_count?: number;
  /** Array of Alternative Name references */
  alternative_names?: number[] | IGDBAlternativeName[];
  /** Array of Artwork references */
  artworks?: number[] | IGDBArtwork[];
  /** Array of Bundle Game IDs (games this is bundled in) */
  bundles?: number[];
  /**
   * Game type category
   * @deprecated Use `game_type` instead
   */
  category?: number;
  /**
   * Collection reference
   * @deprecated Use `collections` instead
   */
  collection?: number | IGDBCollection;
  /** Array of Collection references */
  collections?: number[] | IGDBCollection[];
  /** Reference to the Cover */
  cover?: number | IGDBCover;
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Array of DLC Game IDs */
  dlcs?: number[];
  /** Array of Expanded Game IDs */
  expanded_games?: number[];
  /** Array of Expansion Game IDs */
  expansions?: number[];
  /** Array of External Game references */
  external_games?: number[] | IGDBExternalGame[];
  /** First release date (Unix timestamp) */
  first_release_date?: number;
  /**
   * Follows count
   * @deprecated To be removed
   */
  follows?: number;
  /** Array of Fork Game IDs */
  forks?: number[];
  /** Reference to the main Franchise */
  franchise?: number | IGDBFranchise;
  /** Array of Franchise references */
  franchises?: number[] | IGDBFranchise[];
  /** Array of Game Engine references */
  game_engines?: number[] | IGDBGameEngine[];
  /** Array of Game Localization references */
  game_localizations?: number[] | IGDBGameLocalization[];
  /** Array of Game Mode references */
  game_modes?: number[] | IGDBGameMode[];
  /** Game status (see IGDBGameStatusEnum) */
  game_status?: number;
  /** Reference to Game Type */
  game_type?: number | IGDBGameType;
  /** Array of Genre references */
  genres?: number[] | IGDBGenre[];
  /** Hype count (followers before release) */
  hypes?: number;
  /** Array of Involved Company references */
  involved_companies?: number[] | IGDBInvolvedCompany[];
  /** Array of Keyword references */
  keywords?: number[] | IGDBKeyword[];
  /** Array of Language Support references */
  language_supports?: number[] | IGDBLanguageSupport[];
  /** Array of Multiplayer Mode references */
  multiplayer_modes?: number[] | IGDBMultiplayerMode[];
  /** Name of the game */
  name: string;
  /** Reference to the parent Game */
  parent_game?: number;
  /** Array of Platform references */
  platforms?: number[] | IGDBPlatform[];
  /** Array of Player Perspective references */
  player_perspectives?: number[] | IGDBPlayerPerspective[];
  /** Array of Port Game IDs */
  ports?: number[];
  /** User rating (0-100) */
  rating?: number;
  /** Number of user ratings */
  rating_count?: number;
  /** Array of Release Date references */
  release_dates?: number[] | IGDBReleaseDate[];
  /** Array of Remake Game IDs */
  remakes?: number[];
  /** Array of Remaster Game IDs */
  remasters?: number[];
  /** Array of Screenshot references */
  screenshots?: number[] | IGDBScreenshot[];
  /** Array of Similar Game IDs */
  similar_games?: number[];
  /** URL-friendly slug */
  slug: string;
  /** Array of Standalone Expansion Game IDs */
  standalone_expansions?: number[];
  /**
   * Development status
   * @deprecated Use `game_status` instead
   */
  status?: number;
  /** Storyline/plot summary */
  storyline?: string;
  /** Short description/summary */
  summary?: string;
  /** Array of tag numbers */
  tags?: number[];
  /** Array of Theme references */
  themes?: number[] | IGDBTheme[];
  /** Average of user and critic ratings (0-100) */
  total_rating?: number;
  /** Total number of ratings */
  total_rating_count?: number;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** IGDB URL */
  url?: string;
  /** Reference to version parent Game */
  version_parent?: number;
  /** Version title */
  version_title?: string;
  /** Array of Game Video references */
  videos?: number[] | IGDBGameVideo[];
  /** Array of Website references */
  websites?: number[] | IGDBWebsite[];
}

// -----------------------------------------------------------------------------
// Game Engine
// https://api-docs.igdb.com/#game-engine
// -----------------------------------------------------------------------------

/**
 * Game Engine
 *
 * Video game engines (Unreal, Unity, Source, etc.)
 *
 * @see https://api-docs.igdb.com/#game-engine
 */
export interface IGDBGameEngine extends IGDBBaseEntity {
  /** Array of Company IDs that made/own the engine */
  companies?: number[] | IGDBCompany[];
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Description of the engine */
  description?: string;
  /** Reference to the Game Engine Logo */
  logo?: number | IGDBGameEngineLogo;
  /** Name of the engine */
  name: string;
  /** Array of Platform IDs the engine supports */
  platforms?: number[] | IGDBPlatform[];
  /** URL-friendly slug */
  slug: string;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** Official URL */
  url?: string;
}

// -----------------------------------------------------------------------------
// Game Engine Logo
// https://api-docs.igdb.com/#game-engine-logo
// -----------------------------------------------------------------------------

/**
 * Game Engine Logo
 *
 * Logo images for game engines.
 *
 * @see https://api-docs.igdb.com/#game-engine-logo
 */
export interface IGDBGameEngineLogo extends IGDBBaseEntity {
  /** Whether the image contains alpha channel */
  alpha_channel?: boolean;
  /** Whether the image is animated (GIF) */
  animated?: boolean;
  /** Height of the image in pixels */
  height?: number;
  /** The unique image identifier used to construct the image URL */
  image_id: string;
  /** Full URL to the image */
  url?: string;
  /** Width of the image in pixels */
  width?: number;
}

// -----------------------------------------------------------------------------
// Game Localization
// https://api-docs.igdb.com/#game-localization
// -----------------------------------------------------------------------------

/**
 * Game Localization
 *
 * Localized versions of games.
 *
 * @see https://api-docs.igdb.com/#game-localization
 */
export interface IGDBGameLocalization extends IGDBBaseEntity {
  /** Reference to the localized Cover */
  cover?: number | IGDBCover;
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Reference to the Game ID */
  game?: number;
  /** Localized name of the game */
  name: string;
  /** Reference to the Region */
  region?: number | IGDBRegion;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Game Mode
// https://api-docs.igdb.com/#game-mode
// -----------------------------------------------------------------------------

/**
 * Game Mode
 *
 * Game modes (Single player, Multiplayer, Co-op, etc.)
 *
 * @see https://api-docs.igdb.com/#game-mode
 */
export interface IGDBGameMode extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Name of the game mode */
  name: string;
  /** URL-friendly slug */
  slug: string;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** IGDB URL */
  url?: string;
}

// -----------------------------------------------------------------------------
// Game Release Format
// https://api-docs.igdb.com/#game-release-format
// -----------------------------------------------------------------------------

/**
 * Game Release Format
 *
 * Format of game releases (Digital, Physical, etc.)
 *
 * @see https://api-docs.igdb.com/#game-release-format
 */
export interface IGDBGameReleaseFormat extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** The format/medium of the game release */
  format: string;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Game Status (Entity)
// https://api-docs.igdb.com/#game-status
// -----------------------------------------------------------------------------

/**
 * Game Status (Entity)
 *
 * Status of game development as an entity type.
 *
 * @see https://api-docs.igdb.com/#game-status
 */
export interface IGDBGameStatusEntity extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** The release status of the game */
  status: string;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Game Time To Beat
// https://api-docs.igdb.com/#game-time-to-beat
// -----------------------------------------------------------------------------

/**
 * Game Time To Beat
 *
 * Estimated times to complete games.
 *
 * @see https://api-docs.igdb.com/#game-time-to-beat
 */
export interface IGDBGameTimeToBeat extends IGDBBaseEntity {
  /** Time to complete everything (seconds) */
  completely?: number;
  /** Total number of time to beat submissions */
  count?: number;
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Reference to the Game ID */
  game_id?: number;
  /** Time to beat hastily (seconds) */
  hastily?: number;
  /** Time to beat normally (seconds) */
  normally?: number;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Game Type (Entity)
// https://api-docs.igdb.com/#game-type
// -----------------------------------------------------------------------------

/**
 * Game Type (Entity)
 *
 * Type of game entry (Main game, DLC, Expansion, etc.) as an entity type.
 *
 * @see https://api-docs.igdb.com/#game-type
 */
export interface IGDBGameType extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Type identifier string */
  type: string;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Game Version
// https://api-docs.igdb.com/#game-version
// -----------------------------------------------------------------------------

/**
 * Game Version
 *
 * Different versions of a game (Standard, Deluxe, GOTY, etc.)
 *
 * @see https://api-docs.igdb.com/#game-version
 */
export interface IGDBGameVersion extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Array of Game Version Feature references */
  features?: number[] | IGDBGameVersionFeature[];
  /** Reference to the Game */
  game?: number;
  /** Array of Game IDs included in this version */
  games?: number[];
  /** Unix timestamp of last update */
  updated_at?: number;
  /** URL */
  url?: string;
}

// -----------------------------------------------------------------------------
// Game Version Feature
// https://api-docs.igdb.com/#game-version-feature
// -----------------------------------------------------------------------------

/**
 * Game Version Feature
 *
 * Features available in specific game versions.
 *
 * @see https://api-docs.igdb.com/#game-version-feature
 */
export interface IGDBGameVersionFeature extends IGDBBaseEntity {
  /** Category of the feature */
  category?: number;
  /** Description of the feature */
  description?: string;
  /** Position/order of the feature */
  position?: number;
  /** Title of the feature */
  title?: string;
  /** Array of Game Version Feature Value references */
  values?: number[] | IGDBGameVersionFeatureValue[];
}

// -----------------------------------------------------------------------------
// Game Version Feature Value
// https://api-docs.igdb.com/#game-version-feature-value
// -----------------------------------------------------------------------------

/**
 * Game Version Feature Value
 *
 * Values for game version features.
 *
 * @see https://api-docs.igdb.com/#game-version-feature-value
 */
export interface IGDBGameVersionFeatureValue extends IGDBBaseEntity {
  /** Reference to the Game */
  game?: number;
  /** Reference to the Game Version Feature */
  game_feature?: number | IGDBGameVersionFeature;
  /** Whether this feature is included in the version */
  included_feature?: number;
  /** Notes about the feature value */
  note?: string;
}

// -----------------------------------------------------------------------------
// Game Video
// https://api-docs.igdb.com/#game-video
// -----------------------------------------------------------------------------

/**
 * Game Video
 *
 * Videos related to games (trailers, gameplay, etc.)
 *
 * @see https://api-docs.igdb.com/#game-video
 */
export interface IGDBGameVideo extends IGDBBaseEntity {
  /** Reference to the Game ID */
  game?: number;
  /** Name/title of the video */
  name?: string;
  /** YouTube video ID */
  video_id: string;
}

// -----------------------------------------------------------------------------
// Genre
// https://api-docs.igdb.com/#genre
// -----------------------------------------------------------------------------

/**
 * Genre
 *
 * Video game genres (Action, Adventure, RPG, etc.)
 *
 * @see https://api-docs.igdb.com/#genre
 */
export interface IGDBGenre extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Name of the genre */
  name: string;
  /** URL-friendly slug */
  slug: string;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** IGDB URL */
  url?: string;
}

// -----------------------------------------------------------------------------
// Involved Company
// https://api-docs.igdb.com/#involved-company
// -----------------------------------------------------------------------------

/**
 * Involved Company
 *
 * Represents a company's involvement in a game.
 *
 * @see https://api-docs.igdb.com/#involved-company
 */
export interface IGDBInvolvedCompany extends IGDBBaseEntity {
  /** Reference to the Company */
  company: number | IGDBCompany;
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Whether the company was a developer */
  developer: boolean;
  /** Reference to the Game ID */
  game?: number;
  /** Whether the company handled porting */
  porting?: boolean;
  /** Whether the company was a publisher */
  publisher: boolean;
  /** Whether the company provided support */
  supporting?: boolean;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Keyword
// https://api-docs.igdb.com/#keyword
// -----------------------------------------------------------------------------

/**
 * Keyword
 *
 * Keywords/tags associated with games.
 *
 * @see https://api-docs.igdb.com/#keyword
 */
export interface IGDBKeyword extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Name of the keyword */
  name: string;
  /** URL-friendly slug */
  slug: string;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** IGDB URL */
  url?: string;
}

// -----------------------------------------------------------------------------
// Language
// https://api-docs.igdb.com/#language
// -----------------------------------------------------------------------------

/**
 * Language
 *
 * Languages supported by games.
 *
 * @see https://api-docs.igdb.com/#language
 */
export interface IGDBLanguage extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Locale code (e.g., "en-US") */
  locale?: string;
  /** Name of the language */
  name: string;
  /** Native name of the language */
  native_name?: string;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Language Support
// https://api-docs.igdb.com/#language-support
// -----------------------------------------------------------------------------

/**
 * Language Support
 *
 * Language support information for games.
 *
 * @see https://api-docs.igdb.com/#language-support
 */
export interface IGDBLanguageSupport extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Reference to the Game ID */
  game?: number;
  /** Reference to the Language */
  language?: number | IGDBLanguage;
  /** Reference to the Language Support Type */
  language_support_type?: number | IGDBLanguageSupportType;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Language Support Type
// https://api-docs.igdb.com/#language-support-type
// -----------------------------------------------------------------------------

/**
 * Language Support Type
 *
 * Type of language support (Audio, Subtitles, Interface).
 *
 * @see https://api-docs.igdb.com/#language-support-type
 */
export interface IGDBLanguageSupportType extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Name of the support type */
  name: string;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Multiplayer Mode
// https://api-docs.igdb.com/#multiplayer-mode
// -----------------------------------------------------------------------------

/**
 * Multiplayer Mode
 *
 * Detailed multiplayer mode information.
 *
 * @see https://api-docs.igdb.com/#multiplayer-mode
 */
export interface IGDBMultiplayerMode extends IGDBBaseEntity {
  /** Whether the game has a campaign co-op mode */
  campaigncoop?: boolean;
  /** Whether the game has drop-in/drop-out multiplayer */
  dropin?: boolean;
  /** Reference to the Game ID */
  game?: number;
  /** Whether the game supports LAN co-op */
  lancoop?: boolean;
  /** Whether the game supports offline co-op */
  offlinecoop?: boolean;
  /** Maximum number of offline co-op players */
  offlinecoopmax?: number;
  /** Maximum number of offline players */
  offlinemax?: number;
  /** Whether the game supports online co-op */
  onlinecoop?: boolean;
  /** Maximum number of online co-op players */
  onlinecoopmax?: number;
  /** Maximum number of online players */
  onlinemax?: number;
  /** Reference to the Platform */
  platform?: number | IGDBPlatform;
  /** Whether the game supports split screen */
  splitscreen?: boolean;
  /** Whether the game supports split screen online */
  splitscreenonline?: boolean;
}

// -----------------------------------------------------------------------------
// Network Type
// https://api-docs.igdb.com/#network-type
// -----------------------------------------------------------------------------

/**
 * Network Type
 *
 * Type of network (Twitch, YouTube, etc.) for event streaming.
 *
 * @see https://api-docs.igdb.com/#network-type
 */
export interface IGDBNetworkType extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Array of Event Network references using this type */
  event_networks?: number[] | IGDBEventNetwork[];
  /** Name of the network type */
  name: string;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Platform
// https://api-docs.igdb.com/#platform
// -----------------------------------------------------------------------------

/**
 * Platform
 *
 * Gaming platforms (PlayStation, Xbox, PC, Nintendo Switch, etc.)
 *
 * @see https://api-docs.igdb.com/#platform
 */
export interface IGDBPlatform extends IGDBBaseEntity {
  /** Abbreviation (e.g., "PS5", "XSX", "NSW") */
  abbreviation?: string;
  /** Alternative name */
  alternative_name?: string;
  /**
   * Category/type of platform
   * @deprecated Use platform_type instead
   * @see IGDBPlatformTypeEnum
   */
  category?: number;
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Generation (e.g., 9 for PS5/Xbox Series X) */
  generation?: number;
  /** Name of the platform */
  name: string;
  /** Reference to the Platform Family */
  platform_family?: number | IGDBPlatformFamily;
  /** Reference to the Platform Logo */
  platform_logo?: number | IGDBPlatformLogo;
  /** Reference to Platform Type entity */
  platform_type?: number | IGDBPlatformTypeEntity;
  /** URL-friendly slug */
  slug: string;
  /** Summary description */
  summary?: string;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** IGDB URL */
  url?: string;
  /** Array of Platform Version references */
  versions?: number[] | IGDBPlatformVersion[];
  /** Array of Platform Website references */
  websites?: number[] | IGDBPlatformWebsite[];
}

// -----------------------------------------------------------------------------
// Platform Family
// https://api-docs.igdb.com/#platform-family
// -----------------------------------------------------------------------------

/**
 * Platform Family
 *
 * Platform families (PlayStation, Xbox, Nintendo).
 *
 * @see https://api-docs.igdb.com/#platform-family
 */
export interface IGDBPlatformFamily extends IGDBBaseEntity {
  /** Name of the platform family */
  name: string;
  /** URL-friendly slug */
  slug: string;
}

// -----------------------------------------------------------------------------
// Platform Type (Entity)
// https://api-docs.igdb.com/#platform-type
// -----------------------------------------------------------------------------

/**
 * Platform Type (Entity)
 *
 * Platform type as an entity (replaces deprecated category enum).
 *
 * @see https://api-docs.igdb.com/#platform-type
 */
export interface IGDBPlatformTypeEntity extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Name of the platform type */
  name: string;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Platform Logo
// https://api-docs.igdb.com/#platform-logo
// -----------------------------------------------------------------------------

/**
 * Platform Logo
 *
 * Logo images for platforms.
 *
 * @see https://api-docs.igdb.com/#platform-logo
 */
export interface IGDBPlatformLogo extends IGDBBaseEntity {
  /** Whether the image contains alpha channel */
  alpha_channel?: boolean;
  /** Whether the image is animated (GIF) */
  animated?: boolean;
  /** Height of the image in pixels */
  height?: number;
  /** The unique image identifier used to construct the image URL */
  image_id: string;
  /** Full URL to the image */
  url?: string;
  /** Width of the image in pixels */
  width?: number;
}

// -----------------------------------------------------------------------------
// Platform Version
// https://api-docs.igdb.com/#platform-version
// -----------------------------------------------------------------------------

/**
 * Platform Version
 *
 * Versions/revisions of platforms (PS4 Pro, Xbox One X, etc.)
 *
 * @see https://api-docs.igdb.com/#platform-version
 */
export interface IGDBPlatformVersion extends IGDBBaseEntity {
  /** Array of Platform Version Company references */
  companies?: number[] | IGDBPlatformVersionCompany[];
  /** Connectivity details */
  connectivity?: string;
  /** CPU specifications */
  cpu?: string;
  /** Graphics specifications */
  graphics?: string;
  /** Main manufacturer reference */
  main_manufacturer?: number | IGDBPlatformVersionCompany;
  /** Media type */
  media?: string;
  /** Memory specifications */
  memory?: string;
  /** Name of the version */
  name: string;
  /** Online service (e.g., Xbox Live) */
  online?: string;
  /** Operating system */
  os?: string;
  /** Output specifications */
  output?: string;
  /** Reference to the Platform Logo */
  platform_logo?: number | IGDBPlatformLogo;
  /** Array of Platform Version Release Date references */
  platform_version_release_dates?: number[] | IGDBPlatformVersionReleaseDate[];
  /** Resolutions supported */
  resolutions?: string;
  /** URL-friendly slug */
  slug: string;
  /** Sound specifications */
  sound?: string;
  /** Storage specifications */
  storage?: string;
  /** Summary description */
  summary?: string;
  /** IGDB URL */
  url?: string;
}

// -----------------------------------------------------------------------------
// Platform Version Company
// https://api-docs.igdb.com/#platform-version-company
// -----------------------------------------------------------------------------

/**
 * Platform Version Company
 *
 * Companies associated with platform versions.
 *
 * @see https://api-docs.igdb.com/#platform-version-company
 */
export interface IGDBPlatformVersionCompany extends IGDBBaseEntity {
  /** Comment about the company's role */
  comment?: string;
  /** Reference to the Company */
  company?: number | IGDBCompany;
  /** Whether they were the developer */
  developer?: boolean;
  /** Whether they were the manufacturer */
  manufacturer?: boolean;
}

// -----------------------------------------------------------------------------
// Platform Version Release Date
// https://api-docs.igdb.com/#platform-version-release-date
// -----------------------------------------------------------------------------

/**
 * Platform Version Release Date
 *
 * Release dates for platform versions.
 *
 * @see https://api-docs.igdb.com/#platform-version-release-date
 */
export interface IGDBPlatformVersionReleaseDate extends IGDBBaseEntity {
  /**
   * Category/precision of the date
   * @deprecated Use date_format instead
   * @see IGDBDateFormatCategoryEnum
   */
  category?: number;
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Release date (Unix timestamp) */
  date?: number;
  /** Reference to Date Format */
  date_format?: number | IGDBDateFormat;
  /** Human-readable date */
  human?: string;
  /** Month of release (1-12) */
  m?: number;
  /** Reference to the Platform Version */
  platform_version?: number | IGDBPlatformVersion;
  /**
   * Region enum value
   * @deprecated Use release_region instead
   * @see IGDBRegionEnum
   */
  region?: number;
  /** Reference to Release Date Region */
  release_region?: number | IGDBReleaseDateRegion;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** Year of release */
  y?: number;
}

// -----------------------------------------------------------------------------
// Platform Website
// https://api-docs.igdb.com/#platform-website
// -----------------------------------------------------------------------------

/**
 * Platform Website
 *
 * Websites associated with platforms.
 *
 * @see https://api-docs.igdb.com/#platform-website
 */
export interface IGDBPlatformWebsite extends IGDBBaseEntity {
  /** Category/type of website (see IGDBWebsiteCategoryEnum) */
  category?: number;
  /** Whether the website is trusted */
  trusted?: boolean;
  /** The URL */
  url: string;
}

// -----------------------------------------------------------------------------
// Player Perspective
// https://api-docs.igdb.com/#player-perspective
// -----------------------------------------------------------------------------

/**
 * Player Perspective
 *
 * Player perspectives (First-person, Third-person, Isometric, etc.)
 *
 * @see https://api-docs.igdb.com/#player-perspective
 */
export interface IGDBPlayerPerspective extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Name of the perspective */
  name: string;
  /** URL-friendly slug */
  slug: string;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** IGDB URL */
  url?: string;
}

// -----------------------------------------------------------------------------
// Popularity Primitive
// https://api-docs.igdb.com/#popularity-primitive
// -----------------------------------------------------------------------------

/**
 * Popularity Primitive
 *
 * Popularity data for games.
 *
 * @see https://api-docs.igdb.com/#popularity-primitive
 */
export interface IGDBPopularityPrimitive extends IGDBBaseEntity {
  /** Reference to the Game ID */
  game_id?: number;
  /** Reference to Popularity Type */
  popularity_type?: number;
  /** Popularity value */
  value?: number;
}

// -----------------------------------------------------------------------------
// Popularity Type
// https://api-docs.igdb.com/#popularity-type
// -----------------------------------------------------------------------------

/**
 * Popularity Type
 *
 * Types of popularity metrics.
 *
 * @see https://api-docs.igdb.com/#popularity-type
 */
export interface IGDBPopularityType extends IGDBBaseEntity {
  /** Name of the popularity type */
  name: string;
}

// -----------------------------------------------------------------------------
// Region
// https://api-docs.igdb.com/#region
// -----------------------------------------------------------------------------

/**
 * Region
 *
 * Geographic regions for game releases.
 *
 * @see https://api-docs.igdb.com/#region
 */
export interface IGDBRegion extends IGDBBaseEntity {
  /** Category of the region (locale, continent) */
  category?: string;
  /** Region identifier */
  identifier?: string;
  /** Name of the region */
  name: string;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Release Date
// https://api-docs.igdb.com/#release-date
// -----------------------------------------------------------------------------

/**
 * Release Date
 *
 * Release dates for games on specific platforms/regions.
 *
 * @see https://api-docs.igdb.com/#release-date
 */
export interface IGDBReleaseDate extends IGDBBaseEntity {
  /**
   * Category/precision of the date
   * @deprecated Use date_format instead
   * @see IGDBDateFormatCategoryEnum
   */
  category?: number;
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Release date (Unix timestamp) */
  date?: number;
  /** Reference to Date Format */
  date_format?: number | IGDBDateFormat;
  /** Reference to the Game ID */
  game?: number;
  /** Human-readable date string */
  human?: string;
  /** Month of release (1-12) */
  m?: number;
  /** Reference to the Platform */
  platform?: number | IGDBPlatform;
  /**
   * Region enum value
   * @deprecated Use release_region instead
   * @see IGDBRegionEnum
   */
  region?: number;
  /** Reference to Release Date Region */
  release_region?: number | IGDBReleaseDateRegion;
  /** Reference to Release Date Status */
  status?: number | IGDBReleaseDateStatus;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** Year of release */
  y?: number;
}

// -----------------------------------------------------------------------------
// Release Date Region
// https://api-docs.igdb.com/#release-date-region
// -----------------------------------------------------------------------------

/**
 * Release Date Region
 *
 * Region entity for release dates (replaces deprecated region enum).
 *
 * @see https://api-docs.igdb.com/#release-date-region
 */
export interface IGDBReleaseDateRegion extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Region identifier (e.g., "europe", "north_america") */
  region: string;
  /** Unix timestamp of last update */
  updated_at?: number;
}

// -----------------------------------------------------------------------------
// Release Date Status
// https://api-docs.igdb.com/#release-date-status
// -----------------------------------------------------------------------------

/**
 * Release Date Status
 *
 * Status type for release dates.
 *
 * @see https://api-docs.igdb.com/#release-date-status
 */
export interface IGDBReleaseDateStatus extends IGDBBaseEntity {
  /** Description of the status */
  description?: string;
  /** Name of the status */
  name: string;
}

// -----------------------------------------------------------------------------
// Screenshot
// https://api-docs.igdb.com/#screenshot
// -----------------------------------------------------------------------------

/**
 * Screenshot
 *
 * In-game screenshots.
 *
 * @see https://api-docs.igdb.com/#screenshot
 */
export interface IGDBScreenshot extends IGDBBaseEntity {
  /** Whether the image contains alpha channel */
  alpha_channel?: boolean;
  /** Whether the image is animated (GIF) */
  animated?: boolean;
  /** Reference to the Game ID */
  game?: number;
  /** Height of the image in pixels */
  height?: number;
  /** The unique image identifier used to construct the image URL */
  image_id: string;
  /** Full URL to the image */
  url?: string;
  /** Width of the image in pixels */
  width?: number;
}

// -----------------------------------------------------------------------------
// Search
// https://api-docs.igdb.com/#search
// -----------------------------------------------------------------------------

/**
 * Search Result
 *
 * Result from the search endpoint. Can match various entity types.
 *
 * @see https://api-docs.igdb.com/#search
 */
export interface IGDBSearchResult extends IGDBBaseEntity {
  /** Alternative name if matched */
  alternative_name?: string;
  /** Reference to Character (if character result) */
  character?: number | IGDBCharacter;
  /** Reference to Collection (if collection result) */
  collection?: number | IGDBCollection;
  /** Reference to Company (if company result) */
  company?: number | IGDBCompany;
  /** Description excerpt */
  description?: string;
  /** Reference to Game (if game result) */
  game?: number | IGDBGame;
  /** Name of the result */
  name: string;
  /** Reference to Platform (if platform result) */
  platform?: number | IGDBPlatform;
  /** Popularity score */
  popularity?: number;
  /** Published date (Unix timestamp) */
  published_at?: number;
  /** Reference to test dummy (for testing) */
  test_dummy?: number;
  /** Reference to Theme (if theme result) */
  theme?: number | IGDBTheme;
}

// -----------------------------------------------------------------------------
// Theme
// https://api-docs.igdb.com/#theme
// -----------------------------------------------------------------------------

/**
 * Theme
 *
 * Game themes (Fantasy, Sci-Fi, Horror, Comedy, etc.)
 *
 * @see https://api-docs.igdb.com/#theme
 */
export interface IGDBTheme extends IGDBBaseEntity {
  /** Unix timestamp of creation date */
  created_at?: number;
  /** Name of the theme */
  name: string;
  /** URL-friendly slug */
  slug: string;
  /** Unix timestamp of last update */
  updated_at?: number;
  /** IGDB URL */
  url?: string;
}

// -----------------------------------------------------------------------------
// Website
// https://api-docs.igdb.com/#website
// -----------------------------------------------------------------------------

/**
 * Website
 *
 * Websites related to games.
 *
 * @see https://api-docs.igdb.com/#website
 */
export interface IGDBWebsite extends IGDBBaseEntity {
  /** Category/type of the website (see IGDBWebsiteCategoryEnum) */
  category?: number;
  /** Reference to the Game ID */
  game?: number;
  /** Whether the website is trusted */
  trusted?: boolean;
  /** The URL */
  url: string;
}

// -----------------------------------------------------------------------------
// Website Type
// https://api-docs.igdb.com/#website-type
// -----------------------------------------------------------------------------

/**
 * Website Type
 *
 * Types of websites.
 *
 * @see https://api-docs.igdb.com/#website-type
 */
export interface IGDBWebsiteType extends IGDBBaseEntity {
  /** Type identifier */
  type: string;
}

// ============================================================================
// HELPER TYPES & UTILITIES
// ============================================================================

// -----------------------------------------------------------------------------
// Simplified Response Types
// -----------------------------------------------------------------------------

/**
 * Game (Basic)
 *
 * Simplified game response for search results and lists.
 */
export interface IGDBGameBasic {
  id: number;
  name: string;
  slug?: string;
  cover?: IGDBCover;
  first_release_date?: number;
  platforms?: IGDBPlatform[];
  rating?: number;
  total_rating?: number;
  hypes?: number;
}

/**
 * Platform (Basic)
 *
 * Simplified platform response.
 */
export interface IGDBPlatformBasic {
  id: number;
  name: string;
  abbreviation?: string;
  slug?: string;
}

/**
 * Company (Basic)
 *
 * Simplified company response.
 */
export interface IGDBCompanyBasic {
  id: number;
  name: string;
  slug?: string;
  logo?: IGDBCompanyLogo;
}

// -----------------------------------------------------------------------------
// API Error Types
// -----------------------------------------------------------------------------

/**
 * API Error
 *
 * Error response from the IGDB API.
 */
export interface IGDBApiError {
  /** HTTP status code */
  status?: number;
  /** Error title */
  title?: string;
  /** Error cause/reason */
  cause?: string;
  /** Detailed error messages */
  details?: string[];
}

// -----------------------------------------------------------------------------
// Query Options
// -----------------------------------------------------------------------------

/**
 * Query Options
 *
 * Options for building IGDB API queries.
 */
export interface IGDBQueryOptions {
  /** Fields to return (comma-separated or array) */
  fields?: string | string[];
  /** Filter conditions (where clause) */
  where?: string;
  /** Sort order (e.g., "rating desc") */
  sort?: string;
  /** Maximum results to return (default: 10, max: 500) */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Search query string */
  search?: string;
  /** Exclude specific entity IDs */
  exclude?: number[];
}

// -----------------------------------------------------------------------------
// Image Utilities
// -----------------------------------------------------------------------------

/**
 * Image Size
 *
 * Available image sizes for IGDB images.
 *
 * @see https://api-docs.igdb.com/#images
 */
export type IGDBImageSize =
  | 'cover_small' // 90x128
  | 'cover_big' // 264x374
  | 'screenshot_med' // 569x320
  | 'screenshot_big' // 889x500
  | 'screenshot_huge' // 1280x720
  | 'logo_med' // 284x160
  | 'thumb' // 90x90
  | 'micro' // 35x35
  | '720p' // 1280x720
  | '1080p'; // 1920x1080

/**
 * Build IGDB image URL
 *
 * Helper to construct image URLs from image_id.
 *
 * @param imageId - The image_id from an IGDB image response
 * @param size - The desired image size
 * @returns Full URL to the image
 *
 * @example
 * ```typescript
 * const url = buildIGDBImageUrl('abc123', 'cover_big');
 * // Returns: "https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg"
 * ```
 */
export function buildIGDBImageUrl(imageId: string, size: IGDBImageSize = 'cover_big'): string {
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
}

// -----------------------------------------------------------------------------
// Authentication Types
// -----------------------------------------------------------------------------

/**
 * Twitch OAuth Response
 *
 * Response from Twitch OAuth token endpoint.
 * Required for IGDB API authentication.
 *
 * @see https://api-docs.igdb.com/#authentication
 */
export interface TwitchAuthResponse {
  /** The access token */
  access_token: string;
  /** Token lifetime in seconds */
  expires_in: number;
  /** Token type (always "bearer") */
  token_type: string;
}
