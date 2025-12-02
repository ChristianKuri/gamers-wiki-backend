import type { Core } from '@strapi/strapi';
import type { Seeder } from './types';

/**
 * Author data for seeding
 * 
 * Author is a pure content profile for E-E-A-T and SEO purposes.
 * No user relation - content ownership is tracked via Strapi's built-in createdBy/updatedBy.
 */
const AUTHORS = [
  {
    en: {
      name: 'Christian Kuri',
      slug: 'christian-kuri',
      email: 'christian.kuri.martinez@gmail.com',
      bio: '<p>Founder of Gamers.Wiki and passionate gamer with over 15 years of experience. Specializing in Souls-likes, roguelites, and indie gems. Always hunting for the next challenging boss fight.</p>',
      jobTitle: 'Founder & Editor-in-Chief',
      specializations: 'Souls-like, Roguelite, Metroidvania, Indie Games, Action RPG',
      experience_since: '2010-01-01',
      verified_credentials: 'Gamers.Wiki Founder',
      socialLinks: {
        twitter: 'https://twitter.com/christiankuri',
        github: 'https://github.com/christiankuri',
        linkedin: 'https://linkedin.com/in/christiankuri',
      },
    },
    es: {
      bio: '<p>Fundador de Gamers.Wiki y gamer apasionado con más de 15 años de experiencia. Especializado en Souls-likes, roguelites y joyas indie. Siempre buscando la próxima pelea de jefe desafiante.</p>',
      jobTitle: 'Fundador y Editor en Jefe',
      verified_credentials: 'Fundador de Gamers.Wiki',
    },
  },
];

export const authorSeeder: Seeder = {
  name: 'Author',

  async run(strapi: Core.Strapi) {
    const authorService = strapi.documents('api::author.author');

    for (const data of AUTHORS) {
      // Check if author already exists (by slug)
      const existingAuthor = await authorService.findMany({
        filters: { slug: data.en.slug },
        locale: 'en',
      });

      if (existingAuthor.length > 0) {
        strapi.log.debug(`[Seeder] Author "${data.en.name}" already exists, skipping...`);
        continue;
      }

      // Step 1: Create English version of author (draft)
      const created = await authorService.create({
        data: {
          name: data.en.name,
          slug: data.en.slug,
          bio: data.en.bio,
          jobTitle: data.en.jobTitle,
          specializations: data.en.specializations,
          experience_since: data.en.experience_since,
          verified_credentials: data.en.verified_credentials,
          socialLinks: data.en.socialLinks,
          email: data.en.email,
        },
        locale: 'en',
      });

      strapi.log.info(`[Seeder] Created author draft: ${data.en.name} (en)`);

      // Step 2: Create Spanish version
      try {
        await authorService.update({
          documentId: created.documentId,
          locale: 'es',
          data: {
            name: data.en.name,
            slug: data.en.slug,
            bio: data.es.bio,
            jobTitle: data.es.jobTitle,
            verified_credentials: data.es.verified_credentials,
            specializations: data.en.specializations,
            experience_since: data.en.experience_since,
            socialLinks: data.en.socialLinks,
            email: data.en.email,
          },
        });
        strapi.log.info(`[Seeder] Created author draft: ${data.en.name} (es)`);
      } catch (error) {
        strapi.log.error(`[Seeder] Failed to create Spanish locale: ${error}`);
      }

      // Step 3: Publish English version
      try {
        await authorService.publish({
          documentId: created.documentId,
          locale: 'en',
        });
        strapi.log.info(`[Seeder] Published author: ${data.en.name} (en)`);
      } catch (error) {
        strapi.log.error(`[Seeder] Failed to publish English: ${error}`);
      }

      // Step 4: Publish Spanish version
      try {
        await authorService.publish({
          documentId: created.documentId,
          locale: 'es',
        });
        strapi.log.info(`[Seeder] Published author: ${data.en.name} (es)`);
      } catch (error) {
        strapi.log.error(`[Seeder] Failed to publish Spanish: ${error}`);
      }
    }
  },
};
