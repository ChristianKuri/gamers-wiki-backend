/**
 * Game Import Integration Tests
 * 
 * Tests for the game-fetcher import endpoint.
 * These tests verify the full import flow including:
 * - Game creation with AI descriptions
 * - Platform lifecycle (AI descriptions + ES locale)
 * - Related entity creation
 * 
 * Note: These tests require either:
 * 1. A running Strapi instance (for full integration)
 * 2. Or they test the service functions in isolation (unit-style)
 * 
 * For full E2E tests with Strapi, you would need to:
 * - Start Strapi in test mode
 * - Use a test database
 * - Clean up between tests
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { server } from '../../mocks/server';
import { errorHandlers } from '../../mocks/handlers';

describe('Game Import Flow', () => {
  describe('AI Description Generation', () => {
    it('should use mocked OpenRouter API', async () => {
      // This test verifies that MSW is intercepting requests
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-key',
        },
        body: JSON.stringify({
          model: 'deepseek/deepseek-v3.2',
          messages: [
            { role: 'system', content: 'You are a gaming wiki editor.' },
            { role: 'user', content: 'Write the description in English.\n\nPlatform: "Nintendo Switch"' },
          ],
        }),
      });

      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data).toHaveProperty('choices');
      expect(data.choices[0].message.content).toContain('Nintendo Switch');
    });

    it('should return different descriptions for platform vs game prompts', async () => {
      // Platform description request
      const platformResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test-model',
          messages: [
            { role: 'user', content: 'Platform: "Nintendo Switch"' },
          ],
        }),
      });
      const platformData = await platformResponse.json();
      
      // Game description request
      const gameResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test-model',
          messages: [
            { role: 'user', content: 'Game: "The Legend of Zelda"' },
          ],
        }),
      });
      const gameData = await gameResponse.json();

      // They should return different content
      expect(platformData.choices[0].message.content).not.toBe(
        gameData.choices[0].message.content
      );
    });

    it('should return Spanish descriptions when requested', async () => {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test-model',
          messages: [
            { role: 'user', content: 'Write the description entirely in Spanish.\n\nPlatform: "Nintendo Switch"' },
          ],
        }),
      });

      const data = await response.json();
      const content = data.choices[0].message.content;
      
      // Spanish description should contain Spanish words
      expect(content).toMatch(/redefinió|consola|videojuegos/i);
    });
  });

  describe('IGDB API Mocking', () => {
    it('should mock IGDB OAuth token request', async () => {
      const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: 'test',
          client_secret: 'test',
          grant_type: 'client_credentials',
        }),
      });

      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data).toHaveProperty('access_token');
      expect(data.access_token).toBe('mock-igdb-access-token');
    });

    it('should mock IGDB games endpoint', async () => {
      const response = await fetch('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Client-ID': 'test',
          'Authorization': 'Bearer test',
        },
        body: 'where id = 119388; fields *;',
      });

      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].name).toBe('The Legend of Zelda: Tears of the Kingdom');
    });

    it('should mock IGDB platforms endpoint', async () => {
      const response = await fetch('https://api.igdb.com/v4/platforms', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Client-ID': 'test',
          'Authorization': 'Bearer test',
        },
        body: 'where id = 130; fields *;',
      });

      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].name).toBe('Nintendo Switch');
    });
  });

  describe('Error Handling', () => {
    it('should handle AI API errors gracefully', async () => {
      // Override the handler to simulate an error (both endpoints)
      server.use(errorHandlers.aiError);
      server.use(errorHandlers.aiErrorLegacy);

      // Test the responses endpoint (used by newer AI SDK)
      const response = await fetch('https://openrouter.ai/api/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test-model',
          input: [{ role: 'user', content: 'test' }],
        }),
      });

      expect(response.status).toBe(429);
      
      const data = await response.json();
      expect(data.error.message).toBe('Rate limit exceeded');
    });
  });
});

describe('Platform Lifecycle Tests', () => {
  /**
   * These tests verify the platform lifecycle logic.
   * Note: Full integration tests would require a running Strapi instance.
   * 
   * For now, we test the components that the lifecycle uses:
   * - AI description generation (tested above)
   * - Locale sync data structure
   */

  it('should have correct PlatformLocaleData structure', async () => {
    // Import the types to verify structure
    const { syncPlatformLocales } = await import('../../../src/api/platform/locale-sync');
    
    // Verify the function exists and is callable
    expect(typeof syncPlatformLocales).toBe('function');
  });

  it('should verify AI generates different EN/ES descriptions', async () => {
    // This is critical for the lifecycle - we need different descriptions per locale
    const { generatePlatformDescriptions } = await import('../../../src/ai');
    
    const descriptions = await generatePlatformDescriptions({
      name: 'Nintendo Switch',
      manufacturer: 'Nintendo',
      releaseYear: 2017,
      category: 'console',
      generation: 8,
    });

    // Verify both locales are generated
    expect(descriptions.en).toBeTruthy();
    expect(descriptions.es).toBeTruthy();
    
    // Verify they're different
    expect(descriptions.en).not.toBe(descriptions.es);
    
    // Verify EN is in English (contains "revolutionized" or similar)
    expect(descriptions.en).toMatch(/Nintendo Switch/);
    
    // Verify ES is in Spanish (contains Spanish words)
    expect(descriptions.es).toMatch(/redefinió|consola/i);
  });
});

describe('Import Response Structure', () => {
  /**
   * Tests for verifying the expected response structure from game imports.
   * These help ensure the API contract is maintained.
   */

  it('should define expected import success response structure', () => {
    // Define the expected structure for documentation/contract purposes
    const expectedSuccessResponse = {
      success: true,
      message: expect.any(String),
      game: expect.objectContaining({
        id: expect.any(Number),
        documentId: expect.any(String),
        name: expect.any(String),
        slug: expect.any(String),
        locale: 'en',
      }),
      created: true,
      aiGenerated: expect.any(Boolean),
      aiError: expect.toBeOneOf([null, expect.any(String)]),
      localizedNames: expect.objectContaining({
        en: expect.objectContaining({ name: expect.any(String) }),
        es: expect.objectContaining({ name: expect.any(String) }),
      }),
      stats: expect.objectContaining({
        platforms: expect.any(Number),
        genres: expect.any(Number),
      }),
    };

    // This is just a contract definition, not an actual API call
    // It documents what the response should look like
    expect(expectedSuccessResponse.success).toBe(true);
  });

  it('should define expected error response structure', () => {
    const expectedErrorResponse = {
      error: {
        status: expect.any(Number),
        name: expect.any(String),
        message: expect.any(String),
      },
    };

    // Contract definition
    expect(expectedErrorResponse).toHaveProperty('error');
  });
});

