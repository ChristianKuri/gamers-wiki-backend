export default ({ env }) => {
  // Extract domain from CDN_URL if it exists
  const cdnUrl = env('CDN_URL');
  const cdnDomain = cdnUrl ? new URL(cdnUrl).hostname : null;

  return [
    'strapi::logger',
    'strapi::errors',
    {
      name: 'strapi::security',
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            'connect-src': ["'self'", 'https:'],
            'img-src': [
              "'self'",
              'data:',
              'blob:',
              'market-assets.strapi.io',
              ...(cdnDomain ? [cdnDomain] : []),
            ],
            'media-src': [
              "'self'",
              'data:',
              'blob:',
              'market-assets.strapi.io',
              ...(cdnDomain ? [cdnDomain] : []),
            ],
            upgradeInsecureRequests: null,
          },
        },
      },
    },
    'strapi::cors',
    'strapi::poweredBy',
    'strapi::query',
    'strapi::body',
    'strapi::session',
    'strapi::favicon',
    'strapi::public',
  ];
};
