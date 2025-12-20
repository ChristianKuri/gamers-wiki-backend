import type { Core } from '@strapi/strapi';

import { isAIConfigured } from '../../../../ai';
import { translatePostEnToEs } from '../../services/post-translation';

interface PostLifecycleEvent {
  result: {
    id: number;
    documentId: string;
    locale: string;
    title?: string;
    [key: string]: unknown;
  };
  params: {
    data: Record<string, unknown>;
    locale?: string;
    [key: string]: unknown;
  };
}

function getLocale(paramsLocale: unknown, resultLocale: unknown): string | undefined {
  return typeof paramsLocale === 'string'
    ? paramsLocale
    : typeof resultLocale === 'string'
      ? resultLocale
      : undefined;
}

function getDocumentId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (!('documentId' in value)) return undefined;
  const docId = (value as { documentId?: unknown }).documentId;
  return typeof docId === 'string' ? docId : undefined;
}

function getDocumentIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const docId = getDocumentId(item);
    if (docId) out.push(docId);
  }
  return out;
}

type DocumentService<T> = {
  findOne(options: { documentId: string; locale?: string; populate?: string[] }): Promise<T | null>;
  update(options: { documentId: string; locale?: string; data: Record<string, unknown> }): Promise<T>;
  publish(options: { documentId: string; locale?: string }): Promise<T>;
};

interface PostDocument {
  documentId: string;
  title?: string;
  excerpt?: string | null;
  description?: string | null;
  content?: string | null;
  category?: unknown;
  author?: unknown;
  games?: unknown;
  tags?: unknown;
}

interface GameDocument {
  documentId: string;
}

export default {
  /**
   * After an English post is published, auto-generate its Spanish locale version.
   *
   * This matches the project rule: create content in EN first, then generate ES after publish.
   */
  async afterUpdate(event: PostLifecycleEvent) {
    const { result, params } = event;
    const strapi = (global as unknown as { strapi: Core.Strapi }).strapi;

    const locale = getLocale(params.locale, result.locale);
    if (locale !== 'en') return;

    if (!isAIConfigured()) {
      strapi.log.debug('[Post:LocaleSync] AI not configured, skipping ES generation');
      return;
    }

    // Only proceed if the EN post is published.
    const publishedRow = await strapi.db.connection('posts')
      .select('id')
      .where({ document_id: result.documentId, locale: 'en' })
      .whereNotNull('published_at')
      .first();

    if (!publishedRow) return;

    const postService = strapi.documents('api::post.post') as unknown as DocumentService<PostDocument>;
    const gameService = strapi.documents('api::game.game') as unknown as DocumentService<GameDocument>;

    // If ES already exists, do nothing.
    const existingEs = await postService.findOne({ documentId: result.documentId, locale: 'es' });
    if (existingEs) return;

    // Load EN post with relations so we can copy connections.
    const enPost = await postService.findOne({
      documentId: result.documentId,
      locale: 'en',
      populate: ['category', 'author', 'games', 'tags'],
    });

    if (!enPost) {
      strapi.log.warn(`[Post:LocaleSync] EN post missing for documentId=${result.documentId}`);
      return;
    }

    const categoryDocId = getDocumentId(enPost.category);
    const authorDocId = getDocumentId(enPost.author);
    const gameDocIds = getDocumentIdArray(enPost.games);
    const tagDocIds = getDocumentIdArray(enPost.tags);

    if (!categoryDocId || !authorDocId || gameDocIds.length === 0) {
      strapi.log.warn(`[Post:LocaleSync] Missing required relations for EN post documentId=${result.documentId}`);
      return;
    }

    // Ensure ES locales exist for games before we try to connect from an ES post.
    // If not, skip for now (games should normally have ES via import).
    for (const docId of gameDocIds) {
      const hasEs = await gameService.findOne({ documentId: docId, locale: 'es' });
      if (!hasEs) {
        strapi.log.warn(`[Post:LocaleSync] Game missing ES locale (documentId=${docId}); skipping post ES generation.`);
        return;
      }
    }

    // Translate EN -> ES (EN is the source of truth)
    const esDraft = await translatePostEnToEs({
      title: String(enPost.title || ''),
      excerpt: enPost.excerpt ?? null,
      description: enPost.description ?? null,
      content: String(enPost.content || ''),
    });

    // Create ES locale entry + connect relations
    await postService.update({
      documentId: result.documentId,
      locale: 'es',
      data: {
        title: esDraft.title,
        slug: esDraft.slug,
        excerpt: esDraft.excerpt,
        ...(esDraft.description ? { description: esDraft.description } : {}),
        content: esDraft.content,
        category: { connect: [categoryDocId] },
        author: { connect: [authorDocId] },
        games: { connect: gameDocIds },
        ...(tagDocIds.length > 0 ? { tags: { connect: tagDocIds } } : {}),
      },
    });

    // Publish ES to keep draft/published in sync
    await postService.publish({ documentId: result.documentId, locale: 'es' });

    strapi.log.info(`[Post:LocaleSync] Generated ES locale for post documentId=${result.documentId}`);
  },
};

