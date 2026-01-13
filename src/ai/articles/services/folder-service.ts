/**
 * Folder Service for Article Images
 *
 * Manages Strapi Media Library folder structure for article images.
 * Organizes images by: /images/{game_slug}/{article_slug}
 *
 * Uses Strapi's upload plugin via db.query('plugin::upload.folder') and
 * db.query('plugin::upload.file'). Strapi handles the internal link tables
 * (files_folder_lnk, upload_folders_parent_lnk) automatically when setting
 * the `folder` and `parent` relations.
 */

import type { Core } from '@strapi/strapi';
import type { Logger } from '../../../utils/logger';
import { slugify } from '../../../utils/slug';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of folder creation/lookup.
 */
export interface FolderResult {
  /** Folder ID in Strapi */
  readonly id: number;
  /** Folder path (e.g., "/images/game-slug/article-slug") */
  readonly path: string;
  /** Whether the folder was created (vs found existing) */
  readonly created: boolean;
}

/**
 * Dependencies for folder operations.
 */
export interface FolderServiceDeps {
  readonly strapi: Core.Strapi;
  readonly logger?: Logger;
}

// ============================================================================
// Constants
// ============================================================================

/** Root folder name for article images */
const IMAGES_ROOT_FOLDER = 'images';

// ============================================================================
// Folder Operations
// ============================================================================

/**
 * Checks if an error is a unique constraint violation.
 * This happens when concurrent processes try to create the same folder.
 */
function isUniqueConstraintError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // PostgreSQL unique violation codes and messages
    return (
      message.includes('unique') ||
      message.includes('duplicate') ||
      message.includes('23505') // PostgreSQL unique_violation code
    );
  }
  return false;
}

/**
 * Finds an existing folder by path.
 */
async function findFolderByPath(
  strapi: Core.Strapi,
  folderPath: string
): Promise<FolderResult | null> {
  const existing = await strapi.db.query('plugin::upload.folder').findOne({
    where: { path: folderPath },
  });

  if (existing) {
    return {
      id: existing.id,
      path: folderPath,
      created: false,
    };
  }
  return null;
}

/**
 * Gets or creates a folder by name under an optional parent.
 * 
 * Uses retry logic to handle race conditions: if folder creation fails
 * due to a unique constraint violation (another process created it first),
 * we retry the find operation.
 *
 * @param deps - Service dependencies
 * @param name - Folder name
 * @param parentId - Parent folder ID (null for root)
 * @param parentPath - Parent folder path (e.g., "/images")
 * @returns Folder result with ID and path
 */
async function getOrCreateFolder(
  deps: FolderServiceDeps,
  name: string,
  parentId: number | null,
  parentPath: string
): Promise<FolderResult> {
  const { strapi, logger } = deps;
  const folderPath = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`;

  // Try to find existing folder first
  const existing = await findFolderByPath(strapi, folderPath);
  if (existing) {
    return existing;
  }

  // Attempt to create the folder
  try {
    const pathId = generatePathId();

    const created = await strapi.db.query('plugin::upload.folder').create({
      data: {
        name,
        pathId,
        path: folderPath,
      },
    });

    // Link to parent folder if not root
    // Strapi's db.query handles the upload_folders_parent_lnk link table automatically
    // when setting the `parent` relation
    if (parentId !== null) {
      await strapi.db.query('plugin::upload.folder').update({
        where: { id: created.id },
        data: {
          parent: parentId,
        },
      });
    }

    logger?.debug(`[FolderService] Created folder: ${folderPath} (id: ${created.id})`);

    return {
      id: created.id,
      path: folderPath,
      created: true,
    };
  } catch (error) {
    // Handle race condition: another process created the folder first
    if (isUniqueConstraintError(error)) {
      logger?.debug(`[FolderService] Folder creation race condition, retrying find: ${folderPath}`);
      const retryFind = await findFolderByPath(strapi, folderPath);
      if (retryFind) {
        return retryFind;
      }
    }
    // Re-throw if not a unique constraint error or folder still not found
    throw error;
  }
}

/**
 * Generates a unique pathId for a new folder.
 * 
 * Uses a random number to avoid race conditions.
 * The retry logic in getOrCreateFolder handles collisions.
 * 
 * Note: pathId must fit in PostgreSQL integer (max 2,147,483,647)
 */
function generatePathId(): number {
  // Random number between 1 and 2 billion (safe for PostgreSQL integer)
  return Math.floor(Math.random() * 2000000000) + 1;
}

/**
 * Gets or creates the folder structure for article images.
 *
 * Creates: /images/{gameSlug}/{articleSlug}
 *
 * @param deps - Service dependencies
 * @param gameSlug - Game slug (e.g., "elden-ring")
 * @param articleSlug - Article slug (e.g., "how-to-beat-malenia")
 * @returns Folder result for the article folder
 */
export async function getOrCreateArticleFolder(
  deps: FolderServiceDeps,
  gameSlug: string,
  articleSlug: string
): Promise<FolderResult> {
  const { logger } = deps;

  // Sanitize slugs using shared utility (handles diacritics, special chars)
  // Limit to 100 chars for folder name safety
  const safeGameSlug = slugify(gameSlug).slice(0, 100);
  const safeArticleSlug = slugify(articleSlug).slice(0, 100);

  logger?.debug(`[FolderService] Getting/creating folder for game="${safeGameSlug}", article="${safeArticleSlug}"`);

  // Step 1: Get or create /images folder
  const imagesFolder = await getOrCreateFolder(deps, IMAGES_ROOT_FOLDER, null, '/');

  // Step 2: Get or create /images/{gameSlug} folder
  const gameFolder = await getOrCreateFolder(
    deps,
    safeGameSlug,
    imagesFolder.id,
    imagesFolder.path
  );

  // Step 3: Get or create /images/{gameSlug}/{articleSlug} folder
  const articleFolder = await getOrCreateFolder(
    deps,
    safeArticleSlug,
    gameFolder.id,
    gameFolder.path
  );

  return articleFolder;
}

/**
 * Links a file to a folder and updates its folder_path.
 *
 * @param deps - Service dependencies
 * @param fileId - The file ID to link
 * @param folderId - The folder ID to link to
 * @param folderPath - The folder path (e.g., "/images/game/article")
 */
export async function linkFileToFolder(
  deps: FolderServiceDeps,
  fileId: number,
  folderId: number,
  folderPath: string
): Promise<void> {
  const { strapi, logger } = deps;

  // Update file's folder_path and folder relation
  // Strapi's db.query handles the files_folder_lnk link table automatically
  // when setting the `folder` relation
  await strapi.db.query('plugin::upload.file').update({
    where: { id: fileId },
    data: {
      folderPath: folderPath,
      folder: folderId,
    },
  });

  logger?.debug(`[FolderService] Linked file ${fileId} to folder ${folderId}`);
}

