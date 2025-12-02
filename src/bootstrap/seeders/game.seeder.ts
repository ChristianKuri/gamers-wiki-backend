import type { Core } from '@strapi/strapi';
import type { Seeder } from './types';

/**
 * Game data for seeding
 * 
 * These are manually defined games for initial seeding when IGDB credentials
 * are not available. When IGDB is configured, prefer using the import endpoint.
 * 
 * IGDB IDs can be found at: https://www.igdb.com/games/[slug]
 */
const SEED_GAMES = [
  {
    en: {
      name: 'Elden Ring',
      slug: 'elden-ring',
      description: '<p>THE NEW FANTASY ACTION RPG. Rise, Tarnished, and be guided by grace to brandish the power of the Elden Ring and become an Elden Lord in the Lands Between.</p>',
      developer: 'FromSoftware',
      publisher: 'Bandai Namco Entertainment',
      releaseDate: '2022-02-25',
      platforms: ['PC', 'PlayStation 5', 'PlayStation 4', 'Xbox Series X/S', 'Xbox One'],
      metacriticScore: 96,
      igdbId: 119133,
      igdbUrl: 'https://www.igdb.com/games/elden-ring',
      coverImageUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co4jni.jpg',
      genres: ['Action RPG', 'Adventure'],
    },
    es: {
      description: '<p>EL NUEVO RPG DE ACCIÓN Y FANTASÍA. Álzate, Sinluz, y deja que la gracia te guíe para blandir el poder del Anillo de Elden y convertirte en un Señor de Elden en las Tierras Intermedias.</p>',
    },
  },
  {
    en: {
      name: 'Hollow Knight',
      slug: 'hollow-knight',
      description: '<p>Forge your own path in Hollow Knight! An epic action adventure through a vast ruined kingdom of insects and heroes. Explore twisting caverns, battle tainted creatures and befriend bizarre bugs, all in a classic, hand-drawn 2D style.</p>',
      developer: 'Team Cherry',
      publisher: 'Team Cherry',
      releaseDate: '2017-02-24',
      platforms: ['PC', 'PlayStation 4', 'Xbox One', 'Nintendo Switch', 'macOS', 'Linux'],
      metacriticScore: 87,
      igdbId: 26758,
      igdbUrl: 'https://www.igdb.com/games/hollow-knight',
      coverImageUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1rgi.jpg',
      genres: ['Metroidvania', 'Action', 'Platformer'],
    },
    es: {
      description: '<p>¡Forja tu propio camino en Hollow Knight! Una épica aventura de acción a través de un vasto reino arruinado de insectos y héroes. Explora cavernas retorcidas, combate criaturas corrompidas y hazte amigo de bichos extraños, todo en un estilo clásico 2D dibujado a mano.</p>',
    },
  },
  {
    en: {
      name: 'Hades',
      slug: 'hades',
      description: '<p>Defy the god of the dead as you hack and slash out of the Underworld in this rogue-like dungeon crawler from the creators of Bastion and Transistor.</p>',
      developer: 'Supergiant Games',
      publisher: 'Supergiant Games',
      releaseDate: '2020-09-17',
      platforms: ['PC', 'PlayStation 5', 'PlayStation 4', 'Xbox Series X/S', 'Xbox One', 'Nintendo Switch'],
      metacriticScore: 93,
      igdbId: 113112,
      igdbUrl: 'https://www.igdb.com/games/hades--1',
      coverImageUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1tmu.jpg',
      genres: ['Roguelite', 'Action', 'Hack and Slash'],
    },
    es: {
      description: '<p>Desafía al dios de los muertos mientras te abres paso a golpes desde el Inframundo en este roguelike dungeon crawler de los creadores de Bastion y Transistor.</p>',
    },
  },
];

async function findOrCreateGenre(strapi: Core.Strapi, genreName: string): Promise<string> {
  const genreService = strapi.documents('api::genre.genre');
  
  const existing = await genreService.findMany({
    filters: { name: genreName },
    locale: 'en',
  });

  if (existing.length > 0) {
    return existing[0].documentId;
  }

  // Create the genre
  const created = await genreService.create({
    data: {
      name: genreName,
      slug: genreName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    },
    locale: 'en',
  });

  // Publish it
  await genreService.publish({
    documentId: created.documentId,
    locale: 'en',
  });

  strapi.log.info(`[Seeder] Created genre: ${genreName}`);
  return created.documentId;
}

async function findOrCreatePlatform(strapi: Core.Strapi, platformName: string): Promise<string> {
  const platformService = strapi.documents('api::platform.platform' as any);
  
  const existing = await platformService.findMany({
    filters: { name: platformName },
    locale: 'en',
  } as any);

  if (existing.length > 0) {
    return existing[0].documentId;
  }

  // Create the platform
  const created = await platformService.create({
    data: {
      name: platformName,
      slug: platformName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    },
    locale: 'en',
  } as any);

  // Publish it
  await (platformService as any).publish({
    documentId: created.documentId,
    locale: 'en',
  });

  strapi.log.info(`[Seeder] Created platform: ${platformName}`);
  return created.documentId;
}

export const gameSeeder: Seeder = {
  name: 'Game',

  async run(strapi: Core.Strapi) {
    // Using 'as any' for the content type because types are generated after first run
    // This is safe because the schema is defined in schema.json
    const gameService = strapi.documents('api::game.game' as any);

    for (const data of SEED_GAMES) {
      // Check if game already exists (by slug or igdbId)
      const existingGames = await gameService.findMany({
        filters: {
          $or: [
            { slug: data.en.slug },
            { igdbId: data.en.igdbId },
          ],
        },
        locale: 'en',
      } as any);

      if (existingGames.length > 0) {
        strapi.log.debug(`[Seeder] Game "${data.en.name}" already exists, skipping...`);
        continue;
      }

      // Find or create genres
      const genreIds: string[] = [];
      for (const genreName of data.en.genres) {
        const genreId = await findOrCreateGenre(strapi, genreName);
        genreIds.push(genreId);
      }

      // Find or create platforms
      const platformIds: string[] = [];
      for (const platformName of data.en.platforms) {
        const platformId = await findOrCreatePlatform(strapi, platformName);
        platformIds.push(platformId);
      }

      // Step 1: Create English version of game (draft)
      const created = await gameService.create({
        data: {
          name: data.en.name,
          slug: data.en.slug,
          description: data.en.description,
          developer: data.en.developer,
          publisher: data.en.publisher,
          releaseDate: data.en.releaseDate,
          platforms: platformIds,
          metacriticScore: data.en.metacriticScore,
          igdbId: data.en.igdbId,
          igdbUrl: data.en.igdbUrl,
          coverImageUrl: data.en.coverImageUrl,
          genres: genreIds,
        },
        locale: 'en',
      } as any);

      strapi.log.info(`[Seeder] Created game draft: ${data.en.name} (en)`);

      // Step 2: Create Spanish version
      try {
        await gameService.update({
          documentId: created.documentId,
          locale: 'es',
          data: {
            name: data.en.name,
            slug: data.en.slug,
            description: data.es.description,
            developer: data.en.developer,
            publisher: data.en.publisher,
            releaseDate: data.en.releaseDate,
            platforms: platformIds,
            metacriticScore: data.en.metacriticScore,
            igdbId: data.en.igdbId,
            igdbUrl: data.en.igdbUrl,
            coverImageUrl: data.en.coverImageUrl,
            genres: genreIds,
          },
        } as any);
        strapi.log.info(`[Seeder] Created game draft: ${data.en.name} (es)`);
      } catch (error) {
        strapi.log.error(`[Seeder] Failed to create Spanish locale for ${data.en.name}: ${error}`);
      }

      // Step 3: Publish English version
      try {
        await (gameService as any).publish({
          documentId: created.documentId,
          locale: 'en',
        });
        strapi.log.info(`[Seeder] Published game: ${data.en.name} (en)`);
      } catch (error) {
        strapi.log.error(`[Seeder] Failed to publish English version of ${data.en.name}: ${error}`);
      }

      // Step 4: Publish Spanish version
      try {
        await (gameService as any).publish({
          documentId: created.documentId,
          locale: 'es',
        });
        strapi.log.info(`[Seeder] Published game: ${data.en.name} (es)`);
      } catch (error) {
        strapi.log.error(`[Seeder] Failed to publish Spanish version of ${data.en.name}: ${error}`);
      }
    }
  },
};

