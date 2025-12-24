/**
 * Phase Timer
 *
 * Utility class for tracking phase durations during article generation.
 * Encapsulates timing logic and provides a clean API for starting and ending phases.
 */

import type { Clock, ArticleGenerationPhase } from './types';
import { systemClock } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Duration information for all phases.
 */
export interface PhaseDurations {
  readonly scout: number;
  readonly editor: number;
  readonly specialist: number;
  readonly validation: number;
}

// ============================================================================
// PhaseTimer Class
// ============================================================================

/**
 * Tracks timing for article generation phases.
 *
 * Provides a clean API for starting phases, recording durations,
 * and retrieving all phase durations at the end.
 *
 * @example
 * const timer = new PhaseTimer(clock);
 *
 * timer.start('scout');
 * // ... do scout work ...
 * timer.end('scout');
 *
 * timer.start('editor');
 * // ... do editor work ...
 * timer.end('editor');
 *
 * const durations = timer.getDurations();
 * // { scout: 1500, editor: 2000, specialist: 0, validation: 0 }
 */
export class PhaseTimer {
  private readonly clock: Clock;
  private readonly startTimes = new Map<ArticleGenerationPhase, number>();
  private readonly durations = new Map<ArticleGenerationPhase, number>();

  constructor(clock: Clock = systemClock) {
    this.clock = clock;
  }

  /**
   * Starts timing for a phase.
   * If the phase was already started, this restarts the timer.
   *
   * @param phase - The phase to start timing
   */
  start(phase: ArticleGenerationPhase): void {
    this.startTimes.set(phase, this.clock.now());
  }

  /**
   * Ends timing for a phase and records the duration.
   * If the phase was never started, duration will be 0.
   *
   * @param phase - The phase to end timing
   * @returns The duration in milliseconds
   */
  end(phase: ArticleGenerationPhase): number {
    const startTime = this.startTimes.get(phase);
    // Use !== undefined instead of truthy check because startTime of 0 is valid
    const duration = startTime !== undefined ? this.clock.now() - startTime : 0;
    this.durations.set(phase, duration);
    this.startTimes.delete(phase);
    return duration;
  }

  /**
   * Gets the duration for a specific phase.
   * Returns 0 if the phase hasn't been timed yet.
   *
   * @param phase - The phase to get duration for
   * @returns The duration in milliseconds
   */
  getDuration(phase: ArticleGenerationPhase): number {
    return this.durations.get(phase) ?? 0;
  }

  /**
   * Gets all phase durations.
   * Phases that haven't been timed will have duration 0.
   *
   * @returns Object with all phase durations
   */
  getDurations(): PhaseDurations {
    return {
      scout: this.getDuration('scout'),
      editor: this.getDuration('editor'),
      specialist: this.getDuration('specialist'),
      validation: this.getDuration('validation'),
    };
  }

  /**
   * Gets the total duration across all phases.
   *
   * @returns Total duration in milliseconds
   */
  getTotalDuration(): number {
    let total = 0;
    for (const duration of this.durations.values()) {
      total += duration;
    }
    return total;
  }

  /**
   * Checks if a phase has been started but not ended.
   *
   * @param phase - The phase to check
   * @returns True if the phase is currently being timed
   */
  isRunning(phase: ArticleGenerationPhase): boolean {
    return this.startTimes.has(phase);
  }

  /**
   * Checks if a phase has been completed (started and ended).
   *
   * @param phase - The phase to check
   * @returns True if the phase has a recorded duration
   */
  isCompleted(phase: ArticleGenerationPhase): boolean {
    return this.durations.has(phase);
  }

  /**
   * Resets all timing data.
   * Useful for reusing the timer across multiple generations.
   */
  reset(): void {
    this.startTimes.clear();
    this.durations.clear();
  }
}

/**
 * Creates a new PhaseTimer instance.
 *
 * @param clock - Optional clock for time operations (defaults to systemClock)
 * @returns A new PhaseTimer instance
 */
export function createPhaseTimer(clock?: Clock): PhaseTimer {
  return new PhaseTimer(clock);
}

