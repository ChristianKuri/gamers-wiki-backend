/**
 * Image Uploader Tests
 *
 * Tests for Strapi image uploads:
 * - URL-based image upload
 * - Buffer-based image upload
 * - Filename generation
 * - Caption/attribution handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Core } from '@strapi/strapi';

// Mock dependencies
vi.mock('../../../src/ai/articles/services/image-downloader', () => ({
  downloadImageWithRetry: vi.fn(),
}));

// ============================================================================
// Test Helpers
// ============================================================================

function createMockUploadService() {
  return {
    upload: vi.fn(),
    updateFileInfo: vi.fn(),
  };
}

function createMockStrapi(uploadService = createMockUploadService()): Core.Strapi {
  return {
    plugin: vi.fn().mockReturnValue({
      service: vi.fn().mockReturnValue(uploadService),
    }),
  } as unknown as Core.Strapi;
}

function createMockJpegBuffer(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(100).fill(0)]);
}

// ============================================================================
// Tests
// ============================================================================

describe('Image Uploader', () => {
  let mockDownloadImageWithRetry: ReturnType<typeof vi.fn>;
  let mockUploadService: ReturnType<typeof createMockUploadService>;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    const downloaderModule = await import('../../../src/ai/articles/services/image-downloader');
    mockDownloadImageWithRetry = downloaderModule.downloadImageWithRetry as ReturnType<typeof vi.fn>;
    
    mockUploadService = createMockUploadService();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('createImageFilename', () => {
    it('creates base filename from title', async () => {
      const { createImageFilename } = await import('../../../src/ai/articles/services/image-uploader');
      
      const result = createImageFilename('My Article Title');
      
      expect(result).toBe('my-article-title');
    });

    it('creates filename with section', async () => {
      const { createImageFilename } = await import('../../../src/ai/articles/services/image-uploader');
      
      const result = createImageFilename('My Article', 'Getting Started');
      
      expect(result).toBe('my-article-getting-started');
    });

    it('creates filename with section and index', async () => {
      const { createImageFilename } = await import('../../../src/ai/articles/services/image-uploader');
      
      const result = createImageFilename('My Article', 'Section', 2);
      
      expect(result).toBe('my-article-section-2');
    });

    it('creates filename with index but no section', async () => {
      const { createImageFilename } = await import('../../../src/ai/articles/services/image-uploader');
      
      const result = createImageFilename('My Article', undefined, 3);
      
      expect(result).toBe('my-article-3');
    });

    it('sanitizes special characters', async () => {
      const { createImageFilename } = await import('../../../src/ai/articles/services/image-uploader');
      
      const result = createImageFilename("Game's Guide: Tips & Tricks!");
      
      expect(result).toBe('game-s-guide-tips-tricks');
      expect(result).not.toContain("'");
      expect(result).not.toContain(':');
      expect(result).not.toContain('&');
      expect(result).not.toContain('!');
    });

    it('handles consecutive special characters', async () => {
      const { createImageFilename } = await import('../../../src/ai/articles/services/image-uploader');
      
      const result = createImageFilename('Game --- Guide');
      
      // Multiple dashes should be collapsed to single dash
      expect(result).toBe('game-guide');
      expect(result).not.toContain('---');
    });

    it('truncates long filenames', async () => {
      const { createImageFilename } = await import('../../../src/ai/articles/services/image-uploader');
      
      const longTitle = 'A'.repeat(200);
      const result = createImageFilename(longTitle);
      
      expect(result.length).toBeLessThanOrEqual(100);
    });
  });

  describe('uploadImageBuffer', () => {
    it('uploads buffer to Strapi with correct format', async () => {
      const { uploadImageBuffer } = await import('../../../src/ai/articles/services/image-uploader');
      
      const buffer = createMockJpegBuffer();
      mockUploadService.upload.mockResolvedValueOnce([{
        id: 1,
        documentId: 'doc-123',
        url: 'https://strapi.example.com/uploads/test.jpg',
        width: 800,
        height: 600,
      }]);
      
      const strapi = createMockStrapi(mockUploadService);
      
      const result = await uploadImageBuffer(
        {
          buffer,
          filename: 'test-image',
          mimeType: 'image/jpeg',
          altText: 'Test image alt',
          caption: 'Test caption',
        },
        { strapi }
      );
      
      expect(result.id).toBe(1);
      expect(result.documentId).toBe('doc-123');
      expect(result.url).toBe('https://strapi.example.com/uploads/test.jpg');
      expect(result.altText).toBe('Test image alt');
      expect(result.caption).toBe('Test caption');
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
    });

    it('calls Strapi upload service with file info', async () => {
      const { uploadImageBuffer } = await import('../../../src/ai/articles/services/image-uploader');
      
      const buffer = createMockJpegBuffer();
      mockUploadService.upload.mockResolvedValueOnce([{
        id: 1,
        documentId: 'doc-123',
        url: 'https://strapi.example.com/test.jpg',
      }]);
      
      const strapi = createMockStrapi(mockUploadService);
      
      await uploadImageBuffer(
        {
          buffer,
          filename: 'my-image',
          mimeType: 'image/jpeg',
          altText: 'Alt text',
          caption: 'Caption text',
        },
        { strapi }
      );
      
      expect(mockUploadService.upload).toHaveBeenCalledWith({
        data: {}, // Empty object per Strapi docs
        files: expect.objectContaining({
          filepath: expect.stringMatching(/strapi-upload-.*my-image\.jpg$/), // Temp file path (koa-body 6.x format)
          originalFilename: 'my-image.jpg',  // koa-body 6.x uses originalFilename
          mimetype: 'image/jpeg',            // koa-body 6.x uses mimetype
          size: buffer.length,
        }),
      });
      
      // updateFileInfo should be called with metadata
      expect(mockUploadService.updateFileInfo).toHaveBeenCalledWith(1, {
        alternativeText: 'Alt text',
        caption: 'Caption text',
      });
    });

    it('maps MIME types to correct extensions', async () => {
      const { uploadImageBuffer } = await import('../../../src/ai/articles/services/image-uploader');
      
      const testCases = [
        { mimeType: 'image/jpeg', extension: 'jpg' },
        { mimeType: 'image/png', extension: 'png' },
        { mimeType: 'image/webp', extension: 'webp' },
        { mimeType: 'image/gif', extension: 'gif' },
      ];
      
      for (const { mimeType, extension } of testCases) {
        mockUploadService.upload.mockResolvedValueOnce([{
          id: 1,
          documentId: 'doc-123',
          url: `https://strapi.example.com/test.${extension}`,
        }]);
        
        const strapi = createMockStrapi(mockUploadService);
        const buffer = createMockJpegBuffer();
        
        await uploadImageBuffer(
          {
            buffer,
            filename: 'test',
            mimeType,
            altText: 'Test',
          },
          { strapi }
        );
        
        expect(mockUploadService.upload).toHaveBeenCalledWith(
          expect.objectContaining({
            files: expect.objectContaining({
              originalFilename: `test.${extension}`,  // koa-body 6.x uses originalFilename
            }),
          })
        );
        
        vi.clearAllMocks();
      }
    });

    it('throws error when upload returns no file', async () => {
      const { uploadImageBuffer } = await import('../../../src/ai/articles/services/image-uploader');
      
      mockUploadService.upload.mockResolvedValueOnce([]);
      
      const strapi = createMockStrapi(mockUploadService);
      const buffer = createMockJpegBuffer();
      
      await expect(uploadImageBuffer(
        {
          buffer,
          filename: 'test',
          mimeType: 'image/jpeg',
          altText: 'Test',
        },
        { strapi }
      )).rejects.toThrow('Upload service returned no file');
    });

    it('throws error when uploaded file has no URL', async () => {
      const { uploadImageBuffer } = await import('../../../src/ai/articles/services/image-uploader');
      
      mockUploadService.upload.mockResolvedValueOnce([{
        id: 1,
        documentId: 'doc-123',
        // url is missing
      }]);
      
      const strapi = createMockStrapi(mockUploadService);
      const buffer = createMockJpegBuffer();
      
      await expect(uploadImageBuffer(
        {
          buffer,
          filename: 'test',
          mimeType: 'image/jpeg',
          altText: 'Test',
        },
        { strapi }
      )).rejects.toThrow('Uploaded file missing URL');
    });

    it('throws error when uploaded file has invalid ID', async () => {
      const { uploadImageBuffer } = await import('../../../src/ai/articles/services/image-uploader');
      
      mockUploadService.upload.mockResolvedValueOnce([{
        id: 'not-a-number',
        documentId: 'doc-123',
        url: 'https://strapi.example.com/test.jpg',
      }]);
      
      const strapi = createMockStrapi(mockUploadService);
      const buffer = createMockJpegBuffer();
      
      await expect(uploadImageBuffer(
        {
          buffer,
          filename: 'test',
          mimeType: 'image/jpeg',
          altText: 'Test',
        },
        { strapi }
      )).rejects.toThrow('Uploaded file missing valid ID');
    });

    it('uses ID as documentId fallback', async () => {
      const { uploadImageBuffer } = await import('../../../src/ai/articles/services/image-uploader');
      
      mockUploadService.upload.mockResolvedValueOnce([{
        id: 42,
        // documentId is missing
        url: 'https://strapi.example.com/test.jpg',
      }]);
      
      const strapi = createMockStrapi(mockUploadService);
      const buffer = createMockJpegBuffer();
      
      const result = await uploadImageBuffer(
        {
          buffer,
          filename: 'test',
          mimeType: 'image/jpeg',
          altText: 'Test',
        },
        { strapi }
      );
      
      expect(result.documentId).toBe('42');
    });
  });

  describe('uploadImageFromUrl', () => {
    it('downloads image and uploads to Strapi', async () => {
      const { uploadImageFromUrl } = await import('../../../src/ai/articles/services/image-uploader');
      
      const buffer = createMockJpegBuffer();
      mockDownloadImageWithRetry.mockResolvedValueOnce({
        buffer,
        mimeType: 'image/jpeg',
      });
      
      mockUploadService.upload.mockResolvedValueOnce([{
        id: 1,
        documentId: 'doc-123',
        url: 'https://strapi.example.com/uploaded.jpg',
      }]);
      
      const strapi = createMockStrapi(mockUploadService);
      
      const result = await uploadImageFromUrl(
        {
          url: 'https://example.com/source.jpg',
          filename: 'my-image',
          altText: 'Alt text',
        },
        { strapi }
      );
      
      expect(mockDownloadImageWithRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://example.com/source.jpg',
        })
      );
      expect(result.url).toBe('https://strapi.example.com/uploaded.jpg');
    });

    it('adds source domain to caption when not present', async () => {
      const { uploadImageFromUrl } = await import('../../../src/ai/articles/services/image-uploader');
      
      const buffer = createMockJpegBuffer();
      mockDownloadImageWithRetry.mockResolvedValueOnce({
        buffer,
        mimeType: 'image/jpeg',
      });
      
      mockUploadService.upload.mockResolvedValueOnce([{
        id: 1,
        documentId: 'doc-123',
        url: 'https://strapi.example.com/uploaded.jpg',
      }]);
      
      const strapi = createMockStrapi(mockUploadService);
      
      await uploadImageFromUrl(
        {
          url: 'https://example.com/image.jpg',
          filename: 'test',
          altText: 'Test',
          sourceDomain: 'example.com',
        },
        { strapi }
      );
      
      expect(mockUploadService.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {},
        })
      );
      
      // Caption is set via updateFileInfo after upload
      expect(mockUploadService.updateFileInfo).toHaveBeenCalledWith(1, {
        alternativeText: 'Test',
        caption: 'Source: example.com',
      });
    });

    it('appends source domain to existing caption', async () => {
      const { uploadImageFromUrl } = await import('../../../src/ai/articles/services/image-uploader');
      
      const buffer = createMockJpegBuffer();
      mockDownloadImageWithRetry.mockResolvedValueOnce({
        buffer,
        mimeType: 'image/jpeg',
      });
      
      mockUploadService.upload.mockResolvedValueOnce([{
        id: 1,
        documentId: 'doc-123',
        url: 'https://strapi.example.com/uploaded.jpg',
      }]);
      
      const strapi = createMockStrapi(mockUploadService);
      
      await uploadImageFromUrl(
        {
          url: 'https://example.com/image.jpg',
          filename: 'test',
          altText: 'Test',
          caption: 'Original caption',
          sourceDomain: 'example.com',
        },
        { strapi }
      );
      
      expect(mockUploadService.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {},
        })
      );
      
      // Caption with appended source is set via updateFileInfo
      expect(mockUploadService.updateFileInfo).toHaveBeenCalledWith(1, {
        alternativeText: 'Test',
        caption: 'Original caption (Source: example.com)',
      });
    });

    it('does not duplicate source domain in caption', async () => {
      const { uploadImageFromUrl } = await import('../../../src/ai/articles/services/image-uploader');
      
      const buffer = createMockJpegBuffer();
      mockDownloadImageWithRetry.mockResolvedValueOnce({
        buffer,
        mimeType: 'image/jpeg',
      });
      
      mockUploadService.upload.mockResolvedValueOnce([{
        id: 1,
        documentId: 'doc-123',
        url: 'https://strapi.example.com/uploaded.jpg',
      }]);
      
      const strapi = createMockStrapi(mockUploadService);
      
      await uploadImageFromUrl(
        {
          url: 'https://example.com/image.jpg',
          filename: 'test',
          altText: 'Test',
          caption: 'Image from example.com',
          sourceDomain: 'example.com',
        },
        { strapi }
      );
      
      // Should not add (Source: example.com) since caption already contains the domain
      expect(mockUploadService.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {},
        })
      );
      
      // Caption is unchanged since domain already present
      expect(mockUploadService.updateFileInfo).toHaveBeenCalledWith(1, {
        alternativeText: 'Test',
        caption: 'Image from example.com',
      });
    });

    it('passes signal to download function', async () => {
      const { uploadImageFromUrl } = await import('../../../src/ai/articles/services/image-uploader');
      
      const controller = new AbortController();
      const buffer = createMockJpegBuffer();
      
      mockDownloadImageWithRetry.mockResolvedValueOnce({
        buffer,
        mimeType: 'image/jpeg',
      });
      
      mockUploadService.upload.mockResolvedValueOnce([{
        id: 1,
        documentId: 'doc-123',
        url: 'https://strapi.example.com/uploaded.jpg',
      }]);
      
      const strapi = createMockStrapi(mockUploadService);
      
      await uploadImageFromUrl(
        {
          url: 'https://example.com/image.jpg',
          filename: 'test',
          altText: 'Test',
          signal: controller.signal,
        },
        { strapi }
      );
      
      expect(mockDownloadImageWithRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          signal: controller.signal,
        })
      );
    });

    it('propagates download errors', async () => {
      const { uploadImageFromUrl } = await import('../../../src/ai/articles/services/image-uploader');
      
      mockDownloadImageWithRetry.mockRejectedValueOnce(new Error('Download failed'));
      
      const strapi = createMockStrapi(mockUploadService);
      
      await expect(uploadImageFromUrl(
        {
          url: 'https://example.com/image.jpg',
          filename: 'test',
          altText: 'Test',
        },
        { strapi }
      )).rejects.toThrow('Download failed');
    });
  });
});
