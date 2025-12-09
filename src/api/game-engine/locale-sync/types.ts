import type { Core } from '@strapi/strapi';

export interface GameEngineLocaleData {
  documentId: string;
  sourceId: number;
  name: string;
  gameEngineData: {
    slug: string;
    description: string | null;
    logoUrl: string | null;
    igdbId: number | null;
  };
}

export interface GameEngineLocaleStrategy {
  readonly locale: string;
  createLocale(strapi: Core.Strapi, data: GameEngineLocaleData): Promise<void>;
}

export interface GameEngineLocaleSyncResult {
  locale: string;
  success: boolean;
  error?: string;
}

