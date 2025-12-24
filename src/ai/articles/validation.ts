/**
 * Article Draft Validation
 *
 * Validates generated article drafts for quality, content policy compliance,
 * and structural correctness.
 */

import { z } from 'zod';

import { ARTICLE_PLAN_CONSTRAINTS, type ArticlePlan } from './article-plan';
import { countContentH2Sections, getContentH2Sections, stripSourcesSection } from './markdown-utils';
import type { ValidationIssue, ValidationSeverity } from './types';

// ============================================================================
// Configuration
// ============================================================================

/**
 * AI clichés and overused phrases to detect.
 * Configurable per locale if needed.
 */
export const AI_CLICHES: readonly {
  readonly phrase: string;
  readonly context: string;
  readonly locale?: 'en' | 'es';
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
  // Spanish clichés
  { phrase: 'en conclusión', context: 'conclusion cliché', locale: 'es' },
  { phrase: 'sin más preámbulos', context: 'unnecessary preamble', locale: 'es' },
  { phrase: 'cabe destacar', context: 'hedging phrase', locale: 'es' },
  { phrase: 'revolucionario', context: 'marketing hyperbole', locale: 'es' },
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
 * Supports USD, EUR, GBP, JPY.
 */
const CURRENCY_PATTERN = /[$€£¥]\s*\d+/;

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Schema for validating article draft structure.
 * Uses shared constraints from article-plan.ts.
 */
export const GameArticleDraftSchema = z.object({
  title: z
    .string()
    .min(10, 'Title is too short (minimum 10 characters)')
    .max(ARTICLE_PLAN_CONSTRAINTS.TITLE_MAX_LENGTH, `Title is too long (maximum ${ARTICLE_PLAN_CONSTRAINTS.TITLE_MAX_LENGTH} characters)`),
  categorySlug: z.enum(['news', 'reviews', 'guides', 'lists']),
  excerpt: z
    .string()
    .min(ARTICLE_PLAN_CONSTRAINTS.EXCERPT_MIN_LENGTH, `Excerpt too short (minimum ${ARTICLE_PLAN_CONSTRAINTS.EXCERPT_MIN_LENGTH} characters)`)
    .max(ARTICLE_PLAN_CONSTRAINTS.EXCERPT_MAX_LENGTH, `Excerpt too long (maximum ${ARTICLE_PLAN_CONSTRAINTS.EXCERPT_MAX_LENGTH} characters)`),
  tags: z
    .array(z.string().min(1))
    .min(1, 'At least one tag is required')
    .max(ARTICLE_PLAN_CONSTRAINTS.MAX_TAGS, `Too many tags (maximum ${ARTICLE_PLAN_CONSTRAINTS.MAX_TAGS})`),
  markdown: z.string().min(500, 'Article content too short'),
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
 * Validates the basic structure of a draft using Zod.
 */
function validateStructure(draft: {
  title: string;
  excerpt: string;
  tags: readonly string[];
  markdown: string;
  sources: readonly string[];
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Excerpt length
  if (draft.excerpt.length < 120) {
    issues.push(issue('error', `Excerpt too short: ${draft.excerpt.length} characters (minimum 120)`));
  }
  if (draft.excerpt.length > 160) {
    issues.push(issue('error', `Excerpt too long: ${draft.excerpt.length} characters (maximum 160)`));
  }

  // Title
  if (!draft.title || draft.title.length < 10) {
    issues.push(issue('error', 'Title is too short or missing'));
  }
  if (draft.title.length > 100) {
    issues.push(issue('warning', `Title is quite long: ${draft.title.length} characters (recommended: 50-70)`));
  }

  // Sections
  const sectionCount = countContentH2Sections(draft.markdown);
  if (sectionCount < 3) {
    issues.push(issue('warning', `Only ${sectionCount} sections found (recommended: 4-8)`));
  }

  // Check for empty sections
  const sections = getContentH2Sections(draft.markdown);
  sections.forEach((section, idx) => {
    const content = section.content.trim();
    if (content.length < 100) {
      issues.push(issue('warning', `Section ${idx + 1} appears very short (${content.length} characters)`));
    }
  });

  // Tags
  if (draft.tags.length === 0) {
    issues.push(issue('warning', 'No tags were generated'));
  }
  if (draft.tags.length > 10) {
    issues.push(issue('error', `Too many tags: ${draft.tags.length} (maximum 10)`));
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
 */
function validateContentQuality(markdown: string, locale: 'en' | 'es' = 'en'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const contentMarkdown = stripSourcesSection(markdown);

  // Code fences
  if (contentMarkdown.includes('```')) {
    issues.push(issue('warning', 'Article contains code fences (usually undesirable for prose)'));
  }

  // Pricing information (supports USD, EUR, GBP, JPY)
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

  for (const { phrase, context, locale: clicheLocale } of AI_CLICHES) {
    // Skip locale-specific clichés that don't match
    if (clicheLocale && clicheLocale !== locale) continue;
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
 *
 * @param draft - The draft to validate
 * @param locale - The article locale for language-specific checks
 * @returns Array of validation issues (empty if valid)
 *
 * @example
 * const issues = validateArticleDraft(draft, 'en');
 * const errors = issues.filter(i => i.severity === 'error');
 * if (errors.length > 0) throw new Error(errors.map(e => e.message).join('; '));
 */
export function validateArticleDraft(
  draft: {
    title: string;
    categorySlug: string;
    excerpt: string;
    tags: readonly string[];
    markdown: string;
    sources: readonly string[];
    plan: ArticlePlan;
  },
  locale: 'en' | 'es' = 'en'
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Structure validation
  issues.push(...validateStructure(draft));

  // Content quality validation
  issues.push(...validateContentQuality(draft.markdown, locale));

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

