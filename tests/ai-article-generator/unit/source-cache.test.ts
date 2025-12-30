/**
 * Tests for source-cache.ts
 *
 * Tests the domain exclusion and caching functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { UNIFIED_EXCLUDED_DOMAINS } from '../../../src/ai/articles/config';

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
});
