import type { Core } from '@strapi/strapi';
import type { Seeder, LocalizedData } from './types';

/**
 * Genre data type (name + slug only)
 */
interface GenreData {
  name: string;
  slug: string;
}

/**
 * Genre seed data with translations
 * 
 * Genres are used for game classification:
 * - Action RPG, Roguelite, Souls-like, Metroidvania, etc.
 */
const GENRE_DATA: LocalizedData<GenreData>[] = [
  // Action-based genres
  {
    en: { name: 'Action RPG', slug: 'action-rpg' },
    es: { name: 'RPG de Acción', slug: 'rpg-de-accion' },
  },
  {
    en: { name: 'Souls-like', slug: 'souls-like' },
    es: { name: 'Souls-like', slug: 'souls-like' },
  },
  {
    en: { name: 'Roguelite', slug: 'roguelite' },
    es: { name: 'Roguelite', slug: 'roguelite' },
  },
  {
    en: { name: 'Roguelike', slug: 'roguelike' },
    es: { name: 'Roguelike', slug: 'roguelike' },
  },
  {
    en: { name: 'Metroidvania', slug: 'metroidvania' },
    es: { name: 'Metroidvania', slug: 'metroidvania' },
  },
  {
    en: { name: 'Hack and Slash', slug: 'hack-and-slash' },
    es: { name: 'Hack and Slash', slug: 'hack-and-slash' },
  },
  // Shooter genres
  {
    en: { name: 'First-Person Shooter', slug: 'fps' },
    es: { name: 'Shooter en Primera Persona', slug: 'fps' },
  },
  {
    en: { name: 'Third-Person Shooter', slug: 'third-person-shooter' },
    es: { name: 'Shooter en Tercera Persona', slug: 'shooter-tercera-persona' },
  },
  {
    en: { name: 'Battle Royale', slug: 'battle-royale' },
    es: { name: 'Battle Royale', slug: 'battle-royale' },
  },
  // RPG genres
  {
    en: { name: 'JRPG', slug: 'jrpg' },
    es: { name: 'JRPG', slug: 'jrpg' },
  },
  {
    en: { name: 'MMORPG', slug: 'mmorpg' },
    es: { name: 'MMORPG', slug: 'mmorpg' },
  },
  {
    en: { name: 'Turn-Based RPG', slug: 'turn-based-rpg' },
    es: { name: 'RPG por Turnos', slug: 'rpg-por-turnos' },
  },
  {
    en: { name: 'Tactical RPG', slug: 'tactical-rpg' },
    es: { name: 'RPG Táctico', slug: 'rpg-tactico' },
  },
  // Strategy genres
  {
    en: { name: 'Real-Time Strategy', slug: 'rts' },
    es: { name: 'Estrategia en Tiempo Real', slug: 'estrategia-tiempo-real' },
  },
  {
    en: { name: 'Turn-Based Strategy', slug: 'turn-based-strategy' },
    es: { name: 'Estrategia por Turnos', slug: 'estrategia-por-turnos' },
  },
  {
    en: { name: 'MOBA', slug: 'moba' },
    es: { name: 'MOBA', slug: 'moba' },
  },
  // Adventure & Exploration
  {
    en: { name: 'Open World', slug: 'open-world' },
    es: { name: 'Mundo Abierto', slug: 'mundo-abierto' },
  },
  {
    en: { name: 'Survival', slug: 'survival' },
    es: { name: 'Supervivencia', slug: 'supervivencia' },
  },
  {
    en: { name: 'Survival Horror', slug: 'survival-horror' },
    es: { name: 'Terror de Supervivencia', slug: 'terror-supervivencia' },
  },
  // Platformer & Action
  {
    en: { name: 'Platformer', slug: 'platformer' },
    es: { name: 'Plataformas', slug: 'plataformas' },
  },
  {
    en: { name: 'Fighting', slug: 'fighting' },
    es: { name: 'Lucha', slug: 'lucha' },
  },
  {
    en: { name: 'Beat \'em Up', slug: 'beat-em-up' },
    es: { name: 'Beat \'em Up', slug: 'beat-em-up' },
  },
  // Simulation & Sports
  {
    en: { name: 'Simulation', slug: 'simulation' },
    es: { name: 'Simulación', slug: 'simulacion' },
  },
  {
    en: { name: 'Sports', slug: 'sports' },
    es: { name: 'Deportes', slug: 'deportes' },
  },
  {
    en: { name: 'Racing', slug: 'racing' },
    es: { name: 'Carreras', slug: 'carreras' },
  },
  // Puzzle & Casual
  {
    en: { name: 'Puzzle', slug: 'puzzle' },
    es: { name: 'Puzzle', slug: 'puzzle' },
  },
  {
    en: { name: 'Visual Novel', slug: 'visual-novel' },
    es: { name: 'Novela Visual', slug: 'novela-visual' },
  },
  // Indie favorites
  {
    en: { name: 'Indie', slug: 'indie' },
    es: { name: 'Indie', slug: 'indie' },
  },
  {
    en: { name: 'Cozy Game', slug: 'cozy-game' },
    es: { name: 'Juego Relajante', slug: 'juego-relajante' },
  },
  {
    en: { name: 'City Builder', slug: 'city-builder' },
    es: { name: 'Construcción de Ciudades', slug: 'construccion-ciudades' },
  },
];

export const genreSeeder: Seeder = {
  name: 'Genre',

  async run(strapi: Core.Strapi) {
    const service = strapi.documents('api::genre.genre');

    for (const data of GENRE_DATA) {
      // Check if already exists (by English slug)
      const existing = await service.findMany({
        filters: { slug: data.en.slug },
        locale: 'en',
      });

      if (existing.length > 0) {
        strapi.log.debug(`[Seeder] Genre "${data.en.name}" already exists, skipping...`);
        continue;
      }

      // Step 1: Create English version (draft)
      const created = await service.create({
        data: {
          name: data.en.name,
          slug: data.en.slug,
        },
        locale: 'en',
      });

      strapi.log.info(`[Seeder] Created genre draft: ${data.en.name} (en)`);

      // Step 2: Create Spanish version using update with locale
      try {
        await service.update({
          documentId: created.documentId,
          locale: 'es',
          data: {
            name: data.es.name,
            slug: data.es.slug,
          },
        });
        strapi.log.info(`[Seeder] Created genre draft: ${data.es.name} (es)`);
      } catch (error) {
        strapi.log.error(`[Seeder] Failed to create Spanish locale: ${error}`);
      }

      // Step 3: Publish English version
      try {
        await service.publish({
          documentId: created.documentId,
          locale: 'en',
        });
        strapi.log.info(`[Seeder] Published genre: ${data.en.name} (en)`);
      } catch (error) {
        strapi.log.error(`[Seeder] Failed to publish English: ${error}`);
      }

      // Step 4: Publish Spanish version
      try {
        await service.publish({
          documentId: created.documentId,
          locale: 'es',
        });
        strapi.log.info(`[Seeder] Published genre: ${data.es.name} (es)`);
      } catch (error) {
        strapi.log.error(`[Seeder] Failed to publish Spanish: ${error}`);
      }
    }
  },
};

