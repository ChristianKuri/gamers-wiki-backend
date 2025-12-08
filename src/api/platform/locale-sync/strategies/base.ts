/**
 * Base utilities for platform locale sync strategies
 * Contains shared database helpers that all locale strategies can use
 */

/**
 * Generate a URL-safe slug from a name
 * Removes accents, converts to lowercase, replaces non-alphanumeric with dashes
 * 
 * @param name - The name
 * @returns URL-safe slug
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]+/g, '-')     // Replace non-alphanumeric with dashes
    .replace(/^-|-$/g, '');          // Remove leading/trailing dashes
}

