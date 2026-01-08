/**
 * Image Pool Tests
 *
 * Tests for image collection and aggregation.
 */

import { describe, it, expect } from 'vitest';
import {
  createEmptyImagePool,
  addIGDBImages,
  addWebImages,
  addExaImages,
  mergeImagePools,
  getImagesByPriority,
  getBestHeroImage,
  getImagesForSection,
  getPoolSummary,
} from '../../../src/ai/articles/image-pool';

describe('ImagePool', () => {
  describe('createEmptyImagePool', () => {
    it('should create an empty pool', () => {
      const pool = createEmptyImagePool();
      
      expect(pool.images).toEqual([]);
      expect(pool.igdbImages).toEqual([]);
      expect(pool.webImages).toEqual([]);
      expect(pool.count).toBe(0);
      expect(pool.seenUrls.size).toBe(0);
    });
  });

  describe('addIGDBImages', () => {
    it('should add IGDB screenshots to pool', () => {
      const pool = createEmptyImagePool();
      const screenshots = [
        'https://images.igdb.com/igdb/image/upload/t_screenshot_big/abc123.jpg',
        'https://images.igdb.com/igdb/image/upload/t_screenshot_big/def456.jpg',
      ];

      const updated = addIGDBImages(pool, screenshots, []);

      expect(updated.count).toBe(2);
      expect(updated.igdbImages).toHaveLength(2);
      expect(updated.webImages).toHaveLength(0);
      expect(updated.images[0].source).toBe('igdb');
      expect(updated.images[0].isOfficial).toBe(true);
      expect(updated.images[0].igdbType).toBe('screenshot');
    });

    it('should add IGDB artwork with higher priority', () => {
      const pool = createEmptyImagePool();
      const artworks = [
        'https://images.igdb.com/igdb/image/upload/t_screenshot_big/xyz789.jpg',
      ];

      // Artworks are now passed as the second array parameter
      const updated = addIGDBImages(pool, [], artworks);

      expect(updated.images[0].igdbType).toBe('artwork');
      expect(updated.images[0].priority).toBe(100); // IGDB_ARTWORK priority
    });

    it('should add cover image with lower priority', () => {
      const pool = createEmptyImagePool();
      const coverUrl = 'https://images.igdb.com/igdb/image/upload/t_cover_big/cover123.jpg';

      const updated = addIGDBImages(pool, [], [], coverUrl);

      expect(updated.count).toBe(1);
      expect(updated.images[0].igdbType).toBe('cover');
      expect(updated.images[0].priority).toBe(60); // IGDB_COVER priority
    });

    it('should deduplicate URLs', () => {
      const pool = createEmptyImagePool();
      const screenshots = [
        'https://images.igdb.com/igdb/image/upload/t_screenshot_big/abc123.jpg',
        'https://images.igdb.com/igdb/image/upload/t_screenshot_big/abc123.jpg', // Duplicate
      ];

      const updated = addIGDBImages(pool, screenshots, []);

      expect(updated.count).toBe(1);
    });

    it('should add both screenshots and artworks with correct types', () => {
      const pool = createEmptyImagePool();
      const screenshots = ['https://images.igdb.com/igdb/image/upload/t_screenshot_big/ss1.jpg'];
      const artworks = ['https://images.igdb.com/igdb/image/upload/t_screenshot_big/art1.jpg'];
      const coverUrl = 'https://images.igdb.com/igdb/image/upload/t_cover_big/cover.jpg';

      const updated = addIGDBImages(pool, screenshots, artworks, coverUrl);

      expect(updated.count).toBe(3);
      // Artworks are added first
      expect(updated.images[0].igdbType).toBe('artwork');
      expect(updated.images[1].igdbType).toBe('screenshot');
      expect(updated.images[2].igdbType).toBe('cover');
    });
  });

  describe('addWebImages', () => {
    it('should add Tavily images to pool', () => {
      const pool = createEmptyImagePool();
      const images = [
        { url: 'https://ign.com/image1.jpg', description: 'Game screenshot' },
        { url: 'https://gamespot.com/image2.jpg', description: 'Boss fight' },
      ];

      const updated = addWebImages(pool, images, 'test query');

      expect(updated.count).toBe(2);
      expect(updated.webImages).toHaveLength(2);
      expect(updated.images[0].source).toBe('tavily');
      expect(updated.images[0].isOfficial).toBe(false);
      expect(updated.images[0].sourceQuery).toBe('test query');
    });

    it('should filter out excluded domains', () => {
      const pool = createEmptyImagePool();
      const images = [
        { url: 'https://pinterest.com/pin123.jpg', description: 'Pinned image' },
        { url: 'https://facebook.com/photo.jpg', description: 'Social image' },
      ];

      const updated = addWebImages(pool, images, 'test query');

      expect(updated.count).toBe(0);
    });

    it('should filter out tracking pixels', () => {
      const pool = createEmptyImagePool();
      const images = [
        { url: 'https://example.com/pixel.gif', description: 'Tracking' },
        { url: 'https://example.com/tracking/beacon.jpg', description: 'Beacon' },
      ];

      const updated = addWebImages(pool, images, 'test query');

      expect(updated.count).toBe(0);
    });

    it('should give higher priority to quality domains', () => {
      const pool = createEmptyImagePool();
      const images = [
        { url: 'https://ign.com/image.jpg' },
        { url: 'https://unknown-site.com/image.jpg' },
      ];

      const updated = addWebImages(pool, images, 'test query');

      const ignImage = updated.images.find(i => i.url.includes('ign.com'));
      const unknownImage = updated.images.find(i => i.url.includes('unknown-site.com'));

      expect(ignImage?.priority).toBe(50); // HIGH_QUALITY
      expect(unknownImage?.priority).toBe(40); // DEFAULT
    });
  });

  describe('addExaImages', () => {
    it('should add Exa images from results', () => {
      const pool = createEmptyImagePool();
      const results = [
        {
          url: 'https://polygon.com/article',
          image: 'https://polygon.com/hero.jpg',
          imageLinks: ['https://polygon.com/img1.jpg', 'https://polygon.com/img2.jpg'],
        },
      ];

      const updated = addExaImages(pool, results, 'test query');

      expect(updated.count).toBe(3); // 1 representative + 2 imageLinks
      expect(updated.webImages).toHaveLength(3);
      expect(updated.images[0].source).toBe('exa');
      expect(updated.images[0].sourceUrl).toBe('https://polygon.com/article');
    });
  });

  describe('mergeImagePools', () => {
    it('should merge two pools', () => {
      const pool1 = addIGDBImages(createEmptyImagePool(), [
        'https://images.igdb.com/1.jpg',
      ], []);
      const pool2 = addWebImages(createEmptyImagePool(), [
        { url: 'https://example.com/2.jpg' },
      ], 'query');

      const merged = mergeImagePools(pool1, pool2);

      expect(merged.count).toBe(2);
      expect(merged.igdbImages).toHaveLength(1);
      expect(merged.webImages).toHaveLength(1);
    });

    it('should deduplicate when merging', () => {
      const url = 'https://images.igdb.com/1.jpg';
      const pool1 = addIGDBImages(createEmptyImagePool(), [url], []);
      const pool2 = addIGDBImages(createEmptyImagePool(), [url], []);

      const merged = mergeImagePools(pool1, pool2);

      expect(merged.count).toBe(1);
    });
  });

  describe('getImagesByPriority', () => {
    it('should sort images by priority descending', () => {
      let pool = createEmptyImagePool();
      // Now artworks and screenshots are passed as separate arrays
      pool = addIGDBImages(pool, 
        ['https://images.igdb.com/screenshots/ss.jpg'], // screenshots: 80
        ['https://images.igdb.com/artworks/art.jpg']    // artworks: 100
      );
      pool = addWebImages(pool, [
        { url: 'https://random.com/img.jpg' }, // 40
      ], 'query');

      const sorted = getImagesByPriority(pool);

      expect(sorted[0].priority).toBe(100);
      expect(sorted[1].priority).toBe(80);
      expect(sorted[2].priority).toBe(40);
    });
  });

  describe('getBestHeroImage', () => {
    it('should prefer IGDB artwork for hero', () => {
      let pool = createEmptyImagePool();
      pool = addIGDBImages(pool, 
        ['https://images.igdb.com/screenshots/ss.jpg'],
        ['https://images.igdb.com/artworks/art.jpg'],
        'https://images.igdb.com/covers/cover.jpg'
      );

      const hero = getBestHeroImage(pool);

      expect(hero?.igdbType).toBe('artwork');
    });

    it('should fall back to screenshot if no artwork', () => {
      let pool = createEmptyImagePool();
      pool = addIGDBImages(pool, 
        ['https://images.igdb.com/screenshots/ss.jpg'],
        []
      );

      const hero = getBestHeroImage(pool);

      expect(hero?.igdbType).toBe('screenshot');
    });

    it('should return undefined for empty pool', () => {
      const pool = createEmptyImagePool();
      expect(getBestHeroImage(pool)).toBeUndefined();
    });
  });

  describe('getImagesForSection', () => {
    it('should match images by query keywords', () => {
      let pool = createEmptyImagePool();
      pool = addWebImages(pool, [
        { url: 'https://example.com/boss.jpg', description: 'The boss arena' },
        { url: 'https://example.com/weapon.jpg', description: 'Sword upgrade' },
      ], 'boss guide');

      const matches = getImagesForSection(pool, 'Boss Battle Strategies');

      expect(matches.length).toBeGreaterThan(0);
      // Boss image should rank higher due to query match
      expect(matches[0].url).toContain('boss.jpg');
    });
  });

  describe('getPoolSummary', () => {
    it('should return accurate counts', () => {
      let pool = createEmptyImagePool();
      pool = addIGDBImages(pool, 
        ['https://images.igdb.com/screenshots/ss.jpg'],
        ['https://images.igdb.com/artworks/art.jpg']
      );
      pool = addWebImages(pool, [
        { url: 'https://example.com/1.jpg' },
      ], 'query');

      const summary = getPoolSummary(pool);

      expect(summary.total).toBe(3);
      expect(summary.igdb).toBe(2);
      expect(summary.tavily).toBe(1);
      expect(summary.exa).toBe(0);
      expect(summary.artworks).toBe(1);
      expect(summary.screenshots).toBe(1);
    });
  });
});
