/**
 * Article Generator API Routes
 *
 * These are available at /api/article-generator/*
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/article-generator/generate',
      handler: 'article-generator.generate',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
