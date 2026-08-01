import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'tests/bot-worker.test.ts',
            'tests/core-unit.test.ts',
            'tests/edge-matrix.test.ts',
            'tests/engine-branches.test.ts',
            'tests/parity-regression.test.ts',
          ],
          sequence: {
            concurrent: false,
          },
        },
      },
      {
        test: {
          name: 'browser',
          include: [
            'tests/browser-failure.test.ts',
            'tests/browser-unit.test.ts',
            'tests/browser-worker-errors.test.ts',
          ],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
    coverage: {
      provider: 'istanbul',
      enabled: true,
      include: ['src/**/*.ts'],
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      all: true,
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
