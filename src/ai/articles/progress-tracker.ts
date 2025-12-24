/**
 * Progress Tracker
 *
 * Centralized utility for tracking and reporting article generation progress.
 * Encapsulates progress calculation logic and provides a clean API for phases.
 */

import { GENERATOR_CONFIG } from './config';
import type { ArticleGenerationPhase, ArticleProgressCallback } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Progress tracker configuration.
 */
interface ProgressTrackerConfig {
  /** Start percentage for Specialist section progress (default: 10) */
  readonly specialistProgressStart: number;
  /** End percentage for Specialist section progress (default: 90) */
  readonly specialistProgressEnd: number;
}

// ============================================================================
// ProgressTracker Class
// ============================================================================

/**
 * Tracks and reports progress for article generation.
 *
 * Provides a centralized way to report progress callbacks with consistent
 * percentage calculations across all phases.
 *
 * @example
 * const tracker = new ProgressTracker(onProgress);
 *
 * tracker.startPhase('scout');
 * // ... do work ...
 * tracker.completePhase('scout', 'Found 25 sources');
 *
 * tracker.startPhase('specialist');
 * tracker.reportSectionProgress(1, 5, 'Introduction');
 * tracker.reportSectionProgress(2, 5, 'Gameplay');
 * // ...
 * tracker.completePhase('specialist', 'Wrote 5 sections');
 */
export class ProgressTracker {
  private readonly config: ProgressTrackerConfig;

  constructor(
    private readonly onProgress?: ArticleProgressCallback,
    config?: Partial<ProgressTrackerConfig>
  ) {
    this.config = {
      specialistProgressStart: config?.specialistProgressStart ?? GENERATOR_CONFIG.SPECIALIST_PROGRESS_START,
      specialistProgressEnd: config?.specialistProgressEnd ?? GENERATOR_CONFIG.SPECIALIST_PROGRESS_END,
    };
  }

  /**
   * Reports the start of a phase (0% progress).
   *
   * @param phase - The phase being started
   * @param message - Optional message describing what's starting
   */
  startPhase(phase: ArticleGenerationPhase, message?: string): void {
    this.onProgress?.(phase, 0, message ?? this.getDefaultStartMessage(phase));
  }

  /**
   * Reports the completion of a phase (100% progress).
   *
   * @param phase - The phase being completed
   * @param message - Message describing the outcome
   */
  completePhase(phase: ArticleGenerationPhase, message: string): void {
    this.onProgress?.(phase, 100, message);
  }

  /**
   * Reports progress during section writing in the Specialist phase.
   *
   * Progress is calculated as a percentage between specialistProgressStart
   * and specialistProgressEnd based on how many sections have been completed.
   *
   * @param current - Current section number (1-indexed)
   * @param total - Total number of sections
   * @param headline - Headline of the current section
   */
  reportSectionProgress(current: number, total: number, headline: string): void {
    const { specialistProgressStart, specialistProgressEnd } = this.config;
    const progressRange = specialistProgressEnd - specialistProgressStart;
    const sectionProgress = Math.round(specialistProgressStart + (current / total) * progressRange);
    this.onProgress?.('specialist', sectionProgress, `Writing section ${current}/${total}: ${headline}`);
  }

  /**
   * Reports arbitrary progress within a phase.
   *
   * @param phase - The current phase
   * @param progress - Progress percentage (0-100)
   * @param message - Optional status message
   */
  report(phase: ArticleGenerationPhase, progress: number, message?: string): void {
    this.onProgress?.(phase, progress, message);
  }

  /**
   * Returns whether a progress callback is registered.
   */
  get hasCallback(): boolean {
    return this.onProgress !== undefined;
  }

  /**
   * Gets the default start message for a phase.
   */
  private getDefaultStartMessage(phase: ArticleGenerationPhase): string {
    switch (phase) {
      case 'scout':
        return 'Starting research phase';
      case 'editor':
        return 'Planning article structure';
      case 'specialist':
        return 'Writing article sections';
      case 'validation':
        return 'Validating article quality';
      default:
        return `Starting ${phase} phase`;
    }
  }
}

/**
 * Creates a no-op progress tracker for when no callback is needed.
 * All methods are safe to call but do nothing.
 */
export function createNoOpProgressTracker(): ProgressTracker {
  return new ProgressTracker(undefined);
}

