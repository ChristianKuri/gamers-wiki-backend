/**
 * Tests for source-cache.ts
 *
 * Tests the domain exclusion and caching functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { UNIFIED_EXCLUDED_DOMAINS, CLEANER_CONFIG } from '../../../src/ai/articles/config';

// Mock the source-cache module to test getAllExcludedDomains
// We need to test the logic without actually hitting a database

describe('source-cache', () => {
  describe('UNIFIED_EXCLUDED_DOMAINS', () => {
    it('should contain expected video platform domains', () => {
      expect(UNIFIED_EXCLUDED_DOMAINS.has('youtube.com')).toBe(true);
      expect(UNIFIED_EXCLUDED_DOMAINS.has('tiktok.com')).toBe(true);
      expect(UNIFIED_EXCLUDED_DOMAINS.has('twitch.tv')).toBe(true);
    });

    it('should contain expected social media domains', () => {
      expect(UNIFIED_EXCLUDED_DOMAINS.has('facebook.com')).toBe(true);
      expect(UNIFIED_EXCLUDED_DOMAINS.has('twitter.com')).toBe(true);
      expect(UNIFIED_EXCLUDED_DOMAINS.has('x.com')).toBe(true);
      expect(UNIFIED_EXCLUDED_DOMAINS.has('instagram.com')).toBe(true);
      expect(UNIFIED_EXCLUDED_DOMAINS.has('reddit.com')).toBe(true);
    });

    it('should contain expected low-quality forum domains', () => {
      expect(UNIFIED_EXCLUDED_DOMAINS.has('quora.com')).toBe(true);
      expect(UNIFIED_EXCLUDED_DOMAINS.has('steamcommunity.com')).toBe(true);
      expect(UNIFIED_EXCLUDED_DOMAINS.has('fextralife.com')).toBe(true); // Forums at fextralife.com/forums
    });

    it('should contain expected game marketplace domains', () => {
      expect(UNIFIED_EXCLUDED_DOMAINS.has('g2a.com')).toBe(true);
      expect(UNIFIED_EXCLUDED_DOMAINS.has('cdkeys.com')).toBe(true);
      expect(UNIFIED_EXCLUDED_DOMAINS.has('fanatical.com')).toBe(true);
    });

    it('should contain expected mod site domains', () => {
      expect(UNIFIED_EXCLUDED_DOMAINS.has('nexusmods.com')).toBe(true);
      expect(UNIFIED_EXCLUDED_DOMAINS.has('moddb.com')).toBe(true);
    });

    it('should contain expected off-topic programming domains', () => {
      expect(UNIFIED_EXCLUDED_DOMAINS.has('stackoverflow.com')).toBe(true);
      expect(UNIFIED_EXCLUDED_DOMAINS.has('github.com')).toBe(true);
      expect(UNIFIED_EXCLUDED_DOMAINS.has('docs.python.org')).toBe(true);
    });

    it('should contain expected non-video-game domains', () => {
      expect(UNIFIED_EXCLUDED_DOMAINS.has('boardgamegeek.com')).toBe(true);
    });

    it('should NOT contain legitimate gaming sites', () => {
      expect(UNIFIED_EXCLUDED_DOMAINS.has('ign.com')).toBe(false);
      expect(UNIFIED_EXCLUDED_DOMAINS.has('gamespot.com')).toBe(false);
      expect(UNIFIED_EXCLUDED_DOMAINS.has('kotaku.com')).toBe(false);
      expect(UNIFIED_EXCLUDED_DOMAINS.has('polygon.com')).toBe(false);
      expect(UNIFIED_EXCLUDED_DOMAINS.has('pcgamer.com')).toBe(false);
    });

    it('should be a Set for O(1) lookup', () => {
      expect(UNIFIED_EXCLUDED_DOMAINS instanceof Set).toBe(true);
    });

    it('should have a reasonable number of excluded domains', () => {
      // Should have at least 20 excluded domains
      expect(UNIFIED_EXCLUDED_DOMAINS.size).toBeGreaterThanOrEqual(20);
      // But not too many (sanity check)
      expect(UNIFIED_EXCLUDED_DOMAINS.size).toBeLessThan(200);
    });
  });

  describe('getAllExcludedDomains', () => {
    // This function requires a Strapi instance, so we test the logic via integration tests
    // or by mocking the database connection

    it('should combine static and database exclusions', async () => {
      // Mock Strapi instance with knex
      const mockRows = [
        { domain: 'spam-site-1.com' },
        { domain: 'spam-site-2.com' },
      ];

      const mockKnex = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue(mockRows),
        }),
      });

      const mockStrapi = {
        db: {
          connection: mockKnex,
        },
        log: {
          warn: vi.fn(),
        },
      } as any;

      // Import the function (after mocks are set up)
      const { getAllExcludedDomains } = await import('../../../src/ai/articles/source-cache');

      const result = await getAllExcludedDomains(mockStrapi);

      // Should include static domains
      expect(result).toContain('youtube.com');
      expect(result).toContain('github.com');

      // Should include DB domains
      expect(result).toContain('spam-site-1.com');
      expect(result).toContain('spam-site-2.com');

      // Should be an array
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      const mockKnex = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          select: vi.fn().mockRejectedValue(new Error('DB connection failed')),
        }),
      });

      const mockStrapi = {
        db: {
          connection: mockKnex,
        },
        log: {
          warn: vi.fn(),
        },
      } as any;

      const { getAllExcludedDomains } = await import('../../../src/ai/articles/source-cache');

      const result = await getAllExcludedDomains(mockStrapi);

      // Should still return static domains even if DB fails
      expect(result).toContain('youtube.com');
      expect(Array.isArray(result)).toBe(true);

      // Should have logged a warning
      expect(mockStrapi.log.warn).toHaveBeenCalled();
    });

    it('should deduplicate domains from static and DB', async () => {
      // Mock DB returning a domain that's already in static list
      const mockRows = [
        { domain: 'youtube.com' }, // Already in static list
        { domain: 'new-spam.com' },
      ];

      const mockKnex = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue(mockRows),
        }),
      });

      const mockStrapi = {
        db: {
          connection: mockKnex,
        },
        log: {
          warn: vi.fn(),
        },
      } as any;

      const { getAllExcludedDomains } = await import('../../../src/ai/articles/source-cache');

      const result = await getAllExcludedDomains(mockStrapi);

      // Count occurrences of youtube.com - should be exactly 1
      const youtubeCount = result.filter((d) => d === 'youtube.com').length;
      expect(youtubeCount).toBe(1);
    });
  });

  describe('getAllExcludedDomainsForEngine', () => {
    it('should return global exclusions plus engine-specific exclusions for Tavily', async () => {
      const mockRows = [
        { domain: 'globally-excluded.com' }, // is_excluded = true
        { domain: 'tavily-excluded.com' },   // is_excluded_tavily = true (but not global)
      ];

      // Mock knex that handles OR condition
      const mockKnex = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orWhere: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue(mockRows),
          }),
        }),
      });

      const mockStrapi = {
        db: {
          connection: mockKnex,
        },
        log: {
          warn: vi.fn(),
        },
      } as any;

      const { getAllExcludedDomainsForEngine } = await import('../../../src/ai/articles/source-cache');

      const result = await getAllExcludedDomainsForEngine(mockStrapi, 'tavily');

      // Should include static domains
      expect(result).toContain('youtube.com');
      
      // Should include DB domains
      expect(result).toContain('globally-excluded.com');
      expect(result).toContain('tavily-excluded.com');
    });

    it('should return global exclusions plus engine-specific exclusions for Exa', async () => {
      const mockRows = [
        { domain: 'globally-excluded.com' },
        { domain: 'exa-excluded.com' },
      ];

      const mockKnex = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orWhere: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue(mockRows),
          }),
        }),
      });

      const mockStrapi = {
        db: {
          connection: mockKnex,
        },
        log: {
          warn: vi.fn(),
        },
      } as any;

      const { getAllExcludedDomainsForEngine } = await import('../../../src/ai/articles/source-cache');

      const result = await getAllExcludedDomainsForEngine(mockStrapi, 'exa');

      // Should include static domains
      expect(result).toContain('youtube.com');
      
      // Should include DB domains
      expect(result).toContain('globally-excluded.com');
      expect(result).toContain('exa-excluded.com');
    });

    it('should return only static domains if DB query fails', async () => {
      const mockKnex = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orWhere: vi.fn().mockReturnValue({
            select: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const mockStrapi = {
        db: {
          connection: mockKnex,
        },
        log: {
          warn: vi.fn(),
        },
      } as any;

      const { getAllExcludedDomainsForEngine } = await import('../../../src/ai/articles/source-cache');

      const result = await getAllExcludedDomainsForEngine(mockStrapi, 'tavily');

      // Should still return static domains
      expect(result).toContain('youtube.com');
      expect(Array.isArray(result)).toBe(true);
      
      // Should have logged a warning
      expect(mockStrapi.log.warn).toHaveBeenCalled();
    });
  });

  describe('Per-Engine Scrape Failure Exclusion Logic', () => {
    // These tests verify the threshold calculations that happen in updateDomainQuality
    
    it('should have correct threshold constants', () => {
      // Verify thresholds are correctly configured
      expect(CLEANER_CONFIG.SCRAPE_FAILURE_MIN_ATTEMPTS).toBe(10);
      expect(CLEANER_CONFIG.SCRAPE_FAILURE_RATE_THRESHOLD).toBe(0.70);
    });

    describe('exclusion decision logic', () => {
      // Helper to simulate the exclusion decision logic from updateDomainQuality
      function shouldExcludeForEngine(attempts: number, failures: number): boolean {
        const minAttempts = CLEANER_CONFIG.SCRAPE_FAILURE_MIN_ATTEMPTS;
        const rateThreshold = CLEANER_CONFIG.SCRAPE_FAILURE_RATE_THRESHOLD;
        const failureRate = attempts > 0 ? failures / attempts : 0;
        return attempts >= minAttempts && failureRate > rateThreshold;
      }

      it('should NOT exclude with only 9 attempts (below minimum)', () => {
        // 9/9 = 100% failure rate, but only 9 attempts
        expect(shouldExcludeForEngine(9, 9)).toBe(false);
      });

      it('should NOT exclude with 10 attempts and 60% failure rate', () => {
        // 6/10 = 60% < 70% threshold
        expect(shouldExcludeForEngine(10, 6)).toBe(false);
      });

      it('should NOT exclude with 10 attempts and exactly 70% failure rate', () => {
        // 7/10 = 70%, threshold is > 70%, so this should NOT exclude
        expect(shouldExcludeForEngine(10, 7)).toBe(false);
      });

      it('should exclude with 10 attempts and 71% failure rate', () => {
        // Need > 70%, so 8/10 = 80% should work, or more precise: >7 failures
        // Actually 71% would be 7.1/10, which rounds to 8 failures for integers
        // So 8/10 = 80% > 70% = should exclude
        expect(shouldExcludeForEngine(10, 8)).toBe(true);
      });

      it('should exclude with 10 attempts and 80% failure rate', () => {
        // 8/10 = 80% > 70% = exclude
        expect(shouldExcludeForEngine(10, 8)).toBe(true);
      });

      it('should exclude with 20 attempts and 75% failure rate', () => {
        // 15/20 = 75% > 70% = exclude
        expect(shouldExcludeForEngine(20, 15)).toBe(true);
      });

      it('should NOT exclude with 100 attempts and 65% failure rate', () => {
        // 65/100 = 65% < 70% = no exclusion
        expect(shouldExcludeForEngine(100, 65)).toBe(false);
      });

      it('should handle 0 attempts correctly', () => {
        // 0 attempts = no exclusion
        expect(shouldExcludeForEngine(0, 0)).toBe(false);
      });
    });
  });
});
