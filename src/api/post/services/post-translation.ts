import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';

import { getModel } from '../../../ai/config/utils';

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || '',
});

export interface EnglishPostForTranslation {
  readonly title: string;
  readonly excerpt?: string | null;
  readonly description?: string | null;
  readonly content: string;
}

export interface SpanishPostDraft {
  readonly title: string;
  readonly slug: string;
  readonly excerpt: string;
  readonly description?: string;
  readonly content: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const TranslationSchema = z.object({
  title: z.string().min(5).max(140),
  excerpt: z.string().min(120).max(160),
  description: z.string().min(0).max(200).optional(),
  content: z.string().min(50),
});

/**
 * Generate a Spanish localized version of an English post using the English post as the source of truth.
 * This is used after the English post is published.
 */
export async function translatePostEnToEs(input: EnglishPostForTranslation): Promise<SpanishPostDraft> {
  const { object } = await generateObject({
    model: openrouter(getModel('POST_TRANSLATION')),
    schema: TranslationSchema,
    system:
      'You are a professional Spanish localization writer for a gaming site. ' +
      'Translate and LOCALIZE (not literal word-for-word) while preserving meaning and structure.',
    prompt: `Translate this article into Spanish.

Rules:
- Output ONLY JSON matching the schema.
- Keep game titles / product names / proper nouns in their official names (do not translate if they are brand names).
- Keep Markdown structure (headings, lists). If the content looks like HTML, preserve tags but translate inner text.
- excerpt must be 120-160 chars (meta description style).
- Do not add prices.

English title:
${input.title}

English excerpt (may be empty):
${input.excerpt || ''}

English description (may be empty):
${input.description || ''}

English content:
${input.content}
`,
  });

  return {
    title: object.title,
    slug: slugify(object.title),
    excerpt: object.excerpt,
    ...(object.description ? { description: object.description } : {}),
    content: object.content,
  };
}

