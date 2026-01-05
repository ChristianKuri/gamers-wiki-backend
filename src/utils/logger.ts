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
// Forwarding Logger (for UI progress tracking)
// ============================================================================

/**
 * Callback type for log forwarding.
 * Called with log level and the full formatted message.
 */
export type LogForwardCallback = (level: LogLevel, message: string) => void;

/**
 * Creates a forwarding logger that logs to both terminal and a callback.
 * Useful for sending logs to a UI progress tracker while keeping terminal output.
 *
 * @param prefix - The prefix to add to all log messages (e.g., '[Scout]')
 * @param onLog - Optional callback that receives all log messages
 * @returns A logger that forwards to both terminal and callback
 *
 * @example
 * // Create forwarding logger for Scout that sends to UI
 * const log = createForwardingLogger('[Scout]', (level, message) => {
 *   progressTracker.log('scout', 50, message);
 * });
 * log.info('Found 25 sources'); // logs to terminal AND calls onLog callback
 */
export function createForwardingLogger(
  prefix: string,
  onLog?: LogForwardCallback
): Logger {
  const logAndForward = (level: LogLevel, message: string): void => {
    const fullMessage = `${prefix} ${message}`;
    
    // Log to terminal
    switch (level) {
      case 'debug':
        logger.debug(fullMessage);
        break;
      case 'info':
        logger.info(fullMessage);
        break;
      case 'warn':
        logger.warn(fullMessage);
        break;
      case 'error':
        logger.error(fullMessage);
        break;
    }
    
    // Forward to callback (without prefix for cleaner UI display)
    onLog?.(level, message);
  };

  return {
    info: (message: string) => logAndForward('info', message),
    warn: (message: string) => logAndForward('warn', message),
    error: (message: string) => logAndForward('error', message),
    debug: (message: string) => logAndForward('debug', message),
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

// ============================================================================
// Correlation ID Support
// ============================================================================

/**
 * Logging context with correlation ID for tracing requests.
 */
export interface LoggingContext {
  /** Unique identifier for correlating logs across phases */
  readonly correlationId: string;
  /** Additional context fields to include in all logs */
  readonly [key: string]: unknown;
}

/**
 * Logger with correlation context automatically included.
 */
export interface ContextualLogger extends StructuredLogger {
  /** The correlation context for this logger */
  readonly context: LoggingContext;
  /** Create a child logger with additional context */
  child: (additionalContext: Record<string, unknown>) => ContextualLogger;
}

/**
 * Generates a unique correlation ID.
 * Uses timestamp + random suffix for uniqueness.
 */
export function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * Formats a structured log entry with correlation context.
 */
function formatContextualEntry(
  prefix: string,
  context: LoggingContext,
  entry: StructuredLogEntry
): string {
  const { correlationId, ...restContext } = context;
  const { event, message, ...restEntry } = entry;

  const allData = { ...restContext, ...restEntry };
  const dataStr = Object.keys(allData).length > 0 ? ` ${JSON.stringify(allData)}` : '';
  const msgStr = message ? `: ${message}` : '';
  const corrStr = `[${correlationId}]`;

  return `${prefix} ${corrStr} [${event}]${msgStr}${dataStr}`;
}

/**
 * Formats a structured log entry with correlation context as JSON.
 */
function formatContextualJson(
  prefix: string,
  level: LogLevel,
  context: LoggingContext,
  entry: StructuredLogEntry
): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    module: prefix.replace(/[\[\]]/g, '').trim(),
    ...context,
    ...entry,
  });
}

/**
 * Creates a contextual logger with correlation ID for tracing.
 * All logs from this logger include the correlation context.
 *
 * @param prefix - The prefix/module name to add to all log messages
 * @param context - Logging context including correlationId
 * @returns A contextual logger with correlation ID support
 *
 * @example
 * // Create logger with correlation ID
 * const correlationId = generateCorrelationId();
 * const log = createContextualLogger('[ArticleGen]', {
 *   correlationId,
 *   gameName: 'Elden Ring',
 * });
 *
 * // All logs include the context
 * log.info('Starting generation'); // [ArticleGen] [abc123] Starting generation
 *
 * @example
 * // Create child logger with additional context
 * const scoutLog = log.child({ phase: 'scout' });
 * scoutLog.structured('info', { event: 'search_complete', sources: 25 });
 */
export function createContextualLogger(
  prefix: string,
  context: LoggingContext
): ContextualLogger {
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

  const formatWithContext = (message: string): string => {
    return `${prefix} [${context.correlationId}] ${message}`;
  };

  return {
    context,

    info: (message: string) => logger.info(formatWithContext(message)),
    warn: (message: string) => logger.warn(formatWithContext(message)),
    error: (message: string) => logger.error(formatWithContext(message)),
    debug: (message: string) => logger.debug(formatWithContext(message)),

    structured: (level: LogLevel, entry: StructuredLogEntry): void => {
      const formatted = isJsonLogging()
        ? formatContextualJson(prefix, level, context, entry)
        : formatContextualEntry(prefix, context, entry);
      logAtLevel(level, formatted);
    },

    child: (additionalContext: Record<string, unknown>): ContextualLogger => {
      return createContextualLogger(prefix, { ...context, ...additionalContext });
    },
  };
}

