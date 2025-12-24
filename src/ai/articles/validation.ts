/**
 * Article Draft Validation
 *
 * Validates generated article drafts for quality, content policy compliance,
 * and structural correctness.
 */

import { z } from 'zod';

import { ARTICLE_PLAN_CONSTRAINTS, ArticleCategorySlugSchema, type ArticlePlan } from './article-plan';
import { countContentH2Sections, getContentH2Sections, stripSourcesSection } from './markdown-utils';
import type { ValidationIssue, ValidationSeverity } from './types';

// ============================================================================
// Configuration
// ============================================================================

/**
 * AI clichés and overused phrases to detect.
 * Articles are generated in English; translation to other languages is a separate process.
 */
export const AI_CLICHES: readonly {
  readonly phrase: string;
  readonly context: string;
}[] = [
  { phrase: 'in conclusion', context: 'conclusion cliché' },
  { phrase: "let's dive into", context: 'conversational filler' },
  { phrase: 'without further ado', context: 'unnecessary preamble' },
  { phrase: "it's worth noting", context: 'hedging phrase' },
  { phrase: 'game-changing', context: 'marketing hyperbole' },
  { phrase: 'truly revolutionary', context: 'marketing hyperbole' },
  { phrase: 'seamlessly', context: 'overused modifier' },
  { phrase: 'unparalleled', context: 'marketing hyperbole' },
  { phrase: 'delve into', context: 'academic formality' },
  { phrase: 'utilize', context: 'unnecessarily formal (use "use")' },
  { phrase: 'at the end of the day', context: 'filler phrase' },
  { phrase: 'needless to say', context: 'redundant phrase' },
  { phrase: 'dive deep', context: 'overused metaphor' },
  { phrase: 'a must-have', context: 'marketing cliché' },
  { phrase: 'stands out', context: 'vague praise' },
];

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
// Validation Constants
// ============================================================================

/**
 * Currency symbols to detect in content (policy violation).
 * Supports major world currencies: USD, EUR, GBP, JPY, INR, KRW, RUB, THB/BTC.
 */
const CURRENCY_PATTERN = /[$€£¥₹₩₽฿]\s*\d+/;

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
    .array(z.string().min(1))
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
 * Validates the basic structure of a draft.
 * Uses constraints from ARTICLE_PLAN_CONSTRAINTS for consistency.
 */
function validateStructure(draft: {
  title: string;
  excerpt: string;
  tags: readonly string[];
  markdown: string;
  sources: readonly string[];
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const C = ARTICLE_PLAN_CONSTRAINTS;

  // Excerpt length
  if (draft.excerpt.length < C.EXCERPT_MIN_LENGTH) {
    issues.push(issue('error', `Excerpt too short: ${draft.excerpt.length} characters (minimum ${C.EXCERPT_MIN_LENGTH})`));
  }
  if (draft.excerpt.length > C.EXCERPT_MAX_LENGTH) {
    issues.push(issue('error', `Excerpt too long: ${draft.excerpt.length} characters (maximum ${C.EXCERPT_MAX_LENGTH})`));
  }

  // Title
  if (!draft.title || draft.title.length < C.TITLE_MIN_LENGTH) {
    issues.push(issue('error', `Title too short or missing (minimum ${C.TITLE_MIN_LENGTH} characters)`));
  }
  if (draft.title.length > C.TITLE_RECOMMENDED_MAX_LENGTH) {
    issues.push(issue('warning', `Title is quite long: ${draft.title.length} characters (recommended: ≤${C.TITLE_RECOMMENDED_MAX_LENGTH})`));
  }

  // Markdown minimum length
  if (draft.markdown.length < C.MIN_MARKDOWN_LENGTH) {
    issues.push(issue('error', `Article content too short: ${draft.markdown.length} characters (minimum ${C.MIN_MARKDOWN_LENGTH})`));
  }

  // Sections
  const sectionCount = countContentH2Sections(draft.markdown);
  if (sectionCount < C.MIN_SECTIONS) {
    issues.push(issue('warning', `Only ${sectionCount} sections found (minimum ${C.MIN_SECTIONS})`));
  }

  // Check for empty sections
  const sections = getContentH2Sections(draft.markdown);
  sections.forEach((section, idx) => {
    const content = section.content.trim();
    if (content.length < C.MIN_SECTION_LENGTH) {
      issues.push(issue('warning', `Section ${idx + 1} appears very short (${content.length} characters, minimum ${C.MIN_SECTION_LENGTH})`));
    }
  });

  // Tags
  if (draft.tags.length < C.MIN_TAGS) {
    issues.push(issue('warning', `Not enough tags: ${draft.tags.length} (minimum ${C.MIN_TAGS})`));
  }
  if (draft.tags.length > C.MAX_TAGS) {
    issues.push(issue('error', `Too many tags: ${draft.tags.length} (maximum ${C.MAX_TAGS})`));
  }

  // Sources
  if (draft.sources.length === 0) {
    issues.push(issue('warning', 'No sources were collected'));
  }

  // Validate source URLs
  draft.sources.forEach((url, idx) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        issues.push(issue('error', `Invalid source URL scheme at index ${idx}: ${url}`));
      }
    } catch {
      issues.push(issue('error', `Invalid source URL at index ${idx}: ${url}`));
    }
  });

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

  // Pricing information (policy violation)
  if (CURRENCY_PATTERN.test(contentMarkdown)) {
    issues.push(issue('warning', 'Article contains pricing information or currency figures (verify policy compliance)'));
  }

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

  // Structure validation
  issues.push(...validateStructure(draft));

  // Content quality validation
  issues.push(...validateContentQuality(draft.markdown));

  return issues;
}

/**
 * Validates GameArticleContext input.
 *
 * @throws Error if context is invalid
 */
export function validateGameArticleContext(context: {
  gameName?: string | null;
  genres?: unknown;
  platforms?: unknown;
  categoryHints?: unknown;
}): void {
  if (!context.gameName?.trim()) {
    throw new Error('GameArticleContext.gameName is required and cannot be empty');
  }

  if (context.genres !== undefined && !Array.isArray(context.genres)) {
    throw new Error('GameArticleContext.genres must be an array');
  }

  if (context.platforms !== undefined && !Array.isArray(context.platforms)) {
    throw new Error('GameArticleContext.platforms must be an array');
  }

  if (context.categoryHints !== undefined) {
    if (!Array.isArray(context.categoryHints)) {
      throw new Error('GameArticleContext.categoryHints must be an array');
    }
    for (const hint of context.categoryHints) {
      if (!hint || typeof hint !== 'object' || !('slug' in hint) || !hint.slug) {
        throw new Error('Each categoryHint must have a slug');
      }
    }
  }
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

