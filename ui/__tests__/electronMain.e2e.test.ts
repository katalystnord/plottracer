/**
 * Committed regression coverage for ui/electron-main.cjs (checkpoint 29,
 * see CLAUDE.md) -- ui/'s real production entry point, as distinct from
 * ui/electron-dev.cjs's dev harness (covered exhaustively by
 * workspace.e2e.test.ts). Deliberately a separate, lightweight file
 * rather than folded into workspace.e2e.test.ts: this file's job is to
 * catch production-wiring regressions specific to electron-main.cjs
 * itself (wrong dist/preload path, devtools left open, a stray dev-only
 * setting) that launching the dev harness would never exercise, not to
 * re-verify Workspace's own behavior -- that's already covered in depth
 * elsewhere, and both entry points share the exact same IPC/preload code
 * (ui/electron-ipc.cjs, ui/electron-preload.cjs) since this checkpoint,
 * so full behavioral parity is structural, not something this file needs
 * to re-prove test by test.
 *
 * Same technique as workspace.e2e.test.ts: playwright-core's _electron,
 * launched from inside a vitest file, plain vitest expect.
 */
import { describe, it, expect } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

import { ozoneArgs } from './e2eContainment.js';

const REPO_ROOT = path.resolve(__dirname, '../..');

// ⚑ CONTAINMENT - see `./e2eContainment.ts`. THIS is the file that landed on
// David's screen on 2026-08-17: a suite run excluded `workspace.e2e.test.ts` by
// name and this one launched anyway, because the gate treated an absent
// variable as permission. It now refuses, AT the launch below.

const SAMPLE_IMAGE = path.join(REPO_ROOT, 'samples/xy-stress-strain.png');

async function launchProductionApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [...ozoneArgs(), path.join(REPO_ROOT, 'ui/electron-main.cjs')],
    cwd: REPO_ROOT,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  // app.firstWindow() resolves as soon as a BrowserWindow exists, well
  // before React has mounted and run its effects -- the two tests that
  // predate checkpoint 32 never noticed because their first action is
  // always clicking a testid button, which Playwright's own actionability
  // wait makes safe by accident. The accelerator tests press a KEY as their very
  // first action instead, with nothing to wait on -- pressed before
  // ui/src/Workspace.tsx's effects have registered the keydown listener, it is
  // simply lost. Waiting for a real testid to become visible here, once, fixes it
  // for every caller instead of each test needing its own ad hoc wait.
  await page.getByTestId('open-image-button').waitFor({ state: 'visible', timeout: 15000 });
  return { app, page };
}

describe('ui/electron-main.cjs (production entry point)', () => {
  it('loads the built dist with the production title, no devtools, and the right menu for the platform', async () => {
    const { app, page } = await launchProductionApp();
    try {
      expect(await page.title()).toBe('PlotTracer');

      const devToolsOpen = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.isDevToolsOpened());
      expect(devToolsOpen).toBe(false);

      // ⚑ v1.6: the native menu is GONE on Windows/Linux so that Alt is free for
      // the key-tips, and reduced to a roles-only App+Edit menu on macOS, without
      // which Cmd+C/V/X stop working inside text fields. Asserted per platform
      // rather than as a flat "no menu", because "no menu on macOS" would be the
      // regression, not the goal.
      const menuLabels = await app.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()?.items.map((i) => i.label) ?? null
      );
      if (process.platform === 'darwin') {
        expect(menuLabels).not.toBeNull();
        expect(menuLabels).toContain('Edit');
        // Roles only: nothing that duplicates an in-app control.
        expect(menuLabels).not.toContain('File');
        expect(menuLabels).not.toContain('View');
        expect(menuLabels).not.toContain('Help');
      } else {
        expect(menuLabels).toBeNull();
      }

      // A real signal that ui/dist's built assets loaded correctly through
      // this entry point's own file:// path resolution, not just that some
      // page rendered.
      expect(await page.getByTestId('open-image-button').isVisible()).toBe(true);
    } finally {
      await app.close();
    }
  }, 30000);

  it('runs a full calibration + point-placement flow through the production preload/IPC wiring', async () => {
    const { app, page } = await launchProductionApp();
    try {
      await app.evaluate(({ dialog }, samplePath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [samplePath] });
      }, SAMPLE_IMAGE);

      await page.getByTestId('open-image-button').click();
      await page.waitForTimeout(400);
      const box = await page.locator('canvas').first().boundingBox();
      if (!box) throw new Error('canvas did not report a bounding box');

      async function clickAt(lx: number, ly: number) {
        await page.mouse.click(box!.x + lx, box!.y + ly);
        await page.waitForTimeout(100);
      }
      async function confirmValue(value: string) {
        await page.locator('[data-testid="data-value-input"]').click({ timeout: 5000 });
        await page.keyboard.type(value);
        await page.locator('[data-testid="confirm-data-value"]').click({ timeout: 5000 });
        await page.waitForTimeout(100);
      }

      // Capture the figure first (checkpoint 103): mandatory before calibration.
      // Auto-accept the confirm dialog (no beforeEach handler in this file).
      page.on('dialog', (d) => void d.accept());
      await page.getByTestId('capture-figure').click();
      await page.waitForTimeout(150);

      // Same standard XY fixture used throughout workspace.e2e.test.ts.
      await clickAt(100, 250);
      await confirmValue('0');
      await clickAt(400, 250);
      await confirmValue('10');
      await clickAt(100, 250);
      await confirmValue('0');
      await clickAt(100, 100);
      await confirmValue('10');
      await page.getByTestId('run-calibration').click();
      await page.waitForTimeout(150);

      await clickAt(250, 175);
      // The spreadsheet renders the point as separate X/Y value cells now
      // (checkpoint 57), no pixel column. Row 1 of the active series is (5, 5).
      const cells = await page.getByTestId('points-table').locator('tbody tr').first().locator('td').allInnerTexts();
      expect(cells.slice(1).map((c) => c.trim()).filter(Boolean).map(Number)).toEqual([5, 5]);
    } finally {
      await app.close();
    }
  }, 30000);

  // ⚑ THE ACCELERATORS, now that the native menu is gone (v1.6). These used to
  // simulate a menu click by sending the channel electron-menu.cjs's own click
  // handler sent, because driving a native menu through Playwright is not
  // reliably supported cross-platform. With the bindings moved into the renderer
  // there is no such gap: pressing the key IS the production path, so these press
  // the key. That also closes the failure mode this very file was bitten by (see
  // the .tar test below) -- a channel-driven test goes on passing after the thing
  // that sends the channel is deleted, because nothing connects the two.
  // A fixed wait-then-read-once after each send proved flaky under a
  // full-suite run's resource contention from several sequential Electron
  // launches (same class of fragility already documented in CLAUDE.md for
  // checkpoints 24/25/29 -- reliable in isolation, occasionally slower
  // under load). Fixed here the more robust way: poll for the expected
  // state (vitest's own expect.poll, not @playwright/test's assertions --
  // this file still isn't on that dependency) instead of guessing a
  // sleep duration long enough for any load level.
  /**
   * Press one of the application accelerators.
   *
   * ⚑ These tests used to drive `menu:*` IPC channels, which was the only path
   * that existed while the native menu owned the accelerators. The menu is gone
   * (v1.6) and the bindings live in the renderer, so pressing the KEY is now both
   * the real user path and the only one -- a channel-driven test would have gone
   * on passing against wiring nothing could reach.
   */
  async function pressAccelerator(page: Page, combo: string) {
    await page.keyboard.press(combo);
  }

  function readScale(viewStateText: string): number {
    const match = viewStateText.match(/scale: ([\d.]+)/);
    if (!match) throw new Error(`could not parse scale from "${viewStateText}"`);
    return Number(match[1]);
  }

  async function pollScale(page: Page): Promise<number> {
    return readScale((await page.getByTestId('view-state').textContent())!);
  }

  it('the zoom accelerators change the canvas view state (Ctrl +/-/0/1)', async () => {
    const { app, page } = await launchProductionApp();
    try {
      // Captured before opening anything -- the literal pre-load default
      // ("scale: 1.000, offset: (0.0, 0.0)"). Image loading is the slowest
      // of these chains (IPC round-trip + <img> decode), so poll until
      // view-state has changed from this exact baseline at all, rather
      // than assuming any fixed delay is long enough or guessing what the
      // fitted values will be.
      const initialViewState = await page.getByTestId('view-state').textContent();

      await app.evaluate(({ dialog }, samplePath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [samplePath] });
      }, SAMPLE_IMAGE);
      await pressAccelerator(page, 'Control+o');
      await expect
        .poll(async () => (await page.getByTestId('view-state').textContent()) ?? '', { timeout: 10000 })
        .not.toBe(initialViewState);
      const fittedScale = await pollScale(page);

      await pressAccelerator(page, 'Control+=');
      await expect.poll(() => pollScale(page), { timeout: 10000 }).toBeGreaterThan(fittedScale);

      await pressAccelerator(page, 'Control+-');
      await pressAccelerator(page, 'Control+-');
      await expect.poll(() => pollScale(page), { timeout: 10000 }).toBeLessThan(fittedScale);

      // "Actual Size" -- checkpoint 32's zoomByFactor(view, cx, cy,
      // 1/view.scale) case, exercised here through the real menu/IPC path
      // rather than only as a unit test.
      await pressAccelerator(page, 'Control+1');
      await expect.poll(() => pollScale(page), { timeout: 10000 }).toBeCloseTo(1, 2);

      await pressAccelerator(page, 'Control+0');
      await expect.poll(() => pollScale(page), { timeout: 10000 }).toBeCloseTo(fittedScale, 2);
    } finally {
      await app.close();
    }
  }, 30000);

  it('Ctrl+S reaches Workspace.tsx\'s saveProject handler', async () => {
    const { app, page } = await launchProductionApp();
    try {
      // No image loaded -- saveProject()'s own first-line guard produces a
      // deterministic, observable error, confirming the menu event reached
      // the handler at all (an unwired listener would show nothing).
      await pressAccelerator(page, 'Control+s');
      await expect
        .poll(async () => (await page.getByTestId('project-error').textContent({ timeout: 1000 }).catch(() => null)) ?? '', { timeout: 10000 })
        .toContain('Load an image before saving a project.');
    } finally {
      await app.close();
    }
  }, 30000);

  it('Ctrl+Shift+O / Ctrl+Shift+S reach the same handlers as their top-bar buttons', async () => {
    const { app, page } = await launchProductionApp();
    try {
      // Save Data As CSV… -- deterministic without any file I/O: no axes
      // calibrated yet, so exportCSV()'s own early-exit error confirms the
      // menu event reached it.
      await pressAccelerator(page, 'Control+Shift+S');
      await expect
        .poll(async () => (await page.getByTestId('project-error').textContent({ timeout: 1000 }).catch(() => null)) ?? '', { timeout: 10000 })
        .toContain('Calibrate the axes before exporting data.');

      // Open Project… actually reads a file via IPC, so stub the native
      // dialog to return a real (deliberately invalid) file rather than a
      // fake path -- a clean way to confirm the event reaches
      // deserializeProject without needing a full valid project fixture.
      const badProjectPath = path.join(os.tmpdir(), `plottracer-menu-test-${Date.now()}.json`);
      fs.writeFileSync(badProjectPath, 'not valid json', 'utf8');
      try {
        await app.evaluate(({ dialog }, p) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
        }, badProjectPath);
        await pressAccelerator(page, 'Control+Shift+O');
        // v1.5: the import registry replaced the generic refusal with one that
        // NAMES the formats that do work, so this assertion went stale and was
        // still pinning the old wording. The point of the test is unchanged --
        // the menu event reached the open handler and it reported an error -- so
        // assert the part that carries that meaning rather than a fixed prefix.
        await expect
          .poll(async () => (await page.getByTestId('project-error').textContent({ timeout: 1000 }).catch(() => null)) ?? '', { timeout: 10000 })
          .toMatch(/doesn't recognise this file|Could not open project/);
      } finally {
        fs.unlinkSync(badProjectPath);
      }
    } finally {
      await app.close();
    }
  }, 30000);

  it('Ctrl+Z / Ctrl+Shift+Z actually reach undo()/redo() (checkpoint 38)', async () => {
    const { app, page } = await launchProductionApp();
    try {
      // ⚑ The structural half of this test asserted the Edit submenu's template
      // (Undo/Redo + their accelerators). That menu no longer exists, and the
      // template was never the part that mattered: it once passed while the two
      // channels were missing from the preload's allowlist, so the listeners
      // never registered and the menu did nothing. Only the behavioural half
      // could catch that, and only the behavioural half survives -- driving a
      // real point through undo and redo with the keys a user actually presses.
      await app.evaluate(({ dialog }, samplePath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [samplePath] });
      }, SAMPLE_IMAGE);
      await page.getByTestId('open-image-button').click();
      await page.waitForTimeout(400);
      const box = await page.locator('canvas').first().boundingBox();
      if (!box) throw new Error('canvas did not report a bounding box');
      const clickAt = async (lx: number, ly: number) => {
        await page.mouse.click(box.x + lx, box.y + ly);
        await page.waitForTimeout(100);
      };
      const confirmValue = async (value: string) => {
        await page.locator('[data-testid="data-value-input"]').click({ timeout: 5000 });
        await page.keyboard.type(value);
        await page.locator('[data-testid="confirm-data-value"]').click({ timeout: 5000 });
        await page.waitForTimeout(100);
      };
      // Capture the figure first (checkpoint 103): mandatory before calibration.
      page.on('dialog', (d) => void d.accept());
      await page.getByTestId('capture-figure').click();
      await page.waitForTimeout(150);
      await clickAt(100, 250); await confirmValue('0');
      await clickAt(400, 250); await confirmValue('10');
      await clickAt(100, 250); await confirmValue('0');
      await clickAt(100, 100); await confirmValue('10');
      await page.getByTestId('run-calibration').click();
      await page.waitForTimeout(150);
      await clickAt(250, 175);
      const rowNums = async () => {
        const cells = await page.getByTestId('points-table').locator('tbody tr').first().locator('td').allInnerTexts();
        return cells.slice(1).map((c) => c.trim()).filter(Boolean).join(',');
      };
      expect(await rowNums()).toBe('5,5');

      await pressAccelerator(page, 'Control+z');
      await expect
        .poll(() => page.getByTestId('points-table').locator('tbody tr').count(), { timeout: 10000 })
        .toBe(0);

      await pressAccelerator(page, 'Control+Shift+Z');
      await expect.poll(rowNums, { timeout: 10000 }).toBe('5,5');
    } finally {
      await app.close();
    }
  }, 30000);
});

describe('ui/electron-main.cjs - a foreign digitizer\'s .tar, imported through Open Project (checkpoint 88; unified v1.4)', () => {
  // Build a real WPD .tar the way a real project is shaped: info.json + wpd.json
  // (upstream's own six-figure fixture) + a bundled image. Reading someone
  // else's format is the migration route off the old app (tenet 6); a tar we
  // authored to our own liking would only prove we agree with ourselves.
  function buildWpdTar(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plottracer-wpde2e-'));
    const proj = path.join(dir, 'paper fig3');
    fs.mkdirSync(proj);
    fs.copyFileSync(path.join(REPO_ROOT, 'engine/__tests__/fixtures/wpd/wpd4.json'), path.join(proj, 'wpd.json'));
    fs.writeFileSync(path.join(proj, 'info.json'), '{"version":[4,0],"json":"wpd.json","images":["figure.png"]}');
    fs.copyFileSync(SAMPLE_IMAGE, path.join(proj, 'figure.png'));
    execFileSync('tar', ['-cf', 'project.tar', 'paper fig3/'], { cwd: dir });
    return path.join(dir, 'project.tar');
  }

  it('imports a figure from a real .tar through the production IPC + picker', async () => {
    const tarPath = buildWpdTar();
    const { app, page } = await launchProductionApp();
    try {
      await page.getByTestId('open-image-button').waitFor({ state: 'visible', timeout: 15000 });
      // Stub the native dialog to return our tar, then fire the ONE Open Project
      // menu event -- the full production path: real dialog:openProject handler ->
      // binary read -> the renderer recognises a tar FROM ITS BYTES -> engine/tarRead
      // -> engine/wpdImport -> the picker.
      //
      // ⚑ This test fired `menu:open-wpd-project` until v1.4, and that channel was
      // deleted in `6a16f23` along with the rest of that tool's first-class status.
      // The event went nowhere, so the tar import had NO production coverage for
      // three commits -- the suite would have said so, but it had not been run.
      await app.evaluate(({ dialog }, p) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
      }, tarPath);
      await page.keyboard.press('Control+Shift+O');

      // wpd4.json is six figures; the picker lists them (Image axes disabled).
      await page.getByTestId('wpd-picker').waitFor({ state: 'visible', timeout: 15000 });
      expect(await page.locator('[data-testid^="wpd-figure-"]').count()).toBe(6);

      // Import the first (XY) figure.
      await page.getByTestId('wpd-figure-0').click();
      await page.getByTestId('wpd-picker').waitFor({ state: 'detached', timeout: 10000 });

      // It arrives CALIBRATED -- the whole point: no re-clicking axis points.
      await expect
        .poll(async () => page.getByTestId('calibrated-status').textContent(), { timeout: 10000 })
        .toContain('Calibrated');
      // ...as an XY chart, and with its data series present.
      expect(await page.getByTestId('axes-type-trigger').textContent()).toContain('XY');
      expect(await page.locator('[data-testid^="series-option-"]').count()).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  }, 40000);
});
