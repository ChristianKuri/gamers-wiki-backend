import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import type { ServerResponse } from 'http';

import type { GameDocument } from '../../../types/strapi';
import { isAIConfigured } from '../../../ai';
import { generateGameArticleDraft } from '../../../ai/articles/generate-game-article';
import { slugify } from '../../../utils/slug';
import { importOrGetGameByIgdbId, GameImportError } from '../../game-fetcher/services/import-game-programmatic';
import { resolveIGDBGameIdFromQuery } from '../../game-fetcher/services/game-resolver';
import { fetchIGDBImagesForGame } from '../../game-fetcher/services/igdb-images';
import { isAuthenticated } from '../utils/admin-auth';
import { generateAndUploadArticleAudio } from '../../../ai/articles/services/article-audio-generator';
import { extractStoredCosts, extractStoredPlan, extractStoredSources } from '../utils/shared-helpers';
import type {
  SSEEvent,
  CategoryDocument,
  AuthorDocument,
  PostDocument,
  StrapiDocumentService,
} from '../types';

const bodySchema = z.object({
  gameDocumentId: z.string().min(1).optional(),
  igdbId: z.number().int().positive().optional(),
  gameQuery: z.string().min(2).max(200).optional(),
  instruction: z.string().min(1).max(5000).optional(),
  categorySlug: z.enum(['news', 'reviews', 'guides', 'lists']).optional(),
  publish: z.boolean().optional(),
  sse: z.boolean().optional(), // Enable SSE streaming
}).refine((v) => Boolean(v.gameDocumentId || v.igdbId || v.gameQuery), {
  message: 'Provide one of: gameDocumentId, igdbId, or gameQuery',
});

type GenerateBody = z.infer<typeof bodySchema>;

/**
 * Format an SSE event for streaming.
 */
function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Generate a new draft Post for a game.
   * POST /api/article-generator/generate
   * Auth: Either x-ai-generation-secret header OR admin JWT token
   * Body: { gameDocumentId?: string, igdbId?: number, gameQuery?: string, instruction?: string, sse?: boolean }
   *
   * If `sse` is true (or `?sse=true` query param), streams Server-Sent Events for progress.
   * Otherwise returns JSON response.
   *
   * NOTE: Content is always generated in English first. Spanish locale is generated after publish.
   */
  async generate(ctx: any) {
    // Check for either admin JWT authentication OR valid secret header
    const authenticated = isAuthenticated(strapi, ctx);
    if (!authenticated) {
      return ctx.unauthorized('Unauthorized: Provide valid admin JWT token or AI generation secret');
    }

    if (!isAIConfigured()) {
      return ctx.badRequest('AI is not configured. Set OPENROUTER_API_KEY environment variable.');
    }

    // Check for SSE mode: path ends with -sse, query param (?sse=true), or body param (sse: true)
    const path = ctx.request?.path || ctx.path || '';
    const sseMode = 
      path.endsWith('/generate-sse') ||
      ctx.query?.sse === 'true' || 
      ctx.query?.sse === true || 
      ctx.request?.body?.sse === true ||
      ctx.request?.body?.sse === 'true';

    const parsed = bodySchema.safeParse(ctx.request?.body ?? {});
    if (!parsed.success) {
      return ctx.badRequest('Invalid request body', { issues: parsed.error.issues });
    }

    const body: GenerateBody = parsed.data;
    // IMPORTANT: We always create content in English first.
    // Spanish locale is generated automatically after EN publish (Post lifecycle).
    const locale = 'en' as const;

    // ===== SSE SETUP =====
    let res: ServerResponse | null = null;
    let isOpen = true;
    let heartbeatInterval: NodeJS.Timeout | null = null;

    if (sseMode) {
      // Get the raw Node.js response object to bypass Koa buffering
      res = ctx.res as ServerResponse;
      
      // Tell Koa not to handle the response - we're handling it directly
      ctx.respond = false;

      // Write SSE headers directly to the response
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
        'Access-Control-Allow-Origin': '*',
      });

      // Send initial comment to establish connection immediately
      res.write(':ok\n\n');

      // Track if response is still writable
      res.on('close', () => {
        isOpen = false;
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
      });

      // Set up heartbeat to keep connection alive and force buffer flushing
      heartbeatInterval = setInterval(() => {
        if (!isOpen) {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          return;
        }
        try {
          res?.write(':heartbeat\n\n');
        } catch {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          isOpen = false;
        }
      }, 15000); // Every 15 seconds
    }

    // Helper to send SSE events with immediate flush
    const sendEvent = (event: SSEEvent) => {
      if (!sseMode || !isOpen || !res) return;
      try {
        res.write(formatSSE(event));
        // Force flush if available (some Node.js setups)
        if (typeof (res as any).flush === 'function') {
          (res as any).flush();
        }
      } catch {
        // Response closed, ignore
        isOpen = false;
      }
    };

    // Helper to send error and close response (SSE mode)
    const sendError = (code: string, message: string) => {
      if (sseMode) {
        sendEvent({
          type: 'error',
          code,
          message,
          timestamp: new Date().toISOString(),
        });
        if (isOpen && res) {
          res.end();
          isOpen = false;
        }
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
      } else {
        // Non-SSE: use Koa ctx
        if (code === 'UNAUTHORIZED') {
          return ctx.unauthorized(message);
        }
        if (code === 'GAME_NOT_FOUND') {
          return ctx.notFound(message);
        }
        if (code === 'BAD_REQUEST' || code === 'IMPORT_FAILED' || code === 'CATEGORY_NOT_FOUND') {
          return ctx.badRequest(message);
        }
        return ctx.internalServerError(message);
      }
    };

    try {
      const gameService = strapi.documents('api::game.game') as unknown as StrapiDocumentService<GameDocument>;
      const categoryService = strapi.documents('api::category.category') as unknown as StrapiDocumentService<CategoryDocument>;
      const authorService = strapi.documents('api::author.author') as unknown as StrapiDocumentService<AuthorDocument>;
      const postService = strapi.documents('api::post.post') as unknown as StrapiDocumentService<PostDocument>;

      // Resolve or import the game if needed.
      let resolvedGameDocumentId = body.gameDocumentId;
      let game: GameDocument | null = null;

      if (resolvedGameDocumentId) {
        game = await gameService.findOne({
          documentId: resolvedGameDocumentId,
          locale,
          populate: ['genres', 'platforms', 'developers', 'publishers'],
        } as any);
      }

      if (!game) {
        try {
          // If we don't have a valid documentId, use IGDB-based resolution/import.
          let igdbId = body.igdbId;
          if (!igdbId && body.gameQuery) {
            const resolved = await resolveIGDBGameIdFromQuery(strapi, body.gameQuery, 10);
            igdbId = resolved.igdbId;
          }

          if (!igdbId) {
            return sendError('GAME_NOT_FOUND', 'Game not found and no igdbId/gameQuery provided to import it.');
          }

          const imported = await importOrGetGameByIgdbId(strapi, igdbId);
          resolvedGameDocumentId = imported.game.documentId;

          game = await gameService.findOne({
            documentId: resolvedGameDocumentId,
            locale,
            populate: ['genres', 'platforms', 'developers', 'publishers'],
          } as any);
        } catch (error) {
          if (error instanceof GameImportError) {
            return sendError('IMPORT_FAILED', `Failed to import game: ${error.message}`);
          }
          const msg = error instanceof Error ? error.message : String(error);
          return sendError('IMPORT_FAILED', `Failed to resolve/import game: ${msg}`);
        }
      }

      if (!game) {
        return sendError('GAME_NOT_FOUND', 'Failed to resolve or import game');
      }

      // Send start event (SSE mode only)
      if (sseMode) {
        sendEvent({
          type: 'start',
          game: { documentId: game.documentId, name: game.name, slug: game.slug },
          timestamp: new Date().toISOString(),
        });
      }

      // Choose the first seeded author (as you requested)
      // Use EN to select the canonical seeded author deterministically (documentId shared across locales).
      const authors = await authorService.findMany({
        locale: 'en',
        sort: ['id:asc'],
        limit: 1,
      } as any);

      if (!authors || authors.length === 0) {
        return sendError('NO_AUTHOR', 'No authors found. Seed at least one author.');
      }

      const author = authors[0];

      // Fetch available categories (English slugs), include optional systemPrompt to guide selection.
      // NOTE: Avoid `fields` projection here to ensure `documentId` is present for relation connects.
      const categories = await categoryService.findMany({
        locale: 'en',
      } as any);

      // Map Strapi game into generator context
      const genreNames = (game as any).genres?.map((g: { name: string }) => g.name) || [];
      const platformNames = (game as any).platforms?.map((p: { name: string }) => p.name) || [];
      const developerName = (game as any).developers?.[0]?.name || null;
      const publisherName = (game as any).publishers?.[0]?.name || null;

      // Fetch IGDB images for article image pool
      // The game's igdbId comes from the import process
      const gameIgdbId = (game as any).igdbId;
      let screenshotUrls: readonly string[] = [];
      let artworkUrls: readonly string[] = [];
      let igdbCoverUrl: string | null = null;
      if (gameIgdbId) {
        try {
          const igdbImages = await fetchIGDBImagesForGame(strapi, gameIgdbId);
          screenshotUrls = igdbImages.screenshotUrls;
          artworkUrls = igdbImages.artworkUrls;
          igdbCoverUrl = igdbImages.coverUrl;
        } catch (err) {
          // Non-fatal: log and continue without IGDB images
          const msg = err instanceof Error ? err.message : String(err);
          strapi.log.warn(`[ArticleGenerator] Failed to fetch IGDB images: ${msg}`);
        }
      }

      // Articles are always generated in English; translation is a separate process
      // Pass strapi to enable content cleaning and caching
      const draft = await generateGameArticleDraft(
        {
          gameName: game.name,
          gameSlug: game.slug,
          gameDocumentId: game.documentId,
          releaseDate: game.releaseDate,
          genres: genreNames,
          platforms: platformNames,
          developer: developerName,
          publisher: publisherName,
          igdbDescription: game.description,
          instruction: body.instruction,
          // If user explicitly selected a category, use it; otherwise let AI decide
          ...(body.categorySlug ? { categorySlug: body.categorySlug } : {}),
          categoryHints: (categories || []).map((c) => ({
            slug: c.slug as any,
            systemPrompt: (c as any).systemPrompt ?? null,
          })),
          // IGDB images for article image pool
          screenshotUrls,
          artworkUrls,
          coverImageUrl: (game as any).coverImageUrl ?? igdbCoverUrl,
        },
        { strapi },
        // Only provide progress callback in SSE mode
        sseMode ? {
          onProgress: (phase, progress, message) => {
            sendEvent({
              type: 'progress',
              phase,
              progress,
              message,
              timestamp: new Date().toISOString(),
            });
          },
        } : undefined
      );

      // Find the category doc by slug
      const categoryMatch = (categories || []).find((c) => c.slug === draft.categorySlug);
      if (!categoryMatch) {
        return sendError('CATEGORY_NOT_FOUND', `Category not found for slug: ${draft.categorySlug}`);
      }

      // Extract structured data for DB storage
      const costs = extractStoredCosts(draft);
      const plan = extractStoredPlan(draft);
      const sources = extractStoredSources(draft.sources);

      // ===== AUDIO GENERATION =====
      // Generate audio from article markdown content (BEFORE images to avoid reading URLs)
      const audioResult = await generateAndUploadArticleAudio({
        markdown: draft.markdownWithoutImages,
        articleTitle: draft.title,
        gameSlug: game.slug,
        articleSlug: slugify(draft.title),
        strapi,
      });

      const audioFileId = audioResult?.id;
      const chapterFileId = audioResult?.chapterFileId;

      // Create a draft post (Strapi draftAndPublish: true)
      // Note: Strapi's UID auto-generation doesn't trigger via Document Service API,
      // so we must generate the slug ourselves.
      const created = await postService.create({
        locale,
        status: 'draft',
        data: {
          title: draft.title,
          slug: slugify(draft.title),
          excerpt: draft.excerpt,
          description: draft.description,
          content: draft.markdown,
          aiAssisted: true,
          aiModel: JSON.stringify(draft.models),
          aiGeneratedAt: new Date().toISOString(),
          aiWorkflow: 'deep-dive-v1',
          plan,     // Article plan (sections, goals, research queries)
          costs,    // All cost/performance data by phase
          sources,  // Source URLs with domain analysis
          // Use Document Service relation syntax to avoid ambiguity between
          // numeric DB IDs vs document IDs (UUIDs).
          category: { connect: [categoryMatch.documentId] } as any,
          games: { connect: [game.documentId] } as any,
          author: { connect: [author.documentId] } as any,
          // Set featured image from hero image if available
          // Media relations use the numeric ID directly
          ...(draft.imageMetadata?.heroImage?.id && {
            featuredImage: draft.imageMetadata.heroImage.id,
          }),
          // Set audio file if audio generation succeeded
          ...(audioFileId && {
            audioFile: audioFileId,
          }),
          // Set chapter file if chapters were generated
          ...(chapterFileId && {
            chapterFile: chapterFileId,
          }),
        } as any,
      } as any);

      // Publish if requested
      let published = false;
      if (body.publish) {
        try {
          await postService.publish({ documentId: created.documentId, locale } as any);
          published = true;
        } catch (error) {
          // Post created but publish failed - still send complete event
          const msg = error instanceof Error ? error.message : String(error);
          if (sseMode) {
            strapi.log.error(`Publish failed: ${msg}`);
          } else {
            return ctx.internalServerError(`Post created but failed to publish: ${msg}`);
          }
        }
      }

      // ===== RESPONSE =====
      if (sseMode) {
        // Send complete event
        sendEvent({
          type: 'complete',
          post: { id: created.id, documentId: created.documentId },
          draft: {
            title: draft.title,
            categorySlug: draft.categorySlug,
            excerpt: draft.excerpt,
            description: draft.description,
            markdown: draft.markdown,
            sources: draft.sources,
          },
          metadata: {
            totalDurationMs: draft.metadata.totalDurationMs,
            totalCostUsd: draft.metadata.totalEstimatedCostUsd,
            sourcesCollected: draft.metadata.sourcesCollected,
            researchConfidence: draft.metadata.researchConfidence,
          },
          game: { documentId: game.documentId, name: game.name, slug: game.slug },
          published,
          timestamp: new Date().toISOString(),
        });

        // Clean up and close
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
        if (isOpen && res) {
          res.end();
          isOpen = false;
        }
      } else {
        // JSON response
        ctx.body = {
          success: true,
          post: created,
          // Full draft data for comprehensive validation and debugging
          draft: {
            title: draft.title,
            categorySlug: draft.categorySlug,
            excerpt: draft.excerpt,
            description: draft.description,
            tags: draft.tags,
            markdown: draft.markdown,
            sources: draft.sources,
            plan: draft.plan,
            metadata: draft.metadata,
          },
          models: draft.models,
          // Reviewer output (only present if reviewer ran)
          ...(draft.reviewerApproved !== undefined && {
            reviewerApproved: draft.reviewerApproved,
            reviewerIssues: draft.reviewerIssues ?? [],
            // Include initial issues if some were fixed (complete history)
            ...(draft.reviewerInitialIssues &&
              draft.reviewerInitialIssues.length > 0 && {
                reviewerInitialIssues: draft.reviewerInitialIssues,
              }),
          }),
          game: { documentId: game.documentId, name: game.name, slug: game.slug },
          author: { documentId: author.documentId, name: author.name },
          published,
        };
      }
    } catch (error) {
      // Clean up SSE resources
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as any)?.code ?? 'GENERATION_FAILED';
      
      if (sseMode) {
        sendError(code, message);
      } else {
        return ctx.internalServerError(message);
      }
    }
  },
});
