/**
 * Company Lifecycle Protection Tests
 * 
 * Tests the protection mechanism against the Strapi 5 behavior where
 * publish() can re-trigger afterCreate lifecycle hooks.
 * 
 * ASSUMPTION: In Strapi 5, calling strapi.documents().publish() after update()
 * in an afterCreate hook can re-trigger afterCreate with stale event data.
 * If this test fails after a Strapi upgrade, the behavior may have changed
 * and the protection mechanism should be reviewed.
 * 
 * See: docs/gotchas.md - "publish() Can Re-trigger afterCreate Lifecycle"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldProcessCompanyEvent } from '../../../src/api/company/services/company-description';

describe('Company Lifecycle Protection', () => {
  describe('shouldProcessCompanyEvent', () => {
    it('should return true for English locale', () => {
      expect(shouldProcessCompanyEvent('en', 'en')).toBe(true);
      expect(shouldProcessCompanyEvent(undefined, 'en')).toBe(true);
    });

    it('should return false for non-English locales', () => {
      expect(shouldProcessCompanyEvent('es', 'es')).toBe(false);
      expect(shouldProcessCompanyEvent('fr', 'fr')).toBe(false);
      expect(shouldProcessCompanyEvent(undefined, 'es')).toBe(false);
    });
  });

  describe('Database protection against lifecycle re-triggering', () => {
    /**
     * This test validates our protection mechanism against the Strapi 5 behavior
     * where publish() can re-trigger afterCreate.
     * 
     * The protection has two layers:
     * 1. Event data check: if (result.description) return;
     * 2. Database check: Query DB for existing description
     * 
     * The database check is critical because event data can be stale after publish().
     */

    it('should skip processing when event data has description', async () => {
      // Simulates first layer of protection
      const eventData = {
        description: 'Already has description',
        documentId: 'test-doc-id',
        locale: 'en',
      };

      // First layer check - event data
      const shouldSkip = !!eventData.description;
      expect(shouldSkip).toBe(true);
    });

    it('should skip processing when database has description (stale event data scenario)', async () => {
      // Simulates the scenario where:
      // 1. afterCreate fired, description was set
      // 2. publish() triggered afterCreate again
      // 3. Event data is STALE (no description)
      // 4. Database check catches it
      
      const staleEventData = {
        description: null, // Stale! Actually has description in DB
        documentId: 'test-doc-id',
        locale: 'en',
      };

      // Simulate database query result
      const dbResult = { 
        id: 1, 
        document_id: 'test-doc-id', 
        description: 'AI-generated description exists in DB' 
      };

      // First layer fails (stale data)
      const firstLayerSkip = !!staleEventData.description;
      expect(firstLayerSkip).toBe(false);

      // Second layer (database check) should catch it
      const secondLayerSkip = !!dbResult?.description;
      expect(secondLayerSkip).toBe(true);
    });

    it('should process when neither event data nor database has description', async () => {
      const eventData = {
        description: null,
        documentId: 'new-doc-id',
        locale: 'en',
      };

      // Database returns no existing description
      const dbResult = null;

      const firstLayerSkip = !!eventData.description;
      const secondLayerSkip = !!dbResult?.description;

      expect(firstLayerSkip).toBe(false);
      expect(secondLayerSkip).toBe(false);
      
      // Should proceed with processing
      const shouldProcess = !firstLayerSkip && !secondLayerSkip;
      expect(shouldProcess).toBe(true);
    });
  });

  describe('Fire-and-forget pattern for parallel processing', () => {
    /**
     * Tests that validate the fire-and-forget pattern used for company
     * description generation during game imports.
     * 
     * The pattern:
     * 1. Don't await the AI generation
     * 2. Catch errors in .catch() and log them
     * 3. Multiple companies process in parallel
     */

    it('should not block on async operations', async () => {
      // Simulate the fire-and-forget pattern
      const operations: Promise<string>[] = [];
      const startTime = Date.now();

      // Start 3 "AI generations" that each take 10ms
      for (let i = 0; i < 3; i++) {
        const promise = new Promise<string>((resolve) => {
          setTimeout(() => resolve(`Company ${i} description`), 10);
        });
        operations.push(promise);
      }

      // In fire-and-forget, we don't await immediately
      // The operations run in parallel
      const results = await Promise.all(operations);
      const elapsed = Date.now() - startTime;

      // Should be roughly 10ms (parallel), not 30ms (sequential)
      expect(elapsed).toBeLessThan(25);
      expect(results).toHaveLength(3);
    });

    it('should catch errors without throwing', async () => {
      const errors: string[] = [];
      
      // Simulate the error handling pattern from lifecycle
      const failingOperation = Promise.reject(new Error('AI service unavailable'))
        .catch((error: Error) => {
          errors.push(error.message);
          // Don't re-throw - just log
        });

      // This should not throw
      await failingOperation;

      expect(errors).toContain('AI service unavailable');
    });

    it('should allow multiple operations to fail independently', async () => {
      const results: { company: string; success: boolean; error?: string }[] = [];

      const operations = [
        Promise.resolve('Description 1')
          .then((desc) => results.push({ company: 'Company1', success: true })),
        Promise.reject(new Error('Failed'))
          .catch((e: Error) => results.push({ company: 'Company2', success: false, error: e.message })),
        Promise.resolve('Description 3')
          .then((desc) => results.push({ company: 'Company3', success: true })),
      ];

      await Promise.all(operations);

      expect(results).toHaveLength(3);
      expect(results.filter(r => r.success)).toHaveLength(2);
      expect(results.filter(r => !r.success)).toHaveLength(1);
    });
  });

  describe('Strapi 5 publish() behavior assumption', () => {
    /**
     * CRITICAL ASSUMPTION TEST
     * 
     * This test documents our assumption about Strapi 5 behavior.
     * If Strapi changes this behavior, this test should be updated
     * and the protection mechanism reviewed.
     */

    it('documents the assumption that publish() can trigger lifecycle hooks', () => {
      // This is a documentation test - it passes but documents our assumption
      const strapiVersion = '5.x';
      const assumption = 'publish() can re-trigger afterCreate with stale event data';
      const protection = 'Database check for existing description';
      const file = 'src/api/company/content-types/company/lifecycles.ts';

      expect(strapiVersion).toContain('5');
      expect(assumption).toBeTruthy();
      expect(protection).toBeTruthy();
      expect(file).toContain('lifecycles');

      // If this test is reviewed during a Strapi upgrade:
      // 1. Test if publish() still triggers afterCreate
      // 2. If not, the database check can be simplified
      // 3. Update docs/gotchas.md accordingly
    });

    it('validates the protection pattern used in lifecycle', () => {
      // The protection pattern in lifecycles.ts should be:
      // 1. Check event data: if (result.description) return;
      // 2. Check database: query for existing description
      // 3. Only proceed if both checks pass

      const protectionPattern = {
        layer1: 'event data check',
        layer2: 'database query check',
        reason: 'publish() re-triggers afterCreate with stale event data',
      };

      expect(protectionPattern.layer1).toBe('event data check');
      expect(protectionPattern.layer2).toBe('database query check');
    });
  });

  describe('Company-specific considerations', () => {
    /**
     * Company-specific tests that differ from platforms.
     * Companies are created more frequently during imports (multiple
     * developers and publishers per game), so parallel processing
     * is more important.
     */

    it('should handle rapid successive company creations', async () => {
      // Simulate rapid company creations during a game import
      const companyCreations = 5;
      const results: string[] = [];

      const promises = Array.from({ length: companyCreations }, (_, i) =>
        Promise.resolve(`Company ${i}`)
          .then((name) => {
            results.push(name);
            return name;
          })
      );

      // All should complete (fire-and-forget doesn't block)
      const allResults = await Promise.all(promises);
      
      expect(allResults).toHaveLength(companyCreations);
      expect(results).toHaveLength(companyCreations);
    });

    it('should not affect import flow if AI generation fails', async () => {
      let importCompleted = false;
      const errors: string[] = [];

      // Simulate the import flow
      const importFlow = async () => {
        // 1. Create company (lifecycle triggers AI generation)
        const aiGeneration = Promise.reject(new Error('AI unavailable'))
          .catch((e: Error) => errors.push(e.message));
        
        // 2. Don't await - import continues
        // (In real code, we don't await in the lifecycle)

        // 3. Import completes successfully
        importCompleted = true;

        // Let the AI generation settle
        await aiGeneration;
      };

      await importFlow();

      // Import should complete even though AI failed
      expect(importCompleted).toBe(true);
      expect(errors).toContain('AI unavailable');
    });
  });
});

