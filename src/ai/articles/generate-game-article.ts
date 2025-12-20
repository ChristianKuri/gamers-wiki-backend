import { createOpenAI } from '@ai-sdk/openai';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';

import type { SupportedLocale } from '../config';
import { getModel } from '../config';
import { tavilySearch } from '../tools/tavily';
import {
  ArticlePlanSchema,
  normalizeArticleCategorySlug,
  type ArticlePlan,
  type ArticlePlanInput,
  type ArticleCategorySlug,
} from './article-plan';

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || '',
});

export interface GameArticleContext {
  readonly gameName: string;
  readonly gameSlug?: string | null;
  readonly releaseDate?: string | null;
  readonly genres?: readonly string[];
  readonly platforms?: readonly string[];
  readonly developer?: string | null;
  readonly publisher?: string | null;
  readonly igdbDescription?: string | null;
  readonly instruction?: string | null;
  readonly categoryHints?: readonly { slug: ArticleCategorySlug; systemPrompt?: string | null }[];
}

export interface GameArticleDraft {
  readonly title: string;
  readonly categorySlug: ArticleCategorySlug;
  readonly excerpt: string;
  readonly tags: readonly string[];
  readonly markdown: string;
  readonly sources: readonly string[];
  readonly plan: ArticlePlan;
  readonly models: {
    scout: string;
    editor: string;
    specialist: string;
  };
}

function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function formatSources(urls: readonly string[]): string {
  if (urls.length === 0) return '';
  return ['## Sources', ...urls.map((u) => `- ${u}`), ''].join('\n');
}

function ensureUniqueStrings(values: readonly string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const trimmed = v.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function buildCategoryHintsSection(
  hints: readonly { slug: ArticleCategorySlug; systemPrompt?: string | null }[] | undefined
): string {
  if (!hints || hints.length === 0) return '';
  const lines = hints.map((h) => {
    const p = (h.systemPrompt || '').trim();
    return p.length > 0 ? `- ${h.slug}: ${p}` : `- ${h.slug}`;
  });
  return `\n\nAvailable categories (pick ONE categorySlug):\n${lines.join('\n')}`;
}

async function runScout(context: GameArticleContext, locale: SupportedLocale): Promise<{ briefing: string; sourceUrls: string[] }> {
  const queryParts: string[] = [
    `${context.gameName} game`,
    context.releaseDate ? `release date ${context.releaseDate}` : '',
    context.developer ? `developer ${context.developer}` : '',
    context.publisher ? `publisher ${context.publisher}` : '',
    context.genres?.length ? `genre ${context.genres.join(' ')}` : '',
    context.platforms?.length ? `platforms ${context.platforms.join(' ')}` : '',
  ].filter(Boolean);

  const baseQuery = queryParts.join(' | ');
  const instruction = context.instruction?.trim();

  const tavilyQuery = instruction
    ? `${baseQuery} | ${instruction}`
    : baseQuery;

  const search = await tavilySearch(tavilyQuery, {
    searchDepth: 'basic',
    maxResults: 7,
    includeAnswer: true,
    includeRawContent: false,
  });

  const urls = ensureUniqueStrings(
    search.results
      .map((r) => normalizeUrl(r.url))
      .filter((u): u is string => Boolean(u)),
    10
  );

  const topSnippets = search.results
    .slice(0, 6)
    .map((r) => {
      const url = normalizeUrl(r.url) ?? r.url;
      const content = (r.content || '').slice(0, 600);
      return `- ${r.title} (${url})\n  ${content}`;
    })
    .join('\n');

  const localeInstruction = locale === 'es' ? 'Write in Spanish.' : 'Write in English.';

  const { text } = await generateText({
    model: openrouter(getModel('ARTICLE_SCOUT')),
    system: `You are the Scout agent. Your job is to ground the writer with quick, factual reconnaissance. ${localeInstruction}`,
    prompt: `Create a concise briefing document for writing an article about the game "${context.gameName}".

User instruction (if any): ${instruction || '(none)'}

Known context:
- name: ${context.gameName}
- slug: ${context.gameSlug || '(unknown)'}
- releaseDate: ${context.releaseDate || '(unknown)'}
- genres: ${context.genres?.join(', ') || '(unknown)'}
- platforms: ${context.platforms?.join(', ') || '(unknown)'}
- developer: ${context.developer || '(unknown)'}
- publisher: ${context.publisher || '(unknown)'}

Tavily answer (may be empty):
${search.answer || '(none)'}

Top search snippets:
${topSnippets || '(none)'}

Requirements:
- Bullet points only
- Include: genre/vibe, release status, key mechanics, what players care about, current controversies/patch notes if relevant
- Do NOT invent facts
- Keep under 220 words
`,
  });

  return { briefing: text.trim(), sourceUrls: urls };
}

async function runEditor(context: GameArticleContext, locale: SupportedLocale, scoutBriefing: string): Promise<ArticlePlan> {
  const localeInstruction = locale === 'es' ? 'Write all strings in Spanish.' : 'Write all strings in English.';
  const categoryHints = buildCategoryHintsSection(context.categoryHints);

  const { object } = await generateObject({
    model: openrouter(getModel('ARTICLE_EDITOR')),
    schema: ArticlePlanSchema,
    system: `You are the Editor agent. You plan a high-quality game article by creating an outline with section-specific research queries. ${localeInstruction}`,
    prompt: `Plan an article about the game "${context.gameName}".

User instruction (if any): ${context.instruction?.trim() || '(none)'}

Scout briefing (ground truth-ish):
${scoutBriefing || '(none)'}

Known context:
- name: ${context.gameName}
- releaseDate: ${context.releaseDate || '(unknown)'}
- genres: ${context.genres?.join(', ') || '(unknown)'}
- platforms: ${context.platforms?.join(', ') || '(unknown)'}
- developer: ${context.developer || '(unknown)'}
- publisher: ${context.publisher || '(unknown)'}

Constraints:
- categorySlug must be one of: news, reviews, guides, lists
- excerpt must be 120-160 characters (meta description style)
- tags must be short phrases (no hashtags)
- sections: 4-8 sections is ideal; each must have 1-6 researchQueries
- No prices. Avoid ratings unless it is clearly a review.
${categoryHints}

Return ONLY valid JSON matching the schema.
`,
  });

  const plan: ArticlePlanInput = object;
  return {
    ...plan,
    categorySlug: normalizeArticleCategorySlug(plan.categorySlug),
  };
}

async function runSpecialist(
  context: GameArticleContext,
  locale: SupportedLocale,
  scoutBriefing: string,
  plan: ArticlePlan,
  initialSources: readonly string[]
): Promise<{ markdown: string; sources: string[] }> {
  const localeInstruction = locale === 'es' ? 'Write in Spanish.' : 'Write in English.';

  let markdown = `# ${plan.title}\n\n`;
  let previousContext = '';

  const collectedUrls: string[] = [...initialSources];

  for (const section of plan.sections) {
    // Targeted research per section
    const searchResults = await Promise.all(
      section.researchQueries.map((q) =>
        tavilySearch(q, { searchDepth: 'advanced', maxResults: 5, includeAnswer: true })
      )
    );

    const urls = searchResults
      .flatMap((r) => r.results)
      .map((r) => normalizeUrl(r.url))
      .filter((u): u is string => Boolean(u));

    collectedUrls.push(...urls);

    const condensedResearch = searchResults
      .map((r) => {
        const bullets = r.results
          .slice(0, 3)
          .map((it) => `- ${it.title}: ${(it.content || '').slice(0, 280)}`)
          .join('\n');
        return `Query: ${r.query}\nAnswer: ${r.answer || '(none)'}\n${bullets}`;
      })
      .join('\n\n');

    const { text } = await generateText({
      model: openrouter(getModel('ARTICLE_SPECIALIST')),
      system: `You are the Specialist agent. You write one section at a time with strong continuity and grounded details. ${localeInstruction}`,
      prompt: `Write the next section of a game article.

Article title: ${plan.title}
Category: ${plan.categorySlug}
Section headline: ${section.headline}
Section goal: ${section.goal}

Global grounding:
- No prices, no purchase calls-to-action.
- If not a review, do NOT give a numeric score.
- Avoid fake specifics; if facts are unknown, be cautious and frame as general.

Scout briefing:
${scoutBriefing || '(none)'}

Research (may be empty):
${condensedResearch || '(none)'}

Previous section tail (for flow):
${previousContext || '(none)'}

Output requirements:
- Output ONLY markdown prose for this section (no surrounding code fences)
- Do NOT include the section heading; the system will add it
- 2-5 paragraphs, with smooth transitions
- Use some **bold** emphasis for key mechanics or terms
`,
    });

    const sectionText = text.trim();
    markdown += `## ${section.headline}\n\n${sectionText}\n\n`;
    previousContext = sectionText.slice(-500);
  }

  const finalUrls = ensureUniqueStrings(collectedUrls, 10);
  markdown += formatSources(finalUrls);

  return { markdown: markdown.trim() + '\n', sources: finalUrls };
}

export async function generateGameArticleDraft(
  context: GameArticleContext,
  locale: SupportedLocale
): Promise<GameArticleDraft> {
  const scoutModel = getModel('ARTICLE_SCOUT');
  const editorModel = getModel('ARTICLE_EDITOR');
  const specialistModel = getModel('ARTICLE_SPECIALIST');

  const { briefing, sourceUrls } = await runScout(context, locale);
  const plan = await runEditor(context, locale, briefing);
  const { markdown, sources } = await runSpecialist(context, locale, briefing, plan, sourceUrls);

  return {
    title: plan.title,
    categorySlug: plan.categorySlug,
    excerpt: plan.excerpt,
    tags: plan.tags,
    markdown,
    sources,
    plan,
    models: {
      scout: scoutModel,
      editor: editorModel,
      specialist: specialistModel,
    },
  };
}
