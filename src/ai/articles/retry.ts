/**
 * Retry Utilities
 *
 * Provides retry logic with exponential backoff for transient failures
 * in LLM API calls and search operations.
 */

import { createPrefixedLogger } from '../../utils/logger';
import { RETRY_CONFIG } from './config';

// Re-export config for backwards compatibility
export { RETRY_CONFIG } from './config';

// ============================================================================
// Types
// ============================================================================

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  readonly maxRetries?: number;
  /** Initial delay in ms before first retry (default: 1000) */
  readonly initialDelayMs?: number;
  /** Maximum delay in ms between retries (default: 10000) */
  readonly maxDelayMs?: number;
  /** Context for logging (e.g., "Scout search" or "Editor generateText") */
  readonly context?: string;
  /** Custom function to determine if an error is retryable (default: isRetryableError) */
  readonly shouldRetry?: (error: unknown) => boolean;
  /** Optional AbortSignal to cancel the operation */
  readonly signal?: AbortSignal;
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Known transient error patterns that should trigger a retry.
 */
const RETRYABLE_ERROR_PATTERNS = [
  // Rate limiting
  /rate.?limit/i,
  /too.?many.?requests/i,
  /429/,
  // Network issues
  /network/i,
  /fetch.*fail/i,  // Network fetch failures (TypeError: fetch failed)
  /ETIMEDOUT/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /socket.?hang.?up/i,
  // Server errors (5xx)
  /5\d{2}/,
  /internal.?server.?error/i,
  /service.?unavailable/i,
  /bad.?gateway/i,
  // OpenRouter/LLM specific
  /overloaded/i,
  /capacity/i,
  /temporarily/i,
  // LLM schema/parsing errors - can succeed on retry since LLM output is non-deterministic
  /did not match schema/i,
  /could not parse/i,
  /no object generated/i,
  /failed to parse/i,
  /invalid json/i,
];

/**
 * Determines if an error is likely transient and worth retrying.
 *
 * @param error - The error to check
 * @returns true if the error appears to be transient
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  // Explicitly exclude timeout errors - they indicate timeout was too short, not a transient failure
  // Retrying timeouts wastes money (request likely succeeded, just took too long)
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);

  // Check against known retryable patterns
  for (const pattern of RETRYABLE_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return true;
    }
  }

  // Check for HTTP status codes in the error
  if (error instanceof Error && 'status' in error) {
    const status = (error as { status?: number }).status;
    // Retry on 429 (rate limit) and 5xx (server errors)
    if (status === 429 || (status && status >= 500 && status < 600)) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Calculates delay for exponential backoff with jitter.
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number
): number {
  // Exponential backoff: delay = initial * 2^attempt
  const exponentialDelay = initialDelayMs * Math.pow(RETRY_CONFIG.BACKOFF_MULTIPLIER, attempt);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter (±25%) to prevent thundering herd
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);

  return Math.round(cappedDelay + jitter);
}

/**
 * Sleeps for the specified duration.
 *
 * @param ms - Duration to sleep in milliseconds
 * @returns Promise that resolves after the specified duration
 *
 * @example
 * await sleep(1000); // Wait 1 second
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes an async function with retry logic and exponential backoff.
 *
 * Only retries on transient errors (rate limits, network issues, server errors).
 * Validation errors and other non-transient errors fail immediately.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns The result of the function
 * @throws The last error if all retries fail, or immediately for non-retryable errors
 *
 * @example
 * const result = await withRetry(
 *   () => generateText({ model, prompt }),
 *   { context: 'Scout briefing generation', maxRetries: 3 }
 * );
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = RETRY_CONFIG.MAX_RETRIES,
    initialDelayMs = RETRY_CONFIG.INITIAL_DELAY_MS,
    maxDelayMs = RETRY_CONFIG.MAX_DELAY_MS,
    context = 'operation',
    shouldRetry = isRetryableError,
    signal,
  } = options;

  const log = createPrefixedLogger('[Retry]');
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check for abort before each attempt
    if (signal?.aborted) {
      throw new Error(`${context} was cancelled`);
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check for abort after operation failure
      if (signal?.aborted) {
        throw new Error(`${context} was cancelled`);
      }

      // Don't retry non-transient errors
      if (!shouldRetry(error)) {
        throw error;
      }

      // Don't retry after max attempts
      if (attempt >= maxRetries) {
        log.warn(
          `${context} failed after ${maxRetries + 1} attempts: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }

      // Calculate delay and wait
      const delay = calculateDelay(attempt, initialDelayMs, maxDelayMs);
      log.info(
        `${context} failed (attempt ${attempt + 1}/${maxRetries + 1}), ` +
          `retrying in ${delay}ms: ${error instanceof Error ? error.message : String(error)}`
      );
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError;
}

/**
 * Creates a wrapped version of a function that automatically retries on transient errors.
 *
 * @param fn - The function to wrap
 * @param options - Retry configuration options
 * @returns A wrapped function with retry logic
 *
 * @example
 * const searchWithRetry = createRetryWrapper(
 *   search,
 *   { context: 'Tavily search' }
 * );
 */
export function createRetryWrapper<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {}
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => fn(...args), options);
}

