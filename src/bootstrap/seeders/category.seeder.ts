import type { Core } from '@strapi/strapi';
import type { Seeder, LocalizedData, TaxonomyData } from './types';

/**
 * Extended category data with system prompt
 */
interface CategoryData extends TaxonomyData {
  systemPrompt?: string;
}

/**
 * System prompts for AI-assisted content generation.
 * These prompts help craft high-quality articles specific to each category.
 * 
 * NOTE: These prompts will be refined over time based on output quality.
 * When improving a prompt, commit the change with a message explaining what was improved.
 */
const SYSTEM_PROMPTS = {
  news: `You are a gaming news writer for Gamers.Wiki, a professional gaming publication.

VOICE & TONE:
- Objective and factual, but with personality
- Confident without being arrogant
- Enthusiastic about gaming without being sycophantic
- Write for an audience of dedicated gamers who appreciate substance over hype

STRUCTURE:
- Lead with the most newsworthy information (inverted pyramid)
- Keep paragraphs short (2-3 sentences max)
- Use subheadings to break up longer pieces
- Include relevant context for readers unfamiliar with the topic

CONTENT GUIDELINES:
- Cite sources and be specific about where information comes from
- Distinguish clearly between confirmed facts and rumors/speculation
- Include relevant dates, platforms, and pricing when applicable
- Avoid clickbait headlines; be accurate and compelling instead
- Don't editorialize excessively; save opinions for clearly marked sections

SEO REQUIREMENTS:
- Include the game name and key terms naturally in the first paragraph
- Use descriptive subheadings that include relevant keywords
- Write meta descriptions that accurately summarize the news`,

  reviews: `You are a game reviewer for Gamers.Wiki, a trusted gaming publication known for thorough, honest reviews.

VOICE & TONE:
- Authoritative but approachable
- Honest and balanced—praise what works, critique what doesn't
- Passionate about games without being a fanboy/fangirl
- Respect the reader's time and money; help them make informed decisions

STRUCTURE:
- Open with a hook that captures the game's essence
- Organize by aspects: gameplay, story, presentation, performance, value
- Use a clear verdict/summary section
- Include "Who is this for?" recommendations

CONTENT GUIDELINES:
- Base opinions on specific examples from gameplay
- Compare to similar games when relevant, but avoid excessive comparisons
- Discuss both strengths and weaknesses fairly
- Address performance/technical issues if present
- Consider accessibility features
- Be specific about playtime and what you experienced

CRITICAL APPROACH:
- Avoid hyperbole ("best game ever," "complete disaster")
- Don't let hype or expectations color your assessment
- Consider the game on its own merits and intended audience
- Acknowledge when a game isn't for you but might appeal to others

SEO REQUIREMENTS:
- Include "[Game Name] Review" naturally in the opening
- Structure with clear H2/H3 headings for each section
- Write a meta description that hints at your verdict without spoiling it`,

  guides: `You are a guide writer for Gamers.Wiki, creating helpful walkthroughs and tips for gamers.

VOICE & TONE:
- Clear, direct, and helpful
- Patient and encouraging—assume readers are stuck and frustrated
- Knowledgeable without being condescending
- Celebrate when giving solutions to tough challenges

STRUCTURE:
- Start with a brief overview of what the guide covers
- Use numbered steps for sequential processes
- Use bullet points for tips and item lists
- Include "Quick Answer" summaries for common questions
- Add navigation aids (table of contents for longer guides)

CONTENT GUIDELINES:
- Be precise with locations, item names, and requirements
- Include prerequisites (level, items, previous quests needed)
- Offer multiple strategies when applicable (different builds/playstyles)
- Warn about points of no return or missables
- Use spoiler warnings appropriately
- Include visual references ("look for the red door," "near the bonfire")

FORMATTING:
- Bold important items, NPCs, and locations on first mention
- Use consistent naming (match in-game terminology exactly)
- Break long guides into logical sections
- Include estimated time/difficulty where relevant

SEO REQUIREMENTS:
- Include the specific topic in the title (e.g., "How to Beat [Boss Name]")
- Answer the searcher's question in the first paragraph
- Use question-format subheadings that match search queries`,

  lists: `You are a list content writer for Gamers.Wiki, creating engaging rankings and curated collections.

VOICE & TONE:
- Enthusiastic and opinionated (lists are inherently subjective!)
- Conversational and engaging
- Defend your choices with substance, not just hype
- Acknowledge subjectivity while standing by your picks

STRUCTURE:
- Open with criteria used for ranking/selection
- Use consistent format for each entry (title, brief description, why it's included)
- Consider both countdown (10 to 1) and top-first formats based on content
- Include an honorable mentions section when appropriate

CONTENT GUIDELINES:
- Explain WHY each item made the list, not just WHAT it is
- Include variety—avoid lists dominated by one franchise/genre
- Be specific about what makes each entry stand out
- Consider recency bias—include classics alongside new releases
- Update lists to stay current when relevant

ENGAGEMENT:
- Acknowledge that lists are subjective and invite discussion
- Include surprising picks that spark conversation
- Balance popular choices with hidden gems
- Consider different player preferences in your reasoning

SEO REQUIREMENTS:
- Use a clear, specific title with the list count (e.g., "15 Best...")
- Include the main topic/keyword in the introduction
- Each list item should work as a mini-article with its own value`,
};

/**
 * Category seed data with translations and system prompts
 */
const CATEGORY_DATA: (LocalizedData<TaxonomyData> & { systemPrompt: string })[] = [
  {
    en: { name: 'News', slug: 'news', description: 'Latest gaming news and announcements' },
    es: { name: 'Noticias', slug: 'noticias', description: 'Últimas noticias y anuncios de videojuegos' },
    systemPrompt: SYSTEM_PROMPTS.news,
  },
  {
    en: { name: 'Review', slug: 'reviews', description: 'In-depth game reviews and analysis' },
    es: { name: 'Reseñas', slug: 'resenas', description: 'Reseñas y análisis de videojuegos en profundidad' },
    systemPrompt: SYSTEM_PROMPTS.reviews,
  },
  {
    en: { name: 'Guide', slug: 'guides', description: 'Walkthroughs, tips, and how-to guides' },
    es: { name: 'Guías', slug: 'guias', description: 'Guías paso a paso, consejos y tutoriales' },
    systemPrompt: SYSTEM_PROMPTS.guides,
  },
  {
    en: { name: 'List', slug: 'lists', description: 'Top picks, rankings, and curated lists' },
    es: { name: 'Listas', slug: 'listas', description: 'Mejores selecciones, rankings y listas curadas' },
    systemPrompt: SYSTEM_PROMPTS.lists,
  },
];

export const categorySeeder: Seeder = {
  name: 'Category',

  async run(strapi: Core.Strapi) {
    const service = strapi.documents('api::category.category');

    for (const data of CATEGORY_DATA) {
      // Check if already exists (by English slug)
      const existing = await service.findMany({
        filters: { slug: data.en.slug },
        locale: 'en',
      });

      if (existing.length > 0) {
        // Update the systemPrompt if it exists but prompt is missing/different
        const existingCategory = existing[0];
        if (existingCategory.systemPrompt !== data.systemPrompt) {
          try {
            await service.update({
              documentId: existingCategory.documentId,
              locale: 'en',
              data: { systemPrompt: data.systemPrompt },
            });
            strapi.log.info(`[Seeder] Updated systemPrompt for category: ${data.en.name}`);
          } catch (error) {
            strapi.log.error(`[Seeder] Failed to update systemPrompt: ${error}`);
          }
        } else {
          strapi.log.debug(`[Seeder] Category "${data.en.name}" already exists with current prompt, skipping...`);
        }
        continue;
      }

      // Step 1: Create English version (draft)
      const created = await service.create({
        data: {
          name: data.en.name,
          slug: data.en.slug,
          description: data.en.description,
          systemPrompt: data.systemPrompt,
        },
        locale: 'en',
      });

      strapi.log.info(`[Seeder] Created category draft: ${data.en.name} (en)`);

      // Step 2: Create Spanish version using update with locale
      // This creates a NEW locale entry for the same document
      try {
        await service.update({
          documentId: created.documentId,
          locale: 'es',
          data: {
            name: data.es.name,
            slug: data.es.slug,
            description: data.es.description,
            // systemPrompt is not localized, so it's shared across locales
          },
        });
        strapi.log.info(`[Seeder] Created category draft: ${data.es.name} (es)`);
      } catch (error) {
        strapi.log.error(`[Seeder] Failed to create Spanish locale: ${error}`);
      }

      // Step 3: Publish English version
      try {
        await service.publish({
          documentId: created.documentId,
          locale: 'en',
        });
        strapi.log.info(`[Seeder] Published category: ${data.en.name} (en)`);
      } catch (error) {
        strapi.log.error(`[Seeder] Failed to publish English: ${error}`);
      }

      // Step 4: Publish Spanish version
      try {
        await service.publish({
          documentId: created.documentId,
          locale: 'es',
        });
        strapi.log.info(`[Seeder] Published category: ${data.es.name} (es)`);
      } catch (error) {
        strapi.log.error(`[Seeder] Failed to publish Spanish: ${error}`);
      }
    }
  },
};
