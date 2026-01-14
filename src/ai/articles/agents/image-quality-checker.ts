/**
 * Image Quality Checker Agent (Stage 2 - Visual Validation)
 *
 * Optional vision-based quality validation for image candidates.
 * Uses a vision LLM to detect watermarks, UI overlays, and assess image clarity.
 *
 * INTEGRATION STATUS: Staged for future use.
 * - Controlled by IMAGE_QUALITY_VALIDATION_CONFIG.ENABLED (default: false)
 * - When enabled, should be called in image-candidate-processor.ts after
 *   dimension validation succeeds: Download → Validate Dimensions → [Validate Quality] → Upload
 * - Currently disabled because text-based relevance scoring + dimension validation
 *   provides sufficient quality filtering for most use cases
 * - Enable when watermark detection becomes a significant issue
 *
 * @see config.ts IMAGE_QUALITY_VALIDATION_CONFIG for settings
 */

import { generateText, Output } from 'ai';
import { z } from 'zod';

import type { LanguageModel } from 'ai';
import type { Logger } from '../../../utils/logger';
import type { TokenUsage } from '../types';
import { IMAGE_QUALITY_VALIDATION_CONFIG } from '../config';
import { createTokenUsageFromResult } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of quality validation for a single image.
 */
export interface QualityValidationResult {
  /** Whether watermark was detected */
  readonly hasWatermark: boolean;
  /** Whether UI overlay was detected (game HUD, menus, etc.) */
  readonly hasUIOverlay: boolean;
  /** Clarity score (0-100, higher = clearer) */
  readonly clarityScore: number;
  /** Whether the image passed validation */
  readonly passed: boolean;
  /** Optional notes about quality issues */
  readonly notes?: string;
}

/**
 * Options for quality validation.
 */
export interface QualityValidationOptions {
  /** Minimum clarity score to pass (default: from config) */
  readonly minClarityScore?: number;
  /** Logger for debugging */
  readonly logger?: Logger;
  /** AbortSignal for cancellation */
  readonly signal?: AbortSignal;
  /** Force enable validation even if globally disabled (for hero images) */
  readonly forceEnabled?: boolean;
}

/**
 * Dependencies for the quality checker agent.
 */
export interface QualityCheckerDeps {
  readonly model: LanguageModel;
  readonly generateText: typeof generateText;
  readonly logger?: Logger;
  readonly signal?: AbortSignal;
}

// ============================================================================
// Zod Schemas
// ============================================================================

const QualityValidationSchema = z.object({
  hasWatermark: z.boolean().describe('True if visible watermark, logo, or branding is present'),
  hasUIOverlay: z.boolean().describe('True if game UI (HUD, menus, buttons) is prominently visible'),
  clarityScore: z.number().min(0).max(100).describe('Image clarity: 100=crystal clear, 50=acceptable, 0=very blurry'),
  notes: z.string().optional().describe('Brief notes on any quality issues detected'),
});

type QualityValidationResponse = z.infer<typeof QualityValidationSchema>;

// ============================================================================
// Prompts
// ============================================================================

function buildQualityValidationPrompt(): string {
  return `You are an image quality validator for a gaming wiki. Analyze this image for quality issues.

## What to Check

1. **Watermarks**: Look for visible watermarks, logos, or branding overlaid on the image
   - Website logos (e.g., IGN, GameSpot logos)
   - Stock photo watermarks
   - "© Copyright" text overlays
   - Brand/channel watermarks

2. **UI Overlays**: Check if game UI elements are prominently visible
   - Health bars, mana bars, stamina bars
   - Minimap or full map overlays
   - Quest markers or objective text
   - Menu screens or inventory windows
   - Button prompts ("Press X to...")
   - Note: Small, non-intrusive UI is acceptable

3. **Clarity**: Assess overall image clarity
   - 100 = Crystal clear, high resolution
   - 80 = Clear, minor compression artifacts
   - 60 = Acceptable, some blur or artifacts
   - 40 = Below average, noticeable quality issues
   - 20 = Poor, significant blur or artifacts
   - 0 = Unusable, very blurry or corrupted

## Response

Provide your assessment with:
- hasWatermark: true/false
- hasUIOverlay: true/false (only true if UI is prominent/distracting)
- clarityScore: 0-100
- notes: Brief explanation of any issues found`;
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Validates image quality using vision LLM.
 *
 * Checks for watermarks, UI overlays, and image clarity.
 * Returns validation result with pass/fail status.
 *
 * **Important**: This function respects IMAGE_QUALITY_VALIDATION_CONFIG.ENABLED.
 * When disabled, it returns a "passed" result without calling the LLM.
 *
 * @param imageBuffer - Downloaded image buffer to validate
 * @param deps - Dependencies (model, generateText, logger)
 * @param options - Validation options
 * @returns Quality validation result
 */
export async function validateImageQuality(
  imageBuffer: Buffer,
  deps: QualityCheckerDeps,
  options: QualityValidationOptions = {}
): Promise<{ result: QualityValidationResult; tokenUsage: TokenUsage }> {
  const { model, generateText: genText, logger: log, signal } = deps;
  const {
    minClarityScore = IMAGE_QUALITY_VALIDATION_CONFIG.MIN_CLARITY_SCORE,
    forceEnabled = false,
  } = options;

  // If validation is disabled globally and not forced, return a "passed" result
  if (!IMAGE_QUALITY_VALIDATION_CONFIG.ENABLED && !forceEnabled) {
    log?.debug('[QualityChecker] Validation disabled, returning passed result');
    return {
      result: {
        hasWatermark: false,
        hasUIOverlay: false,
        clarityScore: 100,
        passed: true,
      },
      tokenUsage: { input: 0, output: 0 },
    };
  }

  // Check for cancellation
  if (signal?.aborted) {
    log?.debug('[QualityChecker] Validation cancelled');
    return {
      result: {
        hasWatermark: false,
        hasUIOverlay: false,
        clarityScore: 0,
        passed: false,
        notes: 'Validation cancelled',
      },
      tokenUsage: { input: 0, output: 0 },
    };
  }

  log?.debug('[QualityChecker] Validating image quality with vision LLM');

  try {
    // Call vision LLM with image
    const result = await genText({
      model,
      output: Output.object({
        schema: QualityValidationSchema,
      }),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildQualityValidationPrompt() },
            {
              type: 'image',
              image: imageBuffer,
            },
          ],
        },
      ],
      temperature: IMAGE_QUALITY_VALIDATION_CONFIG.TEMPERATURE,
      abortSignal: signal,
    });

    const response = result.output;
    const tokenUsage = createTokenUsageFromResult(result);

    // Determine if image passed validation
    const passed = !response.hasWatermark && response.clarityScore >= minClarityScore;

    log?.info(
      `[QualityChecker] Validation result: ` +
      `watermark=${response.hasWatermark}, UI=${response.hasUIOverlay}, ` +
      `clarity=${response.clarityScore}, passed=${passed}`
    );

    return {
      result: {
        hasWatermark: response.hasWatermark,
        hasUIOverlay: response.hasUIOverlay,
        clarityScore: response.clarityScore,
        passed,
        notes: response.notes,
      },
      tokenUsage,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log?.warn(`[QualityChecker] Validation failed: ${errorMsg}`);

    // On error, fail validation to be safe
    return {
      result: {
        hasWatermark: false,
        hasUIOverlay: false,
        clarityScore: 0,
        passed: false,
        notes: `Validation error: ${errorMsg}`,
      },
      tokenUsage: { input: 0, output: 0 },
    };
  }
}

/**
 * Validates multiple image buffers and returns only those that pass.
 *
 * Processes images sequentially to control API costs.
 * Stops early if we have enough valid images.
 *
 * @param images - Array of {buffer, metadata} objects to validate
 * @param deps - Dependencies
 * @param options - Validation options with optional maxValid limit
 * @returns Indices of images that passed validation
 */
export async function validateImageBatch<T extends { buffer: Buffer }>(
  images: readonly T[],
  deps: QualityCheckerDeps,
  options: QualityValidationOptions & { maxValid?: number } = {}
): Promise<{ validIndices: number[]; tokenUsage: TokenUsage }> {
  const { logger: log, signal } = deps;
  const { maxValid = images.length } = options;

  // If validation is disabled, all images pass
  if (!IMAGE_QUALITY_VALIDATION_CONFIG.ENABLED) {
    log?.debug('[QualityChecker] Validation disabled, all images pass');
    return {
      validIndices: images.map((_, i) => i).slice(0, maxValid),
      tokenUsage: { input: 0, output: 0 },
    };
  }

  const validIndices: number[] = [];
  let totalTokenUsage: TokenUsage = { input: 0, output: 0 };

  for (let i = 0; i < images.length && validIndices.length < maxValid; i++) {
    // Check for cancellation
    if (signal?.aborted) {
      log?.debug('[QualityChecker] Batch validation cancelled');
      break;
    }

    const { result, tokenUsage } = await validateImageQuality(
      images[i].buffer,
      deps,
      options
    );

    totalTokenUsage = {
      input: totalTokenUsage.input + tokenUsage.input,
      output: totalTokenUsage.output + tokenUsage.output,
    };

    if (result.passed) {
      validIndices.push(i);
      log?.debug(`[QualityChecker] Image ${i} passed validation`);
    } else {
      log?.debug(`[QualityChecker] Image ${i} failed: ${result.notes ?? 'quality issues'}`);
    }
  }

  log?.info(
    `[QualityChecker] Batch validation complete: ${validIndices.length}/${images.length} passed`
  );

  return { validIndices, tokenUsage: totalTokenUsage };
}
