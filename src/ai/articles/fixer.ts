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
// Zod Schemas - Simple, letting LLM do the work
// ============================================================================

/**
 * Universal schema for smart section editing.
 * Give the LLM space to think and work.
 */
const SmartEditOutputSchema = z.object({
  thinking: z.string().describe('Your reasoning about how to apply this fix (be thorough)'),
  editedContent: z.string().describe('The complete edited section content'),
  whatChanged: z.string().describe('Brief description of the change made'),
  changeType: z.enum(['insertion', 'replacement', 'expansion', 'restructure']).describe('Type of change made'),
  grammarCheck: z.string().describe('Confirm the edited text is grammatically correct - any issues found?'),
});

/**
 * Schema for batch fixing multiple issues in one section.
 * More efficient and avoids grammar corruption from sequential edits.
 */
const BatchFixOutputSchema = z.object({
  thinking: z.string().describe('Your reasoning about how to fix ALL these issues together'),
  editedContent: z.string().describe('The complete edited section content with ALL fixes applied'),
  fixesSummary: z.array(z.object({
    issue: z.string().describe('Which issue this addresses'),
    change: z.string().describe('What was changed'),
  })).describe('Summary of each fix applied'),
  grammarCheck: z.string().describe('Verify the final text is grammatically correct'),
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
 * Batch fix multiple issues in a single section.
 * 
 * This is the preferred approach because:
 * 1. Fixes all issues in one pass - no grammar corruption from sequential edits
 * 2. LLM sees full context of what needs to change
 * 3. Validates grammar at the end
 * 
 * @param markdown - Current article markdown
 * @param sectionName - The section headline
 * @param issues - All issues targeting this section
 * @param deps - Dependencies
 * @returns Fix result with updated markdown
 */
export async function applyBatchFix(
  markdown: string,
  sectionName: string,
  issues: readonly ReviewIssue[],
  deps: FixerDeps
): Promise<FixResult & { issuesAddressed: number }> {
  const log = deps.logger ?? createPrefixedLogger('[Fixer]');
  const temperature = deps.temperature ?? FIXER_CONFIG.TEMPERATURE;

  // Filter to issues with fix instructions
  const actionableIssues = issues.filter(i => i.fixInstruction && i.fixStrategy !== 'no_action');
  
  if (actionableIssues.length === 0) {
    return {
      markdown,
      success: true,
      tokenUsage: createEmptyTokenUsage(),
      description: 'No actionable issues',
      issuesAddressed: 0,
    };
  }

  const sectionContent = getSectionContent(markdown, sectionName);
  if (!sectionContent) {
    log.warn(`Section "${sectionName}" not found`);
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: `Section "${sectionName}" not found`,
      issuesAddressed: 0,
    };
  }

  // Build the issues list for the prompt
  const issuesText = actionableIssues.map((issue, idx) => 
    `${idx + 1}. [${issue.severity.toUpperCase()}] ${issue.message}\n   FIX: ${issue.fixInstruction}`
  ).join('\n\n');

  // Determine expected scope - more issues = more changes allowed
  const hasExpandOrRegenerate = actionableIssues.some(
    i => i.fixStrategy === 'expand' || i.fixStrategy === 'regenerate'
  );
  const maxLengthIncrease = hasExpandOrRegenerate 
    ? 800 + (actionableIssues.length * 100)
    : 300 + (actionableIssues.length * 50);

  log.info(`Batch fixing ${actionableIssues.length} issues in "${sectionName}"`);

  try {
    const { object, usage } = await withRetry(
      () =>
        deps.generateObject({
          model: deps.model,
          schema: BatchFixOutputSchema,
          temperature,
          maxOutputTokens: 4000,
          system: `You are an expert editor fixing multiple issues in a gaming guide article section.

YOUR TASK:
Fix ALL the listed issues in a SINGLE, coherent edit. This is important because applying fixes sequentially can break grammar.

EDITING PRINCIPLES:
1. Address EVERY issue listed - don't skip any
2. Make minimal changes - only what's needed to fix each issue
3. Preserve the author's voice and existing structure
4. Maintain all markdown formatting (**bold**, ###headings, bullet lists, etc.)
5. CRITICAL: Ensure the final text is grammatically correct
6. Don't add fluff, padding, or repeat information

GRAMMAR CHECK:
After editing, carefully read the entire section to verify:
- No sentence fragments
- No double verbs ("find in a treasure chest containing" is WRONG)
- No incomplete phrases
- Natural sentence flow

Take your time to think through all fixes and verify the result.`,
          prompt: `Fix ALL these issues in the section below:

ISSUES TO FIX:
${issuesText}

SECTION "${sectionName}":
---
${sectionContent}
---

Apply all fixes, verify grammar is correct, then return the complete edited section.`,
        }),
      { context: `Batch fix: ${sectionName} (${actionableIssues.length} issues)`, signal: deps.signal }
    );

    const tokenUsage: TokenUsage = usage
      ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
      : createEmptyTokenUsage();

    // Log thinking and grammar check
    log.debug(`Batch fix thinking: ${object.thinking.slice(0, 200)}...`);
    log.debug(`Grammar check: ${object.grammarCheck}`);

    // Validate the edit
    const originalLength = sectionContent.length;
    const editedLength = object.editedContent.length;
    const lengthDiff = editedLength - originalLength;

    // Check for excessive content removal
    if (lengthDiff < -200) {
      log.warn(`Batch fix rejected: Too much content removed (${Math.abs(lengthDiff)} chars)`);
      return {
        markdown,
        success: false,
        tokenUsage,
        description: 'Fix rejected - removed too much content',
        issuesAddressed: 0,
      };
    }

    // Check for excessive addition
    if (lengthDiff > maxLengthIncrease) {
      log.warn(`Batch fix rejected: Too much content added (${lengthDiff} chars, max ${maxLengthIncrease})`);
      return {
        markdown,
        success: false,
        tokenUsage,
        description: 'Fix rejected - added too much content',
        issuesAddressed: 0,
      };
    }

    // Replace the section
    const resultMarkdown = replaceSection(markdown, sectionName, object.editedContent);

    if (!resultMarkdown) {
      log.error(`Failed to replace section "${sectionName}"`);
      return {
        markdown,
        success: false,
        tokenUsage,
        description: `Failed to replace section "${sectionName}"`,
        issuesAddressed: 0,
      };
    }

    const success = resultMarkdown !== markdown;
    const fixCount = object.fixesSummary.length;

    // Log each fix applied
    for (const fix of object.fixesSummary) {
      log.info(`  - ${fix.issue}: ${fix.change}`);
    }

    log.info(
      success
        ? `Batch fix applied (${fixCount} changes, ${lengthDiff >= 0 ? '+' : ''}${lengthDiff} chars)`
        : 'Batch fix had no effect'
    );

    return {
      markdown: resultMarkdown,
      success,
      tokenUsage,
      description: object.fixesSummary.map(f => f.change).join('; '),
      issuesAddressed: fixCount,
    };
  } catch (error) {
    log.error(`Batch fix failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: `Batch fix failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      issuesAddressed: 0,
    };
  }
}

/**
 * Smart section fix - the unified, LLM-native approach for single issues.
 * 
 * For single issues per section, this is used. For multiple issues,
 * prefer applyBatchFix to avoid grammar corruption.
 */
export async function applySmartFix(
  markdown: string,
  issue: ReviewIssue,
  deps: FixerDeps,
  ctx?: FixerContext
): Promise<FixResult> {
  const log = deps.logger ?? createPrefixedLogger('[Fixer]');
  const temperature = deps.temperature ?? FIXER_CONFIG.TEMPERATURE;

  if (!issue.fixInstruction) {
    log.warn('Smart fix requested but no fixInstruction provided');
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: 'No fix instruction provided',
    };
  }

  // Get section content if location is specified
  if (!issue.location || issue.location === 'global') {
    log.warn('Smart fix requires a specific section location');
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: 'Smart fix requires section location',
    };
  }

  const sectionContent = getSectionContent(markdown, issue.location);
  if (!sectionContent) {
    log.warn(`Section "${issue.location}" not found`);
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: `Section "${issue.location}" not found`,
    };
  }

  // Determine the scope of change expected
  const isMinorFix = issue.fixStrategy === 'inline_insert' || issue.fixStrategy === 'direct_edit';
  const maxLengthIncrease = isMinorFix ? 300 : 800; // chars

  log.info(`Applying smart fix to "${issue.location}" (${issue.fixStrategy}): ${issue.message.slice(0, 60)}...`);

  try {
    const { object, usage } = await withRetry(
      () =>
        deps.generateObject({
          model: deps.model,
          schema: SmartEditOutputSchema,
          temperature,
          maxOutputTokens: 4000, // Give LLM plenty of space
          system: `You are an expert editor fixing issues in gaming guide articles.

YOUR APPROACH:
1. First, THINK about the issue and how to fix it
2. Then, apply the fix to the content
3. Return the complete edited section
4. VERIFY grammar is correct

EDITING PRINCIPLES:
- Make the MINIMUM change necessary to fix the issue
- Preserve the author's voice and style
- Keep all existing information intact
- Maintain markdown formatting (**bold**, ###headings, etc.)
- Don't add fluff or padding

${isMinorFix ? `
THIS IS A MINOR FIX:
- You should be adding/changing only a few words or a short phrase
- Do NOT add new paragraphs
- Do NOT restructure the content
- The edit should be nearly invisible
` : `
THIS FIX MAY REQUIRE MORE CONTENT:
- You may add a paragraph if truly needed
- But still prefer minimal changes
- Don't repeat information that's elsewhere in the article
`}

GRAMMAR CHECK (CRITICAL):
After editing, read the modified sentences aloud. Check for:
- Sentence fragments
- Double verbs (e.g., "find in containing" is WRONG)
- Broken phrases from insertions
- Natural flow

Take your time to think through this carefully.`,
          prompt: `Fix this issue in the section below.

ISSUE: ${issue.message}

FIX INSTRUCTION: ${issue.fixInstruction}

SEVERITY: ${issue.severity}
CATEGORY: ${issue.category}

SECTION "${issue.location}":
---
${sectionContent}
---

Think through how to fix this, apply the edit, verify grammar, then return the edited section.`,
        }),
      { context: `Smart fix: ${issue.message.slice(0, 50)}`, signal: deps.signal }
    );

    const tokenUsage: TokenUsage = usage
      ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
      : createEmptyTokenUsage();

    // Log the LLM's thinking and grammar check
    log.debug(`LLM thinking: ${object.thinking.slice(0, 200)}...`);
    log.debug(`Grammar check: ${object.grammarCheck}`);

    // Validate the edit wasn't too aggressive
    const originalLength = sectionContent.length;
    const editedLength = object.editedContent.length;
    const lengthDiff = editedLength - originalLength;

    // Check for content removal (usually bad)
    if (lengthDiff < -100) {
      log.warn(`Smart fix rejected: Too much content removed (${Math.abs(lengthDiff)} chars)`);
      return {
        markdown,
        success: false,
        tokenUsage,
        description: 'Fix rejected - removed too much content',
      };
    }

    // Check for excessive addition
    if (lengthDiff > maxLengthIncrease) {
      log.warn(`Smart fix rejected: Too much content added (${lengthDiff} chars, max ${maxLengthIncrease})`);
      return {
        markdown,
        success: false,
        tokenUsage,
        description: 'Fix rejected - added too much content',
      };
    }

    // Replace the section with edited content
    const resultMarkdown = replaceSection(markdown, issue.location, object.editedContent);

    if (!resultMarkdown) {
      log.error(`Failed to replace section "${issue.location}"`);
      return {
        markdown,
        success: false,
        tokenUsage,
        description: `Failed to replace section "${issue.location}"`,
      };
    }

    const success = resultMarkdown !== markdown;

    log.info(
      success
        ? `Smart fix applied (${object.changeType}, ${lengthDiff >= 0 ? '+' : ''}${lengthDiff} chars): ${object.whatChanged}`
        : 'Smart fix had no effect'
    );

    return {
      markdown: resultMarkdown,
      success,
      tokenUsage,
      description: object.whatChanged,
    };
  } catch (error) {
    log.error(`Smart fix failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: `Fix failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Applies a direct edit - now just delegates to applySmartFix.
 * Kept for backwards compatibility with existing code.
 */
export async function applyDirectEdit(
  markdown: string,
  issue: ReviewIssue,
  deps: FixerDeps
): Promise<FixResult> {
  // Direct edit now uses the smart fix approach
  return applySmartFix(markdown, issue, deps);
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
    mustCover: [issue.fixInstruction], // The fix instruction is what must be covered
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
 * Expands an existing section - now delegates to applySmartFix.
 * Kept for backwards compatibility.
 */
export async function expandSection(
  markdown: string,
  issue: ReviewIssue,
  ctx: FixerContext,
  deps: FixerDeps
): Promise<FixResult> {
  return applySmartFix(markdown, issue, deps, ctx);
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
 * Categorizes issues in a section into batch-fixable vs special handling.
 * 
 * Batch-fixable: inline_insert, direct_edit, expand (can all be done in one LLM call)
 * Special: regenerate, add_section (need specialized handling)
 */
function categorizeIssues(issues: readonly ReviewIssue[]): {
  batchable: ReviewIssue[];
  special: ReviewIssue[];
} {
  const batchable: ReviewIssue[] = [];
  const special: ReviewIssue[] = [];

  for (const issue of issues) {
    if (issue.fixStrategy === 'no_action') {
      continue;
    }
    
    if (issue.fixStrategy === 'regenerate' || issue.fixStrategy === 'add_section') {
      special.push(issue);
    } else {
      batchable.push(issue);
    }
  }

  return { batchable, special };
}

/**
 * Selects the highest priority special fix (regenerate/add_section).
 */
function selectHighestPrioritySpecial(issues: readonly ReviewIssue[]): ReviewIssue | null {
  if (issues.length === 0) return null;
  
  // Prefer regenerate over add_section
  const regenerate = issues.find(i => i.fixStrategy === 'regenerate');
  if (regenerate) return regenerate;
  
  return issues[0] ?? null;
}

/**
 * Applies a special fix (regenerate or add_section) that can't be batched.
 */
async function applySpecialFix(
  markdown: string,
  issue: ReviewIssue,
  ctx: FixerContext,
  deps: FixerDeps
): Promise<FixResult> {
  const log = deps.logger ?? createPrefixedLogger('[Fixer]');

  switch (issue.fixStrategy) {
    case 'regenerate':
      return regenerateSection(markdown, issue, ctx, deps);

    case 'add_section':
      return addSection(markdown, issue, ctx, deps);

    default:
      log.warn(`applySpecialFix called with non-special strategy: ${issue.fixStrategy}`);
      return {
        markdown,
        success: false,
        tokenUsage: createEmptyTokenUsage(),
        description: `Not a special strategy: ${issue.fixStrategy}`,
      };
  }
}

// ============================================================================
// Main Fixer Function
// ============================================================================

/**
 * Runs the Fixer to apply fixes for identified issues.
 * 
 * Key improvements:
 * - Batches ALL issues for a section into a single LLM call
 * - Prevents grammar corruption from sequential edits
 * - Handles special strategies (regenerate, add_section) separately
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
  let sectionsProcessed = 0;

  // Process each section's issues
  for (const [target, sectionIssues] of groupedIssues) {
    // Limit sections processed per iteration
    if (sectionsProcessed >= FIXER_CONFIG.MAX_FIXES_PER_ITERATION) {
      log.debug(`Section limit reached (${FIXER_CONFIG.MAX_FIXES_PER_ITERATION}), stopping iteration`);
      break;
    }

    // Categorize issues: batchable (inline_insert, direct_edit, expand) vs special (regenerate, add_section)
    const { batchable, special } = categorizeIssues(sectionIssues);

    // Handle special strategies first (they may regenerate the entire section)
    if (special.length > 0) {
      const specialIssue = selectHighestPrioritySpecial(special);
      if (specialIssue) {
        log.info(`Applying special fix (${specialIssue.fixStrategy}) to "${target}"`);
        
        const result = await applySpecialFix(currentMarkdown, specialIssue, ctx, deps);
        
        fixesApplied.push({
          iteration,
          strategy: specialIssue.fixStrategy,
          target,
          reason: specialIssue.message,
          success: result.success,
        });

        if (result.success) {
          currentMarkdown = result.markdown;
          totalTokenUsage = addTokenUsage(totalTokenUsage, result.tokenUsage);
          sectionsProcessed++;
          // Skip batchable issues since we regenerated/replaced the section
          continue;
        } else {
          log.warn(`Special fix failed for "${target}": ${result.description}`);
        }
      }
    }

    // Handle batchable issues - fix ALL issues for this section in one call
    if (batchable.length > 0 && target !== 'global') {
      log.info(`Batch fixing ${batchable.length} issue(s) in "${target}"`);
      
      const result = await applyBatchFix(currentMarkdown, target, batchable, deps);
      
      // Record one fix entry per section (with count of issues addressed)
      fixesApplied.push({
        iteration,
        strategy: batchable.length > 1 ? 'batch' as FixStrategy : batchable[0]!.fixStrategy,
        target,
        reason: batchable.map(i => i.message).join('; '),
        success: result.success,
      });

      if (result.success) {
        currentMarkdown = result.markdown;
        totalTokenUsage = addTokenUsage(totalTokenUsage, result.tokenUsage);
        log.info(`Batch fix successful: ${result.issuesAddressed} issue(s) addressed in "${target}"`);
      } else {
        log.warn(`Batch fix failed for "${target}": ${result.description}`);
      }
      
      sectionsProcessed++;
    }
  }

  const successCount = fixesApplied.filter((f) => f.success).length;
  log.info(
    `Fixer iteration ${iteration} complete: ${successCount}/${fixesApplied.length} section fixes successful`
  );

  return {
    markdown: currentMarkdown,
    fixesApplied,
    tokenUsage: totalTokenUsage,
  };
}

