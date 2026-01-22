import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  applyDomainTruncation,
  cleanSourcesBatch,
  cleanSourceTwoStep,
  CLEANER_CONFIG,
  PureCleanerOutputSchema,
  EnhancedSummarySchema,
  type TwoStepCleanerDeps,
} from '../../../src/ai/articles/agents/cleaner';
import { extractDomain } from '../../../src/ai/articles/source-cache';
import type { RawSourceInput } from '../../../src/ai/articles/types';

// ============================================================================
// Mock Setup
// ============================================================================

const createMockGenerateText = () => vi.fn();
const createMockModel = () => ({} as any);

// ============================================================================
// Test Fixtures
// ============================================================================

// Generate content that exceeds MIN_CLEANED_CHARS (1000)
const LONG_CONTENT = `
Navigation: Home > Games > Elden Ring

# Elden Ring Combat Guide

This is a comprehensive guide to combat in Elden Ring. The game features
a complex combat system with many weapon types and playstyles that players
need to master in order to succeed in the Lands Between.

## Basic Combat Mechanics

Stamina management is crucial in Elden Ring. Every action costs stamina, 
so you need to balance offense and defense carefully. Running out of stamina
at the wrong moment can leave you vulnerable to devastating counterattacks.

## Weapon Types

There are many weapon types in Elden Ring that cater to different playstyles:
- Swords (straight, curved, great) - versatile and beginner-friendly
- Axes (regular and great) - high damage but slower attacks
- Spears and halberds - excellent reach for keeping enemies at bay
- Magic catalysts - for intelligence builds and ranged combat
- Colossal weapons - massive damage but require high strength

## Combat Tips for Beginners

1. Always keep an eye on your stamina bar
2. Learn enemy attack patterns before going aggressive
3. Rolling has invincibility frames (i-frames) during the animation
4. Blocking is useful but costs stamina
5. Two-handing a weapon increases damage and can stagger enemies faster

## Boss Fight Strategies

When facing bosses in Elden Ring, patience is key. Most bosses have 
multiple phases and learning their movesets is essential. Using Spirit
Ashes can provide valuable distraction and damage support during tough
encounters.

Cookie Settings | Privacy Policy | Terms of Service
© 2024 Example Gaming Site
`.repeat(2); // Ensure we exceed 1000 chars

const createMockRawSource = (overrides: Partial<RawSourceInput> = {}): RawSourceInput => ({
  url: 'https://example.com/guide',
  title: 'Elden Ring Guide',
  content: LONG_CONTENT,
  searchSource: 'tavily',
  ...overrides,
});

// Generate cleaned content that exceeds MIN_CLEANED_CHARS (1000)
const CLEANED_CONTENT = `# Elden Ring Combat Guide

This is a comprehensive guide to combat in Elden Ring. The game features
a complex combat system with many weapon types and playstyles that players
need to master in order to succeed in the Lands Between.

## Basic Combat Mechanics

Stamina management is crucial in Elden Ring. Every action costs stamina, 
so you need to balance offense and defense carefully. Running out of stamina
at the wrong moment can leave you vulnerable to devastating counterattacks.

## Weapon Types

There are many weapon types in Elden Ring that cater to different playstyles:
- Swords (straight, curved, great) - versatile and beginner-friendly
- Axes (regular and great) - high damage but slower attacks
- Spears and halberds - excellent reach for keeping enemies at bay
- Magic catalysts - for intelligence builds and ranged combat
- Colossal weapons - massive damage but require high strength

## Combat Tips for Beginners

1. Always keep an eye on your stamina bar
2. Learn enemy attack patterns before going aggressive
3. Rolling has invincibility frames (i-frames) during the animation
4. Blocking is useful but costs stamina
5. Two-handing a weapon increases damage and can stagger enemies faster

## Boss Fight Strategies

When facing bosses in Elden Ring, patience is key. Most bosses have 
multiple phases and learning their movesets is essential. Using Spirit
Ashes can provide valuable distraction and damage support during tough
encounters.`.repeat(2); // Ensure we exceed 1000 chars

/**
 * Create mock output for step 1 (pure cleaning).
 */
const createMockPureCleanerOutput = (overrides: Partial<{
  cleanedContent: string;
  qualityScore: number;
  relevanceScore: number;
  qualityNotes: string;
  contentType: string;
}> = {}) => ({
  cleanedContent: CLEANED_CONTENT,
  qualityScore: 75,
  relevanceScore: 90,
  qualityNotes: 'Good guide content with clear structure. Relevant gaming information.',
  contentType: 'strategy guide',
  ...overrides,
});

/**
 * Create mock output for step 2 (enhanced summary).
 */
const createMockEnhancedSummaryOutput = (overrides: Partial<{
  summary: string;
  detailedSummary: string;
  keyFacts: string[];
  dataPoints: string[];
  procedures: string[];
  requirements: string[];
}> = {}) => ({
  summary: 'A combat guide for Elden Ring covering basic mechanics and weapon types.',
  detailedSummary: `This comprehensive Elden Ring combat guide covers the fundamental mechanics of combat, including stamina management which is crucial for balancing offense and defense. The guide details various weapon types available in the game.

The combat system features multiple weapon categories including swords (straight, curved, and great variants), axes (regular and great), spears and halberds, and magic catalysts. Each weapon type offers different playstyles and strategic options for players.

Stamina is the core resource in combat - every action from attacking to dodging costs stamina, requiring players to carefully manage their resources during encounters.`,
  keyFacts: [
    'Stamina management is crucial - every action costs stamina',
    'Multiple weapon types: swords, axes, spears, halberds, magic catalysts',
    'Sword variants include straight, curved, and great swords',
    'Combat requires balancing offense and defense',
  ],
  dataPoints: [
    'Elden Ring',
    'FromSoftware',
    'action RPG',
  ],
  procedures: [],
  requirements: [],
  ...overrides,
});

/**
 * Create mock deps for two-step cleaning.
 * The mock generates different outputs based on which step is being called.
 */
const createMockTwoStepCleanerDeps = (options?: {
  step1Output?: ReturnType<typeof createMockPureCleanerOutput>;
  step2Output?: ReturnType<typeof createMockEnhancedSummaryOutput>;
  step1Error?: Error;
  step2Error?: Error;
}): TwoStepCleanerDeps => {
  let callCount = 0;
  
  return {
    generateText: vi.fn().mockImplementation(async (args: any) => {
      callCount++;
      
      // First call is step 1 (cleaning), second call is step 2 (summarization)
      if (callCount === 1) {
        if (options?.step1Error) {
          throw options.step1Error;
        }
        return {
          output: options?.step1Output ?? createMockPureCleanerOutput(),
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      } else {
        if (options?.step2Error) {
          throw options.step2Error;
        }
        return {
          output: options?.step2Output ?? createMockEnhancedSummaryOutput(),
          usage: { inputTokens: 50, outputTokens: 100 },
        };
      }
    }),
    cleanerModel: createMockModel(),
    summarizerModel: createMockModel(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    gameName: 'Elden Ring',
  };
};

/**
 * Create mock CleanerDeps for cleanSourcesBatch (uses model as fallback for summarizerModel).
 * 
 * NOTE: This mock distinguishes Step 1 vs Step 2 by inspecting prompt content.
 * This is coupled to the actual prompt strings in cleaner.ts:
 * - Step 1 (cleaning): getPureCleanerUserPrompt() contains 'SOURCE METADATA' and 'RAW WEB CONTENT'
 * - Step 2 (summarization): getEnhancedSummaryUserPrompt() contains 'CLEANED CONTENT TO SUMMARIZE'
 * 
 * If those prompts change, these tests may silently break. Consider updating the
 * string checks below if you modify the cleaner prompts.
 */
const createMockCleanerDeps = (options?: {
  step1Output?: ReturnType<typeof createMockPureCleanerOutput>;
  step2Output?: ReturnType<typeof createMockEnhancedSummaryOutput>;
}) => {
  return {
    generateText: vi.fn().mockImplementation(async (args: any) => {
      const prompt = args.prompt || '';
      
      // Distinguish step by prompt content (see NOTE above about coupling)
      const isStep1 = prompt.includes('SOURCE METADATA') || prompt.includes('RAW WEB CONTENT');
      
      if (isStep1) {
        return {
          output: options?.step1Output ?? createMockPureCleanerOutput(),
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      } else {
        return {
          output: options?.step2Output ?? createMockEnhancedSummaryOutput(),
          usage: { inputTokens: 50, outputTokens: 100 },
        };
      }
    }),
    model: createMockModel(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    gameName: 'Elden Ring',
  };
};

// ============================================================================
// PureCleanerOutputSchema Tests
// ============================================================================

describe('PureCleanerOutputSchema', () => {
  it('validates correct output', () => {
    const validOutput = createMockPureCleanerOutput();
    const result = PureCleanerOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it('rejects empty cleanedContent', () => {
    const invalidOutput = createMockPureCleanerOutput({ cleanedContent: '' });
    const result = PureCleanerOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('rejects qualityScore below 0', () => {
    const invalidOutput = createMockPureCleanerOutput({ qualityScore: -1 });
    const result = PureCleanerOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('rejects qualityScore above 100', () => {
    const invalidOutput = createMockPureCleanerOutput({ qualityScore: 101 });
    const result = PureCleanerOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('rejects empty contentType', () => {
    const invalidOutput = { ...createMockPureCleanerOutput(), contentType: '' };
    const result = PureCleanerOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// EnhancedSummarySchema Tests
// ============================================================================

describe('EnhancedSummarySchema', () => {
  it('validates correct output', () => {
    const validOutput = createMockEnhancedSummaryOutput();
    const result = EnhancedSummarySchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it('rejects summary that is too short', () => {
    const invalidOutput = createMockEnhancedSummaryOutput({ summary: 'Short' });
    const result = EnhancedSummarySchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('rejects detailedSummary that is too short', () => {
    const invalidOutput = createMockEnhancedSummaryOutput({ detailedSummary: 'Too short' });
    const result = EnhancedSummarySchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('requires minimum keyFacts', () => {
    const invalidOutput = createMockEnhancedSummaryOutput({ keyFacts: ['Only one fact'] });
    const result = EnhancedSummarySchema.safeParse(invalidOutput);
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
// cleanSourceTwoStep Tests
// ============================================================================

describe('cleanSourceTwoStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cleans source content successfully with two steps', async () => {
    const rawSource = createMockRawSource();
    const deps = createMockTwoStepCleanerDeps();

    const result = await cleanSourceTwoStep(rawSource, deps);

    expect(result.source).not.toBeNull();
    expect(result.source?.url).toBe(rawSource.url);
    expect(result.source?.domain).toBe('example.com');
    expect(result.source?.qualityScore).toBe(75);
    expect(result.source?.contentType).toBe('strategy guide');
    expect(result.source?.summary).toBe('A combat guide for Elden Ring covering basic mechanics and weapon types.');
    expect(result.totalTokenUsage).toBeDefined();
    expect(result.cleaningTokenUsage.input).toBe(100);
    expect(result.summaryTokenUsage.input).toBe(50);
    expect(deps.generateText).toHaveBeenCalledTimes(2); // Step 1 + Step 2
  });

  it('returns null source for empty content', async () => {
    const rawSource = createMockRawSource({ content: '' });
    const deps = createMockTwoStepCleanerDeps();

    const result = await cleanSourceTwoStep(rawSource, deps);

    expect(result.source).toBeNull();
    expect(result.totalTokenUsage.input).toBe(0);
    expect(deps.generateText).not.toHaveBeenCalled();
  });

  it('returns null source for content too short', async () => {
    const rawSource = createMockRawSource({ content: 'Short' });
    const deps = createMockTwoStepCleanerDeps();

    const result = await cleanSourceTwoStep(rawSource, deps);

    expect(result.source).toBeNull();
    expect(result.totalTokenUsage.input).toBe(0);
    expect(deps.generateText).not.toHaveBeenCalled();
  });

  it('returns source without summary when step 1 succeeds but step 2 fails', async () => {
    const rawSource = createMockRawSource();
    const deps = createMockTwoStepCleanerDeps({
      step2Error: new Error('Summarization failed'),
    });

    const result = await cleanSourceTwoStep(rawSource, deps);

    // Should still return the cleaned source even if summarization fails
    expect(result.source).not.toBeNull();
    expect(result.source?.cleanedContent).toBeDefined();
    expect(result.source?.summary).toBeNull();
    expect(result.enhancedSummary).toBeNull();
  });

  it('preserves search source in output', async () => {
    const rawSource = createMockRawSource({ searchSource: 'exa' });
    const deps = createMockTwoStepCleanerDeps();

    const result = await cleanSourceTwoStep(rawSource, deps);

    expect(result.source?.searchSource).toBe('exa');
  });

  it('includes game name in prompts when provided', async () => {
    const rawSource = createMockRawSource();
    const deps = createMockTwoStepCleanerDeps();

    await cleanSourceTwoStep(rawSource, deps);

    // Check step 1 prompt contains game name
    const step1Call = (deps.generateText as any).mock.calls[0][0];
    expect(step1Call.prompt).toContain('Elden Ring');
    
    // Check step 2 prompt contains game name
    const step2Call = (deps.generateText as any).mock.calls[1][0];
    expect(step2Call.prompt).toContain('Elden Ring');
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
    expect(deps.generateText).not.toHaveBeenCalled();
  });

  it('cleans multiple sources using two-step cleaning', async () => {
    const sources = [
      createMockRawSource({ url: 'https://example1.com/guide' }),
      createMockRawSource({ url: 'https://example2.com/guide' }),
    ];
    const deps = createMockCleanerDeps();

    const result = await cleanSourcesBatch(sources, deps);

    expect(result.sources.length).toBe(2);
    // Each source requires 2 calls (step 1 + step 2) = 4 total
    expect(deps.generateText).toHaveBeenCalledTimes(4);
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

  it('uses model as fallback when summarizerModel is not provided', async () => {
    const sources = [createMockRawSource()];
    const deps = createMockCleanerDeps();
    // deps doesn't have summarizerModel, so model should be used for both steps

    const result = await cleanSourcesBatch(sources, deps);

    expect(result.sources.length).toBe(1);
    // Both steps should have been called
    expect(deps.generateText).toHaveBeenCalledTimes(2);
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

  it('has positive timeouts', () => {
    expect(CLEANER_CONFIG.STEP1_TIMEOUT_MS).toBeGreaterThan(0);
    expect(CLEANER_CONFIG.STEP2_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('has valid quality thresholds', () => {
    expect(CLEANER_CONFIG.MIN_QUALITY_FOR_STORAGE).toBeGreaterThanOrEqual(0);
    expect(CLEANER_CONFIG.MIN_QUALITY_FOR_STORAGE).toBeLessThanOrEqual(100);
    expect(CLEANER_CONFIG.MIN_QUALITY_FOR_RESULTS).toBeGreaterThanOrEqual(0);
    expect(CLEANER_CONFIG.MIN_QUALITY_FOR_RESULTS).toBeLessThanOrEqual(100);
    expect(CLEANER_CONFIG.AUTO_EXCLUDE_QUALITY_THRESHOLD).toBeGreaterThanOrEqual(0);
    expect(CLEANER_CONFIG.AUTO_EXCLUDE_QUALITY_THRESHOLD).toBeLessThanOrEqual(100);
  });

  it('has valid tier thresholds in descending order', () => {
    const { TIER_THRESHOLDS } = CLEANER_CONFIG;
    expect(TIER_THRESHOLDS.excellent).toBeGreaterThan(TIER_THRESHOLDS.good);
    expect(TIER_THRESHOLDS.good).toBeGreaterThan(TIER_THRESHOLDS.average);
    expect(TIER_THRESHOLDS.average).toBeGreaterThan(TIER_THRESHOLDS.poor);
  });
});

// ============================================================================
// applyDomainTruncation Tests
// ============================================================================

describe('applyDomainTruncation', () => {
  const SAMPLE_CONTENT = `
# Game Guide

This is useful content about the game.

## Strategy Section

Here are some tips and strategies.

Join the page discussion

User123: Great guide!
User456: Thanks for the tips.
`;

  const GAME8_CONTENT = `
# Boss Guide

How to defeat the boss.

## Comment

Anonymous: This was helpful!
Another: Thanks!
`;

  const IGN_CONTENT = `
# Walkthrough Guide

Step 1: Do this thing.
Step 2: Do that thing.

## Tips

Some helpful tips here.

Was this guide helpful?

Leave feedback

In This Guide

Related articles here.
`;

  describe('domain matching', () => {
    it('returns unchanged content when no domain matches', () => {
      const result = applyDomainTruncation(SAMPLE_CONTENT, 'https://example.com/page');
      
      expect(result.wasTruncated).toBe(false);
      expect(result.content).toBe(SAMPLE_CONTENT);
      expect(result.appliedRule).toBeNull();
      expect(result.originalLength).toBe(SAMPLE_CONTENT.length);
      expect(result.newLength).toBe(SAMPLE_CONTENT.length);
    });

    it('matches exact domain', () => {
      const result = applyDomainTruncation(SAMPLE_CONTENT, 'https://fextralife.com/page');
      
      expect(result.wasTruncated).toBe(true);
      expect(result.appliedRule?.domainPattern).toBe('fextralife.com');
    });

    it('matches subdomain (e.g., wiki.fextralife.com)', () => {
      const result = applyDomainTruncation(SAMPLE_CONTENT, 'https://expedition33.wiki.fextralife.com/Simon');
      
      expect(result.wasTruncated).toBe(true);
      expect(result.appliedRule?.domainPattern).toBe('fextralife.com');
    });

    it('does NOT match domain with similar suffix (evil-fextralife.com)', () => {
      const result = applyDomainTruncation(SAMPLE_CONTENT, 'https://evil-fextralife.com/page');
      
      expect(result.wasTruncated).toBe(false);
      expect(result.appliedRule).toBeNull();
    });

    it('does NOT match domain with pattern as subdomain (fextralife.com.evil.com)', () => {
      const result = applyDomainTruncation(SAMPLE_CONTENT, 'https://fextralife.com.evil.com/page');
      
      expect(result.wasTruncated).toBe(false);
      expect(result.appliedRule).toBeNull();
    });

    it('handles malformed URLs gracefully', () => {
      const result = applyDomainTruncation(SAMPLE_CONTENT, 'not-a-valid-url');
      
      expect(result.wasTruncated).toBe(false);
      expect(result.content).toBe(SAMPLE_CONTENT);
    });
  });

  describe('marker truncation', () => {
    it('returns unchanged content when marker is not found', () => {
      const contentWithoutMarker = 'This content has no comment section marker.';
      const result = applyDomainTruncation(contentWithoutMarker, 'https://fextralife.com/page');
      
      expect(result.wasTruncated).toBe(false);
      expect(result.content).toBe(contentWithoutMarker);
    });

    it('truncates content after fextralife marker', () => {
      const result = applyDomainTruncation(SAMPLE_CONTENT, 'https://fextralife.com/page');
      
      expect(result.wasTruncated).toBe(true);
      expect(result.content).not.toContain('Join the page discussion');
      expect(result.content).not.toContain('User123');
      expect(result.content).toContain('Strategy Section');
      expect(result.newLength).toBeLessThan(result.originalLength);
    });

    it('truncates content after game8 marker', () => {
      const result = applyDomainTruncation(GAME8_CONTENT, 'https://game8.co/games/Test/archives/123');
      
      expect(result.wasTruncated).toBe(true);
      expect(result.content).not.toContain('## Comment');
      expect(result.content).not.toContain('Anonymous');
      expect(result.content).toContain('Boss Guide');
    });

    it('truncates content after ign marker', () => {
      const result = applyDomainTruncation(IGN_CONTENT, 'https://www.ign.com/wikis/game/Guide');
      
      expect(result.wasTruncated).toBe(true);
      expect(result.content).not.toContain('Was this guide helpful?');
      expect(result.content).not.toContain('Leave feedback');
      expect(result.content).not.toContain('In This Guide');
      expect(result.content).toContain('Walkthrough Guide');
      expect(result.content).toContain('Tips');
    });

    it('performs case-insensitive marker search', () => {
      const contentWithUpperMarker = 'Content here.\n\nJOIN THE PAGE DISCUSSION\n\nComments here.';
      const result = applyDomainTruncation(contentWithUpperMarker, 'https://fextralife.com/page');
      
      expect(result.wasTruncated).toBe(true);
      expect(result.content).not.toContain('JOIN THE PAGE DISCUSSION');
    });

    it('trims whitespace from truncated content', () => {
      const contentWithTrailingWhitespace = 'Content here.   \n\n\nJoin the page discussion\n\nComments.';
      const result = applyDomainTruncation(contentWithTrailingWhitespace, 'https://fextralife.com/page');
      
      expect(result.wasTruncated).toBe(true);
      expect(result.content).toBe('Content here.');
    });
  });

  describe('rule application', () => {
    it('applies only the first matching rule when multiple could match', () => {
      // Both fextralife marker and game8 marker present, but fextralife domain
      const mixedContent = 'Content.\n\n## Comment\n\nJoin the page discussion\n\nMore.';
      const result = applyDomainTruncation(mixedContent, 'https://fextralife.com/page');
      
      // Should use fextralife's marker ("Join the page discussion"), not game8's ("## Comment")
      expect(result.wasTruncated).toBe(true);
      expect(result.content).toContain('## Comment'); // game8 marker should remain
      expect(result.content).not.toContain('Join the page discussion');
    });
  });
});
