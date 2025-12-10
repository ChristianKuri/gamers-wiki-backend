import type { Core } from '@strapi/strapi';

export interface LanguageLocaleData {
  documentId: string;
  sourceId: number;
  name: string;
  languageData: {
    slug: string;
    nativeName: string | null;
    isoCode: string | null;
    igdbId: number | null;
  };
  /** AI-generated description for this locale */
  aiDescription?: string | null;
  /** Translated name for this locale */
  localizedName?: string;
}

export interface LanguageLocaleStrategy {
  readonly locale: string;
  createLocale(strapi: Core.Strapi, data: LanguageLocaleData): Promise<void>;
}

export interface LanguageLocaleSyncResult {
  locale: string;
  success: boolean;
  error?: string;
}

