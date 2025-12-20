import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { server } from '../../mocks/server';
import { errorHandlers } from '../../mocks/handlers';

import { generateGameArticleDraft } from '../../../src/ai/articles/generate-game-article';

describe('generateGameArticleDraft (integration-ish)', () => {
  const envBackup = { ...process.env };

  beforeAll(() => {
    // Ensure Tavily wrapper actually calls the (mocked) API instead of
    // short-circuiting due to missing API key.
    process.env.TAVILY_API_KEY = 'test-tavily-key';
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-openrouter-key';
    server.listen();
  });

  afterAll(() => {
    process.env = envBackup;
    server.close();
  });

  it('generates a draft with markdown headings and Sources section (Tavily mocked)', async () => {
    const draft = await generateGameArticleDraft(
      {
        gameName: 'The Legend of Zelda: Tears of the Kingdom',
        gameSlug: 'the-legend-of-zelda-tears-of-the-kingdom',
        releaseDate: '2023-05-12',
        genres: ['Adventure', 'Action'],
        platforms: ['Nintendo Switch'],
        developer: 'Nintendo',
        publisher: 'Nintendo',
        igdbDescription: 'A sequel to Breath of the Wild.',
        instruction: 'Write a beginner guide for the first 5 hours.',
        categoryHints: [
          { slug: 'news', systemPrompt: 'Time-sensitive reporting and announcements.' },
          { slug: 'reviews', systemPrompt: 'Critical evaluation (no numeric score required).' },
          { slug: 'guides', systemPrompt: 'Step-by-step help and actionable tips.' },
          { slug: 'lists', systemPrompt: 'Ranked or curated lists.' },
        ],
      },
      'en'
    );

    expect(draft.title).toBeTruthy();
    expect(['news', 'reviews', 'guides', 'lists']).toContain(draft.categorySlug);

    // Markdown shape
    expect(draft.markdown).toMatch(/^#\s+/m);
    expect(draft.markdown).toMatch(/^##\s+/m);
    expect(draft.markdown).toMatch(/^##\s+Sources\s*$/m);

    // Sources captured
    expect(draft.sources.length).toBeGreaterThan(0);
  });

  it('gracefully handles Tavily errors (still returns markdown)', async () => {
    server.use(errorHandlers.tavilyError);

    const draft = await generateGameArticleDraft(
      {
        gameName: 'Test Game',
        instruction: 'Summarize what we know so far.',
      },
      'en'
    );

    expect(draft.title).toBeTruthy();
    expect(draft.markdown).toMatch(/^#\s+/m);
  });
});
