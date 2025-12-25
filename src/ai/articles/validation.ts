/**
 * Article Draft Validation
 *
 * Validates generated article drafts for quality, content policy compliance,
 * and structural correctness.
 */

import { z } from 'zod';

import { ArticleCategorySlugSchema, type ArticlePlan } from './article-plan';
import { ARTICLE_PLAN_CONSTRAINTS } from './config';
import aiClichesData from './data/ai-cliches.json';
import { countContentH2Sections, getContentH2Sections, stripSourcesSection } from './markdown-utils';
import type { ValidationIssue, ValidationSeverity } from './types';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Type for AI cliché entries.
 */
export interface AICliche {
  readonly phrase: string;
  readonly context: string;
}

/**
 * AI clichés and overused phrases to detect.
 * Loaded from external JSON file for easy maintenance.
 * Articles are generated in English; translation to other languages is a separate process.
 */
export const AI_CLICHES: readonly AICliche[] = aiClichesData.cliches as AICliche[];

/**
 * Placeholder text that should never appear in published content.
 */
export const PLACEHOLDER_PATTERNS = ['TODO', 'TBD', 'PLACEHOLDER', 'FIXME', '[INSERT', 'XXX'];

/**
 * Common words that are expected to repeat at sentence starts.
 */
export const ALLOWED_SENTENCE_START_REPEATS = new Set([
  'the',
  'a',
  'an',
  'this',
  'that',
  'it',
  'and',
  'but',
  'or',
  'if',
  'as',
  'in',
  'on',
  'for',
  'to',
  'with',
]);


// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Schema for validating article draft structure.
 * Uses shared constraints from article-plan.ts for consistency.
 */
export const GameArticleDraftSchema = z.object({
  title: z
    .string()
    .min(ARTICLE_PLAN_CONSTRAINTS.TITLE_MIN_LENGTH, `Title too short (minimum ${ARTICLE_PLAN_CONSTRAINTS.TITLE_MIN_LENGTH} characters)`)
    .max(ARTICLE_PLAN_CONSTRAINTS.TITLE_MAX_LENGTH, `Title too long (maximum ${ARTICLE_PLAN_CONSTRAINTS.TITLE_MAX_LENGTH} characters)`),
  categorySlug: ArticleCategorySlugSchema,
  excerpt: z
    .string()
    .min(ARTICLE_PLAN_CONSTRAINTS.EXCERPT_MIN_LENGTH, `Excerpt too short (minimum ${ARTICLE_PLAN_CONSTRAINTS.EXCERPT_MIN_LENGTH} characters)`)
    .max(ARTICLE_PLAN_CONSTRAINTS.EXCERPT_MAX_LENGTH, `Excerpt too long (maximum ${ARTICLE_PLAN_CONSTRAINTS.EXCERPT_MAX_LENGTH} characters)`),
  tags: z
    .array(
      z.string()
        .min(1)
        .regex(/\S/, 'Tag cannot be whitespace only')
        .max(ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH, `Tag too long (maximum ${ARTICLE_PLAN_CONSTRAINTS.TAG_MAX_LENGTH} characters)`)
    )
    .min(ARTICLE_PLAN_CONSTRAINTS.MIN_TAGS, `At least ${ARTICLE_PLAN_CONSTRAINTS.MIN_TAGS} tag required`)
    .max(ARTICLE_PLAN_CONSTRAINTS.MAX_TAGS, `Too many tags (maximum ${ARTICLE_PLAN_CONSTRAINTS.MAX_TAGS})`),
  markdown: z.string().min(ARTICLE_PLAN_CONSTRAINTS.MIN_MARKDOWN_LENGTH, `Article content too short (minimum ${ARTICLE_PLAN_CONSTRAINTS.MIN_MARKDOWN_LENGTH} characters)`),
  sources: z.array(z.string().url('Invalid source URL')),
});

export type GameArticleDraftValidation = z.infer<typeof GameArticleDraftSchema>;

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Creates a validation issue.
 */
function issue(severity: ValidationSeverity, message: string): ValidationIssue {
  return { severity, message };
}

/**
 * Converts Zod errors to ValidationIssue array.
 * All Zod errors are treated as 'error' severity.
 */
function zodErrorsToIssues(zodError: z.ZodError): ValidationIssue[] {
  return zodError.issues.map((err) => {
    const path = err.path.length > 0 ? `${err.path.join('.')}: ` : '';
    return issue('error', `${path}${err.message}`);
  });
}

/**
 * Validates the basic structure of a draft using Zod schema.
 * Returns errors from schema validation.
 */
function validateStructureWithSchema(draft: {
  title: string;
  categorySlug: string;
  excerpt: string;
  tags: readonly string[];
  markdown: string;
  sources: readonly string[];
}): ValidationIssue[] {
  // Use Zod schema for structural validation (errors)
  const result = GameArticleDraftSchema.safeParse({
    ...draft,
    tags: [...draft.tags], // Convert readonly to mutable for Zod
    sources: [...draft.sources],
  });

  if (result.success) {
    return [];
  }

  // result.error is guaranteed to be ZodError when success is false
  return zodErrorsToIssues(result.error);
}

/**
 * Validates advisory/warning-level concerns that Zod can't express.
 * These are recommendations, not hard failures.
 */
function validateStructureWarnings(draft: {
  title: string;
  tags: readonly string[];
  markdown: string;
  sources: readonly string[];
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const C = ARTICLE_PLAN_CONSTRAINTS;

  // Title length recommendation (warning, not error)
  if (draft.title.length > C.TITLE_RECOMMENDED_MAX_LENGTH) {
    issues.push(issue('warning', `Title is quite long: ${draft.title.length} characters (recommended: ≤${C.TITLE_RECOMMENDED_MAX_LENGTH})`));
  }

  // Section count check (warning)
  const sectionCount = countContentH2Sections(draft.markdown);
  if (sectionCount < C.MIN_SECTIONS) {
    issues.push(issue('warning', `Only ${sectionCount} sections found (minimum ${C.MIN_SECTIONS})`));
  }

  // Check for short sections (warning)
  const sections = getContentH2Sections(draft.markdown);
  sections.forEach((section, idx) => {
    const content = section.content.trim();
    if (content.length < C.MIN_SECTION_LENGTH) {
      issues.push(issue('warning', `Section ${idx + 1} appears very short (${content.length} characters, minimum ${C.MIN_SECTION_LENGTH})`));
    }
  });

  // Tag count minimum (warning - having few tags is not fatal)
  if (draft.tags.length < C.MIN_TAGS) {
    issues.push(issue('warning', `Not enough tags: ${draft.tags.length} (minimum ${C.MIN_TAGS})`));
  }

  // No sources (warning)
  if (draft.sources.length === 0) {
    issues.push(issue('warning', 'No sources were collected'));
  }

  return issues;
}

/**
 * Validates that required elements from the plan are covered in the article.
 * Uses fuzzy matching to detect coverage - an element is considered covered
 * if its key terms appear in the markdown content.
 *
 * @param plan - The article plan with requiredElements
 * @param markdown - The generated markdown content
 * @returns Array of validation issues (warnings for missing elements)
 */
function validateRequiredElements(
  plan: ArticlePlan,
  markdown: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!plan.requiredElements || plan.requiredElements.length === 0) {
    return issues;
  }

  const lowercaseMarkdown = markdown.toLowerCase();
  const contentMarkdown = stripSourcesSection(lowercaseMarkdown);

  const missingElements: string[] = [];

  for (const element of plan.requiredElements) {
    // Extract key terms from the element (split on spaces, filter short words)
    const keyTerms = element
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 3); // Skip short words like "the", "and", etc.

    // An element is considered covered if at least one significant term appears
    // or if the full element phrase appears
    const fullMatch = contentMarkdown.includes(element.toLowerCase());
    const termMatch = keyTerms.length > 0 && keyTerms.some((term) => contentMarkdown.includes(term));

    if (!fullMatch && !termMatch) {
      missingElements.push(element);
    }
  }

  if (missingElements.length > 0) {
    issues.push(
      issue(
        'warning',
        `Article may be missing required elements: ${missingElements.join(', ')}. ` +
          `These were identified by the Editor as important topics to cover.`
      )
    );
  }

  return issues;
}

/**
 * Validates content quality and checks for common issues.
 * Articles are always generated in English; translation is a separate process.
 */
function validateContentQuality(markdown: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const contentMarkdown = stripSourcesSection(markdown);

  // Code fences
  if (contentMarkdown.includes('```')) {
    issues.push(issue('warning', 'Article contains code fences (usually undesirable for prose)'));
  }

  // Note: Price mentions (launch prices, sales, historical prices) are allowed.
  // We only avoid displaying dynamic "current prices" on the platform itself,
  // but mentioning prices in article content is fine.

  // Placeholder text
  for (const placeholder of PLACEHOLDER_PATTERNS) {
    const re = new RegExp(`\\b${placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(contentMarkdown)) {
      issues.push(issue('error', `Article contains placeholder text: ${placeholder}`));
    }
  }

  // AI clichés
  const lowercaseMarkdown = contentMarkdown.toLowerCase();
  const foundCliches: string[] = [];

  for (const { phrase, context } of AI_CLICHES) {
    if (lowercaseMarkdown.includes(phrase)) {
      foundCliches.push(`"${phrase}" (${context})`);
    }
  }

  if (foundCliches.length > 0) {
    issues.push(
      issue('warning', `Article contains ${foundCliches.length} AI cliché(s): ${foundCliches.join(', ')}`)
    );
  }

  // Repetitive sentence starts
  const sentences = contentMarkdown
    .split(/[.!?]+/)
    .map((s) => s.trim().split(/\s+/)[0]?.toLowerCase())
    .filter((word): word is string => Boolean(word && word.length > 2));

  const startCounts = new Map<string, number>();
  for (const start of sentences) {
    startCounts.set(start, (startCounts.get(start) ?? 0) + 1);
  }

  const repetitiveStarts: string[] = [];
  startCounts.forEach((count, word) => {
    if (count > 6 && !ALLOWED_SENTENCE_START_REPEATS.has(word)) {
      repetitiveStarts.push(`"${word}" (${count}x)`);
    }
  });

  if (repetitiveStarts.length > 0) {
    issues.push(issue('warning', `Repetitive sentence starts detected: ${repetitiveStarts.join(', ')}`));
  }

  return issues;
}

// ============================================================================
// Main Validation Function
// ============================================================================

/**
 * Validates an article draft comprehensively.
 * Articles are always generated in English; translation to other languages is a separate process.
 *
 * Uses Zod schema for structural validation (hard errors), plus manual checks
 * for warnings (advisory issues that don't block publication).
 *
 * @param draft - The draft to validate
 * @returns Array of validation issues (empty if valid)
 *
 * @example
 * const issues = validateArticleDraft(draft);
 * const errors = getErrors(issues);
 * if (errors.length > 0) throw new Error(errors.map(e => e.message).join('; '));
 */
export function validateArticleDraft(draft: {
  title: string;
  categorySlug: string;
  excerpt: string;
  tags: readonly string[];
  markdown: string;
  sources: readonly string[];
  plan: ArticlePlan;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Zod schema validation (errors)
  issues.push(...validateStructureWithSchema(draft));

  // Warning-level structural checks
  issues.push(...validateStructureWarnings(draft));

  // Content quality validation
  issues.push(...validateContentQuality(draft.markdown));

  // Required elements coverage validation
  issues.push(...validateRequiredElements(draft.plan, draft.markdown));

  return issues;
}

/**
 * Validates an article plan before passing to the Specialist agent.
 * Catches malformed plans early to avoid wasting expensive API calls.
 *
 * @param plan - The article plan to validate
 * @returns Array of validation issues (empty if valid)
 *
 * @example
 * const issues = validateArticlePlan(plan);
 * const errors = getErrors(issues);
 * if (errors.length > 0) {
 *   throw new ArticleGenerationError('EDITOR_FAILED', errors.map(e => e.message).join('; '));
 * }
 */
export function validateArticlePlan(plan: ArticlePlan): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const C = ARTICLE_PLAN_CONSTRAINTS;

  // Validate section count
  if (plan.sections.length < C.MIN_SECTIONS) {
    issues.push(issue('error', `Plan has only ${plan.sections.length} sections (minimum ${C.MIN_SECTIONS})`));
  }
  if (plan.sections.length > C.MAX_SECTIONS) {
    issues.push(issue('error', `Plan has ${plan.sections.length} sections (maximum ${C.MAX_SECTIONS})`));
  }

  // Validate section headlines are unique
  const headlineSet = new Set<string>();
  const duplicateHeadlines: string[] = [];
  for (const section of plan.sections) {
    const normalizedHeadline = section.headline.trim().toLowerCase();
    if (headlineSet.has(normalizedHeadline)) {
      duplicateHeadlines.push(section.headline);
    }
    headlineSet.add(normalizedHeadline);
  }
  if (duplicateHeadlines.length > 0) {
    issues.push(issue('error', `Duplicate section headlines: ${duplicateHeadlines.join(', ')}`));
  }

  // Validate each section has non-empty content
  plan.sections.forEach((section, idx) => {
    // Check for empty headline
    if (!section.headline.trim()) {
      issues.push(issue('error', `Section ${idx + 1} has an empty headline`));
    }

    // Check for empty goal
    if (!section.goal.trim()) {
      issues.push(issue('error', `Section ${idx + 1} "${section.headline}" has an empty goal`));
    }

    // Check for research queries
    if (section.researchQueries.length < C.MIN_RESEARCH_QUERIES_PER_SECTION) {
      issues.push(
        issue(
          'error',
          `Section ${idx + 1} "${section.headline}" has only ${section.researchQueries.length} research queries ` +
            `(minimum ${C.MIN_RESEARCH_QUERIES_PER_SECTION})`
        )
      );
    }

    // Check for empty research queries
    const emptyQueries = section.researchQueries.filter((q) => !q.trim());
    if (emptyQueries.length > 0) {
      issues.push(issue('error', `Section ${idx + 1} "${section.headline}" has ${emptyQueries.length} empty research query(ies)`));
    }
  });

  // Validate title doesn't duplicate a section headline
  const titleNormalized = plan.title.trim().toLowerCase();
  for (const section of plan.sections) {
    if (section.headline.trim().toLowerCase() === titleNormalized) {
      issues.push(issue('warning', `Article title duplicates section headline: "${section.headline}"`));
      break;
    }
  }

  // Validate tags
  if (plan.tags.length < C.MIN_TAGS) {
    issues.push(issue('error', `Plan has only ${plan.tags.length} tags (minimum ${C.MIN_TAGS})`));
  }
  const emptyTags = plan.tags.filter((t) => !t.trim());
  if (emptyTags.length > 0) {
    issues.push(issue('error', `Plan has ${emptyTags.length} empty tag(s)`));
  }

  return issues;
}

/**
 * Validates GameArticleContext input.
 * Returns validation issues instead of throwing for consistency with validateArticleDraft.
 *
 * @param context - The context to validate
 * @returns Array of validation issues (empty if valid)
 *
 * @example
 * const issues = validateGameArticleContext(context);
 * const errors = getErrors(issues);
 * if (errors.length > 0) {
 *   throw new ArticleGenerationError('CONTEXT_INVALID', errors.map(e => e.message).join('; '));
 * }
 */
export function validateGameArticleContext(context: {
  gameName?: string | null;
  genres?: unknown;
  platforms?: unknown;
  categoryHints?: unknown;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!context.gameName?.trim()) {
    issues.push(issue('error', 'gameName is required and cannot be empty'));
  }

  if (context.genres !== undefined && !Array.isArray(context.genres)) {
    issues.push(issue('error', 'genres must be an array'));
  }

  if (context.platforms !== undefined && !Array.isArray(context.platforms)) {
    issues.push(issue('error', 'platforms must be an array'));
  }

  if (context.categoryHints !== undefined) {
    if (!Array.isArray(context.categoryHints)) {
      issues.push(issue('error', 'categoryHints must be an array'));
    } else {
      for (let i = 0; i < context.categoryHints.length; i++) {
        const hint = context.categoryHints[i];
        if (!hint || typeof hint !== 'object' || !('slug' in hint) || !hint.slug) {
          issues.push(issue('error', `categoryHints[${i}] must have a slug`));
        }
      }
    }
  }

  return issues;
}

/**
 * Filters validation issues by severity.
 */
export function getErrors(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.filter((i) => i.severity === 'error');
}

/**
 * Filters validation issues by severity.
 */
export function getWarnings(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.filter((i) => i.severity === 'warning');
}

