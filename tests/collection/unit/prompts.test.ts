/**
 * Collection Description Prompts Unit Tests
 * 
 * Tests the AI prompt configuration for collection descriptions.
 */

import { describe, it, expect } from 'vitest';
import { collectionDescriptionsConfig } from '../../../src/ai/config/collection-descriptions';
import type { CollectionDescriptionContext } from '../../../src/ai/config/types';

describe('Collection Description Prompts', () => {
  // Shared context for tests
  const basicContext: CollectionDescriptionContext = {
    name: 'Dark Souls Trilogy',
  };

  describe('buildPrompt', () => {

    it('should include collection name in the prompt', () => {
      const prompt = collectionDescriptionsConfig.buildPrompt(basicContext, 'en');
      expect(prompt).toContain('Dark Souls Trilogy');
    });

    it('should specify English language for en locale', () => {
      const prompt = collectionDescriptionsConfig.buildPrompt(basicContext, 'en');
      expect(prompt).toContain('Write the description in English');
    });

    it('should specify Spanish language for es locale', () => {
      const prompt = collectionDescriptionsConfig.buildPrompt(basicContext, 'es');
      expect(prompt).toContain('Write the description entirely in Spanish');
    });

    it('should include games in collection when provided', () => {
      const context: CollectionDescriptionContext = {
        name: 'Dark Souls Trilogy',
        gamesInCollection: ['Dark Souls', 'Dark Souls II', 'Dark Souls III'],
      };
      const prompt = collectionDescriptionsConfig.buildPrompt(context, 'en');
      expect(prompt).toContain('Dark Souls');
      expect(prompt).toContain('Dark Souls II');
      expect(prompt).toContain('Dark Souls III');
      expect(prompt).toContain('Games in this Collection');
    });

    it('should include parent collection name when provided', () => {
      const context: CollectionDescriptionContext = {
        name: 'Pokémon Legends',
        parentCollectionName: 'Pokémon',
      };
      const prompt = collectionDescriptionsConfig.buildPrompt(context, 'en');
      expect(prompt).toContain('Pokémon');
      expect(prompt).toContain('Parent Collection');
      expect(prompt).toContain('sub-collection');
    });

    it('should include collection type when provided', () => {
      const context: CollectionDescriptionContext = {
        name: 'Mass Effect Legendary Edition',
        collectionType: 'Remaster',
      };
      const prompt = collectionDescriptionsConfig.buildPrompt(context, 'en');
      expect(prompt).toContain('Remaster');
      expect(prompt).toContain('Collection Type');
    });

    it('should include related franchise when provided', () => {
      const context: CollectionDescriptionContext = {
        name: 'The Witcher Trilogy',
        relatedFranchise: 'The Witcher',
      };
      const prompt = collectionDescriptionsConfig.buildPrompt(context, 'en');
      expect(prompt).toContain('The Witcher');
      expect(prompt).toContain('Related Franchise');
    });

    it('should handle missing optional fields gracefully', () => {
      const context: CollectionDescriptionContext = {
        name: 'Simple Collection',
      };
      const prompt = collectionDescriptionsConfig.buildPrompt(context, 'en');
      expect(prompt).toContain('Simple Collection');
      // Should not have context section markers for missing data
      expect(prompt).not.toContain('Games in this Collection');
      expect(prompt).not.toContain('Parent Collection');
      expect(prompt).not.toContain('Collection Type');
    });

    it('should include structure guidelines', () => {
      const prompt = collectionDescriptionsConfig.buildPrompt(basicContext, 'en');
      expect(prompt).toContain('Structure');
      expect(prompt).toContain('Word Count');
      expect(prompt).toContain('2-3 paragraphs');
    });

    it('should include formatting rules', () => {
      const prompt = collectionDescriptionsConfig.buildPrompt(basicContext, 'en');
      expect(prompt).toContain('bold');
      expect(prompt).toContain('italics');
      expect(prompt).toContain('NO headers');
    });

    it('should include must avoid rules', () => {
      const prompt = collectionDescriptionsConfig.buildPrompt(basicContext, 'en');
      expect(prompt).toContain('Must Avoid');
      expect(prompt).toContain('Headers');
    });
  });

  describe('systemPrompt', () => {
    it('should establish wiki editor context', () => {
      expect(collectionDescriptionsConfig.systemPrompt).toContain('Gamers.Wiki');
      expect(collectionDescriptionsConfig.systemPrompt).toContain('encyclopedia');
    });

    it('should mention collection organization expertise', () => {
      expect(collectionDescriptionsConfig.systemPrompt).toContain('organized');
      expect(collectionDescriptionsConfig.systemPrompt).toContain('bundled');
      expect(collectionDescriptionsConfig.systemPrompt).toContain('grouped');
    });

    it('should emphasize SEO best practices', () => {
      expect(collectionDescriptionsConfig.systemPrompt).toContain('SEO');
      expect(collectionDescriptionsConfig.systemPrompt).toContain('keywords');
    });

    it('should prohibit HTML tags', () => {
      expect(collectionDescriptionsConfig.systemPrompt).toContain('NEVER use HTML tags');
    });
  });

  describe('config structure', () => {
    it('should have required fields', () => {
      expect(collectionDescriptionsConfig.name).toBe('Collection Descriptions');
      expect(collectionDescriptionsConfig.description).toBeTruthy();
      expect(collectionDescriptionsConfig.model).toBeTruthy();
      expect(collectionDescriptionsConfig.buildPrompt).toBeInstanceOf(Function);
    });

    it('should have a valid model identifier', () => {
      expect(collectionDescriptionsConfig.model).toMatch(/\//);
    });

    it('should not be the same as franchise descriptions', () => {
      // Collections and franchises are different concepts
      expect(collectionDescriptionsConfig.name).not.toBe('Franchise Descriptions');
    });

    it('should mention collections as distinct from franchises in description', () => {
      expect(collectionDescriptionsConfig.description.toLowerCase()).toContain('collection');
    });
  });

  describe('Prompt content requirements', () => {
    it('should ask for prose paragraphs, not bullet points', () => {
      const prompt = collectionDescriptionsConfig.buildPrompt(basicContext, 'en');
      expect(prompt).toContain('prose');
      expect(prompt).toContain('NO headers');
    });

    it('should mention what unifies the games', () => {
      const prompt = collectionDescriptionsConfig.buildPrompt(basicContext, 'en');
      expect(prompt).toContain('unifies');
    });

    it('should ask for value proposition', () => {
      const prompt = collectionDescriptionsConfig.buildPrompt(basicContext, 'en');
      expect(prompt).toContain('value');
    });

    it('should specify tone', () => {
      const prompt = collectionDescriptionsConfig.buildPrompt(basicContext, 'en');
      expect(prompt).toContain('Tone');
      expect(prompt).toContain('Informative');
    });
  });

  describe('Well-known collections', () => {
    it('should handle trilogy collections', () => {
      const context: CollectionDescriptionContext = {
        name: 'Mass Effect Trilogy',
        gamesInCollection: ['Mass Effect', 'Mass Effect 2', 'Mass Effect 3'],
      };
      const prompt = collectionDescriptionsConfig.buildPrompt(context, 'en');
      expect(prompt).toContain('Mass Effect Trilogy');
      expect(prompt).toContain('Mass Effect 2');
    });

    it('should handle remaster collections', () => {
      const context: CollectionDescriptionContext = {
        name: 'Crash Bandicoot N. Sane Trilogy',
        collectionType: 'Remaster',
        gamesInCollection: ['Crash Bandicoot', 'Crash Bandicoot 2', 'Crash Bandicoot: Warped'],
      };
      const prompt = collectionDescriptionsConfig.buildPrompt(context, 'en');
      expect(prompt).toContain('Crash Bandicoot');
      expect(prompt).toContain('Remaster');
    });

    it('should handle sub-collections', () => {
      const context: CollectionDescriptionContext = {
        name: 'Pokémon Legends',
        parentCollectionName: 'Pokémon',
        gamesInCollection: ['Pokémon Legends: Arceus'],
      };
      const prompt = collectionDescriptionsConfig.buildPrompt(context, 'en');
      expect(prompt).toContain('Pokémon Legends');
      expect(prompt).toContain('sub-collection');
      expect(prompt).toContain('Parent Collection');
    });
  });
});

