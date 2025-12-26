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
const FIX_STRATEGY_VALUES = ['direct_edit', 'regenerate', 'add_section', 'expand', 'no_action'] as const;

const ReviewIssueSchema = z.object({
  severity: z.enum(['critical', 'major', 'minor']),
  category: z.enum(['redundancy', 'coverage', 'factual', 'style', 'seo']),
  location: z.string().optional(),
  message: z.string(),
  suggestion: z.string().optional(),
  fixStrategy: z.enum(FIX_STRATEGY_VALUES),
  fixInstruction: z.string().optional(),
});

const ReviewerOutputSchema = z.object({
  approved: z.boolean(),
  issues: z.array(ReviewIssueSchema).default([]),
  suggestions: z.array(z.string()).default([]),
});

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
        system: getReviewerSystemPrompt(),
        prompt: getReviewerUserPrompt(promptContext),
      }),
    { context: 'Reviewer analysis', signal: deps.signal }
  );

  // Build token usage (AI SDK v4 uses inputTokens/outputTokens)
  const tokenUsage: TokenUsage = usage
    ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
    : createEmptyTokenUsage();

  const counts = countIssuesBySeverity(object.issues);
  log.info(
    `Review complete: ${object.approved ? 'APPROVED' : 'NEEDS REVISION'} ` +
      `(${counts.critical} critical, ${counts.major} major, ${counts.minor} minor issues)`
  );

  if (object.issues.length > 0) {
    log.debug('Issues found:');
    for (const issue of object.issues) {
      log.debug(`  [${issue.severity}/${issue.category}] ${issue.message}`);
    }
  }

  return {
    approved: object.approved,
    issues: object.issues,
    suggestions: object.suggestions,
    tokenUsage,
  };
}

