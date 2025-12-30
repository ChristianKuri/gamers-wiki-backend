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
  relevance_score: number | null; // null for scrape failures (unknown relevance)
  quality_notes: string | null;
  content_type: string;
  junk_ratio: string; // decimal comes as string from Knex
  access_count: number;
  last_accessed_at: string | null;
  search_source: 'tavily' | 'exa';
  published_at: string | null;
}

/**
 * Minimal source info for scrape failures.
 * Used to track failed URLs without spending LLM tokens.
 */
export interface ScrapeFailureSource {
  readonly url: string;
  readonly title: string;
  readonly originalContentLength: number;
  readonly searchSource: SearchSource;
}

/**
 * Raw database row for domain_qualities table.
 */
interface DomainQualityRow {
  id: number;
  document_id: string;
  domain: string;
  avg_quality_score: string; // decimal comes as string from Knex
  avg_relevance_score: string; // decimal comes as string from Knex
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
// Domain Exclusion
// ============================================================================

/**
 * Get ALL excluded domains (static hardcoded + database auto-excluded).
 * This is the SINGLE SOURCE OF TRUTH for domain exclusions.
 * Use this for Exa/Tavily excludeDomains parameter.
 * 
 * @param strapi - Strapi instance for DB access
 * @returns Array of domain strings to exclude from searches
 */
export async function getAllExcludedDomains(strapi: Core.Strapi): Promise<readonly string[]> {
  // Start with static hardcoded list
  const allExcluded = new Set<string>(CLEANER_CONFIG.EXCLUDED_DOMAINS);
  
  // Add all DB-excluded domains
  const dbExcluded = await getAllExcludedDomainsFromDb(strapi);
  for (const domain of dbExcluded) {
    allExcluded.add(domain);
  }
  
  return [...allExcluded];
}

/**
 * Get ALL excluded domains from DB (not filtered by input list).
 * Returns all domains marked as excluded in the database.
 * 
 * @param strapi - Strapi instance
 * @returns Set of excluded domain names
 */
async function getAllExcludedDomainsFromDb(strapi: Core.Strapi): Promise<Set<string>> {
  const knex = strapi.db.connection;
  
  try {
    const rows = await knex<{ domain: string }>('domain_qualities')
      .where('is_excluded', true)
      .select('domain');
    
    return new Set(rows.map((r) => r.domain));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    strapi.log.warn(`[SourceCache] Failed to fetch all excluded domains: ${message}`);
    return new Set();
  }
}

/**
 * Check if a domain is excluded (either hardcoded or in DB).
 * 
 * @param domain - Domain to check (without www prefix)
 * @param strapi - Optional Strapi instance for DB check
 * @returns true if domain should be excluded
 */
export async function isDomainExcluded(
  domain: string,
  strapi?: Core.Strapi
): Promise<boolean> {
  // Check hardcoded list first (fast)
  if (CLEANER_CONFIG.EXCLUDED_DOMAINS.has(domain)) {
    return true;
  }
  
  // Also check with www prefix
  if (CLEANER_CONFIG.EXCLUDED_DOMAINS.has(`www.${domain}`)) {
    return true;
  }
  
  // Check DB if strapi is available
  if (strapi) {
    const domainQuality = await getDomainQuality(strapi, domain);
    if (domainQuality?.isExcluded) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get excluded domains from DB for a specific list of domains.
 * Returns set of domain names that are marked as excluded.
 * 
 * @param strapi - Strapi instance
 * @param domains - Domains to check
 * @returns Set of excluded domain names
 */
async function getExcludedDomainsFromDb(
  strapi: Core.Strapi,
  domains: readonly string[]
): Promise<Set<string>> {
  if (domains.length === 0) {
    return new Set();
  }
  
  const knex = strapi.db.connection;
  
  try {
    const rows = await knex<{ domain: string }>('domain_qualities')
      .whereIn('domain', domains)
      .andWhere('is_excluded', true)
      .select('domain');
    
    return new Set(rows.map((r) => r.domain));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    strapi.log.warn(`[SourceCache] Failed to check excluded domains: ${message}`);
    return new Set();
  }
}

// ============================================================================
// Cache Operations
// ============================================================================

/**
 * Check cache for multiple URLs in parallel.
 * Returns cache hits and misses with their data.
 * Filters out sources from excluded domains (hardcoded + DB).
 *
 * @param strapi - Strapi instance
 * @param rawSources - Raw sources to check
 * @returns Array of cache check results (excluded domains return hit=false, raw=null)
 */
export async function checkSourceCache(
  strapi: Core.Strapi,
  rawSources: readonly RawSourceInput[]
): Promise<CacheCheckResult[]> {
  if (rawSources.length === 0) {
    return [];
  }

  // Normalize URLs and extract domains
  const normalizedUrls = rawSources.map((s) => {
    const normalized = normalizeUrl(s.url);
    const domain = normalized ? extractDomain(normalized) : '';
    return {
      original: s,
      normalized,
      domain,
    };
  });

  // Filter out invalid URLs
  const validUrls = normalizedUrls.filter((u) => u.normalized !== null);
  
  // Get unique domains to check for exclusion
  const uniqueDomains = [...new Set(validUrls.map((u) => u.domain).filter(Boolean))];
  
  // Check hardcoded exclusions
  const hardcodedExcluded = new Set(
    uniqueDomains.filter((d) => 
      CLEANER_CONFIG.EXCLUDED_DOMAINS.has(d) || 
      CLEANER_CONFIG.EXCLUDED_DOMAINS.has(`www.${d}`)
    )
  );
  
  // Check DB exclusions for non-hardcoded domains
  const domainsToCheckInDb = uniqueDomains.filter((d) => !hardcodedExcluded.has(d));
  const dbExcluded = await getExcludedDomainsFromDb(strapi, domainsToCheckInDb);
  
  // Combine all excluded domains
  const allExcluded = new Set([...hardcodedExcluded, ...dbExcluded]);
  
  // Log excluded domains if any
  if (allExcluded.size > 0) {
    strapi.log.debug(`[SourceCache] Excluding ${allExcluded.size} domain(s): ${[...allExcluded].join(', ')}`);
  }
  
  // Filter out excluded domains from valid URLs
  const nonExcludedUrls = validUrls.filter((u) => !allExcluded.has(u.domain));

  // If no valid non-excluded URLs, return early
  if (nonExcludedUrls.length === 0) {
    // Return all as misses with raw=null for excluded domains
    return normalizedUrls.map((u) => ({
      url: u.original.url,
      hit: false,
      // If domain is excluded, don't include raw (prevents cleaning attempt)
      raw: u.domain && allExcluded.has(u.domain) ? undefined : u.original,
    }));
  }

  // Query database for non-excluded URLs only
  // Using raw Knex query for efficiency (document service doesn't support $in)
  const knex = strapi.db.connection;
  const cachedRows = await knex<SourceContentRow>('source_contents')
    .whereIn(
      'url',
      nonExcludedUrls.map((u) => u.normalized)
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
      relevanceScore: row.relevance_score ?? 100, // Default to 100 for legacy data
      qualityNotes: row.quality_notes,
      contentType: row.content_type,
      junkRatio: parseFloat(row.junk_ratio),
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
      searchSource: row.search_source,
    });
  }

  // Update access count for cache hits (fire-and-forget)
  const hitUrls = nonExcludedUrls
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

  // Build results - excluded domains return hit=false with no raw (skip processing)
  return rawSources.map((raw) => {
    const normalized = normalizeUrl(raw.url);
    if (!normalized) {
      return { url: raw.url, hit: false, raw };
    }
    
    // Check if this domain is excluded
    const domain = extractDomain(normalized);
    if (allExcluded.has(domain)) {
      // Excluded domain - return as miss with no raw data (won't attempt cleaning)
      return { url: raw.url, hit: false };
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
          relevanceScore: cached.relevanceScore,
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
 * Store scrape failures in the database.
 * These are URLs where content extraction failed (< MIN_CONTENT_LENGTH chars).
 * Stores minimal record with qualityScore: 0 and relevanceScore: null.
 * This prevents re-processing the same URL and enables domain failure tracking.
 *
 * @param strapi - Strapi instance
 * @param failures - Sources that failed to scrape
 */
export async function storeScrapeFailures(
  strapi: Core.Strapi,
  failures: readonly ScrapeFailureSource[]
): Promise<void> {
  if (failures.length === 0) {
    return;
  }

  const sourceContentService = getSourceContentService(strapi);
  const knex = strapi.db.connection;
  const now = new Date().toISOString();
  const domainsToUpdate = new Set<string>();

  for (const failure of failures) {
    const normalizedUrl = normalizeUrl(failure.url);
    if (!normalizedUrl) continue;

    const domain = extractDomain(normalizedUrl);
    domainsToUpdate.add(domain);

    try {
      // Check if already exists (don't count same URL twice)
      const existing = await knex<SourceContentRow>('source_contents')
        .where('url', normalizedUrl)
        .first();

      if (existing) {
        strapi.log.debug(`[SourceCache] Scrape failure already recorded: ${normalizedUrl}`);
        continue;
      }

      // Store minimal record for scrape failure
      const failureData: Partial<SourceContentDocument> = {
        url: normalizedUrl,
        domain,
        title: failure.title,
        summary: null,
        cleanedContent: `[Scrape failed - content too short: ${failure.originalContentLength} chars]`,
        originalContentLength: failure.originalContentLength,
        qualityScore: 0, // Known: scrape failed
        // relevanceScore: null - omitted, we don't know relevance
        qualityNotes: `Scrape failure: only ${failure.originalContentLength} chars extracted (min: ${CLEANER_CONFIG.MIN_CONTENT_LENGTH})`,
        contentType: 'scrape_failure',
        junkRatio: 1, // 100% junk since nothing useful was extracted
        accessCount: 1,
        lastAccessedAt: now,
        searchSource: failure.searchSource,
      };

      await sourceContentService.create({
        data: failureData as Partial<SourceContentDocument>,
      });

      strapi.log.debug(
        `[SourceCache] Stored scrape failure (${failure.originalContentLength} chars): ${normalizedUrl}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      strapi.log.warn(`[SourceCache] Failed to store scrape failure ${failure.url}: ${message}`);
    }
  }

  // Update domain quality for all affected domains
  for (const domain of domainsToUpdate) {
    await updateDomainQuality(strapi, domain);
  }
}

/**
 * Pre-filter result for storage.
 */
export interface PreFilterResultForStorage {
  readonly url: string;
  readonly domain: string;
  readonly title: string;
  readonly relevanceToGaming: number;
  readonly relevanceToArticle: number;
  readonly reason: string;
  readonly contentType: string;
  readonly searchSource: 'tavily' | 'exa';
  readonly originalContentLength: number;
}

/**
 * Store pre-filter results in the database.
 * Stores minimal records with relevance scores for domain quality tracking.
 * Only stores sources that were FILTERED OUT (low relevance).
 *
 * @param strapi - Strapi instance
 * @param results - Pre-filter results to store (only irrelevant ones)
 */
export async function storePreFilterResults(
  strapi: Core.Strapi,
  results: readonly PreFilterResultForStorage[]
): Promise<void> {
  if (results.length === 0) {
    return;
  }

  const sourceContentService = getSourceContentService(strapi);
  const knex = strapi.db.connection;
  const now = new Date().toISOString();
  const domainsToUpdate = new Set<string>();

  for (const result of results) {
    const normalizedUrl = normalizeUrl(result.url);
    if (!normalizedUrl) continue;

    domainsToUpdate.add(result.domain);

    try {
      // Check if already exists (don't count same URL twice)
      const existing = await knex<SourceContentRow>('source_contents')
        .where('url', normalizedUrl)
        .first();

      if (existing) {
        strapi.log.debug(`[SourceCache] Pre-filter result already recorded: ${normalizedUrl}`);
        continue;
      }

      // Store minimal record with pre-filter relevance scores
      // qualityScore is unknown (not cleaned), use null indicator
      const preFilterData: Partial<SourceContentDocument> = {
        url: normalizedUrl,
        domain: result.domain,
        title: result.title,
        summary: null,
        cleanedContent: `[Pre-filtered - Gaming: ${result.relevanceToGaming}/100, Article: ${result.relevanceToArticle}/100] ${result.reason}`,
        originalContentLength: result.originalContentLength,
        qualityScore: 0, // Unknown - not cleaned
        relevanceScore: result.relevanceToGaming, // Use gaming relevance for domain tracking
        qualityNotes: `Pre-filtered: ${result.reason}. Type: ${result.contentType}`,
        contentType: result.contentType,
        junkRatio: 1, // Not cleaned, so all is "junk" from our perspective
        accessCount: 1,
        lastAccessedAt: now,
        searchSource: result.searchSource,
      };

      await sourceContentService.create({
        data: preFilterData as Partial<SourceContentDocument>,
      });

      strapi.log.debug(
        `[SourceCache] Stored pre-filter result (Gaming: ${result.relevanceToGaming}, Article: ${result.relevanceToArticle}): ${normalizedUrl}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      strapi.log.warn(`[SourceCache] Failed to store pre-filter result ${result.url}: ${message}`);
    }
  }

  // Update domain quality for all affected domains
  for (const domain of domainsToUpdate) {
    await updateDomainQuality(strapi, domain);
  }
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

  // Track ALL domains for quality updates (even sources we don't store)
  // This ensures auto-exclusion works after 5 bad articles
  const domainsToUpdate = new Set<string>();

  for (const source of cleanedSources) {
    // ALWAYS track domain for quality updates (even if we don't store)
    domainsToUpdate.add(source.domain);

    // Check if source meets thresholds for STORAGE (lower than filtering threshold)
    // This allows us to track bad-but-not-terrible content for domain quality stats
    const veryLowQuality = source.qualityScore < CLEANER_CONFIG.MIN_QUALITY_FOR_STORAGE;
    const lowRelevance = source.relevanceScore < CLEANER_CONFIG.MIN_RELEVANCE_FOR_RESULTS;

    if (veryLowQuality) {
      strapi.log.debug(
        `[SourceCache] Not storing very-low-quality source (Q:${source.qualityScore} < ${CLEANER_CONFIG.MIN_QUALITY_FOR_STORAGE}): ${source.url}`
      );
    }

    if (lowRelevance) {
      strapi.log.debug(
        `[SourceCache] Not storing low-relevance source (R:${source.relevanceScore} < ${CLEANER_CONFIG.MIN_RELEVANCE_FOR_RESULTS}): ${source.url}`
      );
    }

    // Skip FULL storage only for very low quality or irrelevant content
    // (quality 20-34 gets full storage so we can track it, but will be filtered from LLM results)
    if (veryLowQuality || lowRelevance) {
      // Store minimal record for domain quality tracking (no content, saves space)
      try {
        const normalizedUrl = normalizeUrl(source.url);
        if (!normalizedUrl) continue;

        // Check if already exists
        const existing = await knex<SourceContentRow>('source_contents')
          .where('url', normalizedUrl)
          .first();

        if (!existing) {
          // Store minimal record without full content (for domain tracking)
          const minimalData: Partial<SourceContentDocument> = {
            url: normalizedUrl,
            domain: source.domain,
            title: source.title,
            summary: source.summary ?? null,
            cleanedContent: '[Content not stored - below quality/relevance threshold]',
            originalContentLength: source.originalContentLength,
            qualityScore: source.qualityScore,
            relevanceScore: source.relevanceScore,
            qualityNotes: source.qualityNotes,
            contentType: source.contentType,
            junkRatio: source.junkRatio,
            accessCount: 1,
            lastAccessedAt: now,
            searchSource: source.searchSource,
          };

          await sourceContentService.create({
            data: minimalData as Partial<SourceContentDocument>,
          });

          strapi.log.debug(
            `[SourceCache] Stored minimal record for domain tracking (Q:${source.qualityScore}, R:${source.relevanceScore}): ${normalizedUrl}`
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        strapi.log.warn(`[SourceCache] Failed to store minimal record ${source.url}: ${message}`);
      }
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

      // Create new source content entry with full content
      const createData: Partial<SourceContentDocument> = {
        url: normalizedUrl,
        domain: source.domain,
        title: source.title,
        summary: source.summary ?? null,
        cleanedContent: source.cleanedContent,
        originalContentLength: source.originalContentLength,
        qualityScore: source.qualityScore,
        relevanceScore: source.relevanceScore,
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
        `[SourceCache] Stored source with content (Q:${source.qualityScore}, R:${source.relevanceScore}): ${normalizedUrl}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      strapi.log.warn(`[SourceCache] Failed to store source ${source.url}: ${message}`);
    }
  }

  // Update domain quality aggregates for ALL domains (including bad ones)
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
  avg_relevance: string | null;
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
        knex.raw('AVG(relevance_score) as avg_relevance'),
        knex.raw('COUNT(*) as total_sources')
      )
      .first();
    
    // Raw SQL results need explicit typing
    const stats: DomainStats | undefined = statsResult ? {
      avg_score: (statsResult as Record<string, unknown>).avg_score as string | null,
      avg_relevance: (statsResult as Record<string, unknown>).avg_relevance as string | null,
      total_sources: String((statsResult as Record<string, unknown>).total_sources ?? '0'),
    } : undefined;

    if (!stats || !stats.total_sources || stats.total_sources === '0') {
      return;
    }

    const avgScore = parseFloat(stats.avg_score ?? '0') || 0;
    const avgRelevance = parseFloat(stats.avg_relevance ?? '0') || 0;
    const totalSources = parseInt(stats.total_sources, 10) || 0;
    const tier = calculateTier(avgScore);
    const domainType = inferDomainType(domain);

    // Check for auto-exclusion (low quality OR low relevance)
    const lowQuality = avgScore < CLEANER_CONFIG.AUTO_EXCLUDE_THRESHOLD;
    const lowRelevance = avgRelevance < CLEANER_CONFIG.AUTO_EXCLUDE_RELEVANCE_THRESHOLD;
    const hasSufficientSamples = totalSources >= CLEANER_CONFIG.AUTO_EXCLUDE_MIN_SAMPLES;
    const shouldExclude = hasSufficientSamples && (lowQuality || lowRelevance);
    
    // Build exclude reason
    let excludeReason: string | null = null;
    if (shouldExclude) {
      const reasons: string[] = [];
      if (lowQuality) {
        reasons.push(`quality ${avgScore.toFixed(1)} < ${CLEANER_CONFIG.AUTO_EXCLUDE_THRESHOLD}`);
      }
      if (lowRelevance) {
        reasons.push(`relevance ${avgRelevance.toFixed(1)} < ${CLEANER_CONFIG.AUTO_EXCLUDE_RELEVANCE_THRESHOLD}`);
      }
      excludeReason = `Auto-excluded: ${reasons.join(', ')} (${totalSources} samples)`;
    }

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
          avg_relevance_score: avgRelevance,
          total_sources: totalSources,
          tier,
          is_excluded: shouldExclude,
          exclude_reason: excludeReason,
          domain_type: domainType,
          updated_at: new Date().toISOString(),
        });
    } else {
      // Create new record
      await domainQualityService.create({
        data: {
          domain,
          avgQualityScore: avgScore,
          avgRelevanceScore: avgRelevance,
          totalSources,
          tier,
          isExcluded: shouldExclude,
          excludeReason: excludeReason,
          domainType,
        } as Partial<DomainQualityDocument>,
      });
    }

    if (shouldExclude) {
      strapi.log.info(
        `[SourceCache] Auto-excluded domain: ${domain} (quality: ${avgScore.toFixed(1)}, relevance: ${avgRelevance.toFixed(1)}, samples: ${totalSources})`
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
      avgRelevanceScore: parseFloat(row.avg_relevance_score) || 0,
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
