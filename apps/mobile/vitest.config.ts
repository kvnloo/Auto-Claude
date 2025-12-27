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
    environment: 'node',
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.spec.ts'],
    exclude: ['node_modules', 'dist', '.expo'],
    root: resolve(__dirname),
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['utils/**/*.ts', 'types/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/*.d.ts'],
    },
    deps: {
      // Inline dependencies that need mocking to avoid parsing issues
      inline: ['react-native'],
    },
  },
  resolve: {
    alias: {
      // Mock react-native with a simple stub to avoid Flow parsing issues
      'react-native': resolve(__dirname, '__tests__/__mocks__/react-native.ts'),
      '@': resolve(__dirname),
    },
  },
});
