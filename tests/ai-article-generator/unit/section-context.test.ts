/**
 * Unit tests for section context management (cross-section awareness)
 */

import { describe, it, expect } from 'vitest';

import {
  createInitialSectionWriteState,
  updateSectionWriteState,
  extractCoveredTopics,
  extractDefinedTerms,
  buildCrossReferenceContext,
  isElementCovered,
  getUncoveredElements,
  buildRequiredElementsReminder,
} from '../../../src/ai/articles/section-context';

describe('Section Context Management', () => {
  describe('createInitialSectionWriteState', () => {
    it('creates empty initial state', () => {
      const state = createInitialSectionWriteState();

      expect(state.coveredTopics.size).toBe(0);
      expect(state.coveredElements.size).toBe(0);
      expect(state.definedTerms.size).toBe(0);
      expect(state.sectionsWritten).toBe(0);
    });
  });

  describe('extractCoveredTopics', () => {
    it('extracts bold text as topics', () => {
      const markdown = `
The **Ultrahand** ability is essential. You can use **Fuse** to combine weapons.
Also explore the **Great Sky Island** for resources.
      `;

      const topics = extractCoveredTopics(markdown);

      expect(topics.has('Ultrahand')).toBe(true);
      expect(topics.has('Fuse')).toBe(true);
      expect(topics.has('Great Sky Island')).toBe(true);
    });

    it('extracts underscore bold text', () => {
      const markdown = 'The __Recall__ ability lets you reverse time on objects.';

      const topics = extractCoveredTopics(markdown);

      expect(topics.has('Recall')).toBe(true);
    });

    it('extracts quoted proper nouns', () => {
      const markdown = 'Visit the location known as "Temple of Time" for the main quest.';

      const topics = extractCoveredTopics(markdown);

      expect(topics.has('Temple of Time')).toBe(true);
    });

    it('extracts frequently mentioned proper nouns', () => {
      const markdown = `
Great Sky Island is the starting area. You begin your journey on Great Sky Island
after waking from a long slumber. Great Sky Island contains several shrines.
      `;

      const topics = extractCoveredTopics(markdown);

      // "Great Sky Island" appears 3 times, should be extracted
      expect(topics.has('Great Sky Island')).toBe(true);
    });

    it('ignores common phrases', () => {
      const markdown = `
The Game offers many possibilities. In This section, we cover The First steps.
For Example, you should explore The Best areas first.
      `;

      const topics = extractCoveredTopics(markdown);

      expect(topics.has('The Game')).toBe(false);
      expect(topics.has('In This')).toBe(false);
      expect(topics.has('The First')).toBe(false);
      expect(topics.has('For Example')).toBe(false);
    });

    it('filters out very short or very long terms', () => {
      const markdown = `
**A** is too short. **This is a very long term that should be filtered out because it exceeds the maximum length**.
**OK** is valid.
      `;

      const topics = extractCoveredTopics(markdown);

      expect(topics.has('A')).toBe(false);
      expect(topics.has('OK')).toBe(true);
    });
  });

  describe('extractDefinedTerms', () => {
    it('extracts bold text as defined terms', () => {
      const markdown = `
Learn about **Ultrahand** and **Fuse** to succeed.
      `;

      const terms = extractDefinedTerms(markdown);

      expect(terms.has('Ultrahand')).toBe(true);
      expect(terms.has('Fuse')).toBe(true);
    });

    it('extracts underscore bold as defined terms', () => {
      const markdown = 'The __Ascend__ ability is useful.';

      const terms = extractDefinedTerms(markdown);

      expect(terms.has('Ascend')).toBe(true);
    });
  });

  describe('updateSectionWriteState', () => {
    it('updates state with new topics from section', () => {
      const state = createInitialSectionWriteState();
      const markdown = 'Learn about **Ultrahand** to build vehicles.';

      const updated = updateSectionWriteState(state, markdown, 'Building Basics');

      expect(updated.sectionsWritten).toBe(1);
      expect(updated.coveredTopics.size).toBeGreaterThan(0);
      expect(updated.coveredTopics.has('ultrahand')).toBe(true); // normalized
      expect(updated.coveredTopics.get('ultrahand')?.sectionHeadline).toBe('Building Basics');
      expect(updated.coveredTopics.get('ultrahand')?.sectionIndex).toBe(1);
    });

    it('tracks covered elements', () => {
      const state = createInitialSectionWriteState();

      const updated = updateSectionWriteState(
        state,
        'Some markdown content',
        'Section 1',
        ['Ultrahand', 'Fuse']
      );

      expect(updated.coveredElements.has('ultrahand')).toBe(true);
      expect(updated.coveredElements.has('fuse')).toBe(true);
    });

    it('preserves topics from first mention', () => {
      let state = createInitialSectionWriteState();

      // First section covers Ultrahand
      state = updateSectionWriteState(
        state,
        'Master **Ultrahand** here.',
        'First Section'
      );

      // Second section mentions Ultrahand again
      state = updateSectionWriteState(
        state,
        'Use **Ultrahand** for more tasks.',
        'Second Section'
      );

      // Should still reference first section
      expect(state.coveredTopics.get('ultrahand')?.sectionHeadline).toBe('First Section');
      expect(state.coveredTopics.get('ultrahand')?.sectionIndex).toBe(1);
    });

    it('accumulates defined terms across sections', () => {
      let state = createInitialSectionWriteState();

      state = updateSectionWriteState(state, '**Ultrahand** basics', 'Section 1');
      state = updateSectionWriteState(state, '**Fuse** mechanics', 'Section 2');

      expect(state.definedTerms.has('ultrahand')).toBe(true);
      expect(state.definedTerms.has('fuse')).toBe(true);
    });
  });

  describe('buildCrossReferenceContext', () => {
    it('returns empty string for initial state', () => {
      const state = createInitialSectionWriteState();

      const context = buildCrossReferenceContext(state);

      expect(context).toBe('');
    });

    it('builds context listing covered topics by section', () => {
      let state = createInitialSectionWriteState();
      state = updateSectionWriteState(state, '**Ultrahand** and **Fuse** basics', 'Core Abilities');
      state = updateSectionWriteState(state, '**Ascend** to climb', 'Traversal');

      const context = buildCrossReferenceContext(state);

      expect(context).toContain('ALREADY COVERED');
      expect(context).toContain('Core Abilities');
      expect(context).toContain('Ultrahand');
      expect(context).toContain('Fuse');
      expect(context).toContain('Traversal');
      expect(context).toContain('Ascend');
    });

    it('includes note about previously bolded terms', () => {
      let state = createInitialSectionWriteState();
      state = updateSectionWriteState(state, '**Ultrahand** is key', 'Section 1');

      const context = buildCrossReferenceContext(state);

      expect(context).toContain('Previously bolded terms');
      expect(context).toContain('Ultrahand');
    });
  });

  describe('isElementCovered', () => {
    it('returns false for uncovered elements', () => {
      const state = createInitialSectionWriteState();

      expect(isElementCovered(state, 'Ultrahand')).toBe(false);
    });

    it('returns true for covered elements (case insensitive)', () => {
      let state = createInitialSectionWriteState();
      state = updateSectionWriteState(state, 'content', 'Section', ['Ultrahand']);

      expect(isElementCovered(state, 'Ultrahand')).toBe(true);
      expect(isElementCovered(state, 'ultrahand')).toBe(true);
      expect(isElementCovered(state, 'ULTRAHAND')).toBe(true);
    });
  });

  describe('getUncoveredElements', () => {
    it('returns all elements when none covered', () => {
      const state = createInitialSectionWriteState();
      const required = ['Ultrahand', 'Fuse', 'Ascend'];

      const uncovered = getUncoveredElements(state, required);

      expect(uncovered).toEqual(['Ultrahand', 'Fuse', 'Ascend']);
    });

    it('excludes covered elements', () => {
      let state = createInitialSectionWriteState();
      state = updateSectionWriteState(state, '', '', ['Ultrahand']);

      const uncovered = getUncoveredElements(state, ['Ultrahand', 'Fuse', 'Ascend']);

      expect(uncovered).toEqual(['Fuse', 'Ascend']);
    });

    it('handles case insensitively', () => {
      let state = createInitialSectionWriteState();
      state = updateSectionWriteState(state, '', '', ['ultrahand']);

      const uncovered = getUncoveredElements(state, ['Ultrahand', 'Fuse']);

      expect(uncovered).toEqual(['Fuse']);
    });
  });

  describe('buildRequiredElementsReminder', () => {
    it('returns empty string when all elements covered', () => {
      let state = createInitialSectionWriteState();
      state = updateSectionWriteState(state, '', '', ['Ultrahand', 'Fuse']);

      const reminder = buildRequiredElementsReminder(state, ['Ultrahand', 'Fuse']);

      expect(reminder).toBe('');
    });

    it('lists uncovered elements', () => {
      const state = createInitialSectionWriteState();

      const reminder = buildRequiredElementsReminder(state, ['Ultrahand', 'Fuse', 'Ascend']);

      expect(reminder).toContain('Ultrahand');
      expect(reminder).toContain('Fuse');
      expect(reminder).toContain('Ascend');
    });

    it('highlights current section priorities', () => {
      const state = createInitialSectionWriteState();

      const reminder = buildRequiredElementsReminder(
        state,
        ['Ultrahand', 'Fuse', 'Ascend', 'Recall'],
        ['Ultrahand', 'Fuse'] // priorities for this section
      );

      expect(reminder).toContain('MUST COVER IN THIS SECTION');
      expect(reminder).toContain('Ultrahand');
      expect(reminder).toContain('Fuse');
    });
  });
});

