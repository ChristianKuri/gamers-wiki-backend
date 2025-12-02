import type { Core } from '@strapi/strapi';
import type { Seeder, LocalizedData } from './types';

/**
 * Tag data type (name + slug only, no description)
 */
interface TagData {
  name: string;
  slug: string;
}

/**
 * Tag seed data with translations
 * 
 * Tags are used for granular topic classification:
 * - Boss Guide, Beginner Tips, Speedrun, Build Guide, etc.
 */
const TAG_DATA: LocalizedData<TagData>[] = [
  // Guide-related tags
  {
    en: { name: 'Boss Guide', slug: 'boss-guide' },
    es: { name: 'Guía de Jefes', slug: 'guia-de-jefes' },
  },
  {
    en: { name: 'Beginner Tips', slug: 'beginner-tips' },
    es: { name: 'Consejos para Principiantes', slug: 'consejos-principiantes' },
  },
  {
    en: { name: 'Speedrun', slug: 'speedrun' },
    es: { name: 'Speedrun', slug: 'speedrun' },
  },
  {
    en: { name: 'Build Guide', slug: 'build-guide' },
    es: { name: 'Guía de Builds', slug: 'guia-de-builds' },
  },
  {
    en: { name: 'Walkthrough', slug: 'walkthrough' },
    es: { name: 'Guía Completa', slug: 'guia-completa' },
  },
  {
    en: { name: 'Tips & Tricks', slug: 'tips-and-tricks' },
    es: { name: 'Trucos y Consejos', slug: 'trucos-y-consejos' },
  },
  // Feature/Topic tags
  {
    en: { name: 'Character Guide', slug: 'character-guide' },
    es: { name: 'Guía de Personajes', slug: 'guia-de-personajes' },
  },
  {
    en: { name: 'Secrets', slug: 'secrets' },
    es: { name: 'Secretos', slug: 'secretos' },
  },
  {
    en: { name: 'Collectibles', slug: 'collectibles' },
    es: { name: 'Coleccionables', slug: 'coleccionables' },
  },
  {
    en: { name: 'Achievement Guide', slug: 'achievement-guide' },
    es: { name: 'Guía de Logros', slug: 'guia-de-logros' },
  },
  // News-related tags
  {
    en: { name: 'Release Date', slug: 'release-date' },
    es: { name: 'Fecha de Lanzamiento', slug: 'fecha-de-lanzamiento' },
  },
  {
    en: { name: 'Patch Notes', slug: 'patch-notes' },
    es: { name: 'Notas del Parche', slug: 'notas-del-parche' },
  },
  {
    en: { name: 'DLC', slug: 'dlc' },
    es: { name: 'DLC', slug: 'dlc' },
  },
  {
    en: { name: 'Trailer', slug: 'trailer' },
    es: { name: 'Tráiler', slug: 'trailer' },
  },
  // Review-related tags
  {
    en: { name: 'First Impressions', slug: 'first-impressions' },
    es: { name: 'Primeras Impresiones', slug: 'primeras-impresiones' },
  },
  {
    en: { name: 'Performance Analysis', slug: 'performance-analysis' },
    es: { name: 'Análisis de Rendimiento', slug: 'analisis-de-rendimiento' },
  },
  // Platform tags
  {
    en: { name: 'PC', slug: 'pc' },
    es: { name: 'PC', slug: 'pc' },
  },
  {
    en: { name: 'PlayStation', slug: 'playstation' },
    es: { name: 'PlayStation', slug: 'playstation' },
  },
  {
    en: { name: 'Xbox', slug: 'xbox' },
    es: { name: 'Xbox', slug: 'xbox' },
  },
  {
    en: { name: 'Nintendo Switch', slug: 'nintendo-switch' },
    es: { name: 'Nintendo Switch', slug: 'nintendo-switch' },
  },
];

export const tagSeeder: Seeder = {
  name: 'Tag',

  async run(strapi: Core.Strapi) {
    const service = strapi.documents('api::tag.tag');

    for (const data of TAG_DATA) {
      // Check if already exists (by English slug)
      const existing = await service.findMany({
        filters: { slug: data.en.slug },
        locale: 'en',
      });

      if (existing.length > 0) {
        strapi.log.debug(`[Seeder] Tag "${data.en.name}" already exists, skipping...`);
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

      strapi.log.info(`[Seeder] Created tag draft: ${data.en.name} (en)`);

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
        strapi.log.info(`[Seeder] Created tag draft: ${data.es.name} (es)`);
      } catch (error) {
        strapi.log.error(`[Seeder] Failed to create Spanish locale: ${error}`);
      }

      // Step 3: Publish English version
      try {
        await service.publish({
          documentId: created.documentId,
          locale: 'en',
        });
        strapi.log.info(`[Seeder] Published tag: ${data.en.name} (en)`);
      } catch (error) {
        strapi.log.error(`[Seeder] Failed to publish English: ${error}`);
      }

      // Step 4: Publish Spanish version
      try {
        await service.publish({
          documentId: created.documentId,
          locale: 'es',
        });
        strapi.log.info(`[Seeder] Published tag: ${data.es.name} (es)`);
      } catch (error) {
        strapi.log.error(`[Seeder] Failed to publish Spanish: ${error}`);
      }
    }
  },
};

