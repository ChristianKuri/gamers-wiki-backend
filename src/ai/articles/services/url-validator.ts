/**
 * URL Validator for SSRF Protection
 *
 * Validates image URLs before downloading to prevent Server-Side Request Forgery attacks.
 * Blocks access to:
 * - Localhost and loopback addresses
 * - Private IP ranges (10.x.x.x, 192.168.x.x, 172.16-31.x.x)
 * - Link-local addresses (169.254.x.x)
 * - Cloud metadata services (169.254.169.254)
 * - Non-HTTPS URLs (except trusted domains)
 */

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when a URL fails SSRF validation.
 */
export class SSRFError extends Error {
  readonly name = 'SSRFError';

  constructor(message: string) {
    super(message);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SSRFError);
    }
  }
}

// ============================================================================
// Constants
// ============================================================================

/** Trusted domains that can use HTTP (all others require HTTPS) */
const TRUSTED_HTTP_DOMAINS = new Set([
  'images.igdb.com',
]);

// ============================================================================
// Validation
// ============================================================================

/**
 * Checks if a hostname is a private/internal IP address.
 */
function isPrivateIP(hostname: string): { isPrivate: boolean; reason?: string } {
  // Check for IPv4 address pattern
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, aStr, bStr] = ipv4Match;
    const a = parseInt(aStr, 10);
    const b = parseInt(bStr, 10);

    // 10.0.0.0/8 - Private
    if (a === 10) {
      return { isPrivate: true, reason: 'Private IP range (10.x.x.x)' };
    }

    // 172.16.0.0/12 - Private
    if (a === 172 && b >= 16 && b <= 31) {
      return { isPrivate: true, reason: 'Private IP range (172.16-31.x.x)' };
    }

    // 192.168.0.0/16 - Private
    if (a === 192 && b === 168) {
      return { isPrivate: true, reason: 'Private IP range (192.168.x.x)' };
    }

    // 169.254.0.0/16 - Link-local
    if (a === 169 && b === 254) {
      return { isPrivate: true, reason: 'Link-local IP range (169.254.x.x)' };
    }

    // 127.0.0.0/8 - Loopback
    if (a === 127) {
      return { isPrivate: true, reason: 'Loopback IP range (127.x.x.x)' };
    }

    // 0.0.0.0/8 - Current network
    if (a === 0) {
      return { isPrivate: true, reason: 'Current network (0.x.x.x)' };
    }
  }

  return { isPrivate: false };
}

/**
 * Validates an image URL for SSRF vulnerabilities.
 *
 * @param url - The URL to validate
 * @throws SSRFError if the URL is potentially malicious
 */
export function validateImageUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SSRFError('Invalid URL format');
  }

  const hostname = parsed.hostname.toLowerCase();
  const protocol = parsed.protocol;

  // Only allow HTTP(S)
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new SSRFError(`Protocol not allowed: ${protocol}`);
  }

  // Block localhost variations
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    throw new SSRFError('Localhost URLs are not allowed');
  }

  // Block private IP ranges
  const privateCheck = isPrivateIP(hostname);
  if (privateCheck.isPrivate) {
    throw new SSRFError(privateCheck.reason ?? 'Private IP not allowed');
  }

  // Block cloud metadata services (AWS, GCP, Azure)
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    throw new SSRFError('Cloud metadata service access blocked');
  }

  // Require HTTPS for non-trusted domains
  if (protocol === 'http:') {
    const isTrusted = TRUSTED_HTTP_DOMAINS.has(hostname);
    if (!isTrusted) {
      throw new SSRFError('Only HTTPS URLs are allowed for untrusted domains');
    }
  }
}

/**
 * Type guard to check if an error is an SSRFError.
 */
export function isSSRFError(error: unknown): error is SSRFError {
  return error instanceof SSRFError;
}
