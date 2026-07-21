import { defineConfig } from 'vitest/config';

// Root vitest config, read by `npm test` (`vitest run` from the repo root).
// It has to live here, not in ui/vite.config.ts, because vitest resolves its
// config from the CWD -- ui/vite.config.ts is only for `vite build` of ui/.
//
// testTimeout is raised from vitest's 5s default (checkpoint 39): the
// Electron+Konva e2e suites (ui/__tests__/*.e2e.test.ts) drive a real windowed
// app, and the canvas-dominant layout made the canvas larger, so the heaviest
// tests (two full calibrations + hardcoded settle sleeps + Playwright<->
// renderer round-trips) render more per interaction and sat just above 5s on
// slower machines. 15s gives headroom without masking a real hang; the
// pre-existing intermittent ~20s Electron-launch hang lives in beforeEach,
// hence the larger hookTimeout. Pure unit tests finish in milliseconds, so
// this ceiling never bites them.
export default defineConfig({
  test: {
    testTimeout: 15000,
    hookTimeout: 40000,
    // Run test FILES one at a time. The e2e files each launch a real Electron
    // app; vitest's default file-parallelism launched several at once, and the
    // contention was the "intermittent ~20s launch hang" -- a shifting set of
    // e2e tests would fail their launch hook under load while every file passed
    // in isolation. Serialising files removes the contention (the unit files are
    // milliseconds each, so the cost is negligible next to the e2e run). A
    // projects split (parallel unit / serial e2e) is the finer-grained follow-up.
    fileParallelism: false,
  },
});
