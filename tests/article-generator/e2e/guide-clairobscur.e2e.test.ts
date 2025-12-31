/**
 * Article Generator E2E Test - Clair Obscur: Expedition 33
 *
 * Tests guide generation for a SPECIFIC BOSS in Clair Obscur: Expedition 33.
 *
 * PURPOSE: This test validates that external research (web search) is working correctly.
 * The game released April 24, 2025, which is after LLM training cutoffs.
 * The guide focuses on Simon, the hardest secret boss, which requires:
 * - Knowledge of specific game mechanics (Pictos, Luminas, Gradient Charges, Virtuose Stance, Foretell)
 * - Specific party members (Lune, Verso, Monoco, Maelle, Sciel, Esquie)
 * - Boss-specific mechanics (Chroma Shift, Shield Steal, phantom sword phases, Break gauge)
 *
 * Without external research, an LLM would be unable to write accurate, specific content
 * about these game-specific mechanics and strategies.
 *
 * Run with: npm run test:e2e:article-guide-clairobscur
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  type GameTestConfig,
  type TestState,
  createInitialTestState,
  setupArticleGeneratorTest,
  teardownArticleGeneratorTest,
  ARTICLE_PLAN_CONSTRAINTS,
  VALID_CATEGORY_SLUGS,
  VALID_CONFIDENCE_LEVELS,
  findPlaceholders,
  analyzeAiCliches,
  analyzeMarkdownContent,
  findPostGameLinkTable,
  getTableColumns,
} from './article-generator-shared';

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_CONFIG: GameTestConfig = {
  igdbId: 305152,
  gameName: 'Clair Obscur: Expedition 33',
  gameSlug: 'clairobscur',
  // Specific boss guide - requires external research to know:
  // - How to unlock Simon (Esquie's relationship level 6, underwater swimming, Renoir's Drafts, The Abyss)
  // - Party setup (Lune, Verso, Monoco frontline; Maelle, Sciel reserve)
  // - Pictos/Luminas (Cheater, Second Chance, Energizing Jump)
  // - Boss phases and mechanics (Chroma Shift, Shield Steal, phantom sword, Break gauge)
  // - High-damage strategies (Maelle's Virtuose Stance + Gradient Charges, Sciel's Foretell + End Slice)
  instruction:
    'Write a comprehensive guide on how to defeat Simon, the secret superboss. ' +
    'Cover how to unlock the fight, recommended party setup, essential Pictos and Luminas, ' +
    'and phase-by-phase combat strategies including parry timings and high-damage burst tactics.',
  categorySlug: 'guides',
  expectedNameContains: 'Clair Obscur',
};

// ============================================================================
// Test Suite
// ============================================================================

const describeE2E = process.env.RUN_E2E_TESTS === 'true' ? describe : describe.skip;

describeE2E(`Article Generator E2E - ${TEST_CONFIG.gameName}`, () => {
  const state: TestState = createInitialTestState();

  beforeAll(async () => {
    await setupArticleGeneratorTest(state, TEST_CONFIG);
  }, 1080000);

  afterAll(async () => {
    await teardownArticleGeneratorTest(state, TEST_CONFIG);
  });

  // ========================================================================
  // VALIDATION TESTS
  // ========================================================================

  it('should return a successful response', async ({ skip }) => {
    if (!state.strapiReady || !state.response) {
      skip();
      return;
    }

    expect(state.response.ok).toBe(true);
    expect(state.json?.success).toBe(true);
    expect(state.json?.post?.documentId).toBeTruthy();
  });

  it('should include game information in response', async ({ skip }) => {
    if (!state.strapiReady || !state.json) {
      skip();
      return;
    }

    expect(state.json?.game).toBeDefined();
    expect(state.json?.game?.documentId).toBeTruthy();
    expect(state.json?.game?.name).toBeTruthy();

    if (!state.json?.game?.documentId) {
      state.validationIssues.push({
        severity: 'error',
        field: 'game.documentId',
        message: 'Game documentId is missing',
      });
    }
  });

  it('should generate a valid title', async ({ skip }) => {
    if (!state.strapiReady || !state.json?.draft) {
      skip();
      return;
    }

    const title = state.json.draft.title;
    const C = ARTICLE_PLAN_CONSTRAINTS;

    expect(typeof title).toBe('string');
    expect(title.length).toBeGreaterThanOrEqual(C.TITLE_MIN_LENGTH);
    expect(title.length).toBeLessThanOrEqual(C.TITLE_MAX_LENGTH);

    if (title.length > C.TITLE_RECOMMENDED_MAX_LENGTH) {
      state.validationIssues.push({
        severity: 'warning',
        field: 'title',
        message: `Title exceeds recommended length (${C.TITLE_RECOMMENDED_MAX_LENGTH} chars)`,
        actual: title.length,
      });
    }
  });

  it('should generate a valid excerpt', async ({ skip }) => {
    if (!state.strapiReady || !state.json?.draft) {
      skip();
      return;
    }

    const excerpt = state.json.draft.excerpt;
    const C = ARTICLE_PLAN_CONSTRAINTS;

    expect(typeof excerpt).toBe('string');
    expect(excerpt.length).toBeGreaterThanOrEqual(C.EXCERPT_MIN_LENGTH);
    expect(excerpt.length).toBeLessThanOrEqual(C.EXCERPT_MAX_LENGTH);
  });

  it('should assign a valid category', async ({ skip }) => {
    if (!state.strapiReady || !state.json?.draft) {
      skip();
      return;
    }

    expect(VALID_CATEGORY_SLUGS).toContain(state.json.draft.categorySlug);
  });

  it('should generate valid tags', async ({ skip }) => {
    if (!state.strapiReady || !state.json?.draft) {
      skip();
      return;
    }

    const tags = state.json.draft.tags;
    const C = ARTICLE_PLAN_CONSTRAINTS;

    expect(Array.isArray(tags)).toBe(true);
    expect(tags.length).toBeGreaterThanOrEqual(C.MIN_TAGS);
    expect(tags.length).toBeLessThanOrEqual(C.MAX_TAGS);

    for (const tag of tags) {
      expect(typeof tag).toBe('string');
      expect(tag.trim().length).toBeGreaterThan(0);
      expect(tag.length).toBeLessThanOrEqual(C.TAG_MAX_LENGTH);
    }
  });

  it('should generate markdown content with proper structure', async ({ skip }) => {
    if (!state.strapiReady || !state.json?.draft) {
      skip();
      return;
    }

    const markdown = state.json.draft.markdown;
    const C = ARTICLE_PLAN_CONSTRAINTS;

    expect(typeof markdown).toBe('string');
    expect(markdown.length).toBeGreaterThanOrEqual(C.MIN_MARKDOWN_LENGTH);

    const analysis = analyzeMarkdownContent(markdown);

    if (analysis.sections.content < C.MIN_SECTIONS) {
      state.validationIssues.push({
        severity: 'warning',
        field: 'markdown.sections',
        message: `Only ${analysis.sections.content} H2 sections found (minimum ${C.MIN_SECTIONS})`,
        actual: analysis.sections.content,
      });
    }
  });

  it('should not contain placeholder text', async ({ skip }) => {
    if (!state.strapiReady || !state.json?.draft?.markdown) {
      skip();
      return;
    }

    const found = findPlaceholders(state.json.draft.markdown);
    state.qualityChecks.placeholders = found;

    for (const placeholder of found) {
      state.validationIssues.push({
        severity: 'error',
        field: 'markdown.content',
        message: `Article contains placeholder text: ${placeholder}`,
      });
    }

    expect(found.length).toBe(0);
  });

  it('should minimize AI clichés', async ({ skip }) => {
    if (!state.strapiReady || !state.json?.draft?.markdown) {
      skip();
      return;
    }

    const analysis = analyzeAiCliches(state.json.draft.markdown);
    state.qualityChecks.cliches = { found: analysis.found, total: analysis.totalOccurrences };

    if (analysis.found.length > 0) {
      state.validationIssues.push({
        severity: 'warning',
        field: 'markdown.content',
        message: `Article contains ${analysis.found.length} AI cliché(s): ${analysis.found.join(', ')}`,
      });
    }

    expect(analysis.found.length).toBeLessThan(5);
  });

  it('should collect valid sources', async ({ skip }) => {
    if (!state.strapiReady || !state.json?.draft) {
      skip();
      return;
    }

    const sources = state.json.draft.sources;

    expect(Array.isArray(sources)).toBe(true);

    if (sources.length === 0) {
      state.validationIssues.push({
        severity: 'warning',
        field: 'sources',
        message: 'No sources collected',
      });
    }

    for (const source of sources) {
      expect(typeof source).toBe('string');
    }
  });

  // ========================================================================
  // EXTERNAL RESEARCH VALIDATION
  // This test specifically validates that external research is working
  // ========================================================================

  it('should have collected sources (validates external research)', async ({ skip }) => {
    if (!state.strapiReady || !state.json?.draft) {
      skip();
      return;
    }

    const sources = state.json.draft.sources;

    // For a 2025 game, we MUST have external sources to write accurate content
    expect(Array.isArray(sources)).toBe(true);
    expect(sources.length).toBeGreaterThan(0);

    // Validate that sources contain URLs (indicating real web research was done)
    const urlSources = sources.filter((s: string) => s.startsWith('http'));
    expect(urlSources.length).toBeGreaterThan(0);

    // Log research stats for analysis
    state.validationIssues.push({
      severity: 'info',
      field: 'research.sources',
      message: `External research collected ${sources.length} sources (${urlSources.length} URLs)`,
    });
  });

  it('should include game-specific terminology in content (validates research quality)', async ({ skip }) => {
    if (!state.strapiReady || !state.json?.draft?.markdown) {
      skip();
      return;
    }

    const markdown = state.json.draft.markdown.toLowerCase();

    // These terms are specific to Clair Obscur: Expedition 33 and can only be known via research
    const gameSpecificTerms = [
      'simon', // The boss name
      'picto', // Equipment system
      'lumina', // Ability system
      // At least one character name should appear
      ['lune', 'verso', 'maelle', 'sciel', 'monoco', 'gustave'],
      // At least one mechanic should be mentioned
      ['parry', 'break', 'gradient', 'virtuose', 'foretell'],
    ];

    const foundTerms: string[] = [];
    const missingTerms: string[] = [];

    for (const term of gameSpecificTerms) {
      if (Array.isArray(term)) {
        // At least one of these alternatives should be present
        const found = term.some((t) => markdown.includes(t));
        if (found) {
          foundTerms.push(`[${term.join('|')}]`);
        } else {
          missingTerms.push(`[${term.join('|')}]`);
        }
      } else {
        if (markdown.includes(term)) {
          foundTerms.push(term);
        } else {
          missingTerms.push(term);
        }
      }
    }

    // Log what was found for analysis
    if (foundTerms.length > 0) {
      state.validationIssues.push({
        severity: 'info',
        field: 'research.gameTerms',
        message: `Found game-specific terms: ${foundTerms.join(', ')}`,
      });
    }

    if (missingTerms.length > 0) {
      state.validationIssues.push({
        severity: 'warning',
        field: 'research.gameTerms',
        message: `Missing expected game-specific terms: ${missingTerms.join(', ')}`,
      });
    }

    // At minimum, the boss name "Simon" should appear since that's what we asked for
    expect(markdown).toContain('simon');

    // We should have found at least 3 game-specific terms (demonstrating research worked)
    expect(foundTerms.length).toBeGreaterThanOrEqual(3);
  });

  it('should include complete metadata', async ({ skip }) => {
    if (!state.strapiReady || !state.json?.draft?.metadata) {
      skip();
      return;
    }

    const metadata = state.json.draft.metadata;

    expect(typeof metadata.generatedAt).toBe('string');
    expect(new Date(metadata.generatedAt).getTime()).not.toBeNaN();
    expect(typeof metadata.totalDurationMs).toBe('number');
    expect(metadata.totalDurationMs).toBeGreaterThan(0);
    expect(typeof metadata.correlationId).toBe('string');
    expect(VALID_CONFIDENCE_LEVELS).toContain(metadata.researchConfidence);

    const requiredPhases = ['scout', 'editor', 'specialist', 'validation'];
    for (const phase of requiredPhases) {
      expect(typeof metadata.phaseDurations[phase]).toBe('number');
    }
  });

  it('should track recovery metadata when retries occur', async ({ skip }) => {
    if (!state.strapiReady || !state.json?.draft?.metadata) {
      skip();
      return;
    }

    const recovery = state.json.draft.metadata.recovery;

    if (recovery) {
      expect(typeof recovery.planRetries).toBe('number');
      expect(typeof recovery.fixerIterations).toBe('number');
      expect(Array.isArray(recovery.fixesApplied)).toBe(true);

      if (recovery.planRetries > 0 || recovery.fixerIterations > 0) {
        state.validationIssues.push({
          severity: 'info',
          field: 'metadata.recovery',
          message: `Recovery applied: ${recovery.planRetries} plan retries, ${recovery.fixerIterations} fixer iterations`,
        });
      }
    }
  });

  it('should include a valid article plan', async ({ skip }) => {
    if (!state.strapiReady || !state.json?.draft?.plan) {
      skip();
      return;
    }

    const plan = state.json.draft.plan;

    expect(typeof plan.gameName).toBe('string');
    expect(plan.gameName.trim().length).toBeGreaterThan(0);
    expect(Array.isArray(plan.sections)).toBe(true);
    expect(plan.sections.length).toBeGreaterThan(0);

    for (const section of plan.sections) {
      expect(typeof section.headline).toBe('string');
      expect(typeof section.goal).toBe('string');
      expect(Array.isArray(section.researchQueries)).toBe(true);
    }
  });

  it('should specify models used for each agent', async ({ skip }) => {
    if (!state.strapiReady || !state.json?.models) {
      skip();
      return;
    }

    const agents = ['scout', 'editor', 'specialist'];

    for (const agent of agents) {
      expect(typeof state.json.models[agent]).toBe('string');
      expect(state.json.models[agent].length).toBeGreaterThan(0);
    }
  });

  it('should capture reviewer issues for analysis', async ({ skip }) => {
    if (!state.strapiReady || !state.json) {
      skip();
      return;
    }

    const issues = state.json.reviewerIssues || [];

    if (issues.length > 0) {
      const critical = issues.filter((i: any) => i.severity === 'critical').length;
      const major = issues.filter((i: any) => i.severity === 'major').length;
      const minor = issues.filter((i: any) => i.severity === 'minor').length;

      state.validationIssues.push({
        severity: 'info',
        field: 'reviewer.issues',
        message: `Reviewer found ${issues.length} issue(s): ${critical} critical, ${major} major, ${minor} minor`,
      });
    }
  });

  it('should create post in database', async ({ skip }) => {
    if (!state.strapiReady || !state.knex || !state.json?.post?.documentId) {
      skip();
      return;
    }

    const postRow = await state.knex('posts')
      .select('id', 'document_id', 'title', 'locale', 'published_at')
      .where({ document_id: state.json.post.documentId })
      .first();

    state.dbVerification.post.exists = Boolean(postRow);

    expect(postRow).toBeDefined();
    expect(postRow?.document_id).toBe(state.json.post.documentId);
    expect(postRow?.locale).toBe('en');
    expect(postRow?.published_at).toBeNull(); // Draft
  });

  it('should link post to game in database', async ({ skip }) => {
    if (!state.strapiReady || !state.knex || !state.json?.post?.documentId) {
      skip();
      return;
    }

    const postRow = await state.knex('posts')
      .select('id')
      .where({ document_id: state.json.post.documentId })
      .first();

    if (!postRow) {
      skip();
      return;
    }

    const linkTable = await findPostGameLinkTable(state.knex);
    expect(linkTable).toBeTruthy();

    if (!linkTable) return;

    const gameCols = await getTableColumns(state.knex, 'games');
    const igdbCol = gameCols.has('igdb_id') ? 'igdb_id' : gameCols.has('igdbId') ? 'igdbId' : null;

    if (!igdbCol) {
      skip();
      return;
    }

    const gameRows = await state.knex('games')
      .select('id')
      .where({ [igdbCol]: TEST_CONFIG.igdbId, locale: 'en' });

    expect(gameRows.length).toBeGreaterThan(0);

    const gameIds = gameRows.map((g: any) => Number(g.id));
    const linkCols = await getTableColumns(state.knex, linkTable);
    const postIdCol = linkCols.has('post_id') ? 'post_id' : linkCols.has('postId') ? 'postId' : null;
    const gameIdCol = linkCols.has('game_id') ? 'game_id' : linkCols.has('gameId') ? 'gameId' : null;

    if (!postIdCol || !gameIdCol) {
      skip();
      return;
    }

    const links = await state.knex(linkTable)
      .select('*')
      .where({ [postIdCol]: postRow.id })
      .whereIn(gameIdCol, gameIds);

    state.dbVerification.post.linkedToGame = links.length > 0;
    expect(links.length).toBeGreaterThan(0);
  });

  it('should import game with correct data', async ({ skip }) => {
    if (!state.strapiReady || !state.knex) {
      skip();
      return;
    }

    const gameCols = await getTableColumns(state.knex, 'games');
    const igdbCol = gameCols.has('igdb_id') ? 'igdb_id' : gameCols.has('igdbId') ? 'igdbId' : null;

    if (!igdbCol) {
      skip();
      return;
    }

    const gameRow = await state.knex('games')
      .select('name', 'description', 'locale', 'document_id')
      .where({ [igdbCol]: TEST_CONFIG.igdbId, locale: 'en' })
      .first();

    state.dbVerification.game.exists = Boolean(gameRow);
    state.dbVerification.game.hasDescription = Boolean(gameRow?.description?.length > 100);

    expect(gameRow).toBeDefined();
    expect(gameRow?.name).toContain(TEST_CONFIG.expectedNameContains);
    expect(gameRow?.description).toBeTruthy();
    expect(gameRow?.description?.length).toBeGreaterThan(100);
  });
});
