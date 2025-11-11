export default ({ env }) => ({
  upload: {
    config: {
      provider: 'aws-s3',
      providerOptions: {
        baseUrl: env('CDN_URL'),
        rootPath: env('AWS_ROOT_PATH') || '',
        s3Options: {
          credentials: {
            accessKeyId: env('AWS_ACCESS_KEY_ID'),
            secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
          },
          region: env('AWS_REGION'),
          // For Cloudflare R2, uncomment the endpoint line below
          // endpoint: env('R2_ENDPOINT'),
        },
        // AWS S3 bucket params
        params: {
          Bucket: env('AWS_BUCKET_NAME'),
        },
      },
    },
  },
});
