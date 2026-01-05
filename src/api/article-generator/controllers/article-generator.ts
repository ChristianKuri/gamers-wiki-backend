import type { Core } from '@strapi/strapi';
import { z } from 'zod';

import type { DocumentQueryOptions, GameDocument } from '../../../types/strapi';
import { isAIConfigured } from '../../../ai';
import { generateGameArticleDraft } from '../../../ai/articles/generate-game-article';
import type { GameArticleDraft } from '../../../ai/articles/types';
import { slugify } from '../../../utils/slug';
import { importOrGetGameByIgdbId, GameImportError } from '../../game-fetcher/services/import-game-programmatic';
import { resolveIGDBGameIdFromQuery } from '../../game-fetcher/services/game-resolver';
import { isAuthenticated } from '../utils/admin-auth';

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
  /** Correlation ID for log tracing */
  generationId: string;
  /** Total generation duration in ms */
  totalDurationMs: number;
  /** Total estimated cost (LLM + Search + Cleaner) */
  totalCostUsd?: number;
  /** Cost and performance breakdown by phase */
  phases: {
    scout: PhaseCost;
    editor: PhaseCost;
    specialist: PhaseCost;
    reviewer?: PhaseCost;
    fixer?: PhaseCost;
  };
  /** Cleaner costs (content extraction/summarization) */
  cleaner?: {
    tokens: { input: number; output: number };
    costUsd?: number;
  };
  /** Search API costs */
  search?: {
    tavily?: { queries: number; estimatedCostUsd: number };
    exa?: { queries: number; costUsd: number };
  };
  /** Research statistics */
  research: {
    queriesExecuted: number;
    sourcesCollected: number;
    confidence: string;
  };
  /** Quality metrics from review/fix cycle */
  quality: {
    fixerIterations: number;
    issuesFixed: number;
    finalApproved: boolean;
    remainingIssues: number;
  };
  /** ISO timestamp when generation completed */
  generatedAt: string;
}

/**
 * Article plan stored in the database.
 */
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

/**
 * Extract costs data from a draft for database storage.
 */
function extractStoredCosts(draft: GameArticleDraft): StoredCosts {
  const meta = draft.metadata;
  const tokenUsage = meta.tokenUsage;
  const searchCosts = meta.searchApiCosts;

  // Build phase costs
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

  // Add reviewer if it ran
  if (draft.models.reviewer && meta.phaseDurations.reviewer > 0) {
    phases.reviewer = {
      model: draft.models.reviewer,
      durationMs: meta.phaseDurations.reviewer,
      tokens: tokenUsage?.reviewer ? { input: tokenUsage.reviewer.input, output: tokenUsage.reviewer.output } : undefined,
      costUsd: tokenUsage?.reviewer?.actualCostUsd,
    };
  }

  // Add fixer if it ran (uses reviewer model, tokens included in reviewer totals)
  if (meta.phaseDurations.fixer && meta.phaseDurations.fixer > 0) {
    phases.fixer = {
      model: draft.models.reviewer ?? draft.models.specialist,
      durationMs: meta.phaseDurations.fixer,
    };
  }

  // Build cleaner costs
  const cleaner = tokenUsage?.cleaner ? {
    tokens: { input: tokenUsage.cleaner.total.input, output: tokenUsage.cleaner.total.output },
    costUsd: tokenUsage.cleaner.total.actualCostUsd,
  } : undefined;

  // Build search costs
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

/**
 * Extract plan from a draft for database storage.
 */
function extractStoredPlan(draft: GameArticleDraft): StoredPlan {
  return {
    title: draft.plan.title,
    gameName: draft.plan.gameName,
    categorySlug: draft.plan.categorySlug,
    sections: draft.plan.sections.map(s => ({
      headline: s.headline,
      goal: s.goal,
      researchQueries: [...s.researchQueries],
      mustCover: [...s.mustCover],
    })),
    requiredElements: [...draft.plan.requiredElements],
  };
}

/**
 * Sources data stored in the database with domain analysis.
 */
interface StoredSources {
  count: number;
  uniqueDomains: number;
  topDomains: string[];
  domainBreakdown: Record<string, number>;
  urls: string[];
}

/**
 * Extract sources with domain analysis from a draft for database storage.
 */
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

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Generate a new draft Post for a game.
   * POST /api/article-generator/generate
   * Auth: Either x-ai-generation-secret header OR admin JWT token
   * Body: { gameDocumentId?: string, igdbId?: number, gameQuery?: string, instruction?: string }
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
        categoryHints: (categories || []).map((c) => ({
          slug: c.slug as any,
          systemPrompt: (c as any).systemPrompt ?? null,
        })),
      },
      { strapi }
    );

    // Find the category doc by slug
    const categoryMatch = (categories || []).find((c) => c.slug === draft.categorySlug);
    if (!categoryMatch) {
      return ctx.internalServerError(`Category not found for slug: ${draft.categorySlug}`);
    }

    // Extract structured data for DB storage
    const costs = extractStoredCosts(draft);
    const plan = extractStoredPlan(draft);
    const sources = extractStoredSources(draft.sources);

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
      published: Boolean(body.publish),
    };
  },
});
