import type { Core } from '@strapi/strapi';
import {
  type IGDBGame,
  type IGDBPlatformFull,
  type TwitchAuthResponse,
  IGDB_GAME_TYPE_MAP,
  IGDB_GAME_STATUS_MAP,
  IGDB_AGE_RATING_CATEGORY_MAP,
  IGDB_AGE_RATING_MAP,
  IGDB_PLATFORM_TYPE_MAP,
  IGDBWebsiteCategory,
} from '../../../types/igdb';

/**
 * IGDB API Service
 * 
 * Integrates with the IGDB (Internet Game Database) API to fetch game data.
 * Requires Twitch OAuth credentials (IGDB is owned by Twitch/Amazon).
 * 
 * Environment variables required:
 * - IGDB_CLIENT_ID: Twitch application Client ID
 * - IGDB_CLIENT_SECRET: Twitch application Client Secret
 * 
 * @see https://api-docs.igdb.com/
 */

export interface IGDBSearchResult {
  igdbId: number;
  name: string;
  slug: string;
  coverUrl?: string;
  releaseDate?: string;
  platforms?: string[];
  developer?: string;
  rating?: number;
}

export interface PlatformData {
  igdbId: number;
  name: string;
  abbreviation: string | null;
}

export interface FullPlatformData {
  igdbId: number;
  name: string;
  slug: string;
  abbreviation: string | null;
  manufacturer: string | null;
  generation: number | null;
  logoUrl: string | null;
  category: 'console' | 'pc' | 'mobile' | 'handheld' | 'vr' | null;
}

export interface CompanyData {
  igdbId: number;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
}

export interface FranchiseData {
  igdbId: number;
  name: string;
  slug: string;
  igdbUrl: string | null;
}

export interface LanguageData {
  igdbId: number;
  name: string;
  nativeName: string | null;
  locale: string | null;
}

export interface GameModeData {
  igdbId: number;
  name: string;
}

export interface PlayerPerspectiveData {
  igdbId: number;
  name: string;
}

export interface ThemeData {
  igdbId: number;
  name: string;
}

export interface AgeRatingData {
  igdbId: number;
  category: string;
  rating: string;
  synopsis: string | null;
}

export interface GameEngineData {
  igdbId: number;
  name: string;
  slug: string;
  logoUrl: string | null;
}

export interface GameData {
  name: string;
  slug: string;
  description: string;
  releaseDate: string | null;
  gameCategory: string;
  gameStatus: string;
  parentGameId: number | null;
  // Company data (we'll look up by ID in controller)
  developersData: CompanyData[];  // Multiple developers supported (co-development)
  publishersData: CompanyData[];  // Multiple publishers supported
  // Franchises (a game can belong to multiple franchises/collections)
  franchises: FranchiseData[];
  // Platforms
  platforms: PlatformData[];
  // Media
  coverImageUrl: string | null;
  screenshotUrls: string[];
  trailerIds: string[];
  // Ratings
  metacriticScore: number | null;
  userRating: number | null;
  userRatingCount: number | null;
  // Metadata (structured with igdbId for collection lookup)
  gameModes: GameModeData[];
  playerPerspectives: PlayerPerspectiveData[];
  themes: ThemeData[];
  genres: string[];
  // Age ratings
  ageRatings: AgeRatingData[];
  // Game engines
  gameEngines: GameEngineData[];
  // Related games (IGDB IDs for lookup)
  similarGameIds: number[];
  remakeIds: number[];
  remasterIds: number[];
  // Languages
  languages: LanguageData[];
  // URLs
  officialWebsite: string | null;
  steamUrl: string | null;
  igdbId: number;
  igdbUrl: string | null;
}

// Token cache
let accessToken: string | null = null;
let tokenExpiry: number = 0;

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Get Twitch OAuth access token for IGDB API
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    
    if (accessToken && tokenExpiry > now + 300000) {
      return accessToken;
    }

    const clientId = process.env.IGDB_CLIENT_ID;
    const clientSecret = process.env.IGDB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        'IGDB credentials not configured. Set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET environment variables.'
      );
    }

    const response = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
      { method: 'POST' }
    );

    if (!response.ok) {
      throw new Error(`Failed to get access token: ${response.statusText}`);
    }

    const data = await response.json() as TwitchAuthResponse;
    accessToken = data.access_token;
    tokenExpiry = now + (data.expires_in * 1000);

    strapi.log.info('[IGDB] Access token refreshed');
    return accessToken!;
  },

  /**
   * Make a request to the IGDB API
   */
  async igdbRequest<T>(endpoint: string, query: string): Promise<T> {
    const token = await this.getAccessToken();
    const clientId = process.env.IGDB_CLIENT_ID!;

    const response = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body: query,
    });

    if (!response.ok) {
      throw new Error(`IGDB API error: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  },

  /**
   * Search for games by name
   * Uses hybrid approach: IGDB search + name filter with accent handling
   */
  async searchGames(query: string, limit: number = 25): Promise<IGDBSearchResult[]> {
    if (!query || query.length < 2) {
      return [];
    }

    // Escape quotes in search query
    const escapedQuery = query.replace(/"/g, '\\"');
    
    // Handle common accent variations (e.g., pokemon -> pokémon)
    const accentVariations: Record<string, string> = {
      'pokemon': 'pokémon',
      'Pokemon': 'Pokémon',
      'POKEMON': 'POKÉMON',
    };
    
    // Check if query contains any word that needs accent substitution
    let accentedQuery = escapedQuery;
    for (const [plain, accented] of Object.entries(accentVariations)) {
      if (escapedQuery.toLowerCase().includes(plain.toLowerCase())) {
        accentedQuery = escapedQuery.replace(new RegExp(plain, 'gi'), accented);
        break;
      }
    }

    // Build searches array
    const searches: Promise<IGDBGame[]>[] = [
      // Search by similarity (original query)
      this.igdbRequest<IGDBGame[]>(
        'games',
        `search "${escapedQuery}";
         fields name, slug, cover.image_id, first_release_date, rating, total_rating, hypes,
                platforms.name, platforms.abbreviation, 
                involved_companies.company.name, involved_companies.developer;
         where version_parent = null;
         limit 50;`
      ),
      // Filter by name (original query)
      this.igdbRequest<IGDBGame[]>(
        'games',
        `fields name, slug, cover.image_id, first_release_date, rating, total_rating, hypes,
                platforms.name, platforms.abbreviation, 
                involved_companies.company.name, involved_companies.developer;
         where name ~ *"${escapedQuery}"* & version_parent = null;
         sort total_rating desc;
         limit 50;`
      ),
    ];

    // If accented query is different, add searches for it too
    if (accentedQuery !== escapedQuery) {
      searches.push(
        // Search by similarity (accented)
        this.igdbRequest<IGDBGame[]>(
          'games',
          `search "${accentedQuery}";
           fields name, slug, cover.image_id, first_release_date, rating, total_rating, hypes,
                  platforms.name, platforms.abbreviation, 
                  involved_companies.company.name, involved_companies.developer;
           where version_parent = null;
           limit 50;`
        ),
        // Filter by name (accented)
        this.igdbRequest<IGDBGame[]>(
          'games',
          `fields name, slug, cover.image_id, first_release_date, rating, total_rating, hypes,
                  platforms.name, platforms.abbreviation, 
                  involved_companies.company.name, involved_companies.developer;
           where name ~ *"${accentedQuery}"* & version_parent = null;
           sort total_rating desc;
           limit 50;`
        ),
      );
    }

    // Run all searches in parallel
    const results = await Promise.all(searches);

    // Merge results, removing duplicates by ID
    const gameMap = new Map<number, IGDBGame>();
    results.flat().forEach((game) => {
      if (!gameMap.has(game.id)) {
        gameMap.set(game.id, game);
      }
    });

    const allGames = Array.from(gameMap.values());

    // Sort by popularity (total_rating + hypes)
    const sortedGames = allGames.sort((a, b) => {
      const aPopularity = (a.total_rating || 0) + (a.hypes || 0) * 0.5;
      const bPopularity = (b.total_rating || 0) + (b.hypes || 0) * 0.5;
      return bPopularity - aPopularity;
    });

    // Return top results
    return sortedGames.slice(0, limit).map((game) => ({
      igdbId: game.id,
      name: game.name,
      slug: game.slug,
      coverUrl: game.cover?.image_id
        ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg`
        : undefined,
      releaseDate: game.first_release_date
        ? new Date(game.first_release_date * 1000).toISOString().split('T')[0]
        : undefined,
      platforms: game.platforms?.map((p) => p.abbreviation || p.name) || [],
      developer: game.involved_companies?.find((c) => c.developer)?.company?.name,
      rating: game.rating,
    }));
  },

  /**
   * Get full game details by IGDB ID
   */
  async getGameById(igdbId: number): Promise<GameData | null> {
    const games = await this.igdbRequest<IGDBGame[]>(
      'games',
      `where id = ${igdbId};
       fields name, slug, summary, storyline, first_release_date, category, game_status, parent_game, url,
              aggregated_rating, aggregated_rating_count, rating, rating_count,
              cover.image_id, 
              screenshots.image_id, artworks.image_id, videos.video_id,
              genres.name, 
              themes.id, themes.name, 
              game_modes.id, game_modes.name, 
              player_perspectives.id, player_perspectives.name,
              platforms.id, platforms.name, platforms.abbreviation,
              involved_companies.company.id, involved_companies.company.name, 
              involved_companies.company.slug, involved_companies.company.description,
              involved_companies.company.logo.image_id,
              involved_companies.developer, involved_companies.publisher,
              franchise.id, franchise.name, franchise.slug, franchise.url,
              collections.id, collections.name, collections.slug, collections.url,
              websites.url, websites.category,
              language_supports.language.id, language_supports.language.name,
              language_supports.language.native_name, language_supports.language.locale,
              language_supports.language_support_type.name,
              age_ratings.id, age_ratings.category, age_ratings.rating, age_ratings.synopsis,
              age_ratings.organization.id, age_ratings.organization.name,
              age_ratings.rating_category.id, age_ratings.rating_category.rating,
              game_engines.id, game_engines.name, game_engines.slug, game_engines.logo.image_id,
              similar_games, remakes, remasters;
       limit 1;`
    );

    if (!games.length) {
      return null;
    }

    const game = games[0];

    // Get ALL developers and publishers (a game can have multiple of each, e.g., co-development)
    const developerCompanies = game.involved_companies?.filter((c) => c.developer).map((c) => c.company) || [];
    const publisherCompanies = game.involved_companies?.filter((c) => c.publisher).map((c) => c.company) || [];

    const developersData: CompanyData[] = developerCompanies.map((company) => ({
      igdbId: company.id,
      name: company.name,
      slug: company.slug,
      description: company.description || null,
      logoUrl: company.logo?.image_id 
        ? `https://images.igdb.com/igdb/image/upload/t_logo_med/${company.logo.image_id}.png`
        : null,
    }));

    const publishersData: CompanyData[] = publisherCompanies.map((company) => ({
      igdbId: company.id,
      name: company.name,
      slug: company.slug,
      description: company.description || null,
      logoUrl: company.logo?.image_id
        ? `https://images.igdb.com/igdb/image/upload/t_logo_med/${company.logo.image_id}.png`
        : null,
    }));

    // Franchises (combine franchise field + all collections)
    const franchises: FranchiseData[] = [];
    
    // Add franchise if available
    if (game.franchise) {
      franchises.push({
        igdbId: game.franchise.id,
        name: game.franchise.name,
        slug: game.franchise.slug,
        igdbUrl: game.franchise.url || null,
      });
    }
    
    // Add all collections as franchises
    if (game.collections && game.collections.length > 0) {
      for (const collection of game.collections) {
        // Avoid duplicates (in case franchise is also in collections)
        if (!franchises.some(f => f.igdbId === collection.id)) {
          franchises.push({
            igdbId: collection.id,
            name: collection.name,
            slug: collection.slug,
            igdbUrl: collection.url || null,
          });
        }
      }
    }

    // Build description
    let description = '';
    if (game.summary) {
      description = `<p>${game.summary}</p>`;
    }
    if (game.storyline) {
      description += `\n<h3>Story</h3>\n<p>${game.storyline}</p>`;
    }

    // Cover image
    const coverImageUrl = game.cover?.image_id
      ? `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${game.cover.image_id}.jpg`
      : null;

    // Screenshots (combine screenshots and artworks)
    const screenshotUrls = [
      ...(game.screenshots?.map(s => `https://images.igdb.com/igdb/image/upload/t_screenshot_big/${s.image_id}.jpg`) || []),
      ...(game.artworks?.map(a => `https://images.igdb.com/igdb/image/upload/t_screenshot_big/${a.image_id}.jpg`) || []),
    ];

    // Trailer IDs (YouTube)
    const trailerIds = game.videos?.map(v => v.video_id) || [];

    // Platforms
    const platforms: PlatformData[] = game.platforms
      ? game.platforms.map((p) => ({
          igdbId: p.id,
          name: p.name,
          abbreviation: p.abbreviation || null,
        }))
      : [];

    // Metadata arrays (structured with igdbId for collection lookup)
    const genres = game.genres?.map((g) => g.name) || [];
    const themes: ThemeData[] = game.themes?.map((t) => ({
      igdbId: t.id,
      name: t.name,
    })) || [];
    const gameModes: GameModeData[] = game.game_modes?.map((gm) => ({
      igdbId: gm.id,
      name: gm.name,
    })) || [];
    const playerPerspectives: PlayerPerspectiveData[] = game.player_perspectives?.map((pp) => ({
      igdbId: pp.id,
      name: pp.name,
    })) || [];

    // Languages (unique by language ID)
    const languageMap = new Map<number, LanguageData>();
    game.language_supports?.forEach(ls => {
      if (!languageMap.has(ls.language.id)) {
        languageMap.set(ls.language.id, {
          igdbId: ls.language.id,
          name: ls.language.name,
          nativeName: ls.language.native_name || null,
          locale: ls.language.locale || null,
        });
      }
    });
    const languages = Array.from(languageMap.values());

    // Websites
    const officialWebsite = game.websites?.find(w => w.category === IGDBWebsiteCategory.Official)?.url || null;
    const steamUrl = game.websites?.find(w => w.category === IGDBWebsiteCategory.Steam)?.url || null;

    // Ratings
    const metacriticScore = game.aggregated_rating ? Math.round(game.aggregated_rating) : null;
    const userRating = game.rating || null;
    const userRatingCount = game.rating_count || null;

    // Game category and status
    const gameCategory = IGDB_GAME_TYPE_MAP[game.category || 0] || 'main_game';
    const gameStatus = IGDB_GAME_STATUS_MAP[game.game_status ?? 0] || 'released';

    // Process age ratings
    // Use new fields (organization, rating_category) with fallback to deprecated fields (category, rating)
    const ageRatings: AgeRatingData[] = game.age_ratings?.map(ar => {
      // Get organization name - prefer new field, fallback to deprecated enum
      const category = ar.organization?.name 
        || IGDB_AGE_RATING_CATEGORY_MAP[ar.category || 0] 
        || 'Unknown';
      
      // Get rating string - prefer new field, fallback to deprecated enum
      const rating = ar.rating_category?.rating 
        || IGDB_AGE_RATING_MAP[ar.rating || 0] 
        || String(ar.rating || 'Unknown');
      
      return {
        igdbId: ar.id,
        category,
        rating,
        synopsis: ar.synopsis || null,
      };
    }) || [];

    // Process game engines
    const gameEngines: GameEngineData[] = game.game_engines?.map(ge => ({
      igdbId: ge.id,
      name: ge.name,
      slug: ge.slug,
      logoUrl: ge.logo?.image_id
        ? `https://images.igdb.com/igdb/image/upload/t_logo_med/${ge.logo.image_id}.png`
        : null,
    })) || [];

    // Related game IDs (we'll look these up in the controller)
    const similarGameIds = game.similar_games || [];
    const remakeIds = game.remakes || [];
    const remasterIds = game.remasters || [];

    return {
      name: game.name,
      slug: game.slug,
      description,
      releaseDate: game.first_release_date
        ? new Date(game.first_release_date * 1000).toISOString().split('T')[0]
        : null,
      gameCategory,
      gameStatus,
      parentGameId: game.parent_game || null,
      developersData,
      publishersData,
      franchises,
      platforms,
      coverImageUrl,
      screenshotUrls,
      trailerIds,
      metacriticScore,
      userRating,
      userRatingCount,
      gameModes,
      playerPerspectives,
      themes,
      genres,
      ageRatings,
      gameEngines,
      similarGameIds,
      remakeIds,
      remasterIds,
      languages,
      officialWebsite,
      steamUrl,
      igdbId: game.id,
      igdbUrl: game.url || null,
    };
  },

  /**
   * Get full platform details by IGDB ID
   */
  async getPlatformById(igdbId: number): Promise<FullPlatformData | null> {
    const platforms = await this.igdbRequest<IGDBPlatformFull[]>(
      'platforms',
      `where id = ${igdbId};
       fields name, slug, abbreviation, generation, platform_type,
              platform_logo.image_id, platform_family.name;
       limit 1;`
    );

    if (!platforms.length) {
      return null;
    }

    const platform = platforms[0];

    const logoUrl = platform.platform_logo?.image_id
      ? `https://images.igdb.com/igdb/image/upload/t_logo_med/${platform.platform_logo.image_id}.png`
      : null;

    // Map IGDB platform_type to our category
    const category = platform.platform_type 
      ? (IGDB_PLATFORM_TYPE_MAP[platform.platform_type] as 'console' | 'pc' | 'mobile' | 'handheld' | 'vr' | null) || null 
      : null;

    return {
      igdbId: platform.id,
      name: platform.name,
      slug: platform.slug,
      abbreviation: platform.abbreviation || null,
      manufacturer: platform.platform_family?.name || null,
      generation: platform.generation || null,
      logoUrl,
      category,
    };
  },

  /**
   * Get company details by IGDB ID
   */
  async getCompanyById(igdbId: number): Promise<CompanyData | null> {
    interface IGDBCompany {
      id: number;
      name: string;
      slug: string;
      description?: string;
      logo?: { id: number; image_id: string };
      country?: number;
      start_date?: number;
      url?: string;
    }

    const companies = await this.igdbRequest<IGDBCompany[]>(
      'companies',
      `where id = ${igdbId};
       fields name, slug, description, logo.image_id, country, start_date, url;
       limit 1;`
    );

    if (!companies.length) {
      return null;
    }

    const company = companies[0];

    return {
      igdbId: company.id,
      name: company.name,
      slug: company.slug,
      description: company.description || null,
      logoUrl: company.logo?.image_id
        ? `https://images.igdb.com/igdb/image/upload/t_logo_med/${company.logo.image_id}.png`
        : null,
    };
  },

  /**
   * Get franchise details by IGDB ID
   */
  async getFranchiseById(igdbId: number): Promise<FranchiseData | null> {
    interface IGDBFranchise {
      id: number;
      name: string;
      slug: string;
      url?: string;
    }

    const franchises = await this.igdbRequest<IGDBFranchise[]>(
      'franchises',
      `where id = ${igdbId};
       fields name, slug, url;
       limit 1;`
    );

    if (!franchises.length) {
      return null;
    }

    const franchise = franchises[0];

    return {
      igdbId: franchise.id,
      name: franchise.name,
      slug: franchise.slug,
      igdbUrl: franchise.url || null,
    };
  },

  /**
   * Check if IGDB credentials are configured
   */
  isConfigured(): boolean {
    return !!(process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET);
  },
});
