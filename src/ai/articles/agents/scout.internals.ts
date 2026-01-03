/**
 * Scout Agent Internals
 *
 * This module exposes internal functions from the Scout agent for unit testing.
 * These exports are NOT part of the public API and should only be imported in test files.
 *
 * @internal This module is for testing purposes only. Do not import in production code.
 *
 * @example
 * // In a test file:
 * import { assembleScoutOutput, calculateResearchConfidence } from './scout.internals';
 *
 * describe('assembleScoutOutput', () => {
 *   it('should build correct output structure', () => {
 *     const result = assembleScoutOutput(...);
 *     expect(result.sourceSummaries).toBeDefined();
 *   });
 * });
 */

// Re-export internal functions for testing
export {
  // Search execution
  executeSearch,
  type ExecuteSearchOptions,

  // Output assembly
  assembleScoutOutput,
  calculateResearchConfidence,
  
  // Source summaries extraction (replaces queryBriefings generation)
  extractSourceSummaries,
  extractTopSourcesPerQuery,
} from './scout';
