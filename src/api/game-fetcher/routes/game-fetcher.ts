/**
 * Game Fetcher API Routes
 * 
 * Custom routes for IGDB integration.
 * These are available at /api/game-fetcher/*
 */
export default {
  routes: [
    {
      method: 'GET',
      path: '/game-fetcher/status',
      handler: 'game-fetcher.status',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/game-fetcher/search',
      handler: 'game-fetcher.search',
      config: {
        auth: false, // TODO: Add auth after testing
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/game-fetcher/resolve',
      handler: 'game-fetcher.resolve',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/game-fetcher/game/:igdbId',
      handler: 'game-fetcher.getGame',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/game-fetcher/import',
      handler: 'game-fetcher.importGame',
      config: {
        auth: false, // TODO: Add auth after testing
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/game-fetcher/regenerate-description',
      handler: 'game-fetcher.regenerateDescription',
      config: {
        auth: false, // TODO: Add auth after testing
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/game-fetcher/ai-status',
      handler: 'game-fetcher.aiStatus',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};

