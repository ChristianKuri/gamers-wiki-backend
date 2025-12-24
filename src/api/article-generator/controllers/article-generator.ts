import type { Core } from '@strapi/strapi';
import { z } from 'zod';

import type { DocumentQueryOptions, GameDocument } from '../../../types/strapi';
import { isAIConfigured } from '../../../ai';
import { generateGameArticleDraft } from '../../../ai/articles/generate-game-article';
import { importOrGetGameByIgdbId, GameImportError } from '../../game-fetcher/services/import-game-programmatic';
import { resolveIGDBGameIdFromQuery } from '../../game-fetcher/services/game-resolver';

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

// Type for Strapi document service - using generics for better type safety
// Note: Strapi 5's document service has limited TypeScript support, so some type assertions are needed
// Keep this in sync with patterns used in game-fetcher.
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
  publish: z.boolean().optional(),
}).refine((v) => Boolean(v.gameDocumentId || v.igdbId || v.gameQuery), {
  message: 'Provide one of: gameDocumentId, igdbId, or gameQuery',
});

type GenerateBody = z.infer<typeof bodySchema>;

function getSecretFromHeader(ctx: any): string | undefined {
  // Koa lowercases all header keys
  const value = ctx.request?.headers?.['x-ai-generation-secret'];
  return typeof value === 'string' ? value : undefined;
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Generate a new draft Post for a game.
   * POST /api/article-generator/generate
   * Header: x-ai-generation-secret: <AI_GENERATION_SECRET>
   * Body: { gameDocumentId?: string, igdbId?: number, gameQuery?: string, instruction?: string }
   *
   * NOTE: Content is always generated in English first. Spanish locale is generated after publish.
   */
  async generate(ctx: any) {
    const secret = process.env.AI_GENERATION_SECRET;
    if (!secret) {
      return ctx.internalServerError('AI_GENERATION_SECRET is not configured');
    }

    const provided = getSecretFromHeader(ctx);
    if (!provided || provided !== secret) {
      return ctx.unauthorized('Invalid AI generation secret');
    }

    if (!isAIConfigured()) {
      return ctx.badRequest('AI is not configured. Set OPENROUTER_API_KEY environment variable.');
    }

    const parsed = bodySchema.safeParse(ctx.request?.body ?? {});
    if (!parsed.success) {
      return ctx.badRequest('Invalid request body', { issues: parsed.error.issues });
    }

    const body: GenerateBody = parsed.data;
    // IMPORTANT: We always create content in English first.
    // Spanish locale is generated automatically after EN publish (Post lifecycle).
    const locale = 'en' as const;

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
          return ctx.badRequest('Game not found and no igdbId/gameQuery provided to import it.');
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
          // Mirror the original endpoint behavior as a client error (import requires correct env/config).
          return ctx.badRequest(`Failed to import game: ${error.message}`);
        }
        const msg = error instanceof Error ? error.message : String(error);
        return ctx.badRequest(`Failed to resolve/import game: ${msg}`);
      }
    }

    if (!game) {
      return ctx.internalServerError('Failed to resolve or import game');
    }

    // Choose the first seeded author (as you requested)
    // Use EN to select the canonical seeded author deterministically (documentId shared across locales).
    const authors = await authorService.findMany({
      locale: 'en',
      sort: ['id:asc'],
      limit: 1,
    } as any);

    if (!authors || authors.length === 0) {
      return ctx.internalServerError('No authors found. Seed at least one author.');
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

    // Articles are always generated in English; translation is a separate process
    const draft = await generateGameArticleDraft({
      gameName: game.name,
      gameSlug: game.slug,
      releaseDate: game.releaseDate,
      genres: genreNames,
      platforms: platformNames,
      developer: developerName,
      publisher: publisherName,
      igdbDescription: game.description,
      instruction: body.instruction,
      categoryHints: (categories || []).map((c) => ({
        slug: c.slug as any,
        systemPrompt: (c as any).systemPrompt ?? null,
      })),
    });

    // Find the category doc by slug
    const categoryMatch = (categories || []).find((c) => c.slug === draft.categorySlug);
    if (!categoryMatch) {
      return ctx.internalServerError(`Category not found for slug: ${draft.categorySlug}`);
    }

    // Create a draft post (Strapi draftAndPublish: true)
    const created = await postService.create({
      locale,
      status: 'draft',
      data: {
        title: draft.title,
        excerpt: draft.excerpt,
        content: draft.markdown,
        aiAssisted: true,
        aiModel: JSON.stringify(draft.models),
        aiGeneratedAt: new Date().toISOString(),
        aiWorkflow: 'deep-dive-v1',
        // Use Document Service relation syntax to avoid ambiguity between
        // numeric DB IDs vs document IDs (UUIDs).
        category: { connect: [categoryMatch.documentId] } as any,
        games: { connect: [game.documentId] } as any,
        author: { connect: [author.documentId] } as any,
      } as any,
    } as any);

    if (body.publish) {
      try {
        await postService.publish({ documentId: created.documentId, locale } as any);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return ctx.internalServerError(`Post created but failed to publish: ${msg}`);
      }
    }

    ctx.body = {
      success: true,
      post: created,
      title: draft.title,
      categorySlug: draft.categorySlug,
      author: { documentId: author.documentId, name: author.name },
      models: draft.models,
      sources: draft.sources,
      published: Boolean(body.publish),
    };
  },
});
