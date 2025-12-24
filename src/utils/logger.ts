/**
 * Logger Abstraction
 *
 * Uses Strapi's logger when available, falls back to console.
 * This abstraction allows code to work both inside Strapi context
 * and in standalone scripts/tests.
 */

export interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
}

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

