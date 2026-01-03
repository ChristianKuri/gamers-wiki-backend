import { describe, it, expect } from 'vitest';

import {
  // Editor prompts
  buildCategoryHintsSection,
  buildExistingResearchSummary,
  getEditorSystemPrompt,
  getEditorUserPrompt,
  type EditorPromptContext,
  // Specialist prompts
  getCategoryToneGuide,
  buildResearchContext,
  getSpecialistSystemPrompt,
  getSpecialistSectionUserPrompt,
  type SpecialistSectionContext,
} from '../../../src/ai/articles/prompts';
import type { GameArticleContext, ScoutOutput, CategorizedSearchResult } from '../../../src/ai/articles/types';
import type { ArticlePlan } from '../../../src/ai/articles/article-plan';
import { createEmptyResearchPool } from '../../../src/ai/articles/research-pool';
import { createEmptyTokenUsage } from '../../../src/ai/articles/types';

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockGameContext = (overrides: Partial<GameArticleContext> = {}): GameArticleContext => ({
  gameName: 'Elden Ring',
  gameSlug: 'elden-ring',
  releaseDate: '2022-02-25',
  genres: ['Action RPG', 'Soulslike'],
  platforms: ['PC', 'PlayStation 5', 'Xbox Series X'],
  developer: 'FromSoftware',
  publisher: 'Bandai Namco',
  igdbDescription: 'An epic open-world action RPG.',
  instruction: 'Write a beginner guide',
  ...overrides,
});

const createMockScoutOutput = (): ScoutOutput => ({
  queryPlan: {
    draftTitle: 'Elden Ring: Complete Beginner Guide',
    queries: [
      { query: '"Elden Ring" beginner guide', engine: 'tavily', purpose: 'General overview', expectedFindings: ['Core mechanics'] },
    ],
  },
  discoveryCheck: {
    needsDiscovery: false,
    discoveryReason: 'none',
  },
  sourceSummaries: [
    {
      url: 'https://ign.com',
      title: 'IGN Review',
      detailedSummary: 'Elden Ring is an action RPG developed by FromSoftware with open world exploration.',
      keyFacts: ['Open world', 'Challenging combat'],
      contentType: 'guide',
      dataPoints: ['2022 release'],
      query: '"Elden Ring" beginner guide',
      qualityScore: 85,
      relevanceScore: 90,
    },
  ],
  researchPool: {
    scoutFindings: {
      overview: [
        {
          query: 'Elden Ring overview',
          answer: 'Great game',
          results: [{ title: 'IGN Review', url: 'https://ign.com', content: 'Review content', score: 0.9 }],
          category: 'overview',
          timestamp: Date.now(),
        },
      ],
      categorySpecific: [
        {
          query: 'Elden Ring beginner tips',
          answer: 'Tips summary',
          results: [{ title: 'Guide', url: 'https://guide.com', content: 'Guide content', score: 0.8 }],
          category: 'category-specific',
          timestamp: Date.now(),
        },
      ],
      recent: [],
    },
    allUrls: new Set(['https://ign.com', 'https://guide.com']),
    queryCache: new Map(),
  },
  sourceUrls: ['https://ign.com', 'https://guide.com'],
  queryPlanningTokenUsage: createEmptyTokenUsage(),
  tokenUsage: createEmptyTokenUsage(),
  confidence: 'high',
  searchApiCosts: { totalUsd: 0, exaSearchCount: 0, tavilySearchCount: 1, exaCostUsd: 0, tavilyCostUsd: 0.008, tavilyCredits: 1 },
  filteredSources: [],
});

const createMockArticlePlan = (): ArticlePlan => ({
  gameName: 'Elden Ring',
  gameSlug: 'elden-ring',
  title: 'Elden Ring: Complete Beginner Guide',
  categorySlug: 'guides',
  excerpt: 'Master the Lands Between with this comprehensive beginner guide covering builds, exploration, and combat tips.',
  tags: ['beginner', 'guide', 'tips', 'builds'],
  sections: [
    { headline: 'Getting Started', goal: 'Help new players understand basics', researchQueries: ['elden ring basics'], mustCover: ['Game basics'] },
    { headline: 'Character Builds', goal: 'Cover popular builds', researchQueries: ['elden ring builds'], mustCover: ['Build types'] },
    { headline: 'Exploration Tips', goal: 'Guide safe exploration', researchQueries: ['elden ring exploration'], mustCover: ['Exploration tips'] },
  ],
  safety: { noScoresUnlessReview: true },
});

const createMockSearchResult = (
  query: string,
  category: CategorizedSearchResult['category'] = 'section-specific'
): CategorizedSearchResult => ({
  query,
  answer: `Answer for ${query}`,
  results: [
    { title: 'Result 1', url: 'https://example.com/1', content: 'Content for result 1', score: 0.9 },
    { title: 'Result 2', url: 'https://example.com/2', content: 'Content for result 2', score: 0.8 },
  ],
  category,
  timestamp: Date.now(),
});

// ============================================================================
// Editor Prompts Tests
// ============================================================================

describe('Editor Prompts', () => {
  describe('buildCategoryHintsSection', () => {
    it('returns empty string when no hints provided', () => {
      expect(buildCategoryHintsSection(undefined)).toBe('');
      expect(buildCategoryHintsSection([])).toBe('');
    });

    it('formats hints with system prompts', () => {
      const hints = [
        { slug: 'guides' as const, systemPrompt: 'Focus on beginners' },
        { slug: 'reviews' as const, systemPrompt: 'Be critical' },
      ];

      const section = buildCategoryHintsSection(hints);

      expect(section).toContain('guides: Focus on beginners');
      expect(section).toContain('reviews: Be critical');
    });

    it('handles hints without system prompts', () => {
      const hints = [
        { slug: 'news' as const },
        { slug: 'lists' as const, systemPrompt: '' },
      ];

      const section = buildCategoryHintsSection(hints);

      expect(section).toContain('- news');
      expect(section).toContain('- lists');
    });

    it('includes category selection header', () => {
      const hints = [{ slug: 'guides' as const }];
      const section = buildCategoryHintsSection(hints);

      expect(section).toContain('Available categories');
      expect(section).toContain('categorySlug');
    });
  });

  describe('buildExistingResearchSummary', () => {
    it('lists search queries from scout output', () => {
      const scoutOutput = createMockScoutOutput();
      const summary = buildExistingResearchSummary(scoutOutput, 5);

      expect(summary).toContain('Elden Ring overview');
      expect(summary).toContain('Elden Ring beginner tips');
    });

    it('shows total source count', () => {
      const scoutOutput = createMockScoutOutput();
      const summary = buildExistingResearchSummary(scoutOutput, 5);

      expect(summary).toContain('Total sources: 2');
    });

    it('includes search query categories', () => {
      const scoutOutput = createMockScoutOutput();

      const summary = buildExistingResearchSummary(scoutOutput, 3);

      // Should list what searches were performed
      expect(summary).toContain('Overview searches:');
      expect(summary).toContain('Category searches:');
    });

    it('includes guidance about avoiding duplicate queries', () => {
      const scoutOutput = createMockScoutOutput();
      const summary = buildExistingResearchSummary(scoutOutput, 5);

      expect(summary).toContain('SPECIFIC details');
    });
  });

  describe('getEditorSystemPrompt', () => {
    it('includes locale instruction', () => {
      const prompt = getEditorSystemPrompt('Write in English.');

      expect(prompt).toContain('Write in English.');
    });

    it('identifies Editor agent role', () => {
      const prompt = getEditorSystemPrompt('Write in English.');

      expect(prompt).toContain('Editor agent');
      expect(prompt).toContain('article architect');
    });

    it('mentions core competencies', () => {
      const prompt = getEditorSystemPrompt('Write in English.');

      expect(prompt).toContain('STRATEGIC STRUCTURE');
      expect(prompt).toContain('RESEARCH EFFICIENCY');
    });
  });

  describe('getEditorUserPrompt', () => {
    it('includes game name', () => {
      const scoutOutput = createMockScoutOutput();
      const ctx: EditorPromptContext = {
        gameName: 'Elden Ring',
        releaseDate: '2022-02-25',
        genres: ['Action RPG'],
        platforms: ['PC'],
        developer: 'FromSoftware',
        publisher: 'Bandai Namco',
        instruction: 'Write a guide',
        localeInstruction: 'Write in English.',
        scoutBriefing: scoutOutput.briefing,
        existingResearchSummary: 'Research summary',
        categoryHintsSection: '',
      };

      const prompt = getEditorUserPrompt(ctx);

      expect(prompt).toContain('Elden Ring');
    });

    it('includes user directive', () => {
      const scoutOutput = createMockScoutOutput();
      const ctx: EditorPromptContext = {
        gameName: 'Test Game',
        localeInstruction: 'Write in English.',
        scoutBriefing: scoutOutput.briefing,
        existingResearchSummary: 'Summary',
        categoryHintsSection: '',
        instruction: 'Write a detailed review',
      };

      const prompt = getEditorUserPrompt(ctx);

      expect(prompt).toContain('Write a detailed review');
    });

    it('shows default message when no instruction', () => {
      const scoutOutput = createMockScoutOutput();
      const ctx: EditorPromptContext = {
        gameName: 'Test Game',
        localeInstruction: 'Write in English.',
        scoutBriefing: scoutOutput.briefing,
        existingResearchSummary: 'Summary',
        categoryHintsSection: '',
        instruction: null,
      };

      const prompt = getEditorUserPrompt(ctx);

      expect(prompt).toContain('No specific directive');
    });

    it('includes category selection guide', () => {
      const scoutOutput = createMockScoutOutput();
      const ctx: EditorPromptContext = {
        gameName: 'Test Game',
        localeInstruction: 'Write in English.',
        scoutBriefing: scoutOutput.briefing,
        existingResearchSummary: 'Summary',
        categoryHintsSection: '',
      };

      const prompt = getEditorUserPrompt(ctx);

      expect(prompt).toContain('news:');
      expect(prompt).toContain('reviews:');
      expect(prompt).toContain('guides:');
      expect(prompt).toContain('lists:');
    });

    it('includes structural requirements', () => {
      const scoutOutput = createMockScoutOutput();
      const ctx: EditorPromptContext = {
        gameName: 'Test Game',
        localeInstruction: 'Write in English.',
        scoutBriefing: scoutOutput.briefing,
        existingResearchSummary: 'Summary',
        categoryHintsSection: '',
      };

      const prompt = getEditorUserPrompt(ctx);

      expect(prompt).toContain('title:');
      expect(prompt).toContain('excerpt:');
      expect(prompt).toContain('sections:');
    });
  });
});

// ============================================================================
// Specialist Prompts Tests
// ============================================================================

describe('Specialist Prompts', () => {
  describe('getCategoryToneGuide', () => {
    it('returns news tone guide', () => {
      const guide = getCategoryToneGuide('news');

      expect(guide).toContain('Professional');
      expect(guide).toContain('objective');
    });

    it('returns reviews tone guide', () => {
      const guide = getCategoryToneGuide('reviews');

      expect(guide).toContain('Critical');
      expect(guide).toContain('balanced');
    });

    it('returns guides tone guide', () => {
      const guide = getCategoryToneGuide('guides');

      expect(guide).toContain('Instructional');
      expect(guide).toContain('second person');
    });

    it('returns lists tone guide', () => {
      const guide = getCategoryToneGuide('lists');

      expect(guide).toContain('Engaging');
      expect(guide).toContain('comparative');
    });
  });

  describe('buildResearchContext', () => {
    it('returns empty context for empty research', () => {
      const result = buildResearchContext([], 5, 600);

      expect(result.context).toBe('');
      expect(result.sourceUsage).toEqual([]);
    });

    it('formats research results with query and category', () => {
      const research = [createMockSearchResult('test query')];
      const result = buildResearchContext(research, 5, 600);

      expect(result.context).toContain('test query');
      expect(result.context).toContain('section-specific');
    });

    it('includes AI summary', () => {
      const research = [createMockSearchResult('query')];
      const result = buildResearchContext(research, 5, 600);

      expect(result.context).toContain('AI Summary:');
      expect(result.context).toContain('Answer for query');
    });

    it('limits results per research item', () => {
      const searchResult = createMockSearchResult('query');
      // Add more results
      const extendedResult = {
        ...searchResult,
        results: [
          { title: 'R1', url: 'https://1.com', content: 'C1', score: 1 },
          { title: 'R2', url: 'https://2.com', content: 'C2', score: 0.9 },
          { title: 'R3', url: 'https://3.com', content: 'C3', score: 0.8 },
          { title: 'R4', url: 'https://4.com', content: 'C4', score: 0.7 },
        ],
      };

      const result = buildResearchContext([extendedResult], 2, 600);

      expect(result.context).toContain('R1');
      expect(result.context).toContain('R2');
      expect(result.context).not.toContain('R3');
      expect(result.context).not.toContain('R4');
    });

    it('truncates content based on contentPerResult', () => {
      const searchResult: CategorizedSearchResult = {
        query: 'query',
        answer: 'answer',
        results: [{ title: 'Title', url: 'https://example.com', content: 'A'.repeat(1000), score: 1 }],
        category: 'section-specific',
        timestamp: Date.now(),
      };

      const result = buildResearchContext([searchResult], 5, 50);

      expect(result.context).not.toContain('A'.repeat(100));
    });

    it('separates multiple research items', () => {
      const research = [
        createMockSearchResult('query1'),
        createMockSearchResult('query2'),
      ];

      const result = buildResearchContext(research, 5, 600);

      expect(result.context).toContain('query1');
      expect(result.context).toContain('query2');
      expect(result.context).toContain('---');
    });

    it('tracks source usage', () => {
      const research = [createMockSearchResult('test query')];
      const result = buildResearchContext(research, 5, 600, 'Test Section');

      expect(result.sourceUsage.length).toBeGreaterThan(0);
      expect(result.sourceUsage[0].section).toBe('Test Section');
      expect(result.sourceUsage[0].query).toBe('test query');
    });
  });

  describe('getSpecialistSystemPrompt', () => {
    it('includes locale instruction', () => {
      const prompt = getSpecialistSystemPrompt('Write in English.', 'Guide tone');

      expect(prompt).toContain('Write in English.');
    });

    it('identifies Specialist agent role', () => {
      const prompt = getSpecialistSystemPrompt('Write in English.', 'Guide tone');

      expect(prompt).toContain('Specialist agent');
      // Guides strategy has specific mission
      expect(prompt).toContain('Transform research');
    });

    it('uses category-specific strategy when provided', () => {
      const prompt = getSpecialistSystemPrompt('Write in English.', '', 'guides');

      // Guides strategy includes specific rules
      expect(prompt).toContain('FACTUAL ACCURACY');
      expect(prompt).toContain('PRECISION REQUIREMENTS');
    });

    it('includes writing guidelines', () => {
      const prompt = getSpecialistSystemPrompt('Write in English.', 'Tone');

      // Should include core writing principles
      expect(prompt).toMatch(/ACCURACY|CLARITY|principles/i);
    });
  });

  describe('getSpecialistSectionUserPrompt', () => {
    const createSectionContext = (overrides: Partial<SpecialistSectionContext> = {}): SpecialistSectionContext => ({
      sectionIndex: 0,
      totalSections: 3,
      headline: 'Getting Started',
      goal: 'Help new players understand basics',
      isFirst: true,
      isLast: false,
      previousContext: '',
      researchContext: 'Research context here',
      isThinResearch: false,
      researchContentLength: 1000,
      mustCover: ['Game basics', 'Starting tips'],
      sourceSummaries: [
        {
          url: 'https://guide.com',
          title: 'Elden Ring Guide',
          detailedSummary: 'Found comprehensive guide information.',
          keyFacts: ['Key fact 1', 'Key fact 2'],
          contentType: 'guide',
          dataPoints: ['2022 release'],
          query: '"Elden Ring" guide',
          qualityScore: 85,
          relevanceScore: 90,
        },
      ],
      ...overrides,
    });

    it('includes article metadata', () => {
      const plan = createMockArticlePlan();
      const ctx = createSectionContext();

      const prompt = getSpecialistSectionUserPrompt(ctx, plan, 'Elden Ring', 2500, 2, 5);

      expect(prompt).toContain('Elden Ring: Complete Beginner Guide');
      // New prompt format uses "for a guide about" instead of "GUIDE article"
      expect(prompt).toContain('for a guide about');
      expect(prompt).toContain('Elden Ring');
    });

    it('includes section info', () => {
      const plan = createMockArticlePlan();
      const ctx = createSectionContext({
        sectionIndex: 1,
        totalSections: 3,
        headline: 'Character Builds',
        goal: 'Cover popular builds',
      });

      const prompt = getSpecialistSectionUserPrompt(ctx, plan, 'Elden Ring', 2500, 2, 5);

      // Prompt uses "section X of Y" format
      expect(prompt).toContain('section 2 of 3');
      expect(prompt).toContain('Character Builds');
      expect(prompt).toContain('Cover popular builds');
    });

    it('shows opening section guidance for first section', () => {
      const plan = createMockArticlePlan();
      const ctx = createSectionContext({ isFirst: true, isLast: false });

      const prompt = getSpecialistSectionUserPrompt(ctx, plan, 'Elden Ring', 2500, 2, 5);

      expect(prompt).toContain('Opening section');
    });

    it('shows closing section guidance for last section', () => {
      const plan = createMockArticlePlan();
      const ctx = createSectionContext({ isFirst: false, isLast: true, sectionIndex: 2 });

      const prompt = getSpecialistSectionUserPrompt(ctx, plan, 'Elden Ring', 2500, 2, 5);

      // Guides prompt uses "Final section" for last section
      expect(prompt).toContain('Final section');
    });

    it('shows no special section guidance for middle sections', () => {
      const plan = createMockArticlePlan();
      const ctx = createSectionContext({ isFirst: false, isLast: false, sectionIndex: 1 });

      const prompt = getSpecialistSectionUserPrompt(ctx, plan, 'Elden Ring', 2500, 2, 5);

      // Middle sections don't get opening/final section labels
      expect(prompt).not.toContain('Opening section');
      expect(prompt).not.toContain('Final section');
    });

    it('includes research context from scout', () => {
      const plan = createMockArticlePlan();
      const ctx = createSectionContext({
        researchContext: 'Detailed research about game mechanics...',
      });

      const prompt = getSpecialistSectionUserPrompt(ctx, plan, 'Elden Ring', 2500, 2, 5);

      expect(prompt).toContain('RESEARCH');
      expect(prompt).toContain('Detailed research about game mechanics');
    });

    it('handles empty research context gracefully', () => {
      const plan = createMockArticlePlan();
      const ctx = createSectionContext({
        researchContext: '',
      });

      const prompt = getSpecialistSectionUserPrompt(ctx, plan, 'Elden Ring', 2500, 2, 5);

      // Should still generate valid prompt without research
      expect(prompt).toContain('RESEARCH');
    });

    it('includes cross-reference context when available', () => {
      const plan = createMockArticlePlan();
      const ctx = createSectionContext({
        isFirst: false,
        crossReferenceContext: 'Previously covered: Boss strategies, Item locations',
      });

      const prompt = getSpecialistSectionUserPrompt(ctx, plan, 'Elden Ring', 2500, 2, 5);

      expect(prompt).toContain('PREVIOUSLY COVERED');
      expect(prompt).toContain('Boss strategies');
    });

    it('includes precision requirements for guides', () => {
      const plan = createMockArticlePlan();
      const ctx = createSectionContext();

      const prompt = getSpecialistSectionUserPrompt(ctx, plan, 'Elden Ring', 2500, 2, 5);

      // The system prompt contains precision rules, user prompt contains writing guidelines
      expect(prompt).toContain('Precision checklist');
      expect(prompt).toContain('FIRST mention');
    });

    it('includes source summaries in prompt', () => {
      const plan = createMockArticlePlan();
      const ctx = createSectionContext({
        sourceSummaries: [
          {
            url: 'https://example.com',
            title: 'Test Source Title',
            detailedSummary: 'Test detailed summary with specific facts.',
            keyFacts: ['Fact A', 'Fact B'],
            contentType: 'guide' as const,
            dataPoints: ['Data point 1'],
            query: 'test query',
            qualityScore: 85,
            relevanceScore: 90,
          },
        ],
      });

      const prompt = getSpecialistSectionUserPrompt(ctx, plan, 'Elden Ring', 100, 2, 5);

      expect(prompt).toContain('Test Source Title');
      expect(prompt).toContain('Test detailed summary');
    });

    it('includes section information and headline in prompt', () => {
      const plan = createMockArticlePlan();
      const ctx = createSectionContext({ headline: 'Combat Mechanics' });

      const prompt = getSpecialistSectionUserPrompt(ctx, plan, 'Elden Ring', 2500, 2, 5);

      expect(prompt).toContain('SECTION INFORMATION');
      expect(prompt).toContain('Combat Mechanics');
    });

    it('includes mustCover elements for section accountability', () => {
      const plan = createMockArticlePlan();
      const ctx = createSectionContext({ mustCover: ['Game basics', 'Starting tips'] });

      const prompt = getSpecialistSectionUserPrompt(ctx, plan, 'Elden Ring', 2500, 2, 5);

      expect(prompt).toContain('REQUIRED COVERAGE');
      expect(prompt).toContain('Game basics');
      expect(prompt).toContain('Starting tips');
    });

    it('lists full outline in prompt', () => {
      const plan = createMockArticlePlan();
      const ctx = createSectionContext();

      const prompt = getSpecialistSectionUserPrompt(ctx, plan, 'Elden Ring', 2500, 2, 5);

      expect(prompt).toContain('Getting Started');
      expect(prompt).toContain('Character Builds');
      expect(prompt).toContain('Exploration Tips');
    });
  });
});

