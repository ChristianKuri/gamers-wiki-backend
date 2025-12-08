/**
 * Platform Description Service Unit Tests
 * 
 * Tests the platform description generation and locale sync logic
 * with mocked dependencies (no real AI calls or database).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generatePlatformDescriptionsAndSync,
  shouldProcessPlatformEvent,
  type PlatformEventData,
  type PlatformDescriptionDependencies,
} from '../../src/api/platform/services/platform-description';
import type { Core } from '@strapi/strapi';

// Mock Knex query builder
function createMockKnex() {
  const mockUpdate = vi.fn().mockResolvedValue(1);
  const mockWhere = vi.fn().mockReturnValue({ update: mockUpdate });
  const mockKnex = vi.fn().mockReturnValue({ where: mockWhere });
  
  return {
    knex: mockKnex as unknown as ReturnType<typeof vi.fn>,
    where: mockWhere,
    update: mockUpdate,
  };
}

// Mock Strapi instance with document service
function createMockStrapi() {
  const mockUpdate = vi.fn().mockResolvedValue({ id: 1 });
  const mockPublish = vi.fn().mockResolvedValue({ id: 1 });
  // Create documents as a plain function that returns the service object
  const mockDocuments = vi.fn((uid: string) => ({
    update: mockUpdate,
    publish: mockPublish,
  }));
  
  const strapi = {
    log: {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    documents: mockDocuments,
  };
  
  return {
    strapi: strapi as unknown as Core.Strapi,
    mockDocuments,
    mockUpdate,
    mockPublish,
  };
}

// Sample platform data
const samplePlatform: PlatformEventData = {
  id: 123,
  documentId: 'test-doc-id',
  locale: 'en',
  name: 'Nintendo Switch',
  slug: 'nintendo-switch',
  abbreviation: 'NSW',
  manufacturer: 'Nintendo',
  releaseYear: 2017,
  category: 'console',
  igdbId: 130,
  logoUrl: 'https://example.com/logo.png',
  generation: 8,
};

// Sample descriptions
const sampleDescriptions = {
  en: 'The **Nintendo Switch** revolutionized gaming...',
  es: 'La **Nintendo Switch** redefinió el concepto de consola...',
};

describe('Platform Description Service', () => {
  describe('shouldProcessPlatformEvent', () => {
    it('should return true for English locale from params', () => {
      expect(shouldProcessPlatformEvent('en', 'es')).toBe(true);
    });

    it('should return true for English locale from result when params is undefined', () => {
      expect(shouldProcessPlatformEvent(undefined, 'en')).toBe(true);
    });

    it('should return false for Spanish locale', () => {
      expect(shouldProcessPlatformEvent('es', 'es')).toBe(false);
    });

    it('should return false for French locale', () => {
      expect(shouldProcessPlatformEvent('fr', 'en')).toBe(false);
    });

    it('should prioritize params locale over result locale', () => {
      // params says 'es', result says 'en' - should use params
      expect(shouldProcessPlatformEvent('es', 'en')).toBe(false);
    });
  });

  describe('generatePlatformDescriptionsAndSync', () => {
    let mockKnexSetup: ReturnType<typeof createMockKnex>;
    let mockStrapiSetup: ReturnType<typeof createMockStrapi>;
    let mockDeps: PlatformDescriptionDependencies;

    beforeEach(() => {
      mockKnexSetup = createMockKnex();
      mockStrapiSetup = createMockStrapi();
      
      mockDeps = {
        isAIConfigured: vi.fn().mockReturnValue(true),
        generatePlatformDescriptions: vi.fn().mockResolvedValue(sampleDescriptions),
        syncPlatformLocales: vi.fn().mockResolvedValue([
          { locale: 'es', success: true },
        ]),
        log: {
          info: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
      };
    });

    it('should skip when AI is not configured', async () => {
      mockDeps.isAIConfigured = vi.fn().mockReturnValue(false);

      const result = await generatePlatformDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        samplePlatform,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(result.englishDescriptionUpdated).toBe(false);
      expect(result.localesSynced).toEqual([]);
      expect(mockDeps.generatePlatformDescriptions).not.toHaveBeenCalled();
    });

    it('should generate descriptions and update English entry', async () => {
      const result = await generatePlatformDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        samplePlatform,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(result.englishDescriptionUpdated).toBe(true);
      
      // Verify AI was called with correct context
      expect(mockDeps.generatePlatformDescriptions).toHaveBeenCalledWith({
        name: 'Nintendo Switch',
        manufacturer: 'Nintendo',
        releaseYear: 2017,
        category: 'console',
        generation: 8,
        abbreviation: 'NSW',
      });
      
      // Verify Strapi document service update
      expect(mockStrapiSetup.mockDocuments).toHaveBeenCalledWith('api::platform.platform');
      expect(mockStrapiSetup.mockUpdate).toHaveBeenCalledWith({
        documentId: 'test-doc-id',
        locale: 'en',
        data: { description: sampleDescriptions.en },
      });
      
      // Verify publish is called after update
      expect(mockStrapiSetup.mockPublish).toHaveBeenCalledWith({
        documentId: 'test-doc-id',
        locale: 'en',
      });
    });

    it('should sync locales with Spanish description', async () => {
      const result = await generatePlatformDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        samplePlatform,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(result.localesSynced).toEqual([{ locale: 'es', success: true }]);
      
      // Verify locale sync was called with correct data
      expect(mockDeps.syncPlatformLocales).toHaveBeenCalledWith(
        mockStrapiSetup.strapi,
        expect.objectContaining({
          documentId: 'test-doc-id',
          sourceId: 123,
          name: 'Nintendo Switch',
          aiDescription: sampleDescriptions.es,
          platformData: expect.objectContaining({
            slug: 'nintendo-switch',
            manufacturer: 'Nintendo',
            releaseYear: 2017,
          }),
        })
      );
    });

    it('should handle AI generation errors gracefully', async () => {
      mockDeps.generatePlatformDescriptions = vi.fn().mockRejectedValue(
        new Error('API rate limit exceeded')
      );

      const result = await generatePlatformDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        samplePlatform,
        mockDeps
      );

      expect(result.success).toBe(false);
      expect(result.englishDescriptionUpdated).toBe(false);
      expect(result.error).toBe('API rate limit exceeded');
      expect(mockDeps.log.error).toHaveBeenCalled();
    });

    it('should handle document update errors gracefully', async () => {
      mockStrapiSetup.mockUpdate.mockRejectedValue(new Error('Document update failed'));

      const result = await generatePlatformDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        samplePlatform,
        mockDeps
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Document update failed');
    });

    it('should handle locale sync errors gracefully', async () => {
      mockDeps.syncPlatformLocales = vi.fn().mockRejectedValue(
        new Error('Locale sync failed')
      );

      const result = await generatePlatformDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        samplePlatform,
        mockDeps
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Locale sync failed');
    });

    it('should report failed locale sync in results', async () => {
      mockDeps.syncPlatformLocales = vi.fn().mockResolvedValue([
        { locale: 'es', success: false, error: 'Duplicate entry' },
      ]);

      const result = await generatePlatformDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        samplePlatform,
        mockDeps
      );

      expect(result.success).toBe(true); // Main operation succeeded
      expect(result.englishDescriptionUpdated).toBe(true);
      expect(result.localesSynced).toEqual([
        { locale: 'es', success: false, error: 'Duplicate entry' },
      ]);
      expect(mockDeps.log.error).toHaveBeenCalled();
    });

    it('should log all operations', async () => {
      await generatePlatformDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        samplePlatform,
        mockDeps
      );

      // Verify logging happened
      expect(mockDeps.log.info).toHaveBeenCalledWith(
        expect.stringContaining('Generating AI descriptions')
      );
      expect(mockDeps.log.info).toHaveBeenCalledWith(
        expect.stringContaining('Generated EN description')
      );
      expect(mockDeps.log.info).toHaveBeenCalledWith(
        expect.stringContaining('Generated ES description')
      );
      expect(mockDeps.log.info).toHaveBeenCalledWith(
        expect.stringContaining('Updated and published English description')
      );
      expect(mockDeps.log.info).toHaveBeenCalledWith(
        expect.stringContaining('locale created')
      );
    });

    it('should handle platform with minimal data', async () => {
      const minimalPlatform: PlatformEventData = {
        id: 456,
        documentId: 'minimal-doc-id',
        locale: 'en',
        name: 'Test Platform',
        slug: 'test-platform',
        abbreviation: null,
        manufacturer: null,
        releaseYear: null,
        category: null,
        igdbId: null,
        logoUrl: null,
        generation: null,
      };

      const result = await generatePlatformDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        minimalPlatform,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(mockDeps.generatePlatformDescriptions).toHaveBeenCalledWith({
        name: 'Test Platform',
        manufacturer: null,
        releaseYear: null,
        category: null,
        generation: null,
        abbreviation: null,
      });
    });
  });
});

