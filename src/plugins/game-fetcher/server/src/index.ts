/**
 * Game Fetcher Plugin - Server Entry Point
 * 
 * This plugin integrates with IGDB API to fetch game data
 * for auto-populating game entries in Strapi.
 */
import services from './services';
import controllers from './controllers';
import routes from './routes';

export default {
  services,
  controllers,
  routes,
};

