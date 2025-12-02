import type { Core } from '@strapi/strapi';
import type { Seeder } from './types';

/**
 * Locales to seed beyond the default (en)
 */
const LOCALES = [
  { code: 'es', name: 'Spanish (es)' },
  // Add more locales here as needed:
  // { code: 'pt-BR', name: 'Portuguese (Brazil)' },
  // { code: 'de', name: 'German (de)' },
];

export const localeSeeder: Seeder = {
  name: 'Locale',

  async run(strapi: Core.Strapi) {
    const existingLocales = await strapi.db.query('plugin::i18n.locale').findMany();

    for (const locale of LOCALES) {
      const exists = existingLocales.some((l: { code: string }) => l.code === locale.code);

      if (exists) {
        strapi.log.debug(`[Seeder] Locale "${locale.code}" already exists, skipping...`);
        continue;
      }

      await strapi.db.query('plugin::i18n.locale').create({
        data: {
          code: locale.code,
          name: locale.name,
        },
      });

      strapi.log.info(`[Seeder] Created locale: ${locale.name}`);
    }
  },
};

