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
  thinking: z.string().describe('Your reasoning about how to apply this fix - think step by step'),
  editedContent: z.string().describe('The complete edited section content with the fix applied'),
  whatChanged: z.string().describe('Brief description of the change made'),
  changeType: z.enum(['insertion', 'replacement', 'expansion', 'restructure', 'no_change']).describe('Type of change made'),
  wasFixed: z.boolean().describe('Did you successfully fix the issue?'),
  grammarCheck: z.string().describe('Confirm the edited text is grammatically correct'),
});

/**
 * Schema for batch fixing multiple issues in one section.
 * More efficient and avoids grammar corruption from sequential edits.
 */
const BatchFixOutputSchema = z.object({
  thinking: z.string().describe('Your detailed reasoning about how to fix ALL these issues together - think step by step'),
  editedContent: z.string().describe('The complete edited section content with ALL fixes applied'),
  fixesSummary: z.array(z.object({
    issue: z.string().describe('Which issue this addresses'),
    wasFixed: z.boolean().describe('Whether this issue was successfully fixed'),
    change: z.string().describe('What was changed (or why it could not be fixed)'),
  })).describe('Summary of each fix applied'),
  grammarCheck: z.string().describe('Verify the final text is grammatically correct'),
  confidenceScore: z.number().min(0).max(100).describe('How confident are you that ALL issues were properly fixed (0-100)'),
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
  // KEY INSIGHT: We give the LLM the PROBLEM, not the mechanical solution
  // The LLM is smart - let it figure out HOW to fix it
  const issuesText = actionableIssues.map((issue, idx) => {
    const hint = issue.fixInstruction 
      ? `\n   HINT: ${issue.fixInstruction.slice(0, 200)}${issue.fixInstruction.length > 200 ? '...' : ''}`
      : '';
    return `${idx + 1}. [${issue.severity.toUpperCase()}] ${issue.message}${hint}`;
  }).join('\n\n');

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
          maxOutputTokens: 6000, // More space for thinking and complete section
          system: `You are an expert editor fixing issues in a gaming guide article.

YOUR APPROACH (CRITICAL):
1. READ the issues carefully - understand WHAT is wrong
2. THINK about HOW to fix each one - the "hint" is just a suggestion, use your judgment
3. APPLY all fixes to the content
4. VERIFY each fix was actually applied
5. Return the complete edited section

YOU ARE SMART - USE YOUR INTELLIGENCE:
- Don't blindly follow mechanical instructions
- If a hint says "insert X after Y" but Y doesn't exist or has changed, figure out WHERE the information should go
- If content is MISSING, add it in a natural place
- If something is WRONG, fix it properly

EDITING PRINCIPLES:
- Fix ALL issues - don't skip any
- Be thorough but minimal - add what's needed, nothing more
- Preserve existing structure and voice
- Maintain markdown formatting (**bold**, ###headings, bullet lists)
- Ensure grammar is correct

COMMON MISTAKES TO AVOID:
❌ Saying you fixed something but not including the change in the output
❌ Adding duplicate headers or content
❌ Breaking sentence structure
❌ Leaving out part of the original content

SELF-CHECK BEFORE RETURNING:
For EACH issue, verify: "Did I actually include the fix in editedContent?"
If you can't fix an issue, mark wasFixed: false and explain why.`,
          prompt: `Fix ALL these issues in the section below.

ISSUES TO FIX:
${issuesText}

CURRENT SECTION CONTENT ("${sectionName}"):
---
${sectionContent}
---

INSTRUCTIONS:
1. Think through each issue step by step
2. Apply ALL fixes to the content
3. Double-check that each fix is actually in your editedContent
4. Return the complete edited section with ALL fixes applied
5. Be honest in fixesSummary - mark wasFixed: false if you couldn't fix something`,
        }),
      { context: `Batch fix: ${sectionName} (${actionableIssues.length} issues)`, signal: deps.signal }
    );

    const tokenUsage: TokenUsage = usage
      ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
      : createEmptyTokenUsage();

    // Log thinking and confidence
    log.debug(`Batch fix thinking: ${object.thinking.slice(0, 300)}...`);
    log.debug(`Grammar check: ${object.grammarCheck}`);
    log.debug(`Confidence: ${object.confidenceScore}%`);

    // Count actually fixed issues (LLM's self-report)
    const actuallyFixed = object.fixesSummary.filter(f => f.wasFixed).length;
    const notFixed = object.fixesSummary.filter(f => !f.wasFixed);

    // Log issues that couldn't be fixed
    if (notFixed.length > 0) {
      log.warn(`Batch fix: ${notFixed.length} issue(s) could not be fixed:`);
      for (const fix of notFixed) {
        log.warn(`  ❌ ${fix.issue}: ${fix.change}`);
      }
    }

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

    // Low confidence warning
    if (object.confidenceScore < 70) {
      log.warn(`Batch fix low confidence (${object.confidenceScore}%) - fixes may not be complete`);
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

    const contentChanged = resultMarkdown !== markdown;
    // Success = content changed AND at least one issue was actually fixed
    const success = contentChanged && actuallyFixed > 0;

    // Log each fix
    for (const fix of object.fixesSummary) {
      const status = fix.wasFixed ? '✓' : '✗';
      log.info(`  ${status} ${fix.issue}: ${fix.change}`);
    }

    log.info(
      success
        ? `Batch fix applied (${actuallyFixed}/${object.fixesSummary.length} fixed, ${lengthDiff >= 0 ? '+' : ''}${lengthDiff} chars, ${object.confidenceScore}% confidence)`
        : contentChanged 
          ? `Batch fix made changes but no issues were marked as fixed`
          : 'Batch fix had no effect'
    );

    return {
      markdown: resultMarkdown,
      success,
      tokenUsage,
      description: object.fixesSummary.filter(f => f.wasFixed).map(f => f.change).join('; '),
      issuesAddressed: actuallyFixed,
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
    // Build hint from fix instruction without requiring exact matching
    const hint = issue.fixInstruction 
      ? `\nHINT (use your judgment): ${issue.fixInstruction}`
      : '';

    const { object, usage } = await withRetry(
      () =>
        deps.generateObject({
          model: deps.model,
          schema: SmartEditOutputSchema,
          temperature,
          maxOutputTokens: 5000, // Give LLM plenty of space
          system: `You are an expert editor fixing issues in gaming guide articles.

YOUR APPROACH:
1. READ the issue - understand WHAT is wrong
2. THINK about HOW to fix it (the hint is a suggestion, not a requirement)
3. APPLY the fix to the content
4. VERIFY the fix is actually in your output
5. Return the complete edited section

YOU ARE SMART - USE YOUR INTELLIGENCE:
- Don't blindly follow mechanical instructions
- If a hint says "insert X after Y" but Y doesn't match exactly, figure out the right place
- If content is MISSING, add it where it fits naturally
- If something is WRONG, fix it properly

EDITING PRINCIPLES:
- Make the MINIMUM change necessary to fix the issue
- Preserve the author's voice and style  
- Keep all existing information intact
- Maintain markdown formatting (**bold**, ###headings, etc.)
- Don't add fluff or padding

${isMinorFix ? `
THIS IS A MINOR FIX:
- Add/change only a few words or a short phrase
- Do NOT add new paragraphs unless truly necessary
` : `
THIS FIX MAY REQUIRE MORE CONTENT:
- You may add a paragraph if needed
- But still prefer minimal changes
`}

SELF-CHECK:
Before returning, ask: "Did I actually include the fix in editedContent?"
If you couldn't fix the issue, set wasFixed: false and explain why.`,
          prompt: `Fix this issue in the section below.

ISSUE: ${issue.message}
${hint}

SEVERITY: ${issue.severity}
CATEGORY: ${issue.category}

SECTION "${issue.location}":
---
${sectionContent}
---

Think through how to fix this, apply the edit, verify it's in your output, then return the edited section.`,
        }),
      { context: `Smart fix: ${issue.message.slice(0, 50)}`, signal: deps.signal }
    );

    const tokenUsage: TokenUsage = usage
      ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
      : createEmptyTokenUsage();

    // Log the LLM's thinking
    log.debug(`LLM thinking: ${object.thinking.slice(0, 300)}...`);
    log.debug(`Grammar check: ${object.grammarCheck}`);

    // Check if LLM reports it couldn't fix the issue
    if (!object.wasFixed) {
      log.warn(`Smart fix: LLM could not fix the issue - ${object.whatChanged}`);
      return {
        markdown,
        success: false,
        tokenUsage,
        description: `Could not fix: ${object.whatChanged}`,
      };
    }

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

    const contentChanged = resultMarkdown !== markdown;
    const success = contentChanged && object.wasFixed;

    log.info(
      success
        ? `Smart fix applied (${object.changeType}, ${lengthDiff >= 0 ? '+' : ''}${lengthDiff} chars): ${object.whatChanged}`
        : contentChanged
          ? `Smart fix: content changed but issue may not be fully fixed`
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

