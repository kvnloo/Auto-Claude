import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Vitest configuration for mobile app unit tests
 *
 * This config is used to run tests for mobile-specific utilities
 * that don't require React Native runtime (pure TypeScript functions).
 *
 * Run tests with: npm test
 */
export default defineConfig({
  test: {
    globals: true,
    // Use jsdom for React hook testing (renderHook from @testing-library/react)
    environment: 'jsdom',
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.spec.ts'],
    exclude: ['node_modules', 'dist', '.expo'],
    root: resolve(__dirname),
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['utils/**/*.ts', 'types/**/*.ts', 'hooks/**/*.ts', 'api/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/*.d.ts'],
    },
    server: {
      deps: {
        // Inline dependencies that need mocking to avoid parsing issues
        inline: ['react-native'],
      },
    },
    // Setup files run before each test file
    setupFiles: [],
  },
  resolve: {
    alias: {
      // Mock react-native with a simple stub to avoid Flow parsing issues
      'react-native': resolve(__dirname, '__tests__/__mocks__/react-native.ts'),
      '@': resolve(__dirname),
    },
  },
});
