/**
 * Image Downloader Tests
 *
 * Tests for image download with SSRF protection, magic byte validation, and retry logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to test the internal validation functions
// Since they're not exported, we'll test through the public API

describe('Image Downloader', () => {
  // Mock fetch for testing
  const mockFetch = vi.fn();
  
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Helper to create a mock response for successful image download.
   * Accounts for HEAD request (size check) + GET request pattern.
   */
  function mockSuccessfulDownload(buffer: Buffer, mimeType: string) {
    // First call: HEAD request for size check
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-length': String(buffer.length),
      }),
    });

    // Second call: GET request with redirect: 'manual'
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': mimeType,
        'content-length': String(buffer.length),
      }),
      arrayBuffer: () => Promise.resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
    });
  }

  describe('downloadImage', async () => {
    // Lazy import to get fresh module after mocking
    const { downloadImage } = await import('../../../src/ai/articles/services/image-downloader');

    describe('magic byte validation', () => {
      it('accepts valid JPEG image', async () => {
        // JPEG magic bytes: FF D8 FF
        const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(100).fill(0)]);
        mockSuccessfulDownload(jpegBuffer, 'image/jpeg');

        const result = await downloadImage({ url: 'https://example.com/image.jpg' });
        expect(result.mimeType).toBe('image/jpeg');
        expect(result.buffer.length).toBe(jpegBuffer.length);
      });

      it('accepts valid PNG image', async () => {
        // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
        const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(100).fill(0)]);
        mockSuccessfulDownload(pngBuffer, 'image/png');

        const result = await downloadImage({ url: 'https://example.com/image.png' });
        expect(result.mimeType).toBe('image/png');
      });

      it('accepts valid GIF image', async () => {
        // GIF magic bytes: 47 49 46 38 (GIF8)
        const gifBuffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...Array(100).fill(0)]);
        mockSuccessfulDownload(gifBuffer, 'image/gif');

        const result = await downloadImage({ url: 'https://example.com/image.gif' });
        expect(result.mimeType).toBe('image/gif');
      });

      it('accepts valid WebP image', async () => {
        // WebP magic bytes: RIFF....WEBP (52 49 46 46 ... 57 45 42 50)
        const webpBuffer = Buffer.from([
          0x52, 0x49, 0x46, 0x46, // RIFF
          0x00, 0x00, 0x00, 0x00, // file size (placeholder)
          0x57, 0x45, 0x42, 0x50, // WEBP
          ...Array(100).fill(0),
        ]);
        mockSuccessfulDownload(webpBuffer, 'image/webp');

        const result = await downloadImage({ url: 'https://example.com/image.webp' });
        expect(result.mimeType).toBe('image/webp');
      });

      it('rejects non-image content', async () => {
        // HTML content
        const htmlBuffer = Buffer.from('<!DOCTYPE html><html><body>Not an image</body></html>');
        mockSuccessfulDownload(htmlBuffer, 'text/html');

        await expect(downloadImage({ url: 'https://example.com/image.jpg' }))
          .rejects.toThrow('not a valid image');
      });

      it('rejects content with wrong magic bytes', async () => {
        // Random bytes that don't match any image format
        const randomBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03, ...Array(100).fill(0)]);
        mockSuccessfulDownload(randomBuffer, 'image/jpeg');

        await expect(downloadImage({ url: 'https://example.com/image.jpg' }))
          .rejects.toThrow('not a valid image');
      });
    });

    describe('size validation', () => {
      it('rejects images exceeding size limit from HEAD request', async () => {
        // HEAD request returns size over limit
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-length': '15000000', // 15MB, over 10MB limit
          }),
        });

        await expect(downloadImage({ url: 'https://example.com/huge.jpg' }))
          .rejects.toThrow('too large');
      });

      it('uses custom maxSizeBytes option', async () => {
        const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(100).fill(0)]);
        
        // HEAD request passes
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-length': String(jpegBuffer.length),
          }),
        });

        // GET request returns content
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-type': 'image/jpeg',
            'content-length': String(jpegBuffer.length),
          }),
          arrayBuffer: () => Promise.resolve(jpegBuffer.buffer.slice(jpegBuffer.byteOffset, jpegBuffer.byteOffset + jpegBuffer.byteLength)),
        });

        // Should fail with very small limit (actual buffer is larger)
        await expect(downloadImage({ url: 'https://example.com/image.jpg', maxSizeBytes: 10 }))
          .rejects.toThrow('too large');
      });

      it('skips HEAD request when checkSizeFirst is false', async () => {
        const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(100).fill(0)]);
        
        // Only GET request (no HEAD)
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-type': 'image/jpeg',
            'content-length': String(jpegBuffer.length),
          }),
          arrayBuffer: () => Promise.resolve(jpegBuffer.buffer.slice(jpegBuffer.byteOffset, jpegBuffer.byteOffset + jpegBuffer.byteLength)),
        });

        const result = await downloadImage({ 
          url: 'https://example.com/image.jpg',
          checkSizeFirst: false,
        });

        expect(result.mimeType).toBe('image/jpeg');
        expect(mockFetch).toHaveBeenCalledTimes(1); // Only GET, no HEAD
      });
    });

    describe('HTTP errors', () => {
      it('throws on 404', async () => {
        // HEAD request passes
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({}),
        });

        // GET returns 404
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Headers(),
        });

        await expect(downloadImage({ url: 'https://example.com/missing.jpg' }))
          .rejects.toThrow('404');
      });

      it('throws on 500', async () => {
        // HEAD request passes
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({}),
        });

        // GET returns 500
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers(),
        });

        await expect(downloadImage({ url: 'https://example.com/error.jpg' }))
          .rejects.toThrow('500');
      });
    });

    describe('redirect handling', () => {
      it('follows redirects and validates each URL', async () => {
        const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(100).fill(0)]);
        
        // HEAD request passes
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-length': String(jpegBuffer.length),
          }),
        });

        // First GET returns redirect
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 302,
          headers: new Headers({
            'location': 'https://cdn.example.com/image.jpg',
          }),
        });

        // Second GET returns image
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-type': 'image/jpeg',
            'content-length': String(jpegBuffer.length),
          }),
          arrayBuffer: () => Promise.resolve(jpegBuffer.buffer.slice(jpegBuffer.byteOffset, jpegBuffer.byteOffset + jpegBuffer.byteLength)),
        });

        const result = await downloadImage({ url: 'https://example.com/image.jpg' });
        expect(result.mimeType).toBe('image/jpeg');
        expect(mockFetch).toHaveBeenCalledTimes(3); // HEAD + 2 GETs
      });

      it('blocks redirect to private IP', async () => {
        // HEAD request passes
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({}),
        });

        // First GET returns redirect to private IP
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 302,
          headers: new Headers({
            'location': 'http://192.168.1.1/admin',
          }),
        });

        await expect(downloadImage({ url: 'https://example.com/image.jpg' }))
          .rejects.toThrow(); // Should throw SSRFError
      });

      it('blocks redirect to metadata service', async () => {
        // HEAD request passes
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({}),
        });

        // First GET returns redirect to AWS metadata
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 302,
          headers: new Headers({
            'location': 'http://169.254.169.254/latest/meta-data/',
          }),
        });

        await expect(downloadImage({ url: 'https://example.com/image.jpg' }))
          .rejects.toThrow(); // Should throw SSRFError
      });

      it('limits redirect chain', async () => {
        // HEAD request passes
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({}),
        });

        // Create 10 redirects (more than the 5 limit)
        for (let i = 0; i < 10; i++) {
          mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 302,
            headers: new Headers({
              'location': `https://example.com/redirect${i + 1}`,
            }),
          });
        }

        await expect(downloadImage({ url: 'https://example.com/image.jpg' }))
          .rejects.toThrow('Too many redirects');
      });
    });

    describe('SSRF protection', () => {
      it('blocks localhost URLs', async () => {
        await expect(downloadImage({ url: 'http://localhost/image.jpg' }))
          .rejects.toThrow();
      });

      it('blocks private IP URLs', async () => {
        await expect(downloadImage({ url: 'http://192.168.1.1/image.jpg' }))
          .rejects.toThrow();
      });

      it('blocks metadata service URLs', async () => {
        await expect(downloadImage({ url: 'http://169.254.169.254/latest/' }))
          .rejects.toThrow();
      });
    });
  });

  describe('downloadImageWithRetry', async () => {
    const { downloadImageWithRetry } = await import('../../../src/ai/articles/services/image-downloader');

    it('retries on network errors', async () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(100).fill(0)]);
      
      // First attempt: HEAD fails with network error
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));
      
      // Second attempt: HEAD fails
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));
      
      // Third attempt: HEAD passes
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-length': String(jpegBuffer.length),
        }),
      });

      // Third attempt: GET succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'image/jpeg',
          'content-length': String(jpegBuffer.length),
        }),
        arrayBuffer: () => Promise.resolve(jpegBuffer.buffer.slice(jpegBuffer.byteOffset, jpegBuffer.byteOffset + jpegBuffer.byteLength)),
      });

      const result = await downloadImageWithRetry({ 
        url: 'https://example.com/image.jpg',
        maxRetries: 3,
        initialDelayMs: 10, // Short delay for tests
      });

      expect(result.mimeType).toBe('image/jpeg');
      expect(mockFetch).toHaveBeenCalledTimes(4); // 2 failed + HEAD + GET
    });

    it('does not retry on SSRF errors', async () => {
      await expect(downloadImageWithRetry({ 
        url: 'http://localhost/image.jpg',
        maxRetries: 3,
      })).rejects.toThrow();

      // Should fail immediately, no retries
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not retry on validation errors (too large)', async () => {
      // HEAD returns size over limit
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-length': '15000000', // 15MB
        }),
      });

      await expect(downloadImageWithRetry({ 
        url: 'https://example.com/huge.jpg',
        maxRetries: 3,
      })).rejects.toThrow('too large');

      // Should fail immediately after HEAD, no retries
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
