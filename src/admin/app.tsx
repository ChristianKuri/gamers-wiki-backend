import type { StrapiApp } from '@strapi/strapi/admin';

export default {
  config: {
    // Add Spanish to admin panel language options (en is included by default)
    locales: ['es'],
  },
  bootstrap(app: StrapiApp) {
    // Bootstrap logic can be added here if needed
  },
};

