/**
 * Source Cache Service
 *
 * Manages caching of cleaned web content in Strapi.
 * Provides cache lookup, storage, and domain quality aggregation.
 */

import type { Core } from '@strapi/strapi';

import type {
  DomainQualityDocument,
  SourceContentDocument,
} from '../../types/strapi';
import { normalizeUrl } from './research-pool';
import type {
  CacheCheckResult,
  CleanedSource,
  DomainTier,
  RawSourceInput,
  SearchSource,
  StoredDomainQuality,
  StoredSourceContent,
} from './types';
import { CLEANER_CONFIG } from './config';

// ============================================================================
// Types
// ============================================================================

/**
 * Raw database row for source_contents table.
 * Maps snake_case column names from PostgreSQL.
 */
interface SourceContentRow {
  id: number;
  document_id: string;
  url: string;
  domain: string;
  title: string;
  summary: string | null;
  cleaned_content: string;
  original_content_length: number;
  quality_score: number;
  quality_notes: string | null;
  content_type: string;
  junk_ratio: string; // decimal comes as string from Knex
  access_count: number;
  last_accessed_at: string | null;
  search_source: 'tavily' | 'exa';
  published_at: string | null;
}

/**
 * Raw database row for domain_qualities table.
 */
interface DomainQualityRow {
  id: number;
  document_id: string;
  domain: string;
  avg_quality_score: string; // decimal comes as string from Knex
  total_sources: number;
  tier: DomainTier;
  is_excluded: boolean;
  exclude_reason: string | null;
  domain_type: string;
  published_at: string | null;
}

// ============================================================================
// URL Utilities
// ============================================================================

/**
 * Extracts the domain from a URL.
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ============================================================================
// Document Service Helpers
// ============================================================================

/**
 * Local type for Strapi document service.
 * Strapi 5's document service has limited TypeScript support, so we define our own.
 * This matches what Strapi actually provides at runtime.
 */
type StrapiDocumentService<T> = {
  findMany(options?: { filters?: Record<string, unknown>; locale?: string }): Promise<T[]>;
  findOne(options: { documentId: string; locale?: string }): Promise<T | null>;
  create(options: { data: Partial<T>; locale?: string }): Promise<T>;
  update(options: { documentId: string; data: Partial<T>; locale?: string }): Promise<T>;
  delete(options: { documentId: string; locale?: string }): Promise<T>;
  publish(options: { documentId: string; locale?: string }): Promise<T>;
};

/**
 * Get source content document service with proper typing.
 * Strapi 5's document service has limited TypeScript support.
 */
function getSourceContentService(strapi: Core.Strapi): StrapiDocumentService<SourceContentDocument> {
  // Note: Strapi 5 types don't recognize custom content types, so we cast through unknown
  return strapi.documents('api::source-content.source-content' as Parameters<typeof strapi.documents>[0]) as unknown as StrapiDocumentService<SourceContentDocument>;
}

/**
 * Get domain quality document service with proper typing.
 */
function getDomainQualityService(strapi: Core.Strapi): StrapiDocumentService<DomainQualityDocument> {
  return strapi.documents('api::domain-quality.domain-quality' as Parameters<typeof strapi.documents>[0]) as unknown as StrapiDocumentService<DomainQualityDocument>;
}

// ============================================================================
// Cache Operations
// ============================================================================

/**
 * Check cache for multiple URLs in parallel.
 * Returns cache hits and misses with their data.
 *
 * @param strapi - Strapi instance
 * @param rawSources - Raw sources to check
 * @returns Array of cache check results
 */
export async function checkSourceCache(
  strapi: Core.Strapi,
  rawSources: readonly RawSourceInput[]
): Promise<CacheCheckResult[]> {
  if (rawSources.length === 0) {
    return [];
  }

  // Normalize URLs for lookup
  const normalizedUrls = rawSources.map((s) => ({
    original: s,
    normalized: normalizeUrl(s.url),
  }));

  // Filter out invalid URLs
  const validUrls = normalizedUrls.filter((u) => u.normalized !== null);

  if (validUrls.length === 0) {
    return rawSources.map((raw) => ({
      url: raw.url,
      hit: false,
      raw,
    }));
  }

  // Query database for all URLs at once
  // Using raw Knex query for efficiency (document service doesn't support $in)
  const knex = strapi.db.connection;
  const cachedRows = await knex<SourceContentRow>('source_contents')
    .whereIn(
      'url',
      validUrls.map((u) => u.normalized)
    )
    .andWhereNot('published_at', null)
    .select('*');

  // Build lookup map
  const cachedMap = new Map<string, StoredSourceContent>();
  for (const row of cachedRows) {
    cachedMap.set(row.url, {
      id: row.id,
      documentId: row.document_id,
      url: row.url,
      domain: row.domain,
      title: row.title,
      summary: row.summary,
      cleanedContent: row.cleaned_content,
      originalContentLength: row.original_content_length,
      qualityScore: row.quality_score,
      qualityNotes: row.quality_notes,
      contentType: row.content_type,
      junkRatio: parseFloat(row.junk_ratio),
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
      searchSource: row.search_source,
    });
  }

  // Update access count for cache hits (fire-and-forget)
  const hitUrls = validUrls
    .filter((u) => u.normalized && cachedMap.has(u.normalized))
    .map((u) => u.normalized);

  if (hitUrls.length > 0) {
    // Fire-and-forget access count update
    knex('source_contents')
      .whereIn('url', hitUrls)
      .update({
        access_count: knex.raw('access_count + 1'),
        last_accessed_at: new Date().toISOString(),
      })
      .catch((err: Error) => {
        strapi.log.warn(`[SourceCache] Failed to update access count: ${err.message}`);
      });
  }

  // Build results
  return rawSources.map((raw) => {
    const normalized = normalizeUrl(raw.url);
    if (!normalized) {
      return { url: raw.url, hit: false, raw };
    }

    const cached = cachedMap.get(normalized);
    if (cached) {
      return {
        url: raw.url,
        hit: true,
        cached: {
          url: cached.url,
          domain: cached.domain,
          title: cached.title,
          summary: cached.summary ?? '',
          cleanedContent: cached.cleanedContent,
          originalContentLength: cached.originalContentLength,
          qualityScore: cached.qualityScore,
          qualityNotes: cached.qualityNotes ?? '',
          contentType: cached.contentType,
          junkRatio: cached.junkRatio,
          searchSource: cached.searchSource,
        },
      };
    }

    return { url: raw.url, hit: false, raw };
  });
}

/**
 * Store cleaned sources in the database.
 * Also updates domain quality aggregates.
 *
 * @param strapi - Strapi instance
 * @param cleanedSources - Cleaned sources to store
 * @param gameDocumentId - Optional game to link sources to
 */
export async function storeCleanedSources(
  strapi: Core.Strapi,
  cleanedSources: readonly CleanedSource[],
  gameDocumentId?: string | null
): Promise<void> {
  if (cleanedSources.length === 0) {
    return;
  }

  const sourceContentService = getSourceContentService(strapi);
  const knex = strapi.db.connection;
  const now = new Date().toISOString();

  // Track domains for quality updates
  const domainsToUpdate = new Set<string>();

  for (const source of cleanedSources) {
    // Skip low-quality content
    if (source.qualityScore < CLEANER_CONFIG.MIN_QUALITY_FOR_CACHE) {
      strapi.log.debug(
        `[SourceCache] Skipping low-quality source (${source.qualityScore}): ${source.url}`
      );
      continue;
    }

    try {
      // Normalize URL for storage
      const normalizedUrl = normalizeUrl(source.url);
      if (!normalizedUrl) {
        continue;
      }

      // Check if already exists (race condition protection)
      const existing = await knex<SourceContentRow>('source_contents')
        .where('url', normalizedUrl)
        .first();

      if (existing) {
        strapi.log.debug(`[SourceCache] Source already exists: ${normalizedUrl}`);
        continue;
      }

      // Create new source content entry
      const createData: Partial<SourceContentDocument> = {
        url: normalizedUrl,
        domain: source.domain,
        title: source.title,
        summary: source.summary ?? null,
        cleanedContent: source.cleanedContent,
        originalContentLength: source.originalContentLength,
        qualityScore: source.qualityScore,
        qualityNotes: source.qualityNotes,
        contentType: source.contentType,
        junkRatio: source.junkRatio,
        accessCount: 1,
        lastAccessedAt: now,
        searchSource: source.searchSource,
      };

      // Use raw insert for games relation if provided
      // Document service relation handling needs the relation syntax
      if (gameDocumentId) {
        const created = await sourceContentService.create({
          data: {
            ...createData,
            // Note: relations need to be handled separately via update
          } as Partial<SourceContentDocument>,
        });

        // Link to game via separate update
        await sourceContentService.update({
          documentId: created.documentId,
          data: {} as Partial<SourceContentDocument>,
          // Games relation would be: games: { connect: [gameDocumentId] }
          // But this requires raw query or Strapi's relation API
        });
      } else {
        await sourceContentService.create({
          data: createData as Partial<SourceContentDocument>,
        });
      }

      strapi.log.debug(
        `[SourceCache] Stored source (score: ${source.qualityScore}): ${normalizedUrl}`
      );

      domainsToUpdate.add(source.domain);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      strapi.log.warn(`[SourceCache] Failed to store source ${source.url}: ${message}`);
    }
  }

  // Update domain quality aggregates
  for (const domain of domainsToUpdate) {
    await updateDomainQuality(strapi, domain);
  }
}

/**
 * Link existing source to a game (for cache hits).
 *
 * @param strapi - Strapi instance
 * @param sourceDocumentId - Source content document ID
 * @param gameDocumentId - Game document ID to link
 */
export async function linkSourceToGame(
  strapi: Core.Strapi,
  sourceDocumentId: string,
  gameDocumentId: string
): Promise<void> {
  try {
    const sourceContentService = getSourceContentService(strapi);
    // For relations, we need to use the raw update with connect syntax
    // This is a limitation of the document service type definitions
    await sourceContentService.update({
      documentId: sourceDocumentId,
      data: {} as Partial<SourceContentDocument>,
    });
    // TODO: Add proper relation connection when Strapi types support it
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    strapi.log.warn(`[SourceCache] Failed to link source to game: ${message}`);
  }
}

// ============================================================================
// Domain Quality Operations
// ============================================================================

/**
 * Calculate tier from average quality score.
 */
function calculateTier(avgScore: number): DomainTier {
  const { TIER_THRESHOLDS } = CLEANER_CONFIG;
  if (avgScore >= TIER_THRESHOLDS.excellent) return 'excellent';
  if (avgScore >= TIER_THRESHOLDS.good) return 'good';
  if (avgScore >= TIER_THRESHOLDS.average) return 'average';
  if (avgScore >= TIER_THRESHOLDS.poor) return 'poor';
  return 'excluded';
}

/**
 * Infer domain type from domain name.
 */
function inferDomainType(domain: string): string {
  const lower = domain.toLowerCase();

  // Wiki sites
  if (lower.includes('wiki') || lower.includes('fandom.com') || lower.includes('fextralife')) {
    return 'wiki';
  }

  // Major gaming sites
  if (
    lower.includes('ign.com') ||
    lower.includes('gamespot.com') ||
    lower.includes('kotaku.com') ||
    lower.includes('polygon.com') ||
    lower.includes('eurogamer.') ||
    lower.includes('pcgamer.com') ||
    lower.includes('rockpapershotgun.com')
  ) {
    return 'major_gaming';
  }

  // Guide sites
  if (
    lower.includes('guide') ||
    lower.includes('walkthrough') ||
    lower.includes('gamefaqs.') ||
    lower.includes('neoseeker.com')
  ) {
    return 'guide_site';
  }

  // Forums
  if (
    lower.includes('reddit.com') ||
    lower.includes('forum') ||
    lower.includes('resetera.com') ||
    lower.includes('neogaf.com')
  ) {
    return 'forum';
  }

  // News sites
  if (
    lower.includes('news') ||
    lower.includes('press') ||
    lower.includes('theverge.com') ||
    lower.includes('arstechnica.com')
  ) {
    return 'news';
  }

  // Official sites (detected by patterns)
  if (
    lower.includes('playstation.com') ||
    lower.includes('xbox.com') ||
    lower.includes('nintendo.') ||
    lower.includes('steam') ||
    lower.includes('epicgames.com')
  ) {
    return 'official';
  }

  return 'other';
}

/**
 * Aggregate stats from database query.
 */
interface DomainStats {
  avg_score: string | null;
  total_sources: string;
}

/**
 * Update domain quality aggregate based on all sources from that domain.
 *
 * @param strapi - Strapi instance
 * @param domain - Domain to update
 */
export async function updateDomainQuality(strapi: Core.Strapi, domain: string): Promise<void> {
  const knex = strapi.db.connection;
  const domainQualityService = getDomainQualityService(strapi);

  try {
    // Calculate aggregate stats from all sources for this domain
    // Note: Knex raw queries return untyped results, so we cast explicitly
    const statsResult = await knex('source_contents')
      .where('domain', domain)
      .andWhereNot('published_at', null)
      .select(
        knex.raw('AVG(quality_score) as avg_score'),
        knex.raw('COUNT(*) as total_sources')
      )
      .first();
    
    // Raw SQL results need explicit typing
    const stats: DomainStats | undefined = statsResult ? {
      avg_score: (statsResult as Record<string, unknown>).avg_score as string | null,
      total_sources: String((statsResult as Record<string, unknown>).total_sources ?? '0'),
    } : undefined;

    if (!stats || !stats.total_sources || stats.total_sources === '0') {
      return;
    }

    const avgScore = parseFloat(stats.avg_score ?? '0') || 0;
    const totalSources = parseInt(stats.total_sources, 10) || 0;
    const tier = calculateTier(avgScore);
    const domainType = inferDomainType(domain);

    // Check for auto-exclusion
    const shouldExclude =
      avgScore < CLEANER_CONFIG.AUTO_EXCLUDE_THRESHOLD &&
      totalSources >= CLEANER_CONFIG.AUTO_EXCLUDE_MIN_SAMPLES;

    // Check if domain quality record exists
    const existing = await knex<DomainQualityRow>('domain_qualities')
      .where('domain', domain)
      .first();

    if (existing) {
      // Update existing record
      await knex('domain_qualities')
        .where('id', existing.id)
        .update({
          avg_quality_score: avgScore,
          total_sources: totalSources,
          tier,
          is_excluded: shouldExclude,
          exclude_reason: shouldExclude
            ? `Auto-excluded: avg score ${avgScore.toFixed(1)} below threshold (${CLEANER_CONFIG.AUTO_EXCLUDE_THRESHOLD}) with ${totalSources} samples`
            : null,
          domain_type: domainType,
          updated_at: new Date().toISOString(),
        });
    } else {
      // Create new record
      await domainQualityService.create({
        data: {
          domain,
          avgQualityScore: avgScore,
          totalSources,
          tier,
          isExcluded: shouldExclude,
          excludeReason: shouldExclude
            ? `Auto-excluded: avg score ${avgScore.toFixed(1)} below threshold (${CLEANER_CONFIG.AUTO_EXCLUDE_THRESHOLD}) with ${totalSources} samples`
            : null,
          domainType,
        } as Partial<DomainQualityDocument>,
      });
    }

    if (shouldExclude) {
      strapi.log.info(
        `[SourceCache] Auto-excluded domain: ${domain} (avg: ${avgScore.toFixed(1)}, samples: ${totalSources})`
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    strapi.log.warn(`[SourceCache] Failed to update domain quality for ${domain}: ${message}`);
  }
}

/**
 * Get all excluded domains from the database.
 * Used to dynamically extend the exclude list for searches.
 *
 * @param strapi - Strapi instance
 * @returns Array of excluded domain names
 */
export async function getExcludedDomains(strapi: Core.Strapi): Promise<string[]> {
  const knex = strapi.db.connection;

  try {
    const excluded = await knex<DomainQualityRow>('domain_qualities')
      .where('is_excluded', true)
      .andWhereNot('published_at', null)
      .select('domain');

    return excluded.map((row) => row.domain);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    strapi.log.warn(`[SourceCache] Failed to get excluded domains: ${message}`);
    return [];
  }
}

/**
 * Get domain quality record.
 *
 * @param strapi - Strapi instance
 * @param domain - Domain to lookup
 * @returns Domain quality record or null
 */
export async function getDomainQuality(
  strapi: Core.Strapi,
  domain: string
): Promise<StoredDomainQuality | null> {
  const knex = strapi.db.connection;

  try {
    const row = await knex<DomainQualityRow>('domain_qualities')
      .where('domain', domain)
      .andWhereNot('published_at', null)
      .first();

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      documentId: row.document_id,
      domain: row.domain,
      avgQualityScore: parseFloat(row.avg_quality_score) || 0,
      totalSources: row.total_sources,
      tier: row.tier,
      isExcluded: row.is_excluded,
      excludeReason: row.exclude_reason,
      domainType: row.domain_type,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    strapi.log.warn(`[SourceCache] Failed to get domain quality for ${domain}: ${message}`);
    return null;
  }
}
