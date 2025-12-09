import type { Core } from '@strapi/strapi';

export interface LanguageLocaleData {
  documentId: string;
  sourceId: number;
  name: string;
  languageData: {
    nativeName: string | null;
    locale: string | null;
    igdbId: number | null;
  };
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

