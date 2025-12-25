/**
 * E2E Test Result Storage Utility
 *
 * Writes test results to JSON files for analysis.
 * Results are stored in tests/e2e-results/article-generator/
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Directory for storing E2E test results */
const E2E_RESULTS_DIR = join(__dirname, '..', '..', 'e2e-results', 'article-generator');

/**
 * Validation issue found during E2E testing.
 */
export interface E2EValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly field: string;
  readonly message: string;
  readonly actual?: unknown;
  readonly expected?: unknown;
}

/**
 * Metadata about the test run.
 */
export interface TestRunMetadata {
  readonly testName: string;
  readonly timestamp: string;
  readonly durationMs: number;
  readonly passed: boolean;
  readonly igdbId?: number;
  readonly gameName?: string;
}

/**
 * Complete test result to be saved.
 */
export interface E2ETestResult {
  readonly metadata: TestRunMetadata;
  readonly apiResponse: unknown;
  readonly validationIssues: readonly E2EValidationIssue[];
  readonly databaseAssertions: Record<string, unknown>;
}

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
 *
 * @param testName - Name of the test (sanitized for filesystem)
 * @param timestamp - ISO timestamp
 * @returns Filename in format: {test-name}-{timestamp}.json
 */
function generateFilename(testName: string, timestamp: string): string {
  // Sanitize test name for filesystem
  const sanitized = testName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  // Format timestamp for filename: 2025-12-24T10-30-00
  const formattedTime = timestamp.replace(/[:.]/g, '-').slice(0, 19);

  return `${sanitized}-${formattedTime}.json`;
}

/**
 * Saves E2E test results to a JSON file for later analysis.
 *
 * @param result - The test result to save
 * @returns The path to the saved file
 *
 * @example
 * const filePath = saveTestResult({
 *   metadata: { testName: 'creates draft post', timestamp: '2025-12-24T10:30:00Z', ... },
 *   apiResponse: response,
 *   validationIssues: [],
 *   databaseAssertions: { postExists: true, ... },
 * });
 */
export function saveTestResult(result: E2ETestResult): string {
  ensureResultsDir();

  const filename = generateFilename(result.metadata.testName, result.metadata.timestamp);
  const filePath = join(E2E_RESULTS_DIR, filename);

  // Convert to JSON with pretty formatting
  const json = JSON.stringify(result, null, 2);
  writeFileSync(filePath, json, 'utf-8');

  return filePath;
}

/**
 * Creates a test result object for saving.
 *
 * @param testName - Name of the test
 * @param startTime - Start time in milliseconds
 * @param apiResponse - Full API response
 * @param validationIssues - Issues found during validation
 * @param databaseAssertions - Results of database checks
 * @param extraMetadata - Additional metadata to include
 * @returns Complete test result object
 */
export function createTestResult(
  testName: string,
  startTime: number,
  apiResponse: unknown,
  validationIssues: readonly E2EValidationIssue[],
  databaseAssertions: Record<string, unknown>,
  extraMetadata?: { igdbId?: number; gameName?: string }
): E2ETestResult {
  const endTime = Date.now();
  const errors = validationIssues.filter((i) => i.severity === 'error');

  return {
    metadata: {
      testName,
      timestamp: new Date().toISOString(),
      durationMs: endTime - startTime,
      passed: errors.length === 0,
      ...extraMetadata,
    },
    apiResponse,
    validationIssues,
    databaseAssertions,
  };
}

/**
 * Logs a summary of validation issues to the console.
 *
 * @param issues - Validation issues to summarize
 */
export function logValidationSummary(issues: readonly E2EValidationIssue[]): void {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  if (errors.length > 0) {
    console.error('\n❌ Validation Errors:');
    for (const error of errors) {
      console.error(`  - [${error.field}] ${error.message}`);
      if (error.actual !== undefined) {
        console.error(`    Actual: ${JSON.stringify(error.actual)}`);
      }
      if (error.expected !== undefined) {
        console.error(`    Expected: ${JSON.stringify(error.expected)}`);
      }
    }
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️ Validation Warnings:');
    for (const warning of warnings) {
      console.warn(`  - [${warning.field}] ${warning.message}`);
    }
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('\n✅ All validations passed');
  } else {
    console.log(`\n📊 Summary: ${errors.length} error(s), ${warnings.length} warning(s)`);
  }
}

