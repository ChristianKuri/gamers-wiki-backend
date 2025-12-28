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

/**
 * Schema for inline insert output - more targeted than direct edit.
 */
const InlineInsertOutputSchema = z.object({
  originalSentence: z.string().describe('The original sentence that was modified'),
  modifiedSentence: z.string().describe('The sentence with the insertion applied'),
  insertedText: z.string().describe('The exact text that was inserted'),
  explanation: z.string().describe('Brief explanation of what was inserted and where'),
});

/**
 * Schema for expand output - constrained to prevent bloat.
 */
const ExpandOutputSchema = z.object({
  newParagraph: z.string().describe('The single new paragraph to add (max 150 words)'),
  explanation: z.string().describe('Brief explanation of what was added'),
  wordCount: z.number().describe('Word count of the new paragraph'),
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
 * Applies an inline insertion to add words/clauses to existing sentences.
 * This is the most surgical fix strategy - used for adding location context,
 * names, or brief clarifications without restructuring.
 *
 * @param markdown - Current article markdown
 * @param issue - The issue with fixInstruction specifying what to insert where
 * @param deps - Dependencies
 * @returns Fix result with updated markdown
 */
export async function applyInlineInsert(
  markdown: string,
  issue: ReviewIssue,
  deps: FixerDeps
): Promise<FixResult> {
  const log = deps.logger ?? createPrefixedLogger('[Fixer]');
  const temperature = deps.temperature ?? FIXER_CONFIG.TEMPERATURE;

  if (!issue.fixInstruction) {
    log.warn('Inline insert requested but no fixInstruction provided');
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: 'No fix instruction provided',
    };
  }

  // Extract section content if location is specified
  let targetText = markdown;
  let isFullArticle = true;

  if (issue.location && issue.location !== 'global') {
    const sectionContent = getSectionContent(markdown, issue.location);
    if (sectionContent) {
      targetText = sectionContent;
      isFullArticle = false;
    }
  }

  log.debug(`Applying inline insert: ${issue.fixInstruction.slice(0, 100)}...`);

  try {
    const { object, usage } = await withRetry(
      () =>
        deps.generateObject({
          model: deps.model,
          schema: InlineInsertOutputSchema,
          temperature,
          maxOutputTokens: FIXER_CONFIG.MAX_OUTPUT_TOKENS_INLINE_INSERT,
          system: `You are a surgical text editor specializing in MINIMAL insertions.

Your task: Insert a few words or a short clause into an existing sentence WITHOUT rewriting it.

CRITICAL RULES:
1. Insert ONLY the minimum necessary words (typically 2-10 words)
2. DO NOT add new sentences
3. DO NOT add new paragraphs
4. DO NOT restructure the sentence
5. DO NOT add explanations or elaborations
6. Preserve the original sentence structure exactly
7. The insertion should feel natural in context

EXAMPLES:
❌ BAD: Rewrote entire sentence
❌ BAD: Added a new sentence after
❌ BAD: Changed sentence structure
✅ GOOD: "meet Purah" → "meet Purah at Lookout Landing"
✅ GOOD: "the fourth shrine" → "the fourth shrine (Nachoyah Shrine)"
✅ GOOD: "grants you the ability" → "grants you the ability at the Temple of Time"`,
          prompt: `Insert the specified content into the target sentence.

INSERT INSTRUCTION: ${issue.fixInstruction}

TEXT TO SEARCH:
${targetText}

Find the target sentence and insert the required words. Return the original sentence and the modified sentence.`,
        }),
      { context: `Inline insert: ${issue.message.slice(0, 50)}`, signal: deps.signal }
    );

    const tokenUsage: TokenUsage = usage
      ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
      : createEmptyTokenUsage();

    // Validate the insertion is minimal (not a full rewrite)
    const originalWords = object.originalSentence.split(/\s+/).length;
    const modifiedWords = object.modifiedSentence.split(/\s+/).length;
    const addedWords = modifiedWords - originalWords;

    if (addedWords > 20) {
      log.warn(
        `Inline insert rejected: Too many words added (${addedWords}). ` +
          `This suggests a rewrite rather than insertion.`
      );
      return {
        markdown,
        success: false,
        tokenUsage,
        description: 'Insert rejected - added too many words (use expand instead)',
      };
    }

    // Apply the change by replacing the original sentence with the modified one
    let resultMarkdown: string;
    if (isFullArticle) {
      resultMarkdown = markdown.replace(object.originalSentence, object.modifiedSentence);
    } else {
      const modifiedSection = targetText.replace(object.originalSentence, object.modifiedSentence);
      const replaced = replaceSection(markdown, issue.location!, modifiedSection);
      resultMarkdown = replaced ?? markdown;
    }

    // Verify something actually changed
    const success = resultMarkdown !== markdown;

    log.info(
      success
        ? `Inline insert applied: "${object.insertedText}" (+${addedWords} words)`
        : 'Inline insert had no effect'
    );

    return {
      markdown: resultMarkdown,
      success,
      tokenUsage,
      description: object.explanation,
    };
  } catch (error) {
    log.error(`Inline insert failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      markdown,
      success: false,
      tokenUsage: createEmptyTokenUsage(),
      description: `Insert failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

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
          system: `You are a surgical text editor. Your task is to make MINIMAL changes to fix specific issues.

CRITICAL RULES:
1. Apply ONLY the requested edit - do not make other changes
2. Preserve all formatting, structure, and whitespace
3. If the edit cannot be applied (text not found), return the original text unchanged
4. Be SURGICAL - change as little as possible to accomplish the goal
5. DO NOT add new paragraphs unless explicitly requested
6. DO NOT elaborate or expand - just fix the specific issue
7. DO NOT introduce redundancy - if similar content exists elsewhere, don't repeat it

This is for MINOR fixes only:
- Replacing vague terms with specific names
- Fixing typos or clichés
- Correcting factual errors in existing text

For adding new content, use 'expand' or 'inline_insert' instead.`,
          prompt: `Apply this edit to the text below:

EDIT INSTRUCTION: ${issue.fixInstruction}

ORIGINAL TEXT:
${targetText}

Return the edited text with the MINIMAL change applied.`,
        }),
      { context: `Direct edit: ${issue.message.slice(0, 50)}`, signal: deps.signal }
    );

    const tokenUsage: TokenUsage = usage
      ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
      : createEmptyTokenUsage();

    // Safety check: Ensure the edited text is not drastically shorter than the original
    // (which usually indicates a truncation error or hallucination by the LLM)
    const originalLength = targetText.length;
    const editedLength = object.editedText.length;
    const lengthRatio = editedLength / originalLength;

    if (originalLength > 500 && lengthRatio < 0.5) {
      log.warn(
        `Direct edit rejected: Potential truncation detected. ` +
          `(Original: ${originalLength} chars, Edited: ${editedLength} chars, Ratio: ${lengthRatio.toFixed(2)})`
      );
      return {
        markdown,
        success: false,
        tokenUsage,
        description: 'Edit rejected due to suspected truncation',
      };
    }

    // Safety check: Reject if too much content was added (should use expand instead)
    if (editedLength > originalLength * 1.3 && editedLength - originalLength > 200) {
      log.warn(
        `Direct edit rejected: Too much content added. ` +
          `(Original: ${originalLength} chars, Edited: ${editedLength} chars). Use 'expand' instead.`
      );
      return {
        markdown,
        success: false,
        tokenUsage,
        description: 'Edit rejected - too much content added (use expand instead)',
      };
    }

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
 * Extracts key phrases from text for redundancy detection.
 */
function extractKeyPhrases(text: string): Set<string> {
  // Extract significant phrases (3+ consecutive words)
  const phrases = new Set<string>();
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
  
  for (let i = 0; i < words.length - 2; i++) {
    const phrase = words.slice(i, i + 3).join(' ');
    if (phrase.length > 10) { // Ignore very short phrases
      phrases.add(phrase);
    }
  }
  
  return phrases;
}

/**
 * Checks if new content is too similar to existing content.
 * Returns true if redundancy is detected.
 */
function detectRedundancy(existingContent: string, newContent: string): boolean {
  const existingPhrases = extractKeyPhrases(existingContent);
  const newPhrases = extractKeyPhrases(newContent);
  
  let matchCount = 0;
  for (const phrase of newPhrases) {
    if (existingPhrases.has(phrase)) {
      matchCount++;
    }
  }
  
  // If more than 30% of new phrases already exist, it's redundant
  const redundancyRatio = newPhrases.size > 0 ? matchCount / newPhrases.size : 0;
  return redundancyRatio > 0.3;
}

/**
 * Expands an existing section with ONE focused paragraph.
 * Constrained to prevent bloat and redundancy.
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

  // Get other sections for redundancy awareness
  const otherSections = parseMarkdownH2Sections(markdown)
    .filter((s) => s.heading.toLowerCase() !== issue.location!.toLowerCase() && !isSourcesSectionHeading(s.heading))
    .map((s) => s.content)
    .join('\n');

  try {
    const { object, usage } = await withRetry(
      () =>
        deps.generateObject({
          model: deps.model,
          schema: ExpandOutputSchema,
          temperature,
          maxOutputTokens: FIXER_CONFIG.MAX_OUTPUT_TOKENS_EXPAND,
          system: `You are a gaming content specialist adding ONE focused paragraph to an article section.

CRITICAL CONSTRAINTS:
1. Write ONLY ONE paragraph (3-5 sentences max)
2. Maximum ${FIXER_CONFIG.MAX_EXPAND_WORDS} words
3. Address ONLY the specific expansion request
4. DO NOT repeat information from the existing content
5. DO NOT repeat information from other sections (provided below)
6. DO NOT add generic filler or padding
7. Every sentence must add NEW, SPECIFIC information

REDUNDANCY CHECK:
Before writing, scan the existing content. If the requested information is ALREADY covered (even partially), write a minimal clarification instead of a full paragraph.

FORMAT:
Return ONLY the new paragraph text - do not include the existing content.`,
          prompt: `Add ONE focused paragraph to this section.

GAME: ${ctx.gameContext.gameName}
SECTION: ${issue.location}
${sectionPlan ? `SECTION GOAL: ${sectionPlan.goal}` : ''}

EXPANSION REQUEST: ${expansionInstruction}

=== EXISTING SECTION CONTENT (DO NOT REPEAT) ===
${existingContent}

=== OTHER SECTIONS (DO NOT REPEAT) ===
${otherSections.slice(0, 2000)}

Write ONE paragraph (max ${FIXER_CONFIG.MAX_EXPAND_WORDS} words) that addresses the expansion request with NEW information only.`,
        }),
      { context: `Expand section "${issue.location}"`, signal: deps.signal }
    );

    const tokenUsage: TokenUsage = usage
      ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
      : createEmptyTokenUsage();

    // Validate word count
    if (object.wordCount > FIXER_CONFIG.MAX_EXPAND_WORDS * 1.5) {
      log.warn(
        `Expansion rejected: Too many words (${object.wordCount} > ${FIXER_CONFIG.MAX_EXPAND_WORDS})`
      );
      return {
        markdown,
        success: false,
        tokenUsage,
        description: `Expansion rejected - exceeded word limit (${object.wordCount} words)`,
      };
    }

    // Check for redundancy
    if (detectRedundancy(existingContent + '\n' + otherSections, object.newParagraph)) {
      log.warn('Expansion rejected: New content is too similar to existing content');
      return {
        markdown,
        success: false,
        tokenUsage,
        description: 'Expansion rejected - redundant with existing content',
      };
    }

    // Append the new paragraph to the existing content
    const expandedContent = existingContent.trim() + '\n\n' + object.newParagraph.trim();

    // Replace the section with expanded content
    const newMarkdown = replaceSection(markdown, issue.location, expandedContent);

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
    const addedChars = newMarkdown.length - markdown.length;

    log.info(
      success
        ? `Section "${issue.location}" expanded (+${addedChars} chars, ${object.wordCount} words)`
        : 'Expansion did not add content'
    );

    return {
      markdown: newMarkdown,
      success,
      tokenUsage,
      description: `Expanded section "${issue.location}" with ${object.wordCount} words: ${object.explanation}`,
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
    case 'inline_insert':
      return applyInlineInsert(markdown, issue, deps);

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

