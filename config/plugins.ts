export default ({ env }) => ({
  upload: {
    config: {
      provider: 'aws-s3',
      providerOptions: {
        // CloudFront URL - files will be served through CDN, not direct S3
        baseUrl: env('CDN_URL'),
        rootPath: env('CDN_ROOT_PATH'),
        s3Options: {
          credentials: {
            accessKeyId: env('AWS_ACCESS_KEY_ID'),
            secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
          },
          region: env('AWS_REGION'),
          params: {
            // Private bucket - CloudFront handles public access
            ACL: 'private',
            Bucket: env('AWS_BUCKET_NAME'),
          },
        },
      },
      actionOptions: {
        upload: {},
        uploadStream: {},
        delete: {},
      },
    },
  },
  // MCP plugin - only enabled in development for AI-assisted development
  // Conditionally include plugin config to avoid resolution errors in production
  ...(process.env.NODE_ENV === 'development' && {
    mcp: {
      enabled: true,
      resolve: './node_modules/@sensinum/strapi-plugin-mcp',
      config: {
        sessionStorage: 'memory',
      },
    },
  }),
  // Internationalization plugin for multi-language content
  i18n: {
    enabled: true,
    config: {
      defaultLocale: 'en',
    },
  },
  // Note: Game Fetcher is implemented as a custom API at src/api/game-fetcher/
  // instead of a plugin for simpler development workflow
});
