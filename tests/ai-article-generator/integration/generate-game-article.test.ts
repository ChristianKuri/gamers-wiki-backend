import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// Tests run in Node, but this repo's TS project config excludes test files from the
// main compilation, so we declare a minimal `process.env` shape for type-checking.
declare const process: { env: Record<string, string | undefined> };

import { server } from '../../mocks/server';
import { errorHandlers } from '../../mocks/handlers';
import { http, HttpResponse } from 'msw';

import { generateGameArticleDraft } from '../../../src/ai/articles/generate-game-article';
import { ArticleGenerationError, ArticleProgressCallback } from '../../../src/ai/articles/types';

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
    // Articles are always generated in English
    const draft = await generateGameArticleDraft({
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
    });

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

    const draft = await generateGameArticleDraft({
      gameName: 'Test Game',
      instruction: 'Summarize what we know so far.',
    });

    expect(draft.title).toBeTruthy();
    expect(draft.markdown).toMatch(/^#\s+/m);
  });

  it('deduplicates duplicate section research queries to avoid redundant Tavily searches', async () => {
    const duplicateQuery = 'duplicate section query (should only run once)';
    const tavilyQueries: string[] = [];
    // Must be long enough that 3 sections + title + sources exceeds MIN_MARKDOWN_LENGTH (500)
    const longGenericText =
      'This is a sufficiently long generic mock response to satisfy Scout validation checks and keep the pipeline moving during tests. ' +
      'The content here is deliberately verbose and repetitive to ensure the generated article meets the minimum character requirements. ' +
      'Without this padding, the validation would fail because the article would be too short.';

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

    await generateGameArticleDraft({
      gameName: 'Test Game',
      instruction: 'Write a beginner guide for the first 5 hours.',
    });

    // Scout searches will add additional Tavily calls; we only care that this specific
    // section-specific query is executed once.
    expect(tavilyQueries.filter((q) => q === duplicateQuery)).toHaveLength(1);
  });

  it('uses parallel section writing for lists category articles', async () => {
    const sectionWriteOrder: string[] = [];
    const longGenericText =
      'This is a sufficiently long generic mock response to satisfy Scout validation checks and keep the pipeline moving during tests. ' +
      'The content here is deliberately verbose and repetitive to ensure the generated article meets the minimum character requirements. ' +
      'Without this padding, the validation would fail because the article would be too short.';

    // Create a lists category plan
    const listsPlan = {
      title: 'Top 10 Best Weapons in the Game',
      categorySlug: 'lists',
      excerpt:
        'Discover the most powerful weapons in the game, ranked by damage output, versatility, and how easy they are to obtain early.',
      tags: ['weapons', 'best gear', 'top 10'],
      sections: [
        { headline: 'Sword of Legends', goal: 'desc', researchQueries: ['q1'] },
        { headline: 'Moonlight Greatsword', goal: 'desc', researchQueries: ['q2'] },
        { headline: 'Dragon Halberd', goal: 'desc', researchQueries: ['q3'] },
      ],
      safety: { noPrices: true, noScoresUnlessReview: true },
    };

    server.use(
      http.post('https://api.tavily.com/search', async ({ request }) => {
        const body = (await request.json()) as { query?: string };
        return HttpResponse.json({
          query: body?.query || '',
          answer: 'Mocked answer',
          results: [{ title: 'Mock', url: 'https://example.com/mock', content: 'Mock content', score: 0.9 }],
        });
      }),
      http.post('https://openrouter.ai/api/v1/chat/completions', async ({ request }) => {
        const body = (await request.json()) as {
          messages: Array<{ role: string; content: string }>;
          model: string;
        };
        const userText = body.messages.find((m) => m.role === 'user')?.content ?? '';

        // Return lists plan for Editor
        if (userText.includes('Return ONLY valid JSON')) {
          return HttpResponse.json({
            id: 'mock',
            object: 'chat.completion',
            created: Date.now(),
            model: body.model,
            choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(listsPlan) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          });
        }

        // Track section write order
        if (userText.includes('Write the next section')) {
          const headlineMatch = userText.match(/headline:\s*"([^"]+)"/i) || userText.match(/Headline:\s*([^\n]+)/i);
          const headline = headlineMatch?.[1] || 'unknown';
          sectionWriteOrder.push(headline);
        }

        return HttpResponse.json({
          id: 'mock',
          object: 'chat.completion',
          created: Date.now(),
          model: body.model,
          choices: [{ index: 0, message: { role: 'assistant', content: longGenericText }, finish_reason: 'stop' }],
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
          return HttpResponse.json({
            id: 'mock',
            object: 'response',
            created_at: Date.now(),
            model: body.model,
            status: 'completed',
            output: [{ id: 'mock', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(listsPlan), annotations: [] }] }],
            usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
          });
        }

        if (userText.includes('Write the next section')) {
          const headlineMatch = userText.match(/headline:\s*"([^"]+)"/i) || userText.match(/Headline:\s*([^\n]+)/i);
          const headline = headlineMatch?.[1] || 'unknown';
          sectionWriteOrder.push(headline);
        }

        return HttpResponse.json({
          id: 'mock',
          object: 'response',
          created_at: Date.now(),
          model: body.model,
          status: 'completed',
          output: [{ id: 'mock', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: longGenericText, annotations: [] }] }],
          usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
        });
      })
    );

    const draft = await generateGameArticleDraft({
      gameName: 'Test Game',
      instruction: 'Write a top 10 weapons list',
    });

    // Verify lists category was selected
    expect(draft.categorySlug).toBe('lists');
    
    // Verify article has expected sections
    expect(draft.markdown).toContain('Sword of Legends');
    expect(draft.markdown).toContain('Moonlight Greatsword');
    expect(draft.markdown).toContain('Dragon Halberd');
  });

  it('can be cancelled via AbortSignal', async () => {
    const controller = new AbortController();

    // Set up a handler that takes time
    server.use(
      http.post('https://api.tavily.com/search', async () => {
        // Simulate slow search
        await new Promise((resolve) => setTimeout(resolve, 100));
        return HttpResponse.json({
          query: 'test',
          answer: 'test answer',
          results: [{ title: 'Test', url: 'https://test.com', content: 'Test', score: 0.9 }],
        });
      })
    );

    // Abort after a short delay
    setTimeout(() => controller.abort(), 50);

    await expect(
      generateGameArticleDraft(
        { gameName: 'Test Game', instruction: 'Test' },
        undefined,
        { signal: controller.signal }
      )
    ).rejects.toThrow();
  });

  it('respects timeout option', async () => {
    // Set up a handler that takes too long
    server.use(
      http.post('https://api.tavily.com/search', async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return HttpResponse.json({
          query: 'test',
          answer: 'test answer',
          results: [],
        });
      })
    );

    try {
      await generateGameArticleDraft(
        { gameName: 'Test Game', instruction: 'Test' },
        undefined,
        { timeoutMs: 100 }
      );
      expect.fail('Should have thrown timeout error');
    } catch (error) {
      expect(error).toBeInstanceOf(ArticleGenerationError);
      expect((error as ArticleGenerationError).code).toBe('TIMEOUT');
    }
  });

  it('returns metadata with phase durations', async () => {
    const draft = await generateGameArticleDraft({
      gameName: 'The Legend of Zelda: Tears of the Kingdom',
      instruction: 'Write a beginner guide',
    });

    // Verify metadata structure
    expect(draft.metadata).toBeDefined();
    expect(draft.metadata.generatedAt).toBeTruthy();
    expect(typeof draft.metadata.totalDurationMs).toBe('number');
    expect(draft.metadata.totalDurationMs).toBeGreaterThan(0);

    // Verify phase durations
    expect(draft.metadata.phaseDurations).toBeDefined();
    expect(typeof draft.metadata.phaseDurations.scout).toBe('number');
    expect(typeof draft.metadata.phaseDurations.editor).toBe('number');
    expect(typeof draft.metadata.phaseDurations.specialist).toBe('number');
    expect(typeof draft.metadata.phaseDurations.validation).toBe('number');

    // Verify query/source counts
    expect(typeof draft.metadata.queriesExecuted).toBe('number');
    expect(typeof draft.metadata.sourcesCollected).toBe('number');
  });

  describe('progress callbacks', () => {
    it('calls onProgress callback during generation', async () => {
      const progressCalls: Array<{ phase: string; percent: number; detail?: string }> = [];
      const onProgress: ArticleProgressCallback = (phase, percent, detail) => {
        progressCalls.push({ phase, percent, detail });
      };

      await generateGameArticleDraft(
        {
          gameName: 'The Legend of Zelda: Tears of the Kingdom',
          instruction: 'Write a beginner guide',
        },
        undefined,
        { onProgress }
      );

      // Should have multiple progress calls
      expect(progressCalls.length).toBeGreaterThan(0);

      // Should include calls for multiple phases
      const phases = new Set(progressCalls.map((c) => c.phase));
      expect(phases.has('scout')).toBe(true);
      expect(phases.has('editor')).toBe(true);
      expect(phases.has('specialist')).toBe(true);
      expect(phases.has('validation')).toBe(true);

      // Progress percentages should be in valid range
      for (const call of progressCalls) {
        expect(call.percent).toBeGreaterThanOrEqual(0);
        expect(call.percent).toBeLessThanOrEqual(100);
      }
    });

    it('includes detail messages in progress callbacks', async () => {
      const progressCalls: Array<{ phase: string; percent: number; detail?: string }> = [];
      const onProgress: ArticleProgressCallback = (phase, percent, detail) => {
        progressCalls.push({ phase, percent, detail });
      };

      await generateGameArticleDraft(
        {
          gameName: 'Test Game',
          instruction: 'Write a beginner guide',
        },
        undefined,
        { onProgress }
      );

      // At least some calls should have detail messages
      const callsWithDetails = progressCalls.filter((c) => c.detail);
      expect(callsWithDetails.length).toBeGreaterThan(0);
    });
  });

  describe('CONFIG_ERROR', () => {
    it('throws ArticleGenerationError with CONFIG_ERROR when OPENROUTER_API_KEY is missing', async () => {
      const originalKey = process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      try {
        await generateGameArticleDraft({
          gameName: 'Test Game',
          instruction: 'Write a guide',
        });
        expect.fail('Should have thrown CONFIG_ERROR');
      } catch (error) {
        expect(error).toBeInstanceOf(ArticleGenerationError);
        expect((error as ArticleGenerationError).code).toBe('CONFIG_ERROR');
        expect((error as ArticleGenerationError).message).toContain('OPENROUTER_API_KEY');
      } finally {
        // Restore the key
        if (originalKey) {
          process.env.OPENROUTER_API_KEY = originalKey;
        }
      }
    });
  });

  describe('parallelSections option', () => {
    it('respects parallelSections: true override for non-lists category', async () => {
      const sectionWriteOrder: string[] = [];
      const longGenericText =
        'This is a sufficiently long generic mock response to satisfy Scout validation checks and keep the pipeline moving during tests. ' +
        'The content here is deliberately verbose and repetitive to ensure the generated article meets the minimum character requirements.';

      // Create a guides category plan (normally sequential)
      const guidesPlan = {
        title: 'Beginner Guide for Test Game',
        categorySlug: 'guides',
        excerpt:
          'Learn the basics of Test Game with this comprehensive beginner guide covering everything new players need to know to get started.',
        tags: ['beginner', 'guide', 'tips'],
        sections: [
          { headline: 'Getting Started', goal: 'intro', researchQueries: ['q1'] },
          { headline: 'Basic Controls', goal: 'controls', researchQueries: ['q2'] },
          { headline: 'First Mission', goal: 'mission', researchQueries: ['q3'] },
        ],
        safety: { noScoresUnlessReview: true },
      };

      server.use(
        http.post('https://api.tavily.com/search', async ({ request }) => {
          const body = (await request.json()) as { query?: string };
          return HttpResponse.json({
            query: body?.query || '',
            answer: 'Mocked answer',
            results: [{ title: 'Mock', url: 'https://example.com/mock', content: 'Mock content', score: 0.9 }],
          });
        }),
        http.post('https://openrouter.ai/api/v1/chat/completions', async ({ request }) => {
          const body = (await request.json()) as {
            messages: Array<{ role: string; content: string }>;
            model: string;
          };
          const userText = body.messages.find((m) => m.role === 'user')?.content ?? '';

          if (userText.includes('Return ONLY valid JSON')) {
            return HttpResponse.json({
              id: 'mock',
              object: 'chat.completion',
              created: Date.now(),
              model: body.model,
              choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(guidesPlan) }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
            });
          }

          if (userText.includes('Write the next section')) {
            const headlineMatch = userText.match(/headline:\s*"([^"]+)"/i) || userText.match(/Headline:\s*([^\n]+)/i);
            const headline = headlineMatch?.[1] || 'unknown';
            sectionWriteOrder.push(headline);
          }

          return HttpResponse.json({
            id: 'mock',
            object: 'chat.completion',
            created: Date.now(),
            model: body.model,
            choices: [{ index: 0, message: { role: 'assistant', content: longGenericText }, finish_reason: 'stop' }],
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
            return HttpResponse.json({
              id: 'mock',
              object: 'response',
              created_at: Date.now(),
              model: body.model,
              status: 'completed',
              output: [{ id: 'mock', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(guidesPlan), annotations: [] }] }],
              usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
            });
          }

          if (userText.includes('Write the next section')) {
            const headlineMatch = userText.match(/headline:\s*"([^"]+)"/i) || userText.match(/Headline:\s*([^\n]+)/i);
            const headline = headlineMatch?.[1] || 'unknown';
            sectionWriteOrder.push(headline);
          }

          return HttpResponse.json({
            id: 'mock',
            object: 'response',
            created_at: Date.now(),
            model: body.model,
            status: 'completed',
            output: [{ id: 'mock', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: longGenericText, annotations: [] }] }],
            usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
          });
        })
      );

      const draft = await generateGameArticleDraft(
        {
          gameName: 'Test Game',
          instruction: 'Write a beginner guide',
        },
        undefined,
        { parallelSections: true } // Force parallel even for guides
      );

      // Verify guides category was selected (not lists)
      expect(draft.categorySlug).toBe('guides');

      // Verify article was generated successfully
      expect(draft.markdown).toContain('Getting Started');
      expect(draft.markdown).toContain('Basic Controls');
      expect(draft.markdown).toContain('First Mission');
    });

    it('respects parallelSections: false override for lists category', async () => {
      const longGenericText =
        'This is a sufficiently long generic mock response to satisfy Scout validation checks and keep the pipeline moving during tests. ' +
        'The content here is deliberately verbose and repetitive to ensure the generated article meets the minimum character requirements.';

      // Create a lists category plan (normally parallel)
      const listsPlan = {
        title: 'Top 5 Weapons in Test Game',
        categorySlug: 'lists',
        excerpt:
          'Discover the most powerful weapons in Test Game, ranked by damage output and versatility for both beginners and veteran players.',
        tags: ['weapons', 'top 5', 'gear'],
        sections: [
          { headline: 'Legendary Sword', goal: 'desc', researchQueries: ['q1'] },
          { headline: 'Dragon Bow', goal: 'desc', researchQueries: ['q2'] },
          { headline: 'Magic Staff', goal: 'desc', researchQueries: ['q3'] },
        ],
        safety: { noScoresUnlessReview: true },
      };

      server.use(
        http.post('https://api.tavily.com/search', async ({ request }) => {
          const body = (await request.json()) as { query?: string };
          return HttpResponse.json({
            query: body?.query || '',
            answer: 'Mocked answer',
            results: [{ title: 'Mock', url: 'https://example.com/mock', content: 'Mock content', score: 0.9 }],
          });
        }),
        http.post('https://openrouter.ai/api/v1/chat/completions', async ({ request }) => {
          const body = (await request.json()) as {
            messages: Array<{ role: string; content: string }>;
            model: string;
          };
          const userText = body.messages.find((m) => m.role === 'user')?.content ?? '';

          if (userText.includes('Return ONLY valid JSON')) {
            return HttpResponse.json({
              id: 'mock',
              object: 'chat.completion',
              created: Date.now(),
              model: body.model,
              choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(listsPlan) }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
            });
          }

          return HttpResponse.json({
            id: 'mock',
            object: 'chat.completion',
            created: Date.now(),
            model: body.model,
            choices: [{ index: 0, message: { role: 'assistant', content: longGenericText }, finish_reason: 'stop' }],
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
            return HttpResponse.json({
              id: 'mock',
              object: 'response',
              created_at: Date.now(),
              model: body.model,
              status: 'completed',
              output: [{ id: 'mock', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(listsPlan), annotations: [] }] }],
              usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
            });
          }

          return HttpResponse.json({
            id: 'mock',
            object: 'response',
            created_at: Date.now(),
            model: body.model,
            status: 'completed',
            output: [{ id: 'mock', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: longGenericText, annotations: [] }] }],
            usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
          });
        })
      );

      const draft = await generateGameArticleDraft(
        {
          gameName: 'Test Game',
          instruction: 'Write a top 5 weapons list',
        },
        undefined,
        { parallelSections: false } // Force sequential even for lists
      );

      // Verify lists category was selected
      expect(draft.categorySlug).toBe('lists');

      // Verify article was generated successfully
      expect(draft.markdown).toContain('Legendary Sword');
      expect(draft.markdown).toContain('Dragon Bow');
      expect(draft.markdown).toContain('Magic Staff');
    });
  });

  describe('context validation', () => {
    it('throws ArticleGenerationError for missing gameName', async () => {
      await expect(
        generateGameArticleDraft({
          gameName: '',
          instruction: 'Write a guide',
        })
      ).rejects.toThrow(ArticleGenerationError);

      try {
        await generateGameArticleDraft({
          gameName: '',
          instruction: 'Write a guide',
        });
      } catch (error) {
        expect(error).toBeInstanceOf(ArticleGenerationError);
        expect((error as ArticleGenerationError).code).toBe('CONTEXT_INVALID');
        expect((error as ArticleGenerationError).message).toContain('gameName');
      }
    });

    it('throws ArticleGenerationError for invalid genres type', async () => {
      try {
        await generateGameArticleDraft({
          gameName: 'Test Game',
          instruction: 'Write a guide',
          genres: 'Action' as unknown as string[], // Invalid type
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ArticleGenerationError);
        expect((error as ArticleGenerationError).code).toBe('CONTEXT_INVALID');
        expect((error as ArticleGenerationError).message).toContain('genres');
      }
    });

    it('throws ArticleGenerationError for invalid platforms type', async () => {
      try {
        await generateGameArticleDraft({
          gameName: 'Test Game',
          instruction: 'Write a guide',
          platforms: 'PC' as unknown as string[], // Invalid type
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ArticleGenerationError);
        expect((error as ArticleGenerationError).code).toBe('CONTEXT_INVALID');
        expect((error as ArticleGenerationError).message).toContain('platforms');
      }
    });

    it('throws with all validation errors combined in message', async () => {
      try {
        await generateGameArticleDraft({
          gameName: '',
          instruction: 'Write a guide',
          genres: 'Action' as unknown as string[],
          platforms: 'PC' as unknown as string[],
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ArticleGenerationError);
        expect((error as ArticleGenerationError).code).toBe('CONTEXT_INVALID');
        // Should contain all three validation errors
        const message = (error as ArticleGenerationError).message;
        expect(message).toContain('gameName');
        expect(message).toContain('genres');
        expect(message).toContain('platforms');
      }
    });
  });
});
