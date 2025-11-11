export default ({ env }) => ({
  upload: {
    config: {
      provider: 'aws-s3',
      providerOptions: {
        // CloudFront URL - files will be served through CDN, not direct S3
        baseUrl: env('CDN_URL'),
        // Optional: only include rootPath if CDN_ROOT_PATH is set
        ...(env('CDN_ROOT_PATH') && { rootPath: env('CDN_ROOT_PATH') }),
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
});
