/**
 * Cleaner E2E Test Result Storage Utility
 *
 * Writes test results to JSON files for analysis.
 * Results are stored in tests/e2e-results/cleaner/
 *
 * Structure designed for easy analysis:
 * - metadata: Test run info
 * - input: Search query and parameters
 * - search: Search results from Tavily/Exa
 * - cleaning: Cleaning results with token usage and cost
 * - comparison: Side-by-side analysis
 * - rawContent: Full content (at end for easy skipping)
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Directory for storing cleaner E2E test results */
const E2E_RESULTS_DIR = join(__dirname, '..', '..', 'e2e-results', 'cleaner');

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
  readonly query: string;
  readonly gameName?: string;
  readonly maxResults: number;
  readonly searchSource: 'tavily' | 'exa';
}

/** Search result info */
export interface SearchResultInfo {
  readonly url: string;
  readonly title: string;
  readonly domain: string;
  readonly contentLength: number;
  readonly hasRawContent: boolean;
}

/** Search stats */
export interface SearchStats {
  readonly resultsReturned: number;
  readonly resultsWithContent: number;
  readonly totalContentChars: number;
  readonly avgContentChars: number;
  readonly answer?: string | null;
  readonly costUsd?: number;
}

/** Token usage from LLM */
export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly actualCostUsd?: number;
}

/** Cleaning result for a single source */
export interface CleaningResultInfo {
  readonly url: string;
  readonly title: string;
  readonly domain: string;
  readonly success: boolean;
  readonly qualityScore?: number;
  readonly qualityNotes?: string;
  readonly contentType?: string;
  readonly summary?: string;
  readonly junkRatio?: number;
  readonly originalLength: number;
  readonly cleanedLength?: number;
  readonly tokenUsage: TokenUsage;
}

/** Cleaning stats */
export interface CleaningStats {
  readonly sourcesAttempted: number;
  readonly sourcesSucceeded: number;
  readonly sourcesFailed: number;
  readonly totalTokenUsage: TokenUsage;
  readonly avgQualityScore?: number;
  readonly avgJunkRatio?: number;
  readonly model: string;
}

/** Content comparison */
export interface ContentComparison {
  readonly url: string;
  readonly title: string;
  /** Before cleaning */
  readonly originalLength: number;
  /** After cleaning */
  readonly cleanedLength?: number;
  /** Percentage of content removed */
  readonly reductionPercent?: number;
  /** Quality score from AI */
  readonly qualityScore?: number;
  /** AI-determined content type */
  readonly contentType?: string;
  /** Brief summary */
  readonly summary?: string;
}

/** Raw content section */
export interface RawContentSection {
  readonly url: string;
  readonly title: string;
  /** Original content from search */
  readonly original: string;
  /** Cleaned content from cleaner agent */
  readonly cleaned?: string;
}

/**
 * Complete Cleaner E2E test result.
 */
export interface CleanerE2ETestResult {
  readonly metadata: TestMetadata;
  readonly input: TestInput;
  readonly search: {
    readonly stats: SearchStats;
    readonly results: readonly SearchResultInfo[];
  };
  readonly cleaning: {
    readonly stats: CleaningStats;
    readonly results: readonly CleaningResultInfo[];
  };
  readonly comparison: readonly ContentComparison[];
  /** Full content - placed at end for easy skipping */
  readonly rawContent: readonly RawContentSection[];
}

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
 * Saves cleaner E2E test result to a JSON file.
 * @returns The file path where the result was saved
 */
export function saveCleanerTestResult(result: CleanerE2ETestResult): string {
  ensureResultsDir();

  const filename = generateFilename(result.metadata.testName, result.metadata.timestamp);
  const filePath = join(E2E_RESULTS_DIR, filename);

  const json = JSON.stringify(result, null, 2);
  writeFileSync(filePath, json, 'utf-8');

  return filePath;
}

/**
 * Logs a summary of the cleaner test results to the console.
 */
export function logCleanerSummary(result: CleanerE2ETestResult): void {
  const { search, cleaning, comparison } = result;

  console.log('\n📊 Cleaner E2E Test Summary');
  console.log('═'.repeat(50));

  // Search stats
  console.log('\n🔍 Search:');
  console.log(`  Query: "${result.input.query}"`);
  console.log(`  Results: ${search.stats.resultsReturned}`);
  console.log(`  Content chars: ${search.stats.totalContentChars.toLocaleString()}`);
  if (search.stats.costUsd !== undefined) {
    console.log(`  Search cost: $${search.stats.costUsd.toFixed(4)}`);
  }

  // Cleaning stats
  console.log('\n🧹 Cleaning:');
  console.log(`  Model: ${cleaning.stats.model}`);
  console.log(`  Success: ${cleaning.stats.sourcesSucceeded}/${cleaning.stats.sourcesAttempted}`);
  if (cleaning.stats.avgQualityScore !== undefined) {
    console.log(`  Avg quality: ${cleaning.stats.avgQualityScore.toFixed(1)}/100`);
  }
  if (cleaning.stats.avgJunkRatio !== undefined) {
    console.log(`  Avg junk ratio: ${(cleaning.stats.avgJunkRatio * 100).toFixed(1)}%`);
  }
  console.log(`  Tokens: ${cleaning.stats.totalTokenUsage.input.toLocaleString()} in / ${cleaning.stats.totalTokenUsage.output.toLocaleString()} out`);
  if (cleaning.stats.totalTokenUsage.actualCostUsd !== undefined) {
    console.log(`  LLM cost: $${cleaning.stats.totalTokenUsage.actualCostUsd.toFixed(4)}`);
  }

  // Comparison
  console.log('\n📝 Content Comparison:');
  for (const comp of comparison) {
    const reduction = comp.reductionPercent !== undefined 
      ? ` (-${comp.reductionPercent.toFixed(1)}%)`
      : '';
    console.log(`  ${comp.title.slice(0, 40)}...`);
    console.log(`    ${comp.originalLength.toLocaleString()} → ${(comp.cleanedLength ?? 0).toLocaleString()} chars${reduction}`);
    if (comp.qualityScore !== undefined) {
      console.log(`    Quality: ${comp.qualityScore}/100, Type: ${comp.contentType ?? 'unknown'}`);
    }
  }

  // Total cost
  const searchCost = search.stats.costUsd ?? 0;
  const llmCost = cleaning.stats.totalTokenUsage.actualCostUsd ?? 0;
  const totalCost = searchCost + llmCost;
  console.log('\n💰 Total Cost:');
  console.log(`  Search: $${searchCost.toFixed(4)}`);
  console.log(`  LLM:    $${llmCost.toFixed(4)}`);
  console.log(`  Total:  $${totalCost.toFixed(4)}`);

  console.log('\n' + '═'.repeat(50));
}

/**
 * Extracts domain from URL.
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}
