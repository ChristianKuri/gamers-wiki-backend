/**
 * Reviewer Agent
 *
 * Quality control agent that reviews completed article drafts for:
 * - Redundancy (repeated explanations)
 * - Coverage verification (required elements)
 * - Factual accuracy (against research)
 * - Style consistency (tone, formatting)
 * - SEO basics (title, headings, keywords)
 */

import type { LanguageModel } from 'ai';
import { z } from 'zod';

import { createPrefixedLogger, type Logger } from '../../../utils/logger';
import type { ArticlePlan } from '../article-plan';
import { REVIEWER_CONFIG } from '../config';
import { withRetry } from '../retry';
import {
  buildResearchSummaryForReview,
  getReviewerSystemPrompt,
  getReviewerUserPrompt,
} from '../prompts/reviewer-prompts';
import {
  createEmptyTokenUsage,
  type FixStrategy,
  type ScoutOutput,
  type TokenUsage,
} from '../types';

// Re-export config for backwards compatibility
export { REVIEWER_CONFIG } from '../config';

// ============================================================================
// Types
// ============================================================================

/**
 * Severity level for review issues.
 */
export type ReviewIssueSeverity = 'critical' | 'major' | 'minor';

/**
 * Category of review issue.
 */
export type ReviewIssueCategory = 'redundancy' | 'coverage' | 'factual' | 'style' | 'seo';

/**
 * A single issue identified by the Reviewer.
 */
export interface ReviewIssue {
  readonly severity: ReviewIssueSeverity;
  readonly category: ReviewIssueCategory;
  /** Section headline or "title", "excerpt", etc. */
  readonly location?: string;
  readonly message: string;
  readonly suggestion?: string;
  /**
   * Recommended fix strategy for autonomous recovery.
   * - direct_edit: Minor text replacement (clichés, typos)
   * - regenerate: Rewrite entire section
   * - add_section: Create new section for coverage gaps
   * - expand: Add content to existing section
   * - no_action: Minor issue, skip fixing
   */
  readonly fixStrategy: FixStrategy;
  /**
   * Specific instruction for the Fixer agent.
   * For direct_edit: what text to find and what to replace with
   * For regenerate: feedback on what went wrong and what to improve
   * For add_section: topic and key points to cover
   * For expand: what aspects need more depth
   */
  readonly fixInstruction?: string;
}

/**
 * Output from the Reviewer agent.
 */
export interface ReviewerOutput {
  /** Whether the article is approved for publication */
  readonly approved: boolean;
  /** Issues identified during review */
  readonly issues: readonly ReviewIssue[];
  /** General improvement suggestions */
  readonly suggestions: readonly string[];
  /** Token usage for Reviewer phase LLM calls */
  readonly tokenUsage: TokenUsage;
}

/**
 * Dependencies for the Reviewer agent.
 */
export interface ReviewerDeps {
  readonly generateObject: typeof import('ai').generateObject;
  readonly model: LanguageModel;
  readonly logger?: Logger;
  /** Optional AbortSignal for cancellation support */
  readonly signal?: AbortSignal;
  /** Optional temperature override (default: REVIEWER_CONFIG.TEMPERATURE) */
  readonly temperature?: number;
}

// ============================================================================
// Zod Schema for Reviewer Output
// ============================================================================

/**
 * All valid fix strategy values as a const array.
 * Used to create the Zod enum for AI SDK schema.
 */
const FIX_STRATEGY_VALUES = ['inline_insert', 'direct_edit', 'regenerate', 'add_section', 'expand', 'no_action'] as const;

/**
 * Schema for review issues.
 *
 * Notes:
 * - fixStrategy defaults to 'no_action' if LLM omits it (graceful degradation)
 * - fixInstruction is optional; we validate in filterValidIssues() and filter out
 *   issues with actionable strategies but missing fixInstruction
 *
 * This approach is more resilient than requiring fields and failing when the LLM
 * doesn't comply - instead, we accept the response and handle missing values.
 */
const ReviewIssueBaseSchema = z.object({
  severity: z.enum(['critical', 'major', 'minor']),
  category: z.enum(['checklist', 'structure', 'redundancy', 'coverage', 'factual', 'style', 'seo']),
  location: z.string().optional(),
  message: z.string(),
  suggestion: z.string().optional(),
  // Default to 'no_action' if LLM omits fixStrategy - these get filtered anyway
  fixStrategy: z.enum(FIX_STRATEGY_VALUES).default('no_action'),
  fixInstruction: z.string().optional(),
});

/**
 * Schema for AI SDK generation (uses base schema without refine).
 * AI SDK doesn't support Zod .refine() - validation happens post-generation.
 */
const ReviewerOutputSchema = z.object({
  approved: z.boolean(),
  issues: z.array(ReviewIssueBaseSchema).default([]),
  suggestions: z.array(z.string()).default([]),
});

/**
 * Generates a default fix instruction when the LLM fails to provide one.
 * This prevents important issues (especially checklist failures) from being dropped.
 */
function generateDefaultFixInstruction(issue: z.infer<typeof ReviewIssueBaseSchema>): string {
  const location = issue.location || 'the appropriate section';
  
  // For checklist failures (missing required elements)
  if (issue.category === 'checklist' || issue.message.includes('CHECKLIST FAILURE')) {
    return `Add paragraph in "${location}" covering the missing element. ` +
      `Based on issue: ${issue.message.slice(0, 200)}. ` +
      `Include: name, location, how to obtain/use, and relevance.`;
  }
  
  // For structural issues
  if (issue.category === 'structure') {
    return `Fix structural issue in "${location}": ${issue.message.slice(0, 150)}`;
  }
  
  // For coverage issues (location/detail missing)
  if (issue.category === 'coverage' || issue.fixStrategy === 'inline_insert') {
    return `In section "${location}", add the missing information: ${issue.message.slice(0, 150)}`;
  }
  
  // Default fallback
  return `Fix in "${location}": ${issue.message.slice(0, 150)}`;
}

/**
 * Validates and filters review issues, removing those with invalid fix configurations.
 * Issues without required fixInstruction are logged as warnings and filtered out.
 *
 * @param issues - Raw issues from LLM
 * @param log - Logger instance
 * @returns Filtered array of valid issues
 */
function filterValidIssues(
  issues: z.infer<typeof ReviewIssueBaseSchema>[],
  log: Logger
): ReviewIssue[] {
  const validIssues: ReviewIssue[] = [];
  const skippedCount = { missingFixInstruction: 0, invalidLocation: 0 };

  for (const issue of issues) {
    // Handle issues with actionable strategy but missing fixInstruction
    if (issue.fixStrategy !== 'no_action') {
      if (!issue.fixInstruction || issue.fixInstruction.trim().length === 0) {
        // For critical/major issues (especially checklist), generate a default instruction
        // rather than dropping important issues
        if (issue.severity === 'critical' || issue.severity === 'major') {
          const defaultInstruction = generateDefaultFixInstruction(issue);
          log.warn(
            `Issue missing fixInstruction (generated default): "${issue.message.slice(0, 60)}..." ` +
              `[strategy: ${issue.fixStrategy}]`
          );
          // Mutate to add the generated instruction (the issue is already a plain object from Zod)
          (issue as { fixInstruction: string }).fixInstruction = defaultInstruction;
        } else {
          // For minor issues, skip if no instruction
          log.warn(
            `Skipping minor issue (missing fixInstruction): "${issue.message.slice(0, 60)}..." ` +
              `[strategy: ${issue.fixStrategy}]`
          );
          skippedCount.missingFixInstruction++;
          continue;
        }
      }
    }

    // Skip issues with invalid locations (can't target these)
    const invalidLocations = ['throughout article', 'multiple sections', 'various', 'general'];
    if (
      issue.location &&
      invalidLocations.some((invalid) => issue.location!.toLowerCase().includes(invalid))
    ) {
      log.warn(
        `Skipping issue (invalid location "${issue.location}"): "${issue.message.slice(0, 60)}..."`
      );
      skippedCount.invalidLocation++;
      continue;
    }

    validIssues.push(issue as ReviewIssue);
  }

  if (skippedCount.missingFixInstruction > 0 || skippedCount.invalidLocation > 0) {
    log.info(
      `Filtered out ${skippedCount.missingFixInstruction + skippedCount.invalidLocation} invalid issues ` +
        `(${skippedCount.missingFixInstruction} missing fixInstruction, ${skippedCount.invalidLocation} invalid location)`
    );
  }

  return validIssues;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Truncates article content if too long for review.
 */
function truncateArticleContent(markdown: string, maxLength: number): string {
  if (markdown.length <= maxLength) {
    return markdown;
  }
  return markdown.slice(0, maxLength) + '\n\n...(article truncated for review)';
}

/**
 * Counts issues by severity.
 */
export function countIssuesBySeverity(
  issues: readonly ReviewIssue[]
): { critical: number; major: number; minor: number } {
  return {
    critical: issues.filter((i) => i.severity === 'critical').length,
    major: issues.filter((i) => i.severity === 'major').length,
    minor: issues.filter((i) => i.severity === 'minor').length,
  };
}

/**
 * Determines if the article should be rejected based on issues.
 * An article is rejected if it has any critical issues.
 */
export function shouldRejectArticle(issues: readonly ReviewIssue[]): boolean {
  return issues.some((i) => i.severity === 'critical');
}

/**
 * Gets issues by category.
 */
export function getIssuesByCategory(
  issues: readonly ReviewIssue[],
  category: ReviewIssueCategory
): readonly ReviewIssue[] {
  return issues.filter((i) => i.category === category);
}

// ============================================================================
// Main Reviewer Function
// ============================================================================

/**
 * Runs the Reviewer agent to check article quality.
 *
 * **Cost implications**: This function makes one LLM call using the configured Reviewer model.
 * - Input tokens: Typically 500-2000 tokens (depends on article length and research context)
 * - Output tokens: Typically 100-500 tokens (depends on number of issues found)
 * - Estimated cost: ~$0.001-0.005 USD per review (varies by model pricing)
 *
 * The Reviewer phase adds latency (~2-5 seconds) and cost to article generation,
 * but significantly improves article quality by catching issues before publication.
 *
 * @param markdown - The complete article markdown
 * @param plan - The article plan from Editor
 * @param scoutOutput - Research from Scout agent (for fact-checking)
 * @param deps - Dependencies (generateObject, model)
 * @returns Review output with approval status and issues
 */
export async function runReviewer(
  markdown: string,
  plan: ArticlePlan,
  scoutOutput: ScoutOutput,
  deps: ReviewerDeps
): Promise<ReviewerOutput> {
  const log = deps.logger ?? createPrefixedLogger('[Reviewer]');
  const temperature = deps.temperature ?? REVIEWER_CONFIG.TEMPERATURE;

  log.info(`Starting review for article: "${plan.title}"`);

  // Build context for review
  const truncatedMarkdown = truncateArticleContent(
    markdown,
    REVIEWER_CONFIG.MAX_ARTICLE_CONTENT_LENGTH
  );

  const researchSummary = buildResearchSummaryForReview(
    scoutOutput.briefing.overview,
    scoutOutput.briefing.categoryInsights,
    REVIEWER_CONFIG.MAX_RESEARCH_CONTEXT_LENGTH
  );

  const promptContext = {
    plan,
    markdown: truncatedMarkdown,
    researchSummary,
    categorySlug: plan.categorySlug,
  };

  log.debug('Executing review with AI model...');

  const { object, usage } = await withRetry(
    () =>
      deps.generateObject({
        model: deps.model,
        schema: ReviewerOutputSchema,
        temperature,
        maxOutputTokens: REVIEWER_CONFIG.MAX_OUTPUT_TOKENS,
        system: getReviewerSystemPrompt(plan.categorySlug),
        prompt: getReviewerUserPrompt(promptContext),
      }),
    { context: 'Reviewer analysis', signal: deps.signal }
  );

  // Build token usage (AI SDK v4 uses inputTokens/outputTokens)
  const tokenUsage: TokenUsage = usage
    ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
    : createEmptyTokenUsage();

  // Filter out invalid issues (missing fixInstruction, invalid locations)
  const validIssues = filterValidIssues(object.issues, log);

  const counts = countIssuesBySeverity(validIssues);
  log.info(
    `Review complete: ${object.approved ? 'APPROVED' : 'NEEDS REVISION'} ` +
      `(${counts.critical} critical, ${counts.major} major, ${counts.minor} minor issues)`
  );

  if (validIssues.length > 0) {
    log.debug('Valid issues found:');
    for (const issue of validIssues) {
      log.debug(`  [${issue.severity}/${issue.category}] ${issue.message}`);
    }
  }

  return {
    approved: object.approved,
    issues: validIssues,
    suggestions: object.suggestions,
    tokenUsage,
  };
}

