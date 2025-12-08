import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',
    
    // Global test timeout (30 seconds for integration tests)
    testTimeout: 30000,
    
    // Setup file to run before tests
    setupFiles: ['./tests/setup.ts'],
    
    // Include test patterns (exclude E2E by default - they require Strapi running)
    include: ['tests/**/*.test.ts'],
    
    // Exclude patterns - E2E tests are run separately with RUN_E2E_TESTS=true
    exclude: [
      'node_modules',
      'dist',
      'build',
      'tests/e2e/**', // E2E tests require Strapi to be running
    ],
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/admin/**',
        'src/bootstrap/**',
        '**/*.d.ts',
      ],
    },
    
    // Global variables for tests
    globals: true,
    
    // Resolve aliases to match project structure
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

