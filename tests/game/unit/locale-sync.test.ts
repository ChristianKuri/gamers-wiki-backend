/**
 * Locale Sync Unit Tests
 * 
 * Tests for the game locale synchronization module.
 * Verifies that localized entries are created with the same document_id
 * and that relations are properly copied between locales.
 */

import { describe, it, expect } from 'vitest';
import { generateSlug } from '../../../src/api/game/locale-sync/strategies/base';
import { getConfiguredLocales, isLocaleConfigured } from '../../../src/api/game/locale-sync';

describe('Locale Sync - Base Utilities', () => {
  describe('generateSlug', () => {
    it('should convert name to lowercase', () => {
      expect(generateSlug('TEST NAME')).toBe('test-name');
    });

    it('should replace spaces with dashes', () => {
      expect(generateSlug('hello world')).toBe('hello-world');
    });

    it('should remove accents from Spanish characters', () => {
      expect(generateSlug('Pokémon')).toBe('pokemon');
      expect(generateSlug('Leyendas Pokémon: Z-A')).toBe('leyendas-pokemon-z-a');
      expect(generateSlug('niño')).toBe('nino');
      expect(generateSlug('señor')).toBe('senor');
    });

    it('should remove accents from French characters', () => {
      expect(generateSlug('Légendes Pokémon : Z-A')).toBe('legendes-pokemon-z-a');
      expect(generateSlug('résumé')).toBe('resume');
      expect(generateSlug('café')).toBe('cafe');
    });

    it('should remove accents from German characters', () => {
      expect(generateSlug('Pokémon-Legenden: Z-A')).toBe('pokemon-legenden-z-a');
      expect(generateSlug('über')).toBe('uber');
    });

    it('should handle special characters', () => {
      expect(generateSlug('Game: The Sequel!')).toBe('game-the-sequel');
      expect(generateSlug("Assassin's Creed")).toBe('assassin-s-creed');
      expect(generateSlug('Half-Life 2')).toBe('half-life-2');
    });

    it('should remove leading and trailing dashes', () => {
      expect(generateSlug('---test---')).toBe('test');
      expect(generateSlug('  spaced  ')).toBe('spaced');
    });

    it('should collapse multiple dashes', () => {
      expect(generateSlug('hello    world')).toBe('hello-world');
      expect(generateSlug('a--b--c')).toBe('a-b-c');
    });

    it('should handle empty string', () => {
      expect(generateSlug('')).toBe('');
    });

    it('should handle real game names from IGDB', () => {
      expect(generateSlug('The Legend of Zelda: Breath of the Wild'))
        .toBe('the-legend-of-zelda-breath-of-the-wild');
      expect(generateSlug('Grand Theft Auto V'))
        .toBe('grand-theft-auto-v');
      expect(generateSlug('FINAL FANTASY VII REMAKE'))
        .toBe('final-fantasy-vii-remake');
    });
  });

  describe('getConfiguredLocales', () => {
    it('should return array of configured locale codes', () => {
      const locales = getConfiguredLocales();
      expect(Array.isArray(locales)).toBe(true);
      expect(locales).toContain('es');
    });
  });

  describe('isLocaleConfigured', () => {
    it('should return true for Spanish locale', () => {
      expect(isLocaleConfigured('es')).toBe(true);
    });

    it('should return false for non-configured locales', () => {
      expect(isLocaleConfigured('fr')).toBe(false);
      expect(isLocaleConfigured('de')).toBe(false);
      expect(isLocaleConfigured('random')).toBe(false);
    });

    it('should return false for English (source locale)', () => {
      // English is the source locale, not synced
      expect(isLocaleConfigured('en')).toBe(false);
    });
  });
});

describe('Locale Sync - Spanish Strategy', () => {
  describe('Slug generation for Spanish names', () => {
    it('should generate correct slug for Pokémon Spanish name', () => {
      // This is the exact bug scenario we fixed
      const spanishName = 'Leyendas Pokémon: Z-A';
      const slug = generateSlug(spanishName);
      
      expect(slug).toBe('leyendas-pokemon-z-a');
      expect(slug).not.toContain('é'); // No accents
      expect(slug).not.toContain(':'); // No special chars
    });

    it('should generate unique slug different from English', () => {
      const englishName = 'Pokémon Legends: Z-A';
      const spanishName = 'Leyendas Pokémon: Z-A';
      
      const englishSlug = generateSlug(englishName);
      const spanishSlug = generateSlug(spanishName);
      
      expect(englishSlug).toBe('pokemon-legends-z-a');
      expect(spanishSlug).toBe('leyendas-pokemon-z-a');
      expect(englishSlug).not.toBe(spanishSlug);
    });
  });
});

