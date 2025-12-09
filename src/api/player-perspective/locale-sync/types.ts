import type { Core } from '@strapi/strapi';

export interface PlayerPerspectiveLocaleData {
  documentId: string;
  sourceId: number;
  name: string;
  playerPerspectiveData: {
    slug: string;
    igdbId: number | null;
  };
  /** AI-generated description for this locale */
  aiDescription?: string | null;
  /** Translated name for this locale */
  localizedName?: string;
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

