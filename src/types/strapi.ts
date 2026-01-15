/**
 * Strapi Document Service Types
 * 
 * These types help with Strapi 5's document service API.
 * They provide proper typing for CRUD operations on content types.
 */

/**
 * Base document with common Strapi fields
 */
export interface StrapiDocument {
  id: number;
  documentId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  locale: string;
}

/**
 * Keyword document
 */
export interface KeywordDocument extends StrapiDocument {
  name: string;
  slug: string;
  igdbId: number | null;
}

/**
 * Multiplayer mode data stored as JSON
 */
export interface MultiplayerModeData {
  platform?: string;
  campaignCoop: boolean;
  onlineCoop: boolean;
  offlineCoop: boolean;
  onlineMax: number | null;
  offlineMax: number | null;
  splitscreen: boolean;
  dropIn: boolean;
}

/**
 * Game document
 */
export interface GameDocument extends StrapiDocument {
  name: string;
  slug: string;
  description: string | null;
  releaseDate: string | null;
  gameCategory: string;
  gameStatus: string;
  coverImageUrl: string | null;
  screenshotUrls: string[] | null;
  trailerIds: string[] | null;
  metacriticScore: number | null;
  userRating: number | null;
  userRatingCount: number | null;
  totalRating: number | null;
  totalRatingCount: number | null;
  hypes: number | null;
  // keywords is a relation, populated separately
  multiplayerModes: MultiplayerModeData[] | null;
  officialWebsite: string | null;
  steamUrl: string | null;
  epicUrl: string | null;
  gogUrl: string | null;
  itchUrl: string | null;
  discordUrl: string | null;
  igdbId: number | null;
  igdbUrl: string | null;
  isSponsored: boolean;
  sponsorTier: string | null;
  sponsorStartDate: string | null;
  sponsorEndDate: string | null;
  sponsorBadgeText: string | null;
}

/**
 * Platform document
 */
export interface PlatformDocument extends StrapiDocument {
  name: string;
  slug: string;
  abbreviation: string | null;
  description: string | null;
  manufacturer: string | null;
  releaseYear: number | null;
  category: string | null;
  igdbId: number | null;
  logoUrl: string | null;
  generation: number | null;
}

/**
 * Genre document
 */
export interface GenreDocument extends StrapiDocument {
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
}

/**
 * Company document
 */
export interface CompanyDocument extends StrapiDocument {
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  country: string | null;
  foundedYear: number | null;
  igdbId: number | null;
  igdbUrl: string | null;
}

/**
 * Franchise document
 */
export interface FranchiseDocument extends StrapiDocument {
  name: string;
  slug: string;
  description: string | null;
  igdbId: number | null;
  igdbUrl: string | null;
}

/**
 * Collection document
 */
export interface CollectionDocument extends StrapiDocument {
  name: string;
  slug: string;
  description: string | null;
  igdbId: number | null;
  igdbUrl: string | null;
  parentCollection?: CollectionDocument | null;
  childCollections?: CollectionDocument[];
}

/**
 * Language document
 */
export interface LanguageDocument extends StrapiDocument {
  name: string;
  nativeName: string | null;
  locale: string | null;
  igdbId: number | null;
}

/**
 * GameMode document
 */
export interface GameModeDocument extends StrapiDocument {
  name: string;
  slug: string;
  igdbId: number | null;
}

/**
 * PlayerPerspective document
 */
export interface PlayerPerspectiveDocument extends StrapiDocument {
  name: string;
  slug: string;
  igdbId: number | null;
}

/**
 * Theme document
 */
export interface ThemeDocument extends StrapiDocument {
  name: string;
  slug: string;
  igdbId: number | null;
}

/**
 * AgeRating document
 */
export interface AgeRatingDocument extends StrapiDocument {
  category: string;
  rating: string;
  ratingCoverUrl: string | null;
  synopsis: string | null;
  igdbId: number | null;
}

/**
 * GameEngine document
 */
export interface GameEngineDocument extends StrapiDocument {
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  igdbId: number | null;
}

/**
 * Source content document (cached cleaned web content)
 */
export interface SourceContentDocument extends StrapiDocument {
  url: string;
  domain: string;
  title: string;
  /** Short 1-2 sentence summary */
  summary: string | null;
  /** Detailed summary with specific facts, numbers, and names (paragraph form) */
  detailedSummary: string | null;
  /** Key facts extracted as bullet points */
  keyFacts: readonly string[] | null;
  /** Specific data points: stats, dates, names, numbers */
  dataPoints: readonly string[] | null;
  /** Images extracted from the source with context (JSON serialized) */
  images: unknown | null;
  cleanedContent: string;
  originalContentLength: number;
  /** Quality score (0-100), null for scrape failures */
  qualityScore: number | null;
  /** Relevance to gaming score (0-100), null for scrape failures */
  relevanceScore: number | null;
  qualityNotes: string | null;
  contentType: string;
  junkRatio: number;
  accessCount: number;
  lastAccessedAt: string | null;
  searchSource: 'tavily' | 'exa';
  /** Whether scraping succeeded (content > MIN_CONTENT_LENGTH chars) */
  scrapeSucceeded: boolean;
}

/**
 * Post document
 */
export interface PostDocument extends StrapiDocument {
  title: string;
  slug: string;
  content: string | null;
  description: string | null;
  excerpt: string | null;
  audioFile?: unknown;
  chapterFile?: unknown;
}

/**
 * Domain quality document (aggregate domain scores)
 */
export interface DomainQualityDocument extends StrapiDocument {
  domain: string;
  avgQualityScore: number;
  /** Average relevance to gaming score (0-100) */
  avgRelevanceScore: number;
  totalSources: number;
  tier: 'excellent' | 'good' | 'average' | 'poor' | 'excluded';
  /** Global exclusion (low quality or low relevance) */
  isExcluded: boolean;
  excludeReason: string | null;
  domainType: string;
  /** Total scrape attempts via Tavily */
  tavilyAttempts: number;
  /** Scrape failures via Tavily */
  tavilyScrapeFailures: number;
  /** Total scrape attempts via Exa */
  exaAttempts: number;
  /** Scrape failures via Exa */
  exaScrapeFailures: number;
  /** Per-engine exclusion for Tavily (scrape failure rate exceeded) */
  isExcludedTavily: boolean;
  /** Per-engine exclusion for Exa (scrape failure rate exceeded) */
  isExcludedExa: boolean;
  /** Reason for Tavily exclusion */
  tavilyExcludeReason: string | null;
  /** Reason for Exa exclusion */
  exaExcludeReason: string | null;
}

/**
 * Document service query options
 */
export interface DocumentQueryOptions {
  filters?: Record<string, unknown>;
  locale?: string;
  populate?: string | string[] | Record<string, unknown>;
  sort?: string | string[];
  limit?: number;
  offset?: number;
}

/**
 * Document service create options
 */
export interface DocumentCreateOptions<T> {
  data: Partial<T>;
  locale?: string;
}

/**
 * Document service publish options
 */
export interface DocumentPublishOptions {
  documentId: string;
  locale?: string;
}

/**
 * Document action result (for delete/publish operations)
 */
export interface DocumentActionResult<T> {
  documentId: string;
  entries: T[];
}

/**
 * Generic document service interface
 */
export interface DocumentService<T extends StrapiDocument> {
  findMany(options?: DocumentQueryOptions): Promise<T[]>;
  findOne(options: { documentId: string } & DocumentQueryOptions): Promise<T | null>;
  create(options: DocumentCreateOptions<T>): Promise<T>;
  update(options: { documentId: string } & DocumentCreateOptions<T>): Promise<T>;
  delete(options: { documentId: string; locale?: string }): Promise<DocumentActionResult<T>>;
  publish(options: DocumentPublishOptions): Promise<DocumentActionResult<T>>;
}

