/**
 * URL Slug Generation Utility
 *
 * Single source of truth for generating URL-safe slugs.
 * Used across the application for games, posts, categories, etc.
 *
 * NOTE: Strapi's UID auto-generation only triggers via REST/GraphQL APIs,
 * NOT when using the Document Service API directly. Therefore, we must
 * generate slugs manually when creating content programmatically.
 */

/**
 * Generate a URL-safe slug from a string.
 *
 * Transformations:
 * 1. Lowercase the string
 * 2. Normalize Unicode and remove diacritics (é → e, ñ → n)
 * 3. Replace non-alphanumeric characters with hyphens
 * 4. Remove leading/trailing hyphens
 *
 * @param value - The string to slugify (e.g., title, name)
 * @returns URL-safe slug (e.g., "Elden Ring: Shadow of the Erdtree" → "elden-ring-shadow-of-the-erdtree")
 *
 * @example
 * slugify("How to Beat Simon in Clair Obscur: Expedition 33")
 * // → "how-to-beat-simon-in-clair-obscur-expedition-33"
 *
 * @example
 * slugify("Día de los Muertos")
 * // → "dia-de-los-muertos"
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9]+/g, '-')     // Replace non-alphanumeric with hyphens
    .replace(/^-|-$/g, '');          // Remove leading/trailing hyphens
}
