import { describe, it, expect } from 'vitest';
import { findSectionStartWordIndex } from '../../../src/ai/articles/services/tts-generator';

describe('tts-generator', () => {
  describe('findSectionStartWordIndex', () => {
    it('should find the section start when it is at the very end of the words array (off-by-one fix)', () => {
      const words = ['completely', 'different', 'words', 'here', 'plus', 'this', 'is', 'the', 'end'];
      const sectionText = 'this is the end';
      
      // sectionWords will be ['this', 'is', 'the', 'end']
      // words.length = 9
      // sectionWords.length = 4
      // last possible i = 9 - 4 = 5
      // words[5] = 'this', words[6] = 'is', words[7] = 'the', words[8] = 'end'
      
      const index = findSectionStartWordIndex(sectionText, words);
      expect(index).toBe(5);
    });

    it('should return -1 if no match is found', () => {
      const words = ['this', 'is', 'some', 'content'];
      const sectionText = 'completely different text';
      const index = findSectionStartWordIndex(sectionText, words);
      expect(index).toBe(-1);
    });

    it('should find match with fuzzy matching (3 out of 5 words)', () => {
      const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over'];
      const sectionText = 'the slow brown fox jumps'; // 4 out of 5 match
      const index = findSectionStartWordIndex(sectionText, words);
      expect(index).toBe(0);
    });

    it('should respect startSearchIndex', () => {
      const words = ['match', 'here', 'and', 'match', 'here', 'again'];
      const sectionText = 'match here';
      
      const firstIndex = findSectionStartWordIndex(sectionText, words, 0);
      expect(firstIndex).toBe(0);
      
      const secondIndex = findSectionStartWordIndex(sectionText, words, 1);
      expect(secondIndex).toBe(3);
    });
  });
});
