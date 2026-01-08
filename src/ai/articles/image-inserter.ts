/**
 * Markdown Image Inserter
 *
 * Inserts section images into article markdown at specified positions.
 * Hero image is NOT inserted - it's used as the Post's featuredImage instead.
 *
 * Features:
 * - Insert section images after H2 headers
 * - Add alt text and captions
 * - Preserve existing markdown structure
 * - Return hero image metadata for featuredImage assignment
 */

import type { SectionImageAssignment, HeroImageAssignment } from './agents/image-curator';
import type { ImageUploadResult } from './services/image-uploader';
import type { Logger } from '../../utils/logger';
import { findH2LineNumber } from './utils/headline-utils';

// ============================================================================
// Types
// ============================================================================

/**
 * Uploaded image with assignment info.
 */
export interface UploadedSectionImage {
  /** Original assignment from curator */
  readonly assignment: SectionImageAssignment;
  /** Upload result from Strapi */
  readonly upload: ImageUploadResult;
}

/**
 * Input for inserting images into markdown.
 */
export interface ImageInsertionInput {
  /** Original markdown without images */
  readonly markdown: string;
  /** Uploaded hero image (if any) */
  readonly heroImage?: {
    readonly assignment: HeroImageAssignment;
    readonly upload: ImageUploadResult;
  };
  /** Uploaded section images */
  readonly sectionImages: readonly UploadedSectionImage[];
  /** Optional logger for debugging */
  readonly logger?: Logger;
}

/**
 * Result of inserting images.
 */
export interface ImageInsertionResult {
  /** Markdown with images inserted */
  readonly markdown: string;
  /** Number of images inserted */
  readonly imagesInserted: number;
  /** Hero image info (if inserted) */
  readonly heroImage?: ImageUploadResult;
  /** Section images info (if inserted) */
  readonly sectionImages: readonly ImageUploadResult[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sanitizes text for use in markdown image syntax.
 * Escapes brackets and removes newlines to prevent breaking markdown.
 */
function sanitizeMarkdownText(text: string): string {
  return text
    .replace(/\[/g, '\\[')   // Escape opening brackets
    .replace(/\]/g, '\\]')   // Escape closing brackets
    .replace(/\n/g, ' ')     // Replace newlines with spaces
    .replace(/\s+/g, ' ')    // Collapse multiple spaces
    .trim();
}

/**
 * Creates markdown for an image.
 * Sanitizes alt text and caption to prevent markdown injection.
 */
function createImageMarkdown(
  url: string,
  altText: string,
  caption?: string
): string {
  const safeAlt = sanitizeMarkdownText(altText);
  const imageTag = `![${safeAlt}](${url})`;
  
  if (caption) {
    const safeCaption = sanitizeMarkdownText(caption);
    return `${imageTag}\n*${safeCaption}*`;
  }
  
  return imageTag;
}

/**
 * Finds the line number of the first H1 header.
 */
function findH1Line(lines: readonly string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^#\s+.+$/)) {
      return i;
    }
  }
  return -1;
}

// Note: findH2Line functionality is provided by findH2LineNumber from '../utils/headline-utils'

/**
 * Finds the best position to insert an image after a section header.
 * Looks for the first content paragraph after the H2.
 */
function findInsertPositionAfterH2(lines: readonly string[], h2Line: number): number {
  // Start looking after the H2
  for (let i = h2Line + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines
    if (line === '') continue;
    
    // Stop at next header
    if (line.match(/^#{1,6}\s+/)) {
      // Insert before next header (after previous content)
      return i;
    }
    
    // Found content - insert after this line
    // But if it's a list or table, continue to find a better spot
    if (!line.startsWith('-') && !line.startsWith('|') && !line.startsWith('*')) {
      return i + 1;
    }
  }
  
  // Default: right after the H2
  return h2Line + 1;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Inserts images into markdown at appropriate positions.
 *
 * @param input - Input with markdown and image assignments
 * @returns Result with updated markdown
 *
 * @example
 * const result = insertImagesIntoMarkdown({
 *   markdown: '# Title\n\nContent...',
 *   heroImage: { assignment, upload },
 *   sectionImages: [{ assignment, upload }],
 * });
 */
export function insertImagesIntoMarkdown(input: ImageInsertionInput): ImageInsertionResult {
  const { markdown, heroImage, sectionImages, logger } = input;
  
  // Split into lines for manipulation
  const lines = markdown.split('\n');
  
  // Track insertions to adjust line numbers
  // We'll build a map of (line number -> content to insert after)
  const insertions = new Map<number, string[]>();
  
  const insertedSectionImages: ImageUploadResult[] = [];
  let heroImageResult: ImageUploadResult | undefined;
  
  // Hero image is NOT inserted into markdown - it will be used as the Post's featuredImage.
  // We still capture the upload result for metadata/tracking purposes.
  if (heroImage) {
    heroImageResult = heroImage.upload;
    logger?.debug('[ImageInserter] Hero image captured for featuredImage (not inserted into markdown)');
  }
  
  // Handle section images - insert after each section H2
  for (const sectionImage of sectionImages) {
    const { assignment, upload } = sectionImage;
    
    // Find the H2 for this section (uses strict matching with similarity threshold)
    const h2Line = findH2LineNumber(lines, assignment.sectionHeadline, logger);
    if (h2Line < 0) {
      logger?.warn(`[ImageInserter] Section "${assignment.sectionHeadline}" not found in markdown, skipping image`);
      continue;
    }
    
    // Find best position after the H2
    const insertLine = findInsertPositionAfterH2(lines, h2Line);
    
    // Create image markdown
    // Use upload caption as fallback if LLM didn't provide one (upload caption has attribution)
    const caption = assignment.caption ?? upload.caption;
    const imageMarkdown = createImageMarkdown(
      upload.url,
      assignment.altText,
      caption
    );
    
    // Add to insertions
    // Guard against negative indices: findInsertPositionAfterH2 can return 0 when:
    // - The H2 is the first line (h2Line = 0, and no content found after)
    // - Back-to-back H2s (next section immediately follows)
    // In these cases, insertLine - 1 would be -1, so we clamp to 0.
    const insertAfterLine = Math.max(0, insertLine - 1);
    const existing = insertions.get(insertAfterLine) ?? [];
    existing.push('', imageMarkdown, '');
    insertions.set(insertAfterLine, existing);
    
    insertedSectionImages.push(upload);
  }
  
  // Build final markdown
  // Process insertions from bottom to top to avoid line number shifts
  const sortedInsertLines = Array.from(insertions.keys()).sort((a, b) => b - a);
  
  const resultLines = [...lines];
  for (const lineNum of sortedInsertLines) {
    const content = insertions.get(lineNum) ?? [];
    resultLines.splice(lineNum + 1, 0, ...content);
  }
  
  return {
    markdown: resultLines.join('\n'),
    // Only count actually inserted images (section images)
    // Hero image is captured but not inserted (used as featuredImage)
    imagesInserted: insertedSectionImages.length,
    heroImage: heroImageResult,
    sectionImages: insertedSectionImages,
  };
}

/**
 * Removes existing images from markdown (useful for re-processing).
 */
export function removeImagesFromMarkdown(markdown: string): string {
  const lines = markdown.split('\n');
  const resultLines: string[] = [];
  
  let skipNextCaption = false;
  
  for (const line of lines) {
    // Skip image lines
    if (line.match(/^!\[.*\]\(.*\)$/)) {
      skipNextCaption = true;
      continue;
    }
    
    // Skip caption lines (italics after image)
    if (skipNextCaption && line.match(/^\*[^*]+\*$/)) {
      skipNextCaption = false;
      continue;
    }
    
    skipNextCaption = false;
    resultLines.push(line);
  }
  
  // Clean up extra blank lines
  return resultLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
