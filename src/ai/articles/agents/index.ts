/**
 * Article Generation Agents
 *
 * Multi-agent system for generating game articles:
 * - Scout: Gathers research from multiple sources
 * - Editor: Plans article structure and assigns research queries
 * - Specialist: Writes article sections based on research and plan
 * - Reviewer: Quality control and validation
 *
 * Note: Internal helper functions for testing are available via './scout.internals'.
 * Import from there only in test files:
 *
 * @example
 * // In test files only:
 * import { buildSearchContext, validateScoutOutput } from './scout.internals';
 */

// Public API exports
export {
  runScout,
  SCOUT_CONFIG,
  type ScoutDeps,
  type ScoutProgressCallback,
} from './scout';

export { runEditor, EDITOR_CONFIG, type EditorDeps, type EditorOutput } from './editor';
export { runSpecialist, SPECIALIST_CONFIG, type SpecialistDeps, type SpecialistOutput } from './specialist';
export {
  runReviewer,
  REVIEWER_CONFIG,
  countIssuesBySeverity,
  shouldRejectArticle,
  hasActionableCriticalIssues,
  getIssuesByCategory,
  type ReviewerDeps,
  type ReviewerOutput,
  type ReviewIssue,
  type ReviewIssueSeverity,
  type ReviewIssueCategory,
} from './reviewer';

