/**
 * Article Generation Agents
 *
 * Multi-agent system for generating game articles:
 * - Scout: Gathers research from multiple sources
 * - Editor: Plans article structure and assigns research queries
 * - Specialist: Writes article sections based on research and plan
 */

export { runScout, SCOUT_CONFIG, type ScoutDeps, type ScoutProgressCallback } from './scout';
export { runEditor, EDITOR_CONFIG, type EditorDeps } from './editor';
export { runSpecialist, SPECIALIST_CONFIG, type SpecialistDeps, type SpecialistOutput } from './specialist';

