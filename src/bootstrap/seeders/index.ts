import type { Core } from '@strapi/strapi';
import type { Seeder } from './types';
import { localeSeeder } from './locale.seeder';
import { categorySeeder } from './category.seeder';
import { tagSeeder } from './tag.seeder';
import { genreSeeder } from './genre.seeder';

/**
 * All seeders to run during bootstrap.
 * Order matters - seeders run sequentially in this order.
 * 
 * IMPORTANT: Locale seeder must run first to ensure locales exist
 * before seeding localized content.
 */
const seeders: Seeder[] = [
  localeSeeder,    // Must be first - creates locales
  categorySeeder,
  tagSeeder,
  genreSeeder,
  // Add more seeders here as needed:
  // authorSeeder,
  // gameSeeder,
];

/**
 * Runs all registered seeders.
 * Each seeder should be idempotent (safe to run multiple times).
 */
export async function runSeeders(strapi: Core.Strapi): Promise<void> {
  strapi.log.info(`[Seeder] Running ${seeders.length} seeder(s)...`);

  for (const seeder of seeders) {
    try {
      strapi.log.info(`[Seeder] Running: ${seeder.name}`);
      await seeder.run(strapi);
      strapi.log.info(`[Seeder] Completed: ${seeder.name}`);
    } catch (error) {
      strapi.log.error(`[Seeder] Failed: ${seeder.name}`);
      strapi.log.error(error);
      // Continue with other seeders even if one fails
    }
  }

  strapi.log.info(`[Seeder] All seeders completed.`);
}

// Re-export types for convenience
export type { Seeder, LocalizedData, TaxonomyData } from './types';

