/**
 * AI Service Unit Tests
 * 
 * Tests for the AI description generation service.
 * Uses MSW to mock OpenRouter API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isAIConfigured,
  generatePlatformDescription,
  generatePlatformDescriptions,
  generateGameDescription,
  generateGameDescriptions,
  getAIStatus,
} from '../../src/ai';
import type { PlatformDescriptionContext, GameDescriptionContext } from '../../src/ai';

describe('AI Service', () => {
  describe('isAIConfigured', () => {
    const originalEnv = process.env.OPENROUTER_API_KEY;

    afterEach(() => {
      // Restore original env
      if (originalEnv) {
        process.env.OPENROUTER_API_KEY = originalEnv;
      }
    });

    it('should return true when OPENROUTER_API_KEY is set', () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      expect(isAIConfigured()).toBe(true);
    });

    it('should return false when OPENROUTER_API_KEY is empty', () => {
      process.env.OPENROUTER_API_KEY = '';
      expect(isAIConfigured()).toBe(false);
    });
  });

  describe('getAIStatus', () => {
    it('should return configuration status with task information', () => {
      const status = getAIStatus();
      
      expect(status).toHaveProperty('configured');
      expect(status).toHaveProperty('tasks');
      expect(status.tasks).toHaveProperty('game-descriptions');
      expect(status.tasks).toHaveProperty('platform-descriptions');
      
      // Check game descriptions task
      expect(status.tasks['game-descriptions']).toHaveProperty('name', 'Game Descriptions');
      expect(status.tasks['game-descriptions']).toHaveProperty('model');
      expect(status.tasks['game-descriptions']).toHaveProperty('envVar', 'AI_MODEL_GAME_DESCRIPTIONS');
      
      // Check platform descriptions task
      expect(status.tasks['platform-descriptions']).toHaveProperty('name', 'Platform Descriptions');
      expect(status.tasks['platform-descriptions']).toHaveProperty('model');
      expect(status.tasks['platform-descriptions']).toHaveProperty('envVar', 'AI_MODEL_PLATFORM_DESCRIPTIONS');
    });
  });

  describe('generatePlatformDescription', () => {
    const platformContext: PlatformDescriptionContext = {
      name: 'Nintendo Switch',
      manufacturer: 'Nintendo',
      releaseYear: 2017,
      category: 'console',
      generation: 8,
      abbreviation: 'NSW',
    };

    it('should generate English platform description', async () => {
      const description = await generatePlatformDescription(platformContext, 'en');
      
      expect(description).toBeTruthy();
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(100);
      // Check for markdown formatting (mocked response includes **bold**)
      expect(description).toContain('Nintendo Switch');
    });

    it('should generate Spanish platform description', async () => {
      const description = await generatePlatformDescription(platformContext, 'es');
      
      expect(description).toBeTruthy();
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(100);
      // Spanish description should contain Spanish words
      expect(description).toMatch(/redefinió|consola|videojuegos|jugadores/i);
    });
  });

  describe('generatePlatformDescriptions', () => {
    const platformContext: PlatformDescriptionContext = {
      name: 'Nintendo Switch',
      manufacturer: 'Nintendo',
      releaseYear: 2017,
      category: 'console',
      generation: 8,
      abbreviation: 'NSW',
    };

    it('should generate descriptions for both locales', async () => {
      const descriptions = await generatePlatformDescriptions(platformContext);
      
      expect(descriptions).toHaveProperty('en');
      expect(descriptions).toHaveProperty('es');
      expect(descriptions.en).toBeTruthy();
      expect(descriptions.es).toBeTruthy();
      expect(descriptions.en.length).toBeGreaterThan(100);
      expect(descriptions.es.length).toBeGreaterThan(100);
    });

    it('should generate different content for EN and ES', async () => {
      const descriptions = await generatePlatformDescriptions(platformContext);
      
      // EN and ES should be different (not just the same text)
      expect(descriptions.en).not.toBe(descriptions.es);
    });

    it('should return English description in descriptions.en (not Spanish)', async () => {
      const descriptions = await generatePlatformDescriptions(platformContext);
      
      // English description should NOT contain Spanish words
      // This test catches the bug where EN description comes out in Spanish
      expect(descriptions.en).not.toMatch(/redefinió|consola de videojuegos|jugadores|ofrecer/i);
      
      // English description should contain English words
      expect(descriptions.en).toMatch(/revolutionized|gaming|console|features/i);
    });

    it('should return Spanish description in descriptions.es (not English)', async () => {
      const descriptions = await generatePlatformDescriptions(platformContext);
      
      // Spanish description should contain Spanish words
      expect(descriptions.es).toMatch(/redefinió|consola|videojuegos|jugadores/i);
      
      // Spanish description should NOT be the same as English
      expect(descriptions.es).not.toMatch(/^The \*\*Nintendo Switch\*\* revolutionized/);
    });
  });

  describe('generateGameDescription', () => {
    const gameContext: GameDescriptionContext = {
      name: 'The Legend of Zelda: Tears of the Kingdom',
      igdbDescription: 'The sequel to The Legend of Zelda: Breath of the Wild.',
      genres: ['Adventure', 'Action'],
      platforms: ['Nintendo Switch'],
      releaseDate: '2023-05-12',
      developer: 'Nintendo EPD',
      publisher: 'Nintendo',
    };

    it('should generate English game description', async () => {
      const description = await generateGameDescription(gameContext, 'en');
      
      expect(description).toBeTruthy();
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(100);
      expect(description).toContain('Legend of Zelda');
    });

    it('should generate Spanish game description', async () => {
      const description = await generateGameDescription(gameContext, 'es');
      
      expect(description).toBeTruthy();
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(100);
      // Spanish description should contain Spanish words
      expect(description).toMatch(/logro|diseño|mundos|jugador/i);
    });
  });

  describe('generateGameDescriptions', () => {
    const gameContext: GameDescriptionContext = {
      name: 'The Legend of Zelda: Tears of the Kingdom',
      igdbDescription: 'The sequel to The Legend of Zelda: Breath of the Wild.',
      genres: ['Adventure', 'Action'],
      platforms: ['Nintendo Switch'],
      releaseDate: '2023-05-12',
      developer: 'Nintendo EPD',
      publisher: 'Nintendo',
    };

    it('should generate descriptions for both locales', async () => {
      const descriptions = await generateGameDescriptions(gameContext);
      
      expect(descriptions).toHaveProperty('en');
      expect(descriptions).toHaveProperty('es');
      expect(descriptions.en).toBeTruthy();
      expect(descriptions.es).toBeTruthy();
    });

    it('should generate different content for EN and ES', async () => {
      const descriptions = await generateGameDescriptions(gameContext);
      
      expect(descriptions.en).not.toBe(descriptions.es);
    });
  });
});

describe('AI Service Error Handling', () => {
  it('should throw when API key is not configured', async () => {
    // Temporarily remove API key
    const originalKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = '';
    
    const context: PlatformDescriptionContext = {
      name: 'Test Platform',
    };
    
    await expect(generatePlatformDescription(context, 'en'))
      .rejects.toThrow('OpenRouter API key not configured');
    
    // Restore
    process.env.OPENROUTER_API_KEY = originalKey;
  });
});

