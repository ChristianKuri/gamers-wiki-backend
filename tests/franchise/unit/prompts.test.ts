/**
 * Franchise Prompt Unit Tests
 * 
 * Tests that prompts are correctly built with language instructions.
 * These tests verify the prompt content before it's sent to the AI.
 */

import { describe, it, expect } from 'vitest';
import { franchiseDescriptionsConfig } from '../../../src/ai/config/franchise-descriptions';
import type { FranchiseDescriptionContext } from '../../../src/ai/config/types';

describe('Franchise Description Prompts', () => {
  const context: FranchiseDescriptionContext = {
    name: 'The Legend of Zelda',
    notableGames: ['Ocarina of Time', 'Breath of the Wild', 'Tears of the Kingdom'],
    developer: 'Nintendo',
    publisher: 'Nintendo',
    firstReleaseYear: 1986,
    genres: ['Action-adventure', 'Puzzle'],
  };

  describe('buildPrompt', () => {
    it('should include English language instruction for EN locale', () => {
      const prompt = franchiseDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('Write the description in English');
      expect(prompt).not.toContain('Write the description entirely in Spanish');
    });

    it('should include Spanish language instruction for ES locale', () => {
      const prompt = franchiseDescriptionsConfig.buildPrompt(context, 'es');
      
      expect(prompt).toContain('Write the description entirely in Spanish');
      expect(prompt).not.toContain('Write the description in English.');
    });

    it('should include franchise name in prompt', () => {
      const prompt = franchiseDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('Franchise: "The Legend of Zelda"');
    });

    it('should include notable games when provided', () => {
      const prompt = franchiseDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('Notable Games in the Franchise: Ocarina of Time, Breath of the Wild, Tears of the Kingdom');
    });

    it('should include developer when provided', () => {
      const prompt = franchiseDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('Primary Developer: Nintendo');
    });

    it('should include publisher when provided', () => {
      const prompt = franchiseDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('Publisher: Nintendo');
    });

    it('should include first release year when provided', () => {
      const prompt = franchiseDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('First Release Year: 1986');
    });

    it('should include genres when provided', () => {
      const prompt = franchiseDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('Genres: Action-adventure, Puzzle');
    });

    it('should handle missing context fields gracefully', () => {
      const minimalContext: FranchiseDescriptionContext = {
        name: 'Test Franchise',
      };
      
      const prompt = franchiseDescriptionsConfig.buildPrompt(minimalContext, 'en');
      
      expect(prompt).toContain('Franchise: "Test Franchise"');
      expect(prompt).not.toContain('Notable Games in the Franchise:');
      expect(prompt).not.toContain('Primary Developer:');
      expect(prompt).not.toContain('Publisher:');
      expect(prompt).not.toContain('First Release Year:');
      expect(prompt).not.toContain('Genres:');
    });

    it('should not include notable games section when array is empty', () => {
      const contextWithEmptyGames: FranchiseDescriptionContext = {
        name: 'New Franchise',
        notableGames: [],
      };
      
      const prompt = franchiseDescriptionsConfig.buildPrompt(contextWithEmptyGames, 'en');
      
      expect(prompt).not.toContain('Notable Games in the Franchise:');
    });

    it('should not include genres section when array is empty', () => {
      const contextWithEmptyGenres: FranchiseDescriptionContext = {
        name: 'New Franchise',
        genres: [],
      };
      
      const prompt = franchiseDescriptionsConfig.buildPrompt(contextWithEmptyGenres, 'en');
      
      expect(prompt).not.toContain('Genres:');
    });

    it('should handle null values gracefully', () => {
      const contextWithNulls: FranchiseDescriptionContext = {
        name: 'Test Franchise',
        developer: null,
        publisher: null,
        firstReleaseYear: null,
      };
      
      const prompt = franchiseDescriptionsConfig.buildPrompt(contextWithNulls, 'en');
      
      expect(prompt).toContain('Franchise: "Test Franchise"');
      expect(prompt).not.toContain('Primary Developer:');
      expect(prompt).not.toContain('Publisher:');
      expect(prompt).not.toContain('First Release Year:');
    });
  });

  describe('systemPrompt', () => {
    it('should instruct AI to write in the language specified in prompt', () => {
      expect(franchiseDescriptionsConfig.systemPrompt).toContain(
        'Always write in the language specified in the prompt'
      );
    });

    it('should mention both English and Spanish', () => {
      expect(franchiseDescriptionsConfig.systemPrompt).toContain('English or Spanish');
    });

    it('should include SEO best practices', () => {
      expect(franchiseDescriptionsConfig.systemPrompt).toContain('SEO');
    });

    it('should mention the wiki context', () => {
      expect(franchiseDescriptionsConfig.systemPrompt).toContain('Gamers.Wiki');
    });
  });

  describe('config structure', () => {
    it('should have all required fields', () => {
      expect(franchiseDescriptionsConfig).toHaveProperty('name');
      expect(franchiseDescriptionsConfig).toHaveProperty('description');
      expect(franchiseDescriptionsConfig).toHaveProperty('model');
      expect(franchiseDescriptionsConfig).toHaveProperty('systemPrompt');
      expect(franchiseDescriptionsConfig).toHaveProperty('buildPrompt');
    });

    it('should have buildPrompt as a function', () => {
      expect(typeof franchiseDescriptionsConfig.buildPrompt).toBe('function');
    });

    it('should have a descriptive name', () => {
      expect(franchiseDescriptionsConfig.name).toBe('Franchise Descriptions');
    });

    it('should have a valid model identifier', () => {
      expect(franchiseDescriptionsConfig.model).toBeTruthy();
      expect(typeof franchiseDescriptionsConfig.model).toBe('string');
    });
  });

  describe('prompt content requirements', () => {
    it('should request 2-3 paragraphs', () => {
      const prompt = franchiseDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('2-3 paragraphs');
    });

    it('should specify word count range', () => {
      const prompt = franchiseDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('120-200 words');
    });

    it('should forbid headers and titles', () => {
      const prompt = franchiseDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toMatch(/NO headers|Must Avoid.*Headers/i);
    });

    it('should request bold formatting for emphasis', () => {
      const prompt = franchiseDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('**bold**');
    });
  });

  describe('well-known gaming franchises', () => {
    it('should build correct prompt for Mario franchise', () => {
      const marioContext: FranchiseDescriptionContext = {
        name: 'Super Mario',
        notableGames: ['Super Mario Bros.', 'Super Mario 64', 'Super Mario Odyssey'],
        developer: 'Nintendo',
        publisher: 'Nintendo',
        firstReleaseYear: 1985,
        genres: ['Platformer'],
      };
      
      const prompt = franchiseDescriptionsConfig.buildPrompt(marioContext, 'en');
      
      expect(prompt).toContain('Franchise: "Super Mario"');
      expect(prompt).toContain('Primary Developer: Nintendo');
      expect(prompt).toContain('First Release Year: 1985');
      expect(prompt).toContain('Super Mario Bros.');
    });

    it('should build correct prompt for Dark Souls franchise', () => {
      const darkSoulsContext: FranchiseDescriptionContext = {
        name: 'Dark Souls',
        notableGames: ['Dark Souls', 'Dark Souls III', 'Elden Ring'],
        developer: 'FromSoftware',
        publisher: 'Bandai Namco',
        firstReleaseYear: 2011,
        genres: ['Action RPG', 'Souls-like'],
      };
      
      const prompt = franchiseDescriptionsConfig.buildPrompt(darkSoulsContext, 'en');
      
      expect(prompt).toContain('Franchise: "Dark Souls"');
      expect(prompt).toContain('Primary Developer: FromSoftware');
      expect(prompt).toContain('Publisher: Bandai Namco');
      expect(prompt).toContain('Genres: Action RPG, Souls-like');
    });

    it('should build correct prompt for Pokemon franchise', () => {
      const pokemonContext: FranchiseDescriptionContext = {
        name: 'Pokemon',
        notableGames: ['Pokemon Red/Blue', 'Pokemon Gold/Silver', 'Pokemon Scarlet/Violet'],
        developer: 'Game Freak',
        publisher: 'Nintendo',
        firstReleaseYear: 1996,
        genres: ['RPG'],
      };
      
      const prompt = franchiseDescriptionsConfig.buildPrompt(pokemonContext, 'es');
      
      expect(prompt).toContain('Franchise: "Pokemon"');
      expect(prompt).toContain('Write the description entirely in Spanish');
      expect(prompt).toContain('Primary Developer: Game Freak');
    });
  });
});

