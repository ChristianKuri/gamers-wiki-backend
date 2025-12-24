import { describe, it, expect } from 'vitest';

import {
  createEmptyTokenUsage,
  addTokenUsage,
  type TokenUsage,
  type AggregatedTokenUsage,
} from '../../../src/ai/articles/types';

describe('createEmptyTokenUsage', () => {
  it('returns token usage with zero input tokens', () => {
    const usage = createEmptyTokenUsage();
    expect(usage.input).toBe(0);
  });

  it('returns token usage with zero output tokens', () => {
    const usage = createEmptyTokenUsage();
    expect(usage.output).toBe(0);
  });

  it('returns a new object each time', () => {
    const usage1 = createEmptyTokenUsage();
    const usage2 = createEmptyTokenUsage();
    expect(usage1).not.toBe(usage2);
  });

  it('returns immutable object shape', () => {
    const usage = createEmptyTokenUsage();
    expect(Object.keys(usage)).toEqual(['input', 'output']);
  });
});

describe('addTokenUsage', () => {
  it('adds input tokens correctly', () => {
    const a: TokenUsage = { input: 100, output: 0 };
    const b: TokenUsage = { input: 200, output: 0 };
    const result = addTokenUsage(a, b);
    expect(result.input).toBe(300);
  });

  it('adds output tokens correctly', () => {
    const a: TokenUsage = { input: 0, output: 150 };
    const b: TokenUsage = { input: 0, output: 250 };
    const result = addTokenUsage(a, b);
    expect(result.output).toBe(400);
  });

  it('adds both input and output tokens', () => {
    const a: TokenUsage = { input: 100, output: 50 };
    const b: TokenUsage = { input: 200, output: 150 };
    const result = addTokenUsage(a, b);
    expect(result.input).toBe(300);
    expect(result.output).toBe(200);
  });

  it('works with empty token usage', () => {
    const a: TokenUsage = { input: 100, output: 50 };
    const b = createEmptyTokenUsage();
    const result = addTokenUsage(a, b);
    expect(result.input).toBe(100);
    expect(result.output).toBe(50);
  });

  it('works with two empty token usages', () => {
    const a = createEmptyTokenUsage();
    const b = createEmptyTokenUsage();
    const result = addTokenUsage(a, b);
    expect(result.input).toBe(0);
    expect(result.output).toBe(0);
  });

  it('returns a new object', () => {
    const a: TokenUsage = { input: 100, output: 50 };
    const b: TokenUsage = { input: 200, output: 150 };
    const result = addTokenUsage(a, b);
    expect(result).not.toBe(a);
    expect(result).not.toBe(b);
  });

  it('does not modify original objects', () => {
    const a: TokenUsage = { input: 100, output: 50 };
    const b: TokenUsage = { input: 200, output: 150 };
    addTokenUsage(a, b);
    expect(a.input).toBe(100);
    expect(a.output).toBe(50);
    expect(b.input).toBe(200);
    expect(b.output).toBe(150);
  });

  it('can be chained for multiple additions', () => {
    const scout: TokenUsage = { input: 1000, output: 500 };
    const editor: TokenUsage = { input: 800, output: 600 };
    const specialist: TokenUsage = { input: 2000, output: 3000 };

    const total = addTokenUsage(addTokenUsage(scout, editor), specialist);

    expect(total.input).toBe(3800);
    expect(total.output).toBe(4100);
  });
});

describe('TokenUsage interface', () => {
  it('has readonly input property', () => {
    const usage: TokenUsage = { input: 100, output: 50 };
    // TypeScript enforces readonly at compile time
    expect(usage.input).toBe(100);
  });

  it('has readonly output property', () => {
    const usage: TokenUsage = { input: 100, output: 50 };
    // TypeScript enforces readonly at compile time
    expect(usage.output).toBe(50);
  });
});

describe('AggregatedTokenUsage interface', () => {
  it('has all required phase properties', () => {
    const aggregated: AggregatedTokenUsage = {
      scout: { input: 1000, output: 500 },
      editor: { input: 800, output: 600 },
      specialist: { input: 2000, output: 3000 },
      total: { input: 3800, output: 4100 },
    };

    expect(aggregated.scout).toBeDefined();
    expect(aggregated.editor).toBeDefined();
    expect(aggregated.specialist).toBeDefined();
    expect(aggregated.total).toBeDefined();
  });

  it('total should match sum of phases', () => {
    const scout: TokenUsage = { input: 1000, output: 500 };
    const editor: TokenUsage = { input: 800, output: 600 };
    const specialist: TokenUsage = { input: 2000, output: 3000 };
    const total = addTokenUsage(addTokenUsage(scout, editor), specialist);

    const aggregated: AggregatedTokenUsage = {
      scout,
      editor,
      specialist,
      total,
    };

    expect(aggregated.total.input).toBe(
      aggregated.scout.input + aggregated.editor.input + aggregated.specialist.input
    );
    expect(aggregated.total.output).toBe(
      aggregated.scout.output + aggregated.editor.output + aggregated.specialist.output
    );
  });
});

describe('Token usage aggregation scenarios', () => {
  it('handles realistic token counts', () => {
    // Typical counts for article generation
    const scout: TokenUsage = { input: 2500, output: 1200 };
    const editor: TokenUsage = { input: 3000, output: 800 };
    const specialist: TokenUsage = { input: 15000, output: 8000 };

    const total = addTokenUsage(addTokenUsage(scout, editor), specialist);

    expect(total.input).toBe(20500);
    expect(total.output).toBe(10000);
  });

  it('handles large token counts without overflow', () => {
    const a: TokenUsage = { input: 1_000_000, output: 500_000 };
    const b: TokenUsage = { input: 2_000_000, output: 1_500_000 };

    const result = addTokenUsage(a, b);

    expect(result.input).toBe(3_000_000);
    expect(result.output).toBe(2_000_000);
  });

  it('handles zero counts in one phase', () => {
    const scout: TokenUsage = { input: 1000, output: 500 };
    const editor: TokenUsage = { input: 0, output: 0 }; // No editor call (cached)
    const specialist: TokenUsage = { input: 2000, output: 3000 };

    const total = addTokenUsage(addTokenUsage(scout, editor), specialist);

    expect(total.input).toBe(3000);
    expect(total.output).toBe(3500);
  });
});

