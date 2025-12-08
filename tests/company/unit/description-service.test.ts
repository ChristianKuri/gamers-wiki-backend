/**
 * Company Description Service Unit Tests
 * 
 * Tests the company description generation and locale sync logic
 * with mocked dependencies (no real AI calls or database).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateCompanyDescriptionsAndSync,
  shouldProcessCompanyEvent,
  type CompanyEventData,
  type CompanyDescriptionDependencies,
} from '../../../src/api/company/services/company-description';
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

// Sample company data
const sampleCompany: CompanyEventData = {
  id: 123,
  documentId: 'test-doc-id',
  locale: 'en',
  name: 'FromSoftware',
  slug: 'fromsoftware',
  description: null,
  logoUrl: 'https://example.com/logo.png',
  country: 'Japan',
  foundedYear: 1986,
  igdbId: 1234,
  igdbUrl: 'https://igdb.com/companies/fromsoftware',
};

// Sample descriptions
const sampleDescriptions = {
  en: '**FromSoftware** is a renowned Japanese video game developer known for creating challenging action RPGs...',
  es: '**FromSoftware** es un prestigioso desarrollador de videojuegos japonés conocido por crear RPGs de acción desafiantes...',
};

describe('Company Description Service', () => {
  describe('shouldProcessCompanyEvent', () => {
    it('should return true for English locale from params', () => {
      expect(shouldProcessCompanyEvent('en', 'es')).toBe(true);
    });

    it('should return true for English locale from result when params is undefined', () => {
      expect(shouldProcessCompanyEvent(undefined, 'en')).toBe(true);
    });

    it('should return false for Spanish locale', () => {
      expect(shouldProcessCompanyEvent('es', 'es')).toBe(false);
    });

    it('should return false for French locale', () => {
      expect(shouldProcessCompanyEvent('fr', 'en')).toBe(false);
    });

    it('should prioritize params locale over result locale', () => {
      // params says 'es', result says 'en' - should use params
      expect(shouldProcessCompanyEvent('es', 'en')).toBe(false);
    });
  });

  describe('generateCompanyDescriptionsAndSync', () => {
    let mockKnexSetup: ReturnType<typeof createMockKnex>;
    let mockStrapiSetup: ReturnType<typeof createMockStrapi>;
    let mockDeps: CompanyDescriptionDependencies;

    beforeEach(() => {
      mockKnexSetup = createMockKnex();
      mockStrapiSetup = createMockStrapi();
      
      mockDeps = {
        isAIConfigured: vi.fn().mockReturnValue(true),
        generateCompanyDescriptions: vi.fn().mockResolvedValue(sampleDescriptions),
        syncCompanyLocales: vi.fn().mockResolvedValue([
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

      const result = await generateCompanyDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        sampleCompany,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(result.englishDescriptionUpdated).toBe(false);
      expect(result.localesSynced).toEqual([]);
      expect(mockDeps.generateCompanyDescriptions).not.toHaveBeenCalled();
    });

    it('should generate descriptions and update English entry', async () => {
      const result = await generateCompanyDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        sampleCompany,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(result.englishDescriptionUpdated).toBe(true);
      
      // Verify AI was called with correct context
      expect(mockDeps.generateCompanyDescriptions).toHaveBeenCalledWith({
        name: 'FromSoftware',
        country: 'Japan',
        foundedYear: 1986,
      });
      
      // Verify Strapi document service update
      expect(mockStrapiSetup.mockDocuments).toHaveBeenCalledWith('api::company.company');
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
      const result = await generateCompanyDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        sampleCompany,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(result.localesSynced).toEqual([{ locale: 'es', success: true }]);
      
      // Verify locale sync was called with correct data
      expect(mockDeps.syncCompanyLocales).toHaveBeenCalledWith(
        mockStrapiSetup.strapi,
        expect.objectContaining({
          documentId: 'test-doc-id',
          sourceId: 123,
          name: 'FromSoftware',
          aiDescription: sampleDescriptions.es,
          companyData: expect.objectContaining({
            slug: 'fromsoftware',
            country: 'Japan',
            foundedYear: 1986,
          }),
        })
      );
    });

    it('should handle AI generation errors gracefully', async () => {
      mockDeps.generateCompanyDescriptions = vi.fn().mockRejectedValue(
        new Error('API rate limit exceeded')
      );

      const result = await generateCompanyDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        sampleCompany,
        mockDeps
      );

      expect(result.success).toBe(false);
      expect(result.englishDescriptionUpdated).toBe(false);
      expect(result.error).toBe('API rate limit exceeded');
      expect(mockDeps.log.error).toHaveBeenCalled();
    });

    it('should handle document update errors gracefully', async () => {
      mockStrapiSetup.mockUpdate.mockRejectedValue(new Error('Document update failed'));

      const result = await generateCompanyDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        sampleCompany,
        mockDeps
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Document update failed');
    });

    it('should handle locale sync errors gracefully', async () => {
      mockDeps.syncCompanyLocales = vi.fn().mockRejectedValue(
        new Error('Locale sync failed')
      );

      const result = await generateCompanyDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        sampleCompany,
        mockDeps
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Locale sync failed');
    });

    it('should report failed locale sync in results', async () => {
      mockDeps.syncCompanyLocales = vi.fn().mockResolvedValue([
        { locale: 'es', success: false, error: 'Duplicate entry' },
      ]);

      const result = await generateCompanyDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        sampleCompany,
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
      await generateCompanyDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        sampleCompany,
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

    it('should handle company with minimal data', async () => {
      const minimalCompany: CompanyEventData = {
        id: 456,
        documentId: 'minimal-doc-id',
        locale: 'en',
        name: 'Test Company',
        slug: 'test-company',
        description: null,
        logoUrl: null,
        country: null,
        foundedYear: null,
        igdbId: null,
        igdbUrl: null,
      };

      const result = await generateCompanyDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        minimalCompany,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(mockDeps.generateCompanyDescriptions).toHaveBeenCalledWith({
        name: 'Test Company',
        country: null,
        foundedYear: null,
      });
    });

    it('should handle well-known gaming companies', async () => {
      const nintendoCompany: CompanyEventData = {
        id: 789,
        documentId: 'nintendo-doc-id',
        locale: 'en',
        name: 'Nintendo',
        slug: 'nintendo',
        description: null,
        logoUrl: 'https://example.com/nintendo-logo.png',
        country: 'Japan',
        foundedYear: 1889,
        igdbId: 70,
        igdbUrl: 'https://igdb.com/companies/nintendo',
      };

      const result = await generateCompanyDescriptionsAndSync(
        mockKnexSetup.knex as any,
        mockStrapiSetup.strapi,
        nintendoCompany,
        mockDeps
      );

      expect(result.success).toBe(true);
      expect(mockDeps.generateCompanyDescriptions).toHaveBeenCalledWith({
        name: 'Nintendo',
        country: 'Japan',
        foundedYear: 1889,
      });
    });
  });
});

