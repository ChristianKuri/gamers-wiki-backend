/**
 * Image Pool for Article Generation
 *
 * Collects and aggregates images from multiple sources:
 * - IGDB (official screenshots, artworks, cover)
 * - Tavily web search (up to 5 images per search)
 * - Exa semantic search (imageLinks)
 * - Source articles (images extracted from cleaned content)
 *
 * Images are deduplicated, filtered, and prepared for the Image Curator agent.
 */

import { extractDomain } from './utils/url-utils';
import { IMAGE_POOL_CONFIG } from './config';
import type { SourceImage } from './types';
import { normalizeUrl } from './utils/image-extractor';

// ============================================================================
// Types
// ============================================================================

/**
 * Source of a collected image.
 * - igdb: Official IGDB images (screenshots, artwork, cover)
 * - tavily: Images from Tavily web search
 * - exa: Images from Exa semantic search
 * - source: Images extracted from cleaned source articles
 */
export type ImageSource = 'igdb' | 'tavily' | 'exa' | 'source';

/**
 * Type of IGDB image.
 */
export type IGDBImageType = 'artwork' | 'screenshot' | 'cover';

/**
 * A single collected image with metadata.
 */
export interface CollectedImage {
  /** Direct URL to the image */
  readonly url: string;
  /** Source of the image */
  readonly source: ImageSource;
  /** Description of the image (from Tavily or IGDB) */
  readonly description?: string;
  /** Page URL where image was found (for attribution) */
  readonly sourceUrl?: string;
  /** Domain of the source page (e.g., "ign.com") */
  readonly sourceDomain?: string;
  /** Search query that found this image (for context matching) */
  readonly sourceQuery?: string;
  /** Width in pixels (if known) */
  readonly width?: number;
  /** Height in pixels (if known) */
  readonly height?: number;
  /** Whether this is an official image (IGDB images are official) */
  readonly isOfficial: boolean;
  /** IGDB-specific image type */
  readonly igdbType?: IGDBImageType;
  /**
   * Source quality score (higher = prefer as tiebreaker).
   * Used only when relevance scores are equal - not for filtering.
   * IGDB artworks: 100, IGDB screenshots: 80, IGDB cover: 60
   * Web images: 40 (adjusted by domain quality)
   */
  readonly sourceQuality: number;
}

/**
 * Image pool containing all collected images.
 */
export interface ImagePool {
  /** All collected images, deduplicated */
  readonly images: readonly CollectedImage[];
  /** IGDB images (subset of images, for quick access) */
  readonly igdbImages: readonly CollectedImage[];
  /** Web search images (subset of images, for quick access) */
  readonly webImages: readonly CollectedImage[];
  /** Total count of images */
  readonly count: number;
  /** URLs already seen (for deduplication) */
  readonly seenUrls: ReadonlySet<string>;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Source quality tiers for images.
 * 
 * These values are used as TIEBREAKERS only, not for filtering.
 * When two images have similar relevance, prefer higher quality sources.
 * The actual relevance is determined by the LLM text-based scoring.
 */
const SOURCE_QUALITY = {
  IGDB_ARTWORK: 100,
  IGDB_SCREENSHOT: 80,
  // Source article images (extracted from cleaned content) - medium quality
  // Better context than web search but not official like IGDB
  SOURCE_HIGH_QUALITY: 65,
  IGDB_COVER: 60,
  SOURCE_DEFAULT: 55,
  WEB_HIGH_QUALITY: 50,
  WEB_DEFAULT: 40,
  SOURCE_LOW_QUALITY: 35,
  WEB_LOW_QUALITY: 20,
} as const;

/** High-quality gaming domains for image priority boost (from config) */
const HIGH_QUALITY_DOMAINS = new Set<string>(IMAGE_POOL_CONFIG.HIGH_QUALITY_DOMAINS);

/** Domains to exclude (low quality, watermarked, etc.) (from config) */
const EXCLUDED_DOMAINS = new Set<string>(IMAGE_POOL_CONFIG.EXCLUDED_DOMAINS);

// URL normalization imported from image-extractor.ts for consistent deduplication

// ============================================================================
// URL Dimension Filtering
// ============================================================================

/**
 * Checks if a URL has explicit small dimensions in query params.
 * Only filters if dimensions ARE specified and are below threshold.
 * URLs without dimension params are NOT filtered (could be full-size).
 *
 * @param url - URL to check (should be lowercase)
 * @returns true if URL has small dimensions that should be filtered
 */
function hasSmallUrlDimensions(url: string): boolean {
  // Match w=123 or width=123
  const widthMatch = url.match(/[?&](w|width)=(\d+)(&|$)/);
  if (widthMatch) {
    const width = parseInt(widthMatch[2], 10);
    if (width < IMAGE_POOL_CONFIG.MIN_URL_DIMENSION) return true;
  }

  // Match h=123 or height=123
  const heightMatch = url.match(/[?&](h|height)=(\d+)(&|$)/);
  if (heightMatch) {
    const height = parseInt(heightMatch[2], 10);
    if (height < IMAGE_POOL_CONFIG.MIN_URL_DIMENSION) return true;
  }

  return false; // No dimensions in URL = don't filter
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Creates an empty image pool.
 */
export function createEmptyImagePool(): ImagePool {
  return {
    images: [],
    igdbImages: [],
    webImages: [],
    count: 0,
    seenUrls: new Set(),
  };
}

/**
 * Checks if an image URL should be filtered out.
 * Uses conservative filtering - only filter obvious bad images.
 */
function shouldFilterImage(url: string, domain: string): boolean {
  // Filter excluded domains
  if (EXCLUDED_DOMAINS.has(domain)) return true;

  // Filter tracking pixels, icons, and small images by URL patterns
  const lowerUrl = url.toLowerCase();
  if (
    // SVG files (never content images, always icons/logos/vectors)
    lowerUrl.endsWith('.svg') ||
    // Tracking and analytics
    lowerUrl.includes('pixel') ||
    lowerUrl.includes('tracking') ||
    lowerUrl.includes('beacon') ||
    lowerUrl.includes('1x1') ||
    lowerUrl.includes('spacer') ||
    lowerUrl.includes('.gif') || // Often used for tracking
    lowerUrl.includes('ad.') ||
    lowerUrl.includes('/ads/') ||
    // Video thumbnails (never game screenshots, always YT video previews)
    lowerUrl.includes('ytimg.com') ||
    // Site chrome and UI elements
    lowerUrl.includes('/icon') ||
    lowerUrl.includes('favicon') ||
    lowerUrl.includes('/sprites/') ||
    lowerUrl.includes('/flags/') ||
    lowerUrl.includes('/badge') ||
    // Any logo (catches all social share buttons, platform logos, site logos)
    lowerUrl.includes('logo') ||
    // Author photos (small profile pics)
    lowerUrl.includes('/authors/') ||
    // User content (avatars, profiles)
    lowerUrl.includes('/avatar') ||
    lowerUrl.includes('/user/') ||
    lowerUrl.includes('/profile/') ||
    lowerUrl.includes('/thumbs/') ||
    lowerUrl.includes('_thumb.') ||
    lowerUrl.includes('-thumb.') ||
    // Achievement/trophy icons (site UI, not game screenshots)
    lowerUrl.includes('/achievement') ||
    lowerUrl.includes('/trophy')
  ) {
    return true;
  }

  // Filter small dimensions in URL path (e.g., /50x50/, /16x16_)
  // These are typically thumbnails or icons, not content images
  if (/\/\d{1,2}x\d{1,2}[._\-/]/.test(lowerUrl)) {
    return true;
  }

  // Filter small dimensions in URL query params (w=50, h=99, etc.)
  // Only filters if dimensions ARE specified and are below MIN_URL_DIMENSION
  if (hasSmallUrlDimensions(lowerUrl)) {
    return true;
  }

  return false;
}

/**
 * Checks if an image has a low-quality or generic description.
 * Used to filter out images with vague metadata that won't help the curator.
 */
function hasLowQualityDescription(description?: string): boolean {
  if (!description) return false;
  
  const lower = description.toLowerCase().trim();
  
  // Exact "Image" match (generic placeholder alt text)
  if (lower === 'image') {
    return true;
  }
  
  // Generic numbered images (e.g., "Image 2", "Image 5: Something")
  if (/^image\s*\d+/i.test(lower)) {
    return true;
  }
  
  // Pure numeric descriptions (e.g., "4" for author avatar numbering)
  if (/^\d+$/.test(lower)) {
    return true;
  }
  
  // Social share descriptions (e.g., "share on facebook", "share on twitter")
  if (lower.startsWith('share on ')) {
    return true;
  }
  
  // Logo descriptions (any description containing "logo")
  if (lower.includes('logo')) {
    return true;
  }
  
  // User avatars and profile pictures
  if (
    lower.includes('avatar') ||
    lower.includes('profile picture') ||
    lower.includes('profile pic') ||
    lower.includes('user photo')
  ) {
    return true;
  }
  
  // Site UI elements and game mode badges
  if (
    lower.includes('offline mode') ||
    lower.includes('single player') ||
    lower.includes('online mode') ||
    lower.includes('multiplayer mode') ||
    lower.includes('co-op mode')
  ) {
    return true;
  }
  
  // Rating badges (ESRB, PEGI, etc.)
  if (/^esrb|^pegi|^rating|mature\s*\d|teen\s*\d/i.test(lower)) {
    return true;
  }
  
  // Platform logos (kept for backward compatibility, though 'logo' check above catches most)
  if (
    lower === 'playstation' ||
    lower === 'xbox' ||
    lower === 'nintendo' ||
    lower === 'steam' ||
    /^playstation\s*\d/i.test(lower) ||
    /^xbox\s*(one|series)/i.test(lower)
  ) {
    return true;
  }
  
  return false;
}

/**
 * Gets source quality score for an image based on its source and domain.
 * Used as tiebreaker when relevance scores are equal.
 */
function getSourceQuality(source: ImageSource, igdbType?: IGDBImageType, domain?: string): number {
  if (source === 'igdb') {
    switch (igdbType) {
      case 'artwork':
        return SOURCE_QUALITY.IGDB_ARTWORK;
      case 'screenshot':
        return SOURCE_QUALITY.IGDB_SCREENSHOT;
      case 'cover':
        return SOURCE_QUALITY.IGDB_COVER;
      default:
        return SOURCE_QUALITY.IGDB_SCREENSHOT;
    }
  }

  // Web images get quality based on domain
  if (domain && HIGH_QUALITY_DOMAINS.has(domain)) {
    return SOURCE_QUALITY.WEB_HIGH_QUALITY;
  }

  return SOURCE_QUALITY.WEB_DEFAULT;
}

// ============================================================================
// Pool Operations
// ============================================================================

/**
 * Adds IGDB images (screenshots, artworks, cover) to the pool.
 *
 * Note: Screenshots and artworks are passed as separate arrays because
 * IGDB URLs use the same format (t_screenshot_big) for both - we can't
 * detect the type from the URL pattern.
 *
 * @param pool - Current image pool
 * @param screenshotUrls - Array of IGDB screenshot URLs
 * @param artworkUrls - Array of IGDB artwork URLs (higher priority than screenshots)
 * @param coverUrl - IGDB cover image URL
 * @returns Updated image pool
 */
export function addIGDBImages(
  pool: ImagePool,
  screenshotUrls: readonly string[],
  artworkUrls: readonly string[],
  coverUrl?: string | null
): ImagePool {
  const newImages: CollectedImage[] = [];
  const newSeenUrls = new Set(pool.seenUrls);

  // Add artworks (higher priority for hero images)
  for (const url of artworkUrls) {
    const normalizedUrl = normalizeUrl(url);
    if (newSeenUrls.has(normalizedUrl)) continue;
    newSeenUrls.add(normalizedUrl);

    newImages.push({
      url,
      source: 'igdb',
      isOfficial: true,
      igdbType: 'artwork',
      sourceQuality: getSourceQuality('igdb', 'artwork'),
      description: 'Official game artwork',
    });
  }

  // Add screenshots
  for (const url of screenshotUrls) {
    const normalizedUrl = normalizeUrl(url);
    if (newSeenUrls.has(normalizedUrl)) continue;
    newSeenUrls.add(normalizedUrl);

    newImages.push({
      url,
      source: 'igdb',
      isOfficial: true,
      igdbType: 'screenshot',
      sourceQuality: getSourceQuality('igdb', 'screenshot'),
      description: 'Official game screenshot',
    });
  }

  // Add cover image
  const normalizedCoverUrl = coverUrl ? normalizeUrl(coverUrl) : null;
  if (coverUrl && normalizedCoverUrl && !newSeenUrls.has(normalizedCoverUrl)) {
    newSeenUrls.add(normalizedCoverUrl);
    newImages.push({
      url: coverUrl,
      source: 'igdb',
      isOfficial: true,
      igdbType: 'cover',
      sourceQuality: getSourceQuality('igdb', 'cover'),
      description: 'Official game cover art',
    });
  }

  if (newImages.length === 0) {
    return pool;
  }

  const allImages = [...pool.images, ...newImages];
  const igdbImages = [...pool.igdbImages, ...newImages];

  return {
    images: allImages,
    igdbImages,
    webImages: pool.webImages,
    count: allImages.length,
    seenUrls: newSeenUrls,
  };
}

/**
 * Adds web search images to the pool.
 * Supports both Tavily and Exa search results.
 *
 * @param pool - Current image pool
 * @param images - Array of images with optional descriptions
 * @param sourceQuery - The search query that found these images
 * @param source - The search source ('tavily' or 'exa'), defaults to 'tavily'
 * @returns Updated image pool
 */
export function addWebImages(
  pool: ImagePool,
  images: readonly { url: string; description?: string }[],
  sourceQuery: string,
  source: 'tavily' | 'exa' = 'tavily'
): ImagePool {
  const newImages: CollectedImage[] = [];
  const newSeenUrls = new Set(pool.seenUrls);

  for (const img of images) {
    const normalizedUrl = normalizeUrl(img.url);
    if (newSeenUrls.has(normalizedUrl)) continue;

    const domain = extractDomain(img.url);
    if (shouldFilterImage(img.url, domain)) continue;

    newSeenUrls.add(normalizedUrl);
    newImages.push({
      url: img.url,
      source,
      description: img.description,
      sourceDomain: domain,
      sourceQuery,
      isOfficial: false,
      sourceQuality: getSourceQuality(source, undefined, domain),
    });
  }

  if (newImages.length === 0) {
    return pool;
  }

  const allImages = [...pool.images, ...newImages];
  const webImages = [...pool.webImages, ...newImages];

  return {
    images: allImages,
    igdbImages: pool.igdbImages,
    webImages,
    count: allImages.length,
    seenUrls: newSeenUrls,
  };
}

/**
 * Adds Exa search images to the pool.
 *
 * @param pool - Current image pool
 * @param results - Array of Exa search results with imageLinks
 * @param sourceQuery - The search query that found these images
 * @returns Updated image pool
 */
export function addExaImages(
  pool: ImagePool,
  results: readonly { url: string; imageLinks?: readonly string[]; image?: string }[],
  sourceQuery: string
): ImagePool {
  const newImages: CollectedImage[] = [];
  const newSeenUrls = new Set(pool.seenUrls);

  for (const result of results) {
    const sourceUrl = result.url;
    const sourceDomain = extractDomain(sourceUrl);

    // Add representative image if available
    if (result.image) {
      const normalizedImageUrl = normalizeUrl(result.image);
      if (!newSeenUrls.has(normalizedImageUrl)) {
        const imgDomain = extractDomain(result.image);
        if (!shouldFilterImage(result.image, imgDomain)) {
          newSeenUrls.add(normalizedImageUrl);
          newImages.push({
            url: result.image,
            source: 'exa',
            sourceUrl,
            sourceDomain,
            sourceQuery,
            isOfficial: false,
            sourceQuality: getSourceQuality('exa', undefined, sourceDomain),
          });
        }
      }
    }

    // Add imageLinks
    if (result.imageLinks) {
      for (const imgUrl of result.imageLinks) {
        const normalizedImgUrl = normalizeUrl(imgUrl);
        if (newSeenUrls.has(normalizedImgUrl)) continue;

        const imgDomain = extractDomain(imgUrl);
        if (shouldFilterImage(imgUrl, imgDomain)) continue;

        newSeenUrls.add(normalizedImgUrl);
        newImages.push({
          url: imgUrl,
          source: 'exa',
          sourceUrl,
          sourceDomain,
          sourceQuery,
          isOfficial: false,
          sourceQuality: getSourceQuality('exa', undefined, sourceDomain),
        });
      }
    }
  }

  if (newImages.length === 0) {
    return pool;
  }

  const allImages = [...pool.images, ...newImages];
  const webImages = [...pool.webImages, ...newImages];

  return {
    images: allImages,
    igdbImages: pool.igdbImages,
    webImages,
    count: allImages.length,
    seenUrls: newSeenUrls,
  };
}

/**
 * Adds images extracted from cleaned source articles to the pool.
 *
 * These images have rich contextual information (nearest header, surrounding paragraph)
 * which makes them more relevant to specific article sections. They get medium priority -
 * better context than generic web search, but not official like IGDB.
 *
 * @param pool - Current image pool
 * @param images - Images extracted from cleaned source
 * @param sourceUrl - URL of the source article
 * @param sourceDomain - Domain of the source article
 * @returns Updated image pool
 */
export function addSourceImages(
  pool: ImagePool,
  images: readonly SourceImage[],
  sourceUrl: string,
  sourceDomain: string
): ImagePool {
  const newImages: CollectedImage[] = [];
  const newSeenUrls = new Set(pool.seenUrls);

  for (const img of images) {
    // Skip if already seen (use normalized URL for deduplication)
    const normalizedUrl = normalizeUrl(img.url);
    if (newSeenUrls.has(normalizedUrl)) continue;

    // Check if should be filtered by URL patterns
    const imgDomain = extractDomain(img.url);
    if (shouldFilterImage(img.url, imgDomain)) continue;
    
    // Skip images with low-quality descriptions (they likely won't help the curator)
    if (hasLowQualityDescription(img.description)) continue;

    newSeenUrls.add(normalizedUrl);
    newImages.push({
      url: img.url,
      source: 'source',
      description: img.description,
      sourceUrl,
      sourceDomain,
      // Use context as the source query for better matching in image curator
      sourceQuery: img.nearestHeader ?? img.contextParagraph?.slice(0, 100),
      isOfficial: false,
      // Pass description and header for quality-aware scoring
      sourceQuality: getSourceImageQuality(sourceDomain, img.description, img.nearestHeader),
    });
  }

  if (newImages.length === 0) {
    return pool;
  }

  const allImages = [...pool.images, ...newImages];
  const webImages = [...pool.webImages, ...newImages];

  return {
    images: allImages,
    igdbImages: pool.igdbImages,
    webImages, // Source images count as web images for categorization
    count: allImages.length,
    seenUrls: newSeenUrls,
  };
}

/**
 * Gets source quality score for a source image based on domain quality and metadata.
 * Used as tiebreaker when relevance scores are equal.
 *
 * @param sourceDomain - Domain the image came from
 * @param description - Image description (may be cleaned filename or alt text)
 * @param nearestHeader - Nearest H2/H3 header above the image
 * @returns Source quality score
 */
function getSourceImageQuality(
  sourceDomain: string,
  description?: string,
  nearestHeader?: string
): number {
  // Start with base quality based on domain
  let quality: number;
  
  if (HIGH_QUALITY_DOMAINS.has(sourceDomain)) {
    quality = SOURCE_QUALITY.SOURCE_HIGH_QUALITY;
  } else {
    // Check for common low-quality patterns
    const lowerDomain = sourceDomain.toLowerCase();
    if (
      lowerDomain.includes('reddit') ||
      lowerDomain.includes('tumblr') ||
      lowerDomain.includes('pinterest')
    ) {
      quality = SOURCE_QUALITY.SOURCE_LOW_QUALITY;
    } else {
      quality = SOURCE_QUALITY.SOURCE_DEFAULT;
    }
  }
  
  // Boost quality if image has good section context
  // Images with headers are more likely to be relevant to specific sections
  if (nearestHeader && nearestHeader.length > 3) {
    quality += 5;
  }
  
  // Penalize images with missing or very short descriptions
  if (!description || description.length < 10) {
    quality -= 10;
  }
  
  // Note: hasLowQualityDescription check removed - images with low-quality
  // descriptions are already filtered in addSourceImages() before this function
  
  // Ensure quality doesn't go below minimum useful threshold
  return Math.max(quality, SOURCE_QUALITY.WEB_LOW_QUALITY);
}

/**
 * Merges two image pools.
 */
export function mergeImagePools(pool1: ImagePool, pool2: ImagePool): ImagePool {
  const mergedSeenUrls = new Set([...pool1.seenUrls, ...pool2.seenUrls]);

  // Deduplicate images (prefer pool1's version if duplicate)
  const seenInMerge = new Set<string>();
  const mergedImages: CollectedImage[] = [];
  const mergedIgdbImages: CollectedImage[] = [];
  const mergedWebImages: CollectedImage[] = [];

  for (const img of [...pool1.images, ...pool2.images]) {
    if (seenInMerge.has(img.url)) continue;
    seenInMerge.add(img.url);

    mergedImages.push(img);
    if (img.source === 'igdb') {
      mergedIgdbImages.push(img);
    } else {
      mergedWebImages.push(img);
    }
  }

  return {
    images: mergedImages,
    igdbImages: mergedIgdbImages,
    webImages: mergedWebImages,
    count: mergedImages.length,
    seenUrls: mergedSeenUrls,
  };
}

/**
 * Gets images sorted by source quality (highest first).
 * Used for hero image selection when no better ordering is available.
 */
export function getImagesBySourceQuality(pool: ImagePool): readonly CollectedImage[] {
  return [...pool.images].sort((a, b) => b.sourceQuality - a.sourceQuality);
}

/**
 * Gets the best image for hero/featured image usage.
 *
 * Considers ALL image sources (IGDB, source, web) and scores by:
 * - Article title relevance (description/query matching title keywords)
 * - Source quality (IGDB images get a bonus)
 * - Image type (artwork gets a slight preference)
 *
 * @param pool - Image pool to select from
 * @param articleTitle - Optional article title for relevance scoring
 * @returns Best matching image, or undefined if pool is empty
 */
export function getBestHeroImage(
  pool: ImagePool,
  articleTitle?: string
): CollectedImage | undefined {
  // If no images at all, return undefined
  if (pool.count === 0) return undefined;

  // If no title provided, fall back to highest quality image
  if (!articleTitle) {
    return getImagesBySourceQuality(pool)[0];
  }

  // Extract keywords from article title (words > 3 chars)
  const titleKeywords = articleTitle
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  // Score ALL images by title relevance (not just IGDB)
  const scored = pool.images.map((img) => {
    let score = img.sourceQuality;

    // Big boost for description matching title keywords
    if (img.description) {
      const descLower = img.description.toLowerCase();
      for (const keyword of titleKeywords) {
        if (descLower.includes(keyword)) score += 25;
      }
    }

    // Boost for sourceQuery matching title keywords
    if (img.sourceQuery) {
      const queryLower = img.sourceQuery.toLowerCase();
      for (const keyword of titleKeywords) {
        if (queryLower.includes(keyword)) score += 15;
      }
    }

    // Small boost for IGDB images (known quality)
    if (img.source === 'igdb') score += 10;

    // Small boost for artwork type
    if (img.igdbType === 'artwork') score += 5;

    return { image: img, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.image;
}

/**
 * Gets candidate images for a section.
 *
 * Returns up to `limit` candidates for LLM text-based relevance scoring.
 * No complex scoring is done here - the LLM decides relevance.
 * Source quality is used only as a tiebreaker for deduplication ordering.
 *
 * @param pool - Image pool
 * @param limit - Maximum number of candidates to return (default: 30)
 * @returns Deduplicated images for LLM evaluation
 */
export function getImagesForSection(
  pool: ImagePool,
  limit: number = 30
): readonly CollectedImage[] {
  // Return all images sorted by source quality (as tiebreaker)
  // The LLM will determine actual relevance via text-based scoring
  return getImagesBySourceQuality(pool).slice(0, limit);
}

/**
 * Creates a summary of the image pool for logging.
 */
export function getPoolSummary(pool: ImagePool): {
  total: number;
  igdb: number;
  tavily: number;
  exa: number;
  source: number;
  artworks: number;
  screenshots: number;
} {
  let artworks = 0;
  let screenshots = 0;
  let tavily = 0;
  let exa = 0;
  let source = 0;

  for (const img of pool.images) {
    if (img.source === 'igdb') {
      if (img.igdbType === 'artwork') artworks++;
      else screenshots++;
    } else if (img.source === 'tavily') {
      tavily++;
    } else if (img.source === 'exa') {
      exa++;
    } else if (img.source === 'source') {
      source++;
    }
  }

  return {
    total: pool.count,
    igdb: pool.igdbImages.length,
    tavily,
    exa,
    source,
    artworks,
    screenshots,
  };
}
