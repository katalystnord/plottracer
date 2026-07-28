import { defineConfig } from 'vitest/config';

// A vitest config for MUTATION TESTING only (Stryker), not for `npm test`.
//
// Stryker re-runs the suite once per mutant, so the run has to be the fast,
// pure part of the suite and nothing else: core/, engine/ and algorithms/ unit
// tests are milliseconds each, while every ui/__tests__/*.e2e.test.ts launches
// a real Electron app. Including even one e2e file would multiply an
// already-long run by minutes per mutant and put windows on the developer's
// screen.
//
// File parallelism is left ON here (the root config disables it because the e2e
// files contend over Electron launches — a constraint that does not apply to
// the pure suites this config runs).
export default defineConfig({
  test: {
    include: ['core/__tests__/**/*.test.ts', 'engine/__tests__/**/*.test.ts', 'algorithms/__tests__/**/*.test.ts'],
    testTimeout: 15000,
  },
});
