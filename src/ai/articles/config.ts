/**
 * Article Generation Configuration
 *
 * Centralized configuration for all article generation agents and utilities.
 * All magic numbers and tuning parameters should be defined here.
 */

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
  retry: RETRY_CONFIG,
  generator: GENERATOR_CONFIG,
} as const;

