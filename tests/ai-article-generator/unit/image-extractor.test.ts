/**
 * Unit tests for image-extractor utility
 */

import { describe, it, expect } from 'vitest';
import {
  extractImageUrls,
  parseMarkdownImages,
  validateImages,
  extractImageContext,
  extractImagesFromSource,
  normalizeUrl,
  cleanDescription,
} from '../../../src/ai/articles/utils/image-extractor';

describe('image-extractor', () => {
  describe('normalizeUrl', () => {
    it('removes query parameters', () => {
      expect(normalizeUrl('https://example.com/image.jpg?size=large')).toBe(
        'https://example.com/image.jpg'
      );
    });

    it('removes fragments', () => {
      expect(normalizeUrl('https://example.com/image.jpg#section')).toBe(
        'https://example.com/image.jpg'
      );
    });

    it('converts to lowercase', () => {
      expect(normalizeUrl('https://Example.COM/Image.JPG')).toBe(
        'https://example.com/image.jpg'
      );
    });

    it('handles protocol-relative URLs', () => {
      expect(normalizeUrl('//example.com/image.jpg')).toBe(
        'https://example.com/image.jpg'
      );
    });

    it('trims whitespace', () => {
      expect(normalizeUrl('  https://example.com/image.jpg  ')).toBe(
        'https://example.com/image.jpg'
      );
    });
  });

  describe('extractImageUrls', () => {
    it('extracts markdown image URLs', () => {
      const content = '![Alt text](https://example.com/image.jpg) and ![](https://example.com/image2.png)';
      const result = extractImageUrls(content);
      
      expect(result).toHaveLength(2);
      expect(result[0].url).toBe('https://example.com/image.jpg');
      expect(result[1].url).toBe('https://example.com/image2.png');
    });

    it('extracts HTML img tag URLs', () => {
      const content = '<img src="https://example.com/image.jpg" alt="test"> <img src=\'https://example.com/image2.png\'>';
      const result = extractImageUrls(content);
      
      expect(result).toHaveLength(2);
      expect(result[0].url).toBe('https://example.com/image.jpg');
      expect(result[1].url).toBe('https://example.com/image2.png');
    });

    it('extracts plain URLs with image extensions', () => {
      // Plain URLs in text (not in markdown/HTML tags) should be extracted if they end with image extensions
      const content = 'Check out https://static0.gamerantimages.com/screenshots/boss.png for the screenshot';
      const result = extractImageUrls(content);
      
      // The plain URL regex should pick this up
      expect(result.length).toBeGreaterThanOrEqual(1);
      if (result.length > 0) {
        expect(result.some(r => r.url.includes('boss.png'))).toBe(true);
      }
    });

    it('skips data URLs', () => {
      const content = '![Alt](data:image/png;base64,iVBORw0KGgo=)';
      const result = extractImageUrls(content);
      
      expect(result).toHaveLength(0);
    });

    it('deduplicates URLs by normalized form', () => {
      const content = `
        ![First](https://example.com/image.jpg)
        ![Second](https://EXAMPLE.COM/IMAGE.JPG)
        ![Third](https://example.com/image.jpg?size=thumb)
      `;
      const result = extractImageUrls(content);
      
      // All normalize to the same URL, so only 1 should be kept
      expect(result).toHaveLength(1);
    });

    it('extracts images from known CDNs without extension', () => {
      const content = '<img src="https://images.igdb.com/igdb/image/upload/t_screenshot_big/abc123">';
      const result = extractImageUrls(content);
      
      // Should find the IGDB CDN URL
      const igdbImages = result.filter(r => r.url.includes('igdb.com'));
      expect(igdbImages.length).toBeGreaterThanOrEqual(1);
    });

    it('handles mixed content with HTML and markdown', () => {
      const content = `
        # Guide
        ![Screenshot](https://example.com/screen1.jpg)
        <img src="https://cdn.site.com/photo.png" alt="Photo">
        Some text with https://images.igdb.com/game/cover.webp inline
      `;
      const result = extractImageUrls(content);
      
      // Should find at least the markdown and HTML images
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('parseMarkdownImages', () => {
    it('parses markdown images with description', () => {
      const content = '![Boss fight screenshot](https://example.com/boss.jpg)';
      const result = parseMarkdownImages(content);
      
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe('https://example.com/boss.jpg');
      expect(result[0].description).toBe('Boss fight screenshot');
      expect(result[0].position).toBe(0);
    });

    it('parses markdown images without description', () => {
      const content = '![](https://example.com/image.jpg)';
      const result = parseMarkdownImages(content);
      
      expect(result).toHaveLength(1);
      expect(result[0].description).toBe('Image');
    });

    it('tracks position correctly for multiple images', () => {
      const content = 'Text before ![First](url1.jpg) middle text ![Second](url2.jpg) end';
      const result = parseMarkdownImages(content);
      
      expect(result).toHaveLength(2);
      expect(result[0].position).toBeLessThan(result[1].position);
    });

    it('skips data URLs', () => {
      const content = '![Alt](data:image/png;base64,xyz)';
      const result = parseMarkdownImages(content);
      
      expect(result).toHaveLength(0);
    });
  });

  describe('validateImages', () => {
    it('keeps images with URLs in allowlist', () => {
      const parsed = [
        { url: 'https://example.com/valid.jpg', description: 'Valid', position: 0 },
      ];
      const allowlist = [
        { url: 'https://example.com/valid.jpg', normalizedUrl: 'https://example.com/valid.jpg' },
      ];
      
      const result = validateImages(parsed, allowlist);
      
      expect(result).toHaveLength(1);
    });

    it('discards images with URLs not in allowlist (hallucinations)', () => {
      const parsed = [
        { url: 'https://hallucinated.com/fake.jpg', description: 'Fake', position: 0 },
      ];
      const allowlist = [
        { url: 'https://example.com/real.jpg', normalizedUrl: 'https://example.com/real.jpg' },
      ];
      
      const result = validateImages(parsed, allowlist);
      
      expect(result).toHaveLength(0);
    });

    it('matches URLs by normalized form', () => {
      const parsed = [
        { url: 'https://EXAMPLE.COM/IMAGE.JPG', description: 'Test', position: 0 },
      ];
      const allowlist = [
        { url: 'https://example.com/image.jpg', normalizedUrl: 'https://example.com/image.jpg' },
      ];
      
      const result = validateImages(parsed, allowlist);
      
      expect(result).toHaveLength(1);
    });

    it('handles mixed valid and invalid images', () => {
      const parsed = [
        { url: 'https://valid.com/real.jpg', description: 'Valid', position: 0 },
        { url: 'https://invalid.com/fake.jpg', description: 'Fake', position: 10 },
        { url: 'https://valid.com/real2.jpg', description: 'Valid 2', position: 20 },
      ];
      const allowlist = [
        { url: 'https://valid.com/real.jpg', normalizedUrl: 'https://valid.com/real.jpg' },
        { url: 'https://valid.com/real2.jpg', normalizedUrl: 'https://valid.com/real2.jpg' },
      ];
      
      const result = validateImages(parsed, allowlist);
      
      expect(result).toHaveLength(2);
      expect(result[0].description).toBe('Valid');
      expect(result[1].description).toBe('Valid 2');
    });
  });

  describe('extractImageContext', () => {
    it('extracts nearest header above image', () => {
      const content = `
## Boss Guide

Some intro text.

![Boss screenshot](https://example.com/boss.jpg)

More content.
`;
      const images = [{ url: 'https://example.com/boss.jpg', description: 'Boss screenshot', position: content.indexOf('![Boss') }];
      
      const result = extractImageContext(content, images);
      
      expect(result[0].nearestHeader).toBe('Boss Guide');
    });

    it('extracts surrounding paragraph', () => {
      const content = `
First paragraph.

This paragraph contains ![image](url.jpg) in the middle.

Last paragraph.
`;
      const images = [{ url: 'url.jpg', description: 'image', position: content.indexOf('![image') }];
      
      const result = extractImageContext(content, images);
      
      expect(result[0].contextParagraph).toContain('This paragraph contains');
    });

    it('handles images without headers above', () => {
      const content = '![First image](url.jpg) appears before any headers';
      const images = [{ url: 'url.jpg', description: 'First image', position: 0 }];
      
      const result = extractImageContext(content, images);
      
      expect(result[0].nearestHeader).toBeUndefined();
    });

    it('preserves position from input', () => {
      const content = '![Test](url.jpg)';
      const images = [{ url: 'url.jpg', description: 'Test', position: 42 }];
      
      const result = extractImageContext(content, images);
      
      expect(result[0].position).toBe(42);
    });
  });

  describe('extractImagesFromSource', () => {
    it('runs complete pipeline and returns result', () => {
      const rawContent = `
        <html>
        <body>
        <img src="https://example.com/screenshot1.jpg" alt="Game screenshot">
        <img src="https://example.com/screenshot2.png" alt="Another shot">
        </body>
        </html>
      `;
      
      const cleanedContent = `
## Game Guide

This guide covers the boss fight.

![Game screenshot](https://example.com/screenshot1.jpg)

More strategy info here.
`;
      
      const result = extractImagesFromSource(rawContent, cleanedContent);
      
      expect(result.preExtractedCount).toBe(2);
      expect(result.parsedCount).toBe(1);
      expect(result.images).toHaveLength(1);
      expect(result.discardedCount).toBe(0);
      expect(result.images[0].nearestHeader).toBe('Game Guide');
    });

    it('discards hallucinated URLs', () => {
      const rawContent = '<img src="https://real.com/image.jpg">';
      const cleanedContent = '![Fake](https://hallucinated.com/fake.jpg)';
      
      const result = extractImagesFromSource(rawContent, cleanedContent);
      
      expect(result.preExtractedCount).toBe(1);
      expect(result.parsedCount).toBe(1);
      expect(result.discardedCount).toBe(1);
      expect(result.images).toHaveLength(0);
    });

    it('handles content with no images', () => {
      const rawContent = '<p>No images here</p>';
      const cleanedContent = 'Just text content';
      
      const result = extractImagesFromSource(rawContent, cleanedContent);
      
      expect(result.preExtractedCount).toBe(0);
      expect(result.parsedCount).toBe(0);
      expect(result.images).toHaveLength(0);
    });

    it('resolves relative URLs in validation against source URL', () => {
      const rawContent = '<img src="/images/screenshot.jpg">';
      const cleanedContent = '![Screenshot](/images/screenshot.jpg)';
      const sourceUrl = 'https://example.com/article';
      
      const result = extractImagesFromSource(rawContent, cleanedContent, sourceUrl);
      
      // The relative URL should be resolved and matched
      expect(result.parsedCount).toBe(1);
      expect(result.discardedCount).toBe(0);
      expect(result.images).toHaveLength(1);
    });

    it('extracts lazy-loading data-src images', () => {
      const rawContent = '<img data-src="https://example.com/lazy.jpg" src="placeholder.gif">';
      const cleanedContent = '![Lazy loaded](https://example.com/lazy.jpg)';
      
      const result = extractImagesFromSource(rawContent, cleanedContent);
      
      expect(result.preExtractedCount).toBeGreaterThanOrEqual(1);
      expect(result.images).toHaveLength(1);
    });

    it('extracts srcset images', () => {
      const rawContent = '<img src="small.jpg" srcset="https://example.com/large.jpg 2x, https://example.com/medium.jpg 1x">';
      const cleanedContent = '![Image](https://example.com/large.jpg)';
      
      const result = extractImagesFromSource(rawContent, cleanedContent);
      
      expect(result.preExtractedCount).toBeGreaterThanOrEqual(1);
      expect(result.images).toHaveLength(1);
    });

    it('caps images at MAX_IMAGES_PER_SOURCE', () => {
      // Create content with many images
      const imageUrls = Array.from({ length: 30 }, (_, i) => `https://example.com/img${i}.jpg`);
      const rawContent = imageUrls.map(url => `<img src="${url}">`).join('\n');
      const cleanedContent = imageUrls.map((url, i) => `![Image ${i}](${url})`).join('\n\n');
      
      const result = extractImagesFromSource(rawContent, cleanedContent);
      
      // Should be capped at MAX_IMAGES_PER_SOURCE (20 by default)
      expect(result.images.length).toBeLessThanOrEqual(20);
      expect(result.parsedCount).toBe(30);
    });
  });

  describe('cleanDescription', () => {
    it('converts filename with hyphens to readable text', () => {
      expect(cleanDescription('clair-obscur-expedition-33-screenshot.jpg')).toBe(
        'Clair Obscur Expedition 33 Screenshot'
      );
    });

    it('converts filename with underscores to readable text', () => {
      expect(cleanDescription('boss_fight_phase_1_strategy.png')).toBe(
        'Boss Fight Phase 1 Strategy'
      );
    });

    it('removes file extensions', () => {
      expect(cleanDescription('game-screenshot.webp')).toBe('Game Screenshot');
      expect(cleanDescription('image.jpeg')).toBe('Image');
    });

    it('preserves already clean descriptions', () => {
      expect(cleanDescription('Simon boss fight phase 1')).toBe(
        'Simon boss fight phase 1'
      );
    });

    it('handles mixed hyphens and underscores', () => {
      expect(cleanDescription('game_boss-fight-screenshot.jpg')).toBe(
        'Game Boss Fight Screenshot'
      );
    });

    it('removes trailing numbered suffixes like (1)', () => {
      expect(cleanDescription('screenshot(1).jpg')).toBe('Screenshot');
    });

    it('title cases all-lowercase filenames', () => {
      expect(cleanDescription('lowercasename.png')).toBe('Lowercasename');
    });

    it('preserves case for mixed-case descriptions', () => {
      expect(cleanDescription('SimonBossFight')).toBe('SimonBossFight');
    });

    it('handles empty or short descriptions', () => {
      expect(cleanDescription('')).toBe('');
      expect(cleanDescription('a.jpg')).toBe('A');
    });

    it('does not modify descriptions without file extension patterns', () => {
      expect(cleanDescription('Combat gameplay screenshot')).toBe(
        'Combat gameplay screenshot'
      );
    });
  });
});
