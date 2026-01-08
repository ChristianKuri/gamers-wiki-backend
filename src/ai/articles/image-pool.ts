/**
 * Image Pool for Article Generation
 *
 * Collects and aggregates images from multiple sources:
 * - IGDB (official screenshots, artworks, cover)
 * - Tavily web search (up to 5 images per search)
 * - Exa semantic search (imageLinks)
 *
 * Images are deduplicated, filtered, and prepared for the Image Curator agent.
 */

import { extractDomain } from './utils/url-utils';
import { IMAGE_POOL_CONFIG } from './config';

// ============================================================================
// Types
// ============================================================================

/**
 * Source of a collected image.
 */
export type ImageSource = 'igdb' | 'tavily' | 'exa';

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
   * Priority score for selection (higher = prefer).
   * IGDB artworks: 100, IGDB screenshots: 80, IGDB cover: 60
   * Web images: 40 (adjusted by domain quality)
   */
  readonly priority: number;
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

/** Priority scores for image sources */
const IMAGE_PRIORITY = {
  IGDB_ARTWORK: 100,
  IGDB_SCREENSHOT: 80,
  IGDB_COVER: 60,
  WEB_HIGH_QUALITY: 50,
  WEB_DEFAULT: 40,
  WEB_LOW_QUALITY: 20,
} as const;

/** High-quality gaming domains for image priority boost (from config) */
const HIGH_QUALITY_DOMAINS = new Set<string>(IMAGE_POOL_CONFIG.HIGH_QUALITY_DOMAINS);

/** Domains to exclude (low quality, watermarked, etc.) (from config) */
const EXCLUDED_DOMAINS = new Set<string>(IMAGE_POOL_CONFIG.EXCLUDED_DOMAINS);

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
 */
function shouldFilterImage(url: string, domain: string): boolean {
  // Filter excluded domains
  if (EXCLUDED_DOMAINS.has(domain)) return true;

  // Filter tracking pixels, icons, and small images by URL patterns
  const lowerUrl = url.toLowerCase();
  if (
    lowerUrl.includes('pixel') ||
    lowerUrl.includes('tracking') ||
    lowerUrl.includes('beacon') ||
    lowerUrl.includes('1x1') ||
    lowerUrl.includes('spacer') ||
    lowerUrl.includes('/icon') ||
    lowerUrl.includes('/logo') ||
    lowerUrl.includes('favicon') ||
    lowerUrl.includes('.gif') || // Often used for tracking
    lowerUrl.includes('ad.') ||
    lowerUrl.includes('/ads/')
  ) {
    return true;
  }

  return false;
}

/**
 * Gets priority score for an image based on its source and domain.
 */
function getImagePriority(source: ImageSource, igdbType?: IGDBImageType, domain?: string): number {
  if (source === 'igdb') {
    switch (igdbType) {
      case 'artwork':
        return IMAGE_PRIORITY.IGDB_ARTWORK;
      case 'screenshot':
        return IMAGE_PRIORITY.IGDB_SCREENSHOT;
      case 'cover':
        return IMAGE_PRIORITY.IGDB_COVER;
      default:
        return IMAGE_PRIORITY.IGDB_SCREENSHOT;
    }
  }

  // Web images get priority based on domain quality
  if (domain && HIGH_QUALITY_DOMAINS.has(domain)) {
    return IMAGE_PRIORITY.WEB_HIGH_QUALITY;
  }

  return IMAGE_PRIORITY.WEB_DEFAULT;
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
    if (newSeenUrls.has(url)) continue;
    newSeenUrls.add(url);

    newImages.push({
      url,
      source: 'igdb',
      isOfficial: true,
      igdbType: 'artwork',
      priority: getImagePriority('igdb', 'artwork'),
      description: 'Official game artwork',
    });
  }

  // Add screenshots
  for (const url of screenshotUrls) {
    if (newSeenUrls.has(url)) continue;
    newSeenUrls.add(url);

    newImages.push({
      url,
      source: 'igdb',
      isOfficial: true,
      igdbType: 'screenshot',
      priority: getImagePriority('igdb', 'screenshot'),
      description: 'Official game screenshot',
    });
  }

  // Add cover image
  if (coverUrl && !newSeenUrls.has(coverUrl)) {
    newSeenUrls.add(coverUrl);
    newImages.push({
      url: coverUrl,
      source: 'igdb',
      isOfficial: true,
      igdbType: 'cover',
      priority: getImagePriority('igdb', 'cover'),
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
    if (newSeenUrls.has(img.url)) continue;

    const domain = extractDomain(img.url);
    if (shouldFilterImage(img.url, domain)) continue;

    newSeenUrls.add(img.url);
    newImages.push({
      url: img.url,
      source,
      description: img.description,
      sourceDomain: domain,
      sourceQuery,
      isOfficial: false,
      priority: getImagePriority(source, undefined, domain),
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
    if (result.image && !newSeenUrls.has(result.image)) {
      const imgDomain = extractDomain(result.image);
      if (!shouldFilterImage(result.image, imgDomain)) {
        newSeenUrls.add(result.image);
        newImages.push({
          url: result.image,
          source: 'exa',
          sourceUrl,
          sourceDomain,
          sourceQuery,
          isOfficial: false,
          priority: getImagePriority('exa', undefined, sourceDomain),
        });
      }
    }

    // Add imageLinks
    if (result.imageLinks) {
      for (const imgUrl of result.imageLinks) {
        if (newSeenUrls.has(imgUrl)) continue;

        const imgDomain = extractDomain(imgUrl);
        if (shouldFilterImage(imgUrl, imgDomain)) continue;

        newSeenUrls.add(imgUrl);
        newImages.push({
          url: imgUrl,
          source: 'exa',
          sourceUrl,
          sourceDomain,
          sourceQuery,
          isOfficial: false,
          priority: getImagePriority('exa', undefined, sourceDomain),
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
 * Gets images sorted by priority (highest first).
 */
export function getImagesByPriority(pool: ImagePool): readonly CollectedImage[] {
  return [...pool.images].sort((a, b) => b.priority - a.priority);
}

/**
 * Gets the best image for hero usage from IGDB sources only.
 *
 * Hero images should be high quality to represent the article visually.
 * This function only returns IGDB images (artwork/screenshot/cover) since
 * web images have unknown quality until download. Returns undefined if no
 * IGDB images are available, letting the image curator decide whether to
 * use web images based on LLM analysis.
 */
export function getBestHeroImage(pool: ImagePool): CollectedImage | undefined {
  // First try IGDB artwork (highest quality official art)
  const artwork = pool.igdbImages.find((img) => img.igdbType === 'artwork');
  if (artwork) return artwork;

  // Then IGDB screenshot
  const screenshot = pool.igdbImages.find((img) => img.igdbType === 'screenshot');
  if (screenshot) return screenshot;

  // Finally IGDB cover (smaller but still official)
  const cover = pool.igdbImages.find((img) => img.igdbType === 'cover');
  if (cover) return cover;

  // Don't return web images for hero - they have unknown quality until download.
  // Let the image curator decide if web images are acceptable based on LLM analysis.
  return undefined;
}

/**
 * Gets images matching a section topic (by query relevance).
 *
 * @param pool - Image pool
 * @param sectionHeadline - The section headline to match
 * @param limit - Maximum number of images to return
 * @returns Matching images sorted by priority
 */
export function getImagesForSection(
  pool: ImagePool,
  sectionHeadline: string,
  limit: number = 5
): readonly CollectedImage[] {
  const headlineLower = sectionHeadline.toLowerCase();
  const keywords = headlineLower.split(/\s+/).filter((w) => w.length > 3);

  // Score images by how well their query/description matches the section
  const scored = pool.images.map((img) => {
    let matchScore = 0;

    // Check query match
    if (img.sourceQuery) {
      const queryLower = img.sourceQuery.toLowerCase();
      for (const keyword of keywords) {
        if (queryLower.includes(keyword)) {
          matchScore += 10;
        }
      }
    }

    // Check description match
    if (img.description) {
      const descLower = img.description.toLowerCase();
      for (const keyword of keywords) {
        if (descLower.includes(keyword)) {
          matchScore += 5;
        }
      }
    }

    return {
      image: img,
      score: matchScore + img.priority * 0.1, // Add priority as tiebreaker
    };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.image);
}

/**
 * Creates a summary of the image pool for logging.
 */
export function getPoolSummary(pool: ImagePool): {
  total: number;
  igdb: number;
  tavily: number;
  exa: number;
  artworks: number;
  screenshots: number;
} {
  let artworks = 0;
  let screenshots = 0;
  let tavily = 0;
  let exa = 0;

  for (const img of pool.images) {
    if (img.source === 'igdb') {
      if (img.igdbType === 'artwork') artworks++;
      else screenshots++;
    } else if (img.source === 'tavily') {
      tavily++;
    } else if (img.source === 'exa') {
      exa++;
    }
  }

  return {
    total: pool.count,
    igdb: pool.igdbImages.length,
    tavily,
    exa,
    artworks,
    screenshots,
  };
}
