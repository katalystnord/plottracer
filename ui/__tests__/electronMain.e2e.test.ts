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

const REPO_ROOT = path.resolve(__dirname, '../..');
const SAMPLE_IMAGE = path.join(REPO_ROOT, 'samples/xy-stress-strain.png');

async function launchProductionApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [path.join(REPO_ROOT, 'ui/electron-main.cjs')],
    cwd: REPO_ROOT,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  // app.firstWindow() resolves as soon as a BrowserWindow exists, well
  // before React has mounted and run its effects -- the two tests that
  // predate checkpoint 32 never noticed because their first action is
  // always clicking a testid button, which Playwright's own actionability
  // wait makes safe by accident. Checkpoint 32's menu tests send an IPC
  // event as their very first action instead, with nothing to wait on --
  // sent before ui/src/Workspace.tsx's/ImageCanvas.tsx's onMenuEvent
  // effects have registered their listeners, the event is simply lost
  // (ipcRenderer.on has no queue for a message sent before it's called).
  // Waiting for a real testid to become visible here, once, fixes it for
  // every caller instead of each test needing its own ad hoc wait.
  await page.getByTestId('open-image-button').waitFor({ state: 'visible', timeout: 15000 });
  return { app, page };
}

describe('ui/electron-main.cjs (production entry point)', () => {
  it('loads the built dist with the production title, no devtools, and no native menu', async () => {
    const { app, page } = await launchProductionApp();
    try {
      expect(await page.title()).toBe('PlotTracer');

      const devToolsOpen = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.isDevToolsOpened());
      expect(devToolsOpen).toBe(false);

      // Checkpoint 32: a real native menu bar now exists (previously
      // explicitly null, see this test's own history before checkpoint 32).
      const hasMenu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu() !== null);
      expect(hasMenu).toBe(true);

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

  // Checkpoint 32 (native menu bar, see CLAUDE.md and
  // ui/electron-menu.cjs). These simulate a menu click the way
  // electron-menu.cjs's own click handlers do -- webContents.send(channel)
  // -- rather than trying to drive Electron's native menu through
  // Playwright, which isn't reliably supported cross-platform. That's a
  // deliberate scope boundary: what needs coverage is the renderer-side
  // wiring (preload's onMenuEvent -> ImageCanvas.tsx/Workspace.tsx's
  // effects -> the same handlers the top-bar buttons already call), not
  // the menu template's own labels/accelerators, which have no runtime
  // logic to regress.
  // A fixed wait-then-read-once after each send proved flaky under a
  // full-suite run's resource contention from several sequential Electron
  // launches (same class of fragility already documented in CLAUDE.md for
  // checkpoints 24/25/29 -- reliable in isolation, occasionally slower
  // under load). Fixed here the more robust way: poll for the expected
  // state (vitest's own expect.poll, not @playwright/test's assertions --
  // this file still isn't on that dependency) instead of guessing a
  // sleep duration long enough for any load level.
  async function sendMenuEvent(app: ElectronApplication, channel: string) {
    await app.evaluate(({ BrowserWindow }, ch) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send(ch);
    }, channel);
  }

  function readScale(viewStateText: string): number {
    const match = viewStateText.match(/scale: ([\d.]+)/);
    if (!match) throw new Error(`could not parse scale from "${viewStateText}"`);
    return Number(match[1]);
  }

  async function pollScale(page: Page): Promise<number> {
    return readScale((await page.getByTestId('view-state').textContent())!);
  }

  it('native View > Zoom* menu actions change the canvas view state via ImageCanvas.tsx\'s onMenuEvent wiring', async () => {
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
      await sendMenuEvent(app, 'menu:open-image');
      await expect
        .poll(async () => (await page.getByTestId('view-state').textContent()) ?? '', { timeout: 10000 })
        .not.toBe(initialViewState);
      const fittedScale = await pollScale(page);

      await sendMenuEvent(app, 'menu:zoom-in');
      await expect.poll(() => pollScale(page), { timeout: 10000 }).toBeGreaterThan(fittedScale);

      await sendMenuEvent(app, 'menu:zoom-out');
      await sendMenuEvent(app, 'menu:zoom-out');
      await expect.poll(() => pollScale(page), { timeout: 10000 }).toBeLessThan(fittedScale);

      // "Actual Size" -- checkpoint 32's zoomByFactor(view, cx, cy,
      // 1/view.scale) case, exercised here through the real menu/IPC path
      // rather than only as a unit test.
      await sendMenuEvent(app, 'menu:zoom-100');
      await expect.poll(() => pollScale(page), { timeout: 10000 }).toBeCloseTo(1, 2);

      await sendMenuEvent(app, 'menu:zoom-fit');
      await expect.poll(() => pollScale(page), { timeout: 10000 }).toBeCloseTo(fittedScale, 2);
    } finally {
      await app.close();
    }
  }, 30000);

  it('native File > Save Project menu action reaches Workspace.tsx\'s saveProject handler', async () => {
    const { app, page } = await launchProductionApp();
    try {
      // No image loaded -- saveProject()'s own first-line guard produces a
      // deterministic, observable error, confirming the menu event reached
      // the handler at all (an unwired listener would show nothing).
      await sendMenuEvent(app, 'menu:save-project');
      await expect
        .poll(async () => (await page.getByTestId('project-error').textContent({ timeout: 1000 }).catch(() => null)) ?? '', { timeout: 10000 })
        .toContain('Load an image before saving a project.');
    } finally {
      await app.close();
    }
  }, 30000);

  it('native File > Open Project…/Save Data As CSV… menu actions reach the same handlers as their buttons', async () => {
    const { app, page } = await launchProductionApp();
    try {
      // Save Data As CSV… -- deterministic without any file I/O: no axes
      // calibrated yet, so exportCSV()'s own early-exit error confirms the
      // menu event reached it.
      await sendMenuEvent(app, 'menu:save-csv');
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
        await sendMenuEvent(app, 'menu:open-project');
        // Checkpoint 94: a project is now a .zip container OR legacy JSON, so the
        // invalid-file message widened. Assert the stable prefix -- the point is
        // that the menu event reached the open handler and it reported an error.
        await expect
          .poll(async () => (await page.getByTestId('project-error').textContent({ timeout: 1000 }).catch(() => null)) ?? '', { timeout: 10000 })
          .toContain('Could not open project');
      } finally {
        fs.unlinkSync(badProjectPath);
      }
    } finally {
      await app.close();
    }
  }, 30000);

  it('exposes an Edit menu whose Undo/Redo actually reach undo()/redo() (checkpoint 38)', async () => {
    const { app, page } = await launchProductionApp();
    try {
      // Structural half: the Edit submenu electron-menu.cjs built.
      const editMenu = await app.evaluate(({ Menu }) => {
        const top = Menu.getApplicationMenu()?.items.find((i) => i.label === 'Edit');
        if (!top?.submenu) return null;
        return top.submenu.items.map((i) => ({ label: i.label, accelerator: i.accelerator }));
      });
      expect(editMenu).toEqual([
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z' },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z' },
      ]);

      // Behavioral half, deliberately not just the template: the menu:undo/
      // menu:redo channels must also be in the preload's own onMenuEvent
      // allowlist (ui/electron-preload.cjs's MENU_EVENT_CHANNELS) -- a
      // template-only check silently passed while those two channels were
      // missing there, so the listeners never registered and the menu did
      // nothing. Drive a real point through undo/redo via the menu IPC path
      // to prove the whole chain, allowlist included.
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

      await sendMenuEvent(app, 'menu:undo');
      await expect
        .poll(() => page.getByTestId('points-table').locator('tbody tr').count(), { timeout: 10000 })
        .toBe(0);

      await sendMenuEvent(app, 'menu:redo');
      await expect.poll(rowNums, { timeout: 10000 }).toBe('5,5');
    } finally {
      await app.close();
    }
  }, 30000);
});

describe('ui/electron-main.cjs — WebPlotDigitizer .tar import (checkpoint 88)', () => {
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
      // Stub the native dialog to return our tar, then fire the menu event the
      // "Open WebPlotDigitizer Project…" item sends -- the full production path:
      // real dialog:openWpdProject handler -> binary read -> engine/tarRead ->
      // engine/wpdImport -> the picker.
      await app.evaluate(({ dialog, BrowserWindow }, p) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
        BrowserWindow.getAllWindows()[0]!.webContents.send('menu:open-wpd-project');
      }, tarPath);

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
      expect(await page.getByTestId('axes-type-select').textContent()).toContain('XY');
      expect(await page.locator('[data-testid^="series-option-"]').count()).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  }, 40000);
});
