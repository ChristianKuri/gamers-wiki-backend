/**
 * Progress Tracker
 *
 * Centralized utility for tracking and reporting article generation progress.
 * Encapsulates progress calculation logic and provides a clean API for phases.
 * 
 * Supports unified logging that outputs to both terminal (via logger) and UI (via progress callback).
 */

import { GENERATOR_CONFIG } from './config';
import type { ArticleGenerationPhase, ArticleProgressCallback } from './types';
import type { LogForwardCallback, LogLevel } from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Logger interface for terminal output.
 */
interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  debug: (message: string) => void;
  error: (message: string) => void;
}

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
 * percentage calculations across all phases. Supports unified logging that
 * outputs to both terminal and UI simultaneously.
 *
 * @example
 * const tracker = new ProgressTracker(onProgress, config, logger);
 *
 * // Log to both terminal and UI
 * tracker.log('scout', 50, 'Searching for sources...');
 *
 * // Or use phase lifecycle methods
 * tracker.startPhase('scout');
 * tracker.completePhase('scout', 'Found 25 sources');
 */
export class ProgressTracker {
  private readonly config: ProgressTrackerConfig;
  private currentPhase: ArticleGenerationPhase = 'scout';
  /** Track last known progress for each phase (for log forwarding) */
  private phaseProgress: Map<ArticleGenerationPhase, number> = new Map();

  constructor(
    private readonly onProgress?: ArticleProgressCallback,
    config?: Partial<ProgressTrackerConfig>,
    private readonly logger?: Logger
  ) {
    this.config = {
      specialistProgressStart: config?.specialistProgressStart ?? GENERATOR_CONFIG.SPECIALIST_PROGRESS_START,
      specialistProgressEnd: config?.specialistProgressEnd ?? GENERATOR_CONFIG.SPECIALIST_PROGRESS_END,
    };
  }

  /**
   * Unified logging: logs to both terminal and UI progress.
   * 
   * @param phase - The current phase
   * @param progress - Progress percentage (0-100)
   * @param message - Status message (shown in both terminal and UI)
   * @param terminalOnly - If true, only log to terminal (not UI)
   */
  log(phase: ArticleGenerationPhase, progress: number, message: string, terminalOnly = false): void {
    this.currentPhase = phase;
    this.phaseProgress.set(phase, progress);
    this.logger?.info(message);
    if (!terminalOnly) {
      this.onProgress?.(phase, progress, message);
    }
  }

  /**
   * Log a warning to both terminal and UI.
   */
  warn(phase: ArticleGenerationPhase, progress: number, message: string): void {
    this.currentPhase = phase;
    this.phaseProgress.set(phase, progress);
    this.logger?.warn(message);
    this.onProgress?.(phase, progress, `⚠️ ${message}`);
  }

  /**
   * Log debug info (terminal only, no UI).
   */
  debug(message: string): void {
    this.logger?.debug(message);
  }

  /**
   * Reports the start of a phase (0% progress).
   *
   * @param phase - The phase being started
   * @param message - Optional message describing what's starting
   */
  startPhase(phase: ArticleGenerationPhase, message?: string): void {
    this.currentPhase = phase;
    this.phaseProgress.set(phase, 0);
    const msg = message ?? this.getDefaultStartMessage(phase);
    this.logger?.info(msg);
    this.onProgress?.(phase, 0, msg);
  }

  /**
   * Reports the completion of a phase (100% progress).
   *
   * @param phase - The phase being completed
   * @param message - Message describing the outcome
   */
  completePhase(phase: ArticleGenerationPhase, message: string): void {
    this.currentPhase = phase;
    this.phaseProgress.set(phase, 100);
    this.logger?.info(message);
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
    this.phaseProgress.set('specialist', sectionProgress);
    const message = `Writing section ${current}/${total}: ${headline}`;
    this.logger?.info(message);
    this.onProgress?.('specialist', sectionProgress, message);
  }

  /**
   * Reports arbitrary progress within a phase (UI only, no terminal log).
   * Use `log()` instead if you want both terminal and UI output.
   *
   * @param phase - The current phase
   * @param progress - Progress percentage (0-100)
   * @param message - Optional status message
   */
  report(phase: ArticleGenerationPhase, progress: number, message?: string): void {
    this.currentPhase = phase;
    this.phaseProgress.set(phase, progress);
    this.onProgress?.(phase, progress, message);
  }

  /**
   * Forward a log message from a sub-agent to the UI.
   * Used by createForwardingLogger callbacks to send sub-agent logs to UI.
   *
   * @param phase - The phase this log belongs to
   * @param level - Log level (info, warn, error, debug)
   * @param message - The log message (without prefix - already logged to terminal)
   */
  forwardLog(phase: ArticleGenerationPhase, level: LogLevel, message: string): void {
    // Don't forward debug logs to UI - too noisy
    if (level === 'debug') {
      return;
    }

    // Add warning emoji for warn level
    const displayMessage = level === 'warn' ? `⚠️ ${message}` : message;
    
    // Use the last known progress for this phase (default to 50 if unknown)
    const progress = this.phaseProgress.get(phase) ?? 50;
    
    this.onProgress?.(phase, progress, displayMessage);
  }

  /**
   * Creates a LogForwardCallback that can be passed to createForwardingLogger.
   * Logs from sub-agents will be forwarded to the UI progress display.
   *
   * @param phase - The phase these logs belong to (e.g., 'scout', 'editor')
   * @returns A callback compatible with createForwardingLogger's onLog parameter
   *
   * @example
   * const scoutLogger = createForwardingLogger(
   *   '[Scout]',
   *   progressTracker.createLogForwarder('scout')
   * );
   */
  createLogForwarder(phase: ArticleGenerationPhase): LogForwardCallback {
    return (level: LogLevel, message: string) => {
      this.forwardLog(phase, level, message);
    };
  }

  /**
   * Returns whether a progress callback is registered.
   */
  get hasCallback(): boolean {
    return this.onProgress !== undefined;
  }

  /**
   * Returns whether a logger is configured.
   */
  get hasLogger(): boolean {
    return this.logger !== undefined;
  }

  /**
   * Gets the current phase being tracked.
   */
  get phase(): ArticleGenerationPhase {
    return this.currentPhase;
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
      case 'reviewer':
        return 'Reviewing article quality';
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

