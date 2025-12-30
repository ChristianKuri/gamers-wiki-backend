import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  cleanSingleSource,
  cleanSourcesBatch,
  CLEANER_CONFIG,
  CleanerOutputSchema,
} from '../../../src/ai/articles/agents/cleaner';
import { extractDomain } from '../../../src/ai/articles/source-cache';
import type { RawSourceInput, CleanerLLMOutput } from '../../../src/ai/articles/types';

// ============================================================================
// Mock Setup
// ============================================================================

const createMockGenerateObject = () => vi.fn();
const createMockModel = () => ({} as any);

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockRawSource = (overrides: Partial<RawSourceInput> = {}): RawSourceInput => ({
  url: 'https://example.com/guide',
  title: 'Elden Ring Guide',
  content: `
Navigation: Home > Games > Elden Ring

# Elden Ring Combat Guide

This is a comprehensive guide to combat in Elden Ring. The game features
a complex combat system with many weapon types and playstyles.

## Basic Combat Mechanics

Stamina management is crucial. Every action costs stamina, so you need
to balance offense and defense carefully.

## Weapon Types

There are many weapon types in Elden Ring:
- Swords (straight, curved, great)
- Axes (regular and great)
- Spears and halberds
- Magic catalysts

Cookie Settings | Privacy Policy | Terms of Service
© 2024 Example Gaming Site
`,
  searchSource: 'tavily',
  ...overrides,
});

const createMockCleanerOutput = (overrides: Partial<CleanerLLMOutput> = {}): CleanerLLMOutput => ({
  cleanedContent: `# Elden Ring Combat Guide

This is a comprehensive guide to combat in Elden Ring. The game features
a complex combat system with many weapon types and playstyles.

## Basic Combat Mechanics

Stamina management is crucial. Every action costs stamina, so you need
to balance offense and defense carefully.

## Weapon Types

There are many weapon types in Elden Ring:
- Swords (straight, curved, great)
- Axes (regular and great)
- Spears and halberds
- Magic catalysts`,
  summary: 'A combat guide for Elden Ring covering basic mechanics and weapon types.',
  qualityScore: 75,
  qualityNotes: 'Good guide content with clear structure. Relevant gaming information.',
  contentType: 'strategy guide',
  ...overrides,
});

const createMockCleanerDeps = (generateObjectResult?: any) => ({
  generateObject:
    generateObjectResult !== undefined
      ? vi.fn().mockResolvedValue({ 
          object: generateObjectResult,
          usage: { inputTokens: 100, outputTokens: 50 },
        })
      : vi.fn().mockResolvedValue({ 
          object: createMockCleanerOutput(),
          usage: { inputTokens: 100, outputTokens: 50 },
        }),
  model: createMockModel(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  gameName: 'Elden Ring',
});

// ============================================================================
// CleanerOutputSchema Tests
// ============================================================================

describe('CleanerOutputSchema', () => {
  it('validates correct output', () => {
    const validOutput = createMockCleanerOutput();
    const result = CleanerOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it('rejects empty cleanedContent', () => {
    const invalidOutput = createMockCleanerOutput({ cleanedContent: '' });
    const result = CleanerOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('rejects qualityScore below 0', () => {
    const invalidOutput = createMockCleanerOutput({ qualityScore: -1 });
    const result = CleanerOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('rejects qualityScore above 100', () => {
    const invalidOutput = createMockCleanerOutput({ qualityScore: 101 });
    const result = CleanerOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('rejects empty contentType', () => {
    const invalidOutput = { ...createMockCleanerOutput(), contentType: '' };
    const result = CleanerOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('accepts various contentType strings', () => {
    const contentTypes = ['wiki article', 'strategy guide', 'forum discussion', 'news article', 'official documentation', 'walkthrough'];

    for (const contentType of contentTypes) {
      const output = createMockCleanerOutput({ contentType });
      const result = CleanerOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    }
  });

  it('validates summary field', () => {
    const output = createMockCleanerOutput({ summary: 'A brief summary of the content.' });
    const result = CleanerOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it('rejects empty summary', () => {
    const invalidOutput = { ...createMockCleanerOutput(), summary: '' };
    const result = CleanerOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// extractDomain Tests
// ============================================================================

describe('extractDomain', () => {
  it('extracts domain from URL', () => {
    expect(extractDomain('https://example.com/page')).toBe('example.com');
  });

  it('removes www prefix', () => {
    expect(extractDomain('https://www.example.com/page')).toBe('example.com');
  });

  it('handles subdomains', () => {
    expect(extractDomain('https://wiki.example.com/page')).toBe('wiki.example.com');
  });

  it('returns empty string for invalid URL', () => {
    expect(extractDomain('not-a-url')).toBe('');
  });

  it('handles URLs with ports', () => {
    expect(extractDomain('https://example.com:8080/page')).toBe('example.com');
  });
});

// ============================================================================
// cleanSingleSource Tests
// ============================================================================

describe('cleanSingleSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cleans source content successfully', async () => {
    const rawSource = createMockRawSource();
    const deps = createMockCleanerDeps();

    const result = await cleanSingleSource(rawSource, deps);

    expect(result.source).not.toBeNull();
    expect(result.source?.url).toBe(rawSource.url);
    expect(result.source?.domain).toBe('example.com');
    expect(result.source?.qualityScore).toBe(75);
    expect(result.source?.contentType).toBe('strategy guide');
    expect(result.source?.summary).toBe('A combat guide for Elden Ring covering basic mechanics and weapon types.');
    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage.input).toBe(100);
    expect(result.tokenUsage.output).toBe(50);
    expect(deps.generateObject).toHaveBeenCalledTimes(1);
  });

  it('returns null source for empty content', async () => {
    const rawSource = createMockRawSource({ content: '' });
    const deps = createMockCleanerDeps();

    const result = await cleanSingleSource(rawSource, deps);

    expect(result.source).toBeNull();
    expect(result.tokenUsage.input).toBe(0);
    expect(deps.generateObject).not.toHaveBeenCalled();
  });

  it('returns null source for content too short', async () => {
    const rawSource = createMockRawSource({ content: 'Short' });
    const deps = createMockCleanerDeps();

    const result = await cleanSingleSource(rawSource, deps);

    expect(result.source).toBeNull();
    expect(result.tokenUsage.input).toBe(0);
    expect(deps.generateObject).not.toHaveBeenCalled();
  });

  it('returns null source when cleaned content is too short', async () => {
    const rawSource = createMockRawSource();
    const deps = createMockCleanerDeps(
      createMockCleanerOutput({ cleanedContent: 'Too short' })
    );

    const result = await cleanSingleSource(rawSource, deps);

    expect(result.source).toBeNull();
    // Still tracks token usage even when content is too short
    expect(result.tokenUsage.input).toBe(100);
  });

  it('calculates junk ratio correctly', async () => {
    const rawSource = createMockRawSource({
      content: 'A'.repeat(1000), // 1000 chars original
    });
    const cleanedContent = 'A'.repeat(600); // 600 chars cleaned = 40% junk
    const deps = createMockCleanerDeps(
      createMockCleanerOutput({ cleanedContent })
    );

    const result = await cleanSingleSource(rawSource, deps);

    expect(result.source).not.toBeNull();
    expect(result.source?.junkRatio).toBeCloseTo(0.4, 2);
  });

  it('handles generateObject errors gracefully', async () => {
    const rawSource = createMockRawSource();
    const deps = {
      ...createMockCleanerDeps(),
      generateObject: vi.fn().mockRejectedValue(new Error('API error')),
    };

    const result = await cleanSingleSource(rawSource, deps);

    expect(result.source).toBeNull();
    expect(result.tokenUsage.input).toBe(0);
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('includes game name in prompt when provided', async () => {
    const rawSource = createMockRawSource();
    const deps = createMockCleanerDeps();

    await cleanSingleSource(rawSource, deps);

    const call = deps.generateObject.mock.calls[0][0];
    expect(call.prompt).toContain('Elden Ring');
  });

  it('preserves search source in output', async () => {
    const rawSource = createMockRawSource({ searchSource: 'exa' });
    const deps = createMockCleanerDeps();

    const result = await cleanSingleSource(rawSource, deps);

    expect(result.source?.searchSource).toBe('exa');
  });
});

// ============================================================================
// cleanSourcesBatch Tests
// ============================================================================

describe('cleanSourcesBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty result for empty input', async () => {
    const deps = createMockCleanerDeps();

    const result = await cleanSourcesBatch([], deps);

    expect(result.sources).toEqual([]);
    expect(result.tokenUsage.input).toBe(0);
    expect(deps.generateObject).not.toHaveBeenCalled();
  });

  it('cleans multiple sources in batches', async () => {
    const sources = [
      createMockRawSource({ url: 'https://example1.com/guide' }),
      createMockRawSource({ url: 'https://example2.com/guide' }),
      createMockRawSource({ url: 'https://example3.com/guide' }),
    ];
    const deps = createMockCleanerDeps();

    const result = await cleanSourcesBatch(sources, deps);

    expect(result.sources.length).toBe(3);
    expect(deps.generateObject).toHaveBeenCalledTimes(3);
    // Token usage aggregated from all 3 calls (100 input + 50 output each)
    expect(result.tokenUsage.input).toBe(300);
    expect(result.tokenUsage.output).toBe(150);
  });

  it('filters out failed cleaning results', async () => {
    const sources = [
      createMockRawSource({ url: 'https://example1.com/guide' }),
      createMockRawSource({ url: 'https://example2.com/guide', content: '' }), // Will be skipped
      createMockRawSource({ url: 'https://example3.com/guide' }),
    ];
    const deps = createMockCleanerDeps();

    const result = await cleanSourcesBatch(sources, deps);

    expect(result.sources.length).toBe(2);
    expect(deps.generateObject).toHaveBeenCalledTimes(2);
  });

  it('processes sources in correct batch size', async () => {
    // Create more sources than BATCH_SIZE
    const sources = Array.from({ length: CLEANER_CONFIG.BATCH_SIZE + 2 }, (_, i) =>
      createMockRawSource({ url: `https://example${i}.com/guide` })
    );
    const deps = createMockCleanerDeps();

    const result = await cleanSourcesBatch(sources, deps);

    expect(result.sources.length).toBe(sources.length);
  });

  it('logs progress information', async () => {
    const sources = [
      createMockRawSource({ url: 'https://example1.com/guide' }),
      createMockRawSource({ url: 'https://example2.com/guide' }),
    ];
    const deps = createMockCleanerDeps();

    await cleanSourcesBatch(sources, deps);

    expect(deps.logger.info).toHaveBeenCalled();
  });

  it('respects abort signal between batches', async () => {
    const sources = Array.from({ length: CLEANER_CONFIG.BATCH_SIZE + 1 }, (_, i) =>
      createMockRawSource({ url: `https://example${i}.com/guide` })
    );

    const abortController = new AbortController();
    const deps = {
      ...createMockCleanerDeps(),
      signal: abortController.signal,
    };

    // Abort after first batch starts
    deps.generateObject.mockImplementation(async () => {
      abortController.abort();
      return { 
        object: createMockCleanerOutput(),
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    });

    const result = await cleanSourcesBatch(sources, deps);

    // Should have processed first batch before abort was checked
    expect(result.sources.length).toBeLessThanOrEqual(CLEANER_CONFIG.BATCH_SIZE);
  });
});

// ============================================================================
// CLEANER_CONFIG Tests
// ============================================================================

describe('CLEANER_CONFIG', () => {
  it('has valid temperature range', () => {
    expect(CLEANER_CONFIG.TEMPERATURE).toBeGreaterThanOrEqual(0);
    expect(CLEANER_CONFIG.TEMPERATURE).toBeLessThanOrEqual(2);
  });

  it('has positive batch size', () => {
    expect(CLEANER_CONFIG.BATCH_SIZE).toBeGreaterThan(0);
  });

  it('has positive timeout', () => {
    expect(CLEANER_CONFIG.TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('has valid quality thresholds', () => {
    expect(CLEANER_CONFIG.MIN_QUALITY_FOR_CACHE).toBeGreaterThanOrEqual(0);
    expect(CLEANER_CONFIG.MIN_QUALITY_FOR_CACHE).toBeLessThanOrEqual(100);
    expect(CLEANER_CONFIG.AUTO_EXCLUDE_THRESHOLD).toBeGreaterThanOrEqual(0);
    expect(CLEANER_CONFIG.AUTO_EXCLUDE_THRESHOLD).toBeLessThanOrEqual(100);
  });

  it('has valid tier thresholds in descending order', () => {
    const { TIER_THRESHOLDS } = CLEANER_CONFIG;
    expect(TIER_THRESHOLDS.excellent).toBeGreaterThan(TIER_THRESHOLDS.good);
    expect(TIER_THRESHOLDS.good).toBeGreaterThan(TIER_THRESHOLDS.average);
    expect(TIER_THRESHOLDS.average).toBeGreaterThan(TIER_THRESHOLDS.poor);
  });
});
