/**
 * Game Fetcher Plugin Routes
 * 
 * Using 'content-api' type makes routes available at:
 * /api/game-fetcher/[path]
 */
export default {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/status',
      handler: 'game-fetcher.status',
      config: {
        policies: [],
        auth: false, // Allow unauthenticated for status check
      },
    },
    {
      method: 'GET',
      path: '/search',
      handler: 'game-fetcher.search',
      config: {
        policies: [],
        auth: false, // We'll handle auth manually or make it public for testing
      },
    },
    {
      method: 'GET',
      path: '/game/:igdbId',
      handler: 'game-fetcher.getGame',
      config: {
        policies: [],
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/import',
      handler: 'game-fetcher.importGame',
      config: {
        policies: [],
        auth: false, // TODO: Add auth after testing
      },
    },
  ],
};
