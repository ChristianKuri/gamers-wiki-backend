/**
 * URL Validator Tests
 *
 * Tests for SSRF protection in image downloads.
 */

import { describe, it, expect } from 'vitest';
import { validateImageUrl, SSRFError, isSSRFError } from '../../../src/ai/articles/services/url-validator';

describe('validateImageUrl', () => {
  describe('valid URLs', () => {
    it('allows HTTPS URLs to public domains', () => {
      expect(() => validateImageUrl('https://example.com/image.jpg')).not.toThrow();
      expect(() => validateImageUrl('https://cdn.example.com/path/image.png')).not.toThrow();
    });

    it('allows HTTP for trusted IGDB domain', () => {
      expect(() => validateImageUrl('http://images.igdb.com/igdb/image/upload/t_1080p/abc.jpg')).not.toThrow();
    });

    it('allows HTTPS for IGDB domain', () => {
      expect(() => validateImageUrl('https://images.igdb.com/igdb/image/upload/t_1080p/abc.jpg')).not.toThrow();
    });
  });

  describe('blocks localhost', () => {
    it('blocks localhost hostname', () => {
      expect(() => validateImageUrl('http://localhost/image.jpg')).toThrow(SSRFError);
      expect(() => validateImageUrl('https://localhost/image.jpg')).toThrow(SSRFError);
    });

    it('blocks 127.0.0.1', () => {
      expect(() => validateImageUrl('http://127.0.0.1/image.jpg')).toThrow(SSRFError);
      expect(() => validateImageUrl('https://127.0.0.1:8080/image.jpg')).toThrow(SSRFError);
    });

    it('blocks IPv6 loopback', () => {
      expect(() => validateImageUrl('http://[::1]/image.jpg')).toThrow(SSRFError);
    });
  });

  describe('blocks private IP ranges', () => {
    it('blocks 10.x.x.x range', () => {
      expect(() => validateImageUrl('http://10.0.0.1/image.jpg')).toThrow(SSRFError);
      expect(() => validateImageUrl('http://10.255.255.255/image.jpg')).toThrow(SSRFError);
    });

    it('blocks 192.168.x.x range', () => {
      expect(() => validateImageUrl('http://192.168.0.1/image.jpg')).toThrow(SSRFError);
      expect(() => validateImageUrl('http://192.168.255.255/image.jpg')).toThrow(SSRFError);
    });

    it('blocks 172.16-31.x.x range', () => {
      expect(() => validateImageUrl('http://172.16.0.1/image.jpg')).toThrow(SSRFError);
      expect(() => validateImageUrl('http://172.31.255.255/image.jpg')).toThrow(SSRFError);
    });

    it('allows 172.15.x.x and 172.32.x.x (outside private range)', () => {
      // These would fail on HTTPS requirement, not private IP check
      expect(() => validateImageUrl('https://172.15.0.1/image.jpg')).not.toThrow();
      expect(() => validateImageUrl('https://172.32.0.1/image.jpg')).not.toThrow();
    });
  });

  describe('blocks cloud metadata services', () => {
    it('blocks AWS/GCP metadata endpoint', () => {
      expect(() => validateImageUrl('http://169.254.169.254/latest/meta-data/')).toThrow(SSRFError);
    });

    it('blocks link-local range', () => {
      expect(() => validateImageUrl('http://169.254.0.1/image.jpg')).toThrow(SSRFError);
    });

    it('blocks Google metadata hostname', () => {
      expect(() => validateImageUrl('http://metadata.google.internal/computeMetadata/')).toThrow(SSRFError);
    });
  });

  describe('enforces HTTPS for untrusted domains', () => {
    it('blocks HTTP for non-IGDB domains', () => {
      expect(() => validateImageUrl('http://example.com/image.jpg')).toThrow(SSRFError);
      expect(() => validateImageUrl('http://cdn.example.com/image.jpg')).toThrow(SSRFError);
    });

    it('allows HTTP only for images.igdb.com', () => {
      expect(() => validateImageUrl('http://images.igdb.com/image.jpg')).not.toThrow();
      // Other IGDB subdomains should require HTTPS
      expect(() => validateImageUrl('http://api.igdb.com/image.jpg')).toThrow(SSRFError);
    });
  });

  describe('blocks invalid protocols', () => {
    it('blocks file:// protocol', () => {
      expect(() => validateImageUrl('file:///etc/passwd')).toThrow(SSRFError);
    });

    it('blocks ftp:// protocol', () => {
      expect(() => validateImageUrl('ftp://ftp.example.com/image.jpg')).toThrow(SSRFError);
    });

    it('blocks javascript: protocol', () => {
      expect(() => validateImageUrl('javascript:alert(1)')).toThrow(SSRFError);
    });
  });

  describe('handles malformed URLs', () => {
    it('throws on invalid URL format', () => {
      expect(() => validateImageUrl('not-a-url')).toThrow(SSRFError);
      expect(() => validateImageUrl('')).toThrow(SSRFError);
      expect(() => validateImageUrl('://missing-protocol')).toThrow(SSRFError);
    });
  });

  describe('isSSRFError type guard', () => {
    it('returns true for SSRFError', () => {
      const error = new SSRFError('test');
      expect(isSSRFError(error)).toBe(true);
    });

    it('returns false for regular Error', () => {
      const error = new Error('test');
      expect(isSSRFError(error)).toBe(false);
    });

    it('returns false for non-error values', () => {
      expect(isSSRFError('string')).toBe(false);
      expect(isSSRFError(null)).toBe(false);
      expect(isSSRFError(undefined)).toBe(false);
    });
  });
});
