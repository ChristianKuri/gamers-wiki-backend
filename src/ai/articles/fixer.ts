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
// Zod Schemas - Paragraph Rewrite Approach
// ============================================================================

/**
 * Schema for paragraph-level rewriting.
 * 
 * KEY INSIGHT: Instead of asking the LLM to splice text into specific locations,
 * we ask it to COMPLETELY REWRITE paragraphs that have issues. This:
 * 1. Produces natural, flowing prose (no Frankenstein sentences)
 * 2. Lets the LLM use its intelligence to integrate information properly
 * 3. Reduces retry cycles because the result is semantically complete
 */
const ParagraphRewriteSchema = z.object({
  analysis: z.string().describe('Analyze what information is missing or incorrect in this section'),
  rewrittenSection: z.string().describe('The COMPLETE rewritten section with all issues fixed. Do not just patch - rewrite paragraphs entirely for natural flow.'),
  changesExplained: z.array(z.object({
    originalProblem: z.string().describe('What was wrong'),
    howFixed: z.string().describe('How you fixed it by rewriting'),
    verificationQuote: z.string().describe('Quote the exact text from your rewrite that fixes this issue'),
  })).describe('Explain each fix with proof'),
  selfCheck: z.object({
    allIssuesAddressed: z.boolean().describe('Did you address ALL listed issues?'),
    readsProfessionally: z.boolean().describe('Does the rewritten section read professionally and naturally?'),
    noInformationLost: z.boolean().describe('Did you preserve all original important information?'),
  }).describe('Self-verification checklist'),
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
 * Rewrite section with fixes - PARAGRAPH-LEVEL REWRITING approach.
 * 
 * KEY INSIGHT: Instead of trying to surgically insert text at specific locations,
 * we ask the LLM to COMPLETELY REWRITE paragraphs that have issues. This:
 * 
 * 1. Produces natural, flowing prose (no Frankenstein sentences)
 * 2. Lets the LLM integrate new information properly
 * 3. Reduces retry cycles because the result reads naturally
 * 4. Prevents "reported success but reviewer still sees the issue" bugs
 * 
 * @param markdown - Current article markdown
 * @param sectionName - The section headline
 * @param issues - All issues targeting this section
 * @param deps - Dependencies
 * @returns Fix result with updated markdown
 */
export async function rewriteSectionWithFixes(
  markdown: string,
  sectionName: string,
  issues: readonly ReviewIssue[],
  deps: FixerDeps
): Promise<FixResult & { issuesAddressed: number }> {
  const log = deps.logger ?? createPrefixedLogger('[Fixer]');
  const temperature = deps.temperature ?? FIXER_CONFIG.TEMPERATURE;

  // Filter to actionable issues
  const actionableIssues = issues.filter(i => i.fixStrategy !== 'no_action');
  
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

  // Build clear issue descriptions
  const issuesList = actionableIssues.map((issue, idx) => {
    return `${idx + 1}. [${issue.severity.toUpperCase()}] ${issue.message}
   What's needed: ${issue.fixInstruction || 'Fix as appropriate'}`;
  }).join('\n\n');

  log.info(`Rewriting "${sectionName}" to fix ${actionableIssues.length} issue(s)`);

  try {
    const { object, usage } = await withRetry(
      () =>
        deps.generateObject({
          model: deps.model,
          schema: ParagraphRewriteSchema,
          temperature,
          maxOutputTokens: 6000,
          system: `You are an expert gaming guide editor. Your job is to REWRITE sections to fix issues.

CRITICAL: DO NOT PATCH - REWRITE PARAGRAPHS
When fixing issues, don't try to splice words into existing sentences. Instead:
1. Identify which paragraph(s) contain the issue
2. COMPLETELY REWRITE those paragraphs from scratch
3. Integrate the missing/corrected information naturally into the rewrite

WHY THIS MATTERS:
- Patching creates awkward "Frankenstein" sentences like "find in a treasure chest containing"
- Rewriting produces natural prose that flows well
- Reviewers can clearly see the issue is fixed

EXAMPLE:
❌ BAD (patching): "Go to the cave. (NEW: The Archaic Tunic is here.) Open the chest."
✅ GOOD (rewriting): "Make your way to the Pondside Cave, where you'll find a chest containing the Archaic Tunic. This early armor piece provides essential protection for Link."

GUIDELINES:
- Rewrite ENTIRE paragraphs that need changes, not just sentences
- Keep paragraphs that don't need changes mostly intact
- Maintain the article's professional gaming guide tone
- Preserve all original important information
- Don't add fluff - be informative and concise
- Keep markdown formatting (bold, lists, subheadings)

CRITICAL - DO NOT INCLUDE SECTION HEADER:
- The section heading (## Section Name) is handled separately
- Your output should be the CONTENT ONLY, starting with the first paragraph
- Do NOT start with "## " or "### " or any heading that duplicates the section title

STRUCTURAL ISSUES (CRITICAL PRIORITY):
- Duplicate headers within content: Remove redundant subheadings
- Empty sections: Add content
- Broken formatting: Fix markdown syntax`,
          prompt: `REWRITE this section's CONTENT to fix ALL the issues below.

ISSUES TO FIX:
${issuesList}

CURRENT SECTION CONTENT (heading "${sectionName}" is separate, do NOT include it):
---
${sectionContent}
---

INSTRUCTIONS:
1. Analyze which paragraphs need to be rewritten to fix these issues
2. Rewrite those paragraphs COMPLETELY (don't just insert words)
3. Ensure the rewritten text reads naturally and professionally
4. Verify each issue is fixed by quoting the relevant text from your rewrite

⚠️ CRITICAL: Return ONLY the section content. Do NOT include "## ${sectionName}" or any duplicate heading at the start.`,
        }),
      { context: `Rewrite section: ${sectionName} (${actionableIssues.length} issues)`, signal: deps.signal }
    );

    const tokenUsage: TokenUsage = usage
      ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
      : createEmptyTokenUsage();

    // Log analysis
    log.debug(`Analysis: ${object.analysis.slice(0, 200)}...`);

    // Validate self-check
    if (!object.selfCheck.allIssuesAddressed) {
      log.warn('LLM reports not all issues were addressed');
    }
    if (!object.selfCheck.readsProfessionally) {
      log.warn('LLM reports result may not read professionally');
    }

    // Log each change with verification
    let verifiedFixes = 0;
    for (const change of object.changesExplained) {
      const hasProof = change.verificationQuote.length > 10 && 
        object.rewrittenSection.includes(change.verificationQuote.slice(0, 20));
      
      if (hasProof) {
        log.info(`  ✓ ${change.originalProblem}: ${change.howFixed}`);
        verifiedFixes++;
      } else {
        log.warn(`  ⚠ ${change.originalProblem}: ${change.howFixed} (verification uncertain)`);
      }
    }

    // Validate the rewrite
    const originalLength = sectionContent.length;
    const rewrittenLength = object.rewrittenSection.length;
    const lengthDiff = rewrittenLength - originalLength;

    // Allow reasonable content changes (more lenient for paragraph rewrites)
    const minLength = originalLength * 0.5; // Can shrink by up to 50%
    const maxLength = originalLength * 2.5; // Can grow by up to 150%

    if (rewrittenLength < minLength) {
      log.warn(`Rewrite rejected: Too much content removed (${rewrittenLength} < ${minLength} chars)`);
      return {
        markdown,
        success: false,
        tokenUsage,
        description: 'Rewrite removed too much content',
        issuesAddressed: 0,
      };
    }

    if (rewrittenLength > maxLength) {
      log.warn(`Rewrite rejected: Too much content added (${rewrittenLength} > ${maxLength} chars)`);
      return {
        markdown,
        success: false,
        tokenUsage,
        description: 'Rewrite added too much content',
        issuesAddressed: 0,
      };
    }

    // Post-process: Strip any leading headers that duplicate the section title
    // LLMs sometimes include the section heading even when told not to
    let cleanedContent = object.rewrittenSection;
    
    // Remove leading ## or ### headers that match the section name
    const headerPatterns = [
      new RegExp(`^##\\s*${sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n+`, 'i'),
      new RegExp(`^###\\s*${sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n+`, 'i'),
      // Also remove any exact duplicate of the section name as a header
      /^#{2,3}\s+.{0,100}\n+/,  // Any leading header (will be checked more carefully)
    ];
    
    // Check if the content starts with a header that matches or nearly matches the section name
    const firstLineMatch = cleanedContent.match(/^(#{2,3})\s*(.+?)\s*\n/);
    if (firstLineMatch) {
      const headerText = firstLineMatch[2];
      // Check if it's a duplicate of the section name (fuzzy match)
      const normalizedSection = sectionName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normalizedHeader = headerText.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalizedSection === normalizedHeader || 
          normalizedSection.includes(normalizedHeader) || 
          normalizedHeader.includes(normalizedSection)) {
        log.warn(`Stripping duplicate header "${headerText}" from rewritten content`);
        cleanedContent = cleanedContent.replace(firstLineMatch[0], '');
      }
    }

    // Replace the section
    const resultMarkdown = replaceSection(markdown, sectionName, cleanedContent);

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
    const issuesAddressed = object.selfCheck.allIssuesAddressed 
      ? actionableIssues.length 
      : Math.max(verifiedFixes, 1);

    log.info(
      contentChanged
        ? `Section rewritten (${lengthDiff >= 0 ? '+' : ''}${lengthDiff} chars, ${issuesAddressed} issues addressed)`
        : 'Rewrite had no effect'
    );

    return {
      markdown: resultMarkdown,
      success: contentChanged,
      tokenUsage,
      description: object.changesExplained.map(c => c.howFixed).join('; '),
      issuesAddressed: contentChanged ? issuesAddressed : 0,
    };
  } catch (error) {
    log.error(`Section rewrite failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: `Section rewrite failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      issuesAddressed: 0,
    };
  }
}

// Legacy alias for backwards compatibility
export const applyBatchFix = rewriteSectionWithFixes;

/**
 * Smart section fix - delegates to rewriteSectionWithFixes for consistency.
 * 
 * For single issues, we still use the paragraph-rewrite approach
 * because it produces better results than surgical edits.
 */
export async function applySmartFix(
  markdown: string,
  issue: ReviewIssue,
  deps: FixerDeps,
  _ctx?: FixerContext
): Promise<FixResult> {
  const log = deps.logger ?? createPrefixedLogger('[Fixer]');

  // Validate issue has required fields
  if (!issue.location || issue.location === 'global') {
    log.warn('Smart fix requires a specific section location');
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: 'Smart fix requires section location',
    };
  }

  // Delegate to rewriteSectionWithFixes with single issue
  const result = await rewriteSectionWithFixes(markdown, issue.location, [issue], deps);
  
  return {
    markdown: result.markdown,
    success: result.success,
    tokenUsage: result.tokenUsage,
    description: result.description,
  };
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

