/**
 * Unit tests for folder-service.ts
 *
 * Tests the Media Library folder management functionality:
 * - getOrCreateArticleFolder: Creates nested folder structure
 * - linkFileToFolder: Links uploaded files to folders
 * - Race condition handling: Retry on unique constraint violation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Core } from '@strapi/strapi';

// Mock the shared slugify utility
vi.mock('../../../src/utils/slug', () => ({
  slugify: (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
}));

describe('folder-service', () => {
  let mockStrapi: Core.Strapi;
  let mockFolderQuery: {
    findOne: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let mockFileQuery: {
    update: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetModules();

    mockFolderQuery = {
      findOne: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };

    mockFileQuery = {
      update: vi.fn(),
    };

    mockStrapi = {
      db: {
        query: vi.fn((model: string) => {
          if (model === 'plugin::upload.folder') {
            return mockFolderQuery;
          }
          if (model === 'plugin::upload.file') {
            return mockFileQuery;
          }
          return {};
        }),
      },
    } as unknown as Core.Strapi;
  });

  describe('getOrCreateArticleFolder', () => {
    it('creates nested folder structure when none exists', async () => {
      const { getOrCreateArticleFolder } = await import('../../../src/ai/articles/services/folder-service');

      // All findOne calls return null (no existing folders)
      mockFolderQuery.findOne.mockResolvedValue(null);

      // Mock folder creation with incrementing IDs
      let folderId = 0;
      mockFolderQuery.create.mockImplementation(async ({ data }) => ({
        id: ++folderId,
        ...data,
      }));

      mockFolderQuery.update.mockResolvedValue({});

      const result = await getOrCreateArticleFolder(
        { strapi: mockStrapi },
        'elden-ring',
        'how-to-beat-malenia'
      );

      // Should create 3 folders: /images, /images/elden-ring, /images/elden-ring/how-to-beat-malenia
      expect(mockFolderQuery.create).toHaveBeenCalledTimes(3);

      // First call: /images
      expect(mockFolderQuery.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          name: 'images',
          path: '/images',
        }),
      });

      // Second call: /images/elden-ring
      expect(mockFolderQuery.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          name: 'elden-ring',
          path: '/images/elden-ring',
        }),
      });

      // Third call: /images/elden-ring/how-to-beat-malenia
      expect(mockFolderQuery.create).toHaveBeenNthCalledWith(3, {
        data: expect.objectContaining({
          name: 'how-to-beat-malenia',
          path: '/images/elden-ring/how-to-beat-malenia',
        }),
      });

      // Result should be the article folder
      expect(result).toEqual({
        id: 3,
        path: '/images/elden-ring/how-to-beat-malenia',
        created: true,
      });
    });

    it('returns existing folder without creating when it exists', async () => {
      const { getOrCreateArticleFolder } = await import('../../../src/ai/articles/services/folder-service');

      // All folders already exist
      mockFolderQuery.findOne.mockImplementation(async ({ where }) => {
        if (where.path === '/images') {
          return { id: 1, path: '/images', name: 'images' };
        }
        if (where.path === '/images/elden-ring') {
          return { id: 2, path: '/images/elden-ring', name: 'elden-ring' };
        }
        if (where.path === '/images/elden-ring/how-to-beat-malenia') {
          return { id: 3, path: '/images/elden-ring/how-to-beat-malenia', name: 'how-to-beat-malenia' };
        }
        return null;
      });

      const result = await getOrCreateArticleFolder(
        { strapi: mockStrapi },
        'elden-ring',
        'how-to-beat-malenia'
      );

      // Should not create any folders
      expect(mockFolderQuery.create).not.toHaveBeenCalled();

      // Result should be the existing folder
      expect(result).toEqual({
        id: 3,
        path: '/images/elden-ring/how-to-beat-malenia',
        created: false,
      });
    });

    it('handles race condition by retrying find on unique constraint violation', async () => {
      const { getOrCreateArticleFolder } = await import('../../../src/ai/articles/services/folder-service');

      // Track find calls to simulate race condition
      let findCallCount = 0;
      mockFolderQuery.findOne.mockImplementation(async ({ where }) => {
        findCallCount++;
        // First call for /images: returns null (not found)
        // After race condition (create fails), retry find returns the folder
        if (where.path === '/images') {
          // First time: not found, second time (after race): found
          if (findCallCount === 1) return null;
          return { id: 100, path: '/images', name: 'images' };
        }
        // Other folders exist
        if (where.path === '/images/elden-ring') {
          return { id: 101, path: '/images/elden-ring', name: 'elden-ring' };
        }
        if (where.path === '/images/elden-ring/how-to-beat-malenia') {
          return { id: 102, path: '/images/elden-ring/how-to-beat-malenia', name: 'how-to-beat-malenia' };
        }
        return null;
      });

      // First create throws unique constraint violation (simulates race condition)
      mockFolderQuery.create.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));

      const result = await getOrCreateArticleFolder(
        { strapi: mockStrapi },
        'elden-ring',
        'how-to-beat-malenia'
      );

      // Should have retried the find after the unique constraint error
      expect(findCallCount).toBeGreaterThan(1);

      // Result should be the article folder
      expect(result).toEqual({
        id: 102,
        path: '/images/elden-ring/how-to-beat-malenia',
        created: false,
      });
    });

    it('sanitizes slugs with special characters', async () => {
      const { getOrCreateArticleFolder } = await import('../../../src/ai/articles/services/folder-service');

      mockFolderQuery.findOne.mockResolvedValue(null);

      let folderId = 0;
      mockFolderQuery.create.mockImplementation(async ({ data }) => ({
        id: ++folderId,
        ...data,
      }));
      mockFolderQuery.update.mockResolvedValue({});

      await getOrCreateArticleFolder(
        { strapi: mockStrapi },
        'Clair Obscur: Expedition 33',
        'How to Beat Simon!!!'
      );

      // Should sanitize to lowercase with hyphens
      expect(mockFolderQuery.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          name: 'clair-obscur-expedition-33',
          path: '/images/clair-obscur-expedition-33',
        }),
      });

      expect(mockFolderQuery.create).toHaveBeenNthCalledWith(3, {
        data: expect.objectContaining({
          name: 'how-to-beat-simon',
          path: '/images/clair-obscur-expedition-33/how-to-beat-simon',
        }),
      });
    });

    it('re-throws non-unique-constraint errors', async () => {
      const { getOrCreateArticleFolder } = await import('../../../src/ai/articles/services/folder-service');

      mockFolderQuery.findOne.mockResolvedValue(null);
      mockFolderQuery.create.mockRejectedValue(new Error('Database connection failed'));

      await expect(
        getOrCreateArticleFolder(
          { strapi: mockStrapi },
          'elden-ring',
          'test-article'
        )
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('linkFileToFolder', () => {
    it('updates file with folder relation and folderPath', async () => {
      const { linkFileToFolder } = await import('../../../src/ai/articles/services/folder-service');

      mockFileQuery.update.mockResolvedValue({});

      await linkFileToFolder(
        { strapi: mockStrapi },
        42,
        5,
        '/images/elden-ring/how-to-beat-malenia'
      );

      expect(mockFileQuery.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: {
          folderPath: '/images/elden-ring/how-to-beat-malenia',
          folder: 5,
        },
      });
    });
  });

  describe('generatePathId', () => {
    it('generates valid random pathId within PostgreSQL integer range', async () => {
      const { getOrCreateArticleFolder } = await import('../../../src/ai/articles/services/folder-service');

      mockFolderQuery.findOne.mockResolvedValue(null);
      
      const pathIds: number[] = [];
      mockFolderQuery.create.mockImplementation(async ({ data }) => {
        pathIds.push(data.pathId);
        return { id: 1, ...data };
      });
      mockFolderQuery.update.mockResolvedValue({});

      await getOrCreateArticleFolder(
        { strapi: mockStrapi },
        'test-game',
        'test-article'
      );

      // All pathIds should be positive integers within PostgreSQL integer range
      for (const pathId of pathIds) {
        expect(pathId).toBeGreaterThan(0);
        expect(pathId).toBeLessThanOrEqual(2147483647); // PostgreSQL integer max
      }
    });
  });
});
