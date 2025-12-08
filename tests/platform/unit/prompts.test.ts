/**
 * Platform Prompt Unit Tests
 * 
 * Tests that prompts are correctly built with language instructions.
 * These tests verify the prompt content before it's sent to the AI.
 */

import { describe, it, expect } from 'vitest';
import { platformDescriptionsConfig } from '../../../src/ai/config/platform-descriptions';
import type { PlatformDescriptionContext } from '../../../src/ai/config/types';

describe('Platform Description Prompts', () => {
  const context: PlatformDescriptionContext = {
    name: 'Nintendo Switch',
    manufacturer: 'Nintendo',
    releaseYear: 2017,
    category: 'console',
    generation: 8,
    abbreviation: 'NSW',
  };

  describe('buildPrompt', () => {
    it('should include English language instruction for EN locale', () => {
      const prompt = platformDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('Write the description in English');
      expect(prompt).not.toContain('Write the description entirely in Spanish');
    });

    it('should include Spanish language instruction for ES locale', () => {
      const prompt = platformDescriptionsConfig.buildPrompt(context, 'es');
      
      expect(prompt).toContain('Write the description entirely in Spanish');
      expect(prompt).not.toContain('Write the description in English.');
    });

    it('should include platform name in prompt', () => {
      const prompt = platformDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('Platform: "Nintendo Switch"');
    });

    it('should include all context fields when provided', () => {
      const prompt = platformDescriptionsConfig.buildPrompt(context, 'en');
      
      expect(prompt).toContain('Manufacturer: Nintendo');
      expect(prompt).toContain('Release Year: 2017');
      expect(prompt).toContain('Category: console');
      expect(prompt).toContain('Generation: 8');
      expect(prompt).toContain('Common Abbreviation: NSW');
    });

    it('should handle missing context fields gracefully', () => {
      const minimalContext: PlatformDescriptionContext = {
        name: 'Test Platform',
      };
      
      const prompt = platformDescriptionsConfig.buildPrompt(minimalContext, 'en');
      
      expect(prompt).toContain('Platform: "Test Platform"');
      expect(prompt).not.toContain('Manufacturer:');
      expect(prompt).not.toContain('Release Year:');
    });
  });

  describe('systemPrompt', () => {
    it('should instruct AI to write in the language specified in prompt', () => {
      expect(platformDescriptionsConfig.systemPrompt).toContain(
        'Always write in the language specified in the prompt'
      );
    });

    it('should mention both English and Spanish', () => {
      expect(platformDescriptionsConfig.systemPrompt).toContain('English or Spanish');
    });
  });

  describe('config structure', () => {
    it('should have all required fields', () => {
      expect(platformDescriptionsConfig).toHaveProperty('name');
      expect(platformDescriptionsConfig).toHaveProperty('description');
      expect(platformDescriptionsConfig).toHaveProperty('model');
      expect(platformDescriptionsConfig).toHaveProperty('systemPrompt');
      expect(platformDescriptionsConfig).toHaveProperty('buildPrompt');
    });

    it('should have buildPrompt as a function', () => {
      expect(typeof platformDescriptionsConfig.buildPrompt).toBe('function');
    });
  });
});

