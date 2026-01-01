/**
 * Article Generation Configuration
 *
 * Centralized configuration for all article generation agents and utilities.
 * All magic numbers and tuning parameters should be defined here.
 */

// ============================================================================
// UNIFIED EXCLUDED DOMAINS LIST
// ============================================================================

/**
 * SINGLE SOURCE OF TRUTH for domain exclusions.
 * Used by both search APIs (Tavily/Exa) and the cleaner/cache system.
 *
 * Domains are excluded for one of these reasons:
 * 1. NO_CONTENT: No useful text content (video platforms, audio)
 * 2. LOW_AUTHORITY: User-generated content with low editorial standards
 * 3. NOT_VIDEO_GAMES: Content not about video games
 * 4. SPAM: Commercial or spam sites
 * 5. OFF_TOPIC: Technical/programming content unrelated to gaming
 */
export const UNIFIED_EXCLUDED_DOMAINS = new Set([
  // === ADULT: Adult content sites (never relevant) ===
  'xhamster.com',
  'pornhub.com',
  'xvideos.com',
  'xnxx.com',
  'redtube.com',

  // === NO_CONTENT: Video/audio platforms (no extractable text) ===
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'twitch.tv',

  // === LOW_AUTHORITY: Social media ===
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',

  // === SPAM: Game marketplaces / key resellers ===
  'g2a.com',
  'cdkeys.com',
  'eneba.com',
  'kinguin.net',
  'voidu.com',
  'fanatical.com',

  // === SPAM: Gold selling / RMT sites ===
  'mtmmo.com',
  'u4gm.com',
  'mmogah.com', // Gold/item selling
  'aoeah.com', // Game currency selling
  'mmopixel.com', // Game currency selling

  // === LOW_AUTHORITY: Q&A / forums / social ===
  'quora.com',
  'reddit.com', // User-generated, inconsistent quality
  'www.reddit.com',
  'old.reddit.com',
  'gamefaqs.gamespot.com', // Use official GameSpot guides instead
  'steamcommunity.com', // Low-quality discussions
  'fextralife.com', // Forums at fextralife.com/forums (wikis like eldenring.wiki.fextralife.com are fine)
  '4chan.org', // Anonymous forum, often toxic
  'boards.4chan.org',
  'resetera.com', // Gaming forum, low quality (25 avg score in DB)
  'forum.psnprofiles.com', // Trophy hunting forum

  // === OFF_TOPIC: Generic tech (not gaming-focused) ===
  'techradar.com',
  'radiotimes.com',
  'beebom.com',
  'exitlag.com', // VPN SEO content

  // === OFF_TOPIC: News aggregators ===
  'news.google.com',
  'msn.com', // Aggregates content from other sites

  // === OFF_TOPIC: Non-gaming garbage ===
  'ww2.jacksonms.gov', // Government PDF spam
  'ftp.oshatrain.org', // Random FTP server
  'freewp.co.il', // WordPress spam forum
  'catalog.neet.tv', // Dead link aggregator

  // === NOT_VIDEO_GAMES: Mod sites (mods ≠ game guides) ===
  'nexusmods.com',
  'www.nexusmods.com',
  'moddb.com',
  'www.moddb.com',
  'ersc-docs.github.io', // Mod documentation
  'err.fandom.com', // Elden Ring Reforged mod wiki (not vanilla game)

  // === NOT_VIDEO_GAMES: Speedrunning (too niche for general guides) ===
  'soulsspeedruns.com',
  'speedrun.com',

  // === NOT_VIDEO_GAMES: Board games / tabletop ===
  'boardgamegeek.com',

  // === OFF_TOPIC: Programming / development ===
  'flask.palletsprojects.com',
  'docs.python.org',
  'stackoverflow.com',
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'openprocessing.org', // Art/coding platform
  'lunanotes.io', // AI note-taking app
  'coohom.com', // Interior design platform

  // === OFF_TOPIC: Document sharing ===
  'scribd.com',

  // === LOW_QUALITY: News/content farms ===
  'timesofindia.indiatimes.com',
  'oreateai.com', // AI-generated spam
  'mandatory.gg',

  // === OFF_TOPIC: Non-gaming sites found in searches ===
  'plarium.com', // Mobile game publisher, aggressive monetization spam
  'arsturn.com', // AI chatbot company
  'freewp.co.il', // WordPress site, not gaming
]);

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
  // Title constraints - optimized for SEO visibility
  // Google truncates at ~60 chars, so we target 50-65 for full visibility
  TITLE_MIN_LENGTH: 30,
  TITLE_MAX_LENGTH: 65,
  /** @deprecated Use TITLE_MAX_LENGTH (65) - this was too generous for SEO */
  TITLE_RECOMMENDED_MAX_LENGTH: 65,

  // Excerpt constraints (for SEO meta description)
  // Google typically shows 150-160 chars, but can display up to 300
  EXCERPT_MIN_LENGTH: 120,
  EXCERPT_RECOMMENDED_MAX_LENGTH: 160, // Ideal for SEO - used in prompts
  EXCERPT_MAX_LENGTH: 200, // Hard cap for schema - allows some flexibility

  // Section constraints
  MIN_SECTIONS: 4,
  MAX_SECTIONS: 12,
  MIN_SECTION_LENGTH: 100,

  // Tags constraints
  MIN_TAGS: 1,
  MAX_TAGS: 10,
  TAG_MAX_LENGTH: 50,

  // Research query constraints
  // Reduced to 1 query per section for cost optimization (Dec 2024)
  // Scout already provides overview context, so 1 focused query is sufficient
  MIN_RESEARCH_QUERIES_PER_SECTION: 1,
  MAX_RESEARCH_QUERIES_PER_SECTION: 1,

  // Markdown constraints
  MIN_MARKDOWN_LENGTH: 500,

  // Required elements constraints
  MIN_REQUIRED_ELEMENTS: 3,
  MAX_REQUIRED_ELEMENTS: 50, // Increased from 10 - comprehensive guides may need more elements
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
  /**
   * Whether to use LLM to optimize search queries based on article intent.
   * When enabled, generates tailored queries for both Tavily (keywords) and Exa (semantic).
   * Cost: ~$0.001 per optimization, adds ~1-2s latency.
   * Benefits: Much better query relevance for specific intents (e.g., "boss guide").
   */
  QUERY_OPTIMIZATION_ENABLED: true,
  /**
   * Maximum length of a single snippet in search context.
   * INCREASED: Now that Exa returns 20,000c per result, use more of it.
   * 10,000c × 5 results = 50,000c max in Scout context (reasonable for 1M token LLM).
   */
  MAX_SNIPPET_LENGTH: 10000,
  /** Maximum number of snippets to include */
  MAX_SNIPPETS: 10,
  /**
   * Number of results for overview search (Tavily).
   * OPTIMIZED: 10 results - same cost as fewer, gets wikis.
   */
  OVERVIEW_SEARCH_RESULTS: 10,
  /**
   * Number of results for category-specific search (Tavily).
   * OPTIMIZED: 10 results based on A/B testing (Dec 2024).
   * - basic search costs 1 credit ($0.008) regardless of result count
   * - 10 results gets wikis + major gaming sites without noise
   * - basic-5 missed wikis, basic-20 added low-quality sources
   */
  CATEGORY_SEARCH_RESULTS: 10,
  /**
   * Number of results for Exa semantic search.
   * OPTIMIZED: 10 results based on A/B testing (Dec 2024).
   * - 10 results = $0.015 (neural $0.005 + 10 × $0.001/page)
   * - 70% more content for 50% more cost vs 5 results
   */
  EXA_SEARCH_RESULTS: 10,
  /**
   * Whether to request AI-generated summaries from Exa.
   * DISABLED: A/B testing showed summaries add 8-16 SECONDS latency per search.
   * Cost is only +$0.001/page but latency is unacceptable.
   * Full text at 20,000c provides better value without the wait.
   * @see https://docs.exa.ai/reference/contents-retrieval#summary-summary-true
   */
  EXA_INCLUDE_SUMMARY: false,
  /**
   * Domains to exclude from ALL search results (Exa AND Tavily).
   * Saves money and improves quality by filtering out low-value sources.
   *
   * Categories excluded:
   * - Video platforms: No useful text content (youtube, tiktok, twitch)
   * - Social media: User-generated noise, low authority (facebook, twitter, etc)
   * - Marketplaces: Not gaming content (g2a, cdkeys, voidu, etc)
   * - Gold selling: Spam/scam sites (mtmmo, u4gm)
   * - Q&A sites: Low authority, user-generated (quora)
   * - Generic tech: Not gaming-focused (techradar, radiotimes)
   * - News aggregators: Duplicate content (news.google.com)
   *
   * @see A/B test results Dec 2024 - basic-20 included mtmmo.com and u4gm.com gold sellers
   */
  /**
   * Domains to exclude from Exa searches.
   * Uses UNIFIED_EXCLUDED_DOMAINS - single source of truth.
   */
  get EXA_EXCLUDE_DOMAINS(): readonly string[] {
    return [...UNIFIED_EXCLUDED_DOMAINS];
  },
  /**
   * @deprecated Query structure is now defined by article-type-specific slots.
   * Each article type (guides, news, reviews, lists) defines its own slots
   * with maxResults and searchDepth per slot. See prompts/{type}/scout.ts.
   * Keeping for backwards compatibility with tests.
   */
  RECENT_SEARCH_RESULTS: 10,
  /**
   * @deprecated Query structure is now defined by article-type-specific slots.
   * See prompts/{type}/scout.ts for slot definitions.
   */
  MAX_CATEGORY_SEARCHES: 1,
  /**
   * @deprecated Search depth is now defined per slot by article type.
   * See prompts/{type}/scout.ts for slot definitions.
   * 
   * Legacy note: 'basic' based on A/B testing (Dec 2024).
   * - basic = 1 credit ($0.008), advanced = 2 credits ($0.016)
   * - basic-10 gets wikis + quality sources at half the cost
   */
  OVERVIEW_SEARCH_DEPTH: 'basic' as const,
  /**
   * @deprecated Search depth is now defined per slot by article type.
   */
  CATEGORY_SEARCH_DEPTH: 'basic' as const,
  /**
   * @deprecated Search depth is now defined per slot by article type.
   */
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
  /**
   * Limit for supplementary results (tips, recent, meta, etc.).
   * Used when building context for the supplementary briefing.
   */
  SUPPLEMENTARY_RESULTS_LIMIT: 5,
  /**
   * Max content length for supplementary items.
   * Used when building context for the supplementary briefing.
   */
  SUPPLEMENTARY_CONTENT_LENGTH: 500,
  /** @deprecated Use SUPPLEMENTARY_RESULTS_LIMIT instead */
  RECENT_RESULTS_LIMIT: 5,
  /** @deprecated Use SUPPLEMENTARY_CONTENT_LENGTH instead */
  RECENT_CONTENT_LENGTH: 500,
  /** Minimum sources before warning */
  MIN_SOURCES_WARNING: 5,
  /** Minimum queries before warning */
  MIN_QUERIES_WARNING: 3,
  /** Minimum overview length to consider valid */
  MIN_OVERVIEW_LENGTH: 50,
  /**
   * Whether to use pre-extracted summaries (detailedSummary, keyFacts, dataPoints)
   * from the Cleaner when generating QueryBriefings.
   * 
   * When TRUE (optimized mode, default):
   * - Uses Cleaner's detailedSummary + keyFacts instead of raw cleanedContent
   * - No extra tokens - Cleaner already extracted this in ONE LLM call
   * - Best for production use
   * 
   * When FALSE (classic mode):
   * - Reads raw cleanedContent (truncated to 800 chars) per source
   * - Wasteful since Cleaner already has better summaries
   * - Only for A/B testing comparison
   * 
   * @default true - Use Cleaner's already-extracted summaries
   */
  USE_SUMMARIES_FOR_BRIEFINGS: true,
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
  /**
   * Timeout for Editor generateObject calls in milliseconds.
   * If the LLM takes longer than this, abort and retry.
   * 30 seconds should be plenty for plan generation.
   */
  TIMEOUT_MS: 30000,
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
  /**
   * Characters of research context per result.
   * INCREASED: Use full cleaned content without truncation.
   * Database stats show: avg 3.8K, P99 17K, max 36K chars.
   * 50,000c covers 100% of sources (max is 36K).
   * 50,000c × 5 results = 250,000c max per section.
   * That's ~62K tokens - well within Gemini 3 Flash's 1M context.
   */
  RESEARCH_CONTEXT_PER_RESULT: 50000,
  /**
   * Threshold for "thin research" warning.
   * INCREASED: With larger content per result, threshold should be higher.
   */
  THIN_RESEARCH_THRESHOLD: 2000,
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
  /**
   * Search depth for section research (Tavily).
   * OPTIMIZED: 'basic' based on A/B testing (Dec 2024).
   * - basic = 1 credit, advanced = 2 credits
   * - With exclude_domains filtering, basic provides good quality
   */
  SEARCH_DEPTH: 'basic' as const,
  /**
   * Maximum search results per query (Tavily).
   * OPTIMIZED: 10 results based on A/B testing (Dec 2024).
   * - Same cost (1 credit) regardless of count
   * - 10 results gets wikis without low-quality noise
   */
  MAX_SEARCH_RESULTS: 10,
  /**
   * Number of results for Exa semantic search per section.
   * OPTIMIZED: 5 results based on A/B testing (Dec 2024).
   * - 5 results = $0.010 (neural $0.005 + 5 × $0.001/page)
   * - Section-specific queries are focused - fewer results needed
   */
  EXA_SEARCH_RESULTS: 5,
  /**
   * Whether to request AI-generated summaries from Exa.
   * DISABLED: A/B testing showed summaries add 8-16 SECONDS latency per search.
   * Cost is only +$0.001/page but latency is unacceptable.
   * Full text at 20,000c provides better value without the wait.
   * @see https://docs.exa.ai/reference/contents-retrieval#summary-summary-true
   */
  EXA_INCLUDE_SUMMARY: false,
  /**
   * Domains to exclude from ALL search results (Exa AND Tavily).
   * Uses UNIFIED_EXCLUDED_DOMAINS - single source of truth.
   */
  get EXA_EXCLUDE_DOMAINS(): readonly string[] {
    return [...UNIFIED_EXCLUDED_DOMAINS];
  },
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
  /** Optimal maximum title length before truncation (Google cuts at ~60) */
  TITLE_OPTIMAL_MAX: 65,
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
   * Maximum number of Fixer iterations for non-critical issues.
   * After this, only critical issues continue to be fixed.
   */
  MAX_FIXER_ITERATIONS: 3,
  /**
   * Maximum total iterations when critical issues remain.
   * Fixer will continue beyond MAX_FIXER_ITERATIONS if critical issues exist.
   */
  MAX_CRITICAL_FIX_ITERATIONS: 10,
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
// Cleaner Agent Configuration
// ============================================================================

/**
 * Check if cleaner is enabled via env variable or config.
 * Env variable ARTICLE_CLEANER_ENABLED overrides config.
 * Set to 'false' to disable cleaning (use raw content + cache only).
 */
function isCleanerEnabled(): boolean {
  const envValue = process.env.ARTICLE_CLEANER_ENABLED;
  if (envValue !== undefined) {
    return envValue.toLowerCase() !== 'false' && envValue !== '0';
  }
  return true; // Default enabled
}

export const CLEANER_CONFIG = {
  /**
   * Temperature for Cleaner LLM calls.
   * Very low (0.1) for consistent, deterministic cleaning.
   * We want the same input to produce the same cleaned output.
   */
  TEMPERATURE: 0.1,
  /**
   * Maximum output tokens for cleaning.
   * Content can be long after cleaning, allow generous output.
   */
  MAX_OUTPUT_TOKENS: 16000,
  /**
   * Number of URLs to clean in parallel.
   * High value = faster but more concurrent API calls.
   * Set to 100 to essentially run all cleaning in parallel.
   */
  BATCH_SIZE: 100,
  /**
   * Timeout for cleaning a single URL (ms).
   * 90 seconds to handle large content (up to 100K chars).
   */
  TIMEOUT_MS: 90000,
  /**
   * Minimum content length (chars) to attempt cleaning.
   * Content below this is likely a scrape failure (JS-heavy site, paywall, etc.)
   * and not worth spending LLM tokens on.
   * 
   * Analysis shows all scrape failures are < 200 chars, real content starts at 800+.
   * 500 is a safe threshold that catches failures with margin for edge cases.
   */
  MIN_CONTENT_LENGTH: 500,
  /**
   * Minimum relevance score for BOTH caching AND filtering.
   * Sources below this are considered off-topic for video games.
   * 70 = strict, ensures content is directly about video games.
   * 
   * Content below this threshold:
   * - NOT stored in cache (wastes storage)
   * - NOT passed to AI agents
   * 
   * Use lower values (e.g., 50) via minRelevanceOverride for searches
   * that include tangential content like gaming gear, hardware, etc.
   */
  MIN_RELEVANCE_FOR_RESULTS: 70,
  /**
   * Minimum quality score for STORAGE in database.
   * Sources below this are not stored (except scrape failures with Q:0).
   * Set to 20 to still track "bad but not terrible" content for domain stats.
   * 
   * Lower than MIN_QUALITY_FOR_RESULTS so we can:
   * 1. Track domain quality even for poor articles
   * 2. Avoid re-cleaning same bad URLs
   */
  MIN_QUALITY_FOR_STORAGE: 20,
  /**
   * Minimum quality score for FILTERING results to LLM.
   * Sources below this are filtered out and not sent to AI agents.
   * 
   * Set to 35 to include truncated fragments from good sources (score ~45)
   * while filtering truly low-quality content (score 15-25).
   * 
   * Use minQualityOverride in CleaningDeps to adjust per-request.
   */
  MIN_QUALITY_FOR_RESULTS: 35,
  /**
   * Domains with average relevance below this get auto-excluded.
   * Set below MIN_RELEVANCE_FOR_RESULTS (70) but high enough to catch
   * domains that rarely produce usable content.
   * At 50 avg, most articles will be <70 and get filtered anyway.
   */
  AUTO_EXCLUDE_RELEVANCE_THRESHOLD: 50,
  /**
   * Domain average quality score below this triggers auto-exclusion.
   * Same as MIN_QUALITY_FOR_RESULTS for consistency.
   */
  AUTO_EXCLUDE_QUALITY_THRESHOLD: 35,
  /**
   * Minimum samples before auto-excluding for LOW QUALITY.
   * Quality varies per page, so we need more samples for a fair average.
   */
  AUTO_EXCLUDE_QUALITY_MIN_SAMPLES: 5,
  /**
   * Minimum samples before auto-excluding for LOW RELEVANCE.
   * Relevance is domain-wide: if it's not about games, it never will be.
   */
  AUTO_EXCLUDE_RELEVANCE_MIN_SAMPLES: 3,
  /**
   * Minimum scrape attempts before evaluating per-engine exclusion.
   * A domain must be tried at least this many times with a specific engine
   * before we consider excluding it for that engine.
   */
  SCRAPE_FAILURE_MIN_ATTEMPTS: 10,
  /**
   * Scrape failure rate threshold for per-engine exclusion.
   * If a domain has >= MIN_ATTEMPTS and > this failure rate,
   * it gets excluded for that specific engine.
   * 0.70 = exclude if >70% of attempts fail.
   */
  SCRAPE_FAILURE_RATE_THRESHOLD: 0.70,
  /**
   * Maximum input characters to process.
   * Skip processing huge pages to save costs.
   */
  MAX_INPUT_CHARS: 100000,
  /**
   * Minimum cleaned content length to consider valid.
   * If cleaning results in less than this, content is likely garbage.
   */
  MIN_CLEANED_CHARS: 100,
  /**
   * Whether the cleaner LLM is enabled.
   * When false, only checks DB cache - doesn't run LLM on misses.
   * Override with env var ARTICLE_CLEANER_ENABLED=false
   */
  get ENABLED(): boolean {
    return isCleanerEnabled();
  },
  /**
   * Whether to use LLM pre-filter before full cleaning.
   * Pre-filter uses title + snippet to check relevance.
   * Costs ~$0.0001-0.0005 per source, can save full cleaning cost on irrelevant content.
   * Override with env var ARTICLE_PREFILTER_ENABLED=false
   */
  get PREFILTER_ENABLED(): boolean {
    const envValue = process.env.ARTICLE_PREFILTER_ENABLED;
    if (envValue !== undefined) {
      return envValue.toLowerCase() !== 'false';
    }
    return true; // Enabled by default
  },
  /**
   * Character length of content snippet for pre-filter.
   * INCREASED from 500 to 2000: Many pages have navigation/breadcrumbs at the
   * start, so 500 chars often only captures "Home > Games > Guide > ..." junk.
   * 1500 chars gets past navigation to actual article content.
   * Cost impact: minimal (pre-filter uses cheap gemini-2.5-flash-lite).
   */
  PREFILTER_SNIPPET_LENGTH: 2000,
  /**
   * Timeout for pre-filter LLM call (ms).
   * Short timeout since it's a simple relevance check.
   */
  PREFILTER_TIMEOUT_MS: 10000,
  /**
   * Minimum relevanceToGaming score (0-100) to pass pre-filter.
   * Content below this is definitely not about video games.
   * 50 = moderate threshold, allows gaming-adjacent content.
   */
  PREFILTER_MIN_GAMING_RELEVANCE: 50,
  /**
   * Minimum relevanceToArticle score (0-100) to pass pre-filter.
   * Content below this is not useful for the specific article.
   * 30 = lenient, allows tangentially related content through to full cleaning.
   */
  PREFILTER_MIN_ARTICLE_RELEVANCE: 30,
  /**
   * Hardcoded list of domains to always exclude.
   * Uses UNIFIED_EXCLUDED_DOMAINS - single source of truth.
   * DB exclusions are checked separately and combined with this list.
   */
  EXCLUDED_DOMAINS: UNIFIED_EXCLUDED_DOMAINS,
  /**
   * Quality score thresholds for domain tiers.
   */
  TIER_THRESHOLDS: {
    excellent: 80,
    good: 60,
    average: 40,
    poor: 25,
    // Below poor is excluded
  } as const,
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
  'google/gemini-flash-2.0': { inputPer1k: 0.0001, outputPer1k: 0.0004 },
  // Gemini 2.5 Flash: $0.30/1M input, $2.50/1M output
  'google/gemini-2.5-flash': { inputPer1k: 0.0003, outputPer1k: 0.0025 },
  // Gemini 2.5 Flash Lite: $0.10/1M input, $0.40/1M output (same as 2.0, optimized for speed)
  'google/gemini-2.5-flash-lite': { inputPer1k: 0.0001, outputPer1k: 0.0004 },
  // Gemini 3 Flash: $0.50/1M input, $3/1M output (per OpenRouter Dec 2025)
  'google/gemini-3-flash-preview': { inputPer1k: 0.0005, outputPer1k: 0.003 },

  // xAI Grok models
  // Grok 4 Fast: $0.20/1M input, $0.50/1M output (per OpenRouter Dec 2025)
  'x-ai/grok-4-fast': { inputPer1k: 0.0002, outputPer1k: 0.0005 },
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
  cleaner: CLEANER_CONFIG,
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
  validatePositive(FIXER_CONFIG.MAX_CRITICAL_FIX_ITERATIONS, 'FIXER_CONFIG.MAX_CRITICAL_FIX_ITERATIONS');
  validateTemperature(FIXER_CONFIG.TEMPERATURE, 'FIXER_CONFIG.TEMPERATURE');
  validatePositive(FIXER_CONFIG.MAX_FIXES_PER_ITERATION, 'FIXER_CONFIG.MAX_FIXES_PER_ITERATION');
  validatePositive(FIXER_CONFIG.MAX_OUTPUT_TOKENS_SMART_FIX, 'FIXER_CONFIG.MAX_OUTPUT_TOKENS_SMART_FIX');

  // Cleaner Config
  validateTemperature(CLEANER_CONFIG.TEMPERATURE, 'CLEANER_CONFIG.TEMPERATURE');
  validatePositive(CLEANER_CONFIG.MAX_OUTPUT_TOKENS, 'CLEANER_CONFIG.MAX_OUTPUT_TOKENS');
  validatePositive(CLEANER_CONFIG.BATCH_SIZE, 'CLEANER_CONFIG.BATCH_SIZE');
  validatePositive(CLEANER_CONFIG.TIMEOUT_MS, 'CLEANER_CONFIG.TIMEOUT_MS');
  validateNonNegative(CLEANER_CONFIG.MIN_QUALITY_FOR_STORAGE, 'CLEANER_CONFIG.MIN_QUALITY_FOR_STORAGE');
  validateNonNegative(CLEANER_CONFIG.MIN_QUALITY_FOR_RESULTS, 'CLEANER_CONFIG.MIN_QUALITY_FOR_RESULTS');
  validateNonNegative(CLEANER_CONFIG.MIN_RELEVANCE_FOR_RESULTS, 'CLEANER_CONFIG.MIN_RELEVANCE_FOR_RESULTS');

  // Ensure storage threshold <= filtering threshold (makes sense: store more than we show)
  if (CLEANER_CONFIG.MIN_QUALITY_FOR_STORAGE > CLEANER_CONFIG.MIN_QUALITY_FOR_RESULTS) {
    throw new Error(
      `MIN_QUALITY_FOR_STORAGE (${CLEANER_CONFIG.MIN_QUALITY_FOR_STORAGE}) cannot be higher than MIN_QUALITY_FOR_RESULTS (${CLEANER_CONFIG.MIN_QUALITY_FOR_RESULTS})`
    );
  }
  validateNonNegative(CLEANER_CONFIG.AUTO_EXCLUDE_QUALITY_THRESHOLD, 'CLEANER_CONFIG.AUTO_EXCLUDE_QUALITY_THRESHOLD');
  validatePositive(CLEANER_CONFIG.AUTO_EXCLUDE_QUALITY_MIN_SAMPLES, 'CLEANER_CONFIG.AUTO_EXCLUDE_QUALITY_MIN_SAMPLES');
  validatePositive(CLEANER_CONFIG.AUTO_EXCLUDE_RELEVANCE_MIN_SAMPLES, 'CLEANER_CONFIG.AUTO_EXCLUDE_RELEVANCE_MIN_SAMPLES');
  validatePositive(CLEANER_CONFIG.SCRAPE_FAILURE_MIN_ATTEMPTS, 'CLEANER_CONFIG.SCRAPE_FAILURE_MIN_ATTEMPTS');
  if (CLEANER_CONFIG.SCRAPE_FAILURE_RATE_THRESHOLD < 0 || CLEANER_CONFIG.SCRAPE_FAILURE_RATE_THRESHOLD > 1) {
    throw new ConfigValidationError(
      `SCRAPE_FAILURE_RATE_THRESHOLD must be between 0 and 1 (got ${CLEANER_CONFIG.SCRAPE_FAILURE_RATE_THRESHOLD})`
    );
  }
  validatePositive(CLEANER_CONFIG.MAX_INPUT_CHARS, 'CLEANER_CONFIG.MAX_INPUT_CHARS');
  validatePositive(CLEANER_CONFIG.MIN_CLEANED_CHARS, 'CLEANER_CONFIG.MIN_CLEANED_CHARS');

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

