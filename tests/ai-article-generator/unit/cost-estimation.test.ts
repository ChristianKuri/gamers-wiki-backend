import { describe, it, expect } from 'vitest';

import {
  getModelPricing,
  MODEL_PRICING,
  DEFAULT_MODEL_PRICING,
  type ModelPricing,
} from '../../../src/ai/articles/config';
import type { TokenUsage } from '../../../src/ai/articles/types';

/**
 * Cost estimation tests.
 *
 * Tests the cost estimation logic used in article generation.
 * The actual calculation happens inline in generate-game-article.ts,
 * but we can test the building blocks (getModelPricing) and the formula here.
 */

// Replicate the cost calculation formula for testing
function calculateEstimatedCost(
  scoutTokens: TokenUsage,
  editorTokens: TokenUsage,
  specialistTokens: TokenUsage,
  scoutModel: string,
  editorModel: string,
  specialistModel: string
): number {
  const scoutPricing = getModelPricing(scoutModel);
  const editorPricing = getModelPricing(editorModel);
  const specialistPricing = getModelPricing(specialistModel);

  const cost =
    (scoutTokens.input / 1000) * scoutPricing.inputPer1k +
    (scoutTokens.output / 1000) * scoutPricing.outputPer1k +
    (editorTokens.input / 1000) * editorPricing.inputPer1k +
    (editorTokens.output / 1000) * editorPricing.outputPer1k +
    (specialistTokens.input / 1000) * specialistPricing.inputPer1k +
    (specialistTokens.output / 1000) * specialistPricing.outputPer1k;

  // Round to 6 decimal places
  return Math.round(cost * 1_000_000) / 1_000_000;
}

describe('cost estimation formula', () => {
  describe('basic calculation', () => {
    it('calculates cost correctly for known model', () => {
      const scoutTokens: TokenUsage = { input: 1000, output: 500 };
      const editorTokens: TokenUsage = { input: 800, output: 400 };
      const specialistTokens: TokenUsage = { input: 2000, output: 3000 };

      // Using Claude Sonnet 4: $0.003/1k input, $0.015/1k output
      const cost = calculateEstimatedCost(
        scoutTokens,
        editorTokens,
        specialistTokens,
        'anthropic/claude-sonnet-4',
        'anthropic/claude-sonnet-4',
        'anthropic/claude-sonnet-4'
      );

      // Scout: (1000/1000 * 0.003) + (500/1000 * 0.015) = 0.003 + 0.0075 = 0.0105
      // Editor: (800/1000 * 0.003) + (400/1000 * 0.015) = 0.0024 + 0.006 = 0.0084
      // Specialist: (2000/1000 * 0.003) + (3000/1000 * 0.015) = 0.006 + 0.045 = 0.051
      // Total: 0.0105 + 0.0084 + 0.051 = 0.0699
      expect(cost).toBe(0.0699);
    });

    it('handles zero tokens', () => {
      const zeroTokens: TokenUsage = { input: 0, output: 0 };

      const cost = calculateEstimatedCost(
        zeroTokens,
        zeroTokens,
        zeroTokens,
        'anthropic/claude-sonnet-4',
        'anthropic/claude-sonnet-4',
        'anthropic/claude-sonnet-4'
      );

      expect(cost).toBe(0);
    });

    it('handles input-only usage', () => {
      const inputOnly: TokenUsage = { input: 1000, output: 0 };
      const zeroTokens: TokenUsage = { input: 0, output: 0 };

      // Claude Sonnet 4: $0.003/1k input
      const cost = calculateEstimatedCost(
        inputOnly,
        zeroTokens,
        zeroTokens,
        'anthropic/claude-sonnet-4',
        'anthropic/claude-sonnet-4',
        'anthropic/claude-sonnet-4'
      );

      expect(cost).toBe(0.003);
    });

    it('handles output-only usage', () => {
      const outputOnly: TokenUsage = { input: 0, output: 1000 };
      const zeroTokens: TokenUsage = { input: 0, output: 0 };

      // Claude Sonnet 4: $0.015/1k output
      const cost = calculateEstimatedCost(
        outputOnly,
        zeroTokens,
        zeroTokens,
        'anthropic/claude-sonnet-4',
        'anthropic/claude-sonnet-4',
        'anthropic/claude-sonnet-4'
      );

      expect(cost).toBe(0.015);
    });
  });

  describe('mixed models', () => {
    it('calculates correctly with different models per agent', () => {
      const scoutTokens: TokenUsage = { input: 1000, output: 500 };
      const editorTokens: TokenUsage = { input: 1000, output: 500 };
      const specialistTokens: TokenUsage = { input: 1000, output: 500 };

      // Scout: Claude Haiku ($0.00025/1k input, $0.00125/1k output)
      // Editor: Claude Sonnet ($0.003/1k input, $0.015/1k output)
      // Specialist: GPT-4o ($0.005/1k input, $0.015/1k output)
      const cost = calculateEstimatedCost(
        scoutTokens,
        editorTokens,
        specialistTokens,
        'anthropic/claude-3-haiku',
        'anthropic/claude-sonnet-4',
        'openai/gpt-4o'
      );

      // Scout: (1 * 0.00025) + (0.5 * 0.00125) = 0.0008750
      // Editor: (1 * 0.003) + (0.5 * 0.015) = 0.0105
      // Specialist: (1 * 0.005) + (0.5 * 0.015) = 0.0125
      // Total: 0.000875 + 0.0105 + 0.0125 = 0.023875
      expect(cost).toBe(0.023875);
    });
  });

  describe('unknown models', () => {
    it('uses default pricing for unknown models', () => {
      const tokens: TokenUsage = { input: 1000, output: 1000 };
      const zeroTokens: TokenUsage = { input: 0, output: 0 };

      const cost = calculateEstimatedCost(
        tokens,
        zeroTokens,
        zeroTokens,
        'unknown/model',
        'unknown/model',
        'unknown/model'
      );

      // Default: $0.002/1k input, $0.008/1k output
      // (1 * 0.002) + (1 * 0.008) = 0.01
      expect(cost).toBe(0.01);
    });
  });

  describe('rounding precision', () => {
    it('rounds to 6 decimal places', () => {
      const tokens: TokenUsage = { input: 333, output: 333 };
      const zeroTokens: TokenUsage = { input: 0, output: 0 };

      const cost = calculateEstimatedCost(
        tokens,
        zeroTokens,
        zeroTokens,
        'anthropic/claude-sonnet-4',
        'anthropic/claude-sonnet-4',
        'anthropic/claude-sonnet-4'
      );

      // Should be a number with at most 6 decimal places
      const decimalPlaces = (cost.toString().split('.')[1] || '').length;
      expect(decimalPlaces).toBeLessThanOrEqual(6);
    });

    it('handles very small costs', () => {
      const tokens: TokenUsage = { input: 1, output: 1 };
      const zeroTokens: TokenUsage = { input: 0, output: 0 };

      const cost = calculateEstimatedCost(
        tokens,
        zeroTokens,
        zeroTokens,
        'anthropic/claude-3-haiku',
        'anthropic/claude-3-haiku',
        'anthropic/claude-3-haiku'
      );

      // Very small but should still be calculated
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(0.001);
    });
  });

  describe('realistic scenarios', () => {
    it('estimates typical article generation cost', () => {
      // Realistic token usage for article generation
      const scoutTokens: TokenUsage = { input: 3500, output: 800 };
      const editorTokens: TokenUsage = { input: 2000, output: 1200 };
      const specialistTokens: TokenUsage = { input: 8000, output: 6000 };

      const cost = calculateEstimatedCost(
        scoutTokens,
        editorTokens,
        specialistTokens,
        'anthropic/claude-sonnet-4',
        'anthropic/claude-sonnet-4',
        'anthropic/claude-sonnet-4'
      );

      // Should be in reasonable range for article generation
      expect(cost).toBeGreaterThan(0.05);
      expect(cost).toBeLessThan(0.50);
    });

    it('shows cost difference between expensive and cheap models', () => {
      const tokens: TokenUsage = { input: 5000, output: 3000 };

      // All Claude Opus (expensive)
      const expensiveCost = calculateEstimatedCost(
        tokens,
        tokens,
        tokens,
        'anthropic/claude-3-opus',
        'anthropic/claude-3-opus',
        'anthropic/claude-3-opus'
      );

      // All Claude Haiku (cheap)
      const cheapCost = calculateEstimatedCost(
        tokens,
        tokens,
        tokens,
        'anthropic/claude-3-haiku',
        'anthropic/claude-3-haiku',
        'anthropic/claude-3-haiku'
      );

      // Opus should be significantly more expensive than Haiku
      expect(expensiveCost).toBeGreaterThan(cheapCost * 10);
    });
  });
});

describe('MODEL_PRICING completeness', () => {
  it('includes common Anthropic models', () => {
    const anthropicModels = Object.keys(MODEL_PRICING).filter((k) => k.startsWith('anthropic/'));
    expect(anthropicModels.length).toBeGreaterThanOrEqual(3);
    expect(anthropicModels).toContain('anthropic/claude-sonnet-4');
  });

  it('includes common OpenAI models', () => {
    const openaiModels = Object.keys(MODEL_PRICING).filter((k) => k.startsWith('openai/'));
    expect(openaiModels.length).toBeGreaterThanOrEqual(2);
    expect(openaiModels).toContain('openai/gpt-4o');
  });

  it('has reasonable price ordering within model families', () => {
    // Claude pricing: Haiku < Sonnet < Opus
    const haiku = MODEL_PRICING['anthropic/claude-3-haiku'];
    const sonnet = MODEL_PRICING['anthropic/claude-sonnet-4'];
    const opus = MODEL_PRICING['anthropic/claude-3-opus'];

    expect(haiku.inputPer1k).toBeLessThan(sonnet.inputPer1k);
    expect(sonnet.inputPer1k).toBeLessThan(opus.inputPer1k);

    expect(haiku.outputPer1k).toBeLessThan(sonnet.outputPer1k);
    expect(sonnet.outputPer1k).toBeLessThan(opus.outputPer1k);
  });

  it('has reasonable price ordering for GPT models', () => {
    // GPT pricing: gpt-4o-mini < gpt-4o < gpt-4-turbo
    const mini = MODEL_PRICING['openai/gpt-4o-mini'];
    const gpt4o = MODEL_PRICING['openai/gpt-4o'];

    expect(mini.inputPer1k).toBeLessThan(gpt4o.inputPer1k);
    expect(mini.outputPer1k).toBeLessThan(gpt4o.outputPer1k);
  });
});

