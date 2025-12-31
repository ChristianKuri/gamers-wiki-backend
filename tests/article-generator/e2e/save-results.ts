/**
 * E2E Test Result Storage Utility
 *
 * Writes test results to JSON files for analysis.
 * Results are stored in tests/e2e-results/article-generator/
 *
 * Structure designed for easy analysis:
 * - metadata: Test run info
 * - input: What was requested
 * - game: Game information
 * - generation: Timing, tokens, models, research stats
 * - article: The generated content analysis
 * - plan: Editor's article plan
 * - quality: Validation, reviewer, recovery stats
 * - database: Database persistence checks
 * - rawContent: Full markdown (at end for easy skipping)
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Directory for storing E2E test results */
const E2E_RESULTS_DIR = join(__dirname, '..', '..', 'e2e-results', 'article-generator');

// ============================================================================
// Result Structure Types
// ============================================================================

/** Test run metadata */
export interface TestMetadata {
  readonly testName: string;
  readonly timestamp: string;
  readonly durationMs: number;
  readonly passed: boolean;
}

/** Test input parameters */
export interface TestInput {
  readonly igdbId: number;
  readonly instruction: string;
  readonly publish: boolean;
}

/** Game information */
export interface GameInfo {
  readonly documentId: string;
  readonly name: string;
  readonly slug?: string;
}

/** Phase timing breakdown */
export interface PhaseDurations {
  readonly scout: number;
  readonly editor: number;
  readonly specialist: number;
  readonly reviewer: number;
  readonly validation: number;
}

/** Token usage for a single phase */
export interface PhaseTokenUsage {
  readonly input: number;
  readonly output: number;
  /** Actual cost in USD from OpenRouter (when available) */
  readonly actualCostUsd?: number;
}

/** Token usage by phase */
export interface TokenUsageByPhase {
  readonly scout: PhaseTokenUsage;
  readonly editor: PhaseTokenUsage;
  readonly specialist: PhaseTokenUsage;
  readonly reviewer?: PhaseTokenUsage;
  /** Cleaner agent token usage (separate for cost visibility) */
  readonly cleaner?: PhaseTokenUsage;
}

/**
 * Search API costs (Tavily + Exa).
 * Tracked from actual API responses where available.
 */
export interface SearchApiCosts {
  /** Total search API cost in USD */
  readonly totalUsd: number;
  /** Number of Exa searches performed */
  readonly exaSearchCount: number;
  /** Number of Tavily searches performed */
  readonly tavilySearchCount: number;
  /** Total cost from Exa (from API responses) */
  readonly exaCostUsd: number;
  /** Total cost from Tavily (from API responses, $0.008/credit) */
  readonly tavilyCostUsd: number;
  /** Total Tavily credits used */
  readonly tavilyCredits: number;
}

/** Generation statistics */
export interface GenerationStats {
  readonly success: boolean;
  readonly correlationId: string;
  readonly timing: {
    readonly totalMs: number;
    readonly byPhase: PhaseDurations;
  };
  readonly tokens: {
    readonly byPhase: TokenUsageByPhase;
    readonly total: { input: number; output: number };
    /** LLM token cost estimate in USD */
    readonly estimatedCostUsd: number;
  };
  readonly models: {
    readonly scout: string;
    readonly editor: string;
    readonly specialist: string;
    readonly reviewer?: string;
  };
  readonly research: {
    readonly queriesExecuted: number;
    readonly sourcesCollected: number;
    readonly confidence: 'high' | 'medium' | 'low';
  };
  /**
   * Search API costs (Tavily + Exa).
   * Tracked from actual API responses where available.
   */
  readonly searchCosts?: SearchApiCosts;
  /**
   * Total estimated cost for article generation in USD.
   * Combines LLM costs + Search API costs.
   */
  readonly totalCostUsd?: number;
  /**
   * Source content usage tracking.
   * Shows which sources used full text vs summary.
   */
  readonly sourceContentUsage?: SourceContentUsageStats;
  /**
   * Filtered sources tracking.
   * Shows sources that were filtered out due to low quality or relevance.
   */
  readonly filteredSources?: FilteredSourcesStats;
}

/** A source that was filtered out */
export interface FilteredSourceItem {
  readonly url: string;
  readonly domain: string;
  readonly title: string;
  readonly qualityScore: number;
  /** Relevance score (0-100), or null if unknown (e.g., scrape failures) */
  readonly relevanceScore: number | null;
  readonly reason: 'low_relevance' | 'low_quality' | 'excluded_domain' | 'pre_filtered' | 'scrape_failure';
  readonly details: string;
  /** Search query that returned this source */
  readonly query?: string;
  /** Search provider (tavily/exa) */
  readonly searchSource?: 'tavily' | 'exa';
  /** Stage where filtering happened */
  readonly filterStage?: 'programmatic' | 'pre_filter' | 'full_clean' | 'post_clean';
}

/** Filtered sources statistics */
export interface FilteredSourcesStats {
  /** Individual filtered sources */
  readonly sources: readonly FilteredSourceItem[];
  /** Summary counts */
  readonly counts: {
    readonly total: number;
    readonly lowRelevance: number;
    readonly lowQuality: number;
    readonly excludedDomain: number;
    readonly preFiltered: number;
    readonly scrapeFailure: number;
  };
  /** Breakdown by search provider */
  readonly byProvider?: {
    readonly tavily: number;
    readonly exa: number;
  };
  /** Breakdown by filter stage */
  readonly byStage?: {
    readonly programmatic: number;
    readonly preFilter: number;
    readonly fullClean: number;
    readonly postClean: number;
  };
}

/** Content type used for a source (always 'full') */
export type ContentType = 'full';

/** Individual source usage tracking */
export interface SourceUsageItem {
  readonly url: string;
  readonly title: string;
  readonly contentType: ContentType;
  readonly phase: 'scout' | 'specialist';
  readonly section?: string;
  readonly query: string;
}

/** Source content usage statistics */
export interface SourceContentUsageStats {
  /** Per-source tracking */
  readonly sources: readonly SourceUsageItem[];
  /** Summary counts */
  readonly counts: {
    readonly total: number;
  };
}

/** Section statistics from markdown */
export interface SectionStats {
  readonly total: number;
  readonly content: number;
  readonly hasSourcesSection: boolean;
  readonly headlines: readonly string[];
}

/** Content statistics from markdown */
export interface ContentStats {
  readonly markdownLength: number;
  readonly wordCount: number;
  readonly paragraphCount: number;
  readonly sections: SectionStats;
  readonly lists: {
    readonly bulletItems: number;
    readonly numberedItems: number;
    readonly total: number;
  };
  readonly linkCount: number;
}

/** Source analysis */
export interface SourcesAnalysis {
  readonly count: number;
  readonly uniqueDomains: number;
  readonly topDomains: readonly string[];
  readonly domainBreakdown: Record<string, number>;
  readonly urls: readonly string[];
}

/** Article analysis */
export interface ArticleAnalysis {
  readonly post: {
    readonly documentId: string;
    readonly locale: string;
    readonly published: boolean;
  };
  readonly title: {
    readonly value: string;
    readonly length: number;
    readonly withinRecommended: boolean;
  };
  readonly excerpt: {
    readonly value: string;
    readonly length: number;
    readonly withinLimits: boolean;
  };
  readonly categorySlug: string;
  readonly tags: readonly string[];
  readonly content: ContentStats;
  readonly sources: SourcesAnalysis;
}

/** Plan section */
export interface PlanSection {
  readonly headline: string;
  readonly goal: string;
  readonly researchQueries: readonly string[];
  /** Elements this section must cover (assigned by Editor from requiredElements) */
  readonly mustCover: readonly string[];
}

/** Article plan from Editor */
export interface ArticlePlanAnalysis {
  readonly title: string;
  readonly categorySlug: string;
  readonly sectionCount: number;
  readonly sections: readonly PlanSection[];
  readonly requiredElements: readonly string[];
  readonly totalResearchQueries: number;
}

/** Validation issue */
export interface ValidationIssue {
  readonly severity: 'error' | 'warning' | 'info';
  readonly field: string;
  readonly message: string;
  readonly actual?: unknown;
}

/** Reviewer issue from AI reviewer */
export interface ReviewerIssue {
  readonly severity: 'critical' | 'major' | 'minor';
  readonly category: string;
  readonly message: string;
  readonly fixStrategy?: string;
}

/** Quality checks */
export interface QualityChecks {
  readonly placeholders: {
    readonly passed: boolean;
    readonly found: readonly string[];
  };
  readonly aiCliches: {
    readonly passed: boolean;
    readonly found: readonly string[];
    readonly totalOccurrences: number;
  };
}

/** Recovery metadata */
export interface RecoveryStats {
  readonly applied: boolean;
  readonly planRetries: number;
  readonly fixerIterations: number;
  readonly fixesAttempted: number;
  readonly fixesSuccessful: number;
}

/** Quality analysis */
export interface QualityAnalysis {
  readonly passed: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly reviewer: {
    readonly ran: boolean;
    readonly approved: boolean | null;
    /** Final remaining issues after all fixes */
    readonly issues: readonly ReviewerIssue[];
    /** Initial issues found before any fixes (only if different from final) */
    readonly initialIssues?: readonly ReviewerIssue[];
    readonly bySeverity: {
      readonly critical: number;
      readonly major: number;
      readonly minor: number;
    };
    /** Count of issues that were fixed (initialIssues.length - issues.length) */
    readonly issuesFixed?: number;
  };
  readonly recovery: RecoveryStats;
  readonly checks: QualityChecks;
}

/** Database verification */
export interface DatabaseVerification {
  readonly post: {
    readonly exists: boolean;
    readonly linkedToGame: boolean;
  };
  readonly game: {
    readonly exists: boolean;
    readonly hasDescription: boolean;
  };
}

/**
 * Complete E2E test result - redesigned for clarity.
 *
 * Structure:
 * - Grouped by concern (not by data source)
 * - No duplication (data appears once)
 * - Easy to navigate for analysis
 * - Full content at end (easy to skip when scanning)
 */
export interface E2ETestResult {
  readonly metadata: TestMetadata;
  readonly input: TestInput;
  readonly game: GameInfo;
  readonly generation: GenerationStats;
  readonly article: ArticleAnalysis;
  readonly plan: ArticlePlanAnalysis;
  readonly quality: QualityAnalysis;
  readonly database: DatabaseVerification;
  /** Full markdown content - placed at end for easy skipping */
  readonly rawContent: {
    readonly markdown: string;
  };
}

// ============================================================================
// Legacy Interface (for backward compatibility during migration)
// ============================================================================

/** @deprecated Use ValidationIssue instead */
export type E2EValidationIssue = ValidationIssue;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Ensures the results directory exists.
 */
function ensureResultsDir(): void {
  if (!existsSync(E2E_RESULTS_DIR)) {
    mkdirSync(E2E_RESULTS_DIR, { recursive: true });
  }
}

/**
 * Generates a filename for the test result.
 */
function generateFilename(testName: string, timestamp: string): string {
  const sanitized = testName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  const formattedTime = timestamp.replace(/[:.]/g, '-').slice(0, 19);
  return `${sanitized}-${formattedTime}.json`;
}

/**
 * Saves E2E test result to a JSON file.
 */
export function saveTestResult(result: E2ETestResult): string {
  ensureResultsDir();

  const filename = generateFilename(result.metadata.testName, result.metadata.timestamp);
  const filePath = join(E2E_RESULTS_DIR, filename);

  const json = JSON.stringify(result, null, 2);
  writeFileSync(filePath, json, 'utf-8');

  return filePath;
}

/**
 * Logs a summary of validation issues to the console.
 */
export function logValidationSummary(issues: readonly ValidationIssue[]): void {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const info = issues.filter((i) => i.severity === 'info');

  if (errors.length > 0) {
    console.error('\n❌ Validation Errors:');
    for (const error of errors) {
      console.error(`  - [${error.field}] ${error.message}`);
      if (error.actual !== undefined) {
        console.error(`    Actual: ${JSON.stringify(error.actual)}`);
      }
    }
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️ Validation Warnings:');
    for (const warning of warnings) {
      console.warn(`  - [${warning.field}] ${warning.message}`);
    }
  }

  if (info.length > 0) {
    console.log('\nℹ️ Info:');
    for (const item of info) {
      console.log(`  - [${item.field}] ${item.message}`);
    }
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('\n✅ All validations passed');
  } else {
    console.log(`\n📊 Summary: ${errors.length} error(s), ${warnings.length} warning(s)`);
  }
}
