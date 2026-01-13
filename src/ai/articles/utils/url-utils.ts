/**
 * URL Utilities
 *
 * Shared URL manipulation functions used across the article generation system.
 */

/**
 * Extracts the domain from a URL, removing 'www.' prefix.
 *
 * @param url - URL to extract domain from
 * @returns Domain without www prefix, or empty string if invalid
 *
 * @example
 * extractDomain('https://www.example.com/path') // 'example.com'
 * extractDomain('https://cdn.example.com/image.jpg') // 'cdn.example.com'
 */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Normalizes a URL for deduplication and validation.
 * Removes hash fragments and validates protocol.
 *
 * @param url - URL to normalize
 * @returns Normalized URL or null if invalid/non-http(s)
 *
 * @example
 * normalizeUrl('https://example.com/page#section') // 'https://example.com/page'
 * normalizeUrl('ftp://example.com') // null
 */
export function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Checks if a URL is from a specific domain (exact match).
 *
 * @param url - URL to check
 * @param domain - Domain to match (without protocol)
 * @returns True if URL is from the specified domain
 *
 * @example
 * isFromDomain('https://images.igdb.com/image.jpg', 'images.igdb.com') // true
 * isFromDomain('https://evil.com/images.igdb.com/x', 'images.igdb.com') // false
 */
export function isFromDomain(url: string, domain: string): boolean {
  try {
    return new URL(url).hostname === domain;
  } catch {
    return false;
  }
}

/**
 * Extracts the filename from a URL for identification purposes.
 * Removes common image extensions for cleaner display.
 *
 * @param url - URL to extract filename from
 * @returns Filename without extension, or 'unknown' if extraction fails
 *
 * @example
 * extractFilenameFromUrl('https://example.com/images/abc123.jpg') // 'abc123'
 * extractFilenameFromUrl('https://images.igdb.com/igdb/image/upload/t_1080p/co1234.png') // 'co1234'
 */
export function extractFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    // Get the last segment of the path
    const segments = pathname.split('/').filter(Boolean);
    const filename = segments[segments.length - 1] || 'unknown';
    // Remove common image extensions for cleaner display
    return filename.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '');
  } catch {
    return 'unknown';
  }
}

/**
 * Normalizes an image URL for deduplication.
 * For IGDB URLs, extracts the base image ID (removes size parameters like t_1080p).
 * For other URLs, returns as-is.
 *
 * NOTE: The return format for IGDB URLs is `igdb:{imageId}` - this is intentionally
 * NOT a valid URL. It's a custom identifier used only for deduplication to ensure
 * the same IGDB image at different sizes (t_1080p, t_screenshot_big, t_cover_big)
 * is recognized as the same underlying image.
 *
 * @param url - URL to normalize for deduplication
 * @returns Normalized identifier for deduplication (may not be a valid URL for IGDB images)
 *
 * @example
 * normalizeImageUrlForDedupe('https://images.igdb.com/igdb/image/upload/t_1080p/abc123.jpg')
 * // Returns: 'igdb:abc123'
 * normalizeImageUrlForDedupe('https://images.igdb.com/igdb/image/upload/t_screenshot_big/abc123.jpg')
 * // Returns: 'igdb:abc123' (same as above - they're the same image at different sizes)
 * normalizeImageUrlForDedupe('https://example.com/image.jpg')
 * // Returns: 'https://example.com/image.jpg' (non-IGDB URLs returned as-is)
 */
export function normalizeImageUrlForDedupe(
  url: string,
  options?: { logger?: { warn: (msg: string) => void } }
): string {
  try {
    const parsed = new URL(url);

    // Check if it's an IGDB URL
    if (parsed.hostname === 'images.igdb.com') {
      // IGDB URLs are like: /igdb/image/upload/t_1080p/abc123.jpg
      // Extract just the image ID (abc123)
      const match = parsed.pathname.match(/\/t_[^/]+\/([^/]+?)(?:\.[a-z]+)?$/i);
      if (match) {
        return `igdb:${match[1]}`;
      }
      // IGDB URL but doesn't match expected pattern - log warning for debugging
      // This could indicate IGDB changed their URL format
      options?.logger?.warn(
        `[url-utils] IGDB URL doesn't match expected pattern, using full URL for dedup: ${url}`
      );
    }

    // For non-IGDB URLs, use the full URL as-is
    return url;
  } catch {
    return url;
  }
}
