/**
 * Company Prompt Unit Tests
 * 
 * Tests that prompts are correctly built with language instructions.
 * These tests verify the prompt content before it's sent to the AI.
 */

import { describe, it, expect } from 'vitest';
import { companyDescriptionsConfig } from '../../../src/ai/config/company-descriptions';
import type { CompanyDescriptionContext } from '../../../src/ai/config/types';

describe('Company Description Prompts', () => {
  const context: CompanyDescriptionContext = {
    name: 'FromSoftware',
    country: 'Japan',
    foundedYear: 1986,
    notableGames: ['Elden Ring', 'Dark Souls', 'Sekiro'],
    isDeveloper: true,
    isPublisher: false,
  };

  describe('buildPrompt', () => {
    it('should include English language instruction for EN locale', () => {
      const prompt = companyDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('Write the description in English');
      expect(prompt).not.toContain('Write the description entirely in Spanish');
    });

    it('should include Spanish language instruction for ES locale', () => {
      const prompt = companyDescriptionsConfig.buildPrompt(context, 'es');
      
      expect(prompt).toContain('Write the description entirely in Spanish');
      expect(prompt).not.toContain('Write the description in English.');
    });

    it('should include company name in prompt', () => {
      const prompt = companyDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('Company: "FromSoftware"');
    });

    it('should include country when provided', () => {
      const prompt = companyDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('Headquarters: Japan');
    });

    it('should include founded year when provided', () => {
      const prompt = companyDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('Founded: 1986');
    });

    it('should include notable games when provided', () => {
      const prompt = companyDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('Notable Games: Elden Ring, Dark Souls, Sekiro');
    });

    it('should include developer role when isDeveloper is true', () => {
      const devContext: CompanyDescriptionContext = {
        name: 'Test Dev',
        isDeveloper: true,
        isPublisher: false,
      };
      
      const prompt = companyDescriptionsConfig.buildPrompt(devContext, 'en');
      
      expect(prompt).toContain('Role: Game developer');
    });

    it('should include publisher role when isPublisher is true', () => {
      const pubContext: CompanyDescriptionContext = {
        name: 'Test Pub',
        isDeveloper: false,
        isPublisher: true,
      };
      
      const prompt = companyDescriptionsConfig.buildPrompt(pubContext, 'en');
      
      expect(prompt).toContain('Role: Game publisher');
    });

    it('should indicate both roles when company is developer and publisher', () => {
      const bothContext: CompanyDescriptionContext = {
        name: 'Nintendo',
        isDeveloper: true,
        isPublisher: true,
      };
      
      const prompt = companyDescriptionsConfig.buildPrompt(bothContext, 'en');
      
      expect(prompt).toContain('Role: Both developer and publisher');
    });

    it('should handle missing context fields gracefully', () => {
      const minimalContext: CompanyDescriptionContext = {
        name: 'Test Company',
      };
      
      const prompt = companyDescriptionsConfig.buildPrompt(minimalContext, 'en');
      
      expect(prompt).toContain('Company: "Test Company"');
      expect(prompt).not.toContain('Headquarters:');
      expect(prompt).not.toContain('Founded:');
      expect(prompt).not.toContain('Notable Games:');
      expect(prompt).not.toContain('Role:');
    });

    it('should not include notable games section when array is empty', () => {
      const contextWithEmptyGames: CompanyDescriptionContext = {
        name: 'New Studio',
        notableGames: [],
      };
      
      const prompt = companyDescriptionsConfig.buildPrompt(contextWithEmptyGames, 'en');
      
      expect(prompt).not.toContain('Notable Games:');
    });

    it('should handle null values gracefully', () => {
      const contextWithNulls: CompanyDescriptionContext = {
        name: 'Test Company',
        country: null,
        foundedYear: null,
      };
      
      const prompt = companyDescriptionsConfig.buildPrompt(contextWithNulls, 'en');
      
      expect(prompt).toContain('Company: "Test Company"');
      expect(prompt).not.toContain('Headquarters:');
      expect(prompt).not.toContain('Founded:');
    });
  });

  describe('systemPrompt', () => {
    it('should instruct AI to write in the language specified in prompt', () => {
      expect(companyDescriptionsConfig.systemPrompt).toContain(
        'Always write in the language specified in the prompt'
      );
    });

    it('should mention both English and Spanish', () => {
      expect(companyDescriptionsConfig.systemPrompt).toContain('English or Spanish');
    });

    it('should include SEO best practices', () => {
      expect(companyDescriptionsConfig.systemPrompt).toContain('SEO');
    });

    it('should mention the wiki context', () => {
      expect(companyDescriptionsConfig.systemPrompt).toContain('Gamers.Wiki');
    });
  });

  describe('config structure', () => {
    it('should have all required fields', () => {
      expect(companyDescriptionsConfig).toHaveProperty('name');
      expect(companyDescriptionsConfig).toHaveProperty('description');
      expect(companyDescriptionsConfig).toHaveProperty('model');
      expect(companyDescriptionsConfig).toHaveProperty('systemPrompt');
      expect(companyDescriptionsConfig).toHaveProperty('buildPrompt');
    });

    it('should have buildPrompt as a function', () => {
      expect(typeof companyDescriptionsConfig.buildPrompt).toBe('function');
    });

    it('should have a descriptive name', () => {
      expect(companyDescriptionsConfig.name).toBe('Company Descriptions');
    });

    it('should have a valid model identifier', () => {
      expect(companyDescriptionsConfig.model).toBeTruthy();
      expect(typeof companyDescriptionsConfig.model).toBe('string');
    });
  });

  describe('prompt content requirements', () => {
    it('should request 2-3 paragraphs', () => {
      const prompt = companyDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('2-3 paragraphs');
    });

    it('should specify word count range', () => {
      const prompt = companyDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('120-200 words');
    });

    it('should forbid headers and titles', () => {
      const prompt = companyDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toMatch(/NO headers|Must Avoid.*Headers/i);
    });

    it('should request bold formatting for emphasis', () => {
      const prompt = companyDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('**bold**');
    });
  });

  describe('well-known gaming companies', () => {
    it('should build correct prompt for Nintendo', () => {
      const nintendoContext: CompanyDescriptionContext = {
        name: 'Nintendo',
        country: 'Japan',
        foundedYear: 1889,
        notableGames: ['Super Mario', 'The Legend of Zelda', 'Pokemon'],
        isDeveloper: true,
        isPublisher: true,
      };
      
      const prompt = companyDescriptionsConfig.buildPrompt(nintendoContext, 'en');
      
      expect(prompt).toContain('Company: "Nintendo"');
      expect(prompt).toContain('Headquarters: Japan');
      expect(prompt).toContain('Founded: 1889');
      expect(prompt).toContain('Super Mario');
      expect(prompt).toContain('Both developer and publisher');
    });

    it('should build correct prompt for indie studio', () => {
      const indieContext: CompanyDescriptionContext = {
        name: 'Team Cherry',
        country: 'Australia',
        foundedYear: 2014,
        notableGames: ['Hollow Knight'],
        isDeveloper: true,
        isPublisher: false,
      };
      
      const prompt = companyDescriptionsConfig.buildPrompt(indieContext, 'en');
      
      expect(prompt).toContain('Company: "Team Cherry"');
      expect(prompt).toContain('Australia');
      expect(prompt).toContain('2014');
      expect(prompt).toContain('Hollow Knight');
      expect(prompt).toContain('Game developer');
    });
  });
});

