/**
 * Section Context Management
 *
 * Tracks covered topics across sections to prevent redundancy in sequential writing mode.
 * This enables cross-section awareness where later sections know what earlier sections covered.
 *
 * @example
 * const state = createInitialSectionWriteState();
 *
 * // After writing section 1
 * const updatedState = updateSectionWriteState(state, section1Markdown, ['Ultrahand', 'Fuse']);
 *
 * // When writing section 2, pass the state
 * const context = buildCrossReferenceContext(updatedState);
 * // context includes "Already covered: Ultrahand (Section 1), Fuse (Section 1)"
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a covered topic with its source section.
 */
export interface CoveredTopic {
  /** The topic name/term */
  readonly topic: string;
  /** The section headline where this topic was explained */
  readonly sectionHeadline: string;
  /** Order of the section (1-indexed) */
  readonly sectionIndex: number;
}

/**
 * State tracking covered content across sections during sequential writing.
 */
export interface SectionWriteState {
  /**
   * Topics that have been explained in detail (don't re-explain).
   * Maps topic (lowercase) to metadata about where it was covered.
   */
  readonly coveredTopics: ReadonlyMap<string, CoveredTopic>;

  /**
   * Required elements from the plan that have been addressed.
   * Lowercase keys for case-insensitive matching.
   */
  readonly coveredElements: ReadonlySet<string>;

  /**
   * Key terms that have been bolded/defined (first mention formatting).
   * Lowercase keys for case-insensitive matching.
   */
  readonly definedTerms: ReadonlySet<string>;

  /**
   * Count of sections that have been written so far.
   */
  readonly sectionsWritten: number;
}

// ============================================================================
// State Creation and Updates
// ============================================================================

/**
 * Creates an initial empty state for tracking section context.
 */
export function createInitialSectionWriteState(): SectionWriteState {
  return {
    coveredTopics: new Map(),
    coveredElements: new Set(),
    definedTerms: new Set(),
    sectionsWritten: 0,
  };
}

/**
 * Normalizes a term for case-insensitive matching.
 */
function normalizeTerm(term: string): string {
  return term.toLowerCase().trim();
}

/**
 * Updates the state after writing a section.
 *
 * @param state - Current state
 * @param sectionMarkdown - The markdown content of the written section
 * @param sectionHeadline - The headline of the section
 * @param coveredElements - Required elements covered in this section
 * @returns Updated state
 */
export function updateSectionWriteState(
  state: SectionWriteState,
  sectionMarkdown: string,
  sectionHeadline: string,
  coveredElements: readonly string[] = []
): SectionWriteState {
  const sectionIndex = state.sectionsWritten + 1;

  // Extract topics from the section content
  const extractedTopics = extractCoveredTopics(sectionMarkdown);

  // Build new topics map
  const newTopicsMap = new Map(state.coveredTopics);
  for (const topic of extractedTopics) {
    const normalized = normalizeTerm(topic);
    // Only add if not already covered (first mention wins)
    if (!newTopicsMap.has(normalized)) {
      newTopicsMap.set(normalized, {
        topic,
        sectionHeadline,
        sectionIndex,
      });
    }
  }

  // Build new covered elements set
  const newCoveredElements = new Set(state.coveredElements);
  for (const element of coveredElements) {
    newCoveredElements.add(normalizeTerm(element));
  }

  // Extract defined terms (bold text)
  const definedTermsInSection = extractDefinedTerms(sectionMarkdown);
  const newDefinedTerms = new Set(state.definedTerms);
  for (const term of definedTermsInSection) {
    newDefinedTerms.add(normalizeTerm(term));
  }

  return {
    coveredTopics: newTopicsMap,
    coveredElements: newCoveredElements,
    definedTerms: newDefinedTerms,
    sectionsWritten: sectionIndex,
  };
}

// ============================================================================
// Topic Extraction
// ============================================================================

/**
 * Extracts key topics from written section content.
 *
 * Identifies:
 * - Bold text (usually key terms/concepts)
 * - Proper nouns (capitalized terms)
 * - Terms defined with quotes or special formatting
 *
 * @param sectionMarkdown - The markdown content of a section
 * @returns Set of extracted topic strings
 */
export function extractCoveredTopics(sectionMarkdown: string): Set<string> {
  const topics = new Set<string>();

  // Extract bold text: **text** or __text__
  const boldRegex = /\*\*([^*]+)\*\*|__([^_]+)__/g;
  let match: RegExpExecArray | null;
  while ((match = boldRegex.exec(sectionMarkdown)) !== null) {
    const term = (match[1] || match[2]).trim();
    if (term.length >= 2 && term.length <= 50) {
      topics.add(term);
    }
  }

  // Extract terms in quotes that look like definitions: "term"
  const quotedRegex = /"([A-Z][a-zA-Z\s]{2,30})"/g;
  while ((match = quotedRegex.exec(sectionMarkdown)) !== null) {
    const term = match[1].trim();
    topics.add(term);
  }

  // Extract proper nouns (consecutive capitalized words) that appear multiple times
  // This helps identify game-specific terms like "Great Sky Island" or "Temple of Time"
  const properNounRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
  const properNounCounts = new Map<string, number>();
  while ((match = properNounRegex.exec(sectionMarkdown)) !== null) {
    const term = match[1].trim();
    // Skip common article-writing phrases
    if (!isCommonPhrase(term)) {
      properNounCounts.set(term, (properNounCounts.get(term) || 0) + 1);
    }
  }

  // Only include proper nouns that appear more than once (indicates importance)
  for (const [noun, count] of properNounCounts) {
    if (count >= 2) {
      topics.add(noun);
    }
  }

  return topics;
}

/**
 * Extracts terms that have been defined/bolded (first mention formatting).
 *
 * @param sectionMarkdown - The markdown content of a section
 * @returns Set of defined term strings
 */
export function extractDefinedTerms(sectionMarkdown: string): Set<string> {
  const terms = new Set<string>();

  // Bold text represents defined/important terms
  const boldRegex = /\*\*([^*]+)\*\*|__([^_]+)__/g;
  let match: RegExpExecArray | null;
  while ((match = boldRegex.exec(sectionMarkdown)) !== null) {
    const term = (match[1] || match[2]).trim();
    if (term.length >= 2 && term.length <= 50) {
      terms.add(term);
    }
  }

  return terms;
}

/**
 * Checks if a phrase is a common English phrase to exclude from topic extraction.
 */
function isCommonPhrase(phrase: string): boolean {
  const commonPhrases = new Set([
    'The Game',
    'This Guide',
    'The Player',
    'The First',
    'The Last',
    'The Best',
    'The Most',
    'The Next',
    'The Same',
    'In This',
    'For Example',
    'For Instance',
    'On The',
    'At The',
    'To The',
    'From The',
    'With The',
    'As The',
    'By The',
    'Up The',
    'Down The',
    'After The',
    'Before The',
    'During The',
  ]);
  return commonPhrases.has(phrase);
}

// ============================================================================
// Cross-Reference Context Building
// ============================================================================

/**
 * Checks if a required element has been covered.
 *
 * @param state - Current section write state
 * @param element - The element to check
 * @returns true if the element has been covered
 */
export function isElementCovered(state: SectionWriteState, element: string): boolean {
  return state.coveredElements.has(normalizeTerm(element));
}

/**
 * Gets uncovered required elements.
 *
 * @param state - Current section write state
 * @param requiredElements - All required elements from the plan
 * @returns Array of elements not yet covered
 */
export function getUncoveredElements(
  state: SectionWriteState,
  requiredElements: readonly string[]
): string[] {
  return requiredElements.filter(
    (element) => !state.coveredElements.has(normalizeTerm(element))
  );
}

/**
 * Builds a context string for the Specialist prompt to prevent redundancy.
 *
 * @param state - Current section write state
 * @returns Formatted string for the prompt, or empty string if no context needed
 */
export function buildCrossReferenceContext(state: SectionWriteState): string {
  if (state.sectionsWritten === 0 || state.coveredTopics.size === 0) {
    return '';
  }

  // Group topics by section
  const topicsBySection = new Map<number, CoveredTopic[]>();
  for (const topic of state.coveredTopics.values()) {
    const existing = topicsBySection.get(topic.sectionIndex) || [];
    existing.push(topic);
    topicsBySection.set(topic.sectionIndex, existing);
  }

  const lines: string[] = [
    '=== ALREADY COVERED (DO NOT RE-EXPLAIN) ===',
    'The following have been explained in previous sections. Reference briefly, do not re-explain:',
    '',
  ];

  // Sort by section index
  const sortedSections = Array.from(topicsBySection.entries()).sort(
    ([a], [b]) => a - b
  );

  for (const [_sectionIndex, topics] of sortedSections) {
    if (topics.length > 0) {
      const sectionHeadline = topics[0].sectionHeadline;
      const topicList = topics
        .slice(0, 10) // Limit to 10 topics per section to keep prompt concise
        .map((t) => t.topic)
        .join(', ');
      lines.push(`- Section "${sectionHeadline}": ${topicList}`);
    }
  }

  // Add note about defined terms
  if (state.definedTerms.size > 0) {
    lines.push('');
    lines.push(
      'Previously bolded terms (do not bold again): ' +
        Array.from(state.definedTerms).slice(0, 15).join(', ')
    );
  }

  return lines.join('\n');
}

/**
 * Builds a brief summary of uncovered required elements for the prompt.
 *
 * @param state - Current section write state
 * @param requiredElements - All required elements from the plan
 * @param currentSectionPriorities - Elements specifically for this section (higher priority)
 * @returns Formatted string for the prompt, or empty string if all covered
 */
export function buildRequiredElementsReminder(
  state: SectionWriteState,
  requiredElements: readonly string[],
  currentSectionPriorities: readonly string[] = []
): string {
  const uncovered = getUncoveredElements(state, requiredElements);

  if (uncovered.length === 0) {
    return '';
  }

  // Separate into current section priorities and other uncovered
  const prioritySet = new Set(currentSectionPriorities.map(normalizeTerm));
  const priorityUncovered = uncovered.filter((e) =>
    prioritySet.has(normalizeTerm(e))
  );
  const otherUncovered = uncovered.filter(
    (e) => !prioritySet.has(normalizeTerm(e))
  );

  const lines: string[] = [];

  if (priorityUncovered.length > 0) {
    lines.push(
      `=== MUST COVER IN THIS SECTION ===\n${priorityUncovered.join(', ')}`
    );
  }

  if (otherUncovered.length > 0 && otherUncovered.length <= 5) {
    lines.push(
      `=== STILL NEEDS COVERAGE (later sections) ===\n${otherUncovered.join(', ')}`
    );
  }

  return lines.join('\n\n');
}

