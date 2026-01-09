/**
 * Image Extractor Utility
 *
 * Handles extraction of images from source articles:
 * 1. Pre-extraction: Build allowlist of valid URLs from raw content (prevents hallucinations)
 * 2. Post-extraction: Parse markdown images from cleaned content
 * 3. Validation: Keep only images with URLs in the allowlist
 * 4. Context extraction: Add nearest headers and surrounding paragraphs
 */

import { CLEANER_CONFIG, IMAGE_POOL_CONFIG } from '../config';
import type { SourceImage } from '../types';

// Re-export for convenience
export type { SourceImage };

// ============================================================================
// Types
// ============================================================================

/**
 * URL extracted from raw content (source of truth for validation).
 */
export interface PreExtractedUrl {
  /** Original URL as found in content */
  readonly url: string;
  /** Normalized URL for fuzzy matching (lowercase, no query params) */
  readonly normalizedUrl: string;
}

/**
 * Image parsed from cleaned markdown content.
 */
export interface ParsedMarkdownImage {
  /** Image URL from markdown */
  readonly url: string;
  /** Alt text / description from markdown */
  readonly description: string;
  /** Character position in content (for ordering) */
  readonly position: number;
}

// ============================================================================
// URL Normalization
// ============================================================================

/**
 * Normalizes a URL for comparison (handles common variations).
 * - Removes query parameters and fragments
 * - Converts to lowercase
 * - Handles protocol-relative URLs
 * - Trims whitespace
 */
export function normalizeUrl(url: string): string {
  let normalized = url.trim();
  
  // Handle protocol-relative URLs
  if (normalized.startsWith('//')) {
    normalized = 'https:' + normalized;
  }
  
  // Remove query params and fragments
  normalized = normalized.split('?')[0].split('#')[0];
  
  // Lowercase for comparison
  normalized = normalized.toLowerCase();
  
  return normalized;
}

/**
 * Resolves a potentially relative URL against a base URL.
 * Returns the URL unchanged if it's already absolute or resolution fails.
 */
export function resolveUrl(url: string, baseUrl?: string): string {
  // Already absolute
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // Protocol-relative
  if (url.startsWith('//')) {
    return 'https:' + url;
  }
  
  // Skip data URLs
  if (url.startsWith('data:')) {
    return url;
  }
  
  // No base URL to resolve against
  if (!baseUrl) {
    return url;
  }
  
  // Try to resolve relative URL
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    // Resolution failed, return original
    return url;
  }
}

// ============================================================================
// Pre-Extraction: Build URL Allowlist from Raw Content
// ============================================================================

/**
 * Common image file extensions (case-insensitive).
 */
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i;

/**
 * Regex patterns for extracting image URLs from raw content.
 */
const IMAGE_URL_PATTERNS = [
  // Markdown images: ![alt](url) or ![](url)
  /!\[(?:[^\]]*)\]\(([^)]+)\)/g,
  
  // HTML img tags with src attribute (handles both single and double quotes)
  /<img[^>]+src=["']([^"']+)["'][^>]*>/gi,
  
  // HTML img tags with src attribute (no quotes, less common)
  /<img[^>]+src=([^\s>]+)[^>]*>/gi,
  
  // Lazy-loading: data-src attribute (common pattern)
  /<img[^>]+data-src=["']([^"']+)["'][^>]*>/gi,
  
  // Lazy-loading: data-lazy-src attribute
  /<img[^>]+data-lazy-src=["']([^"']+)["'][^>]*>/gi,
  
  // Lazy-loading: data-original attribute (used by some libraries)
  /<img[^>]+data-original=["']([^"']+)["'][^>]*>/gi,
  
  // Lazy-loading: data-lazy attribute (WordPress lazy load)
  /<img[^>]+data-lazy=["']([^"']+)["'][^>]*>/gi,
  
  // Responsive images: srcset (extract first URL, the smallest/default)
  /srcset=["']([^\s,"']+)/gi,
  
  // Background images in style attributes
  /url\(["']?([^"')]+)["']?\)/gi,
  
  // Plain URLs that look like images (must end with image extension)
  // Use non-capturing group for extension so match[0] is used (full URL)
  /(?:https?:)?\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|webp)/gi,
];

/**
 * Extracts all image URLs from raw content (HTML or markdown).
 * This builds the "allowlist" of valid URLs - any URL not in this list
 * is considered hallucinated and should be discarded.
 *
 * @param rawContent - Raw HTML or markdown content
 * @param sourceUrl - Optional base URL for resolving relative URLs
 * @returns Array of pre-extracted URLs with normalized versions
 */
export function extractImageUrls(rawContent: string, sourceUrl?: string): PreExtractedUrl[] {
  const urlSet = new Set<string>();
  const results: PreExtractedUrl[] = [];

  for (const pattern of IMAGE_URL_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(rawContent)) !== null) {
      // Get the captured URL (group 1 or full match for plain URLs)
      let url = match[1] || match[0];
      
      // Skip data URLs (embedded base64)
      if (url.startsWith('data:')) {
        continue;
      }
      
      // Skip very short URLs (likely invalid)
      if (url.length < 10) {
        continue;
      }
      
      // Resolve relative URLs against source URL
      url = resolveUrl(url, sourceUrl);
      
      // Skip if URL doesn't look like an image and isn't from a known image CDN
      const isImageExtension = IMAGE_EXTENSIONS.test(url);
      const isImageCdn = isKnownImageCdn(url);
      if (!isImageExtension && !isImageCdn) {
        continue;
      }
      
      const normalized = normalizeUrl(url);
      
      // Deduplicate by normalized URL
      if (!urlSet.has(normalized)) {
        urlSet.add(normalized);
        results.push({
          url,
          normalizedUrl: normalized,
        });
      }
    }
  }

  return results;
}

/**
 * Checks if URL is from a known image CDN (may not have file extension).
 */
function isKnownImageCdn(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return IMAGE_POOL_CONFIG.KNOWN_IMAGE_CDNS.some(cdn => lowerUrl.includes(cdn));
}

// ============================================================================
// Post-Extraction: Parse Markdown Images from Cleaned Content
// ============================================================================

/**
 * Regex for parsing markdown images: ![description](url)
 */
const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Parses markdown images from cleaned content.
 *
 * @param cleanedContent - Cleaned markdown content from LLM
 * @returns Array of parsed images with positions
 */
export function parseMarkdownImages(cleanedContent: string): ParsedMarkdownImage[] {
  const results: ParsedMarkdownImage[] = [];
  
  // Reset lastIndex
  MARKDOWN_IMAGE_REGEX.lastIndex = 0;
  
  let match: RegExpExecArray | null;
  while ((match = MARKDOWN_IMAGE_REGEX.exec(cleanedContent)) !== null) {
    const description = match[1].trim();
    const url = match[2].trim();
    const position = match.index;
    
    // Skip data URLs
    if (url.startsWith('data:')) {
      continue;
    }
    
    results.push({
      url,
      description: description || 'Image',
      position,
    });
  }
  
  return results;
}

// ============================================================================
// Validation: Filter Hallucinated URLs
// ============================================================================

/**
 * Validates parsed images against the pre-extracted URL allowlist.
 * Any URL not in the allowlist is considered hallucinated and discarded.
 *
 * @param parsed - Images parsed from cleaned content
 * @param allowlist - Pre-extracted URLs from raw content
 * @param sourceUrl - Optional source URL for resolving relative URLs
 * @returns Only images with valid URLs
 */
export function validateImages(
  parsed: readonly ParsedMarkdownImage[],
  allowlist: readonly PreExtractedUrl[],
  sourceUrl?: string
): ParsedMarkdownImage[] {
  // Build normalized URL set for fast lookup
  const normalizedAllowlist = new Set(
    allowlist.map(u => u.normalizedUrl)
  );
  
  return parsed.filter(img => {
    // Resolve relative URL against source URL first, then normalize
    const resolvedUrl = resolveUrl(img.url, sourceUrl);
    const normalized = normalizeUrl(resolvedUrl);
    return normalizedAllowlist.has(normalized);
  });
}

// ============================================================================
// Context Extraction: Add Headers and Surrounding Text
// ============================================================================

/**
 * Cleans up a description that looks like a filename.
 * Converts "clair-obscur-expedition-33-screenshot.jpg" to "clair obscur expedition 33 screenshot"
 *
 * @param description - Raw description (possibly a filename)
 * @returns Cleaned description
 */
export function cleanDescription(description: string): string {
  if (!description) return description;
  
  // Check if it looks like a filename (contains extension or lots of hyphens/underscores)
  const looksLikeFilename = 
    /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(description) ||
    (description.includes('-') && !description.includes(' ') && description.length > 20) ||
    (description.includes('_') && !description.includes(' ') && description.length > 20);
  
  if (!looksLikeFilename) {
    return description;
  }
  
  let cleaned = description
    // Remove file extension
    .replace(/\.(jpg|jpeg|png|webp|gif|svg)$/i, '')
    // Replace hyphens and underscores with spaces
    .replace(/[-_]+/g, ' ')
    // Remove common URL artifacts
    .replace(/\(\d+\)$/, '') // Remove trailing (1), (2) etc.
    .replace(/\?.*$/, '') // Remove query strings
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
  
  // Title case if all lowercase
  if (cleaned === cleaned.toLowerCase()) {
    cleaned = cleaned
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  
  return cleaned;
}

/**
 * Regex for finding headers (H2 and H3).
 */
const HEADER_REGEX = /^#{2,3}\s+(.+)$/gm;

/**
 * Extracts contextual information for each validated image.
 *
 * @param cleanedContent - Full cleaned content
 * @param images - Validated images
 * @returns Images with context (headers, paragraphs)
 */
export function extractImageContext(
  cleanedContent: string,
  images: readonly ParsedMarkdownImage[]
): SourceImage[] {
  // Find all headers with their positions
  const headers: Array<{ text: string; position: number }> = [];
  HEADER_REGEX.lastIndex = 0;
  
  let match: RegExpExecArray | null;
  while ((match = HEADER_REGEX.exec(cleanedContent)) !== null) {
    headers.push({
      text: match[1].trim(),
      position: match.index,
    });
  }
  
  return images.map(img => {
    // Find nearest header ABOVE the image
    const nearestHeader = findNearestHeaderAbove(headers, img.position);
    
    // Extract the paragraph containing or surrounding the image
    const contextParagraph = extractSurroundingParagraph(cleanedContent, img.position);
    
    // Clean the description if it looks like a filename
    const description = cleanDescription(img.description);
    
    return {
      url: img.url,
      description,
      nearestHeader,
      contextParagraph,
      position: img.position,
    };
  });
}

/**
 * Finds the nearest header above a given position.
 */
function findNearestHeaderAbove(
  headers: readonly { text: string; position: number }[],
  imagePosition: number
): string | undefined {
  // Find all headers before the image position
  const headersAbove = headers.filter(h => h.position < imagePosition);
  
  if (headersAbove.length === 0) {
    return undefined;
  }
  
  // Return the closest one (last in sorted list)
  return headersAbove[headersAbove.length - 1].text;
}

/**
 * Extracts the paragraph containing or surrounding an image.
 * If the image is on its own line (paragraph becomes empty after removal),
 * falls back to the previous paragraph for context.
 */
function extractSurroundingParagraph(
  content: string,
  imagePosition: number
): string | undefined {
  // Find paragraph boundaries (double newlines)
  const paragraphBreak = /\n\n+/g;
  const breaks: number[] = [0];
  
  let match: RegExpExecArray | null;
  while ((match = paragraphBreak.exec(content)) !== null) {
    breaks.push(match.index + match[0].length);
  }
  breaks.push(content.length);
  
  // Find which paragraph contains the image
  for (let i = 0; i < breaks.length - 1; i++) {
    const start = breaks[i];
    const end = breaks[i + 1];
    
    if (imagePosition >= start && imagePosition < end) {
      const paragraph = content.slice(start, end).trim();
      
      // Remove the markdown image from the paragraph for context
      const withoutImage = paragraph.replace(MARKDOWN_IMAGE_REGEX, '').trim();
      
      // If current paragraph has meaningful content after removing image, use it
      if (withoutImage.length >= 20) {
        if (withoutImage.length > 500) {
          return withoutImage.slice(0, 500) + '...';
        }
        return withoutImage;
      }
      
      // Current paragraph is empty or just the image - try previous paragraph
      if (i > 0) {
        const prevStart = breaks[i - 1];
        const prevEnd = start; // End at the start of current paragraph break
        const prevParagraph = content.slice(prevStart, prevEnd).trim();
        
        // Skip headers (start with #) and very short paragraphs
        if (prevParagraph.length >= 20 && !prevParagraph.startsWith('#')) {
          if (prevParagraph.length > 500) {
            return prevParagraph.slice(0, 500) + '...';
          }
          return prevParagraph;
        }
      }
      
      return undefined;
    }
  }
  
  return undefined;
}

// ============================================================================
// Combined Extraction Pipeline
// ============================================================================

/**
 * Result of the full image extraction pipeline.
 */
export interface ImageExtractionResult {
  /** Validated images with context */
  readonly images: readonly SourceImage[];
  /** Count of images found in raw content */
  readonly preExtractedCount: number;
  /** Count of images in cleaned content (before validation) */
  readonly parsedCount: number;
  /** Count of hallucinated images that were discarded */
  readonly discardedCount: number;
}

/**
 * Runs the complete image extraction pipeline:
 * 1. Pre-extract URLs from raw content (allowlist)
 * 2. Parse markdown images from cleaned content
 * 3. Validate against allowlist
 * 4. Extract context for each image
 *
 * @param rawContent - Original raw HTML/markdown content
 * @param cleanedContent - LLM-cleaned markdown content
 * @param sourceUrl - Optional source URL for resolving relative URLs
 * @returns Extraction result with validated images
 */
export function extractImagesFromSource(
  rawContent: string,
  cleanedContent: string,
  sourceUrl?: string
): ImageExtractionResult {
  // 1. Pre-extract URLs (allowlist) - resolve relative URLs if sourceUrl provided
  const allowlist = extractImageUrls(rawContent, sourceUrl);
  
  // 2. Parse markdown images from cleaned content
  const parsed = parseMarkdownImages(cleanedContent);
  
  // 3. Validate against allowlist (pass sourceUrl to resolve relative URLs in parsed images)
  const validated = validateImages(parsed, allowlist, sourceUrl);
  
  // 4. Resolve relative URLs in validated images to absolute URLs
  // This ensures downstream code (image downloading) gets usable URLs
  const resolvedValidated = validated.map(img => ({
    ...img,
    url: resolveUrl(img.url, sourceUrl) ?? img.url,
  }));
  
  // 5. Extract context
  const allImages = extractImageContext(cleanedContent, resolvedValidated);
  
  // 5. Apply cap to avoid bloating with too many images from a single source
  const maxImages = CLEANER_CONFIG.MAX_IMAGES_PER_SOURCE;
  const images = allImages.slice(0, maxImages);
  
  return {
    images,
    preExtractedCount: allowlist.length,
    parsedCount: parsed.length,
    discardedCount: parsed.length - validated.length,
  };
}
