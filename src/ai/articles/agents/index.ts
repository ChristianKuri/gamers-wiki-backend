/**
 * Article Generation Agents
 *
 * Multi-agent system for generating game articles:
 * - Scout: Gathers research from multiple sources
 * - Editor: Plans article structure and assigns research queries
 * - Specialist: Writes article sections based on research and plan
 */

export {
  runScout,
  SCOUT_CONFIG,
  // Helper functions (exported for testing)
  executeSearch,
  buildSearchContext,
  buildCategoryContext,
  buildRecentContext,
  buildFullContext,
  validateScoutOutput,
  assembleScoutOutput,
  type ScoutDeps,
  type ScoutProgressCallback,
  type ExecuteSearchOptions,
} from './scout';
export { runEditor, EDITOR_CONFIG, type EditorDeps } from './editor';
export { runSpecialist, SPECIALIST_CONFIG, type SpecialistDeps, type SpecialistOutput } from './specialist';

