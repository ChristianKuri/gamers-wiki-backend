import type { Core } from '@strapi/strapi';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // Seed Spanish locale if it doesn't exist
    const existingLocales = await strapi.db.query('plugin::i18n.locale').findMany();
    const hasSpanish = existingLocales.some((locale: { code: string }) => locale.code === 'es');

    if (!hasSpanish) {
      await strapi.db.query('plugin::i18n.locale').create({
        data: {
          code: 'es',
          name: 'Spanish (es)',
        },
      });
      strapi.log.info('Created Spanish (es) locale');
    }
  },
};
