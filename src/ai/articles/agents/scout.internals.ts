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
 * import { buildSearchContext, validateScoutOutput } from './scout.internals';
 *
 * describe('buildSearchContext', () => {
 *   it('should format results correctly', () => {
 *     const result = buildSearchContext(mockResults);
 *     expect(result).toContain('Query:');
 *   });
 * });
 */

// Re-export internal functions for testing
export {
  // Search execution
  executeSearch,
  type ExecuteSearchOptions,

  // Context building
  buildSearchContext,
  buildCategoryContext,
  buildRecentContext,
  buildFullContext,

  // Validation
  validateScoutOutput,

  // Output assembly
  assembleScoutOutput,
  calculateResearchConfidence,
} from './scout';

