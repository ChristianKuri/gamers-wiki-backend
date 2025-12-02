import type { Core } from '@strapi/strapi';
import type { Seeder, LocalizedData, TaxonomyData } from './types';

/**
 * Category seed data with translations
 */
const CATEGORY_DATA: LocalizedData<TaxonomyData>[] = [
  {
    en: { name: 'News', slug: 'news', description: 'Latest gaming news and announcements' },
    es: { name: 'Noticias', slug: 'noticias', description: 'Últimas noticias y anuncios de videojuegos' },
  },
  {
    en: { name: 'Review', slug: 'reviews', description: 'In-depth game reviews and analysis' },
    es: { name: 'Reseñas', slug: 'resenas', description: 'Reseñas y análisis de videojuegos en profundidad' },
  },
  {
    en: { name: 'Guide', slug: 'guides', description: 'Walkthroughs, tips, and how-to guides' },
    es: { name: 'Guías', slug: 'guias', description: 'Guías paso a paso, consejos y tutoriales' },
  },
  {
    en: { name: 'List', slug: 'lists', description: 'Top picks, rankings, and curated lists' },
    es: { name: 'Listas', slug: 'listas', description: 'Mejores selecciones, rankings y listas curadas' },
  },
];

export const categorySeeder: Seeder = {
  name: 'Category',

  async run(strapi: Core.Strapi) {
    const service = strapi.documents('api::category.category');

    for (const data of CATEGORY_DATA) {
      // Check if already exists (by English slug)
      const existing = await service.findMany({
        filters: { slug: data.en.slug },
        locale: 'en',
      });

      if (existing.length > 0) {
        strapi.log.debug(`[Seeder] Category "${data.en.name}" already exists, skipping...`);
        continue;
      }

      // Create English version (default locale)
      const created = await service.create({
        data: {
          name: data.en.name,
          slug: data.en.slug,
          description: data.en.description,
        },
        locale: 'en',
      });

      strapi.log.info(`[Seeder] Created category: ${data.en.name} (en)`);

      // Create Spanish version
      await service.update({
        documentId: created.documentId,
        data: {
          name: data.es.name,
          slug: data.es.slug,
          description: data.es.description,
        },
        locale: 'es',
      });

      strapi.log.info(`[Seeder] Created category: ${data.es.name} (es)`);

      // Publish all locales
      await service.publish({
        documentId: created.documentId,
        locale: '*',
      });
    }
  },
};

