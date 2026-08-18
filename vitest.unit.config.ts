import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.js';

/**
 * THE UNIT BOARD - everything except the suites that launch a real Electron app.
 *
 * ⚑⚑ WHY IT EXISTS: **CI never ran a test.** Until now `.github/workflows/
 * build.yml` ran `npm ci`, typecheck, lint and the packager, so a tag could be
 * pushed, built and PUBLISHED without a single test having executed anywhere but
 * the maintainer's own machine. The pre-commit hook types-check and nothing
 * more, and `--no-verify` walks past even that. This config is the half of the
 * board a hosted runner can execute in well under a minute.
 *
 * ⚑ The e2e half deliberately stays local. It needs a real Electron app on a
 * virtual display and takes ~22 minutes; running it here would trade a fast,
 * trustworthy gate for a slow, flaky one. **Said out loud rather than left to be
 * discovered:** CI proves the pure layers, not the app. His hands and the local
 * board remain the only things that prove the app.
 *
 * ⚑⚑ THE EXCLUSION IS BY CONVENTION, AND THE CONVENTION IS ENFORCED. `*.e2e.
 * test.ts` is a pattern, not a list - and `e2eContainment.test.ts` asserts that
 * every file importing Playwright's Electron driver is named that way, so a
 * fourth one cannot appear outside the pattern. That assertion exists because of
 * exactly this mistake, made by hand on 2026-08-17: a suite run excluded
 * `workspace.e2e.test.ts` BY NAME, and the two other Electron files it had
 * forgotten launched onto the developer's screen. **A hand-listed exclusion is
 * the same defect as a hand-maintained list; it does not grow.**
 *
 * ⚑ MERGED, not restated. The base config carries the raised timeouts, the
 * serial file execution and the `.stryker-tmp` exclusion, each with a hard-won
 * reason written on it. Copying those here would fork every one of them.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: ['**/*.e2e.test.ts'],
    },
  })
);
