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

/** Base directory for storing E2E test results */
const E2E_RESULTS_BASE_DIR = join(__dirname, '..', '..', 'e2e-results', 'article-generator');

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

/** Scout token usage with sub-phase breakdown */
export interface ScoutPhaseTokenUsage {
  /** Query planning LLM calls */
  readonly queryPlanning: PhaseTokenUsage;
  /** Briefing generation LLM calls */
  readonly briefing: PhaseTokenUsage;
  /** Total scout token usage */
  readonly total: PhaseTokenUsage;
}

/** Cleaner token usage with sub-phase breakdown */
export interface CleanerPhaseTokenUsage {
  /** Pre-filter LLM calls (quick relevance check) */
  readonly prefilter: PhaseTokenUsage;
  /** Extraction LLM calls (full cleaning) */
  readonly extraction: PhaseTokenUsage;
  /** Total cleaner token usage */
  readonly total: PhaseTokenUsage;
}

/** Token usage by phase */
export interface TokenUsageByPhase {
  /** Scout with queryPlanning vs briefing breakdown */
  readonly scout: ScoutPhaseTokenUsage;
  readonly editor: PhaseTokenUsage;
  readonly specialist: PhaseTokenUsage;
  readonly reviewer?: PhaseTokenUsage;
  /** Fixer agent token usage (separate from reviewer for cost visibility) */
  readonly fixer?: PhaseTokenUsage;
  /** Cleaner agent with prefilter vs extraction breakdown */
  readonly cleaner?: CleanerPhaseTokenUsage;
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
  /**
   * Duplicate URL tracking.
   * Shows which URLs appeared in multiple queries and per-query stats.
   */
  readonly duplicateTracking?: DuplicateTrackingStats;
}

/** Content type used for a source (always 'full') */
export type ContentType = 'full';

/** Individual source within a query group */
export interface SourceItem {
  readonly url: string;
  readonly title: string;
  readonly qualityScore?: number;
  readonly relevanceScore?: number;
  /** Length of cleaned content in characters */
  readonly cleanedCharCount?: number;
  /** Whether this content was retrieved from cache (true) or newly cleaned (false) */
  readonly wasCached?: boolean;
}

/** Sources grouped by query */
export interface SourcesByQuery {
  readonly query: string;
  readonly phase: 'scout' | 'specialist';
  readonly searchSource?: 'tavily' | 'exa';
  readonly contentType: ContentType;
  /** Section name (only for specialist phase) */
  readonly section?: string;
  readonly sources: readonly SourceItem[];
}

/** Source content usage - array of query groups */
export type SourceContentUsageStats = readonly SourcesByQuery[];

/** Individual filtered source within a query group */
export interface FilteredSourceItem {
  readonly url: string;
  readonly domain: string;
  readonly title: string;
  readonly qualityScore: number;
  /** Relevance score (0-100), or null if unknown (e.g., scrape failures) */
  readonly relevanceScore: number | null;
  readonly reason: 'low_relevance' | 'low_quality' | 'excluded_domain' | 'pre_filtered' | 'scrape_failure';
  readonly details: string;
  /** Stage where filtering happened */
  readonly filterStage?: 'programmatic' | 'pre_filter' | 'full_clean' | 'post_clean';
  /** Length of cleaned content in characters (if available) */
  readonly cleanedCharCount?: number;
}

/** Filtered sources grouped by query */
export interface FilteredSourcesByQuery {
  readonly query: string;
  readonly phase?: 'scout' | 'specialist';
  readonly searchSource?: 'tavily' | 'exa';
  readonly sources: readonly FilteredSourceItem[];
}

/** Filtered sources - array of query groups */
export type FilteredSourcesStats = readonly FilteredSourcesByQuery[];

// ============================================================================
// Duplicate Tracking Types
// ============================================================================

/** Information about a URL that appeared in multiple search queries */
export interface DuplicateUrlItem {
  readonly url: string;
  readonly domain: string;
  readonly firstSeenIn: {
    readonly query: string;
    readonly engine: 'tavily' | 'exa';
  };
  readonly alsoDuplicatedIn: readonly {
    readonly query: string;
    readonly engine: 'tavily' | 'exa';
  }[];
}

/** Statistics for a single search query */
export interface QueryStatsItem {
  readonly query: string;
  readonly engine: 'tavily' | 'exa';
  readonly phase: 'scout' | 'specialist';
  /** Number of results returned by the search engine */
  readonly received: number;
  /** Number of results removed as duplicates (already seen in earlier queries) */
  readonly duplicates: number;
  /** Number of results filtered (scrape failures, low quality, low relevance, etc.) */
  readonly filtered: number;
  /** Final number of usable results */
  readonly used: number;
}

/** Duplicate tracking statistics */
export interface DuplicateTrackingStats {
  /** URLs that appeared in multiple search queries */
  readonly duplicatedUrls: readonly DuplicateUrlItem[];
  /** Per-query statistics */
  readonly queryStats: readonly QueryStatsItem[];
}

// ============================================================================
// Legacy interfaces (for backward compatibility)
// ============================================================================

/** @deprecated Use SourceItem instead */
export interface SourceUsageItem {
  readonly url: string;
  readonly title: string;
  readonly contentType: ContentType;
  readonly phase: 'scout' | 'specialist';
  readonly section?: string;
  readonly query: string;
  readonly searchSource?: 'tavily' | 'exa';
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
 * Generates a sanitized folder name for a test run.
 */
function generateRunFolderName(testName: string, timestamp: string): string {
  const sanitized = testName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  const formattedTime = timestamp.replace(/[:.]/g, '-').slice(0, 19);
  return `${sanitized}-${formattedTime}`;
}

/**
 * Creates and returns the path to a run-specific folder.
 * Structure: tests/e2e-results/article-generator/{test-name}-{timestamp}/
 */
function createRunFolder(testName: string, timestamp: string): string {
  const folderName = generateRunFolderName(testName, timestamp);
  const runDir = join(E2E_RESULTS_BASE_DIR, folderName);
  
  if (!existsSync(runDir)) {
    mkdirSync(runDir, { recursive: true });
  }
  
  return runDir;
}

/**
 * Result of saving all test artifacts.
 */
export interface SavedTestArtifacts {
  /** Path to the run folder */
  runFolder: string;
  /** Path to the result JSON file */
  resultJson: string;
  /** Path to the article markdown file */
  articleMd: string;
  /** Path to the briefings folder (if briefings exist) */
  briefingsFolder?: string;
  /** Path to the briefings JSON file (if briefings exist) */
  briefingsJson?: string;
  /** Path to the briefings markdown file (if briefings exist) */
  briefingsMd?: string;
}

/**
 * Saves all E2E test artifacts to a run-specific folder.
 * 
 * Structure:
 * tests/e2e-results/article-generator/{test-name}-{timestamp}/
 * ├── result.json           # Full test results
 * ├── article.md            # Generated article markdown
 * └── briefings/            # (if briefings exist)
 *     ├── briefings.json    # Query briefings as JSON
 *     └── briefings.md      # Query briefings as readable markdown
 */
export function saveAllTestArtifacts(
  result: E2ETestResult,
  briefings?: BriefingsTestResult
): SavedTestArtifacts {
  const runDir = createRunFolder(result.metadata.testName, result.metadata.timestamp);
  
  // Save result.json
  const resultJsonPath = join(runDir, 'result.json');
  writeFileSync(resultJsonPath, JSON.stringify(result, null, 2), 'utf-8');
  
  // Save article.md
  const articleMdPath = join(runDir, 'article.md');
  const articleContent = buildArticleMarkdown(result);
  writeFileSync(articleMdPath, articleContent, 'utf-8');
  
  const artifacts: SavedTestArtifacts = {
    runFolder: runDir,
    resultJson: resultJsonPath,
    articleMd: articleMdPath,
  };
  
  // Save briefings if provided
  if (briefings && briefings.briefings.length > 0) {
    const briefingsDir = join(runDir, 'briefings');
    if (!existsSync(briefingsDir)) {
      mkdirSync(briefingsDir, { recursive: true });
    }
    
    // Save briefings.json
    const briefingsJsonPath = join(briefingsDir, 'briefings.json');
    writeFileSync(briefingsJsonPath, JSON.stringify(briefings, null, 2), 'utf-8');
    
    // Save briefings.md
    const briefingsMdPath = join(briefingsDir, 'briefings.md');
    const briefingsMdContent = buildBriefingsMarkdown(briefings);
    writeFileSync(briefingsMdPath, briefingsMdContent, 'utf-8');
    
    artifacts.briefingsFolder = briefingsDir;
    artifacts.briefingsJson = briefingsJsonPath;
    artifacts.briefingsMd = briefingsMdPath;
  }
  
  return artifacts;
}

/**
 * Builds the article markdown content with metadata header.
 */
function buildArticleMarkdown(result: E2ETestResult): string {
  const lines: string[] = [
    '---',
    `title: "${result.article.title.value}"`,
    `category: ${result.article.categorySlug}`,
    `tags: [${result.article.tags.map(t => `"${t}"`).join(', ')}]`,
    `game: ${result.game.name}`,
    `generated: ${result.metadata.timestamp}`,
    `correlation_id: ${result.generation.correlationId}`,
    '---',
    '',
    `# ${result.article.title.value}`,
    '',
    `> ${result.article.excerpt.value}`,
    '',
    '---',
    '',
    result.rawContent.markdown,
  ];
  
  return lines.join('\n');
}

/**
 * Builds the briefings markdown content.
 */
function buildBriefingsMarkdown(briefings: BriefingsTestResult): string {
  const lines: string[] = [
    `# Query Briefings: ${briefings.metadata.gameName}`,
    '',
    `**Test:** ${briefings.metadata.testName}`,
    `**Timestamp:** ${briefings.metadata.timestamp}`,
    `**Correlation ID:** ${briefings.metadata.correlationId}`,
    '',
  ];

  if (briefings.queryPlan) {
    lines.push(`## Query Plan`);
    lines.push('');
    lines.push(`**Draft Title:** ${briefings.queryPlan.draftTitle}`);
    lines.push(`**Total Queries:** ${briefings.queryPlan.totalQueries}`);
    lines.push('');
  }

  if (briefings.inputContext) {
    lines.push(`## Input Context`);
    lines.push('');
    lines.push(`**Game:** ${briefings.inputContext.gameName}`);
    if (briefings.inputContext.gameDescription) {
      lines.push(`**Description:** ${briefings.inputContext.gameDescription}`);
    }
    lines.push(`**Instruction:** ${briefings.inputContext.articleInstruction}`);
    lines.push('');
  }

  lines.push(`## Briefings (${briefings.briefings.length} queries)`);
  lines.push('');

  for (let i = 0; i < briefings.briefings.length; i++) {
    const b = briefings.briefings[i];
    lines.push(`### ${i + 1}. ${b.query}`);
    lines.push('');
    lines.push(`**Engine:** ${b.engine} | **Sources:** ${b.sourceCount}`);
    lines.push(`**Purpose:** ${b.purpose}`);
    lines.push('');
    lines.push(`#### Findings`);
    lines.push('');
    lines.push(b.findings);
    lines.push('');

    if (b.keyFacts.length > 0) {
      lines.push(`#### Key Facts`);
      lines.push('');
      for (const fact of b.keyFacts) {
        lines.push(`- ${fact}`);
      }
      lines.push('');
    }

    if (b.gaps.length > 0) {
      lines.push(`#### Gaps (missing info)`);
      lines.push('');
      for (const gap of b.gaps) {
        lines.push(`- ${gap}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * @deprecated Use saveAllTestArtifacts instead.
 * Saves E2E test result to a JSON file (legacy function for backward compatibility).
 */
export function saveTestResult(result: E2ETestResult): string {
  const runDir = createRunFolder(result.metadata.testName, result.metadata.timestamp);
  const filePath = join(runDir, 'result.json');

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

// ============================================================================
// Briefings Types
// ============================================================================

/** Query briefing for storage (matches QueryBriefing from types.ts) */
export interface StoredQueryBriefing {
  readonly query: string;
  readonly engine: 'tavily' | 'exa';
  readonly purpose: string;
  readonly findings: string;
  readonly keyFacts: readonly string[];
  readonly gaps: readonly string[];
  readonly sourceCount: number;
}

/** Complete briefings from a test run */
export interface BriefingsTestResult {
  readonly metadata: {
    readonly testName: string;
    readonly gameName: string;
    readonly timestamp: string;
    readonly correlationId: string;
  };
  readonly queryPlan?: {
    readonly draftTitle: string;
    readonly totalQueries: number;
  };
  readonly briefings: readonly StoredQueryBriefing[];
  /** Optional: raw input context that Scout had */
  readonly inputContext?: {
    readonly gameName: string;
    readonly gameDescription?: string;
    readonly articleInstruction: string;
  };
}
