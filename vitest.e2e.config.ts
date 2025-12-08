import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Vitest configuration for E2E tests
 * 
 * E2E tests require:
 * - Strapi running at http://localhost:1337
 * - PostgreSQL database accessible
 * - IGDB and OpenRouter credentials configured
 */
export default defineConfig({
  test: {
    // Test environment
    environment: 'node',
    
    // Long timeout for E2E tests (2 minutes)
    testTimeout: 120000,
    
    // No setup file - E2E tests handle their own setup
    setupFiles: [],
    
    // Only include E2E test patterns
    include: ['tests/e2e/**/*.test.ts'],
    
    // Exclude patterns
    exclude: ['node_modules', 'dist', 'build'],
    
    // Run tests serially (no parallelism for E2E)
    sequence: {
      concurrent: false,
    },
    
    // Global variables for tests
    globals: true,
    
    // Resolve aliases to match project structure
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

