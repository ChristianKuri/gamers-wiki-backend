import type { Core } from '@strapi/strapi';

export interface AgeRatingLocaleData {
  documentId: string;
  sourceId: number;
  ageRatingData: {
    category: string;
    rating: string;
    ratingCoverUrl: string | null;
    synopsis: string | null;
    igdbId: number | null;
    contentDescriptions: string[] | null;
  };
}

export interface AgeRatingLocaleStrategy {
  readonly locale: string;
  createLocale(strapi: Core.Strapi, data: AgeRatingLocaleData): Promise<void>;
}

export interface AgeRatingLocaleSyncResult {
  locale: string;
  success: boolean;
  error?: string;
}

