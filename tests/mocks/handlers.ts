/**
 * MSW Request Handlers
 * 
 * Mock handlers for external API calls (OpenRouter, IGDB)
 */

import { http, HttpResponse } from 'msw';

// Sample AI-generated descriptions for testing
const MOCK_DESCRIPTIONS = {
  platform: {
    en: `The **Nintendo Switch** revolutionized gaming by introducing a truly hybrid architecture that seamlessly transitions between home console and portable gaming. Launched in March 2017, this innovative platform from Nintendo captured the imagination of players worldwide with its unique design philosophy.

The console features detachable **Joy-Con controllers** that offer multiple play styles, from traditional handheld gaming to tabletop multiplayer experiences. Its **custom NVIDIA Tegra processor** delivers impressive performance whether docked or in portable mode.

Notable exclusives like *The Legend of Zelda: Breath of the Wild*, *Super Mario Odyssey*, and *Animal Crossing: New Horizons* showcase the platform's versatility and Nintendo's continued commitment to innovative gameplay experiences.`,
    es: `La **Nintendo Switch** redefinió el concepto de consola de videojuegos al ofrecer una experiencia de juego verdaderamente híbrida. Lanzada en marzo de 2017, esta innovadora plataforma de Nintendo permite a los jugadores alternar sin problemas entre el juego en televisor y el modo portátil.

La consola cuenta con los controladores **Joy-Con** desmontables que ofrecen múltiples estilos de juego. Su **procesador NVIDIA Tegra personalizado** ofrece un rendimiento impresionante tanto en modo dock como en modo portátil.

Exclusivos destacados como *The Legend of Zelda: Breath of the Wild*, *Super Mario Odyssey* y *Animal Crossing: New Horizons* demuestran la versatilidad de la plataforma.`,
  },
  game: {
    en: `**The Legend of Zelda: Tears of the Kingdom** stands as a monumental achievement in open-world game design, building upon the revolutionary foundation of its predecessor while introducing groundbreaking mechanics that redefine player creativity. Developed by **Nintendo EPD**, this sequel expands the beloved Hyrule in ways both vertical and mechanical.

The game introduces the **Ultrahand** ability, allowing players to fuse objects together to create vehicles, weapons, and contraptions limited only by imagination. Combined with **Ascend** for vertical traversal and **Fuse** for weapon enhancement, these systems create an unprecedented sandbox of possibilities.

Set across a transformed Hyrule that now includes mysterious sky islands and dangerous depths below, players embark on an epic journey to uncover the secrets of the Zonai civilization and rescue Princess Zelda. The seamless integration of physics-based puzzles with combat and exploration creates a cohesive experience that rewards curiosity and experimentation.

Veterans of *Breath of the Wild* and newcomers alike will find endless hours of adventure in this masterfully crafted world, cementing the Zelda franchise's position at the pinnacle of action-adventure gaming.`,
    es: `**The Legend of Zelda: Tears of the Kingdom** representa un logro monumental en el diseño de mundos abiertos, construyendo sobre la base revolucionaria de su predecesor mientras introduce mecánicas innovadoras que redefinen la creatividad del jugador. Desarrollado por **Nintendo EPD**, esta secuela expande el querido Hyrule de maneras tanto verticales como mecánicas.

El juego introduce la habilidad **Ultrahand**, que permite a los jugadores fusionar objetos para crear vehículos, armas y artilugios limitados solo por la imaginación. Combinado con **Ascend** para el desplazamiento vertical y **Fuse** para mejorar armas, estos sistemas crean un sandbox de posibilidades sin precedentes.

Ambientado en un Hyrule transformado que ahora incluye misteriosas islas del cielo y peligrosas profundidades, los jugadores emprenden una épica aventura para descubrir los secretos de la civilización Zonai y rescatar a la Princesa Zelda.

Tanto los veteranos de *Breath of the Wild* como los recién llegados encontrarán horas interminables de aventura en este mundo magistralmente creado.`,
  },
};

const MOCK_TAVILY_RESULTS = {
  answer:
    'Brief factual overview for the requested query. This is a mocked Tavily answer.',
  results: [
    {
      title: 'Official game website',
      url: 'https://example.com/official',
      content: 'Official overview, platforms, and latest announcements.',
      score: 0.92,
    },
    {
      title: 'Patch notes',
      url: 'https://example.com/patch-notes',
      content: 'Recent patch notes and balance updates.',
      score: 0.81,
    },
    {
      title: 'Developer interview',
      url: 'https://example.com/interview',
      content: 'Interview discussing design goals and player feedback.',
      score: 0.74,
    },
  ],
};

const MOCK_EXA_RESULTS = {
  results: [
    {
      title: 'How to Master Early Game Mechanics - Wiki Guide',
      url: 'https://wiki.example.com/early-game-guide',
      text: 'Comprehensive guide covering all early game mechanics. Start by understanding the core abilities and how they interact with each other.',
      score: 0.95,
      publishedDate: '2024-06-15',
      author: 'WikiContributor',
    },
    {
      title: 'Essential Tips for Beginners - Community Forum',
      url: 'https://forum.example.com/tips',
      text: 'Collection of tips gathered from the community. Focus on exploration before combat and gather resources early.',
      score: 0.88,
    },
    {
      title: 'Advanced Strategy Guide',
      url: 'https://ign.example.com/strategy',
      text: 'In-depth strategies for progressing through the main quest line efficiently while maximizing your character build.',
      score: 0.82,
    },
  ],
  autopromptString: 'how to master early game mechanics and tips for beginners',
};

/**
 * Detect if the prompt is for a platform or game description
 */
function detectContentType(messages: Array<{ role: string; content: string }>): 'platform' | 'game' {
  const userMessage = messages.find(m => m.role === 'user')?.content || '';
  // Keep this intentionally narrow. Other prompts (like article generation)
  // may contain the word "platforms" but are not platform-description tasks.
  if (userMessage.includes('Platform:')) {
    return 'platform';
  }
  return 'game';
}

function getUserText(messages: Array<{ role: string; content: string }>): string {
  return messages.find(m => m.role === 'user')?.content || '';
}

function isArticlePlanPrompt(userText: string): boolean {
  // Various prompt formats for article plans:
  // - Category-specific: "Create a COMPLETE guide plan for" (guides), "Create a COMPLETE review plan for" (reviews), etc.
  // - Generic: "Design an article plan for" (auto-detect mode)
  // - Legacy: "Plan an article about the game", "Return ONLY valid JSON"
  return (
    userText.includes('Plan an article about the game') ||
    userText.includes('Return ONLY valid JSON') ||
    userText.includes('categorySlug must be one of') ||
    userText.includes('Create a COMPLETE guide plan for') ||
    userText.includes('Create a COMPLETE review plan for') ||
    userText.includes('Create a COMPLETE news plan for') ||
    userText.includes('Create a COMPLETE list plan for') ||
    userText.includes('=== OUTPUT REQUIREMENTS ===') ||
    userText.includes('Design an article plan for') ||
    userText.includes('=== STRUCTURAL REQUIREMENTS ===')
  );
}

function isArticleSectionPrompt(userText: string): boolean {
  // New format: "Write section X of Y for a guide about..."
  // Old format: "Write the next section of a game article"
  return (
    userText.includes('Write the next section of a game article') ||
    /Write section \d+ of \d+ for a (guide|review|news|list)/i.test(userText)
  );
}

function isScoutBriefingPrompt(userText: string): boolean {
  return userText.toLowerCase().includes('briefing document');
}

function isReviewerPrompt(userText: string): boolean {
  const lower = userText.toLowerCase();
  // Must have both PLAN DETAILS and ARTICLE CONTENT markers - unique to Reviewer prompt
  // The prompt starts with "Review this GUIDE/LIST/etc article draft"
  return (
    (lower.includes('review this') && lower.includes('article draft')) &&
    (lower.includes('=== plan details ===') || lower.includes('=== article plan ===')) &&
    (lower.includes('=== article content ==='))
  );
}

/**
 * Build a mock Reviewer response that matches the ReviewerOutputSchema
 */
function buildMockReviewerResponse() {
  return {
    approved: true,
    issues: [
      {
        severity: 'minor',
        category: 'style',
        location: 'Common Mistakes',
        message: 'Consider adding more specific examples in the "Common Mistakes" section.',
        suggestion: 'Add concrete examples of common mistakes players make.',
        fixStrategy: 'expand',
        fixInstruction: 'Add 2-3 concrete examples of common mistakes players make, such as "forgetting to save before boss fights" or "selling unique items".',
      },
    ],
    suggestions: [
      'Consider adding screenshots to illustrate key points.',
    ],
  };
}

function buildMockArticlePlan(locale: 'en' | 'es', category: 'guides' | 'lists' = 'guides') {
  if (category === 'lists') {
    // Must have at least 4 sections (MIN_SECTIONS = 4)
    return {
      title: 'Top 10 Best Weapons in the Game',
      categorySlug: 'lists',
      excerpt:
        'Discover the most powerful weapons in the game, ranked by damage output, versatility, and how easy they are to obtain in the early game.',
      tags: ['weapons', 'best gear', 'top 10', 'rankings'],
      requiredElements: [
        'Sword of Legends stats and location',
        'Moonlight Greatsword location',
        'Dragon Halberd requirements',
        'Shadow Dagger build info',
      ],
      sections: [
        {
          headline: 'Sword of Legends',
          goal: 'Describe the top-ranked weapon.',
          researchQueries: ['best weapon damage stats'],
          mustCover: ['Sword of Legends stats and location'],
        },
        {
          headline: 'Moonlight Greatsword',
          goal: 'Describe the second weapon.',
          researchQueries: ['moonlight greatsword location'],
          mustCover: ['Moonlight Greatsword location'],
        },
        {
          headline: 'Dragon Halberd',
          goal: 'Describe the third weapon.',
          researchQueries: ['dragon halberd requirements'],
          mustCover: ['Dragon Halberd requirements'],
        },
        {
          headline: 'Shadow Dagger',
          goal: 'Describe the fourth weapon.',
          researchQueries: ['shadow dagger build'],
          mustCover: ['Shadow Dagger build info'],
        },
      ],
      safety: { noPrices: true, noScoresUnlessReview: true },
    };
  }

  if (locale === 'es') {
    return {
      title: 'Guía para principiantes: primeras 5 horas',
      categorySlug: 'guides',
      excerpt:
        'Empieza fuerte con rutas seguras, mejoras clave y los errores más comunes durante tus primeras horas, para progresar más rápido y evitar frustraciones.',
      tags: ['principiantes', 'primeras horas', 'consejos'],
      requiredElements: [
        'Ruta inicial segura',
        'Elección de clase',
        'Estadísticas prioritarias',
        'Errores comunes',
      ],
      sections: [
        {
          headline: 'Qué hacer primero',
          goal: 'Dar una ruta inicial segura y prioridades claras.',
          researchQueries: ['mejor ruta inicio primeras horas guia'],
          mustCover: ['Ruta inicial segura'],
        },
        {
          headline: 'Clase inicial y recuerdo',
          goal: 'Explicar elecciones iniciales y su impacto.',
          researchQueries: ['mejor clase inicial recomendación'],
          mustCover: ['Elección de clase'],
        },
        {
          headline: 'Subir de nivel y prioridades',
          goal: 'Enseñar prioridades de estadísticas y objetivos tempranos.',
          researchQueries: ['recomendación vigor temprano'],
          mustCover: ['Estadísticas prioritarias'],
        },
        {
          headline: 'Errores a evitar',
          goal: 'Listar errores típicos y cómo corregirlos.',
          researchQueries: ['errores comunes principiantes'],
          mustCover: ['Errores comunes'],
        },
      ],
      safety: { noPrices: true, noScoresUnlessReview: true },
    };
  }

  return {
    title: 'Beginner Guide: Your First 5 Hours',
    categorySlug: 'guides',
    excerpt:
      'Start strong with safe routes, key upgrades, and the most common mistakes to avoid in your first hours—so you level faster, stay alive, and enjoy the opening.',
    tags: ['beginner tips', 'early game', 'progression'],
    requiredElements: [
      'Safe opening route and priorities',
      'Starting class selection',
      'Core stat priorities',
      'Common beginner mistakes',
    ],
    sections: [
      {
        headline: 'What to Do First',
        goal: 'Give a safe opening path and immediate priorities.',
        researchQueries: ['best early game route first hours guide'],
        mustCover: ['Safe opening route and priorities'],
      },
      {
        headline: 'Starter Class and Keepsake',
        goal: 'Explain starter choices and why they matter.',
        researchQueries: ['best starting class recommendation'],
        mustCover: ['Starting class selection'],
      },
      {
        headline: 'Leveling and Stat Priorities',
        goal: 'Teach core stats and early targets.',
        researchQueries: ['early game vigor recommendation'],
        mustCover: ['Core stat priorities'],
      },
      {
        headline: 'Common Mistakes to Avoid',
        goal: 'List typical beginner mistakes and fixes.',
        researchQueries: ['common beginner mistakes'],
        mustCover: ['Common beginner mistakes'],
      },
    ],
    safety: { noPrices: true, noScoresUnlessReview: true },
  };
}

/**
 * Detect the locale from the prompt
 */
function detectLocale(messages: Array<{ role: string; content: string }>): 'en' | 'es' {
  const userMessage = messages.find(m => m.role === 'user')?.content || '';
  if (userMessage.includes('Spanish') || userMessage.includes('español')) {
    return 'es';
  }
  return 'en';
}

export const handlers = [
  /**
   * Mock Tavily search API
   */
  http.post('https://api.tavily.com/search', async ({ request }) => {
    const body = (await request.json()) as { query?: string };
    const query = body?.query || '';
    return HttpResponse.json({
      query,
      ...MOCK_TAVILY_RESULTS,
    });
  }),
  /**
   * Mock Exa search API
   */
  http.post('https://api.exa.ai/search', async ({ request }) => {
    const body = (await request.json()) as { query?: string };
    const query = body?.query || '';
    return HttpResponse.json({
      ...MOCK_EXA_RESULTS,
      // Include the original query in results
      autopromptString: MOCK_EXA_RESULTS.autopromptString || query,
    });
  }),
  /**
   * Mock Exa findSimilar API
   */
  http.post('https://api.exa.ai/findSimilar', async ({ request }) => {
    const body = (await request.json()) as { url?: string };
    const url = body?.url || '';
    return HttpResponse.json({
      results: MOCK_EXA_RESULTS.results.map((r) => ({
        ...r,
        // Adjust URLs to show they're "similar" results
        url: r.url.replace('example.com', 'similar.example.com'),
      })),
    });
  }),
  /**
   * Mock OpenRouter API (chat completions - legacy format)
   */
  http.post('https://openrouter.ai/api/v1/chat/completions', async ({ request }) => {
    const body = await request.json() as { 
      messages: Array<{ role: string; content: string }>;
      model: string;
    };
    const locale = detectLocale(body.messages);
    const userText = getUserText(body.messages);

    // Check Reviewer FIRST - it contains article plan info, so isArticlePlanPrompt would match it
    if (isReviewerPrompt(userText)) {
      return HttpResponse.json({
        id: 'mock-completion-id',
        object: 'chat.completion',
        created: Date.now(),
        model: body.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify(buildMockReviewerResponse()),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 200, completion_tokens: 150, total_tokens: 350 },
      });
    }

    // Article generator planner (generateText) expects raw JSON string
    if (isArticlePlanPrompt(userText)) {
      return HttpResponse.json({
        id: 'mock-completion-id',
        object: 'chat.completion',
        created: Date.now(),
        model: body.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify(buildMockArticlePlan(locale)),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      });
    }

    // Article generator section writer
    if (isArticleSectionPrompt(userText)) {
      return HttpResponse.json({
        id: 'mock-completion-id',
        object: 'chat.completion',
        created: Date.now(),
        model: body.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content:
                locale === 'es'
                  ? 'Este es un párrafo de ejemplo con **énfasis** y continuidad.\\n\\nOtro párrafo con detalles prudentes basados en investigación simulada.'
                  : 'This is a sample paragraph with **emphasis** and continuity.\\n\\nAnother paragraph with careful details based on mocked research.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      });
    }

    // Scout briefing
    if (isScoutBriefingPrompt(userText)) {
      return HttpResponse.json({
        id: 'mock-completion-id',
        object: 'chat.completion',
        created: Date.now(),
        model: body.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content:
                locale === 'es'
                  ? '- Género/vibe: acción y aventura\\n- Estado: lanzamiento reciente\\n- Lo que importa: exploración, progresión, rendimiento'
                  : '- Genre/vibe: action-adventure\\n- Status: recent release\\n- What players care about: exploration, progression, performance',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      });
    }

    const contentType = detectContentType(body.messages);
    const description = MOCK_DESCRIPTIONS[contentType][locale];
    
    return HttpResponse.json({
      id: 'mock-completion-id',
      object: 'chat.completion',
      created: Date.now(),
      model: body.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: description,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 200,
        total_tokens: 300,
      },
    });
  }),

  /**
   * Mock OpenRouter API (responses format - used by newer AI SDK)
   */
  http.post('https://openrouter.ai/api/v1/responses', async ({ request }) => {
    const body = await request.json() as { 
      input: Array<{ role: string; content: string | Array<{ type: string; text: string }> }>;
      model: string;
    };
    
    // Extract messages from the input format
    const messages = body.input.map(msg => {
      const content = typeof msg.content === 'string' 
        ? msg.content 
        : (msg.content as Array<{ type: string; text: string }>)?.[0]?.text || '';
      return { role: msg.role, content };
    });
    
    const locale = detectLocale(messages);
    const userText = getUserText(messages);

    // Check Reviewer FIRST - it contains article plan info, so isArticlePlanPrompt would match it
    if (isReviewerPrompt(userText)) {
      const reviewerJson = JSON.stringify(buildMockReviewerResponse());

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
            content: [{ type: 'output_text', text: reviewerJson, annotations: [] }],
          },
        ],
        usage: { input_tokens: 200, output_tokens: 150, total_tokens: 350 },
      });
    }

    if (isArticlePlanPrompt(userText)) {
      const planJson = JSON.stringify(buildMockArticlePlan(locale));
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
        usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
      });
    }

    if (isArticleSectionPrompt(userText)) {
      const sectionText =
        locale === 'es'
          ? 'Este es un párrafo de ejemplo con **énfasis** y continuidad.\\n\\nOtro párrafo con detalles prudentes basados en investigación simulada.'
          : 'This is a sample paragraph with **emphasis** and continuity.\\n\\nAnother paragraph with careful details based on mocked research.';

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
            content: [{ type: 'output_text', text: sectionText, annotations: [] }],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
      });
    }

    if (isScoutBriefingPrompt(userText)) {
      const briefing =
        locale === 'es'
          ? '- Género/vibe: acción y aventura\\n- Estado: lanzamiento reciente\\n- Lo que importa: exploración, progresión, rendimiento'
          : '- Genre/vibe: action-adventure\\n- Status: recent release\\n- What players care about: exploration, progression, performance';

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
            content: [{ type: 'output_text', text: briefing, annotations: [] }],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
      });
    }

    const contentType = detectContentType(messages);
    const description = MOCK_DESCRIPTIONS[contentType][locale];
    
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
          content: [
            {
              type: 'output_text',
              text: description,
              annotations: [],
            },
          ],
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        total_tokens: 300,
      },
    });
  }),

  /**
   * Mock IGDB OAuth token endpoint
   */
  http.post('https://id.twitch.tv/oauth2/token', () => {
    return HttpResponse.json({
      access_token: 'mock-igdb-access-token',
      expires_in: 5000000,
      token_type: 'bearer',
    });
  }),

  /**
   * Mock IGDB Games endpoint
   */
  http.post('https://api.igdb.com/v4/games', async ({ request }) => {
    const body = await request.text();
    
    // Check if this is a search or a specific game fetch
    if (body.includes('119388') || body.includes('Zelda')) {
      return HttpResponse.json([
        {
          id: 119388,
          name: 'The Legend of Zelda: Tears of the Kingdom',
          slug: 'the-legend-of-zelda-tears-of-the-kingdom',
          summary: 'The sequel to The Legend of Zelda: Breath of the Wild.',
          storyline: 'Link awakens on a mysterious floating island...',
          first_release_date: 1683849600,
          category: 0,
          status: 0,
          cover: {
            id: 123,
            image_id: 'co5vmg',
          },
          platforms: [
            { id: 130, name: 'Nintendo Switch', slug: 'switch', abbreviation: 'NSW' },
          ],
          genres: [
            { id: 31, name: 'Adventure', slug: 'adventure' },
            { id: 12, name: 'Role-playing (RPG)', slug: 'role-playing-rpg' },
          ],
          involved_companies: [
            {
              id: 1,
              company: { id: 70, name: 'Nintendo', slug: 'nintendo' },
              developer: true,
              publisher: true,
            },
          ],
          game_modes: [
            { id: 1, name: 'Single player', slug: 'single-player' },
          ],
          player_perspectives: [
            { id: 3, name: 'Third person', slug: 'third-person' },
          ],
          themes: [
            { id: 1, name: 'Action', slug: 'action' },
            { id: 17, name: 'Fantasy', slug: 'fantasy' },
          ],
          keywords: [],
          age_ratings: [],
          websites: [],
          screenshots: [],
          artworks: [],
          videos: [],
          language_supports: [],
          aggregated_rating: 95,
          rating: 93.27,
          rating_count: 740,
          total_rating: 94,
          total_rating_count: 746,
          hypes: 79,
        },
      ]);
    }
    
    return HttpResponse.json([]);
  }),

  /**
   * Mock IGDB Platforms endpoint
   */
  http.post('https://api.igdb.com/v4/platforms', async ({ request }) => {
    const body = await request.text();
    
    if (body.includes('130') || body.includes('Switch')) {
      return HttpResponse.json([
        {
          id: 130,
          name: 'Nintendo Switch',
          slug: 'switch',
          abbreviation: 'NSW',
          platform_logo: {
            id: 123,
            image_id: 'pl123',
          },
          generation: 8,
          category: 1, // console
        },
      ]);
    }
    
    return HttpResponse.json([]);
  }),

  /**
   * Mock IGDB Alternative Names (for localization)
   */
  http.post('https://api.igdb.com/v4/alternative_names', () => {
    return HttpResponse.json([]);
  }),

  /**
   * Mock IGDB Localizations
   */
  http.post('https://api.igdb.com/v4/game_localizations', () => {
    return HttpResponse.json([]);
  }),
];

/**
 * Handler that simulates an AI error
 */
export const errorHandlers = {
  tavilyError: http.post('https://api.tavily.com/search', () => {
    return HttpResponse.json(
      { error: { message: 'Tavily rate limit exceeded' } },
      { status: 429 }
    );
  }),
  exaError: http.post('https://api.exa.ai/search', () => {
    return HttpResponse.json(
      { error: { message: 'Exa API error' } },
      { status: 500 }
    );
  }),
  exaFindSimilarError: http.post('https://api.exa.ai/findSimilar', () => {
    return HttpResponse.json(
      { error: { message: 'Exa findSimilar API error' } },
      { status: 500 }
    );
  }),
  aiError: http.post('https://openrouter.ai/api/v1/responses', () => {
    return HttpResponse.json(
      { error: { message: 'Rate limit exceeded' } },
      { status: 429 }
    );
  }),
  aiErrorLegacy: http.post('https://openrouter.ai/api/v1/chat/completions', () => {
    return HttpResponse.json(
      { error: { message: 'Rate limit exceeded' } },
      { status: 429 }
    );
  }),
};

