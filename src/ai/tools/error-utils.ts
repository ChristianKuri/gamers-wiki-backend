/**
 * Shared error handling utilities for API tools (Tavily, Exa, etc.)
 *
 * Provides consistent error categorization and logging for fetch operations.
 */

/**
 * Type of fetch error that occurred.
 * - 'timeout': Request was aborted due to timeout
 * - 'network': Network-level failure (connection reset, DNS, etc.)
 * - 'other': Any other error type
 */
export type FetchErrorType = 'timeout' | 'network' | 'other';

export interface LogFetchErrorOptions {
  /** The caught error */
  readonly err: unknown;
  /** The query or URL that was being fetched */
  readonly context: string;
  /** The timeout value in milliseconds */
  readonly timeoutMs: number;
  /** Optional prefix for log messages (e.g., '[FindSimilar]') */
  readonly prefix?: string;
  /** Label for the context (defaults to 'query') */
  readonly contextLabel?: 'query' | 'URL';
  /** Logger warn function */
  readonly warn: (message: string) => void;
}

/**
 * Detects if an error is a timeout/abort error.
 * Checks both the error name (AbortError from AbortController) and message patterns.
 */
function isTimeoutError(error: Error): boolean {
  const errName = error.name.toLowerCase();
  const errMsg = error.message.toLowerCase();

  return (
    errName === 'aborterror' ||
    errMsg.includes('abort') ||
    errMsg.includes('timeout')
  );
}

/**
 * Detects if an error is a network-level error.
 * Covers common Node.js network error codes.
 */
function isNetworkError(error: Error): boolean {
  const errMsg = error.message.toLowerCase();

  return (
    errMsg.includes('fetch failed') ||
    errMsg.includes('econnreset') ||
    errMsg.includes('econnrefused') ||
    errMsg.includes('enotfound') ||
    errMsg.includes('etimedout') ||
    errMsg.includes('enetunreach')
  );
}

/**
 * Categorizes and logs a fetch error with consistent formatting.
 *
 * Detects timeout and network errors:
 * - Timeout: AbortError name, or message containing 'abort'/'timeout'
 * - Network: Common Node.js errors (ECONNRESET, ECONNREFUSED, ENOTFOUND, etc.)
 *
 * @returns The type of error that was logged (useful for metrics or conditional retry logic)
 *
 * @example
 * ```ts
 * catch (err) {
 *   logFetchError({
 *     err,
 *     context: query,
 *     timeoutMs,
 *     warn: log.warn,
 *   });
 *   return { query, results: [] };
 * }
 * ```
 */
export function logFetchError(options: LogFetchErrorOptions): FetchErrorType {
  const { err, context, timeoutMs, prefix = '', contextLabel = 'query', warn } = options;

  // Normalize to Error object for consistent property access
  const error = err instanceof Error ? err : new Error(String(err));

  const truncatedContext = context.slice(0, 60) + (context.length > 60 ? '...' : '');
  const pfx = prefix ? `${prefix} ` : '';

  if (isTimeoutError(error)) {
    warn(`${pfx}Timeout (${timeoutMs}ms) for ${contextLabel}: "${truncatedContext}"`);
    return 'timeout';
  }

  if (isNetworkError(error)) {
    warn(`${pfx}Network error for ${contextLabel}: "${truncatedContext}" - ${error.message}`);
    return 'network';
  }

  warn(`${pfx}Error for ${contextLabel}: "${truncatedContext}" - ${error.message}`);
  return 'other';
}
