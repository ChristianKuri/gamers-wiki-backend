import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

// Tests run in Node, but this repo's TS project config excludes test files from the
// main compilation, so we declare a minimal `process.env` shape for type-checking.
declare const process: { env: Record<string, string | undefined> };

import { server } from '../../mocks/server';
import { errorHandlers } from '../../mocks/handlers';
import { http, HttpResponse } from 'msw';

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

  afterEach(() => {
    server.resetHandlers();
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

  it('deduplicates duplicate section research queries to avoid redundant Tavily searches', async () => {
    const duplicateQuery = 'duplicate section query (should only run once)';
    const tavilyQueries: string[] = [];
    const longGenericText =
      'This is a sufficiently long generic mock response to satisfy Scout validation checks and keep the pipeline moving during tests.';

    server.use(
      http.post('https://api.tavily.com/search', async ({ request }) => {
        const body = (await request.json()) as { query?: string };
        const query = body?.query || '';
        tavilyQueries.push(query);

        return HttpResponse.json({
          query,
          answer: 'Mocked Tavily answer',
          results: [
            {
              title: 'Mock source',
              url: 'https://example.com/mock',
              content: 'Mock content for dedupe test.',
              score: 0.9,
            },
          ],
        });
      }),
      http.post('https://openrouter.ai/api/v1/chat/completions', async ({ request }) => {
        const body = (await request.json()) as {
          messages: Array<{ role: string; content: string }>;
          model: string;
        };
        const userText = body.messages.find((m) => m.role === 'user')?.content ?? '';

        // Only override the Editor plan generation; allow everything else to be generic.
        if (userText.includes('Return ONLY valid JSON')) {
          const plan = {
            title: 'Test Plan With Duplicate Queries',
            categorySlug: 'guides',
            excerpt:
              'This is a test excerpt that is deliberately between 120 and 160 characters to satisfy the schema constraints for validation.',
            tags: ['test'],
            sections: [
              { headline: 'A', goal: 'g', researchQueries: [duplicateQuery] },
              { headline: 'B', goal: 'g', researchQueries: [duplicateQuery] },
              { headline: 'C', goal: 'g', researchQueries: [duplicateQuery] },
            ],
            safety: { noPrices: true, noScoresUnlessReview: true },
          };

          return HttpResponse.json({
            id: 'mock-completion-id',
            object: 'chat.completion',
            created: Date.now(),
            model: body.model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: JSON.stringify(plan) },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          });
        }

        return HttpResponse.json({
          id: 'mock-completion-id',
          object: 'chat.completion',
          created: Date.now(),
          model: body.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: longGenericText },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        });
      }),
      http.post('https://openrouter.ai/api/v1/responses', async ({ request }) => {
        const body = (await request.json()) as {
          input: Array<{ role: string; content: string | Array<{ type: string; text: string }> }>;
          model: string;
        };

        const messages = body.input.map((msg) => {
          const content =
            typeof msg.content === 'string'
              ? msg.content
              : (msg.content as Array<{ type: string; text: string }>)?.[0]?.text || '';
          return { role: msg.role, content };
        });

        const userText = messages.find((m) => m.role === 'user')?.content ?? '';

        if (userText.includes('Return ONLY valid JSON')) {
          const plan = {
            title: 'Test Plan With Duplicate Queries',
            categorySlug: 'guides',
            excerpt:
              'This is a test excerpt that is deliberately between 120 and 160 characters to satisfy the schema constraints for validation.',
            tags: ['test'],
            sections: [
              { headline: 'A', goal: 'g', researchQueries: [duplicateQuery] },
              { headline: 'B', goal: 'g', researchQueries: [duplicateQuery] },
              { headline: 'C', goal: 'g', researchQueries: [duplicateQuery] },
            ],
            safety: { noPrices: true, noScoresUnlessReview: true },
          };

          const planJson = JSON.stringify(plan);

          return HttpResponse.json({
            id: 'mock-response-id',
            object: 'response',
            created_at: Date.now(),
            model: body.model,
            status: 'completed',
            output: [
              {
                id: 'mock-output-id',
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: planJson, annotations: [] }],
              },
            ],
            usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
          });
        }

        return HttpResponse.json({
          id: 'mock-response-id',
          object: 'response',
          created_at: Date.now(),
          model: body.model,
          status: 'completed',
          output: [
            {
              id: 'mock-output-id',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: longGenericText, annotations: [] }],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
        });
      })
    );

    await generateGameArticleDraft(
      {
        gameName: 'Test Game',
        instruction: 'Write a beginner guide for the first 5 hours.',
      },
      'en'
    );

    // Scout searches will add additional Tavily calls; we only care that this specific
    // section-specific query is executed once.
    expect(tavilyQueries.filter((q) => q === duplicateQuery)).toHaveLength(1);
  });
});
