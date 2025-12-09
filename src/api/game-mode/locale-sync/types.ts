import type { Core } from '@strapi/strapi';

/**
 * Data required for creating a localized game mode entry
 */
export interface GameModeLocaleData {
  /** The document ID shared across all locales */
  documentId: string;
  /** The database row ID of the source (English) entry */
  sourceId: number;
  /** Game mode name (not localized - same across all locales) */
  name: string;
  /** Game mode data from the English entry */
  gameModeData: {
    slug: string;
    igdbId: number | null;
  };
}

/**
 * Strategy interface for creating localized game mode entries
 */
export interface GameModeLocaleStrategy {
  readonly locale: string;
  createLocale(strapi: Core.Strapi, data: GameModeLocaleData): Promise<void>;
}

/**
 * Result of locale sync operation
 */
export interface GameModeLocaleSyncResult {
  locale: string;
  success: boolean;
  error?: string;
}

