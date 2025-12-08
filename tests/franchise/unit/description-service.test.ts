/**
 * Franchise Description Service Unit Tests
 * 
 * Tests the franchise description generation and locale sync logic
 * with mocked dependencies (no real AI calls or database).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateFranchiseDescriptionsAndSync,
  shouldProcessFranchiseEvent,
  type FranchiseEventData,
  type FranchiseDescriptionDependencies,
} from '../../../src/api/franchise/services/franchise-description';
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

// Sample franchise data
const sampleFranchise: FranchiseEventData = {
  id: 123,
  documentId: 'test-doc-id',
  locale: 'en',
  name: 'The Legend of Zelda',
  slug: 'the-legend-of-zelda',
  description: null,
  igdbId: 1234,
  igdbUrl: 'https://igdb.com/franchises/the-legend-of-zelda',
};

// Sample descriptions
const sampleDescriptions = {
  en: '**The Legend of Zelda** is one of gaming\'s most iconic franchises, created by Nintendo...',
  es: '**The Legend of Zelda** es una de las franquicias más icónicas de los videojuegos, creada por Nintendo...',
};

describe('Franchise Description Service', () => {
  describe('shouldProcessFranchiseEvent', () => {
    it('should return true for English locale from params', () => {
      expect(shouldProcessFranchiseEvent('en', 'es')).toBe(true);
    });

    it('should return true for English locale from result when params is undefined', () => {
      expect(shouldProcessFranchiseEvent(undefined, 'en')).toBe(true);
    });

    it('should return false for Spanish locale', () => {
      expect(shouldProcessFranchiseEvent('es', 'es')).toBe(false);
    });

    it('should return false for French locale', () => {
      expect(shouldProcessFranchiseEvent('fr', 'en')).toBe(false);
    });

    it('should prioritize params locale over result locale', () => {
      // params says 'es', result says 'en' - should use params
      expect(shouldProcessFranchiseEvent('es', 'en')).toBe(false);
    });
  });

  describe('generateFranchiseDescriptionsAndSync', () => {
    let mockKnexSetup: ReturnType<typeof createMockKnex>;
    let mockStrapiSetup: ReturnType<typeof createMockStrapi>;
    let mockDeps: FranchiseDescriptionDependencies;

    beforeEach(() => {
      mockKnexSetup = createMockKnex();
      mockStrapiSetup = createMockStrapi();
      
      mockDeps = {
        isAIConfigured: vi.fn().mockReturnValue(true),
        generateFranchiseDescriptions: vi.fn().mockResolvedValue(sampleDescriptions),
        syncFranchiseLocales: vi.fn().mockResolvedValue([
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

      const result = await generateFranchiseDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        sampleFranchise,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(result.englishDescriptionUpdated).toBe(false);
      expect(result.localesSynced).toEqual([]);
      expect(mockDeps.generateFranchiseDescriptions).not.toHaveBeenCalled();
    });

    it('should generate descriptions and update English entry', async () => {
      const result = await generateFranchiseDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        sampleFranchise,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(result.englishDescriptionUpdated).toBe(true);
      
      // Verify AI was called with correct context
      expect(mockDeps.generateFranchiseDescriptions).toHaveBeenCalledWith({
        name: 'The Legend of Zelda',
      });
      
      // Verify Strapi document service update
      expect(mockStrapiSetup.mockDocuments).toHaveBeenCalledWith('api::franchise.franchise');
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
      const result = await generateFranchiseDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        sampleFranchise,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(result.localesSynced).toEqual([{ locale: 'es', success: true }]);
      
      // Verify locale sync was called with correct data
      expect(mockDeps.syncFranchiseLocales).toHaveBeenCalledWith(
        mockStrapiSetup.strapi,
        expect.objectContaining({
          documentId: 'test-doc-id',
          sourceId: 123,
          name: 'The Legend of Zelda',
          aiDescription: sampleDescriptions.es,
          franchiseData: expect.objectContaining({
            slug: 'the-legend-of-zelda',
            igdbId: 1234,
          }),
        })
      );
    });

    it('should handle AI generation errors gracefully', async () => {
      mockDeps.generateFranchiseDescriptions = vi.fn().mockRejectedValue(
        new Error('API rate limit exceeded')
      );

      const result = await generateFranchiseDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        sampleFranchise,
        mockDeps
      );

      expect(result.success).toBe(false);
      expect(result.englishDescriptionUpdated).toBe(false);
      expect(result.error).toBe('API rate limit exceeded');
      expect(mockDeps.log.error).toHaveBeenCalled();
    });

    it('should handle document update errors gracefully', async () => {
      mockStrapiSetup.mockUpdate.mockRejectedValue(new Error('Document update failed'));

      const result = await generateFranchiseDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        sampleFranchise,
        mockDeps
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Document update failed');
    });

    it('should handle locale sync errors gracefully', async () => {
      mockDeps.syncFranchiseLocales = vi.fn().mockRejectedValue(
        new Error('Locale sync failed')
      );

      const result = await generateFranchiseDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        sampleFranchise,
        mockDeps
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Locale sync failed');
    });

    it('should report failed locale sync in results', async () => {
      mockDeps.syncFranchiseLocales = vi.fn().mockResolvedValue([
        { locale: 'es', success: false, error: 'Duplicate entry' },
      ]);

      const result = await generateFranchiseDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        sampleFranchise,
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
      await generateFranchiseDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        sampleFranchise,
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

    it('should handle franchise with minimal data', async () => {
      const minimalFranchise: FranchiseEventData = {
        id: 456,
        documentId: 'minimal-doc-id',
        locale: 'en',
        name: 'Test Franchise',
        slug: 'test-franchise',
        description: null,
        igdbId: null,
        igdbUrl: null,
      };

      const result = await generateFranchiseDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        minimalFranchise,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(mockDeps.generateFranchiseDescriptions).toHaveBeenCalledWith({
        name: 'Test Franchise',
      });
    });

    it('should handle well-known gaming franchises', async () => {
      const marioFranchise: FranchiseEventData = {
        id: 789,
        documentId: 'mario-doc-id',
        locale: 'en',
        name: 'Super Mario',
        slug: 'super-mario',
        description: null,
        igdbId: 24,
        igdbUrl: 'https://igdb.com/franchises/super-mario',
      };

      const result = await generateFranchiseDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        marioFranchise,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(mockDeps.generateFranchiseDescriptions).toHaveBeenCalledWith({
        name: 'Super Mario',
      });
    });
  });
});

