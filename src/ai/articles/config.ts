/**
 * Article Generation Configuration
 *
 * Centralized configuration for all article generation agents and utilities.
 * All magic numbers and tuning parameters should be defined here.
 */

// ============================================================================
// Configuration Validation
// ============================================================================

/**
 * Configuration validation error.
 * Thrown at module load time if configuration is inconsistent.
 */
class ConfigValidationError extends Error {
  constructor(message: string) {
    super(`Article generation config error: ${message}`);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validates that a MIN value is less than or equal to MAX value.
 */
function validateMinMax(
  minValue: number,
  maxValue: number,
  minName: string,
  maxName: string
): void {
  if (minValue > maxValue) {
    throw new ConfigValidationError(
      `${minName} (${minValue}) cannot be greater than ${maxName} (${maxValue})`
    );
  }
}

/**
 * Validates that a value is positive.
 */
function validatePositive(value: number, name: string): void {
  if (value <= 0) {
    throw new ConfigValidationError(`${name} must be positive (got ${value})`);
  }
}

/**
 * Validates that a value is non-negative.
 */
function validateNonNegative(value: number, name: string): void {
  if (value < 0) {
    throw new ConfigValidationError(`${name} cannot be negative (got ${value})`);
  }
}

/**
 * Validates temperature is in valid range (0-2).
 */
function validateTemperature(value: number, name: string): void {
  if (value < 0 || value > 2) {
    throw new ConfigValidationError(`${name} must be between 0 and 2 (got ${value})`);
  }
}

// ============================================================================
// Article Plan Constraints
// ============================================================================

/**
 * Constraints for article plan validation.
 * Used by Zod schema, validation.ts, and prompts for consistency.
 * ALL validation constants should live here - no magic numbers elsewhere.
 */
export const ARTICLE_PLAN_CONSTRAINTS = {
  // Title constraints
  TITLE_MIN_LENGTH: 10,
  TITLE_MAX_LENGTH: 100,
  TITLE_RECOMMENDED_MAX_LENGTH: 70,

  // Excerpt constraints (for SEO meta description)
  EXCERPT_MIN_LENGTH: 120,
  EXCERPT_MAX_LENGTH: 160,

  // Section constraints
  MIN_SECTIONS: 4,
  MAX_SECTIONS: 12,
  MIN_SECTION_LENGTH: 100,

  // Tags constraints
  MIN_TAGS: 1,
  MAX_TAGS: 10,
  TAG_MAX_LENGTH: 50,

  // Research query constraints
  MIN_RESEARCH_QUERIES_PER_SECTION: 1,
  MAX_RESEARCH_QUERIES_PER_SECTION: 6,

  // Markdown constraints
  MIN_MARKDOWN_LENGTH: 500,

  // Required elements constraints
  MIN_REQUIRED_ELEMENTS: 3,
  MAX_REQUIRED_ELEMENTS: 10,
} as const;

// ============================================================================
// Word Count Configuration
// ============================================================================

/**
 * Default target word counts by article category.
 * These can be overridden by passing targetWordCount in GameArticleContext.
 *
 * Note: Uses string keys to avoid circular dependency with article-plan.ts.
 * Keys must match ArticleCategorySlug values.
 */
export const WORD_COUNT_DEFAULTS: Record<'news' | 'reviews' | 'guides' | 'lists', number> = {
  guides: 2500,
  reviews: 2000,
  news: 1200,
  lists: 1800,
} as const;

/**
 * Constraints for word count calculations.
 */
export const WORD_COUNT_CONSTRAINTS = {
  /** Minimum allowed word count */
  MIN_WORD_COUNT: 800,
  /** Maximum allowed word count */
  MAX_WORD_COUNT: 5000,
  /** Average words per section (used to calculate section count) */
  WORDS_PER_SECTION: 400,
  /** Average words per paragraph (used to calculate paragraph count) */
  WORDS_PER_PARAGRAPH: 120,
  /** Minimum paragraphs per section (floor for dynamic calculation) */
  MIN_PARAGRAPHS_FLOOR: 2,
  /** Maximum paragraphs per section (ceiling for dynamic calculation) */
  MAX_PARAGRAPHS_CEILING: 8,
  /** Subtracted from ideal paragraph count to get minimum */
  PARAGRAPH_RANGE_LOWER_OFFSET: 1,
  /** Added to ideal paragraph count to get maximum */
  PARAGRAPH_RANGE_UPPER_OFFSET: 2,
} as const;

// ============================================================================
// Scout Agent Configuration
// ============================================================================

export const SCOUT_CONFIG = {
  /** Maximum length of a single snippet in search context */
  MAX_SNIPPET_LENGTH: 800,
  /** Maximum number of snippets to include */
  MAX_SNIPPETS: 10,
  /** Number of results for overview search */
  OVERVIEW_SEARCH_RESULTS: 8,
  /** Number of results for category-specific search */
  CATEGORY_SEARCH_RESULTS: 6,
  /** Number of results for recent news search */
  RECENT_SEARCH_RESULTS: 5,
  /** Maximum number of category-specific searches to run */
  MAX_CATEGORY_SEARCHES: 2,
  /** Search depth for overview queries */
  OVERVIEW_SEARCH_DEPTH: 'advanced' as const,
  /** Search depth for category queries */
  CATEGORY_SEARCH_DEPTH: 'advanced' as const,
  /** Search depth for recent news queries */
  RECENT_SEARCH_DEPTH: 'basic' as const,
  /**
   * Temperature for Scout LLM calls.
   *
   * Set low (0.2) because Scout generates research briefings that must be
   * factually accurate and consistent. High temperature would introduce
   * hallucinations or unreliable summaries that propagate to later phases.
   */
  TEMPERATURE: 0.2,
  /** Results to include per search in context */
  RESULTS_PER_SEARCH_CONTEXT: 5,
  /** Limit for key findings in category context */
  KEY_FINDINGS_LIMIT: 3,
  /** Limit for recent results */
  RECENT_RESULTS_LIMIT: 3,
  /** Max content length for recent items */
  RECENT_CONTENT_LENGTH: 300,
  /** Minimum sources before warning */
  MIN_SOURCES_WARNING: 5,
  /** Minimum queries before warning */
  MIN_QUERIES_WARNING: 3,
  /** Minimum overview length to consider valid */
  MIN_OVERVIEW_LENGTH: 50,
} as const;

// ============================================================================
// Editor Agent Configuration
// ============================================================================

export const EDITOR_CONFIG = {
  /**
   * Temperature for Editor LLM calls.
   *
   * Set moderate (0.4) because Editor needs some creativity for compelling
   * titles and section structures, but must stay grounded in the research.
   * Too low = boring/formulaic outlines. Too high = incoherent plans.
   */
  TEMPERATURE: 0.4,
  /** Number of overview lines to include in prompt */
  OVERVIEW_LINES_IN_PROMPT: 10,
} as const;

// ============================================================================
// Specialist Agent Configuration
// ============================================================================

export const SPECIALIST_CONFIG = {
  /** Length of snippets in research context */
  SNIPPET_LENGTH: 280,
  /** Top results to include per query */
  TOP_RESULTS_PER_QUERY: 3,
  /** Characters of previous section to include as context */
  CONTEXT_TAIL_LENGTH: 500,
  /** Minimum paragraphs per section */
  MIN_PARAGRAPHS: 2,
  /** Maximum paragraphs per section */
  MAX_PARAGRAPHS: 5,
  /** Maximum length of Scout overview to include */
  MAX_SCOUT_OVERVIEW_LENGTH: 2500,
  /** Characters of research context per result */
  RESEARCH_CONTEXT_PER_RESULT: 600,
  /** Threshold for "thin research" warning */
  THIN_RESEARCH_THRESHOLD: 500,
  /**
   * Temperature for Specialist LLM calls.
   *
   * Set higher (0.6) because Specialist writes prose that should be engaging,
   * varied in sentence structure, and avoid robotic repetition. The research
   * context constrains factual content while temperature enables stylistic
   * creativity. Lower values produce stilted, repetitive text.
   */
  TEMPERATURE: 0.6,
  /** Results per research context */
  RESULTS_PER_RESEARCH_CONTEXT: 5,
  /** Maximum output tokens per section */
  MAX_OUTPUT_TOKENS_PER_SECTION: 1500,
  /** Search depth for section research */
  SEARCH_DEPTH: 'advanced' as const,
  /** Maximum search results per query */
  MAX_SEARCH_RESULTS: 5,
  /** Maximum sources to include in article */
  MAX_SOURCES: 25,
  /**
   * Number of concurrent search queries during batch research.
   * Higher values = faster research but more API pressure.
   * Set to 3 as a balance between speed and rate limit safety.
   */
  BATCH_CONCURRENCY: 3,
  /**
   * Delay between batches of concurrent searches (ms).
   * Helps avoid rate limiting when making multiple requests.
   */
  BATCH_DELAY_MS: 200,
} as const;

// ============================================================================
// SEO Constraints
// ============================================================================

/**
 * SEO-related constraints for article validation.
 * Based on search engine best practices for SERP display.
 */
export const SEO_CONSTRAINTS = {
  /** Optimal minimum title length for SERP display */
  TITLE_OPTIMAL_MIN: 30,
  /** Optimal maximum title length before truncation */
  TITLE_OPTIMAL_MAX: 60,
  /** Optimal minimum excerpt/meta description length */
  EXCERPT_OPTIMAL_MIN: 120,
  /** Optimal maximum excerpt/meta description length */
  EXCERPT_OPTIMAL_MAX: 160,
  /** Minimum keyword occurrences for SEO */
  MIN_KEYWORD_OCCURRENCES: 2,
  /** Maximum keyword occurrences before keyword stuffing concern */
  MAX_KEYWORD_OCCURRENCES: 8,
} as const;

// ============================================================================
// Reviewer Agent Configuration
// ============================================================================

export const REVIEWER_CONFIG = {
  /**
   * Temperature for Reviewer LLM calls.
   *
   * Set low (0.3) because Reviewer needs to be analytical and consistent
   * in identifying issues. Higher temperature could cause inconsistent
   * issue detection or hallucinated problems.
   */
  TEMPERATURE: 0.3,
  /** Maximum output tokens for review */
  MAX_OUTPUT_TOKENS: 2000,
  /** Maximum article content length to include in review (chars) */
  MAX_ARTICLE_CONTENT_LENGTH: 45000,
  /** Maximum research context length to include in review (chars) */
  MAX_RESEARCH_CONTEXT_LENGTH: 5000,
  /**
   * Whether Reviewer is enabled by default for each article category.
   * Can be overridden per-request via `enableReviewer` option.
   *
   * All categories default to true for consistent quality control.
   * Disable per-request if speed is more important than quality.
   */
  ENABLED_BY_CATEGORY: {
    guides: true,
    reviews: true,
    news: true,
    lists: true,
  } as const satisfies Record<'news' | 'reviews' | 'guides' | 'lists', boolean>,
} as const;

// ============================================================================
// Fixer Agent Configuration (Autonomous Article Recovery)
// ============================================================================

export const FIXER_CONFIG = {
  /**
   * Maximum number of Editor phase retries when plan validation fails.
   * Each retry includes validation feedback in the prompt.
   */
  MAX_PLAN_RETRIES: 3,
  /**
   * Maximum number of retries for a single section during Specialist phase.
   * Applied when a section write fails due to transient errors.
   */
  MAX_SECTION_RETRIES: 2,
  /**
   * Maximum number of Fixer iterations (Reviewer → Fix → Reviewer cycles).
   * Each iteration can apply multiple fixes, then re-reviews.
   */
  MAX_FIXER_ITERATIONS: 3, // TEMP: Disabled for debugging
  /**
   * Temperature for Fixer LLM calls.
   * Slightly higher to allow natural, varied edits.
   */
  TEMPERATURE: 0.5,
  /**
   * Maximum number of fixes to apply in a single iteration.
   */
  MAX_FIXES_PER_ITERATION: 5,
  /**
   * Maximum output tokens for smart fix operations.
   * Give the LLM plenty of space to think and work.
   */
  MAX_OUTPUT_TOKENS_SMART_FIX: 4000,
  /**
   * Priority order for fix strategies when a section has multiple issues.
   * Higher priority strategies are applied first (leftmost = highest priority).
   * - regenerate: Complete rewrite fixes multiple issues at once
   * - add_section: Coverage gaps need new content
   * - inline_insert: Surgical insertions (most precise, low risk)
   * - direct_edit: Minor fixes (low risk)
   * - expand: Thin sections need more depth (higher risk of bloat)
   */
  STRATEGY_PRIORITY: ['regenerate', 'add_section', 'inline_insert', 'direct_edit', 'expand'] as const,
} as const;

// ============================================================================
// Retry Configuration
// ============================================================================

export const RETRY_CONFIG = {
  /** Maximum number of retry attempts */
  MAX_RETRIES: 3,
  /** Initial delay in milliseconds before first retry */
  INITIAL_DELAY_MS: 1000,
  /** Maximum delay in milliseconds between retries */
  MAX_DELAY_MS: 10000,
  /** Multiplier for exponential backoff */
  BACKOFF_MULTIPLIER: 2,
} as const;

// ============================================================================
// Generator Configuration
// ============================================================================

export const GENERATOR_CONFIG = {
  /** Default OpenRouter base URL */
  DEFAULT_OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  /** Default timeout for entire generation (ms) - 0 means no timeout */
  DEFAULT_TIMEOUT_MS: 0,
  /**
   * Progress reporting constants for the Specialist phase.
   * Section progress is reported between START and END percentages.
   */
  SPECIALIST_PROGRESS_START: 10,
  SPECIALIST_PROGRESS_END: 90,
} as const;

// ============================================================================
// Model Pricing Configuration
// ============================================================================

/**
 * Pricing per 1000 tokens for supported models.
 * Prices are approximate and should be updated periodically.
 * Source: OpenRouter pricing page.
 */
export interface ModelPricing {
  /** Cost per 1000 input tokens in USD */
  readonly inputPer1k: number;
  /** Cost per 1000 output tokens in USD */
  readonly outputPer1k: number;
}

/**
 * Known model pricing data.
 * Uses pattern matching - model names are matched against these patterns.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude models
  'anthropic/claude-sonnet-4': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'anthropic/claude-3.5-sonnet': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'anthropic/claude-3-5-haiku': { inputPer1k: 0.001, outputPer1k: 0.005 },
  'anthropic/claude-3-haiku': { inputPer1k: 0.00025, outputPer1k: 0.00125 },
  'anthropic/claude-3-opus': { inputPer1k: 0.015, outputPer1k: 0.075 },

  // OpenAI models
  'openai/gpt-4o': { inputPer1k: 0.005, outputPer1k: 0.015 },
  'openai/gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  'openai/gpt-4-turbo': { inputPer1k: 0.01, outputPer1k: 0.03 },
  'openai/gpt-3.5-turbo': { inputPer1k: 0.0005, outputPer1k: 0.0015 },

  // Meta Llama models
  'meta-llama/llama-3.1-70b-instruct': { inputPer1k: 0.0008, outputPer1k: 0.0008 },
  'meta-llama/llama-3.1-8b-instruct': { inputPer1k: 0.0001, outputPer1k: 0.0001 },

  // Google models
  'google/gemini-pro': { inputPer1k: 0.00025, outputPer1k: 0.0005 },
  'google/gemini-pro-1.5': { inputPer1k: 0.00125, outputPer1k: 0.005 },
} as const;

/**
 * Default pricing when model is not found in MODEL_PRICING.
 * Uses conservative mid-range estimate.
 */
export const DEFAULT_MODEL_PRICING: ModelPricing = {
  inputPer1k: 0.002,
  outputPer1k: 0.008,
};

/**
 * Gets pricing for a model, with fallback to default.
 * Supports partial matching for versioned model names.
 *
 * @param modelName - The model name (e.g., 'anthropic/claude-sonnet-4-20250514')
 * @returns Pricing data for the model
 */
export function getModelPricing(modelName: string): ModelPricing {
  // Try exact match first
  if (MODEL_PRICING[modelName]) {
    return MODEL_PRICING[modelName];
  }

  // Try prefix matching for versioned models
  for (const [pattern, pricing] of Object.entries(MODEL_PRICING)) {
    if (modelName.startsWith(pattern)) {
      return pricing;
    }
  }

  return DEFAULT_MODEL_PRICING;
}

// ============================================================================
// Unified Config Export
// ============================================================================

/**
 * All article generation configuration in a single namespace.
 *
 * @example
 * import { CONFIG } from './config';
 * const temp = CONFIG.scout.TEMPERATURE;
 */
export const CONFIG = {
  scout: SCOUT_CONFIG,
  editor: EDITOR_CONFIG,
  specialist: SPECIALIST_CONFIG,
  reviewer: REVIEWER_CONFIG,
  fixer: FIXER_CONFIG,
  retry: RETRY_CONFIG,
  generator: GENERATOR_CONFIG,
  seo: SEO_CONSTRAINTS,
} as const;

// ============================================================================
// Runtime Configuration Validation
// ============================================================================

/**
 * Validates all configuration values at module load time.
 * Throws ConfigValidationError if any values are inconsistent.
 */
function validateConfiguration(): void {
  // Article Plan Constraints
  validateMinMax(
    ARTICLE_PLAN_CONSTRAINTS.TITLE_MIN_LENGTH,
    ARTICLE_PLAN_CONSTRAINTS.TITLE_MAX_LENGTH,
    'TITLE_MIN_LENGTH',
    'TITLE_MAX_LENGTH'
  );
  validateMinMax(
    ARTICLE_PLAN_CONSTRAINTS.EXCERPT_MIN_LENGTH,
    ARTICLE_PLAN_CONSTRAINTS.EXCERPT_MAX_LENGTH,
    'EXCERPT_MIN_LENGTH',
    'EXCERPT_MAX_LENGTH'
  );
  validateMinMax(
    ARTICLE_PLAN_CONSTRAINTS.MIN_SECTIONS,
    ARTICLE_PLAN_CONSTRAINTS.MAX_SECTIONS,
    'MIN_SECTIONS',
    'MAX_SECTIONS'
  );
  validateMinMax(
    ARTICLE_PLAN_CONSTRAINTS.MIN_TAGS,
    ARTICLE_PLAN_CONSTRAINTS.MAX_TAGS,
    'MIN_TAGS',
    'MAX_TAGS'
  );
  validateMinMax(
    ARTICLE_PLAN_CONSTRAINTS.MIN_RESEARCH_QUERIES_PER_SECTION,
    ARTICLE_PLAN_CONSTRAINTS.MAX_RESEARCH_QUERIES_PER_SECTION,
    'MIN_RESEARCH_QUERIES_PER_SECTION',
    'MAX_RESEARCH_QUERIES_PER_SECTION'
  );
  validatePositive(ARTICLE_PLAN_CONSTRAINTS.MIN_MARKDOWN_LENGTH, 'MIN_MARKDOWN_LENGTH');
  validatePositive(ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH, 'TAG_MAX_LENGTH');

  // Scout Config
  validatePositive(SCOUT_CONFIG.MAX_SNIPPET_LENGTH, 'SCOUT_CONFIG.MAX_SNIPPET_LENGTH');
  validatePositive(SCOUT_CONFIG.MAX_SNIPPETS, 'SCOUT_CONFIG.MAX_SNIPPETS');
  validatePositive(SCOUT_CONFIG.OVERVIEW_SEARCH_RESULTS, 'SCOUT_CONFIG.OVERVIEW_SEARCH_RESULTS');
  validateTemperature(SCOUT_CONFIG.TEMPERATURE, 'SCOUT_CONFIG.TEMPERATURE');

  // Editor Config
  validateTemperature(EDITOR_CONFIG.TEMPERATURE, 'EDITOR_CONFIG.TEMPERATURE');
  validatePositive(EDITOR_CONFIG.OVERVIEW_LINES_IN_PROMPT, 'EDITOR_CONFIG.OVERVIEW_LINES_IN_PROMPT');

  // Specialist Config
  validateTemperature(SPECIALIST_CONFIG.TEMPERATURE, 'SPECIALIST_CONFIG.TEMPERATURE');
  validatePositive(SPECIALIST_CONFIG.SNIPPET_LENGTH, 'SPECIALIST_CONFIG.SNIPPET_LENGTH');
  validateMinMax(
    SPECIALIST_CONFIG.MIN_PARAGRAPHS,
    SPECIALIST_CONFIG.MAX_PARAGRAPHS,
    'SPECIALIST_CONFIG.MIN_PARAGRAPHS',
    'SPECIALIST_CONFIG.MAX_PARAGRAPHS'
  );
  validatePositive(SPECIALIST_CONFIG.BATCH_CONCURRENCY, 'SPECIALIST_CONFIG.BATCH_CONCURRENCY');
  validateNonNegative(SPECIALIST_CONFIG.BATCH_DELAY_MS, 'SPECIALIST_CONFIG.BATCH_DELAY_MS');
  validatePositive(SPECIALIST_CONFIG.MAX_SOURCES, 'SPECIALIST_CONFIG.MAX_SOURCES');

  // Reviewer Config
  validateTemperature(REVIEWER_CONFIG.TEMPERATURE, 'REVIEWER_CONFIG.TEMPERATURE');
  validatePositive(REVIEWER_CONFIG.MAX_OUTPUT_TOKENS, 'REVIEWER_CONFIG.MAX_OUTPUT_TOKENS');
  validatePositive(REVIEWER_CONFIG.MAX_ARTICLE_CONTENT_LENGTH, 'REVIEWER_CONFIG.MAX_ARTICLE_CONTENT_LENGTH');
  validatePositive(REVIEWER_CONFIG.MAX_RESEARCH_CONTEXT_LENGTH, 'REVIEWER_CONFIG.MAX_RESEARCH_CONTEXT_LENGTH');

  // Fixer Config
  validateNonNegative(FIXER_CONFIG.MAX_PLAN_RETRIES, 'FIXER_CONFIG.MAX_PLAN_RETRIES');
  validateNonNegative(FIXER_CONFIG.MAX_SECTION_RETRIES, 'FIXER_CONFIG.MAX_SECTION_RETRIES');
  validateNonNegative(FIXER_CONFIG.MAX_FIXER_ITERATIONS, 'FIXER_CONFIG.MAX_FIXER_ITERATIONS');
  validateTemperature(FIXER_CONFIG.TEMPERATURE, 'FIXER_CONFIG.TEMPERATURE');
  validatePositive(FIXER_CONFIG.MAX_FIXES_PER_ITERATION, 'FIXER_CONFIG.MAX_FIXES_PER_ITERATION');
  validatePositive(FIXER_CONFIG.MAX_OUTPUT_TOKENS_SMART_FIX, 'FIXER_CONFIG.MAX_OUTPUT_TOKENS_SMART_FIX');

  // Retry Config
  validatePositive(RETRY_CONFIG.MAX_RETRIES, 'RETRY_CONFIG.MAX_RETRIES');
  validatePositive(RETRY_CONFIG.INITIAL_DELAY_MS, 'RETRY_CONFIG.INITIAL_DELAY_MS');
  validateMinMax(
    RETRY_CONFIG.INITIAL_DELAY_MS,
    RETRY_CONFIG.MAX_DELAY_MS,
    'RETRY_CONFIG.INITIAL_DELAY_MS',
    'RETRY_CONFIG.MAX_DELAY_MS'
  );
  validatePositive(RETRY_CONFIG.BACKOFF_MULTIPLIER, 'RETRY_CONFIG.BACKOFF_MULTIPLIER');

  // Generator Config
  validateNonNegative(GENERATOR_CONFIG.DEFAULT_TIMEOUT_MS, 'GENERATOR_CONFIG.DEFAULT_TIMEOUT_MS');
  validateMinMax(
    GENERATOR_CONFIG.SPECIALIST_PROGRESS_START,
    GENERATOR_CONFIG.SPECIALIST_PROGRESS_END,
    'GENERATOR_CONFIG.SPECIALIST_PROGRESS_START',
    'GENERATOR_CONFIG.SPECIALIST_PROGRESS_END'
  );

  // Word Count Constraints
  validateMinMax(
    WORD_COUNT_CONSTRAINTS.MIN_WORD_COUNT,
    WORD_COUNT_CONSTRAINTS.MAX_WORD_COUNT,
    'WORD_COUNT_CONSTRAINTS.MIN_WORD_COUNT',
    'WORD_COUNT_CONSTRAINTS.MAX_WORD_COUNT'
  );
  validatePositive(WORD_COUNT_CONSTRAINTS.WORDS_PER_SECTION, 'WORD_COUNT_CONSTRAINTS.WORDS_PER_SECTION');
  validatePositive(WORD_COUNT_CONSTRAINTS.WORDS_PER_PARAGRAPH, 'WORD_COUNT_CONSTRAINTS.WORDS_PER_PARAGRAPH');

  // Word Count Defaults - ensure all are within constraints
  for (const [category, wordCount] of Object.entries(WORD_COUNT_DEFAULTS)) {
    if (wordCount < WORD_COUNT_CONSTRAINTS.MIN_WORD_COUNT || wordCount > WORD_COUNT_CONSTRAINTS.MAX_WORD_COUNT) {
      throw new ConfigValidationError(
        `WORD_COUNT_DEFAULTS.${category} (${wordCount}) must be between ` +
        `${WORD_COUNT_CONSTRAINTS.MIN_WORD_COUNT} and ${WORD_COUNT_CONSTRAINTS.MAX_WORD_COUNT}`
      );
    }
  }

  // Required elements constraints
  validateMinMax(
    ARTICLE_PLAN_CONSTRAINTS.MIN_REQUIRED_ELEMENTS,
    ARTICLE_PLAN_CONSTRAINTS.MAX_REQUIRED_ELEMENTS,
    'ARTICLE_PLAN_CONSTRAINTS.MIN_REQUIRED_ELEMENTS',
    'ARTICLE_PLAN_CONSTRAINTS.MAX_REQUIRED_ELEMENTS'
  );

  // SEO Constraints
  validateMinMax(
    SEO_CONSTRAINTS.TITLE_OPTIMAL_MIN,
    SEO_CONSTRAINTS.TITLE_OPTIMAL_MAX,
    'SEO_CONSTRAINTS.TITLE_OPTIMAL_MIN',
    'SEO_CONSTRAINTS.TITLE_OPTIMAL_MAX'
  );
  validateMinMax(
    SEO_CONSTRAINTS.EXCERPT_OPTIMAL_MIN,
    SEO_CONSTRAINTS.EXCERPT_OPTIMAL_MAX,
    'SEO_CONSTRAINTS.EXCERPT_OPTIMAL_MIN',
    'SEO_CONSTRAINTS.EXCERPT_OPTIMAL_MAX'
  );
  validateMinMax(
    SEO_CONSTRAINTS.MIN_KEYWORD_OCCURRENCES,
    SEO_CONSTRAINTS.MAX_KEYWORD_OCCURRENCES,
    'SEO_CONSTRAINTS.MIN_KEYWORD_OCCURRENCES',
    'SEO_CONSTRAINTS.MAX_KEYWORD_OCCURRENCES'
  );
}

// Run validation at module load time
validateConfiguration();

