import { describe, it, expect, vi } from 'vitest';
import { withRetry, isRetryableError, RETRY_CONFIG } from '../../../src/ai/articles/retry';

describe('isRetryableError', () => {
  it('returns true for rate limit errors', () => {
    expect(isRetryableError(new Error('Rate limit exceeded'))).toBe(true);
    expect(isRetryableError(new Error('Too many requests'))).toBe(true);
    expect(isRetryableError(new Error('429 error'))).toBe(true);
  });

  it('returns true for network errors', () => {
    expect(isRetryableError(new Error('Network error'))).toBe(true);
    expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
    expect(isRetryableError(new Error('socket hang up'))).toBe(true);
  });

  it('returns true for server errors', () => {
    expect(isRetryableError(new Error('500 Internal Server Error'))).toBe(true);
    expect(isRetryableError(new Error('503 Service Unavailable'))).toBe(true);
    expect(isRetryableError(new Error('Bad gateway error'))).toBe(true);
  });

  it('returns true for overload errors', () => {
    expect(isRetryableError(new Error('Server overloaded'))).toBe(true);
    expect(isRetryableError(new Error('At capacity'))).toBe(true);
    expect(isRetryableError(new Error('Temporarily unavailable'))).toBe(true);
  });

  it('returns false for non-retryable errors', () => {
    expect(isRetryableError(new Error('Invalid input'))).toBe(false);
    expect(isRetryableError(new Error('Validation failed'))).toBe(false);
    expect(isRetryableError(new Error('Authentication error'))).toBe(false);
  });

  it('handles errors with status property', () => {
    const rateLimitError = Object.assign(new Error('rate limited'), { status: 429 });
    const serverError = Object.assign(new Error('server error'), { status: 500 });
    const clientError = Object.assign(new Error('bad request'), { status: 400 });

    expect(isRetryableError(rateLimitError)).toBe(true);
    expect(isRetryableError(serverError)).toBe(true);
    expect(isRetryableError(clientError)).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns result on first successful call', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const result = await withRetry(fn, { maxRetries: 3 });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Rate limit'))
      .mockResolvedValueOnce('success');

    const result = await withRetry(fn, {
      maxRetries: 3,
      initialDelayMs: 10, // Fast for testing
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws immediately for non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Invalid input'));

    await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow('Invalid input');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after max retries are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Rate limit'));

    await expect(
      withRetry(fn, {
        maxRetries: 2,
        initialDelayMs: 10,
      })
    ).rejects.toThrow('Rate limit');

    // Initial attempt + 2 retries = 3 total calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects custom shouldRetry function', async () => {
    const customError = new Error('Custom retryable error');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(customError)
      .mockResolvedValueOnce('success');

    const result = await withRetry(fn, {
      maxRetries: 3,
      initialDelayMs: 10,
      shouldRetry: (error) => error instanceof Error && error.message.includes('Custom'),
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('uses default config values', () => {
    expect(RETRY_CONFIG.MAX_RETRIES).toBe(3);
    expect(RETRY_CONFIG.INITIAL_DELAY_MS).toBe(1000);
    expect(RETRY_CONFIG.MAX_DELAY_MS).toBe(10000);
    expect(RETRY_CONFIG.BACKOFF_MULTIPLIER).toBe(2);
  });
});

