import type { Core } from '@strapi/strapi';

export interface PlayerPerspectiveLocaleData {
  documentId: string;
  sourceId: number;
  name: string;
  playerPerspectiveData: {
    slug: string;
    igdbId: number | null;
  };
}

export interface PlayerPerspectiveLocaleStrategy {
  readonly locale: string;
  createLocale(strapi: Core.Strapi, data: PlayerPerspectiveLocaleData): Promise<void>;
}

export interface PlayerPerspectiveLocaleSyncResult {
  locale: string;
  success: boolean;
  error?: string;
}

