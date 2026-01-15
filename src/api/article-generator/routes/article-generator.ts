/**
 * Article Generator API Routes
 *
 * These are available at /api/article-generator/*
 * 
 * Both routes use the same handler - SSE mode is enabled via `?sse=true` query param or `sse: true` in body.
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
    {
      method: 'POST',
      path: '/article-generator/generate-sse',
      handler: 'article-generator.generate',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
