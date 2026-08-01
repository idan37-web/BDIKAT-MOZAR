import { defineConfig } from 'vitest/config';

// Enforcement layer: playbook acceptance tests against real brand fixtures + structural
// guards. `npm run build` runs this suite FIRST — red tests fail the build.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 240_000,
    hookTimeout: 240_000,
  },
});
