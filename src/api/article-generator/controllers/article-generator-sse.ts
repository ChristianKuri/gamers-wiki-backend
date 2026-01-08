import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import type { ServerResponse } from 'http';

import type { DocumentQueryOptions, GameDocument } from '../../../types/strapi';
import { isAIConfigured } from '../../../ai';
import { generateGameArticleDraft } from '../../../ai/articles/generate-game-article';
import type { ArticleGenerationPhase, GameArticleDraft } from '../../../ai/articles/types';
import { slugify } from '../../../utils/slug';
import { importOrGetGameByIgdbId, GameImportError } from '../../game-fetcher/services/import-game-programmatic';
import { resolveIGDBGameIdFromQuery } from '../../game-fetcher/services/game-resolver';
import { isAuthenticated } from '../utils/admin-auth';

/**
 * SSE Event Types for article generation progress streaming.
 */
type SSEEventType = 'progress' | 'complete' | 'error' | 'start';

interface SSEProgressEvent {
  type: 'progress';
  phase: ArticleGenerationPhase;
  progress: number;
  message?: string;
  timestamp: string;
}

interface SSEStartEvent {
  type: 'start';
  game: { documentId: string; name: string; slug: string };
  timestamp: string;
}

interface SSECompleteEvent {
  type: 'complete';
  post: { id: number; documentId: string };
  draft: {
    title: string;
    categorySlug: string;
    excerpt: string;
    description: string;
    markdown: string;
    sources: readonly string[];
  };
  metadata: {
    totalDurationMs: number;
    totalCostUsd?: number;
    sourcesCollected: number;
    researchConfidence: string;
  };
  game: { documentId: string; name: string; slug: string };
  published: boolean;
  timestamp: string;
}

interface SSEErrorEvent {
  type: 'error';
  code: string;
  message: string;
  timestamp: string;
}

type SSEEvent = SSEProgressEvent | SSEStartEvent | SSECompleteEvent | SSEErrorEvent;

/**
 * Cost breakdown by phase stored in the database.
 */
interface PhaseCost {
  model: string;
  durationMs: number;
  tokens?: { input: number; output: number };
  costUsd?: number;
}

/**
 * All cost and performance data stored in the database.
 */
interface StoredCosts {
  generationId: string;
  totalDurationMs: number;
  totalCostUsd?: number;
  phases: {
    scout: PhaseCost;
    editor: PhaseCost;
    specialist: PhaseCost;
    reviewer?: PhaseCost;
    fixer?: PhaseCost;
  };
  cleaner?: {
    tokens: { input: number; output: number };
    costUsd?: number;
  };
  search?: {
    tavily?: { queries: number; estimatedCostUsd: number };
    exa?: { queries: number; costUsd: number };
  };
  research: {
    queriesExecuted: number;
    sourcesCollected: number;
    confidence: string;
  };
  quality: {
    fixerIterations: number;
    issuesFixed: number;
    finalApproved: boolean;
    remainingIssues: number;
  };
  generatedAt: string;
}

interface StoredPlan {
  title: string;
  gameName: string;
  categorySlug: string;
  sections: Array<{
    headline: string;
    goal: string;
    researchQueries: string[];
    mustCover: string[];
  }>;
  requiredElements: string[];
}

interface StoredSources {
  count: number;
  uniqueDomains: number;
  topDomains: string[];
  domainBreakdown: Record<string, number>;
  urls: string[];
}

function extractStoredCosts(draft: GameArticleDraft): StoredCosts {
  const meta = draft.metadata;
  const tokenUsage = meta.tokenUsage;
  const searchCosts = meta.searchApiCosts;

  const phases: StoredCosts['phases'] = {
    scout: {
      model: draft.models.scout,
      durationMs: meta.phaseDurations.scout,
      tokens: tokenUsage?.scout ? { input: tokenUsage.scout.total.input, output: tokenUsage.scout.total.output } : undefined,
      costUsd: tokenUsage?.scout?.total.actualCostUsd,
    },
    editor: {
      model: draft.models.editor,
      durationMs: meta.phaseDurations.editor,
      tokens: tokenUsage?.editor ? { input: tokenUsage.editor.input, output: tokenUsage.editor.output } : undefined,
      costUsd: tokenUsage?.editor?.actualCostUsd,
    },
    specialist: {
      model: draft.models.specialist,
      durationMs: meta.phaseDurations.specialist,
      tokens: tokenUsage?.specialist ? { input: tokenUsage.specialist.input, output: tokenUsage.specialist.output } : undefined,
      costUsd: tokenUsage?.specialist?.actualCostUsd,
    },
  };

  if (draft.models.reviewer && meta.phaseDurations.reviewer > 0) {
    phases.reviewer = {
      model: draft.models.reviewer,
      durationMs: meta.phaseDurations.reviewer,
      tokens: tokenUsage?.reviewer ? { input: tokenUsage.reviewer.input, output: tokenUsage.reviewer.output } : undefined,
      costUsd: tokenUsage?.reviewer?.actualCostUsd,
    };
  }

  if (meta.phaseDurations.fixer && meta.phaseDurations.fixer > 0) {
    phases.fixer = {
      model: draft.models.reviewer ?? draft.models.specialist,
      durationMs: meta.phaseDurations.fixer,
    };
  }

  const cleaner = tokenUsage?.cleaner ? {
    tokens: { input: tokenUsage.cleaner.total.input, output: tokenUsage.cleaner.total.output },
    costUsd: tokenUsage.cleaner.total.actualCostUsd,
  } : undefined;

  const search = searchCosts ? {
    ...(searchCosts.tavilySearchCount > 0 && { 
      tavily: { 
        queries: searchCosts.tavilySearchCount, 
        estimatedCostUsd: searchCosts.tavilyCostUsd 
      } 
    }),
    ...(searchCosts.exaSearchCount > 0 && { 
      exa: { 
        queries: searchCosts.exaSearchCount, 
        costUsd: searchCosts.exaCostUsd 
      } 
    }),
  } : undefined;

  return {
    generationId: meta.correlationId,
    totalDurationMs: meta.totalDurationMs,
    totalCostUsd: meta.totalEstimatedCostUsd,
    phases,
    cleaner,
    search,
    research: {
      queriesExecuted: meta.queriesExecuted,
      sourcesCollected: meta.sourcesCollected,
      confidence: meta.researchConfidence,
    },
    quality: {
      fixerIterations: meta.recovery?.fixerIterations ?? 0,
      issuesFixed: meta.recovery?.fixesApplied?.filter(f => f.success).length ?? 0,
      finalApproved: draft.reviewerApproved ?? true,
      remainingIssues: draft.reviewerIssues?.length ?? 0,
    },
    generatedAt: meta.generatedAt,
  };
}

function extractStoredPlan(draft: GameArticleDraft): StoredPlan {
  return {
    // NOTE: title is now from Metadata Agent output (draft.title), not plan
    title: draft.title,
    gameName: draft.plan.gameName,
    categorySlug: draft.plan.categorySlug,
    sections: draft.plan.sections.map(s => ({
      headline: s.headline,
      goal: s.goal,
      researchQueries: [...s.researchQueries],
      mustCover: [...s.mustCover],
    })),
    requiredElements: [...(draft.plan.requiredElements ?? [])],
  };
}

function extractStoredSources(sources: readonly string[]): StoredSources {
  const domainBreakdown: Record<string, number> = {};
  
  for (const source of sources) {
    try {
      const url = new URL(source);
      const domain = url.hostname.replace(/^www\./, '');
      domainBreakdown[domain] = (domainBreakdown[domain] || 0) + 1;
    } catch {
      // Invalid URL, skip
    }
  }
  
  const sortedDomains = Object.entries(domainBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([domain]) => domain);
  
  return {
    count: sources.length,
    uniqueDomains: sortedDomains.length,
    topDomains: sortedDomains.slice(0, 10),
    domainBreakdown,
    urls: [...sources],
  };
}

interface CategoryDocument {
  id: number;
  documentId: string;
  name: string;
  slug: string;
  systemPrompt?: string | null;
  locale: string;
}

interface AuthorDocument {
  id: number;
  documentId: string;
  name: string;
  slug: string;
  locale: string;
}

interface PostDocument {
  id: number;
  documentId: string;
}

type StrapiDocumentService<T> = {
  findMany(options?: DocumentQueryOptions): Promise<T[]>;
  findOne(options: { documentId: string } & DocumentQueryOptions): Promise<T | null>;
  create(options: { data: Partial<T>; locale?: string; status?: 'draft' | 'published' }): Promise<T>;
  update(options: { documentId: string; data: Partial<T>; locale?: string }): Promise<T>;
  publish(options: { documentId: string; locale?: string }): Promise<T>;
};

const bodySchema = z.object({
  gameDocumentId: z.string().min(1).optional(),
  igdbId: z.number().int().positive().optional(),
  gameQuery: z.string().min(2).max(200).optional(),
  instruction: z.string().min(1).max(5000).optional(),
  categorySlug: z.enum(['news', 'reviews', 'guides', 'lists']).optional(),
  publish: z.boolean().optional(),
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
   * Generate a new draft Post for a game with SSE progress streaming.
   * POST /api/article-generator/generate-sse
   * Auth: Either x-ai-generation-secret header OR admin JWT token
   * Body: { gameDocumentId?: string, igdbId?: number, gameQuery?: string, instruction?: string }
   *
   * Streams SSE events:
   * - start: Generation started with game info
   * - progress: { phase, progress, message }
   * - complete: { post, draft, metadata }
   * - error: { code, message }
   */
  async generateSSE(ctx: any) {
    // Check for either admin JWT authentication OR valid secret header
    const authenticated = isAuthenticated(strapi, ctx);
    if (!authenticated) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized: Provide valid admin JWT token or AI generation secret' };
      return;
    }

    if (!isAIConfigured()) {
      ctx.status = 400;
      ctx.body = { error: 'AI is not configured. Set OPENROUTER_API_KEY environment variable.' };
      return;
    }

    const parsed = bodySchema.safeParse(ctx.request?.body ?? {});
    if (!parsed.success) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid request body', issues: parsed.error.issues };
      return;
    }

    const body: GenerateBody = parsed.data;
    const locale = 'en' as const;

    // Get the raw Node.js response object to bypass Koa buffering
    const res: ServerResponse = ctx.res;
    
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
    let isOpen = true;
    res.on('close', () => {
      isOpen = false;
    });

    // Helper to send SSE events with immediate flush
    const sendEvent = (event: SSEEvent) => {
      if (!isOpen) return;
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

    // Helper to send error and close response
    const sendError = (code: string, message: string) => {
      sendEvent({
        type: 'error',
        code,
        message,
        timestamp: new Date().toISOString(),
      });
      if (isOpen) {
        res.end();
        isOpen = false;
      }
    };

    // Set up heartbeat to keep connection alive and force buffer flushing
    const heartbeatInterval = setInterval(() => {
      if (!isOpen) {
        clearInterval(heartbeatInterval);
        return;
      }
      try {
        res.write(':heartbeat\n\n');
      } catch {
        clearInterval(heartbeatInterval);
        isOpen = false;
      }
    }, 15000); // Every 15 seconds

    try {
      const gameService = strapi.documents('api::game.game') as unknown as StrapiDocumentService<GameDocument>;
      const categoryService = strapi.documents('api::category.category') as unknown as StrapiDocumentService<CategoryDocument>;
      const authorService = strapi.documents('api::author.author') as unknown as StrapiDocumentService<AuthorDocument>;
      const postService = strapi.documents('api::post.post') as unknown as StrapiDocumentService<PostDocument>;

      // Resolve or import the game
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

      // Send start event
      sendEvent({
        type: 'start',
        game: { documentId: game.documentId, name: game.name, slug: game.slug },
        timestamp: new Date().toISOString(),
      });

      // Get author
      const authors = await authorService.findMany({
        locale: 'en',
        sort: ['id:asc'],
        limit: 1,
      } as any);

      if (!authors || authors.length === 0) {
        return sendError('NO_AUTHOR', 'No authors found. Seed at least one author.');
      }

      const author = authors[0];

      // Get categories
      const categories = await categoryService.findMany({
        locale: 'en',
      } as any);

      // Build generator context
      const genreNames = (game as any).genres?.map((g: { name: string }) => g.name) || [];
      const platformNames = (game as any).platforms?.map((p: { name: string }) => p.name) || [];
      const developerName = (game as any).developers?.[0]?.name || null;
      const publisherName = (game as any).publishers?.[0]?.name || null;

      // Generate article with progress callback
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
        },
        { strapi },
        {
          onProgress: (phase, progress, message) => {
            sendEvent({
              type: 'progress',
              phase,
              progress,
              message,
              timestamp: new Date().toISOString(),
            });
          },
        }
      );

      // Find category
      const categoryMatch = (categories || []).find((c) => c.slug === draft.categorySlug);
      if (!categoryMatch) {
        return sendError('CATEGORY_NOT_FOUND', `Category not found for slug: ${draft.categorySlug}`);
      }

      // Extract data for storage
      const costs = extractStoredCosts(draft);
      const plan = extractStoredPlan(draft);
      const sources = extractStoredSources(draft.sources);

      // Create post
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
          plan,
          costs,
          sources,
          category: { connect: [categoryMatch.documentId] } as any,
          games: { connect: [game.documentId] } as any,
          author: { connect: [author.documentId] } as any,
          // Set featured image from hero image if available
          // Media relations use the numeric ID directly
          ...(draft.imageMetadata?.heroImage?.id && {
            featuredImage: draft.imageMetadata.heroImage.id,
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
          console.error('Publish failed:', error);
        }
      }

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
      clearInterval(heartbeatInterval);
      if (isOpen) {
        res.end();
        isOpen = false;
      }
    } catch (error) {
      clearInterval(heartbeatInterval);
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as any)?.code ?? 'GENERATION_FAILED';
      sendError(code, message);
    }
  },
});
