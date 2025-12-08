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

/**
 * Detect if the prompt is for a platform or game description
 */
function detectContentType(messages: Array<{ role: string; content: string }>): 'platform' | 'game' {
  const userMessage = messages.find(m => m.role === 'user')?.content || '';
  if (userMessage.includes('Platform:') || userMessage.toLowerCase().includes('platform')) {
    return 'platform';
  }
  return 'game';
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
   * Mock OpenRouter API (chat completions - legacy format)
   */
  http.post('https://openrouter.ai/api/v1/chat/completions', async ({ request }) => {
    const body = await request.json() as { 
      messages: Array<{ role: string; content: string }>;
      model: string;
    };
    
    const contentType = detectContentType(body.messages);
    const locale = detectLocale(body.messages);
    
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
    
    const contentType = detectContentType(messages);
    const locale = detectLocale(messages);
    
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

