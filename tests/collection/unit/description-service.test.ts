/**
 * Collection Description Service Unit Tests
 * 
 * Tests the core logic for generating AI descriptions and syncing locales.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateCollectionDescriptionsAndSync,
  shouldProcessCollectionEvent,
  type CollectionEventData,
  type CollectionDescriptionDependencies,
} from '../../../src/api/collection/services/collection-description';
import type { Core } from '@strapi/strapi';

describe('Collection Description Service', () => {
  describe('shouldProcessCollectionEvent', () => {
    it('should return true for English locale in params', () => {
      expect(shouldProcessCollectionEvent('en', 'en')).toBe(true);
    });

    it('should return true for English locale in result when params.locale is undefined', () => {
      expect(shouldProcessCollectionEvent(undefined, 'en')).toBe(true);
    });

    it('should return false for Spanish locale', () => {
      expect(shouldProcessCollectionEvent('es', 'es')).toBe(false);
    });

    it('should return false for other locales', () => {
      expect(shouldProcessCollectionEvent('fr', 'fr')).toBe(false);
      expect(shouldProcessCollectionEvent('de', 'de')).toBe(false);
    });

    it('should use params.locale over result.locale when both exist', () => {
      expect(shouldProcessCollectionEvent('en', 'es')).toBe(true);
      expect(shouldProcessCollectionEvent('es', 'en')).toBe(false);
    });
  });

  describe('generateCollectionDescriptionsAndSync', () => {
    let mockDeps: CollectionDescriptionDependencies;
    let mockStrapi: Core.Strapi;
    let mockKnex: any;
    
    const testCollection: CollectionEventData = {
      id: 1,
      documentId: 'abc123',
      locale: 'en',
      name: 'The Legend of Zelda: Complete Collection',
      slug: 'legend-of-zelda-complete-collection',
      description: null,
      igdbId: 12345,
      igdbUrl: 'https://www.igdb.com/collections/the-legend-of-zelda-complete-collection',
      parentCollectionDocumentId: null,
    };

    beforeEach(() => {
      mockDeps = {
        isAIConfigured: vi.fn().mockReturnValue(true),
        generateCollectionDescriptions: vi.fn().mockResolvedValue({
          en: 'This collection brings together...',
          es: 'Esta colección reúne...',
        }),
        syncCollectionLocales: vi.fn().mockResolvedValue([
          { locale: 'es', success: true },
        ]),
        log: {
          info: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
      };

      mockKnex = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
      });

      mockStrapi = {
        documents: vi.fn().mockReturnValue({
          update: vi.fn().mockResolvedValue({}),
          publish: vi.fn().mockResolvedValue({}),
        }),
      } as unknown as Core.Strapi;
    });

    it('should still sync locales when AI is not configured', async () => {
      mockDeps.isAIConfigured = vi.fn().mockReturnValue(false);

      const result = await generateCollectionDescriptionsAndSync(
        mockKnex,
        mockStrapi,
        testCollection,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(result.englishDescriptionUpdated).toBe(false);
      // Locale sync should still happen even without AI
      expect(result.localesSynced).toHaveLength(1);
      expect(result.localesSynced[0].success).toBe(true);
      expect(mockDeps.generateCollectionDescriptions).not.toHaveBeenCalled();
      // Locale sync should be called with null description
      expect(mockDeps.syncCollectionLocales).toHaveBeenCalledWith(
        mockStrapi,
        expect.objectContaining({
          aiDescription: null,
        })
      );
    });

    it('should generate descriptions and update English entry', async () => {
      const result = await generateCollectionDescriptionsAndSync(
        mockKnex,
        mockStrapi,
        testCollection,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(result.englishDescriptionUpdated).toBe(true);
      expect(mockDeps.generateCollectionDescriptions).toHaveBeenCalledWith({
        name: 'The Legend of Zelda: Complete Collection',
        parentCollectionName: null,
      });
    });

    it('should sync locales with Spanish description', async () => {
      const result = await generateCollectionDescriptionsAndSync(
        mockKnex,
        mockStrapi,
        testCollection,
        mockDeps
      );

      expect(mockDeps.syncCollectionLocales).toHaveBeenCalledWith(
        mockStrapi,
        expect.objectContaining({
          documentId: 'abc123',
          name: 'The Legend of Zelda: Complete Collection',
          aiDescription: 'Esta colección reúne...',
        })
      );
      expect(result.localesSynced).toHaveLength(1);
      expect(result.localesSynced[0].success).toBe(true);
    });

    it('should handle AI generation errors gracefully and still sync locales', async () => {
      mockDeps.generateCollectionDescriptions = vi.fn().mockRejectedValue(new Error('AI error'));

      const result = await generateCollectionDescriptionsAndSync(
        mockKnex,
        mockStrapi,
        testCollection,
        mockDeps
      );

      // Should succeed because locale sync still happens
      expect(result.success).toBe(true);
      expect(result.englishDescriptionUpdated).toBe(false);
      // Locale sync should still be called even when AI fails
      expect(result.localesSynced).toHaveLength(1);
      expect(result.localesSynced[0].success).toBe(true);
      expect(mockDeps.log.error).toHaveBeenCalled();
    });

    it('should handle document update errors gracefully and still sync locales', async () => {
      mockStrapi = {
        documents: vi.fn().mockReturnValue({
          update: vi.fn().mockRejectedValue(new Error('Update failed')),
          publish: vi.fn().mockResolvedValue({}),
        }),
      } as unknown as Core.Strapi;

      const result = await generateCollectionDescriptionsAndSync(
        mockKnex,
        mockStrapi,
        testCollection,
        mockDeps
      );

      // Should succeed because locale sync still happens
      expect(result.success).toBe(true);
      // Locale sync should be called with null description since AI failed
      expect(result.localesSynced).toHaveLength(1);
      expect(result.localesSynced[0].success).toBe(true);
    });

    it('should handle locale sync errors without failing overall', async () => {
      mockDeps.syncCollectionLocales = vi.fn().mockResolvedValue([
        { locale: 'es', success: false, error: 'Locale sync failed' },
      ]);

      const result = await generateCollectionDescriptionsAndSync(
        mockKnex,
        mockStrapi,
        testCollection,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(result.englishDescriptionUpdated).toBe(true);
      expect(result.localesSynced[0].success).toBe(false);
      expect(result.localesSynced[0].error).toBe('Locale sync failed');
    });

    it('should handle minimal collection data', async () => {
      const minimalCollection: CollectionEventData = {
        id: 2,
        documentId: 'xyz789',
        locale: 'en',
        name: 'Simple Collection',
        slug: 'simple-collection',
        description: null,
        igdbId: null,
        igdbUrl: null,
        parentCollectionDocumentId: null,
      };

      const result = await generateCollectionDescriptionsAndSync(
        mockKnex,
        mockStrapi,
        minimalCollection,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(mockDeps.generateCollectionDescriptions).toHaveBeenCalledWith({
        name: 'Simple Collection',
        parentCollectionName: null,
      });
    });

    it('should include parent collection context when available', async () => {
      const collectionWithParent: CollectionEventData = {
        ...testCollection,
        parentCollectionDocumentId: 'parent-doc-123',
      };

      // Mock the parent collection lookup
      mockKnex = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ name: 'Parent Collection' }),
      });

      const result = await generateCollectionDescriptionsAndSync(
        mockKnex,
        mockStrapi,
        collectionWithParent,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(mockDeps.generateCollectionDescriptions).toHaveBeenCalledWith({
        name: 'The Legend of Zelda: Complete Collection',
        parentCollectionName: 'Parent Collection',
      });
    });

    it('should handle well-known collections', async () => {
      const darkSoulsCollection: CollectionEventData = {
        id: 3,
        documentId: 'dark-souls-doc',
        locale: 'en',
        name: 'Dark Souls Trilogy',
        slug: 'dark-souls-trilogy',
        description: null,
        igdbId: 9999,
        igdbUrl: 'https://www.igdb.com/collections/dark-souls-trilogy',
        parentCollectionDocumentId: null,
      };

      const result = await generateCollectionDescriptionsAndSync(
        mockKnex,
        mockStrapi,
        darkSoulsCollection,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(mockDeps.generateCollectionDescriptions).toHaveBeenCalledWith({
        name: 'Dark Souls Trilogy',
        parentCollectionName: null,
      });
    });
  });
});

