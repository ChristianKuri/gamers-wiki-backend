/**
 * Logger Abstraction
 *
 * Uses Strapi's logger when available, falls back to console.
 * This abstraction allows code to work both inside Strapi context
 * and in standalone scripts/tests.
 *
 * Supports both string messages (simple logging) and structured data objects
 * (production-friendly JSON logging for better parsing and analysis).
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Log level for structured logging.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured log entry for production logging.
 */
export interface StructuredLogEntry {
  /** Event type identifier (e.g., 'phase_complete', 'search_executed') */
  readonly event: string;
  /** Optional message for human readability */
  readonly message?: string;
  /** Additional structured data */
  readonly [key: string]: unknown;
}

/**
 * Basic logger interface (string-based).
 */
export interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
}

/**
 * Extended logger interface supporting structured logging.
 */
export interface StructuredLogger extends Logger {
  /**
   * Log structured data at the specified level.
   * In production (JSON mode), outputs as JSON.
   * In development, formats as readable string.
   */
  structured: (level: LogLevel, entry: StructuredLogEntry) => void;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Whether to output logs as JSON (for production log aggregators).
 * Controlled by LOG_FORMAT environment variable.
 */
const isJsonLogging = (): boolean => process.env.LOG_FORMAT === 'json';

// ============================================================================
// String-Based Logger
// ============================================================================

/**
 * Default logger implementation that uses Strapi when available,
 * falls back to console otherwise.
 */
export const logger: Logger = {
  info: (message: string) =>
    typeof strapi !== 'undefined' ? strapi.log.info(message) : console.log(message),
  warn: (message: string) =>
    typeof strapi !== 'undefined' ? strapi.log.warn(message) : console.warn(message),
  error: (message: string) =>
    typeof strapi !== 'undefined' ? strapi.log.error(message) : console.error(message),
  debug: (message: string) =>
    typeof strapi !== 'undefined' ? strapi.log.debug(message) : console.log(message),
};

/**
 * Creates a prefixed logger for specific modules.
 *
 * @param prefix - The prefix to add to all log messages
 * @returns A logger with the prefix prepended to all messages
 *
 * @example
 * const log = createPrefixedLogger('[Scout]');
 * log.info('Starting research'); // logs: "[Scout] Starting research"
 */
export function createPrefixedLogger(prefix: string): Logger {
  return {
    info: (message: string) => logger.info(`${prefix} ${message}`),
    warn: (message: string) => logger.warn(`${prefix} ${message}`),
    error: (message: string) => logger.error(`${prefix} ${message}`),
    debug: (message: string) => logger.debug(`${prefix} ${message}`),
  };
}

// ============================================================================
// Structured Logger
// ============================================================================

/**
 * Formats a structured log entry as a readable string for development.
 */
function formatStructuredEntry(prefix: string, entry: StructuredLogEntry): string {
  const { event, message, ...rest } = entry;
  const dataStr = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
  const msgStr = message ? `: ${message}` : '';
  return `${prefix} [${event}]${msgStr}${dataStr}`;
}

/**
 * Formats a structured log entry as JSON for production.
 */
function formatStructuredJson(prefix: string, level: LogLevel, entry: StructuredLogEntry): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    module: prefix.replace(/[\[\]]/g, '').trim(),
    ...entry,
  });
}

/**
 * Creates a structured logger for specific modules.
 * Supports both string messages and structured data objects.
 *
 * @param prefix - The prefix/module name to add to all log messages
 * @returns A structured logger with both string and structured logging methods
 *
 * @example
 * // String logging (development)
 * const log = createStructuredLogger('[Scout]');
 * log.info('Starting research');
 *
 * @example
 * // Structured logging (production)
 * log.structured('info', {
 *   event: 'phase_complete',
 *   phase: 'scout',
 *   durationMs: 1500,
 *   sourcesFound: 12,
 * });
 */
export function createStructuredLogger(prefix: string): StructuredLogger {
  const logAtLevel = (level: LogLevel, message: string): void => {
    switch (level) {
      case 'debug':
        logger.debug(message);
        break;
      case 'info':
        logger.info(message);
        break;
      case 'warn':
        logger.warn(message);
        break;
      case 'error':
        logger.error(message);
        break;
    }
  };

  return {
    info: (message: string) => logger.info(`${prefix} ${message}`),
    warn: (message: string) => logger.warn(`${prefix} ${message}`),
    error: (message: string) => logger.error(`${prefix} ${message}`),
    debug: (message: string) => logger.debug(`${prefix} ${message}`),

    structured: (level: LogLevel, entry: StructuredLogEntry): void => {
      const formatted = isJsonLogging()
        ? formatStructuredJson(prefix, level, entry)
        : formatStructuredEntry(prefix, entry);
      logAtLevel(level, formatted);
    },
  };
}

