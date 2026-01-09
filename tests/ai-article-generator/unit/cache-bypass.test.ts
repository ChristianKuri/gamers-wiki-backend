/**
 * Tests for cache bypass functionality in research-pool.ts
 *
 * When CLEANER_CONFIG.CACHE_ENABLED is false, the system should:
 * 1. Treat cache hits as misses (bypass cache reads)
 * 2. Still respect excluded domains (don't clean them)
 * 3. Still respect scrape failures (don't re-attempt them)
 * 4. Attach raw content to bypassed cache hits so they can be re-cleaned
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  shouldBypassCacheResult,
  type CacheBypassCheckResult,
} from '../../../src/ai/articles/research-pool';
import type { RawSourceInput } from '../../../src/ai/articles/types';

describe('cache-bypass', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('shouldBypassCacheResult', () => {
    // Helper to create a minimal RawSourceInput
    function createRawSource(url: string, content: string): RawSourceInput {
      return { url, content };
    }

    it('should treat cache hits as misses when cache is disabled', () => {
      const cacheResult = {
        url: 'https://example.com/article',
        hit: true,
        cached: { scrapeSucceeded: true },
      };
      const rawSources: readonly RawSourceInput[] = [
        createRawSource('https://example.com/article', 'Long enough content for cleaning...'),
      ];

      const result = shouldBypassCacheResult(
        cacheResult,
        rawSources,
        new Set(), // excludedDomainsSet
        false, // cacheEnabled = false
        new Set(), // scrapeFailureRetryUrls
        new Set() // needsReprocessingUrls
      );

      expect(result.shouldBypass).toBe(true);
      expect(result.rawSource).toBeDefined();
      expect(result.reason).toBe('cache_disabled');
    });

    it('should NOT treat cache hits as misses when cache is enabled', () => {
      const cacheResult = {
        url: 'https://example.com/article',
        hit: true,
        cached: { scrapeSucceeded: true },
      };
      const rawSources: readonly RawSourceInput[] = [
        createRawSource('https://example.com/article', 'Long enough content...'),
      ];

      const result = shouldBypassCacheResult(
        cacheResult,
        rawSources,
        new Set(),
        true, // cacheEnabled = true
        new Set(),
        new Set()
      );

      expect(result.shouldBypass).toBe(false);
      expect(result.reason).toBe('use_cache');
    });

    it('should always bypass for cache misses (not in cache)', () => {
      const cacheResult = {
        url: 'https://example.com/article',
        hit: false,
        cached: null,
      };
      const rawSources: readonly RawSourceInput[] = [];

      const result = shouldBypassCacheResult(
        cacheResult,
        rawSources,
        new Set(),
        true, // cache enabled
        new Set(),
        new Set()
      );

      expect(result.shouldBypass).toBe(true);
      expect(result.reason).toBe('not_cache_hit');
    });

    it('should still filter excluded domains even when cache is disabled', () => {
      const cacheResult = {
        url: 'https://youtube.com/video',
        hit: true,
        cached: { scrapeSucceeded: true },
      };
      const rawSources: readonly RawSourceInput[] = [
        createRawSource('https://youtube.com/video', 'Long enough content...'),
      ];

      const result = shouldBypassCacheResult(
        cacheResult,
        rawSources,
        new Set(['youtube.com']), // excluded domain
        false, // cacheEnabled = false
        new Set(),
        new Set()
      );

      expect(result.shouldBypass).toBe(false);
      expect(result.reason).toBe('excluded_domain');
    });

    it('should NOT bypass scrape failures with insufficient content even when cache is disabled', () => {
      const cacheResult = {
        url: 'https://broken-site.com/article',
        hit: true,
        cached: { scrapeSucceeded: false },
      };
      const rawSources: readonly RawSourceInput[] = [
        createRawSource('https://broken-site.com/article', 'Short'), // Still short content
      ];

      const result = shouldBypassCacheResult(
        cacheResult,
        rawSources,
        new Set(),
        false, // cacheEnabled = false
        new Set(),
        new Set()
      );

      expect(result.shouldBypass).toBe(false);
      expect(result.reason).toBe('scrape_failure_retry');
    });

    it('should attach raw content to bypassed cache hits', () => {
      const cacheResult = {
        url: 'https://example.com/article',
        hit: true,
        cached: { scrapeSucceeded: true },
      };
      const rawSources: readonly RawSourceInput[] = [
        createRawSource(
          'https://example.com/article',
          'This is the raw content that needs to be attached for re-cleaning.'
        ),
      ];

      const result = shouldBypassCacheResult(
        cacheResult,
        rawSources,
        new Set(),
        false,
        new Set(),
        new Set()
      );

      expect(result.shouldBypass).toBe(true);
      expect(result.rawSource).toBeDefined();
      expect(result.rawSource?.url).toBe('https://example.com/article');
    });

    it('should NOT treat as miss if raw content not available', () => {
      const cacheResult = {
        url: 'https://example.com/article',
        hit: true,
        cached: { scrapeSucceeded: true },
      };
      const rawSources: readonly RawSourceInput[] = []; // No raw sources

      const result = shouldBypassCacheResult(
        cacheResult,
        rawSources,
        new Set(),
        false,
        new Set(),
        new Set()
      );

      expect(result.shouldBypass).toBe(false);
      expect(result.reason).toBe('no_raw_content');
    });

    it('should retry scrape failures when raw content is now available', () => {
      const cacheResult = {
        url: 'https://example.com/article',
        hit: true,
        cached: { scrapeSucceeded: false },
      };
      const rawSources: readonly RawSourceInput[] = [
        createRawSource(
          'https://example.com/article',
          'Now we have long enough content to retry cleaning...'
        ),
      ];

      const result = shouldBypassCacheResult(
        cacheResult,
        rawSources,
        new Set(),
        true, // cache enabled
        new Set(['https://example.com/article']), // marked for scrape failure retry
        new Set()
      );

      expect(result.shouldBypass).toBe(true);
      expect(result.rawSource).toBeDefined();
      expect(result.reason).toBe('scrape_failure_retry');
    });

    it('should retry legacy records needing reprocessing', () => {
      const cacheResult = {
        url: 'https://example.com/article',
        hit: true,
        cached: { scrapeSucceeded: true },
      };
      const rawSources: readonly RawSourceInput[] = [
        createRawSource('https://example.com/article', 'Content for legacy reprocessing...'),
      ];

      const result = shouldBypassCacheResult(
        cacheResult,
        rawSources,
        new Set(),
        true, // cache enabled
        new Set(),
        new Set(['https://example.com/article']) // marked for reprocessing
      );

      expect(result.shouldBypass).toBe(true);
      expect(result.rawSource).toBeDefined();
      expect(result.reason).toBe('legacy_reprocessing');
    });

    it('should match URLs with hash fragments stripped (normalizeUrl behavior)', () => {
      // Note: normalizeUrl in research-pool.ts only removes hash fragments,
      // it does NOT remove query params or lowercase the path.
      // Hostname is lowercased by the URL API automatically.
      const cacheResult = {
        url: 'https://Example.COM/article#section-1',
        hit: true,
        cached: { scrapeSucceeded: true },
      };
      const rawSources: readonly RawSourceInput[] = [
        createRawSource('https://example.com/article', 'Long enough content for normalization test...'),
      ];

      const result = shouldBypassCacheResult(
        cacheResult,
        rawSources,
        new Set(),
        false, // cacheEnabled = false
        new Set(),
        new Set()
      );

      expect(result.shouldBypass).toBe(true);
      expect(result.rawSource).toBeDefined();
      expect(result.reason).toBe('cache_disabled');
    });

    it('should NOT bypass scrape failure retry when rawSource is missing', () => {
      const cacheResult = {
        url: 'https://example.com/article',
        hit: true,
        cached: { scrapeSucceeded: false },
      };
      const rawSources: readonly RawSourceInput[] = []; // No matching raw source

      const result = shouldBypassCacheResult(
        cacheResult,
        rawSources,
        new Set(),
        true, // cache enabled
        new Set(['https://example.com/article']), // URL marked for retry
        new Set()
      );

      expect(result.shouldBypass).toBe(false);
      expect(result.reason).toBe('use_cache');
    });

    it('should NOT bypass legacy reprocessing when rawSource is missing', () => {
      const cacheResult = {
        url: 'https://example.com/article',
        hit: true,
        cached: { scrapeSucceeded: true },
      };
      const rawSources: readonly RawSourceInput[] = []; // No matching raw source

      const result = shouldBypassCacheResult(
        cacheResult,
        rawSources,
        new Set(),
        true, // cache enabled
        new Set(),
        new Set(['https://example.com/article']) // URL marked for reprocessing
      );

      expect(result.shouldBypass).toBe(false);
      expect(result.reason).toBe('use_cache');
    });
  });
});
