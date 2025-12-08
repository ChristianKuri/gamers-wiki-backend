/**
 * Test Setup
 * 
 * This file runs before all tests to set up the testing environment.
 */

import { beforeAll, afterAll, afterEach } from 'vitest';
import { server } from './mocks/server';

// Set required environment variables for tests
process.env.OPENROUTER_API_KEY = 'test-openrouter-api-key';
process.env.IGDB_CLIENT_ID = 'test-igdb-client-id';
process.env.IGDB_CLIENT_SECRET = 'test-igdb-client-secret';

// Start MSW server before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
});

// Reset handlers after each test (in case a test modifies them)
afterEach(() => {
  server.resetHandlers();
});

// Close MSW server after all tests
afterAll(() => {
  server.close();
});

