/**
 * Image Inserter Tests
 *
 * Tests for markdown image insertion.
 */

import { describe, it, expect } from 'vitest';
import {
  insertImagesIntoMarkdown,
  removeImagesFromMarkdown,
} from '../../../src/ai/articles/image-inserter';
import type { CollectedImage } from '../../../src/ai/articles/image-pool';

// Helper to create a mock collected image
function createMockImage(url: string): CollectedImage {
  return {
    url,
    source: 'igdb',
    isOfficial: true,
    sourceQuality: 100,
  };
}

describe('ImageInserter', () => {
  describe('insertImagesIntoMarkdown', () => {
    it('should capture hero image but NOT insert into markdown (used as featuredImage)', () => {
      const markdown = `# Article Title

This is the introduction paragraph.

## First Section

Some content here.`;

      const result = insertImagesIntoMarkdown({
        markdown,
        heroImage: {
          assignment: {
            image: createMockImage('https://example.com/hero.jpg'),
            altText: 'Hero image description',
          },
          upload: {
            id: 1,
            documentId: 'doc1',
            url: 'https://strapi.example.com/hero.jpg',
            altText: 'Hero image description',
          },
        },
        sectionImages: [],
      });

      // Hero image is captured for featuredImage assignment
      expect(result.heroImage).toBeDefined();
      expect(result.heroImage?.id).toBe(1);
      expect(result.heroImage?.url).toBe('https://strapi.example.com/hero.jpg');
      
      // But NOT inserted into markdown content
      expect(result.markdown).not.toContain('![Hero image description]');
      expect(result.markdown).not.toContain('strapi.example.com/hero.jpg');
      
      // Only 0 images inserted (hero is not inserted, only captured)
      expect(result.imagesInserted).toBe(0);
      
      // Original markdown should be unchanged
      expect(result.markdown).toBe(markdown);
    });

    it('should insert section images after H2 headers', () => {
      const markdown = `# Article Title

Introduction.

## Boss Guide

Here's how to beat the boss.

## Weapon Guide

Weapon information here.`;

      const result = insertImagesIntoMarkdown({
        markdown,
        sectionImages: [
          {
            assignment: {
              sectionHeadline: 'Boss Guide',
              sectionIndex: 0,
              image: createMockImage('https://example.com/boss.jpg'),
              altText: 'Boss arena screenshot',
            },
            upload: {
              id: 2,
              documentId: 'doc2',
              url: 'https://strapi.example.com/boss.jpg',
              altText: 'Boss arena screenshot',
            },
          },
        ],
      });

      expect(result.markdown).toContain('![Boss arena screenshot](https://strapi.example.com/boss.jpg)');
      expect(result.imagesInserted).toBe(1);
      expect(result.sectionImages).toHaveLength(1);
      
      // Verify image is after Boss Guide section
      const lines = result.markdown.split('\n');
      const bossGuideIndex = lines.findIndex(l => l.includes('## Boss Guide'));
      const imageIndex = lines.findIndex(l => l.includes('![Boss arena'));
      expect(imageIndex).toBeGreaterThan(bossGuideIndex);
    });

    it('should handle multiple section images', () => {
      const markdown = `# Guide

## Section One

Content one.

## Section Two

Content two.`;

      const result = insertImagesIntoMarkdown({
        markdown,
        sectionImages: [
          {
            assignment: {
              sectionHeadline: 'Section One',
              sectionIndex: 0,
              image: createMockImage('https://example.com/1.jpg'),
              altText: 'Image one',
            },
            upload: {
              id: 1,
              documentId: 'doc1',
              url: 'https://strapi.example.com/1.jpg',
              altText: 'Image one',
            },
          },
          {
            assignment: {
              sectionHeadline: 'Section Two',
              sectionIndex: 1,
              image: createMockImage('https://example.com/2.jpg'),
              altText: 'Image two',
            },
            upload: {
              id: 2,
              documentId: 'doc2',
              url: 'https://strapi.example.com/2.jpg',
              altText: 'Image two',
            },
          },
        ],
      });

      expect(result.imagesInserted).toBe(2);
      expect(result.markdown).toContain('![Image one]');
      expect(result.markdown).toContain('![Image two]');
    });

    it('should add caption when provided', () => {
      const markdown = `# Title

## Section

Content.`;

      const result = insertImagesIntoMarkdown({
        markdown,
        sectionImages: [
          {
            assignment: {
              sectionHeadline: 'Section',
              sectionIndex: 0,
              image: createMockImage('https://example.com/img.jpg'),
              altText: 'Alt text',
              caption: 'Source: IGN',
            },
            upload: {
              id: 1,
              documentId: 'doc1',
              url: 'https://strapi.example.com/img.jpg',
              altText: 'Alt text',
              caption: 'Source: IGN',
            },
          },
        ],
      });

      expect(result.markdown).toContain('*Source: IGN*');
    });

    it('should return original markdown when no images provided', () => {
      const markdown = '# Title\n\nContent.';

      const result = insertImagesIntoMarkdown({
        markdown,
        sectionImages: [],
      });

      expect(result.markdown).toBe(markdown);
      expect(result.imagesInserted).toBe(0);
    });
  });

  describe('removeImagesFromMarkdown', () => {
    it('should remove image tags from markdown', () => {
      const markdown = `# Title

![Alt text](https://example.com/image.jpg)

## Section

Content here.`;

      const result = removeImagesFromMarkdown(markdown);

      expect(result).not.toContain('![');
      expect(result).toContain('# Title');
      expect(result).toContain('## Section');
      expect(result).toContain('Content here.');
    });

    it('should remove captions following images', () => {
      const markdown = `# Title

![Alt text](https://example.com/image.jpg)
*Caption text*

Content.`;

      const result = removeImagesFromMarkdown(markdown);

      expect(result).not.toContain('*Caption text*');
    });

    it('should handle markdown without images', () => {
      const markdown = '# Title\n\nContent.';

      const result = removeImagesFromMarkdown(markdown);

      expect(result).toBe(markdown);
    });

    it('should clean up extra blank lines', () => {
      const markdown = `# Title



![Image](url.jpg)



Content.`;

      const result = removeImagesFromMarkdown(markdown);

      // Should not have more than 2 consecutive newlines
      expect(result).not.toMatch(/\n{3,}/);
    });
  });
});
