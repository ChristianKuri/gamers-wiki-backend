import type { Core } from '@strapi/strapi';
import type { 
  CompanyData, 
  FranchiseData, 
  CollectionData,
  LanguageData, 
  GameModeData, 
  PlayerPerspectiveData, 
  ThemeData, 
  AgeRatingData, 
  GameEngineData,
  KeywordData,
} from '../services/igdb';
import type {
  GameDocument,
  PlatformDocument,
  GenreDocument,
  CompanyDocument,
  FranchiseDocument,
  CollectionDocument,
  LanguageDocument,
  GameModeDocument,
  PlayerPerspectiveDocument,
  ThemeDocument,
  AgeRatingDocument,
  GameEngineDocument,
  KeywordDocument,
  DocumentQueryOptions,
} from '../../../types/strapi';
import { 
  isAIConfigured, 
  generateGameDescription,
  getAIStatus,
  type SupportedLocale,
  type GameDescriptionContext,
} from '../../../ai';
import { syncLocales, type GameLocaleData } from '../../game/locale-sync';
import { resolveIGDBGameIdFromQuery } from '../services/game-resolver';

interface SearchQuery {
  q?: string;
  limit?: string;
}

interface ResolveQuery extends SearchQuery {
  model?: string;
}

function getSecretFromHeader(ctx: any): string | undefined {
  const value = ctx.request?.headers?.['x-ai-generation-secret'];
  return typeof value === 'string' ? value : undefined;
}

interface ImportBody {
  igdbId: number;
}

interface RegenerateBody {
  gameId: string;
  locale?: SupportedLocale | 'both';
}

// Type for Strapi document service - using generics for better type safety
// Note: Strapi 5's document service has limited TypeScript support, so some type assertions are needed
type DocumentService<T> = {
  findMany(options?: DocumentQueryOptions): Promise<T[]>;
  findOne(options: { documentId: string } & DocumentQueryOptions): Promise<T | null>;
  create(options: { data: Partial<T>; locale?: string }): Promise<T>;
  update(options: { documentId: string; data: Partial<T>; locale?: string }): Promise<T>;
  delete(options: { documentId: string; locale?: string }): Promise<T>;
  publish(options: { documentId: string; locale?: string }): Promise<T>;
};

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Check if IGDB is configured
   * GET /api/game-fetcher/status
   */
  async status(ctx) {
    const igdbService = strapi.service('api::game-fetcher.igdb');
    
    ctx.body = {
      configured: igdbService.isConfigured(),
      message: igdbService.isConfigured() 
        ? 'IGDB is configured and ready'
        : 'IGDB credentials not configured. Set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET.',
    };
  },

  /**
   * Search for games in IGDB
   * GET /api/game-fetcher/search?q=pokemon&limit=10
   */
  async search(ctx) {
    const { q, limit = '10' } = ctx.query as SearchQuery;

    if (!q || q.length < 2) {
      return ctx.badRequest('Query must be at least 2 characters');
    }

    const igdbService = strapi.service('api::game-fetcher.igdb');

    if (!igdbService.isConfigured()) {
      return ctx.badRequest('IGDB is not configured. Set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET environment variables.');
    }

    try {
      const results = await igdbService.searchGames(q, parseInt(limit, 10));
      ctx.body = { results };
    } catch (error) {
      strapi.log.error('[GameFetcher] Search error:', error);
      return ctx.internalServerError('Failed to search IGDB');
    }
  },

  /**
   * Resolve a game query to an IGDB ID using:
   * - IGDB search (candidates)
   * - LLM selection (pick the correct candidate)
   *
   * GET /api/game-fetcher/resolve?q=zelda&limit=10
   * Header: x-ai-generation-secret: <AI_GENERATION_SECRET>
   */
  async resolve(ctx) {
    const secret = process.env.AI_GENERATION_SECRET;
    if (!secret) {
      return ctx.internalServerError('AI_GENERATION_SECRET is not configured');
    }

    const provided = getSecretFromHeader(ctx);
    if (!provided || provided !== secret) {
      return ctx.unauthorized('Invalid AI generation secret');
    }

    if (!isAIConfigured()) {
      return ctx.badRequest('AI is not configured. Set OPENROUTER_API_KEY environment variable.');
    }

    const { q, limit = '10', model } = ctx.query as ResolveQuery;
    if (!q || q.length < 2) {
      return ctx.badRequest('Query must be at least 2 characters');
    }

    const igdbService = strapi.service('api::game-fetcher.igdb');
    if (!igdbService.isConfigured()) {
      return ctx.badRequest('IGDB is not configured. Set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET environment variables.');
    }

    try {
      const resolved = await resolveIGDBGameIdFromQuery(strapi, q, parseInt(limit, 10), {
        ...(typeof model === 'string' && model.trim().length > 0 ? { model: model.trim() } : {}),
      });
      ctx.body = {
        success: true,
        query: q,
        igdbId: resolved.igdbId,
        pick: resolved.pick,
        candidates: resolved.candidates,
        normalizedQuery: resolved.normalizedQuery,
        model: typeof model === 'string' && model.trim().length > 0 ? model.trim() : undefined,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return ctx.badRequest(`Failed to resolve game: ${msg}`);
    }
  },

  /**
   * Get full game data from IGDB
   * GET /api/game-fetcher/game/:igdbId
   */
  async getGame(ctx) {
    const { igdbId } = ctx.params;

    const igdbService = strapi.service('api::game-fetcher.igdb');

    if (!igdbService.isConfigured()) {
      return ctx.badRequest('IGDB is not configured');
    }

    try {
      const game = await igdbService.getGameById(parseInt(igdbId, 10));
      
      if (!game) {
        return ctx.notFound('Game not found');
      }

      ctx.body = { game };
    } catch (error) {
      strapi.log.error('[GameFetcher] Get game error:', error);
      return ctx.internalServerError('Failed to fetch game from IGDB');
    }
  },

  /**
   * Import a game from IGDB into Strapi
   * POST /api/game-fetcher/import
   * Body: { igdbId: number }
   */
  async importGame(ctx) {
    const { igdbId } = ctx.request.body as ImportBody;

    if (!igdbId) {
      return ctx.badRequest('igdbId is required');
    }

    const igdbService = strapi.service('api::game-fetcher.igdb');

    if (!igdbService.isConfigured()) {
      return ctx.badRequest('IGDB is not configured');
    }

    try {
      // Note: Strapi 5's document service has limited TypeScript support for dynamic content types
      // We use type casting to get better intellisense while acknowledging the underlying limitations
      const gameService = strapi.documents('api::game.game') as unknown as DocumentService<GameDocument>;
      const genreService = strapi.documents('api::genre.genre') as unknown as DocumentService<GenreDocument>;
      const platformService = strapi.documents('api::platform.platform') as unknown as DocumentService<PlatformDocument>;
      const companyService = strapi.documents('api::company.company') as unknown as DocumentService<CompanyDocument>;
      const franchiseService = strapi.documents('api::franchise.franchise') as unknown as DocumentService<FranchiseDocument>;
      const collectionService = strapi.documents('api::collection.collection') as unknown as DocumentService<CollectionDocument>;
      const languageService = strapi.documents('api::language.language') as unknown as DocumentService<LanguageDocument>;
      const gameModeService = strapi.documents('api::game-mode.game-mode') as unknown as DocumentService<GameModeDocument>;
      const playerPerspectiveService = strapi.documents('api::player-perspective.player-perspective') as unknown as DocumentService<PlayerPerspectiveDocument>;
      const themeService = strapi.documents('api::theme.theme') as unknown as DocumentService<ThemeDocument>;
      const ageRatingService = strapi.documents('api::age-rating.age-rating') as unknown as DocumentService<AgeRatingDocument>;
      const gameEngineService = strapi.documents('api::game-engine.game-engine') as unknown as DocumentService<GameEngineDocument>;
      const keywordService = strapi.documents('api::keyword.keyword') as unknown as DocumentService<KeywordDocument>;

      // Check if game already exists
      const existingGames = await gameService.findMany({
        filters: { igdbId },
        locale: 'en',
      });

      if (existingGames.length > 0) {
        ctx.body = {
          success: true,
          message: 'Game already exists',
          game: existingGames[0],
          created: false,
        };
        return;
      }

      // Fetch game data from IGDB
      const gameData = await igdbService.getGameById(igdbId);

      if (!gameData) {
        return ctx.notFound('Game not found in IGDB');
      }

      // Helper: Find or create company
      const findOrCreateCompany = async (companyData: CompanyData | null): Promise<string | null> => {
        if (!companyData) return null;

        // Check by igdbId first
        let existing = await companyService.findMany({
          filters: { igdbId: companyData.igdbId },
          locale: 'en',
        } as any);

        if (existing.length > 0) {
          return existing[0].documentId;
        }

        // Fallback: check by name
        existing = await companyService.findMany({
          filters: { name: companyData.name },
          locale: 'en',
        } as any);

        if (existing.length > 0) {
          return existing[0].documentId;
        }

        // Create new company as published (no description - will be generated by lifecycle hook)
        // AI descriptions + locale sync for related entities run via afterCreate lifecycles
        // This allows parallel processing of multiple companies during import
        // Using status: 'published' to create as published directly, avoiding double lifecycle trigger
        const newCompany = await companyService.create({
          data: {
            name: companyData.name,
            slug: companyData.slug,
            // Don't pass IGDB description - lifecycle hook generates SEO-friendly AI description
            logoUrl: companyData.logoUrl,
            igdbId: companyData.igdbId,
          },
          locale: 'en',
          status: 'published',
        } as any);

        strapi.log.info(`[GameFetcher] Created company: ${companyData.name}`);
        return newCompany.documentId;
      };

      // Helper: Find or create franchise
      // Cache to avoid duplicates within the same import
      const franchiseCache = new Map<number, string>();
      const findOrCreateFranchise = async (franchiseData: FranchiseData): Promise<string | null> => {
        // Check cache first (for franchises created in this import)
        if (franchiseCache.has(franchiseData.igdbId)) {
          return franchiseCache.get(franchiseData.igdbId)!;
        }

        // Check by igdbId first (search all locales since igdbId is not localized)
        let existing = await franchiseService.findMany({
          filters: { igdbId: franchiseData.igdbId },
        } as any);

        if (existing.length > 0) {
          franchiseCache.set(franchiseData.igdbId, existing[0].documentId);
          return existing[0].documentId;
        }

        // Fallback: check by name
        existing = await franchiseService.findMany({
          filters: { name: franchiseData.name },
        } as any);

        if (existing.length > 0) {
          franchiseCache.set(franchiseData.igdbId, existing[0].documentId);
          return existing[0].documentId;
        }

        // Create new franchise as published
        const newFranchise = await franchiseService.create({
          data: {
            name: franchiseData.name,
            slug: franchiseData.slug,
            igdbId: franchiseData.igdbId,
            igdbUrl: franchiseData.igdbUrl,
          },
          locale: 'en',
          status: 'published',
        } as any);

        strapi.log.info(`[GameFetcher] Created franchise: ${franchiseData.name}`);
        franchiseCache.set(franchiseData.igdbId, newFranchise.documentId);
        return newFranchise.documentId;
      };

      // Helper: Find or create collection
      // Cache to avoid duplicates within the same import
      const collectionCache = new Map<number, string>();
      const findOrCreateCollection = async (collectionData: CollectionData): Promise<string | null> => {
        // Check cache first (for collections created in this import)
        if (collectionCache.has(collectionData.igdbId)) {
          return collectionCache.get(collectionData.igdbId)!;
        }

        // Check by igdbId first (search all locales since igdbId is not localized)
        let existing = await collectionService.findMany({
          filters: { igdbId: collectionData.igdbId },
        } as any);

        if (existing.length > 0) {
          collectionCache.set(collectionData.igdbId, existing[0].documentId);
          return existing[0].documentId;
        }

        // Fallback: check by name
        existing = await collectionService.findMany({
          filters: { name: collectionData.name },
        } as any);

        if (existing.length > 0) {
          collectionCache.set(collectionData.igdbId, existing[0].documentId);
          return existing[0].documentId;
        }

        // First, resolve parent collection if exists
        let parentDocumentId: string | null = null;
        if (collectionData.parentIgdbId) {
          // Try to find or create parent collection (recursively)
          // Note: We may need to fetch parent data from IGDB if we don't have it
          const existingParent = await collectionService.findMany({
            filters: { igdbId: collectionData.parentIgdbId },
          } as any);
          
          if (existingParent.length > 0) {
            parentDocumentId = existingParent[0].documentId;
          }
          // If parent doesn't exist and we have the igdbId, it will be created when that collection's game is imported
        }

        // Create new collection as published
        const newCollection = await collectionService.create({
          data: {
            name: collectionData.name,
            slug: collectionData.slug,
            igdbId: collectionData.igdbId,
            igdbUrl: collectionData.igdbUrl,
            ...(parentDocumentId && { parentCollection: parentDocumentId }),
          },
          locale: 'en',
          status: 'published',
        } as any);

        strapi.log.info(`[GameFetcher] Created collection: ${collectionData.name}${parentDocumentId ? ' (with parent)' : ''}`);
        collectionCache.set(collectionData.igdbId, newCollection.documentId);
        return newCollection.documentId;
      };

      // Helper: Find or create language
      const findOrCreateLanguage = async (langData: LanguageData): Promise<string> => {
        // Check by igdbId first
        let existing = await languageService.findMany({
          filters: { igdbId: langData.igdbId },
          locale: 'en',
        } as any);

        if (existing.length > 0) {
          return existing[0].documentId;
        }

        // Fallback: check by name
        existing = await languageService.findMany({
          filters: { name: langData.name },
          locale: 'en',
        } as any);

        if (existing.length > 0) {
          return existing[0].documentId;
        }

        // Generate slug from name
        const slug = langData.name
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .trim();

        // Create new language as published
        const newLanguage = await languageService.create({
          data: {
            name: langData.name,
            slug,
            nativeName: langData.nativeName,
            isoCode: langData.isoCode,
            igdbId: langData.igdbId,
          },
          locale: 'en',
          status: 'published',
        } as any);

        strapi.log.info(`[GameFetcher] Created language: ${langData.name}`);
        return newLanguage.documentId;
      };

      // Helper: Find or create game mode
      const findOrCreateGameMode = async (modeData: GameModeData): Promise<string> => {
        // Check by igdbId first
        let existing = await gameModeService.findMany({
          filters: { igdbId: modeData.igdbId },
          locale: 'en',
        } as any);

        if (existing.length > 0) {
          return existing[0].documentId;
        }

        // Fallback: check by name
        existing = await gameModeService.findMany({
          filters: { name: modeData.name },
          locale: 'en',
        } as any);

        if (existing.length > 0) {
          return existing[0].documentId;
        }

        // Create new game mode as published
        const newMode = await gameModeService.create({
          data: {
            name: modeData.name,
            slug: modeData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            igdbId: modeData.igdbId,
          },
          locale: 'en',
          status: 'published',
        } as any);

        strapi.log.info(`[GameFetcher] Created game mode: ${modeData.name}`);
        return newMode.documentId;
      };

      // Helper: Find or create player perspective
      const findOrCreatePlayerPerspective = async (perspectiveData: PlayerPerspectiveData): Promise<string> => {
        // Check by igdbId first
        let existing = await playerPerspectiveService.findMany({
          filters: { igdbId: perspectiveData.igdbId },
          locale: 'en',
        } as any);

        if (existing.length > 0) {
          return existing[0].documentId;
        }

        // Fallback: check by name
        existing = await playerPerspectiveService.findMany({
          filters: { name: perspectiveData.name },
          locale: 'en',
        } as any);

        if (existing.length > 0) {
          return existing[0].documentId;
        }

        // Create new player perspective as published
        const newPerspective = await playerPerspectiveService.create({
          data: {
            name: perspectiveData.name,
            slug: perspectiveData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            igdbId: perspectiveData.igdbId,
          },
          locale: 'en',
          status: 'published',
        } as any);

        strapi.log.info(`[GameFetcher] Created player perspective: ${perspectiveData.name}`);
        return newPerspective.documentId;
      };

      // Helper: Find or create theme
      const findOrCreateTheme = async (themeData: ThemeData): Promise<string> => {
        // Check by igdbId first
        let existing = await themeService.findMany({
          filters: { igdbId: themeData.igdbId },
          locale: 'en',
        } as any);

        if (existing.length > 0) {
          return existing[0].documentId;
        }

        // Fallback: check by name
        existing = await themeService.findMany({
          filters: { name: themeData.name },
          locale: 'en',
        } as any);

        if (existing.length > 0) {
          return existing[0].documentId;
        }

        // Create new theme as published
        const newTheme = await themeService.create({
          data: {
            name: themeData.name,
            slug: themeData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            igdbId: themeData.igdbId,
          },
          locale: 'en',
          status: 'published',
        } as any);

        strapi.log.info(`[GameFetcher] Created theme: ${themeData.name}`);
        return newTheme.documentId;
      };

      // Helper: Find or create age rating
      const findOrCreateAgeRating = async (arData: AgeRatingData): Promise<string> => {
        // Check by igdbId first
        let existing = await ageRatingService.findMany({
          filters: { igdbId: arData.igdbId },
        } as any);

        if (existing.length > 0) {
          return existing[0].documentId;
        }

        // Create new age rating as published with content descriptions as JSON array
        const newAgeRating = await ageRatingService.create({
          data: {
            category: arData.category,
            rating: arData.rating,
            ratingCoverUrl: arData.ratingCoverUrl,
            synopsis: arData.synopsis,
            igdbId: arData.igdbId,
            // Store content descriptions as JSON array (e.g., ["Blood and Gore", "Violence"])
            contentDescriptions: arData.contentDescriptions.map(cd => cd.description || cd.name),
          },
          locale: 'en',
          status: 'published',
        } as any);

        strapi.log.info(`[GameFetcher] Created age rating: ${arData.category} ${arData.rating} with ${arData.contentDescriptions.length} content descriptions`);
        return newAgeRating.documentId;
      };

      // Helper: Find or create game engine
      const findOrCreateGameEngine = async (engineData: GameEngineData): Promise<string> => {
        // Check by igdbId first
        let existing = await gameEngineService.findMany({
          filters: { igdbId: engineData.igdbId },
        } as any);

        if (existing.length > 0) {
          return existing[0].documentId;
        }

        // Fallback: check by name
        existing = await gameEngineService.findMany({
          filters: { name: engineData.name },
        } as any);

        if (existing.length > 0) {
          return existing[0].documentId;
        }

        // Create new game engine as published
        const newEngine = await gameEngineService.create({
          data: {
            name: engineData.name,
            slug: engineData.slug,
            logoUrl: engineData.logoUrl,
            igdbId: engineData.igdbId,
          },
          locale: 'en',
          status: 'published',
        } as any);

        strapi.log.info(`[GameFetcher] Created game engine: ${engineData.name}`);
        return newEngine.documentId;
      };

      // Helper: Find or create keyword
      const findOrCreateKeyword = async (keywordData: KeywordData): Promise<string> => {
        // Check by igdbId first
        let existing = await keywordService.findMany({
          filters: { igdbId: keywordData.igdbId },
        } as any);

        if (existing.length > 0) {
          return existing[0].documentId;
        }

        // Fallback: check by name
        existing = await keywordService.findMany({
          filters: { name: keywordData.name },
        } as any);

        if (existing.length > 0) {
          return existing[0].documentId;
        }

        // Create new keyword as published
        const newKeyword = await keywordService.create({
          data: {
            name: keywordData.name,
            slug: keywordData.slug,
            igdbId: keywordData.igdbId,
          },
          locale: 'en',
          status: 'published',
        } as any);

        strapi.log.info(`[GameFetcher] Created keyword: ${keywordData.name}`);
        return newKeyword.documentId;
      };

      // Find or create genres
      const genreIds: string[] = [];
      for (const genreName of gameData.genres) {
        const existingGenres = await genreService.findMany({
          filters: { name: genreName },
          locale: 'en',
        });

        if (existingGenres.length > 0) {
          genreIds.push(existingGenres[0].documentId);
        } else {
          // Create new genre as published
          const newGenre = await genreService.create({
            data: {
              name: genreName,
              slug: genreName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            },
            locale: 'en',
            status: 'published',
          } as any);
          
          genreIds.push(newGenre.documentId);
        }
      }

      // Find or create platforms
      const platformIds: string[] = [];
      for (const platformData of gameData.platforms) {
        // First check by igdbId (most reliable)
        let existingPlatforms = await platformService.findMany({
          filters: { igdbId: platformData.igdbId },
          locale: 'en',
        } as any);

        // Fallback: check by name if igdbId not found
        if (existingPlatforms.length === 0) {
          existingPlatforms = await platformService.findMany({
            filters: { name: platformData.name },
            locale: 'en',
          } as any);
        }

        if (existingPlatforms.length > 0) {
          platformIds.push(existingPlatforms[0].documentId);
        } else {
          // Fetch full platform data from IGDB
          const fullPlatformData = await igdbService.getPlatformById(platformData.igdbId);
          
          // Create new platform as published with full data
          const newPlatform = await platformService.create({
            data: {
              name: fullPlatformData?.name || platformData.name,
              slug: (fullPlatformData?.slug || platformData.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
              abbreviation: fullPlatformData?.abbreviation || platformData.abbreviation,
              igdbId: platformData.igdbId,
              manufacturer: fullPlatformData?.manufacturer,
              generation: fullPlatformData?.generation,
              logoUrl: fullPlatformData?.logoUrl,
              // Only include category if it has a valid value (not null)
              ...(fullPlatformData?.category && { category: fullPlatformData.category }),
            },
            locale: 'en',
            status: 'published',
          } as any);
          
          strapi.log.info(`[GameFetcher] Created platform: ${fullPlatformData?.name || platformData.name}`);
          platformIds.push(newPlatform.documentId);
        }
      }

      // Find or create ALL developers (a game can have multiple developers - co-development)
      const developerIds: string[] = [];
      for (const developerData of gameData.developersData) {
        const devId = await findOrCreateCompany(developerData);
        if (devId) {
          developerIds.push(devId);
        }
      }
      
      // Find or create ALL publishers (a game can have multiple publishers)
      const publisherIds: string[] = [];
      for (const publisherData of gameData.publishersData) {
        const pubId = await findOrCreateCompany(publisherData);
        if (pubId) {
          publisherIds.push(pubId);
        }
      }

      // Find or create franchises (a game can belong to multiple franchises - the IP/brand)
      const franchiseIds: string[] = [];
      for (const franchiseData of gameData.franchises) {
        const franchiseId = await findOrCreateFranchise(franchiseData);
        if (franchiseId) {
          franchiseIds.push(franchiseId);
        }
      }

      // Find or create collections (groupings - trilogies, remasters, etc.)
      const collectionIds: string[] = [];
      for (const collectionData of gameData.collections) {
        const collectionId = await findOrCreateCollection(collectionData);
        if (collectionId) {
          collectionIds.push(collectionId);
        }
      }

      // Find or create languages
      const languageIds: string[] = [];
      for (const langData of gameData.languages) {
        const langId = await findOrCreateLanguage(langData);
        languageIds.push(langId);
      }

      // Find or create game modes
      const gameModeIds: string[] = [];
      for (const modeData of gameData.gameModes) {
        const modeId = await findOrCreateGameMode(modeData);
        gameModeIds.push(modeId);
      }

      // Find or create player perspectives
      const playerPerspectiveIds: string[] = [];
      for (const perspectiveData of gameData.playerPerspectives) {
        const perspectiveId = await findOrCreatePlayerPerspective(perspectiveData);
        playerPerspectiveIds.push(perspectiveId);
      }

      // Find or create themes
      const themeIds: string[] = [];
      for (const themeData of gameData.themes) {
        const themeId = await findOrCreateTheme(themeData);
        themeIds.push(themeId);
      }

      // Find or create age ratings
      const ageRatingIds: string[] = [];
      for (const arData of gameData.ageRatings) {
        const arId = await findOrCreateAgeRating(arData);
        ageRatingIds.push(arId);
      }

      // Find or create game engines
      const gameEngineIds: string[] = [];
      for (const engineData of gameData.gameEngines) {
        const engineId = await findOrCreateGameEngine(engineData);
        gameEngineIds.push(engineId);
      }

      // Find or create keywords
      const keywordIds: string[] = [];
      for (const keywordData of gameData.keywords) {
        const keywordId = await findOrCreateKeyword(keywordData);
        keywordIds.push(keywordId);
      }

      // Create the game as published
      const created = await gameService.create({
        data: {
          name: gameData.name,
          slug: gameData.slug,
          description: gameData.description,
          releaseDate: gameData.releaseDate,
          gameCategory: gameData.gameCategory,
          gameStatus: gameData.gameStatus,
          // Relations
          developers: developerIds,
          publishers: publisherIds,
          franchises: franchiseIds,
          collections: collectionIds,
          platforms: platformIds,
          genres: genreIds,
          languages: languageIds,
          ageRatings: ageRatingIds,
          gameEngines: gameEngineIds,
          // Media
          coverImageUrl: gameData.coverImageUrl,
          screenshotUrls: gameData.screenshotUrls,
          trailerIds: gameData.trailerIds,
          // Ratings
          metacriticScore: gameData.metacriticScore,
          userRating: gameData.userRating,
          userRatingCount: gameData.userRatingCount,
          totalRating: gameData.totalRating,
          totalRatingCount: gameData.totalRatingCount,
          hypes: gameData.hypes,
          // Metadata (relations to collections)
          gameModes: gameModeIds,
          playerPerspectives: playerPerspectiveIds,
          themes: themeIds,
          keywords: keywordIds,
          // Metadata as JSON
          multiplayerModes: gameData.multiplayerModes,
          // URLs
          officialWebsite: gameData.officialWebsite,
          steamUrl: gameData.steamUrl,
          epicUrl: gameData.epicUrl,
          gogUrl: gameData.gogUrl,
          itchUrl: gameData.itchUrl,
          discordUrl: gameData.discordUrl,
          igdbId: gameData.igdbId,
          igdbUrl: gameData.igdbUrl,
        },
        locale: 'en',
        status: 'published',
      } as any);

      strapi.log.info(`[GameFetcher] Created game: ${gameData.name}`);

      // Build locale data for sync service
      // This data is passed to the locale-sync module to create localized entries
      const localeData: GameLocaleData = {
        documentId: created.documentId,
        sourceId: created.id,
        localizedNames: gameData.localizedNames,
        gameData: {
          description: gameData.description,
          releaseDate: gameData.releaseDate,
          gameCategory: gameData.gameCategory,
          gameStatus: gameData.gameStatus,
          coverImageUrl: gameData.coverImageUrl,
          screenshotUrls: gameData.screenshotUrls,
          trailerIds: gameData.trailerIds,
          metacriticScore: gameData.metacriticScore,
          userRating: gameData.userRating,
          userRatingCount: gameData.userRatingCount,
          totalRating: gameData.totalRating,
          totalRatingCount: gameData.totalRatingCount,
          hypes: gameData.hypes,
          multiplayerModes: gameData.multiplayerModes,
          officialWebsite: gameData.officialWebsite,
          steamUrl: gameData.steamUrl,
          epicUrl: gameData.epicUrl,
          gogUrl: gameData.gogUrl,
          itchUrl: gameData.itchUrl,
          discordUrl: gameData.discordUrl,
          igdbId: gameData.igdbId,
          igdbUrl: gameData.igdbUrl,
        },
        relationIds: {
          developers: developerIds,
          publishers: publisherIds,
          franchises: franchiseIds,
          collections: collectionIds,
          platforms: platformIds,
          genres: genreIds,
          languages: languageIds,
          ageRatings: ageRatingIds,
          gameEngines: gameEngineIds,
          gameModes: gameModeIds,
          playerPerspectives: playerPerspectiveIds,
          themes: themeIds,
          keywords: keywordIds,
        },
      };

      // Generate AI descriptions if configured
      let aiGenerated = false;
      let aiError: string | null = null;
      
      if (isAIConfigured()) {
        strapi.log.info(`[GameFetcher] Generating AI descriptions for: ${gameData.name}`);
        try {
          // Get platform names for context
          const platformNames = gameData.platforms.map(p => p.name);
          
          // Get developer name from the first developer
          const developerName = gameData.developersData[0]?.name || null;
          
          // Get publisher name from the first publisher
          const publisherName = gameData.publishersData[0]?.name || null;

          // Get localized names
          const englishName = gameData.localizedNames.en.name;
          const spanishName = gameData.localizedNames.es.name;

          // Build base context (shared between locales)
          const baseContext: Omit<GameDescriptionContext, 'name'> = {
            igdbDescription: gameData.description,
            genres: gameData.genres,
            platforms: platformNames,
            releaseDate: gameData.releaseDate,
            developer: developerName,
            publisher: publisherName,
          };

          // Generate descriptions for both locales in parallel, using locale-specific names
          const [enDescription, esDescription] = await Promise.all([
            generateGameDescription({ ...baseContext, name: englishName }, 'en'),
            generateGameDescription({ ...baseContext, name: spanishName }, 'es'),
          ]);

          // Update English description (this updates the draft)
          strapi.log.info(`[GameFetcher] Updating English description (length: ${enDescription?.length || 0})`);
          try {
            await gameService.update({
              documentId: created.documentId,
              data: { description: enDescription },
              locale: 'en',
            } as any);
            strapi.log.info(`[GameFetcher] English description updated successfully`);
            
            // Publish to sync draft changes to published version
            await (gameService as any).publish({
              documentId: created.documentId,
              locale: 'en',
            });
            strapi.log.info(`[GameFetcher] English game published successfully`);
          } catch (updateError) {
            strapi.log.error(`[GameFetcher] Failed to update/publish English description: ${updateError}`);
          }

          // Sync locales with AI-generated Spanish description
          localeData.aiDescription = esDescription;
          await syncLocales(strapi, localeData);

          aiGenerated = true;
          strapi.log.info(`[GameFetcher] AI descriptions generated for: ${gameData.name}`);
        } catch (error) {
          aiError = error instanceof Error ? error.message : 'Unknown AI error';
          strapi.log.error(`[GameFetcher] AI description error: ${aiError}`);
          // Continue with import - AI is optional, but still sync locales and publish
          await syncLocales(strapi, localeData);
          // Publish English game to sync draft to published
          try {
            await (gameService as any).publish({
              documentId: created.documentId,
              locale: 'en',
            });
          } catch (publishError) {
            strapi.log.error(`[GameFetcher] Failed to publish English game: ${publishError}`);
          }
        }
      } else {
        strapi.log.info(`[GameFetcher] AI not configured, skipping description generation`);
        // Sync locales without AI description
        await syncLocales(strapi, localeData);
        // Publish English game to sync draft to published
        try {
          await (gameService as any).publish({
            documentId: created.documentId,
            locale: 'en',
          });
        } catch (publishError) {
          strapi.log.error(`[GameFetcher] Failed to publish English game: ${publishError}`);
        }
      }

      ctx.body = {
        success: true,
        message: `Game "${gameData.name}" imported successfully`,
        game: created,
        created: true,
        aiGenerated,
        aiError,
        localizedNames: {
          en: { 
            name: gameData.localizedNames.en.name, 
            slug: gameData.slug,
            coverUrl: gameData.localizedNames.en.coverUrl,
          },
          es: { 
            name: gameData.localizedNames.es.name, 
            slug: gameData.localizedNames.es.name
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, ''),
            coverUrl: gameData.localizedNames.es.coverUrl,
            fromIGDB: gameData.localizedNames.es.name !== gameData.name,
          },
        },
        stats: {
          platforms: platformIds.length,
          genres: genreIds.length,
          languages: languageIds.length,
          gameModes: gameModeIds.length,
          playerPerspectives: playerPerspectiveIds.length,
          themes: themeIds.length,
          keywords: keywordIds.length,
          franchises: franchiseIds.length,
          collections: collectionIds.length,
          ageRatings: ageRatingIds.length,
          gameEngines: gameEngineIds.length,
          developers: developerIds.length,
          publishers: publisherIds.length,
          gameStatus: gameData.gameStatus,
          similarGamesAvailable: gameData.similarGameIds.length,
          remakesAvailable: gameData.remakeIds.length,
          remastersAvailable: gameData.remasterIds.length,
        },
      };
    } catch (error) {
      strapi.log.error('[GameFetcher] Import error:', error);
      return ctx.internalServerError('Failed to import game');
    }
  },

  /**
   * Regenerate AI description for an existing game
   * POST /api/game-fetcher/regenerate-description
   * Body: { gameId: string, locale?: 'en' | 'es' | 'both' }
   */
  async regenerateDescription(ctx) {
    const { gameId, locale = 'both' } = ctx.request.body as RegenerateBody;

    if (!gameId) {
      return ctx.badRequest('gameId is required');
    }

    if (!isAIConfigured()) {
      return ctx.badRequest('AI is not configured. Set OPENROUTER_API_KEY environment variable.');
    }

    try {
      const gameService = strapi.documents('api::game.game') as unknown as DocumentService<GameDocument>;

      // Find the game
      const game = await gameService.findOne({
        documentId: gameId,
        locale: 'en',
        populate: ['genres', 'platforms', 'developers', 'publishers'],
      } as any);

      if (!game) {
        return ctx.notFound('Game not found');
      }

      // Extract context from the game
      const genreNames = (game as any).genres?.map((g: { name: string }) => g.name) || [];
      const platformNames = (game as any).platforms?.map((p: { name: string }) => p.name) || [];
      const developerName = (game as any).developers?.[0]?.name || null;
      const publisherName = (game as any).publishers?.[0]?.name || null;

      // Build base context (shared between locales)
      const baseContext: Omit<GameDescriptionContext, 'name'> = {
        igdbDescription: game.description,
        genres: genreNames,
        platforms: platformNames,
        releaseDate: game.releaseDate,
        developer: developerName,
        publisher: publisherName,
      };

      const results: { en?: string; es?: string } = {};

      if (locale === 'en' || locale === 'both') {
        const enDescription = await generateGameDescription({ ...baseContext, name: game.name }, 'en');
        await gameService.update({
          documentId: gameId,
          data: { description: enDescription },
          locale: 'en',
        } as any);
        results.en = enDescription;
        strapi.log.info(`[GameFetcher] Regenerated English description for: ${game.name}`);
      }

      if (locale === 'es' || locale === 'both') {
        // Fetch the Spanish locale to get the localized name
        const spanishGame = await gameService.findOne({
          documentId: gameId,
          locale: 'es',
        } as any);
        
        // Use Spanish name if available, otherwise fall back to English name
        const spanishName = spanishGame?.name || game.name;
        
        const esDescription = await generateGameDescription({ ...baseContext, name: spanishName }, 'es');
        try {
          await gameService.update({
            documentId: gameId,
            data: { description: esDescription },
            locale: 'es',
          } as any);
          results.es = esDescription;
          strapi.log.info(`[GameFetcher] Regenerated Spanish description for: ${spanishName}`);
        } catch {
          strapi.log.warn(`[GameFetcher] Could not update Spanish locale for: ${game.name}`);
        }
      }

      ctx.body = {
        success: true,
        message: `Description regenerated for "${game.name}"`,
        descriptions: results,
      };
    } catch (error) {
      strapi.log.error('[GameFetcher] Regenerate description error:', error);
      return ctx.internalServerError('Failed to regenerate description');
    }
  },

  /**
   * Check AI configuration status
   * GET /api/game-fetcher/ai-status
   */
  async aiStatus(ctx) {
    const status = getAIStatus();
    ctx.body = {
      ...status,
      message: status.configured
        ? 'AI is configured and ready'
        : 'AI is not configured. Set OPENROUTER_API_KEY environment variable.',
    };
  },
});
