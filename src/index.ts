import type { Core } from '@strapi/strapi';
import { runSeeders } from './bootstrap/seeders';
import { TRANSIENT_NETWORK_ERROR_PATTERN } from './ai/articles/retry';

/**
 * Global unhandled rejection handler.
 *
 * Prevents the entire process from crashing when a promise rejection goes
 * unhandled (e.g., socket termination errors from fetch operations).
 * These errors are typically transient network issues that should be logged
 * but not crash the server.
 */
process.on('unhandledRejection', (reason, _promise) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const cause = reason instanceof Error && 'cause' in reason
    ? ` [cause: ${reason.cause instanceof Error ? reason.cause.message : String(reason.cause)}]`
    : '';

  // Log but don't crash - these are usually transient network errors
  console.error(`[UnhandledRejection] Promise rejected: ${message}${cause}`);

  // If it's a known transient error, just log and continue
  const isTransient = TRANSIENT_NETWORK_ERROR_PATTERN.test(message + cause);
  if (isTransient) {
    console.warn('[UnhandledRejection] Transient error detected, continuing...');
    return;
  }

  // For unknown errors, log the full stack but still don't crash
  if (reason instanceof Error && reason.stack) {
    console.error('[UnhandledRejection] Stack trace:', reason.stack);
  }
});

/**
 * Extended HTTP request timeout for long-running operations.
 *
 * The article generator can take 10+ minutes when:
 * - Scout phase runs multiple parallel searches
 * - Specialist writes all sections
 * - Reviewer identifies issues → Fixer applies fixes → Re-review loop
 *
 * Default Node.js timeout (2 minutes) is insufficient.
 * Set to 15 minutes to match E2E test timeout expectations.
 */
const EXTENDED_REQUEST_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await runSeeders(strapi);

    // Extend HTTP server timeouts for long-running operations like article generation.
    // The article generator endpoint can take 10+ minutes due to:
    // - Multiple AI calls (Scout, Editor, Specialist, Reviewer, Fixer)
    // - External search API calls (Tavily, Exa)
    // - Potential Fixer retry loops
    //
    // Without this, the server closes the connection before the response is ready,
    // causing "SocketError: other side closed" in clients.
    //
    // Node.js HTTP server timeouts:
    // - timeout: Overall socket inactivity timeout (CRITICAL for long responses)
    // - requestTimeout: Time to receive entire request from client
    // - headersTimeout: Time to receive HTTP headers
    // - keepAliveTimeout: Time to keep idle connections open
    //
    // See: https://nodejs.org/api/http.html#servertimeout
    const httpServer = strapi.server?.httpServer;
    if (httpServer) {
      // Disable socket inactivity timeout (0 = no timeout)
      // This is the key setting for long-running request handlers
      httpServer.timeout = 0;

      // Also set other timeouts for completeness
      httpServer.requestTimeout = EXTENDED_REQUEST_TIMEOUT_MS;
      httpServer.headersTimeout = EXTENDED_REQUEST_TIMEOUT_MS + 1000; // Must be > requestTimeout
      httpServer.keepAliveTimeout = EXTENDED_REQUEST_TIMEOUT_MS;

      strapi.log.info(
        `HTTP server timeouts configured for long-running operations (timeout=disabled)`
      );
    }
  },
};
