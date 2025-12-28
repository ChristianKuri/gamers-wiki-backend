/**
 * Article Draft Validation
 *
 * Validates generated article drafts for quality, content policy compliance,
 * and structural correctness.
 */

import { z } from 'zod';

import { ArticleCategorySlugSchema, type ArticlePlan } from './article-plan';
import { ARTICLE_PLAN_CONSTRAINTS, SEO_CONSTRAINTS } from './config';
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

/**
 * Gaming-specific terms that are valid in gaming context but might
 * otherwise be flagged as clichés.
 *
 * These terms are commonly used literally in gaming articles:
 * - "unlock" → you literally unlock abilities, characters, items
 * - "level up" → core RPG/gaming mechanic
 * - "power up" → collectibles that enhance abilities
 * - "dive into" → can refer to actual diving mechanics in games
 *
 * When these patterns are found near the flagged cliché, we skip the warning.
 */
export const GAMING_CONTEXT_EXCEPTIONS: ReadonlyMap<string, readonly string[]> = new Map([
  // "unlock" is valid when talking about unlocking game content
  ['unlock', ['ability', 'skill', 'character', 'item', 'weapon', 'level', 'area', 'mode', 'achievement', 'trophy', 'content', 'feature', 'power', 'upgrade']],
  // "level up" is a core gaming mechanic
  ['level up', ['character', 'stats', 'experience', 'xp', 'skill', 'ability']],
  // "power up" refers to actual power-ups in games
  ['power up', ['item', 'collectible', 'boost', 'enhancement', 'mushroom', 'star']],
  // "dive into" can be literal in some games
  ['dive into', ['water', 'pool', 'ocean', 'lake', 'combat', 'battle']],
  // "stands out" is sometimes necessary for comparisons
  ['stands out', ['gameplay', 'mechanic', 'feature', 'combat', 'graphics', 'design']],
]);

/**
 * Checks if a cliché phrase should be skipped because it appears
 * in a valid gaming context.
 *
 * @param phrase - The cliché phrase that was matched
 * @param markdown - The full markdown content (lowercase)
 * @returns true if the phrase should be skipped (valid gaming context)
 */
function isValidGamingContext(phrase: string, markdown: string): boolean {
  // Check if this phrase has gaming exceptions
  const gamingTerms = GAMING_CONTEXT_EXCEPTIONS.get(phrase.toLowerCase());
  if (!gamingTerms) return false;

  // Find all occurrences of the phrase and check context around each
  const phraseRegex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  let match;

  while ((match = phraseRegex.exec(markdown)) !== null) {
    const start = Math.max(0, match.index - 50);
    const end = Math.min(markdown.length, match.index + phrase.length + 50);
    const context = markdown.slice(start, end).toLowerCase();

    // If ANY gaming term appears near this occurrence, it's valid
    const hasGamingContext = gamingTerms.some((term) => context.includes(term));
    if (hasGamingContext) {
      return true;
    }
  }

  return false;
}


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

  // AI clichés (with gaming context exceptions)
  const lowercaseMarkdown = contentMarkdown.toLowerCase();
  const foundCliches: string[] = [];

  for (const { phrase, context } of AI_CLICHES) {
    if (lowercaseMarkdown.includes(phrase)) {
      // Skip if this phrase is valid in gaming context
      if (isValidGamingContext(phrase, lowercaseMarkdown)) {
        continue;
      }
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
// Token Repetition Detection (LLM Failure Mode)
// ============================================================================

/**
 * Configuration for repetitive text detection.
 */
const REPETITION_CONFIG = {
  /** Minimum string length to check for repetition */
  MIN_LENGTH_TO_CHECK: 100,
  /** Minimum pattern length to detect (e.g., "ede" = 3 chars) */
  MIN_PATTERN_LENGTH: 2,
  /** Maximum pattern length to check */
  MAX_PATTERN_LENGTH: 10,
  /** Minimum consecutive repetitions to flag as corrupted */
  MIN_REPETITIONS: 15,
  /** Ratio of repeated pattern length to total string length that indicates corruption */
  CORRUPTION_RATIO_THRESHOLD: 0.3,
} as const;

/**
 * Detects if a string contains corrupted repetitive patterns.
 * This catches a common LLM failure mode where the model gets stuck
 * generating the same tokens repeatedly (e.g., "ededededededede...").
 *
 * @param text - The text to check
 * @returns Object with `isCorrupted` flag and optional `pattern` that was detected
 *
 * @example
 * detectRepetitiveText("normal text") // { isCorrupted: false }
 * detectRepetitiveText("normalededededededede...") // { isCorrupted: true, pattern: "ede", repetitions: 50 }
 */
export function detectRepetitiveText(text: string): {
  isCorrupted: boolean;
  pattern?: string;
  repetitions?: number;
} {
  if (text.length < REPETITION_CONFIG.MIN_LENGTH_TO_CHECK) {
    return { isCorrupted: false };
  }

  // Check for patterns of various lengths (2-10 chars)
  for (let patternLen = REPETITION_CONFIG.MIN_PATTERN_LENGTH; patternLen <= REPETITION_CONFIG.MAX_PATTERN_LENGTH; patternLen++) {
    // Slide through the string looking for repeated patterns
    for (let startPos = 0; startPos < text.length - patternLen * REPETITION_CONFIG.MIN_REPETITIONS; startPos++) {
      const pattern = text.slice(startPos, startPos + patternLen);

      // Skip patterns that are just whitespace or single repeated char
      if (/^\s+$/.test(pattern)) continue;
      if (pattern.length > 1 && new Set(pattern).size === 1) {
        // Single char repeated (e.g., "aaa") - check as single char pattern
        continue;
      }

      // Count consecutive repetitions of this pattern
      let repetitions = 0;
      let checkPos = startPos;
      while (checkPos + patternLen <= text.length) {
        if (text.slice(checkPos, checkPos + patternLen) === pattern) {
          repetitions++;
          checkPos += patternLen;
        } else {
          break;
        }
      }

      // Check if this is suspicious
      const repeatedLength = repetitions * patternLen;
      const ratio = repeatedLength / text.length;

      if (repetitions >= REPETITION_CONFIG.MIN_REPETITIONS && ratio >= REPETITION_CONFIG.CORRUPTION_RATIO_THRESHOLD) {
        return {
          isCorrupted: true,
          pattern,
          repetitions,
        };
      }
    }
  }

  // Also check for single character repetition (e.g., "eeeeeeeeee")
  const charCounts = new Map<string, number>();
  for (const char of text) {
    charCounts.set(char, (charCounts.get(char) ?? 0) + 1);
  }

  for (const [char, count] of charCounts) {
    // If a single non-space character makes up >50% of the text, it's likely corrupted
    if (char !== ' ' && char !== '\n' && count / text.length > 0.5) {
      return {
        isCorrupted: true,
        pattern: char,
        repetitions: count,
      };
    }
  }

  return { isCorrupted: false };
}

/**
 * Checks all string fields in an article plan for token repetition corruption.
 * Returns the first corrupted field found, or null if none.
 *
 * @param plan - The article plan to check
 * @returns Object with field path and corruption details, or null if clean
 */
export function findCorruptedPlanField(plan: {
  title: string;
  excerpt: string;
  tags: readonly string[];
  sections: readonly { headline: string; goal: string; researchQueries: readonly string[]; mustCover: readonly string[] }[];
  requiredElements?: readonly string[];
}): { field: string; pattern: string; repetitions: number } | null {
  // Check title
  const titleCheck = detectRepetitiveText(plan.title);
  if (titleCheck.isCorrupted) {
    return { field: 'title', pattern: titleCheck.pattern!, repetitions: titleCheck.repetitions! };
  }

  // Check excerpt
  const excerptCheck = detectRepetitiveText(plan.excerpt);
  if (excerptCheck.isCorrupted) {
    return { field: 'excerpt', pattern: excerptCheck.pattern!, repetitions: excerptCheck.repetitions! };
  }

  // Check tags
  for (let i = 0; i < plan.tags.length; i++) {
    const tagCheck = detectRepetitiveText(plan.tags[i]);
    if (tagCheck.isCorrupted) {
      return { field: `tags[${i}]`, pattern: tagCheck.pattern!, repetitions: tagCheck.repetitions! };
    }
  }

  // Check required elements
  if (plan.requiredElements) {
    for (let i = 0; i < plan.requiredElements.length; i++) {
      const elementCheck = detectRepetitiveText(plan.requiredElements[i]);
      if (elementCheck.isCorrupted) {
        return { field: `requiredElements[${i}]`, pattern: elementCheck.pattern!, repetitions: elementCheck.repetitions! };
      }
    }
  }

  // Check sections
  for (let i = 0; i < plan.sections.length; i++) {
    const section = plan.sections[i];

    const headlineCheck = detectRepetitiveText(section.headline);
    if (headlineCheck.isCorrupted) {
      return { field: `sections[${i}].headline`, pattern: headlineCheck.pattern!, repetitions: headlineCheck.repetitions! };
    }

    const goalCheck = detectRepetitiveText(section.goal);
    if (goalCheck.isCorrupted) {
      return { field: `sections[${i}].goal`, pattern: goalCheck.pattern!, repetitions: goalCheck.repetitions! };
    }

    for (let j = 0; j < section.researchQueries.length; j++) {
      const queryCheck = detectRepetitiveText(section.researchQueries[j]);
      if (queryCheck.isCorrupted) {
        return { field: `sections[${i}].researchQueries[${j}]`, pattern: queryCheck.pattern!, repetitions: queryCheck.repetitions! };
      }
    }

    for (let j = 0; j < section.mustCover.length; j++) {
      const mustCoverCheck = detectRepetitiveText(section.mustCover[j]);
      if (mustCoverCheck.isCorrupted) {
        return { field: `sections[${i}].mustCover[${j}]`, pattern: mustCoverCheck.pattern!, repetitions: mustCoverCheck.repetitions! };
      }
    }
  }

  return null;
}

// ============================================================================
// Content Deduplication
// ============================================================================

/**
 * Threshold for section overlap detection.
 * Sections with Jaccard similarity above this are flagged.
 */
const SECTION_OVERLAP_THRESHOLD = 0.4; // 40% term overlap

/**
 * Minimum number of key terms for meaningful overlap comparison.
 * Sections with fewer terms than this are skipped.
 */
const MIN_TERMS_FOR_COMPARISON = 3;

/**
 * Extracts key terms from section content for overlap detection.
 * Focuses on bolded terms (marked with **) and capitalized proper nouns,
 * as these represent the main concepts of each section.
 *
 * @param content - The section content (markdown)
 * @returns Set of lowercase key terms
 */
function extractKeyTerms(content: string): Set<string> {
  const terms = new Set<string>();

  // Extract bolded terms (these are the key concepts marked by the Specialist)
  const boldedMatches = content.match(/\*\*([^*]+)\*\*/g);
  if (boldedMatches) {
    for (const match of boldedMatches) {
      const term = match.replace(/\*\*/g, '').toLowerCase().trim();
      if (term.length > 2) {
        terms.add(term);
      }
    }
  }

  // Extract capitalized multi-word proper nouns (e.g., "Great Sky Island", "Temple of Time")
  const properNounMatches = content.match(/[A-Z][a-z]+(?:\s+(?:of|the|and|in|on|at|to)\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g);
  if (properNounMatches) {
    for (const match of properNounMatches) {
      const term = match.toLowerCase().trim();
      if (term.length > 3) {
        terms.add(term);
      }
    }
  }

  return terms;
}

/**
 * Calculates Jaccard similarity between two sets.
 * Returns a value between 0 (no overlap) and 1 (identical sets).
 *
 * @param setA - First set of terms
 * @param setB - Second set of terms
 * @returns Jaccard similarity coefficient
 */
function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;

  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  return intersection.size / union.size;
}

/**
 * Gets the overlapping terms between two sets.
 *
 * @param setA - First set of terms
 * @param setB - Second set of terms
 * @returns Array of overlapping terms
 */
function getOverlappingTerms(setA: Set<string>, setB: Set<string>): string[] {
  return [...setA].filter((x) => setB.has(x));
}

/**
 * Validates that the generated markdown section count matches the plan.
 * Also checks for duplicate or very similar headlines.
 *
 * @param markdown - The full article markdown
 * @param plan - The article plan with expected sections
 * @returns Array of validation issues
 */
function validateSectionStructure(
  markdown: string,
  plan: ArticlePlan
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const generatedSections = getContentH2Sections(markdown);
  const plannedSectionCount = plan.sections.length;

  // Check if section count matches plan
  if (generatedSections.length !== plannedSectionCount) {
    issues.push(
      issue(
        'warning',
        `Generated ${generatedSections.length} sections but plan specified ${plannedSectionCount}. ` +
          `Check for duplicate or missing sections.`
      )
    );
  }

  // Check for duplicate headlines (exact or very similar)
  const normalizedHeadlines = new Map<string, string[]>();
  for (const section of generatedSections) {
    // Normalize: lowercase, remove common prefixes, trim
    const normalized = section.heading
      .toLowerCase()
      .replace(/^(the|a|an)\s+/i, '')
      .trim();

    // Also create a "core" version without subtitles after colons
    const core = normalized.split(':')[0].trim();

    // Track both normalized and core versions
    if (!normalizedHeadlines.has(normalized)) {
      normalizedHeadlines.set(normalized, []);
    }
    normalizedHeadlines.get(normalized)!.push(section.heading);

    // Check if core version matches another section's core
    for (const [existingNorm, existingHeadings] of normalizedHeadlines) {
      if (existingNorm === normalized) continue;

      const existingCore = existingNorm.split(':')[0].trim();
      // If cores are very similar (one starts with the other or high overlap)
      if (
        core.includes(existingCore) ||
        existingCore.includes(core) ||
        (core.length > 5 && existingCore.length > 5 && levenshteinSimilarity(core, existingCore) > 0.7)
      ) {
        issues.push(
          issue(
            'warning',
            `Similar section headlines detected: "${existingHeadings[0]}" and "${section.heading}". ` +
              `Consider consolidating these sections.`
          )
        );
      }
    }
  }

  // Check for exact duplicates
  for (const [, headings] of normalizedHeadlines) {
    if (headings.length > 1) {
      issues.push(
        issue(
          'error',
          `Duplicate section headlines: ${headings.map((h) => `"${h}"`).join(', ')}`
        )
      );
    }
  }

  return issues;
}

/**
 * Simple Levenshtein-based similarity score between 0 and 1.
 */
function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  const distance = matrix[b.length][a.length];
  const maxLength = Math.max(a.length, b.length);
  return 1 - distance / maxLength;
}

/**
 * Detects content overlap between article sections.
 * Helps identify when the same topic is covered redundantly in multiple sections.
 *
 * This is a heuristic check that extracts key terms (bolded terms, proper nouns)
 * and calculates overlap. High overlap suggests potential redundancy.
 *
 * @param markdown - The full article markdown
 * @returns Array of validation issues (warnings for overlapping sections)
 */
function validateSectionOverlap(markdown: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Extract sections from markdown
  const sections = getContentH2Sections(markdown);
  if (sections.length < 2) {
    return issues; // Need at least 2 sections to compare
  }

  // Extract key terms for each section
  const sectionTerms: Array<{ heading: string; terms: Set<string> }> = [];
  for (const section of sections) {
    const terms = extractKeyTerms(section.content);
    sectionTerms.push({ heading: section.heading, terms });
  }

  // Compare each pair of sections
  for (let i = 0; i < sectionTerms.length; i++) {
    for (let j = i + 1; j < sectionTerms.length; j++) {
      const sectionA = sectionTerms[i];
      const sectionB = sectionTerms[j];

      // Skip if either section has too few terms for meaningful comparison
      if (sectionA.terms.size < MIN_TERMS_FOR_COMPARISON || sectionB.terms.size < MIN_TERMS_FOR_COMPARISON) {
        continue;
      }

      const similarity = jaccardSimilarity(sectionA.terms, sectionB.terms);

      if (similarity > SECTION_OVERLAP_THRESHOLD) {
        const overlapping = getOverlappingTerms(sectionA.terms, sectionB.terms);
        const overlapPercent = Math.round(similarity * 100);
        const displayTerms = overlapping.slice(0, 4).join(', ');
        const moreCount = overlapping.length > 4 ? ` +${overlapping.length - 4} more` : '';

        issues.push(
          issue(
            'warning',
            `Sections "${sectionA.heading}" and "${sectionB.heading}" have ${overlapPercent}% topic overlap. ` +
              `Shared concepts: ${displayTerms}${moreCount}. Consider consolidating or differentiating.`
          )
        );
      }
    }
  }

  return issues;
}

// ============================================================================
// SEO Validation
// ============================================================================

/**
 * Counts occurrences of a keyword in text (case-insensitive).
 * Uses word boundary matching to avoid partial matches.
 *
 * @param text - The text to search
 * @param keyword - The keyword to count
 * @returns Number of occurrences
 */
function countKeywordOccurrences(text: string, keyword: string): number {
  // Escape special regex characters in keyword
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escapedKeyword}\\b`, 'gi');
  const matches = text.match(regex);
  return matches?.length ?? 0;
}

/**
 * Validates heading hierarchy in markdown.
 * Checks for:
 * - H3 appearing before any H2
 * - Skipped levels (H1 → H3 without H2)
 * - Multiple H1 tags
 *
 * @param markdown - The markdown content
 * @returns Array of validation issues
 */
export function validateHeadingHierarchy(markdown: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Find all headings
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings: Array<{ level: number; text: string; line: number }> = [];
  let match;
  let lineNumber = 1;

  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      headings.push({
        level: headingMatch[1].length,
        text: headingMatch[2],
        line: i + 1,
      });
    }
  }

  if (headings.length === 0) {
    return issues;
  }

  // Check for multiple H1 tags
  const h1Count = headings.filter((h) => h.level === 1).length;
  if (h1Count > 1) {
    issues.push(issue('warning', `Multiple H1 tags found (${h1Count}). Articles should have only one H1 (the title).`));
  }

  // Check for H3 appearing before any H2
  let foundH2 = false;
  for (const heading of headings) {
    if (heading.level === 2) {
      foundH2 = true;
    }
    if (heading.level === 3 && !foundH2) {
      issues.push(
        issue('warning', `H3 heading "${heading.text}" appears before any H2 heading. Consider proper hierarchy.`)
      );
      break; // Only report once
    }
  }

  // Check for skipped levels
  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1];
    const curr = headings[i];

    // Going to deeper level (e.g., H2 → H4) skipping a level
    if (curr.level > prev.level + 1) {
      issues.push(
        issue(
          'warning',
          `Skipped heading level: "${prev.text}" (H${prev.level}) → "${curr.text}" (H${curr.level}). ` +
            `Consider adding H${prev.level + 1} between them.`
        )
      );
    }
  }

  return issues;
}

/**
 * Validates SEO aspects of an article.
 * Checks title length, keyword presence, and heading hierarchy.
 *
 * @param draft - The draft to validate
 * @param gameName - The game name (should appear in title)
 * @returns Array of validation issues
 */
export function validateSEO(
  draft: {
    title: string;
    excerpt: string;
    markdown: string;
    tags: readonly string[];
  },
  gameName: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const SEO = SEO_CONSTRAINTS;

  // 1. Title length (optimal: 50-60 chars for SERP)
  if (draft.title.length < SEO.TITLE_OPTIMAL_MIN) {
    issues.push(
      issue(
        'warning',
        `Title may be too short for SEO (${draft.title.length} chars, optimal: ${SEO.TITLE_OPTIMAL_MIN}-${SEO.TITLE_OPTIMAL_MAX})`
      )
    );
  }
  if (draft.title.length > SEO.TITLE_OPTIMAL_MAX) {
    issues.push(
      issue(
        'warning',
        `Title may be truncated in search results (${draft.title.length} chars, optimal: ${SEO.TITLE_OPTIMAL_MIN}-${SEO.TITLE_OPTIMAL_MAX})`
      )
    );
  }

  // 2. Excerpt/meta description (120-160 chars)
  if (draft.excerpt.length < SEO.EXCERPT_OPTIMAL_MIN) {
    issues.push(
      issue(
        'warning',
        `Excerpt below optimal length (${draft.excerpt.length} chars, optimal: ${SEO.EXCERPT_OPTIMAL_MIN}-${SEO.EXCERPT_OPTIMAL_MAX})`
      )
    );
  }

  // 3. Heading hierarchy
  const headingIssues = validateHeadingHierarchy(draft.markdown);
  issues.push(...headingIssues);

  // 4. Game name in title
  // Extract the base game name (before any subtitle/colon)
  const baseGameName = gameName.split(':')[0].trim().toLowerCase();
  if (!draft.title.toLowerCase().includes(baseGameName)) {
    issues.push(issue('warning', `Title should include game name "${baseGameName}" for SEO`));
  }

  // 5. Keyword density (primary tag should appear 2-8 times)
  const primaryKeyword = draft.tags[0];
  if (primaryKeyword) {
    const contentMarkdown = stripSourcesSection(draft.markdown);
    const keywordCount = countKeywordOccurrences(contentMarkdown, primaryKeyword);

    if (keywordCount < SEO.MIN_KEYWORD_OCCURRENCES) {
      issues.push(
        issue(
          'warning',
          `Primary tag "${primaryKeyword}" appears only ${keywordCount} time(s) in content ` +
            `(optimal: ${SEO.MIN_KEYWORD_OCCURRENCES}-${SEO.MAX_KEYWORD_OCCURRENCES})`
        )
      );
    }
    if (keywordCount > SEO.MAX_KEYWORD_OCCURRENCES) {
      issues.push(
        issue(
          'warning',
          `Primary tag "${primaryKeyword}" appears ${keywordCount} times (may be keyword stuffing, ` +
            `optimal: ${SEO.MIN_KEYWORD_OCCURRENCES}-${SEO.MAX_KEYWORD_OCCURRENCES})`
        )
      );
    }
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
 * @param gameName - The game name for SEO validation (optional for backwards compatibility)
 * @returns Array of validation issues (empty if valid)
 *
 * @example
 * const issues = validateArticleDraft(draft, 'Elden Ring');
 * const errors = getErrors(issues);
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
  gameName?: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Zod schema validation (errors)
  issues.push(...validateStructureWithSchema(draft));

  // Warning-level structural checks
  issues.push(...validateStructureWarnings(draft));

  // Content quality validation
  issues.push(...validateContentQuality(draft.markdown));

  // Required elements coverage validation
  issues.push(...validateRequiredElements(draft.plan, draft.markdown));

  // Section structure validation (count matches plan, no duplicates)
  issues.push(...validateSectionStructure(draft.markdown, draft.plan));

  // Section overlap detection (content deduplication)
  issues.push(...validateSectionOverlap(draft.markdown));

  // SEO validation (if game name provided)
  if (gameName) {
    issues.push(...validateSEO(draft, gameName));
  }

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

  // Check for token repetition corruption (LLM failure mode)
  // This MUST be first - corrupted output is never usable and should trigger retry
  const corruptedField = findCorruptedPlanField(plan);
  if (corruptedField) {
    issues.push(
      issue(
        'error',
        `LLM output corruption detected in ${corruptedField.field}: ` +
          `pattern "${corruptedField.pattern}" repeated ${corruptedField.repetitions} times. ` +
          `This is a known LLM failure mode - retry required.`
      )
    );
    // Return early - no point validating corrupted output further
    return issues;
  }

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

