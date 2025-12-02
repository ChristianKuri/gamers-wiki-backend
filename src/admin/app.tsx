import type { StrapiApp } from '@strapi/strapi/admin';
import { Download } from '@strapi/icons';

export default {
  config: {
    // Add Spanish to admin panel language options (en is included by default)
    locales: ['es'],
  },
  register(app: StrapiApp) {
    // Add IGDB Import to the main menu
    app.addMenuLink({
      to: 'plugins/game-importer',
      icon: Download,
      intlLabel: {
        id: 'game-importer.plugin.name',
        defaultMessage: 'Import from IGDB',
      },
      Component: async () => {
        const component = await import('./pages/GameImporter');
        return component.default;
      },
      position: 5,
      permissions: [],
    });
  },
  bootstrap(app: StrapiApp) {
    // Bootstrap logic can be added here if needed
  },
};
