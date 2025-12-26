/**
 * Fixer Agent
 *
 * Autonomous article recovery system that fixes issues identified by the Reviewer.
 * Implements four fix strategies:
 * - direct_edit: Minor text replacement (clichés, typos)
 * - regenerate: Rewrite entire section with feedback
 * - add_section: Create new section for coverage gaps
 * - expand: Add content to existing section
 *
 * The Fixer loop runs up to MAX_FIXER_ITERATIONS times, applying fixes
 * and re-reviewing until the article passes or iterations are exhausted.
 */

import type { LanguageModel } from 'ai';
import { z } from 'zod';

import { createPrefixedLogger, type Logger } from '../../utils/logger';
import type { ArticlePlan, ArticleSectionPlan } from './article-plan';
import { writeSingleSection, type SingleSectionDeps } from './agents/specialist';
import type { ReviewIssue } from './agents/reviewer';
import { FIXER_CONFIG } from './config';
import { parseMarkdownH2Sections, isSourcesSectionHeading } from './markdown-utils';
import { withRetry } from './retry';
import {
  addTokenUsage,
  createEmptyTokenUsage,
  type FixApplied,
  type FixStrategy,
  type GameArticleContext,
  type ResearchPool,
  type ScoutOutput,
  type TokenUsage,
} from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Dependencies for the Fixer agent.
 */
export interface FixerDeps {
  readonly generateText: typeof import('ai').generateText;
  readonly generateObject: typeof import('ai').generateObject;
  readonly model: LanguageModel;
  readonly logger?: Logger;
  /** Optional AbortSignal for cancellation support */
  readonly signal?: AbortSignal;
  /** Optional temperature override (default: FIXER_CONFIG.TEMPERATURE) */
  readonly temperature?: number;
}

/**
 * Context needed for fix operations.
 */
export interface FixerContext {
  readonly gameContext: GameArticleContext;
  readonly scoutOutput: ScoutOutput;
  readonly plan: ArticlePlan;
  readonly enrichedPool: ResearchPool;
}

/**
 * Result from a single fix operation.
 */
export interface FixResult {
  /** Updated markdown after the fix */
  readonly markdown: string;
  /** Whether the fix was successful */
  readonly success: boolean;
  /** Token usage for this fix */
  readonly tokenUsage: TokenUsage;
  /** Description of what was fixed */
  readonly description: string;
}

/**
 * Result from the Fixer loop.
 */
export interface FixerOutput {
  /** Final markdown after all fixes */
  readonly markdown: string;
  /** Number of Fixer iterations performed */
  readonly iterations: number;
  /** List of all fixes applied */
  readonly fixesApplied: readonly FixApplied[];
  /** Total token usage for all fix operations */
  readonly tokenUsage: TokenUsage;
}

// ============================================================================
// Zod Schema for Direct Edit Output
// ============================================================================

const DirectEditOutputSchema = z.object({
  editedText: z.string().describe('The corrected text that should replace the original'),
  explanation: z.string().describe('Brief explanation of what was changed'),
});

// ============================================================================
// Markdown Manipulation Helpers
// ============================================================================

/**
 * Finds a section by headline in markdown.
 * Returns the start and end indices of the section content (excluding heading).
 */
function findSectionInMarkdown(
  markdown: string,
  headline: string
): { start: number; end: number; fullMatch: string } | null {
  // Escape special regex characters in headline
  const escapedHeadline = headline.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Find the heading first
  const headingRegex = new RegExp(`^## ${escapedHeadline}\\s*\\n`, 'mi');
  const headingMatch = markdown.match(headingRegex);
  
  if (!headingMatch || headingMatch.index === undefined) {
    return null;
  }
  
  const headingStart = headingMatch.index;
  const headingLength = headingMatch[0].length;
  const contentStart = headingStart + headingLength;
  
  // Find where the next ## heading starts (or end of string)
  const remainingMarkdown = markdown.slice(contentStart);
  const nextHeadingMatch = remainingMarkdown.match(/^## /m);
  
  let contentEnd: number;
  if (nextHeadingMatch && nextHeadingMatch.index !== undefined) {
    contentEnd = contentStart + nextHeadingMatch.index;
  } else {
    contentEnd = markdown.length;
  }

  return {
    start: contentStart,
    end: contentEnd,
    fullMatch: markdown.slice(headingStart, contentEnd),
  };
}

/**
 * Replaces a section's content in markdown.
 * Keeps the heading, replaces the body.
 *
 * @param markdown - Original markdown
 * @param headline - Section headline to find
 * @param newContent - New content for the section (without heading)
 * @returns Updated markdown or null if section not found
 */
export function replaceSection(
  markdown: string,
  headline: string,
  newContent: string
): string | null {
  const location = findSectionInMarkdown(markdown, headline);
  if (!location) {
    return null;
  }

  const before = markdown.slice(0, location.start);
  const after = markdown.slice(location.end);

  // Ensure proper spacing
  const formattedContent = newContent.trim() + '\n\n';

  return before + formattedContent + after;
}

/**
 * Inserts a new section after a specified section.
 *
 * @param markdown - Original markdown
 * @param afterHeadline - Insert after this section (null = at end before Sources)
 * @param newHeadline - Heading for the new section
 * @param newContent - Content for the new section
 * @returns Updated markdown
 */
export function insertSection(
  markdown: string,
  afterHeadline: string | null,
  newHeadline: string,
  newContent: string
): string {
  const newSectionMarkdown = `## ${newHeadline}\n\n${newContent.trim()}\n\n`;

  if (afterHeadline === null) {
    // Insert before Sources section (at end of content)
    const sourcesMatch = markdown.match(/^## Sources\s*\n/mi);
    if (sourcesMatch && sourcesMatch.index !== undefined) {
      const insertPoint = sourcesMatch.index;
      return (
        markdown.slice(0, insertPoint) +
        newSectionMarkdown +
        markdown.slice(insertPoint)
      );
    }
    // No Sources section, append at end
    return markdown.trimEnd() + '\n\n' + newSectionMarkdown;
  }

  // Insert after the specified section
  const location = findSectionInMarkdown(markdown, afterHeadline);
  if (!location) {
    // Section not found, append before Sources
    return insertSection(markdown, null, newHeadline, newContent);
  }

  return (
    markdown.slice(0, location.end) +
    newSectionMarkdown +
    markdown.slice(location.end)
  );
}

/**
 * Gets the content of a section by headline.
 */
export function getSectionContent(markdown: string, headline: string): string | null {
  const sections = parseMarkdownH2Sections(markdown);
  const section = sections.find(
    (s) => s.heading.toLowerCase() === headline.toLowerCase()
  );
  return section?.content ?? null;
}

// ============================================================================
// Fix Strategy Implementations
// ============================================================================

/**
 * Applies a direct edit to fix minor text issues.
 * Uses an LLM to intelligently apply the edit instruction.
 *
 * @param markdown - Current article markdown
 * @param issue - The issue with fixInstruction
 * @param deps - Dependencies
 * @returns Fix result with updated markdown
 */
export async function applyDirectEdit(
  markdown: string,
  issue: ReviewIssue,
  deps: FixerDeps
): Promise<FixResult> {
  const log = deps.logger ?? createPrefixedLogger('[Fixer]');
  const temperature = deps.temperature ?? FIXER_CONFIG.TEMPERATURE;

  if (!issue.fixInstruction) {
    log.warn('Direct edit requested but no fixInstruction provided');
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: 'No fix instruction provided',
    };
  }

  // If the issue has a location, extract that section for targeted editing
  let targetText = markdown;
  let isFullArticle = true;

  if (issue.location && issue.location !== 'global') {
    const sectionContent = getSectionContent(markdown, issue.location);
    if (sectionContent) {
      targetText = sectionContent;
      isFullArticle = false;
    }
  }

  log.debug(`Applying direct edit: ${issue.fixInstruction.slice(0, 100)}...`);

  try {
    const { object, usage } = await withRetry(
      () =>
        deps.generateObject({
          model: deps.model,
          schema: DirectEditOutputSchema,
          temperature,
          maxOutputTokens: FIXER_CONFIG.MAX_OUTPUT_TOKENS_DIRECT_EDIT,
          system: `You are a precise text editor. Your task is to apply specific edits to text while preserving all other content exactly as-is.

Rules:
1. Apply ONLY the requested edit - do not make other changes
2. Preserve all formatting, structure, and whitespace
3. If the edit cannot be applied (text not found), return the original text unchanged
4. Be surgical - change as little as possible to accomplish the goal`,
          prompt: `Apply this edit to the text below:

EDIT INSTRUCTION: ${issue.fixInstruction}

ORIGINAL TEXT:
${targetText}

Return the edited text with the change applied.`,
        }),
      { context: `Direct edit: ${issue.message.slice(0, 50)}`, signal: deps.signal }
    );

    const tokenUsage: TokenUsage = usage
      ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
      : createEmptyTokenUsage();

    // If we edited a section, replace it in the full markdown
    let resultMarkdown: string;
    if (isFullArticle) {
      resultMarkdown = object.editedText;
    } else {
      const replaced = replaceSection(markdown, issue.location!, object.editedText);
      resultMarkdown = replaced ?? markdown;
    }

    // Verify something actually changed
    const success = resultMarkdown !== markdown;

    log.info(
      success
        ? `Direct edit applied: ${object.explanation}`
        : 'Direct edit had no effect'
    );

    return {
      markdown: resultMarkdown,
      success,
      tokenUsage,
      description: object.explanation,
    };
  } catch (error) {
    log.error(`Direct edit failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: `Edit failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Regenerates a section using the Specialist agent with Reviewer feedback.
 *
 * @param markdown - Current article markdown
 * @param issue - The issue targeting a specific section
 * @param ctx - Fixer context with game/research data
 * @param deps - Dependencies
 * @returns Fix result with updated markdown
 */
export async function regenerateSection(
  markdown: string,
  issue: ReviewIssue,
  ctx: FixerContext,
  deps: FixerDeps
): Promise<FixResult> {
  const log = deps.logger ?? createPrefixedLogger('[Fixer]');

  if (!issue.location) {
    log.warn('Regenerate requested but no location specified');
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: 'No section location specified',
    };
  }

  // Find the section index in the plan
  const sectionIndex = ctx.plan.sections.findIndex(
    (s) => s.headline.toLowerCase() === issue.location!.toLowerCase()
  );

  if (sectionIndex === -1) {
    log.warn(`Section "${issue.location}" not found in plan`);
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: `Section "${issue.location}" not found`,
    };
  }

  log.info(`Regenerating section "${issue.location}" with feedback`);

  // Build feedback from issue
  const feedback = [issue.message, issue.fixInstruction].filter(Boolean).join('\n');

  // Create deps for writeSingleSection
  const sectionDeps: SingleSectionDeps = {
    generateText: deps.generateText,
    model: deps.model,
    logger: deps.logger,
    signal: deps.signal,
    temperature: deps.temperature,
  };

  try {
    const result = await writeSingleSection(
      ctx.gameContext,
      ctx.scoutOutput,
      ctx.plan,
      sectionIndex,
      ctx.enrichedPool,
      sectionDeps,
      {
        feedback,
        targetWordCount: ctx.gameContext.targetWordCount,
        requiredElements: ctx.plan.requiredElements,
      }
    );

    // Replace the section in markdown
    const newMarkdown = replaceSection(markdown, issue.location, result.text);

    if (!newMarkdown) {
      log.error(`Failed to replace section "${issue.location}" in markdown`);
      return {
        markdown,
        success: false,
        tokenUsage: result.tokenUsage,
        description: `Failed to replace section "${issue.location}"`,
      };
    }

    log.info(`Section "${issue.location}" regenerated successfully`);

    return {
      markdown: newMarkdown,
      success: true,
      tokenUsage: result.tokenUsage,
      description: `Regenerated section "${issue.location}"`,
    };
  } catch (error) {
    log.error(
      `Section regeneration failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: `Regeneration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Adds a new section to the article.
 *
 * @param markdown - Current article markdown
 * @param issue - The issue describing the coverage gap
 * @param ctx - Fixer context
 * @param deps - Dependencies
 * @returns Fix result with updated markdown
 */
export async function addSection(
  markdown: string,
  issue: ReviewIssue,
  ctx: FixerContext,
  deps: FixerDeps
): Promise<FixResult> {
  const log = deps.logger ?? createPrefixedLogger('[Fixer]');

  if (!issue.fixInstruction) {
    log.warn('Add section requested but no fixInstruction provided');
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: 'No section specification provided',
    };
  }

  log.info(`Adding new section: ${issue.fixInstruction.slice(0, 50)}...`);

  // Create a temporary section plan for the new section
  // The fix instruction should describe what to cover
  const tempSectionPlan: ArticleSectionPlan = {
    headline: issue.location ?? 'Additional Information',
    goal: issue.fixInstruction,
    researchQueries: [], // Will use existing research pool
  };

  // Create an extended plan with the new section
  const extendedPlan: ArticlePlan = {
    ...ctx.plan,
    sections: [...ctx.plan.sections, tempSectionPlan],
  };

  const newSectionIndex = extendedPlan.sections.length - 1;

  // Create deps for writeSingleSection
  const sectionDeps: SingleSectionDeps = {
    generateText: deps.generateText,
    model: deps.model,
    logger: deps.logger,
    signal: deps.signal,
    temperature: deps.temperature,
  };

  try {
    const result = await writeSingleSection(
      ctx.gameContext,
      ctx.scoutOutput,
      extendedPlan,
      newSectionIndex,
      ctx.enrichedPool,
      sectionDeps,
      {
        targetWordCount: ctx.gameContext.targetWordCount,
      }
    );

    // Insert the new section before Sources
    const newMarkdown = insertSection(
      markdown,
      null, // Insert at end (before Sources)
      tempSectionPlan.headline,
      result.text
    );

    log.info(`New section "${tempSectionPlan.headline}" added successfully`);

    return {
      markdown: newMarkdown,
      success: true,
      tokenUsage: result.tokenUsage,
      description: `Added new section "${tempSectionPlan.headline}"`,
    };
  } catch (error) {
    log.error(
      `Adding section failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: `Add section failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Expands an existing section with additional content.
 *
 * @param markdown - Current article markdown
 * @param issue - The issue describing what needs expansion
 * @param ctx - Fixer context
 * @param deps - Dependencies
 * @returns Fix result with updated markdown
 */
export async function expandSection(
  markdown: string,
  issue: ReviewIssue,
  ctx: FixerContext,
  deps: FixerDeps
): Promise<FixResult> {
  const log = deps.logger ?? createPrefixedLogger('[Fixer]');
  const temperature = deps.temperature ?? FIXER_CONFIG.TEMPERATURE;

  if (!issue.location) {
    log.warn('Expand requested but no location specified');
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: 'No section location specified',
    };
  }

  const existingContent = getSectionContent(markdown, issue.location);
  if (!existingContent) {
    log.warn(`Section "${issue.location}" not found for expansion`);
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: `Section "${issue.location}" not found`,
    };
  }

  const expansionInstruction = issue.fixInstruction ?? issue.suggestion ?? 'Add more depth and detail';

  log.info(`Expanding section "${issue.location}": ${expansionInstruction.slice(0, 50)}...`);

  // Find section info from plan for context
  const sectionPlan = ctx.plan.sections.find(
    (s) => s.headline.toLowerCase() === issue.location!.toLowerCase()
  );

  try {
    const { text, usage } = await withRetry(
      () =>
        deps.generateText({
          model: deps.model,
          temperature,
          maxOutputTokens: FIXER_CONFIG.MAX_OUTPUT_TOKENS_EXPAND,
          system: `You are a gaming content specialist expanding an article section.

Your task is to ADD 1-2 paragraphs of new content to an existing section.

Rules:
1. Preserve ALL existing content exactly as-is
2. Add new paragraphs AFTER the existing content
3. Maintain the same tone, style, and formatting
4. Focus on the specific expansion requested
5. Do not repeat information already covered
6. Output ONLY the expanded section content (no headings)`,
          prompt: `Expand this section with more detail:

GAME: ${ctx.gameContext.gameName}
SECTION: ${issue.location}
${sectionPlan ? `SECTION GOAL: ${sectionPlan.goal}` : ''}

EXPANSION REQUEST: ${expansionInstruction}

EXISTING CONTENT:
${existingContent}

Write the expanded section with the original content followed by 1-2 new paragraphs addressing the expansion request.`,
        }),
      { context: `Expand section "${issue.location}"`, signal: deps.signal }
    );

    const tokenUsage: TokenUsage = usage
      ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
      : createEmptyTokenUsage();

    // Replace the section with expanded content
    const newMarkdown = replaceSection(markdown, issue.location, text.trim());

    if (!newMarkdown) {
      log.error(`Failed to replace section "${issue.location}" after expansion`);
      return {
        markdown,
        success: false,
        tokenUsage,
        description: `Failed to replace section "${issue.location}"`,
      };
    }

    // Verify content actually increased
    const success = newMarkdown.length > markdown.length;

    log.info(
      success
        ? `Section "${issue.location}" expanded (+${newMarkdown.length - markdown.length} chars)`
        : 'Expansion did not add content'
    );

    return {
      markdown: newMarkdown,
      success,
      tokenUsage,
      description: `Expanded section "${issue.location}"`,
    };
  } catch (error) {
    log.error(
      `Section expansion failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: `Expansion failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ============================================================================
// Fix Strategy Selection and Execution
// ============================================================================

/**
 * Groups issues by their target section for batch processing.
 */
function groupIssuesBySection(issues: readonly ReviewIssue[]): Map<string, ReviewIssue[]> {
  const groups = new Map<string, ReviewIssue[]>();

  for (const issue of issues) {
    const key = issue.location ?? 'global';
    const existing = groups.get(key) ?? [];
    groups.set(key, [...existing, issue]);
  }

  return groups;
}

/**
 * Selects the highest priority fix strategy for a group of issues.
 * Uses FIXER_CONFIG.STRATEGY_PRIORITY to determine order.
 */
function selectBestStrategy(issues: readonly ReviewIssue[]): ReviewIssue | null {
  const priorityOrder = FIXER_CONFIG.STRATEGY_PRIORITY;

  // Filter out no_action issues
  const actionableIssues = issues.filter((i) => i.fixStrategy !== 'no_action');
  if (actionableIssues.length === 0) {
    return null;
  }

  // Sort by priority (lower index = higher priority)
  const sorted = [...actionableIssues].sort((a, b) => {
    const aPriority = priorityOrder.indexOf(a.fixStrategy as typeof priorityOrder[number]);
    const bPriority = priorityOrder.indexOf(b.fixStrategy as typeof priorityOrder[number]);

    // If strategy not in priority list, put it last
    const aIdx = aPriority === -1 ? priorityOrder.length : aPriority;
    const bIdx = bPriority === -1 ? priorityOrder.length : bPriority;

    return aIdx - bIdx;
  });

  return sorted[0] ?? null;
}

/**
 * Applies a single fix based on the issue's strategy.
 */
async function applyFix(
  markdown: string,
  issue: ReviewIssue,
  ctx: FixerContext,
  deps: FixerDeps
): Promise<FixResult> {
  const log = deps.logger ?? createPrefixedLogger('[Fixer]');

  switch (issue.fixStrategy) {
    case 'direct_edit':
      return applyDirectEdit(markdown, issue, deps);

    case 'regenerate':
      return regenerateSection(markdown, issue, ctx, deps);

    case 'add_section':
      return addSection(markdown, issue, ctx, deps);

    case 'expand':
      return expandSection(markdown, issue, ctx, deps);

    case 'no_action':
      log.debug(`Skipping no_action issue: ${issue.message}`);
      return {
        markdown,
        success: true,
        tokenUsage: createEmptyTokenUsage(),
        description: 'No action needed',
      };

    default:
      log.warn(`Unknown fix strategy: ${issue.fixStrategy}`);
      return {
        markdown,
        success: false,
        tokenUsage: createEmptyTokenUsage(),
        description: `Unknown strategy: ${issue.fixStrategy}`,
      };
  }
}

// ============================================================================
// Main Fixer Function
// ============================================================================

/**
 * Runs the Fixer to apply fixes for identified issues.
 * This is called once per iteration; the main loop is in the generator.
 *
 * @param markdown - Current article markdown
 * @param issues - Issues identified by the Reviewer
 * @param ctx - Fixer context with game/research data
 * @param deps - Dependencies
 * @param iteration - Current iteration number (1-indexed)
 * @returns Updated markdown and list of fixes applied
 */
export async function runFixer(
  markdown: string,
  issues: readonly ReviewIssue[],
  ctx: FixerContext,
  deps: FixerDeps,
  iteration: number = 1
): Promise<{
  markdown: string;
  fixesApplied: readonly FixApplied[];
  tokenUsage: TokenUsage;
}> {
  const log = deps.logger ?? createPrefixedLogger('[Fixer]');

  // Filter out no_action issues
  const actionableIssues = issues.filter((i) => i.fixStrategy !== 'no_action');

  if (actionableIssues.length === 0) {
    log.info('No actionable issues to fix');
    return {
      markdown,
      fixesApplied: [],
      tokenUsage: createEmptyTokenUsage(),
    };
  }

  log.info(`Fixer iteration ${iteration}: Processing ${actionableIssues.length} actionable issues`);

  // Group issues by section
  const groupedIssues = groupIssuesBySection(actionableIssues);
  log.debug(`Issues grouped into ${groupedIssues.size} sections/targets`);

  let currentMarkdown = markdown;
  const fixesApplied: FixApplied[] = [];
  let totalTokenUsage = createEmptyTokenUsage();
  let directEditCount = 0;

  // Process each section's issues
  for (const [target, sectionIssues] of groupedIssues) {
    // Select the best strategy for this section
    const issueToFix = selectBestStrategy(sectionIssues);
    if (!issueToFix) {
      continue;
    }

    // Limit direct edits per iteration
    if (
      issueToFix.fixStrategy === 'direct_edit' &&
      directEditCount >= FIXER_CONFIG.MAX_DIRECT_EDITS_PER_ITERATION
    ) {
      log.debug(`Skipping direct edit for "${target}" - limit reached`);
      continue;
    }

    log.info(
      `Applying ${issueToFix.fixStrategy} to "${target}": ${issueToFix.message.slice(0, 50)}...`
    );

    const result = await applyFix(currentMarkdown, issueToFix, ctx, deps);

    fixesApplied.push({
      iteration,
      strategy: issueToFix.fixStrategy,
      target,
      reason: issueToFix.message,
      success: result.success,
    });

    if (result.success) {
      currentMarkdown = result.markdown;
      totalTokenUsage = addTokenUsage(totalTokenUsage, result.tokenUsage);

      if (issueToFix.fixStrategy === 'direct_edit') {
        directEditCount++;
      }
    } else {
      log.warn(`Fix failed for "${target}": ${result.description}`);
    }
  }

  log.info(
    `Fixer iteration ${iteration} complete: ${fixesApplied.filter((f) => f.success).length}/${fixesApplied.length} fixes successful`
  );

  return {
    markdown: currentMarkdown,
    fixesApplied,
    tokenUsage: totalTokenUsage,
  };
}

