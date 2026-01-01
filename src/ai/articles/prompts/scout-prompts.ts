/**
 * Scout Agent Prompts - Facade
 *
 * Note: The Scout agent now uses the Scout Query Planner for research planning.
 * The old prompt functions have been removed as they are no longer used.
 * See query-optimizer.ts for the new implementation.
 */

// Re-export shared types and utils
export * from './shared/scout';
export { detectArticleIntent } from './shared/utils';
