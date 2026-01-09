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
  addSourceImages,
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

    it('should filter out YouTube thumbnail URLs', () => {
      const pool = createEmptyImagePool();
      const images = [
        { url: 'https://i.ytimg.com/vi/EV-uC5_PESo/hqdefault.jpg', description: 'Video thumbnail' },
        { url: 'https://img.ytimg.com/vi/abc123/maxresdefault.jpg', description: 'Another video' },
        { url: 'https://example.com/real-image.jpg', description: 'Valid image' },
      ];

      const updated = addWebImages(pool, images, 'test query', 'tavily');

      expect(updated.count).toBe(1);
      expect(updated.images[0].url).toContain('example.com');
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

  describe('URL normalization for deduplication', () => {
    it('should deduplicate URLs with different query params', () => {
      let pool = createEmptyImagePool();
      pool = addWebImages(pool, [
        { url: 'https://example.com/image.jpg?size=large', description: 'First' },
        { url: 'https://example.com/image.jpg?size=small', description: 'Second' },
      ], 'query');

      // Should dedupe to 1 image since base URL is the same
      expect(pool.count).toBe(1);
    });

    it('should deduplicate URLs with different fragments', () => {
      let pool = createEmptyImagePool();
      pool = addWebImages(pool, [
        { url: 'https://example.com/image.jpg#v1', description: 'First' },
        { url: 'https://example.com/image.jpg#v2', description: 'Second' },
      ], 'query');

      expect(pool.count).toBe(1);
    });

    it('should deduplicate case-insensitive URLs', () => {
      let pool = createEmptyImagePool();
      pool = addWebImages(pool, [
        { url: 'https://Example.COM/Image.jpg', description: 'First' },
        { url: 'https://example.com/image.jpg', description: 'Second' },
      ], 'query');

      expect(pool.count).toBe(1);
    });

    it('should keep different URLs as separate', () => {
      let pool = createEmptyImagePool();
      pool = addWebImages(pool, [
        { url: 'https://example.com/image1.jpg', description: 'First' },
        { url: 'https://example.com/image2.jpg', description: 'Second' },
      ], 'query');

      expect(pool.count).toBe(2);
    });

    it('should deduplicate across IGDB and web images', () => {
      let pool = createEmptyImagePool();
      // Add same URL as IGDB first
      pool = addIGDBImages(pool, 
        ['https://images.igdb.com/image.jpg'],
        []
      );
      // Try to add same URL from web search
      pool = addWebImages(pool, [
        { url: 'https://images.igdb.com/image.jpg?utm_source=tavily', description: 'Web result' },
      ], 'query');

      // Should still be 1 image (IGDB takes precedence)
      expect(pool.count).toBe(1);
      expect(pool.images[0].source).toBe('igdb');
    });
  });

  describe('getPoolSummary with source images', () => {
    it('should include source count in summary', () => {
      let pool = createEmptyImagePool();
      pool = addIGDBImages(pool, 
        ['https://images.igdb.com/screenshots/ss.jpg'],
        ['https://images.igdb.com/artworks/art.jpg']
      );
      pool = addWebImages(pool, [
        { url: 'https://example.com/web.jpg' },
      ], 'query');
      pool = addSourceImages(pool, [
        { url: 'https://example.com/source1.jpg', description: 'Source image with good description', position: 0 },
        { url: 'https://example.com/source2.jpg', description: 'Another source image here', position: 1 },
      ], 'https://example.com/article', 'example.com');

      const summary = getPoolSummary(pool);

      expect(summary.total).toBe(5);
      expect(summary.igdb).toBe(2);
      expect(summary.tavily).toBe(1);
      expect(summary.source).toBe(2);
      expect(summary.exa).toBe(0);
    });
  });

  describe('URL filtering for UI elements', () => {
    it('should filter out sprite URLs', () => {
      let pool = createEmptyImagePool();
      pool = addSourceImages(pool, [
        { url: 'https://example.com/sprites/icon.png', description: 'Sprite icon', position: 0 },
        { url: 'https://example.com/content/screenshot.jpg', description: 'Valid screenshot image', position: 1 },
      ], 'https://example.com/article', 'example.com');

      // Only the valid screenshot should be added
      expect(pool.count).toBe(1);
      expect(pool.images[0].url).toBe('https://example.com/content/screenshot.jpg');
    });

    it('should filter out avatar URLs', () => {
      let pool = createEmptyImagePool();
      pool = addSourceImages(pool, [
        { url: 'https://example.com/avatar/user123.jpg', description: 'User avatar', position: 0 },
        { url: 'https://example.com/game/boss-fight.png', description: 'Boss fight gameplay screenshot', position: 1 },
      ], 'https://example.com/article', 'example.com');

      expect(pool.count).toBe(1);
      expect(pool.images[0].url).toBe('https://example.com/game/boss-fight.png');
    });

    it('should filter out thumbnail URLs', () => {
      let pool = createEmptyImagePool();
      pool = addSourceImages(pool, [
        { url: 'https://example.com/thumbs/small.jpg', description: 'Thumbnail image', position: 0 },
        { url: 'https://example.com/image_thumb.jpg', description: 'Another thumbnail', position: 1 },
        { url: 'https://example.com/full-image.jpg', description: 'Full size image for article', position: 2 },
      ], 'https://example.com/article', 'example.com');

      expect(pool.count).toBe(1);
      expect(pool.images[0].url).toBe('https://example.com/full-image.jpg');
    });

    it('should filter out small dimension URLs', () => {
      let pool = createEmptyImagePool();
      pool = addSourceImages(pool, [
        { url: 'https://example.com/16x16/icon.png', description: 'Small icon', position: 0 },
        { url: 'https://example.com/50x50_avatar.jpg', description: 'Avatar', position: 1 },
        { url: 'https://example.com/1920x1080/screenshot.jpg', description: 'Full resolution screenshot', position: 2 },
      ], 'https://example.com/article', 'example.com');

      expect(pool.count).toBe(1);
      expect(pool.images[0].url).toBe('https://example.com/1920x1080/screenshot.jpg');
    });

    it('should filter out flags and badges', () => {
      let pool = createEmptyImagePool();
      pool = addSourceImages(pool, [
        { url: 'https://example.com/flags/offline-mode.png', description: 'Offline flag', position: 0 },
        { url: 'https://example.com/badge/achievement.png', description: 'Achievement badge', position: 1 },
        { url: 'https://example.com/gameplay/combat.jpg', description: 'Combat gameplay screenshot', position: 2 },
      ], 'https://example.com/article', 'example.com');

      expect(pool.count).toBe(1);
      expect(pool.images[0].url).toBe('https://example.com/gameplay/combat.jpg');
    });
  });

  describe('Description-based filtering', () => {
    it('should filter out images with generic numbered descriptions', () => {
      let pool = createEmptyImagePool();
      pool = addSourceImages(pool, [
        { url: 'https://example.com/img1.jpg', description: 'Image 1', position: 0 },
        { url: 'https://example.com/img2.jpg', description: 'Image 5: Something', position: 1 },
        { url: 'https://example.com/boss.jpg', description: 'Simon boss fight phase 1', position: 2 },
      ], 'https://example.com/article', 'example.com');

      // Only the descriptive image should remain
      expect(pool.count).toBe(1);
      expect(pool.images[0].description).toBe('Simon boss fight phase 1');
    });

    it('should filter out avatar/profile descriptions', () => {
      let pool = createEmptyImagePool();
      pool = addSourceImages(pool, [
        { url: 'https://example.com/user.jpg', description: 'User avatar', position: 0 },
        { url: 'https://example.com/pic.jpg', description: 'Profile picture of player', position: 1 },
        { url: 'https://example.com/game.jpg', description: 'Character build guide screenshot', position: 2 },
      ], 'https://example.com/article', 'example.com');

      expect(pool.count).toBe(1);
      expect(pool.images[0].description).toBe('Character build guide screenshot');
    });

    it('should filter out platform/rating badge descriptions', () => {
      let pool = createEmptyImagePool();
      pool = addSourceImages(pool, [
        { url: 'https://example.com/esrb.jpg', description: 'ESRB: Mature', position: 0 },
        { url: 'https://example.com/ps5.jpg', description: 'PlayStation 5', position: 1 },
        { url: 'https://example.com/combat.jpg', description: 'Combat system explained', position: 2 },
      ], 'https://example.com/article', 'example.com');

      expect(pool.count).toBe(1);
      expect(pool.images[0].description).toBe('Combat system explained');
    });
  });

  describe('Priority based on metadata quality', () => {
    it('should give higher priority to images with headers', () => {
      let pool = createEmptyImagePool();
      pool = addSourceImages(pool, [
        { url: 'https://example.com/img1.jpg', description: 'Screenshot without header context', position: 0 },
        { url: 'https://example.com/img2.jpg', description: 'Screenshot with header', position: 1, nearestHeader: 'Phase 1 Strategy' },
      ], 'https://example.com/article', 'example.com');

      // Image with header should have higher priority
      const withHeader = pool.images.find(i => i.url.includes('img2'));
      const withoutHeader = pool.images.find(i => i.url.includes('img1'));
      
      expect(withHeader!.priority).toBeGreaterThan(withoutHeader!.priority);
    });

    it('should penalize images with very short descriptions', () => {
      let pool = createEmptyImagePool();
      pool = addSourceImages(pool, [
        { url: 'https://example.com/short.jpg', description: 'Short', position: 0 },
        { url: 'https://example.com/long.jpg', description: 'This is a much longer and more descriptive caption', position: 1 },
      ], 'https://example.com/article', 'example.com');

      const shortDesc = pool.images.find(i => i.url.includes('short'));
      const longDesc = pool.images.find(i => i.url.includes('long'));
      
      expect(longDesc!.priority).toBeGreaterThan(shortDesc!.priority);
    });
  });

  describe('SVG and logo URL filtering', () => {
    it('should filter out SVG files', () => {
      let pool = createEmptyImagePool();
      pool = addWebImages(pool, [
        { url: 'https://example.com/icon.svg', description: 'Vector icon' },
        { url: 'https://example.com/screenshot.jpg', description: 'Valid screenshot' },
      ], 'query');

      expect(pool.count).toBe(1);
      expect(pool.images[0].url).toBe('https://example.com/screenshot.jpg');
    });

    it('should filter out any URL containing logo', () => {
      let pool = createEmptyImagePool();
      pool = addWebImages(pool, [
        { url: 'https://example.com/reddit-logo.png', description: 'Reddit' },
        { url: 'https://example.com/assets/logo.png', description: 'Site logo' },
        { url: 'https://example.com/company-logo-full.jpg', description: 'Company' },
        { url: 'https://example.com/gameplay.jpg', description: 'Gameplay screenshot' },
      ], 'query');

      expect(pool.count).toBe(1);
      expect(pool.images[0].url).toBe('https://example.com/gameplay.jpg');
    });

    it('should filter out /authors/ paths', () => {
      let pool = createEmptyImagePool();
      pool = addSourceImages(pool, [
        { url: 'https://example.com/authors/john-doe.jpg', description: 'Author John Doe', position: 0 },
        { url: 'https://example.com/guides/boss.jpg', description: 'Boss guide screenshot image', position: 1 },
      ], 'https://example.com/article', 'example.com');

      expect(pool.count).toBe(1);
      expect(pool.images[0].url).toBe('https://example.com/guides/boss.jpg');
    });
  });

  describe('URL dimension filtering', () => {
    it('should filter out small width in query params', () => {
      let pool = createEmptyImagePool();
      pool = addWebImages(pool, [
        { url: 'https://example.com/img.jpg?w=150', description: 'Small width' },
        { url: 'https://example.com/img2.jpg?width=99', description: 'Tiny width' },
        { url: 'https://example.com/large.jpg?w=800', description: 'Large width' },
      ], 'query');

      expect(pool.count).toBe(1);
      expect(pool.images[0].url).toContain('w=800');
    });

    it('should filter out small height in query params', () => {
      let pool = createEmptyImagePool();
      pool = addWebImages(pool, [
        { url: 'https://example.com/img.jpg?h=50', description: 'Small height' },
        { url: 'https://example.com/img2.jpg?height=100', description: 'Small height' },
        { url: 'https://example.com/large.jpg?h=400', description: 'Large height' },
      ], 'query');

      expect(pool.count).toBe(1);
      expect(pool.images[0].url).toContain('h=400');
    });

    it('should NOT filter URLs without dimension params', () => {
      let pool = createEmptyImagePool();
      pool = addWebImages(pool, [
        { url: 'https://example.com/image.jpg', description: 'No dimensions' },
        { url: 'https://example.com/photo.png?quality=80', description: 'Other params' },
      ], 'query');

      expect(pool.count).toBe(2);
    });

    it('should keep images with dimensions >= 200', () => {
      let pool = createEmptyImagePool();
      pool = addWebImages(pool, [
        { url: 'https://example.com/img.jpg?w=200', description: 'Exactly 200 width' },
        { url: 'https://example.com/img2.jpg?w=199', description: 'Just under 200' },
      ], 'query');

      expect(pool.count).toBe(1);
      expect(pool.images[0].url).toContain('w=200');
    });
  });

  describe('New description filters', () => {
    it('should filter exact "Image" description', () => {
      let pool = createEmptyImagePool();
      pool = addSourceImages(pool, [
        { url: 'https://example.com/img1.jpg', description: 'Image', position: 0 },
        { url: 'https://example.com/img2.jpg', description: 'IMAGE', position: 1 },
        { url: 'https://example.com/valid.jpg', description: 'Boss fight screenshot', position: 2 },
      ], 'https://example.com/article', 'example.com');

      expect(pool.count).toBe(1);
      expect(pool.images[0].url).toBe('https://example.com/valid.jpg');
    });

    it('should filter "share on" descriptions', () => {
      let pool = createEmptyImagePool();
      pool = addSourceImages(pool, [
        { url: 'https://example.com/share1.jpg', description: 'Share on Facebook', position: 0 },
        { url: 'https://example.com/share2.jpg', description: 'share on twitter', position: 1 },
        { url: 'https://example.com/content.jpg', description: 'Game content screenshot', position: 2 },
      ], 'https://example.com/article', 'example.com');

      expect(pool.count).toBe(1);
      expect(pool.images[0].url).toBe('https://example.com/content.jpg');
    });

    it('should filter pure numeric descriptions', () => {
      let pool = createEmptyImagePool();
      pool = addSourceImages(pool, [
        { url: 'https://example.com/img1.jpg', description: '4', position: 0 },
        { url: 'https://example.com/img2.jpg', description: '123', position: 1 },
        { url: 'https://example.com/valid.jpg', description: 'Step 4 of the guide', position: 2 },
      ], 'https://example.com/article', 'example.com');

      expect(pool.count).toBe(1);
      expect(pool.images[0].url).toBe('https://example.com/valid.jpg');
    });

    it('should filter descriptions containing "logo"', () => {
      let pool = createEmptyImagePool();
      pool = addSourceImages(pool, [
        { url: 'https://example.com/img1.jpg', description: 'Company logo', position: 0 },
        { url: 'https://example.com/img2.jpg', description: 'The PS5 logo badge', position: 1 },
        { url: 'https://example.com/valid.jpg', description: 'Character selection screen', position: 2 },
      ], 'https://example.com/article', 'example.com');

      expect(pool.count).toBe(1);
      expect(pool.images[0].url).toBe('https://example.com/valid.jpg');
    });
  });

  describe('Hero image title relevance', () => {
    it('should select image with description matching many title keywords', () => {
      let pool = createEmptyImagePool();
      // Only add screenshots (priority 80), no artwork (priority 100)
      pool = addIGDBImages(pool, 
        ['https://images.igdb.com/generic.jpg'],
        [] // No artwork
      );
      pool = addSourceImages(pool, [
        // Source with many keyword matches: simon, boss, clair, obscur
        { url: 'https://example.com/simon.jpg', description: 'Defeating Simon boss in Clair Obscur arena', position: 0 },
      ], 'https://example.com/article', 'ign.com'); // High quality domain (65 base)

      const hero = getBestHeroImage(pool, 'How to Beat Simon Boss in Clair Obscur');

      // Source: 65 (high domain) + 100 (4 keywords × 25) = 165
      // IGDB: 80 (screenshot) + 10 (IGDB bonus) = 90
      expect(hero?.url).toBe('https://example.com/simon.jpg');
    });

    it('should consider ALL sources not just IGDB', () => {
      let pool = createEmptyImagePool();
      pool = addIGDBImages(pool, 
        ['https://images.igdb.com/screenshot.jpg'],
        []
      );
      pool = addWebImages(pool, [
        { url: 'https://ign.com/malenia-boss.jpg', description: 'Malenia boss fight guide' },
      ], 'malenia guide');

      const hero = getBestHeroImage(pool, 'Malenia Boss Guide Elden Ring');

      // Web image matching "Malenia" and "boss" should be selected
      expect(hero?.url).toBe('https://ign.com/malenia-boss.jpg');
    });

    it('should fall back to highest priority without title', () => {
      let pool = createEmptyImagePool();
      pool = addIGDBImages(pool, 
        ['https://images.igdb.com/screenshot.jpg'],
        ['https://images.igdb.com/artwork.jpg']
      );
      pool = addWebImages(pool, [
        { url: 'https://example.com/web.jpg' },
      ], 'query');

      const hero = getBestHeroImage(pool); // No title

      // Should return highest priority (artwork = 100)
      expect(hero?.igdbType).toBe('artwork');
    });

    it('should give IGDB images small boost for quality', () => {
      let pool = createEmptyImagePool();
      pool = addIGDBImages(pool, 
        ['https://images.igdb.com/generic-screenshot.jpg'],
        []
      );
      pool = addSourceImages(pool, [
        { url: 'https://example.com/generic-image.jpg', description: 'Generic game image', position: 0 },
      ], 'https://example.com/article', 'example.com');

      const hero = getBestHeroImage(pool, 'Generic Game Guide');

      // IGDB should win due to +10 quality bonus when descriptions don't strongly differ
      expect(hero?.source).toBe('igdb');
    });

    it('should return undefined for empty pool', () => {
      const pool = createEmptyImagePool();
      expect(getBestHeroImage(pool, 'Some Title')).toBeUndefined();
    });
  });
});
