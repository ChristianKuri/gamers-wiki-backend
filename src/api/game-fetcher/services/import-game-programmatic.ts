import type { Core } from '@strapi/strapi';

import type { GameDocument } from '../../../types/strapi';
import createGameFetcherController from '../controllers/game-fetcher';

class GameImportError extends Error {
  public readonly status: number;
  public readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'GameImportError';
    this.status = status;
    this.details = details;
  }
}

interface ImportControllerResponse {
  success: boolean;
  message: string;
  game: GameDocument;
  created: boolean;
}

interface ImportCtx {
  request: { body: { igdbId: number } };
  body?: unknown;
  badRequest: (message: string, details?: unknown) => never;
  notFound: (message: string) => never;
  internalServerError: (message: string) => never;
}

/**
 * Programmatically import a game (or return existing) using the existing
 * `/api/game-fetcher/import` controller logic.
 *
 * This keeps the "single source of truth" for imports in one place while allowing
 * other features (like article generation) to ensure the game exists.
 */
export async function importOrGetGameByIgdbId(
  strapi: Core.Strapi,
  igdbId: number
): Promise<{ game: GameDocument; created: boolean }> {
  const controller = createGameFetcherController({ strapi });

  const ctx: ImportCtx = {
    request: { body: { igdbId } },
    body: undefined,
    badRequest: (message: string, details?: unknown) => {
      throw new GameImportError(message, 400, details);
    },
    notFound: (message: string) => {
      throw new GameImportError(message, 404);
    },
    internalServerError: (message: string) => {
      throw new GameImportError(message, 500);
    },
  };

  await controller.importGame(ctx as unknown as Record<string, unknown>);

  const body = ctx.body as ImportControllerResponse | undefined;
  if (!body?.success || !body.game?.documentId) {
    throw new GameImportError('Game import did not return a valid response', 500, body);
  }

  return { game: body.game, created: body.created };
}

export { GameImportError };

