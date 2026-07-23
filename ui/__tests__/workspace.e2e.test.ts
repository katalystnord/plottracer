/**
 * Committed Electron + Playwright regression suite for the ui/ Workspace
 * (checkpoint 14, see CLAUDE.md). Same technique as
 * core/__tests__/crossCheck.test.ts (playwright-core's _electron,
 * launched via vitest) -- but this file replaces the throwaway,
 * write-it-then-delete-it verification scripts used ad hoc for
 * checkpoints 11-13, so the interaction-level regressions those scripts
 * caught (most notably the shared-origin click-swallowing bug found
 * while verifying checkpoint 12) stay caught automatically on every
 * future change instead of only when someone remembers to write a new
 * script.
 *
 * Uses vitest's own `expect` throughout (not @playwright/test's, which
 * isn't a dependency here) -- assertions read locator text via
 * `.textContent()`/`.waitFor()` and compare with plain vitest matchers,
 * the same style already established in crossCheck.test.ts.
 *
 * Requires `ui/dist/` to exist (see package.json's "pretest" hook,
 * which runs `npm run ui:build` before `vitest run`) since this drives
 * the built static app via ui/electron-dev.cjs --built, not the Vite
 * dev server.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
// Checkpoint 25 (project save/load, see CLAUDE.md) -- these are plain,
// framework-agnostic TS modules with no DOM dependency, so the fixture
// helpers below build a real project file directly in this Node-side test
// process (the same engine code the app itself runs), rather than hand-
// typing project JSON by hand or driving a full calibration through the
// browser just to produce a file to open.
import { CalibrationSession, XY_AXES_CONFIG } from '../../engine/calibrationSession.js';
import { serializeProject } from '../../engine/projectFile.js';
import { unzipSync, strFromU8 } from 'fflate';

const REPO_ROOT = path.resolve(__dirname, '../..');

// Checkpoint 94: a saved project is a `.zip` container. Read its project.json
// back for the shape assertions the JSON-blob format used to allow directly.
function readSavedProjectJson(zipPath: string): Record<string, unknown> {
  const entries = unzipSync(fs.readFileSync(zipPath));
  return JSON.parse(strFromU8(entries['project.json']!));
}

// A minimal, valid multi-page PDF built in-process for the PDF e2e (checkpoint
// 96) -- avoids committing a binary fixture and keeps the structure visible.
// Each page is 200x100pt with a filled black square at a page-specific x, so
// the pages render to distinct rasters. Byte offsets are computed so the xref
// table is correct (not relying on pdf.js's recovery).
function makePdf(pageCount: number): Buffer {
  const parts: string[] = [];
  let pos = 0;
  const offsets: number[] = [];
  const push = (s: string) => {
    parts.push(s);
    pos += Buffer.byteLength(s, 'latin1');
  };
  const obj = (id: number, body: string) => {
    offsets[id] = pos;
    push(`${id} 0 obj\n${body}\nendobj\n`);
  };

  push('%PDF-1.4\n');
  const pageIds = Array.from({ length: pageCount }, (_, i) => 3 + i);
  const contentIds = Array.from({ length: pageCount }, (_, i) => 3 + pageCount + i);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`);
  pageIds.forEach((id, i) =>
    obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents ${contentIds[i]} 0 R >>`)
  );
  contentIds.forEach((id, i) => {
    const stream = `0 0 0 rg ${20 + i * 40} 20 40 40 re f`;
    obj(id, `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  });
  const size = 3 + 2 * pageCount; // obj 0 (free) + objects 1..(2 + 2*pageCount)
  const xrefStart = pos;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let i = 1; i < size; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  return Buffer.from(parts.join(''), 'latin1');
}
const SAMPLE_IMAGE = path.join(REPO_ROOT, 'samples/xy-stress-strain.png');
// A 2-page LZW TIFF (B7) — historic scans are commonly (multipage) TIFF.
const MULTIPAGE_TIFF = path.join(REPO_ROOT, 'ui/__tests__/fixtures/multipage.tiff');

let app: ElectronApplication;
let page: Page;
let canvasBox: { x: number; y: number; width: number; height: number };
// Messages of any confirm()/alert() dialogs raised during the current test --
// the unsaved-work guard (checkpoint 37) is auto-accepted by the beforeEach
// handler, and tests that care assert the prompt actually fired via this.
let dialogMessages: string[] = [];

// Launches a fresh Electron instance per test rather than one shared
// instance for all tests. This is the fix for bug #1 in
// project_e2e_suite_known_issues.md (an intermittent full-suite-only
// hang on the Polar calibration test) -- confirmed by 3 consecutive
// clean 158/158 runs after switching, with bug #2 (the pan test's
// test-ordering fragility) already fixed separately so it no longer
// masks/interferes with this. Slower (~70s vs ~50s) but reliable.
beforeEach(async () => {
  app = await electron.launch({
    args: [path.join(REPO_ROOT, 'ui/electron-dev.cjs'), '--built'],
    cwd: REPO_ROOT,
    timeout: 30000,
    // WPD_E2E skips the dev DevTools, which -- docked to the side -- otherwise
    // steal ~555px of viewport width, shrinking the canvas-dominant layout's
    // canvas below what the tests' click coordinates need (checkpoint 39).
    env: { ...process.env, WPD_E2E: '1' },
  });
  page = await app.firstWindow();

  // Auto-accept the unsaved-work confirm() (checkpoint 37): switching axes type
  // or opening a new image/project while there are unsaved points now prompts
  // before discarding. Playwright dismisses (cancels) unhandled dialogs by
  // default, which would silently block those actions mid-test; accepting is
  // the equivalent of a user clicking "Ok". Tests that specifically assert the
  // prompt fires attach their own recording listener on top of this.
  dialogMessages = [];
  page.on('dialog', (dialog) => {
    dialogMessages.push(dialog.message());
    void dialog.accept();
  });

  // Size the window generously so even the widest test coordinate (the P2
  // drag to x=1300) lands on the canvas (checkpoint 39). With DevTools no
  // longer stealing viewport width, setContentSize takes reliably. 1780
  // content width leaves a ~1410px canvas (1780 - ~50px rail - 320px sidebar).
  // Done before the first interaction, so the resize just re-fits.
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return;
    w.setContentSize(1780, 1000);
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  // Stub the native open-dialog in the main process to always return our
  // sample image, same technique used manually since checkpoint 7.
  await app.evaluate(({ dialog }, samplePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [samplePath] });
  }, SAMPLE_IMAGE);
}, 30000);

afterEach(async () => {
  await app.close();
});

/**
 * Reloads the sample image (resets pan/zoom to the initial fit) and
 * selects the given axes type (which replaces the session with a fresh
 * one -- see engine/calibrationSession.ts). Run at the start of every
 * test so each is independent without needing a fresh Electron launch.
 */
// Waits until the just-loaded image's fit-to-container has *settled*
// (checkpoint 39). The canvas-dominant layout fits the image in an effect
// after layout, and the container size can settle over a couple of frames, so
// the fitted view lands -- and can still shift once -- asynchronously after the
// open-image click. Reading the zoom % or placing calibration clicks before it
// settles gives an inconsistent coordinate mapping (a mid-calibration fit shift
// silently corrupts values). Waits for the view-state readout to be both
// non-initial (fit applied: it re-centers to a non-zero offset) and stable
// across two consecutive reads. Note the fitted *scale* can legitimately be
// 1.000 when the window is large enough to show the image 1:1, so stability --
// not a specific scale -- is the signal. Polls rather than guessing a sleep.
async function waitForImageFitted(timeoutMs = 8000) {
  const INITIAL = 'scale: 1.000, offset: (0.0, 0.0)';
  const start = Date.now();
  let prev: string | null = null;
  while (Date.now() - start < timeoutMs) {
    const text = (await page.getByTestId('view-state').textContent({ timeout: 1000 }).catch(() => null)) ?? '';
    if (text && !text.includes(INITIAL) && text === prev) return; // fitted and stable
    prev = text;
    await page.waitForTimeout(100);
  }
}

// 'errorbar' is deliberately absent (checkpoint 79): the graph type is retired,
// so it is no longer selectable here. Error bars are rail tool 7 now.
async function resetWorkspace(
  axesTypeId: 'xy' | 'histogram' | 'bar' | 'categorical' | 'boxplot' | 'polar' | 'ternary' | 'map' | 'ccr',
  // Checkpoint 103: capture is a MANDATORY first step -- axis calibration is
  // blocked until the figure-of-record is established. So resetWorkspace captures
  // the (whole, fitted) figure by default, matching what a user must do before
  // calibrating; the whole-image capture is a no-op crop (no dimension change, no
  // provenance). Tests of the capture flow itself pass `capture: false` to see
  // the pre-capture state.
  { capture = true }: { capture?: boolean } = {}
) {
  await page.getByTestId('open-image-button').click();
  await waitForImageFitted(); // wait for the async fit-to-container to settle
  // Checkpoint 35: axes-type-select is a real MUI Select now, not a native
  // <select> -- .selectOption() no longer applies. Click the trigger to
  // open the dropdown, then click the matching MenuItem (see
  // ui/src/AxesTypeSelect.tsx's own axes-option-${id} testids). No
  // waitForTimeout between these steps: each getByTestId(...).click() /
  // boundingBox() already auto-waits for its target to be attached, visible
  // and stable, which covers the MUI menu open-transition and the
  // session-replace re-render (checkpoint 36 sleep-trim).
  await page.getByTestId('axes-type-select').click();
  await page.getByTestId(`axes-option-${axesTypeId}`).click();
  if (capture) {
    // Establish the figure-of-record (checkpoint 103) -- the confirm is
    // auto-accepted by the beforeEach dialog handler. Whole-image = no-op crop.
    await page.getByTestId('capture-figure').click();
    await page.waitForTimeout(100);
    // reset-calibration lives on the card only AFTER capture (v0.8: pre-capture
    // the card is the Capture prompt). A no-op on a fresh figure, kept for the
    // same defensive clean-state reason it was here before.
    await page.getByTestId('reset-calibration').click();
  }
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas did not report a bounding box');
  canvasBox = box;
}

// Re-reads the canvas's on-screen position -- needed whenever a preceding
// action changes page layout above the canvas (e.g. the "Box Plot Groups"
// button disappearing once applied), which would otherwise leave clickAt's
// cached canvasBox stale and silently offset every subsequent click. Still
// called explicitly in a few places for clarity at the point layout is
// known to shift, but clickAt/dragMarker below both also call it
// unconditionally now (checkpoint 30) -- filling or clicking an input
// below the canvas (e.g. a tuple's category-name field) can make
// Playwright auto-scroll the page to bring it into view, which is a
// layout shift just as real as a button disappearing, just not tied to
// one specific, easy-to-spot action. Root-caused by hand (checkpoint 30's
// new always-visible series-list row pushed enough content below the
// fold that a below-canvas .fill() started triggering this) rather than
// patched at only the one call site that happened to surface it -- the
// same fragility could resurface at any future call site that scrolls,
// so fixing it inside clickAt/dragMarker themselves closes the whole
// class, not just this instance.
async function refreshCanvasBox() {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas did not report a bounding box');
  canvasBox = box;
}

async function clickAt(lx: number, ly: number) {
  await refreshCanvasBox();
  await page.mouse.click(canvasBox.x + lx, canvasBox.y + ly);
  await page.waitForTimeout(100);
}

// Enter Measure mode and wait until the card is actually mounted before any
// canvas click. Clicking mode-measure only queues setMode('measure'); a clickAt
// fired before React flushes that state is routed as the previous mode and the
// measurement is silently lost -- a pre-existing rotating flake in the measure
// tests that lengthening the suite made reproducible. Waiting on measure-card is
// the deterministic "measure mode is armed" signal (the other measure block
// already does this implicitly by clicking a tool button first).
async function enterMeasureMode() {
  await page.getByTestId('mode-measure').click();
  await page.getByTestId('measure-card').waitFor({ state: 'visible' });
}

async function confirmValue(value: string) {
  await page.locator('[data-testid="data-value-input"]').click({ timeout: 5000 });
  await page.keyboard.type(value);
  await page.locator('[data-testid="confirm-data-value"]').click({ timeout: 5000 });
  await page.waitForTimeout(100);
}

// Polar's P1/P2 steps each collect two values (r, θ) from one click -- see
// Workspace.tsx's per-index data-value-input(-N) testids.
async function confirmValues(values: string[]) {
  for (let i = 0; i < values.length; i++) {
    const testId = i === 0 ? 'data-value-input' : `data-value-input-${i}`;
    await page.locator(`[data-testid="${testId}"]`).click({ timeout: 5000 });
    await page.keyboard.type(values[i]!);
  }
  await page.locator('[data-testid="confirm-data-value"]').click({ timeout: 5000 });
  await page.waitForTimeout(100);
}

async function dragMarker(fromLx: number, fromLy: number, toLx: number, toLy: number) {
  await refreshCanvasBox();
  await page.mouse.move(canvasBox.x + fromLx, canvasBox.y + fromLy);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + toLx, canvasBox.y + toLy, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

// A local x-coordinate near the canvas's right edge, but clamped to the
// actual visible viewport -- the canvas (docWidth) can be wider than the
// window's viewport (e.g. the icon-rail layout leaves an 1310px-wide canvas
// in an ~845px viewport), so a raw `canvasBox.width - N` offset can land
// off-screen, where a click/drag reaches nothing at all rather than the
// canvas background. Found investigating project_e2e_suite_known_issues.md's
// pre-existing test-ordering bug -- this test only "passed" as part of the
// full sequential suite because an earlier test happened to leave the page
// scrolled far enough right to cover this gap; run alone, it always failed.
async function safeRightEdgeX(marginFromEdge = 40): Promise<number> {
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  return Math.min(canvasBox.width, viewportWidth - canvasBox.x) - marginFromEdge;
}

// The bottom-bar "view-state" readout renders `scale: N, offset: (X, Y)`; parse
// its offset so the mouse-model pan tests can assert the view actually moved.
async function viewOffset(): Promise<[number, number]> {
  const t = await textOf('view-state');
  const m = t.match(/offset: \(([-\d.]+), ([-\d.]+)\)/);
  if (!m) throw new Error(`view-state did not report an offset: ${t}`);
  return [Number(m[1]), Number(m[2])];
}

async function textOf(testId: string): Promise<string> {
  return (await page.getByTestId(testId).textContent()) ?? '';
}

// MapAxes.pixelToData (core/axes/map.ts) uses the raw image-space pixel
// coordinate directly (data = pixel * scaleLength / dist), not a ratio
// relative to the calibration points the way XY/Bar/Polar/Ternary's
// formulas are -- so, unlike every other axes type's e2e tests, local
// screen coordinates can't stand in for image coordinates here (the
// screen->image affine transform's offset doesn't cancel out). These
// helpers read the real transform back from the "view-state" readout
// (engine/canvasView.ts's screenToImage, applied with the same numbers
// the app itself is using) so Map's expected values can be computed --
// only approximately, though: view-state and the table's "pixel" column
// are both rounded for display (3dp scale, 1dp pixel), so the Map tests
// below use toBeCloseTo with a loose tolerance rather than an exact
// string match the way every other axes type's tests can.
async function getViewState(): Promise<{ scale: number; offsetX: number; offsetY: number }> {
  const text = await textOf('view-state');
  const m = text.match(/scale: ([\d.]+), offset: \(([-\d.]+), ([-\d.]+)\)/);
  if (!m) throw new Error(`unexpected view-state text: ${text}`);
  return { scale: Number(m[1]), offsetX: Number(m[2]), offsetY: Number(m[3]) };
}

function screenToImage(view: { scale: number; offsetX: number; offsetY: number }, sx: number, sy: number) {
  return { x: (sx - view.offsetX) / view.scale, y: (sy - view.offsetY) / view.scale };
}

// Reads the numeric value cells of a spreadsheet data row (checkpoint 57's
// adaptive multi-series table). The row-# cell is dropped and blank cells (a
// series shorter than this row) are filtered, so for a single active series
// row 0 is [x, y] (or [value] for Bar, [a,b,c] for Ternary, ...). Values are
// Intl-formatted (pixel columns are gone), so compared with toBeCloseTo.
async function rowValues(rowIndex = 0): Promise<number[]> {
  const cells = await page
    .getByTestId('points-table')
    .locator('tbody tr')
    .nth(rowIndex)
    .locator('td')
    .allInnerTexts();
  return cells
    .slice(1)
    .map((c) => c.trim())
    .filter((c) => c !== '')
    .map(Number);
}
async function expectRow(expected: number[], rowIndex = 0, digits = 2): Promise<void> {
  const actual = await rowValues(rowIndex);
  expect(actual).toHaveLength(expected.length);
  expected.forEach((v, i) => expect(actual[i]!).toBeCloseTo(v, digits));
}

// Shared XY calibration setup, verified exact throughout checkpoints 3-13:
// X1=0 @ local (100,250), X2=10 @ (400,250), Y1=0 @ (100,250), Y2=10 @ (100,100).
async function calibrateXYStandard() {
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
}

// Auto-extract umbrella (v0.8): the wand tool (mode-auto-extract) fronts the
// three tracing mechanisms via a fold-out card. Opens the card if needed, then
// selects the mechanism (flood-fill / colour / guide points).
async function selectAutoExtract(mech: 'flood' | 'colour' | 'guide') {
  const pressed = await page.getByTestId('mode-auto-extract').getAttribute('aria-pressed');
  if (pressed !== 'true') await page.getByTestId('mode-auto-extract').click();
  await page.getByTestId(`auto-extract-${mech}`).click();
}

describe('Workspace: XY axes', () => {
  it('completes a full 4-point calibration and reads back an exact data point', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();

    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    await clickAt(250, 175);
    await expectRow([5, 5]);
  });

  it('Check Calibration appears once calibrated and toggles the axis-box overlay (v0.8)', async () => {
    await resetWorkspace('xy');
    // Not offered before calibration -- there is no box to draw.
    expect(await page.getByTestId('check-calibration').count()).toBe(0);
    await calibrateXYStandard();
    const check = page.getByTestId('check-calibration');
    await check.waitFor({ state: 'visible' });
    expect(await check.getAttribute('aria-pressed')).toBe('false');
    await check.click();
    expect(await check.getAttribute('aria-pressed')).toBe('true');
    await check.click();
    expect(await check.getAttribute('aria-pressed')).toBe('false');
  });

  it('registers the next calibration click even when it lands on an already-placed handle (shared X1/Y1 origin)', async () => {
    // Regression test for the checkpoint 12 bug: a mousedown landing on a
    // draggable marker used to be swallowed instead of registering as the
    // next calibration step. X1 and Y1 sharing one physical pixel (a
    // common real calibration pattern -- axes crossing at one corner) is
    // exactly the case that exposed it.
    await resetWorkspace('xy');

    await clickAt(100, 250); // X1
    await confirmValue('0');
    await clickAt(400, 250); // X2
    await confirmValue('10');
    // Y1 at the SAME pixel as X1 -- must still register as awaiting-value,
    // not be swallowed by X1's now-placed (but not yet draggable) marker.
    await clickAt(100, 250);
    await page.locator('[data-testid="data-value-input"]').waitFor({ state: 'visible', timeout: 2000 });
    await confirmValue('0');
    await clickAt(100, 100); // Y2
    await confirmValue('10');

    await page.getByTestId('run-calibration').click();
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);
  });

  it('offers a "reuse pixel" shortcut for the shared-origin case instead of requiring a second click', async () => {
    await resetWorkspace('xy');
    // Turn off "common origin" (checkpoint 50, default on) so the *manual*
    // reuse buttons appear -- common origin otherwise auto-reuses X1 for Y1,
    // which is the very shortcut this test drives by hand.
    await page.getByTestId('common-origin').uncheck();

    await clickAt(100, 250); // X1
    await confirmValue('0');
    await clickAt(400, 250); // X2
    await confirmValue('10');

    // Y1's step: reuse X1's pixel via the shortcut button instead of
    // clicking the canvas again at the same spot.
    await page.getByTestId('reuse-x1').click();
    await page.locator('[data-testid="data-value-input"]').waitFor({ state: 'visible', timeout: 2000 });
    await confirmValue('0');
    await clickAt(100, 100); // Y2
    await confirmValue('10');

    await page.getByTestId('run-calibration').click();
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    await clickAt(250, 175);
    await expectRow([5, 5]);
  });

  it('drags a placed data point without duplicating it, updating its live data readout', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();

    await clickAt(250, 175); // (5.000, 5.000)
    await expectRow([5, 5]);

    await dragMarker(250, 175, 400, 100); // drag to (10.000, 10.000)

    await expectRow([10, 10]);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(1); // moved, not duplicated
  });

  it('dragging a calibration handle re-calibrates live and updates existing data points', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // (5.000, 5.000), never moved after this
    await expectRow([5, 5]);

    // Drag Y2 from local (100,100) to (100,0): the Y span for the same
    // 0-10 data range grows, so the same screen pixel now reads a
    // different Y value. Pure ratio math (screen->image is affine, so
    // ratios along a calibration axis are scale/offset-independent):
    // Y1@250=0, new Y2@0=10, query still at local y=175 ->
    // (250-175)/(250-0) * 10 = 3.000. X is untouched, stays 5.000.
    // Calibration handles are only interactive in Calibrate mode now (so a
    // Place-Point click on a handle drops a data point rather than grabbing it
    // -- see Workspace.tsx's marker draggable rule); switch modes to adjust.
    await page.getByTestId('mode-calibrate').click();
    await dragMarker(100, 100, 100, 0);

    await expectRow([5, 3]);
  });

  it('nudges a selected calibration handle with the arrow keys, recalibrating live (checkpoint 127)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // a data point, reads (5, 5)
    await expectRow([5, 5]);

    // In Calibrate mode, click the X2 handle (local 400,250) to select it for the
    // keyboard — the same handle you would otherwise drag.
    await page.getByTestId('mode-calibrate').click();
    await clickAt(400, 250);
    expect(await textOf('tips-bar')).toMatch(/Handle selected/i);

    // Nudge X2 left: the x=10 anchor moves toward x=0, compressing the x axis, so
    // the fixed data point at local x=250 now reads a LARGER x. Y is untouched
    // (X2 is an x-axis handle), which is the proof it recalibrated, not just moved
    // a dot. The exact delta is zoom-scaled so only the direction is asserted.
    const [beforeX, beforeY] = await rowValues(0);
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
    const [afterX, afterY] = await rowValues(0);
    expect(afterX!).toBeGreaterThan(beforeX! + 0.03);
    expect(afterY!).toBeCloseTo(beforeY!, 5);
  });

  it('does NOT nudge a data point with the arrows outside a data-editing mode (v0.6 gate)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // a data point (5, 5); it becomes the active selection
    await expectRow([5, 5]);

    // Switch to Measure mode WITHOUT clicking a measurement vertex, then press the
    // arrows as if fine-tuning a measurement. The lingering data-point selection
    // must NOT be silently moved — arrow-nudge is gated to Place Point/Interpolate.
    await page.getByTestId('mode-measure').click();
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowUp');
    await expectRow([5, 5]); // unchanged — the point did not move
  });

  it('still pans the background after marker interactions', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175);

    // A background point near the canvas's right edge, clamped to the
    // actual viewport -- see safeRightEdgeX's own comment for why a raw
    // `canvasBox.width - N` offset can silently land off-screen.
    const rightEdgeX = await safeRightEdgeX();
    // Mouse model (David 2026-07-20): a left-drag pans only in Pan mode now (a
    // tool-mode left-drag is inert; pan otherwise lives on Ctrl+Left / middle).
    // Switch to Pan to exercise the "background still pans after marker
    // interactions" property this test exists for.
    await page.getByTestId('mode-pan').click();
    const before = await textOf('view-state');
    await dragMarker(rightEdgeX, canvasBox.height - 100, rightEdgeX - 40, canvasBox.height - 60);
    const after = await textOf('view-state');

    expect(after).not.toBe(before);
  });
});

describe('Workspace: tool mode', () => {
  it('disables Place Point until calibrated, and lands in Place Point automatically once calibration succeeds', async () => {
    await resetWorkspace('xy');
    expect(await page.getByTestId('mode-place-point').isDisabled()).toBe(true);

    await calibrateXYStandard();
    expect(await page.getByTestId('mode-place-point').isDisabled()).toBe(false);
    // No manual mode switch here -- calibrating should have auto-advanced
    // to Place Point, so this click adds a point immediately.
    await clickAt(250, 175);
    await expectRow([5, 5]);
  });

  it('Pan mode makes clicks inert and turns a would-be handle drag into a background pan instead', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard(); // lands in Place Point mode

    await page.getByTestId('mode-pan').click();
    await clickAt(250, 175); // would be (5.000, 5.000) in Place Point mode
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(0);

    // A drag starting exactly on the Y2 handle: if handles were still
    // draggable here, Konva would consume the drag for the shape and the
    // view would stay put. In Pan mode markers are non-listening, so this
    // must fall through to the Stage background and pan the view instead --
    // proof the handle itself never moved.
    const before = await textOf('view-state');
    await dragMarker(100, 100, 100, 0);
    const after = await textOf('view-state');
    expect(after).not.toBe(before);
  });

  it('switching back to Calibrate mode after calibration ignores clicks (no stray points) but still allows handle drags', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard(); // lands in Place Point mode

    await page.getByTestId('mode-calibrate').click();
    await clickAt(250, 175);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(0);

    // Still in Calibrate mode: dragging the Y2 handle should re-calibrate live.
    await dragMarker(100, 100, 100, 0);

    await page.getByTestId('mode-place-point').click();
    await clickAt(250, 175);
    // Y1@250=0, new Y2@0=10, query at local y=175 -> (250-175)/(250-0)*10 = 3.000.
    await expectRow([5, 3]);
  });

  it('adds a point back into curve order, not at the end (insert-in-place, v1.1 #1)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard(); // lands in Place Point mode
    // On one horizontal line (py=200 -> y=3.333): place the two ends, then a
    // point that belongs BETWEEN them last.
    await clickAt(160, 200); // x=2 (left end)
    await clickAt(340, 200); // x=8 (right end)
    await clickAt(250, 200); // x=5 (middle, added LAST)
    // It slots into the middle row (curve order) rather than appending at row 3.
    await expectRow([2, 3.333], 0);
    await expectRow([5, 3.333], 1);
    await expectRow([8, 3.333], 2);
  });

  it('reorders points into a nearest-neighbour path with Sort ↝ nearest, undoable (checkpoint 130)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard(); // lands in Place Point mode
    // Three points on one horizontal line (py=200 -> y=3.333). Placing them
    // left-to-right, insert-in-place (v1.1 #1) keeps them in order: x=2, 5, 8.
    await clickAt(160, 200); // x=2
    await clickAt(250, 200); // x=5
    await clickAt(340, 200); // x=8
    // Now DRAG the middle point (x=5) out to x=10, past the right one. A drag
    // moves a point without re-running insert-in-place, so the STORED order
    // (2, 10, 8) no longer matches the geometry -- exactly what the manual sort
    // is for (a click-placed series self-orders, so it can't be scrambled by
    // clicking any more; a drag, a blob-detector batch or a loaded project can).
    await dragMarker(250, 200, 400, 200); // x=5 -> x=10
    await expectRow([2, 3.333], 0);
    await expectRow([10, 3.333], 1);
    await expectRow([8, 3.333], 2);

    await page.getByTestId('sort-nn').click();
    await page.waitForTimeout(50);
    // Threaded left-to-right by nearest neighbour: 2, 8, 10.
    await expectRow([2, 3.333], 0);
    await expectRow([8, 3.333], 1);
    await expectRow([10, 3.333], 2);

    // Undo restores the pre-sort (dragged) order.
    await page.getByTestId('undo').click();
    await page.waitForTimeout(50);
    await expectRow([10, 3.333], 1);
  });

  it('numbered keyboard shortcuts (1/2/3) switch tool mode, ignored while a text input has focus', async () => {
    await resetWorkspace('xy');

    await clickAt(100, 250); // X1
    await confirmValue('0');

    // X2's value ('10') contains digit '1' -- typing it while the
    // data-value-input has focus must not be hijacked as a mode switch.
    await clickAt(400, 250); // X2
    await page.locator('[data-testid="data-value-input"]').click({ timeout: 5000 });
    await page.keyboard.type('10');
    expect(await page.getByTestId('mode-pan').getAttribute('aria-pressed')).toBe('false');
    await page.getByTestId('confirm-data-value').click();

    await clickAt(100, 250); // Y1 (shared origin)
    await confirmValue('0');
    await clickAt(100, 100); // Y2
    await confirmValue('10');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150); // lands in Place Point mode automatically

    // Hotkeys run 0-9 down the rail (2026-07-22 redesign): 0 Pan · 1 Calibrate ·
    // 2 Edit img · 3 Add · 4 Auto-extract · 5 Select · 6 Error bars · 7 Measure ·
    // 8 Curve fit · 9 Geometry.
    await page.keyboard.press('0');
    expect(await page.getByTestId('mode-pan').getAttribute('aria-pressed')).toBe('true');

    await page.keyboard.press('1');
    expect(await page.getByTestId('mode-calibrate').getAttribute('aria-pressed')).toBe('true');

    await page.keyboard.press('3');
    expect(await page.getByTestId('mode-place-point').getAttribute('aria-pressed')).toBe('true');

    await page.keyboard.press('4');
    expect(await page.getByTestId('mode-auto-extract').getAttribute('aria-pressed')).toBe('true');

    await page.keyboard.press('5');
    expect(await page.getByTestId('mode-select').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Workspace: Bar axes', () => {
  // P1=0 @ local (300,400), P2=10 @ (300,100) -- a vertical bar-value scale.
  // Coordinates chosen so every query point's expected value is an exact
  // ratio along the calibration axis (see the XY handle-drag test above
  // for why this is scale/offset-independent).
  async function calibrateBarStandard() {
    await clickAt(300, 400);
    await confirmValue('0');
    await clickAt(300, 100);
    await confirmValue('10');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);
  }

  it('walks a shorter 2-step calibration and reads back a single-value data point', async () => {
    await resetWorkspace('bar');
    expect(await textOf('tips-bar')).toMatch(/1\/2 — P1/);

    await calibrateBarStandard();
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    // Midpoint between P1(400) and P2(100) -> exactly 5.000, one value only.
    await clickAt(300, 250);
    await expectRow([5]); // Bar data is 1-dimensional -- a single value cell
  });

  it('dragging a Bar calibration handle re-calibrates live', async () => {
    await resetWorkspace('bar');
    await calibrateBarStandard();
    await clickAt(300, 250); // (5.000), never moved after this
    await expectRow([5]);

    // Drag P2 from local (300,100) to (300,0): P1@400=0, new P2@0=10,
    // query still at local y=250 -> (400-250)/(400-0) * 10 = 3.750.
    await page.getByTestId('mode-calibrate').click(); // handles adjust in Calibrate mode (checkpoint 37)
    await dragMarker(300, 100, 300, 0);

    await expectRow([3.75]);
  });
});

describe('Workspace: Box Plot / Point Groups', () => {
  // Same P1=0 @ (300,400), P2=10 @ (300,100) vertical scale as the plain Bar
  // block above. Data-point clicks deliberately avoid py=400/py=100 exactly --
  // landing on an already-placed calibration handle's own pixel is consumed
  // by that Konva shape instead of reaching the canvas background (the same
  // trap checkpoint 18's Polar tests hit, see this file's other describe
  // blocks). Five clicks at py = 385,355,325,295,265 read back exactly
  // 0.5,1.5,2.5,3.5,4.5 -- (400-py)/30*10 -- one per Min/Q1/Median/Q3/Max group.
  async function calibrateBarStandard() {
    await clickAt(300, 400);
    await confirmValue('0');
    await clickAt(300, 100);
    await confirmValue('10');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);
  }

  it('is a first-class dropdown type (checkpoint 107): selecting it auto-carries the groups, no hidden toggle', async () => {
    // The discoverable path David asked for -- pick "Box Plot" in the graph-type
    // selector and the Min/Q1/Median/Q3/Max capture is already the active shape,
    // so the legacy "Box Plot Groups" toggle is neither shown nor needed.
    await resetWorkspace('boxplot');
    // The legacy toggle is a top-bar button, gated on config.id==='bar' -- absent
    // for the 'boxplot' config, which already has its groups.
    expect(await page.getByTestId('apply-box-plot-groups').count()).toBe(0);

    await calibrateBarStandard();
    // point-group-status renders only once calibrated (inside {axes && ...}). That
    // the groups were active from the start is what makes it read "new box"
    // immediately, with no toggle click in between.
    expect(await textOf('point-group-status')).toMatch(/Min.*new box/);
    // No refreshCanvasBox: unlike the toggle path, nothing appears/disappears
    // above the canvas here -- the groups were present from the start.
    const pys = [385, 355, 325, 295, 265];
    for (let i = 0; i < pys.length; i++) {
      await clickAt(300, pys[i]!);
      expect(await textOf('box-plot-glyph-count')).toBe(i < pys.length - 1 ? '0' : '1');
    }
  });

  it('files 5 clicks into one tuple, the status line and table tracking the cursor, then rolls over to a new box', async () => {
    await resetWorkspace('boxplot');
    await calibrateBarStandard();

    expect(await textOf('point-group-status')).toMatch(/Min.*new box/);
    expect(await textOf('box-plot-glyph-count')).toBe('0'); // no complete tuple yet

    const pys = [385, 355, 325, 295, 265];
    const nextLabels = ['Q1', 'Median', 'Q3', 'Max', 'Min'];
    for (let i = 0; i < pys.length; i++) {
      await clickAt(300, pys[i]!);
      const status = await textOf('point-group-status');
      expect(status).toContain(nextLabels[i]);
      expect(status).toMatch(i < pys.length - 1 ? /box 1/ : /new box/);
      // The box-and-whisker glyph (checkpoint 22) only appears once all 5
      // groups of a tuple are filled -- not partway through.
      expect(await textOf('box-plot-glyph-count')).toBe(i < pys.length - 1 ? '0' : '1');
    }

    const tableText = await textOf('points-table');
    // The grouped table formats values with fmtValue (up to 6 sig figs, no
    // trailing zeros) to match the histogram table and the main spreadsheet.
    expect(tableText).toContain('0.5');
    expect(tableText).toContain('1.5');
    expect(tableText).toContain('2.5');
    expect(tableText).toContain('3.5');
    expect(tableText).toContain('4.5');
  });

  it('removeLastPoint clears the tuple slot and walks the cursor back', async () => {
    await resetWorkspace('boxplot');
    await calibrateBarStandard();

    await clickAt(300, 385); // Min
    await clickAt(300, 355); // Q1
    expect(await textOf('point-group-status')).toContain('Median');

    // Del in Place Point mode deletes the active (newest) point; for the last
    // point it routes through removeLastPoint, preserving the group cursor walk-back.
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);

    expect(await textOf('point-group-status')).toMatch(/Q1.*box 1/);
    const tableText = await textOf('points-table');
    expect(tableText).toContain('0.5'); // Min still filled (fmtValue formatting)
    expect(tableText).not.toContain('1.5'); // Q1 slot cleared back to '—'
  });

  it('removing a point from a complete tuple makes its box-and-whisker glyph disappear again', async () => {
    await resetWorkspace('boxplot');
    await calibrateBarStandard();

    for (const py of [385, 355, 325, 295, 265]) {
      await clickAt(300, py);
    }
    expect(await textOf('box-plot-glyph-count')).toBe('1');

    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);
    expect(await textOf('box-plot-glyph-count')).toBe('0');
  });

  it('auto-labels a new tuple, and lets the category name be edited inline', async () => {
    await resetWorkspace('boxplot');
    await calibrateBarStandard();

    await clickAt(300, 385); // starts tuple 0 (Min)
    // BarAxes.dataPointsLabelPrefix === 'Bar' -- real WPD's own default naming.
    expect(await page.locator('[data-testid="tuple-label-0"]').inputValue()).toBe('Bar0');

    await page.locator('[data-testid="tuple-label-0"]').fill('Sample A');
    expect(await page.locator('[data-testid="tuple-label-0"]').inputValue()).toBe('Sample A');

    // The custom name survives filling the rest of the tuple, and a second
    // tuple gets its own independent default.
    for (const py of [355, 325, 295, 265]) await clickAt(300, py);
    expect(await page.locator('[data-testid="tuple-label-0"]').inputValue()).toBe('Sample A');

    await clickAt(500, 385); // starts tuple 1
    expect(await page.locator('[data-testid="tuple-label-1"]').inputValue()).toBe('Bar1');
  });

  it('deletes a whole box with the row ✕, the label rides the box, and undo restores it (checkpoint 129)', async () => {
    await resetWorkspace('boxplot');
    await calibrateBarStandard();

    // Box 0, named Sample A.
    for (const py of [385, 355, 325, 295, 265]) await clickAt(300, py);
    await page.locator('[data-testid="tuple-label-0"]').fill('Sample A');
    // Box 1 to the right, named Sample B.
    for (const py of [385, 355, 325, 295, 265]) await clickAt(500, py);
    await page.locator('[data-testid="tuple-label-1"]').fill('Sample B');
    await page.waitForTimeout(50);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(2);
    expect(await textOf('box-plot-glyph-count')).toBe('2'); // both tuples complete

    // Delete box 0 outright -- not one point at a time (the trash button's job).
    await page.getByTestId('tuple-remove-0').click();
    await page.waitForTimeout(50);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(1);
    expect(await textOf('box-plot-glyph-count')).toBe('1');
    // Sample B shifted down to row 0 -- the label rides the box, not the index --
    // and it kept its own points (proof box 1 survived, not box 0).
    expect(await page.locator('[data-testid="tuple-label-0"]').inputValue()).toBe('Sample B');

    // One undo brings the whole box back.
    await page.getByTestId('undo').click();
    await page.waitForTimeout(50);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(2);
    expect(await textOf('box-plot-glyph-count')).toBe('2');
  });
});

describe('Workspace: Polar axes', () => {
  // Origin at local (100,300); P1 r=10,θ=0° at (400,300); P2 r=20 (θ unused)
  // at (700,300) -- all three share one horizontal line through the origin,
  // so θ=0 everywhere along it and r grows linearly with pixel distance from
  // the origin (same fixture as engine/__tests__/calibrationSession.test.ts's
  // Polar describe block).
  async function calibratePolarStandard() {
    await clickAt(100, 300); // origin -- no value prompt, placed immediately
    await clickAt(400, 300); // P1
    await confirmValues(['10', '0']);
    await clickAt(700, 300); // P2
    await confirmValues(['20', '0']); // θ2 collected but never read
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);
  }

  it('walks a 3-step calibration where the origin needs no typed value, then reads back r and θ', async () => {
    await resetWorkspace('polar');
    expect(await textOf('tips-bar')).toMatch(/1\/3 — Origin/);

    await clickAt(100, 300); // origin: click alone advances the step
    expect(await textOf('tips-bar')).toMatch(/2\/3 — P1/);

    await clickAt(400, 300);
    await confirmValues(['10', '0']);
    expect(await textOf('tips-bar')).toMatch(/3\/3 — P2/);

    await clickAt(700, 300);
    await confirmValues(['20', '0']);
    await page.getByTestId('run-calibration').click();
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    // Query at (250,300) -- deliberately not any handle's own pixel (a
    // click landing exactly on an already-placed, now-draggable marker
    // hits the Konva shape instead of the Stage background and never
    // reaches onImageClick, same as the XY/Bar tests' query points above).
    // dist=150, r = ((20-10)/300)*(150-300)+10 = 5.
    await clickAt(250, 300);
    await expectRow([5, 0]);
  });

  it('dragging the P2 handle re-calibrates live (its unused θ2 value plays no part)', async () => {
    await resetWorkspace('polar');
    await calibratePolarStandard();

    // Query at (600,300), not P2's own pixel -- see the note above.
    // dist=500, r = ((20-10)/300)*(500-300)+10 = 16.667.
    await clickAt(600, 300);
    await expectRow([16.667, 0]);

    // Drag P2 from local (700,300) to (1300,300): dist10=300 (unchanged),
    // dist20 grows from 600 to 1200, so dist12 grows from 300 to 900. The
    // same query pixel (600,300 -- unmoved, only the handle moved) now
    // reads a smaller r: ((20-10)/900)*(500-300)+10 = 12.222.
    await page.getByTestId('mode-calibrate').click(); // handles adjust in Calibrate mode (checkpoint 37)
    await dragMarker(700, 300, 1300, 300);

    await expectRow([12.222, 0]);
  });
});

describe('Workspace: Ternary axes', () => {
  // Corner A at local (100,300), corner B at (100,100) directly above A,
  // corner C at (300,300) -- same fixture as
  // engine/__tests__/calibrationSession.test.ts's Ternary describe block.
  async function calibrateTernaryStandard() {
    await clickAt(100, 300); // A -- no value prompt
    await clickAt(100, 100); // B -- no value prompt
    await clickAt(300, 300); // C -- no value prompt, geometrically unused
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);
  }

  it('walks a 3-step calibration where every corner needs no typed value, then reads back a, b, c', async () => {
    await resetWorkspace('ternary');
    expect(await textOf('tips-bar')).toMatch(/1\/3 — A/);

    await clickAt(100, 300); // A: click alone advances the step
    expect(await textOf('tips-bar')).toMatch(/2\/3 — B/);
    await clickAt(100, 100); // B
    expect(await textOf('tips-bar')).toMatch(/3\/3 — C/);
    await clickAt(300, 300); // C
    await page.getByTestId('run-calibration').click();
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    // Midpoint of A-B (neither corner's own pixel) -> a 50/50 split, c=0.
    await clickAt(100, 200);
    await expectRow([50, 50, 0]);
  });

  it('dragging the B handle re-calibrates live', async () => {
    await resetWorkspace('ternary');
    await calibrateTernaryStandard();

    await clickAt(100, 200); // midpoint of A-B, reads (50,50,0)
    await expectRow([50, 50, 0]);

    // Drag B from local (100,100) to (100,0): L grows from 200 to 300, so
    // the same query pixel (100,200 -- unmoved) is now only 1/3 of the way
    // from A to B instead of half: a=66.667, b=33.333, c=0.
    await page.getByTestId('mode-calibrate').click(); // handles adjust in Calibrate mode (checkpoint 37)
    await dragMarker(100, 100, 100, 0);

    await expectRow([66.667, 33.333, 0]);
  });
});

describe('Workspace: Map axes', () => {
  // P1 at local (100,300), P2 at (400,300) -- a 300px reference line
  // representing 30 real-world units, same fixture as
  // engine/__tests__/calibrationSession.test.ts's Map describe block.
  async function calibrateMapStandard() {
    await clickAt(100, 300); // P1 -- no value prompt
    await clickAt(400, 300); // P2
    await confirmValue('30');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);
  }

  it('walks a 2-step calibration where only P2 needs a typed value, then reads back X and Y', async () => {
    await resetWorkspace('map');
    // Pinned to top-left: these Map tests are about the pixel->data mapping,
    // not about which origin is default. Checkpoint 68 corrected the default to
    // bottom-left to match WPD (its own <select> lists Bottom Left first) --
    // that default has its own coverage in the checkpoint-68 block below.
    await page.getByTestId('calib-option-origin').selectOption('top-left');
    expect(await textOf('tips-bar')).toMatch(/1\/2 — P1/);

    await clickAt(100, 300); // P1: click alone advances the step
    expect(await textOf('tips-bar')).toMatch(/2\/2 — P2/);
    await clickAt(400, 300);
    await confirmValue('30');
    await page.getByTestId('run-calibration').click();
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    // Map reads the raw image-pixel coordinate directly (see the note on
    // getViewState/screenToImage above), so the expected value has to be
    // computed through the real screen->image transform, not guessed at
    // from local coordinates the way every other axes type's tests do --
    // and only to a loose tolerance, since view-state is rounded for
    // display (toBeCloseTo(_, 0) below is well inside the ~0.1 error that
    // rounding introduces, but would still catch a wrong-axis or
    // forgot-the-scale-factor class of bug).
    const view = await getViewState();
    const p1 = screenToImage(view, 100, 300);
    const p2 = screenToImage(view, 400, 300);
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const query = screenToImage(view, 200, 150); // not any handle's own pixel

    await clickAt(200, 150);
    const data = await rowValues();
    expect(data[0]).toBeCloseTo((query.x * 30) / dist, 0);
    expect(data[1]).toBeCloseTo((query.y * 30) / dist, 0);
  });

  it('dragging the P2 handle re-calibrates live', async () => {
    await resetWorkspace('map');
    await page.getByTestId('calib-option-origin').selectOption('top-left'); // see the note above
    await calibrateMapStandard();

    const view = await getViewState();
    const p1 = screenToImage(view, 100, 300);
    const p2Before = screenToImage(view, 400, 300);
    const distBefore = Math.hypot(p2Before.x - p1.x, p2Before.y - p1.y);
    const query = screenToImage(view, 200, 150);

    await clickAt(200, 150);
    let data = await rowValues();
    expect(data[0]).toBeCloseTo((query.x * 30) / distBefore, 0);
    expect(data[1]).toBeCloseTo((query.y * 30) / distBefore, 0);

    // Drag P2 from local (400,300) to (700,300): the reference distance
    // changes, so the same query pixel (unmoved) now reads a different value.
    await page.getByTestId('mode-calibrate').click(); // handles adjust in Calibrate mode (checkpoint 37)
    await dragMarker(400, 300, 700, 300);
    const p2After = screenToImage(view, 700, 300);
    const distAfter = Math.hypot(p2After.x - p1.x, p2After.y - p1.y);

    data = await rowValues();
    expect(data[0]).toBeCloseTo((query.x * 30) / distAfter, 0);
    expect(data[1]).toBeCloseTo((query.y * 30) / distAfter, 0);
  });
});

describe('Workspace: Circular Chart Recorder axes', () => {
  // Same fixture as engine/__tests__/calibrationSession.test.ts's CCR
  // describe block: (T0,R0)=(200,200) t0/r0=1; (T0,R1)=(400,200) click-only;
  // (T0,R2)=(300,100) r2=10; (T1,R2)=(200,400) click-only; (T2,R2)=(400,400)
  // click-only. Not hand-verified for exact math here -- that's
  // core/__tests__/crossCheck.test.ts's job (see calibrationSession.ts's
  // header comment) -- these tests exercise the click-walk/global-field/
  // live-recalibration plumbing only.
  async function calibrateCCRStandard() {
    await clickAt(200, 200); // (T0,R0)
    await confirmValues(['2024-01-01 00:00', '1']);
    await clickAt(400, 200); // (T0,R1) -- click-only
    await clickAt(300, 100); // (T0,R2)
    await confirmValue('10');
    await clickAt(200, 400); // (T1,R2) -- click-only
    await clickAt(400, 400); // (T2,R2) -- click-only
    await page.locator('[data-testid="global-field-startTime"]').click({ timeout: 5000 });
    await page.keyboard.type('2024-01-01 00:00');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);
  }

  it('walks a 5-step calibration mixing value-less and 1-2 value steps, gating Calibrate on the global field', async () => {
    await resetWorkspace('ccr');
    expect(await textOf('tips-bar')).toMatch(/1\/5 — \(T0,R0\)/);

    await clickAt(200, 200); // (T0,R0): 2 values
    await confirmValues(['2024-01-01 00:00', '1']);
    expect(await textOf('tips-bar')).toMatch(/2\/5 — \(T0,R1\)/);

    await clickAt(400, 200); // (T0,R1): click-only, advances immediately
    expect(await textOf('tips-bar')).toMatch(/3\/5 — \(T0,R2\)/);

    await clickAt(300, 100); // (T0,R2): 1 value
    await confirmValue('10');
    expect(await textOf('tips-bar')).toMatch(/4\/5 — \(T1,R2\)/);

    await clickAt(200, 400); // (T1,R2): click-only
    expect(await textOf('tips-bar')).toMatch(/5\/5 — \(T2,R2\)/);

    await clickAt(400, 400); // (T2,R2): click-only, walk complete
    expect(await page.locator('[data-testid="global-field-startTime"]').isVisible()).toBe(true);

    // Calibrate is clickable but must fail cleanly while the global field
    // is still blank -- not silently succeed or throw.
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);
    // The card status is always present now; while the field is blank it must
    // still read "not calibrated" (e.g. "5/5 set"), not "Calibrated".
    expect(await textOf('calibrated-status')).not.toMatch(/Calibrated/);
    expect(await textOf('calibration-error')).toMatch(/Chart Start Time/);

    await page.locator('[data-testid="global-field-startTime"]').click();
    await page.keyboard.type('2024-01-01 00:00');
    await page.getByTestId('run-calibration').click();
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    // Query point deliberately not any handle's own pixel (see the note on
    // shared-handle clicks in the XY describe block above) and chosen to
    // keep the pen/chart law-of-cosines term inside acos's valid domain.
    await clickAt(300, 320);
    const data = await rowValues();
    expect(data).toHaveLength(2);
    expect(Number.isFinite(data[0])).toBe(true); // time
    expect(Number.isFinite(data[1])).toBe(true); // magnitude
  });

  it('dragging the (T0,R1) handle changes the time reading but not the radius (r never depends on it)', async () => {
    await resetWorkspace('ccr');
    await calibrateCCRStandard();

    await clickAt(300, 320);
    const before = await rowValues();

    // (T0,R1) only feeds the pen circle (time/angle), never the chart
    // circle's radial interpolation -- core/axes/circularChartRecorder.ts's
    // r computation reads only (T0,R0)/(T0,R2)/(T1,R2)/(T2,R2). A small
    // nudge, deliberately -- a bigger drag pushes the pen circle far enough
    // that the acos law-of-cosines term for this fixture's query point
    // falls outside its valid domain and time comes back NaN (confirmed by
    // hand while debugging this test, not a product bug: the pen circle
    // genuinely can't see arbitrarily far from the chart circle's own
    // radius here).
    await page.getByTestId('mode-calibrate').click(); // handles adjust in Calibrate mode (checkpoint 37)
    await dragMarker(400, 200, 420, 220);

    const after = await rowValues();
    expect(after[1]).toBeCloseTo(before[1]!, 6); // r unchanged
    expect(after[0]).not.toBeCloseTo(before[0]!, 3); // time changed
  });
});

describe('Workspace: project save/load and CSV export (checkpoint 25)', () => {
  // Builds a real, fully calibrated XY project fixture using the actual
  // engine code the app itself runs (not hand-typed JSON), writes it to a
  // fresh temp file, and returns the path -- used by the "Open Project"
  // test below to exercise a real save→reopen round trip without chaining
  // off another test's output (each test gets its own fresh Electron
  // instance and must be independently runnable, per this file's own
  // discipline -- see the beforeEach comment above).
  function writeXYProjectFixture(): string {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    const steps: Array<[number, number, string]> = [
      [100, 250, '0'],
      [400, 250, '10'],
      [100, 250, '0'],
      [100, 100, '10'],
    ];
    for (const [px, py, value] of steps) {
      session.handleCalibrationClick(px, py);
      session.confirmCalibrationValues([value]);
    }
    session.runCalibration();
    session.addDataPoint(250, 175); // reads exactly (5, 5), same fixture as the XY describe block above

    const imageDataURL = `data:image/png;base64,${fs.readFileSync(SAMPLE_IMAGE).toString('base64')}`;
    const result = serializeProject(session, imageDataURL, 'xy-stress-strain.png');
    if ('error' in result) throw new Error(`fixture build failed: ${result.error}`);

    const filePath = path.join(os.tmpdir(), `plottracer-e2e-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(filePath, JSON.stringify(result), 'utf8');
    return filePath;
  }

  function tempFilePath(extension: string): string {
    return path.join(os.tmpdir(), `plottracer-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
  }

  async function stubSaveDialog(targetPath: string) {
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, targetPath);
  }

  async function stubOpenProjectDialog(targetPath: string) {
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, targetPath);
  }

  it('saves a calibrated project to disk with the expected shape', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // adds a data point reading (5, 5)

    const savePath = tempFilePath('json');
    await stubSaveDialog(savePath);
    await page.getByTestId('save-project').click();
    await page.waitForTimeout(300);

    // Checkpoint 94: the file is a `.zip` container now -- read its project.json.
    const entries = unzipSync(fs.readFileSync(savePath));
    const written = JSON.parse(strFromU8(entries['project.json']!));
    expect(written.plotTracerProject).toBe(1);
    expect(written.plotData.axesColl).toHaveLength(1);
    expect(written.plotData.axesColl[0].type).toBe('XYAxes');
    expect(written.plotData.datasetColl[0].data).toHaveLength(1);
    // The image is a real entry referenced by project.json, not inlined base64.
    expect(written.image.dataURL).toBeUndefined();
    expect(written.image.path).toBe('image.png');
    expect(written.image.mime).toMatch(/^image\//);
    expect(written.image.fileName).toMatch(/\.png$/);
    expect(entries['image.png']).toBeDefined();
    expect([...entries['image.png']!.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    fs.unlinkSync(savePath);
  });

  it('saves the project as a real .zip container and reopens it (checkpoint 94)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // (5, 5)

    const savePath = tempFilePath('zip');
    await stubSaveDialog(savePath);
    await page.getByTestId('save-project').click();
    await page.waitForTimeout(300);

    // On disk it is a genuine zip -- the local-file-header magic "PK\x03\x04",
    // not JSON text. Proves the binary write + container, end to end.
    const magic = [...fs.readFileSync(savePath).subarray(0, 4)];
    expect(magic).toEqual([0x50, 0x4b, 0x03, 0x04]);

    // Reopen it into a fresh workspace and confirm the point comes back.
    await resetWorkspace('xy');
    await stubOpenProjectDialog(savePath);
    await page.getByTestId('open-project').click();
    await page.waitForTimeout(400);
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);
    await expectRow([5, 5]);

    fs.unlinkSync(savePath);
  });

  it('persists an interpolation-assist curve (anchors + derived fill) through save/reopen (checkpoint 120)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();

    // Trace a curve with two guide points -> anchors + a derived fill between them.
    await selectAutoExtract('guide');
    await clickAt(140, 450);
    await clickAt(380, 130);
    await page.waitForTimeout(150);
    const beforeCount = await page.getByTestId('points-table').locator('tbody tr').count();
    expect(beforeCount).toBeGreaterThan(3); // 2 anchors + spline fill

    const savePath = tempFilePath('zip');
    await stubSaveDialog(savePath);
    await page.getByTestId('save-project').click();
    await page.waitForTimeout(300);

    // Reopen into a fresh workspace: the whole interpolated point set comes back.
    // (That the anchor/interpolated ROLES themselves round-trip exactly through
    // serialize/deserialize is pinned by engine/__tests__/projectFile.test.ts's
    // "round-trips interpolation-assist anchor/interpolated roles" -- roles live
    // in per-pixel metadata, not the DOM, so they can't be read off the canvas here.)
    await resetWorkspace('xy');
    await stubOpenProjectDialog(savePath);
    await page.getByTestId('open-project').click();
    await page.waitForTimeout(400);
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);
    const afterCount = await page.getByTestId('points-table').locator('tbody tr').count();
    expect(afterCount).toBe(beforeCount);

    fs.unlinkSync(savePath);
  });

  it('records, shows, and persists crop provenance (checkpoint 95)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();

    // Crop: open the Image Edit card, arm crop, drag a rectangle, apply.
    await page.getByTestId('mode-image-edit').click();
    await page.getByTestId('image-edit-crop').click();
    // Drag WELL RIGHT of the folded-out Image Edit card (it overlays the left of
    // the canvas; a drag started under it never reaches the Konva stage). Any valid
    // crop records provenance -- it need not enclose the calibration.
    await refreshCanvasBox();
    await page.mouse.move(canvasBox.x + 470, canvasBox.y + 60);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 640, canvasBox.y + 300, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    await page.getByTestId('crop-apply').click();
    await page.waitForTimeout(200);

    // Provenance is now visible on screen (design §5: visible, not silent).
    expect(await textOf('provenance')).toMatch(/cropped from \d+×\d+/);

    const savePath = tempFilePath('zip');
    await stubSaveDialog(savePath);
    await page.getByTestId('save-project').click();
    await page.waitForTimeout(300);
    // The saved project.json carries the crop record.
    const written = readSavedProjectJson(savePath);
    expect((written.provenance as { crops: unknown[] }).crops).toHaveLength(1);

    // A fresh workspace clears provenance; reopening the project restores it.
    await resetWorkspace('xy');
    expect(await page.getByTestId('provenance').count()).toBe(0);
    await stubOpenProjectDialog(savePath);
    await page.getByTestId('open-project').click();
    await page.waitForTimeout(400);
    expect(await textOf('provenance')).toMatch(/cropped from \d+×\d+/);

    fs.unlinkSync(savePath);
  });

  it('opens a multi-page PDF, renders a page, and navigates pages (checkpoint 96)', async () => {
    await resetWorkspace('xy'); // establishes canvasBox/electronAPI wiring
    const pdfPath = tempFilePath('pdf');
    fs.writeFileSync(pdfPath, makePdf(2));

    // openImage shares showOpenDialog with openProject, so this stub feeds the
    // PDF through the real Open Image path -> IPC -> data:application/pdf -> the
    // renderer detects it and renders via pdf.js.
    await stubOpenProjectDialog(pdfPath);
    await page.getByTestId('open-image-button').click();
    await waitForImageFitted(); // the rendered page loads as the working image

    // A multi-page PDF shows the pager, starting on page 1.
    expect(await textOf('pdf-page-label')).toMatch(/Page 1 \/ 2/);

    // Flip forward -> page 2 re-renders and loads.
    await page.getByTestId('pdf-next').click();
    await waitForImageFitted();
    expect(await textOf('pdf-page-label')).toMatch(/Page 2 \/ 2/);
    // At the last page, Next is disabled.
    expect(await page.getByTestId('pdf-next').isDisabled()).toBe(true);

    // Opening a normal image afterward closes the PDF -> the pager disappears.
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, SAMPLE_IMAGE);
    await page.getByTestId('open-image-button').click();
    await waitForImageFitted();
    expect(await page.getByTestId('pdf-pager').count()).toBe(0);

    fs.unlinkSync(pdfPath);
  });

  it('opens a multipage TIFF through the same paged-source pager, and navigates pages (B7)', async () => {
    await resetWorkspace('xy');
    // A 2-page TIFF opens via the Open Image dialog: content-detected as TIFF,
    // decoded by UTIF, and driven by the same pager as a PDF -- one figure per
    // page. Historic scans are commonly (multipage) TIFF, which is why this lands.
    await stubOpenProjectDialog(MULTIPAGE_TIFF);
    await page.getByTestId('open-image-button').click();
    await waitForImageFitted(); // the rendered page loads as the working image
    expect(await textOf('pdf-page-label')).toMatch(/Page 1 \/ 2/);

    // Flip forward -> page 2 re-renders and loads; Next disables at the last page.
    await page.getByTestId('pdf-next').click();
    await waitForImageFitted();
    expect(await textOf('pdf-page-label')).toMatch(/Page 2 \/ 2/);
    expect(await page.getByTestId('pdf-next').isDisabled()).toBe(true);

    // Opening a normal image afterward closes the document -> the pager disappears.
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, SAMPLE_IMAGE);
    await page.getByTestId('open-image-button').click();
    await waitForImageFitted();
    expect(await page.getByTestId('pdf-pager').count()).toBe(0);
  });

  it('cites the PDF source + page in provenance, and it persists through save/reopen (checkpoint 97)', async () => {
    await resetWorkspace('xy');
    const pdfPath = tempFilePath('pdf');
    fs.writeFileSync(pdfPath, makePdf(2));
    await stubOpenProjectDialog(pdfPath);
    await page.getByTestId('open-image-button').click();
    await waitForImageFitted();

    // Provenance cites the PDF file and the page it came from.
    const prov1 = await textOf('provenance');
    expect(prov1).toMatch(/\.pdf/);
    expect(prov1).toMatch(/p\.1/);

    // Flip to page 2 -> the citation follows the page.
    await page.getByTestId('pdf-next').click();
    await waitForImageFitted();
    expect(await textOf('provenance')).toMatch(/p\.2/);

    // Capture the figure first (checkpoint 103 -- a PDF page is un-captured until
    // you frame a figure on it), then calibrate the (baked) page 2 and save.
    await page.getByTestId('capture-figure').click();
    await page.waitForTimeout(100);
    await calibrateXYStandard();
    const savePath = tempFilePath('zip');
    await stubSaveDialog(savePath);
    await page.getByTestId('save-project').click();
    await page.waitForTimeout(300);
    const written = readSavedProjectJson(savePath);
    expect((written.provenance as { source: { page: number } }).source.page).toBe(2);

    // Reopen -> provenance restored, and it's a baked image now (no live pager).
    await resetWorkspace('xy');
    await stubOpenProjectDialog(savePath);
    await page.getByTestId('open-project').click();
    await page.waitForTimeout(400);
    expect(await textOf('provenance')).toMatch(/p\.2/);
    expect(await page.getByTestId('pdf-pager').count()).toBe(0);

    fs.unlinkSync(pdfPath);
    fs.unlinkSync(savePath);
  });

  it('bundles the source PDF into the saved project, and restores it (checkpoint 104)', async () => {
    await resetWorkspace('xy'); // establishes wiring
    const pdfPath = tempFilePath('pdf');
    fs.writeFileSync(pdfPath, makePdf(1));
    await stubOpenProjectDialog(pdfPath);
    await page.getByTestId('open-image-button').click();
    // Wait for the PDF to actually open (the disclosure chip appears), not just
    // for the stale sample image to be fitted -- §5 disclosure, and it's the
    // deterministic signal the source PDF is now held.
    await page.getByTestId('source-pdf-bundled').waitFor({ state: 'visible' });

    // Capture the page as the figure, calibrate, and save the project.
    await page.getByTestId('capture-figure').click();
    await page.waitForTimeout(100);
    await calibrateXYStandard();
    const savePath = tempFilePath('zip');
    await stubSaveDialog(savePath);
    await page.getByTestId('save-project').click();
    await page.waitForTimeout(400);

    // The source PDF is a real entry in the archive -- the evidence travels.
    const entries = unzipSync(fs.readFileSync(savePath));
    expect(Object.keys(entries)).toContain('source.pdf');
    expect([...entries['source.pdf']!.subarray(0, 4)]).toEqual([0x25, 0x50, 0x44, 0x46]); // %PDF

    // Reopen -> the disclosure chip returns (the source still travels with it).
    // Re-point the open dialog at the sample first (this test re-stubbed it to
    // the PDF), so resetWorkspace opens a plain image and clears the source.
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, SAMPLE_IMAGE);
    await resetWorkspace('xy');
    expect(await page.getByTestId('source-pdf-bundled').count()).toBe(0);
    await stubOpenProjectDialog(savePath);
    await page.getByTestId('open-project').click();
    await page.waitForTimeout(400);
    expect(await page.getByTestId('source-pdf-bundled').count()).toBe(1);

    fs.unlinkSync(pdfPath);
    fs.unlinkSync(savePath);
  });

  it('opening an example while a PDF is open drops the stale source PDF (post-v0.4 audit — D1)', async () => {
    await resetWorkspace('xy');
    const pdfPath = tempFilePath('pdf');
    fs.writeFileSync(pdfPath, makePdf(1));
    await stubOpenProjectDialog(pdfPath);
    await page.getByTestId('open-image-button').click();
    await page.getByTestId('source-pdf-bundled').waitFor({ state: 'visible' }); // PDF held

    // Help -> Open example loads via loadImageFromSrc directly (no onImageOpened),
    // so before the fix closePdf never ran: the example inherited the PDF as its
    // source and Save would have bundled the unrelated PDF as source.pdf.
    await page.getByTestId('help-trigger').click();
    await page.getByTestId('example-polar').waitFor({ state: 'visible' });
    await page.getByTestId('example-polar').click();

    // Re-point the dialog back at the sample NOW (before any assertion that could
    // throw) so a later-test resetWorkspace never re-opens this PDF.
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, SAMPLE_IMAGE);

    // The example loaded => its resetDocument ran, so the PDF pager is gone. This
    // is a deterministic wait, unlike waitForImageFitted, which can return on the
    // stale already-fitted PDF frame before openExample's async chain runs.
    await page.getByTestId('pdf-pager').waitFor({ state: 'detached' });
    // The D1 fix: closePdf ran (it precedes resetDocument in openExample), so the
    // source-PDF chip is gone -- the example did NOT inherit the paper's PDF.
    await page.getByTestId('source-pdf-bundled').waitFor({ state: 'detached' });
    fs.unlinkSync(pdfPath);
  });

  // Build a browser DataTransfer holding one File from base64 bytes, for
  // dispatching a synthetic drop (checkpoint 98's T1/T2 tests).
  async function dropFile(base64: string, fileName: string, type: string) {
    const dt = await page.evaluateHandle(
      ({ b64, name, mime }) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const file = new File([bytes], name, { type: mime });
        const data = new DataTransfer();
        data.items.add(file);
        return data;
      },
      { b64: base64, name: fileName, mime: type }
    );
    await page.dispatchEvent('[data-testid="canvas-container"]', 'drop', { dataTransfer: dt });
  }

  it('opens a PDF dropped onto the canvas, not just via the dialog (checkpoint 98 — T1)', async () => {
    await resetWorkspace('xy');
    // The drop/paste handlers used to pre-filter to image/* before the PDF
    // branch could run, so a dropped PDF was reported as an unsupported image.
    await dropFile(makePdf(2).toString('base64'), 'dropped.pdf', 'application/pdf');
    // Wait for the PDF itself to open (the pager), not just for *an* image to
    // fit -- resetWorkspace already left the sample image fitted, so
    // waitForImageFitted can return on that stale state before the async PDF
    // render lands.
    await page.getByTestId('pdf-page-label').waitFor({ state: 'visible' });
    expect(await textOf('pdf-page-label')).toMatch(/Page 1 \/ 2/);
    expect(await textOf('provenance')).toMatch(/dropped\.pdf/);
  });

  it('dropping an image while a PDF is open clears the stale PDF + provenance (checkpoint 98 — T2)', async () => {
    await resetWorkspace('xy');
    const pdfPath = tempFilePath('pdf');
    fs.writeFileSync(pdfPath, makePdf(2));
    await stubOpenProjectDialog(pdfPath);
    await page.getByTestId('open-image-button').click();
    await page.getByTestId('pdf-pager').waitFor({ state: 'visible' }); // PDF open (not the stale sample image)

    // Drop a plain PNG on top. Before checkpoint 98 the drop bypassed the
    // document reset, leaving the pager showing and provenance still citing the
    // PDF -- so a save recorded the image as coming from a PDF it never did.
    await dropFile(fs.readFileSync(SAMPLE_IMAGE).toString('base64'), 'plain.png', 'image/png');
    await page.getByTestId('pdf-pager').waitFor({ state: 'detached' }); // PDF closed
    expect(await page.getByTestId('provenance').count()).toBe(0); // no stale citation

    fs.unlinkSync(pdfPath);
  });

  it('re-opens a PDF after closing one via an image, without breaking (checkpoint 100 — T4)', async () => {
    await resetWorkspace('xy');
    const pdfPath = tempFilePath('pdf');
    fs.writeFileSync(pdfPath, makePdf(2));

    // Open PDF (parses doc A) -> open a plain image (closePdf destroys doc A) ->
    // open the PDF again (parses doc B; openPdf's own destroy of the now-null
    // ref must be safe). Guards the T4 fix's destroy path against breaking reuse.
    await stubOpenProjectDialog(pdfPath);
    await page.getByTestId('open-image-button').click();
    await page.getByTestId('pdf-pager').waitFor({ state: 'visible' });

    await dropFile(fs.readFileSync(SAMPLE_IMAGE).toString('base64'), 'plain.png', 'image/png');
    await page.getByTestId('pdf-pager').waitFor({ state: 'detached' });

    await stubOpenProjectDialog(pdfPath);
    await page.getByTestId('open-image-button').click();
    await page.getByTestId('pdf-pager').waitFor({ state: 'visible' });
    expect(await textOf('pdf-page-label')).toMatch(/Page 1 \/ 2/);

    fs.unlinkSync(pdfPath);
  });

  it('shows an error instead of saving when the axes aren\'t calibrated yet', async () => {
    await resetWorkspace('xy');
    // An image is loaded (resetWorkspace's own setup) but calibration was
    // reset -- Save Project should refuse with a clear message rather than
    // writing a project with no axes/dataset to reopen later.
    await page.getByTestId('save-project').click();
    await page.waitForTimeout(150);
    expect(await textOf('project-error')).toMatch(/Calibrate the axes/);
  });

  it('opens a previously saved project, restoring calibration, the data point, and the image', async () => {
    await resetWorkspace('xy'); // establishes canvasBox/electronAPI wiring; its own placeholder image gets replaced below
    const projectPath = writeXYProjectFixture();
    await stubOpenProjectDialog(projectPath);

    await page.getByTestId('open-project').click();
    await page.waitForTimeout(400);

    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);
    // Checkpoint 35: axes-type-select is a real MUI Select, not a native
    // <select> -- .inputValue() no longer applies. It displays the
    // selected MenuItem's own label text ('XY', not the config id 'xy').
    expect(await textOf('axes-type-select')).toContain('XY');
    // The selector carries a visible "Graph type" caption so a first-time user
    // knows the bare "XY" chip is the type to change before calibrating a
    // non-XY figure (only what's on screen).
    expect(await textOf('axes-type-label')).toBe('Graph type');
    await expectRow([5, 5]);

    fs.unlinkSync(projectPath);
  });

  it('saves and reopens a recorded measurement (checkpoint 56)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await enterMeasureMode();
    await clickAt(350, 250); // slope points → records one measurement
    await clickAt(450, 200);
    expect(await page.locator('[data-testid^="measure-row-"]').count()).toBe(1);

    const savePath = tempFilePath('json');
    await stubSaveDialog(savePath);
    await page.getByTestId('save-project').click();
    await page.waitForTimeout(300);
    const written = readSavedProjectJson(savePath); // checkpoint 94: zip container
    expect(written.measurements).toHaveLength(1);
    expect((written.measurements as { tool: string }[])[0]!.tool).toBe('slope');

    // Reopen (opens in Place Point mode) → the measurement is restored and
    // shows again once the Measure card is reopened.
    await stubOpenProjectDialog(savePath);
    await page.getByTestId('open-project').click();
    await page.waitForTimeout(400);
    await page.getByTestId('mode-measure').click();
    expect(await page.locator('[data-testid^="measure-row-"]').count()).toBe(1);

    fs.unlinkSync(savePath);
  });

  it('nudges a recorded measurement vertex with the arrow keys, re-deriving its value (checkpoint 128)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await enterMeasureMode();
    // Click well right of the folded-out Measure card (it overlays the left of the
    // canvas) and let the mode settle, so the slope reliably records here rather
    // than tripping the documented measure-recording flake.
    await page.waitForTimeout(200);
    await clickAt(460, 300); // slope endpoint A
    await clickAt(660, 180); // slope endpoint B → records one slope measurement
    const row = page.locator('[data-testid^="measure-row-"]').first();
    await row.waitFor({ state: 'visible' });
    expect(await page.locator('[data-testid^="measure-row-"]').count()).toBe(1);
    const before = await row.textContent();

    // Click endpoint A to select it, then nudge it up: the slope re-derives from
    // the moved pixel, so the displayed value changes (proof it's live, not frozen
    // — the "unfrozen measurements" defect this closes).
    await clickAt(460, 300);
    expect(await textOf('tips-bar')).toMatch(/Measurement point selected/i);
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowUp');
    const after = await row.textContent();
    expect(after).not.toBe(before);
  });

  it('appends a Measurements block to the exported CSV (checkpoint 56)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await enterMeasureMode();
    await clickAt(350, 250);
    await clickAt(450, 200);

    const csvPath = tempFilePath('csv');
    await stubSaveDialog(csvPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-csv').click(); // pick CSV from the format menu
    // Poll the exported file instead of a fixed 300ms sleep: the export writes via
    // async IPC, and under full-suite load that write can outlast the sleep -- a
    // pre-existing flake the D1 test's ~16s made reproducible. Deterministic, and
    // faster on success. (Uses the expect.poll idiom already in this file.)
    await expect
      .poll(() => (fs.existsSync(csvPath) ? fs.readFileSync(csvPath, 'utf8') : ''))
      .toContain('Measurements');
    const csv = fs.readFileSync(csvPath, 'utf8');
    expect(csv).toMatch(/slope/);

    fs.unlinkSync(csvPath);
  });

  it('exports a small-magnitude value at its true resolution, not a zero (v1.0 export blocker)', async () => {
    // A Y axis over 0..0.01 (150px): the case the old fixed 2-decimal round zeroed.
    await resetWorkspace('xy');
    await clickAt(100, 250);
    await confirmValue('0');
    await clickAt(400, 250);
    await confirmValue('10');
    await clickAt(100, 250);
    await confirmValue('0');
    await clickAt(100, 100);
    await confirmValue('0.01');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);
    // Point at local (250, 200): Y = (250-200)/(250-100)*0.01 = 0.00333...
    await page.getByTestId('mode-place-point').click();
    await clickAt(250, 200);

    const csvPath = tempFilePath('csv');
    await stubSaveDialog(csvPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-csv').click();
    await expect.poll(() => (fs.existsSync(csvPath) ? fs.readFileSync(csvPath, 'utf8') : '')).toContain('0.003');
    const csv = fs.readFileSync(csvPath, 'utf8');
    // The Y value survived (would have been rounded to 0 by the old 2-decimal gate).
    expect(csv).toMatch(/0\.0033/);
    fs.unlinkSync(csvPath);

    // Full-precision opt-in emits more digits than the auto (resolution) rounding.
    const fullPath = tempFilePath('csv');
    await stubSaveDialog(fullPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-full-precision').locator('input').check();
    await page.getByTestId('export-format-csv').click();
    await expect.poll(() => (fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '')).toContain('0.003');
    const full = fs.readFileSync(fullPath, 'utf8');
    // e.g. 0.0033333333... -- more decimals than the auto export's ~0.0033.
    expect(full).toMatch(/0\.00333\d/);
    fs.unlinkSync(fullPath);
  });

  it('saves a PNG snapshot as real binary bytes (checkpoint 93)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // a placed point so the overlay has something to composite

    const pngPath = tempFilePath('png');
    await stubSaveDialog(pngPath);
    await page.getByTestId('export-csv').click(); // open the Export menu
    await page.getByTestId('export-format-png').click(); // pick PNG
    await page.waitForTimeout(300);

    // Read as raw bytes, not text: the whole point of the binary IPC write path
    // (checkpoint 93) is that the base64 payload is decoded to bytes before
    // writing. The 8-byte PNG signature only survives a genuine binary write --
    // the old utf8 path would have written the base64 STRING and mangled it.
    const bytes = fs.readFileSync(pngPath);
    expect(bytes.length).toBeGreaterThan(1000); // a real rendered canvas, not an empty stub
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    fs.unlinkSync(pngPath);
  });

  it('derives the snapshot filename from the source image (checkpoint 93)', async () => {
    await resetWorkspace('xy');
    // Capture the options the Save dialog is opened with, so we can assert the
    // default filename PlotTracer proposes -- an image-derived name, not a
    // hardcoded one that would collide when batching a folder.
    const pngPath = tempFilePath('png');
    await app.evaluate(({ dialog }, p) => {
      (globalThis as Record<string, unknown>).__lastSaveOpts = null;
      // Cast around Electron's overloaded showSaveDialog type (as the zero-arg
      // stubSaveDialog helper does implicitly) so we can capture the options.
      dialog.showSaveDialog = (async (_win: unknown, opts: unknown) => {
        (globalThis as Record<string, unknown>).__lastSaveOpts = opts;
        return { canceled: false, filePath: p };
      }) as unknown as typeof dialog.showSaveDialog;
    }, pngPath);
    await page.getByTestId('export-csv').click(); // open the Export menu
    await page.getByTestId('export-format-png').click(); // pick PNG
    await page.waitForTimeout(200);
    const opts = await app.evaluate(() => (globalThis as Record<string, unknown>).__lastSaveOpts as { defaultPath?: string });
    expect(opts?.defaultPath).toMatch(/-annotated\.png$/);
    fs.unlinkSync(pngPath);
  });

  it('exports every series side by side when the scope is "All series" (checkpoint 60)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('series-name').fill('Control');
    await page.getByTestId('series-name').blur();
    await clickAt(250, 175); // Control (5, 5)
    await page.getByTestId('add-series').click();
    await page.waitForTimeout(100);
    await page.getByTestId('series-name').fill('Treated');
    await page.getByTestId('series-name').blur();
    await clickAt(400, 100); // Treated (10, 10)

    await page.getByTestId('export-scope-all').click();
    const csvPath = tempFilePath('csv');
    await stubSaveDialog(csvPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-csv').click(); // pick CSV from the format menu
    await page.waitForTimeout(300);
    const csv = fs.readFileSync(csvPath, 'utf8');
    // One named column per series/dim, both series in one row (no pixel columns).
    expect(csv.split('\n')[0]).toBe('#,Control X,Control Y,Treated X,Treated Y');
    expect(csv).not.toMatch(/x_px/);
    fs.unlinkSync(csvPath);
  });

  it('exports TSV (tab-delimited) via the format menu (checkpoint 61)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // (5, 5)
    const tsvPath = tempFilePath('tsv');
    await stubSaveDialog(tsvPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-tsv').click();
    await page.waitForTimeout(300);
    const tsv = fs.readFileSync(tsvPath, 'utf8');
    // Headers are the axes' own labels now (checkpoint 76), not value1/value2.
    expect(tsv.split('\n')[0]!.split('\t')).toEqual(['x_px', 'y_px', 'X', 'Y']);
    expect(tsv).not.toContain(','); // tab-delimited, no stray commas
    fs.unlinkSync(tsvPath);
  });

  it('exports structured JSON via the format menu (checkpoint 61)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('series-name').fill('Control');
    await page.getByTestId('series-name').blur();
    await clickAt(250, 175); // Control (5, 5)
    await page.getByTestId('export-scope-all').click();

    const jsonPath = tempFilePath('json');
    await stubSaveDialog(jsonPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-json').click();
    await page.waitForTimeout(300);
    const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(doc.series[0].name).toBe('Control');
    expect(doc.series[0].points[0].X).toBeCloseTo(5, 5);
    expect(doc.series[0].points[0].Y).toBeCloseTo(5, 5);
    fs.unlinkSync(jsonPath);
  });

  it('exports an R data.frame via the format menu (v1.1 #3)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // (5, 5)
    const rPath = tempFilePath('R');
    await stubSaveDialog(rPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-r').click();
    await page.waitForTimeout(300);
    const r = fs.readFileSync(rPath, 'utf8');
    // A named data.frame with one vector per column; the flat XY header's names
    // (x_px, y_px, X, Y) are all valid R names, so no check.names override.
    expect(r).toContain('data <- data.frame(');
    expect(r).toContain('X = c(');
    expect(r).toContain('Y = c(');
    expect(r).toContain('stringsAsFactors = FALSE');
    expect(r).not.toContain('check.names');
    fs.unlinkSync(rPath);
  });

  it('copies the extracted data to the clipboard in the chosen format (v1.1 #4)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // (5, 5)
    await page.getByTestId('export-csv').click();
    // Copy (not save): no save dialog is armed, so a leak into the file path
    // would throw. The menu stays open and the row shows a "Copied" tick.
    await page.getByTestId('export-copy-csv').click();
    await page.waitForTimeout(200);
    expect(await page.getByTestId('export-menu').isVisible()).toBe(true);
    // The renderer wrote via navigator.clipboard; read it back through Electron's
    // own clipboard module in the main process (the same OS clipboard).
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    const lines = copied.split('\n');
    expect(lines[0]).toBe('x_px,y_px,X,Y');
    const cells = lines[1]!.split(',').map(Number);
    expect(cells.slice(2)).toEqual([expect.closeTo(5, 6), expect.closeTo(5, 6)]); // the (5,5) point
  });

  it('exports a flat (ungrouped) dataset to CSV with the expected header and rows', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // (5, 5)
    // Deliberately not (100,250) -- that's the shared X1/Y1 calibration
    // handle's own pixel, which would consume the click instead of adding a
    // data point (see this file's other describe blocks' notes on this
    // exact trap). (400,100) isn't any placed handle's pixel.
    await clickAt(400, 100); // (10, 10)

    const csvPath = tempFilePath('csv');
    await stubSaveDialog(csvPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-csv').click(); // pick CSV from the format menu
    await page.waitForTimeout(300);

    // x_px/y_px are image-space pixel coordinates (Dataset's stored pixel),
    // not the local screen coordinates clicked -- those differ whenever the
    // canvas's fit-to-container scale/offset isn't exactly 1/(0,0), so only
    // the ratio-invariant X/Y columns are checked exactly here (the CSV export
    // still carries pixel columns, unlike the on-screen spreadsheet which drops
    // them -- checkpoint 57). Headers are the axes' own labels (checkpoint 76).
    const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
    expect(lines[0]).toBe('x_px,y_px,X,Y');
    const row1 = lines[1]!.split(',').map(Number);
    expect(row1.slice(2)).toEqual([expect.closeTo(5, 6), expect.closeTo(5, 6)]);
    const row2 = lines[2]!.split(',').map(Number);
    expect(row2.slice(2)).toEqual([expect.closeTo(10, 6), expect.closeTo(10, 6)]);

    fs.unlinkSync(csvPath);
  });

  it('exports a Box Plot (Point Groups) dataset to CSV as one row per category', async () => {
    await resetWorkspace('boxplot');
    await clickAt(300, 400);
    await confirmValue('0');
    await clickAt(300, 100);
    await confirmValue('10');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);
    for (const py of [385, 355, 325, 295, 265]) {
      await clickAt(300, py); // reads back exactly 0.5, 1.5, 2.5, 3.5, 4.5
    }

    const csvPath = tempFilePath('csv');
    await stubSaveDialog(csvPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-csv').click(); // pick CSV from the format menu
    await page.waitForTimeout(300);

    const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
    expect(lines[0]).toBe('category,Min,Q1,Median,Q3,Max');
    const [category, ...values] = lines[1]!.split(',');
    expect(category).toBe('Bar0'); // BarAxes.dataPointsLabelPrefix + tuple index, checkpoint 23's default naming
    // closeTo(x, 2), not 6: the values come from pixel clicks mapped through
    // the canvas view, and checkpoint 39's canvas-dominant layout made the
    // canvas larger with a different fit scale, so the same clicks land
    // sub-pixel-differently (~1e-4). The old 6-digit tolerance was an artifact
    // of the fixed-500px canvas producing pixel-exact clicks; 2 decimals is
    // the same effective tolerance the XY tests already get from toFixed(3).
    expect(values.map(Number)).toEqual([
      expect.closeTo(0.5, 2),
      expect.closeTo(1.5, 2),
      expect.closeTo(2.5, 2),
      expect.closeTo(3.5, 2),
      expect.closeTo(4.5, 2),
    ]);

    fs.unlinkSync(csvPath);
  });

  it('a plain Bar chart exports a Label column — the categorical axis (checkpoint 76)', async () => {
    // The headline defect: a Bar CSV was bare numbers, with nothing saying
    // which bar produced each. The header comes from BarAxes.getAxesLabels()
    // and the value from the axes contract, not config.valueLabels (['value']).
    await resetWorkspace('bar');
    await clickAt(300, 400);
    await confirmValue('0');
    await clickAt(300, 100);
    await confirmValue('10');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);

    await clickAt(300, 250); // one bar, no point groups

    const csvPath = tempFilePath('csv');
    await stubSaveDialog(csvPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-csv').click();
    await page.waitForTimeout(300);

    const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
    expect(lines[0]).toBe('x_px,y_px,Label,Y'); // not value1/value2, and Label is present
    const cells = lines[1]!.split(',');
    expect(cells[2]).toBe('Bar0'); // the auto-label, not an empty cell
    expect(Number(cells[3])).toBeCloseTo(5, 1);

    fs.unlinkSync(csvPath);
  });

  it('extracts multiple figures from one PDF source and flips between them (checkpoint 110)', async () => {
    await resetWorkspace('xy'); // establishes canvasBox/electronAPI wiring
    const pdfPath = tempFilePath('pdf');
    fs.writeFileSync(pdfPath, makePdf(2));
    await stubOpenProjectDialog(pdfPath);
    await page.getByTestId('open-image-button').click();
    // Wait for the PDF to actually open (the source is retained -> the extract
    // button appears), not just for the stale prior image to be fitted -- the
    // same deterministic-signal lesson as checkpoint 104.
    await page.getByTestId('extract-another-figure').waitFor({ state: 'visible' });

    // One figure so far: the figure jumper is absent (design §0).
    expect(await page.getByTestId('figure-jumper-status').count()).toBe(0);

    // Capture figure 1 (page 1) and calibrate it.
    await page.getByTestId('capture-figure').click();
    await page.waitForTimeout(100);
    await calibrateXYStandard();
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    // Go back to the source and start a second figure -> now two figures, so the
    // jumper appears (flanking the calibration card), showing the new one active.
    await page.getByTestId('extract-another-figure').click();
    // Two figures now -> the jumper appears (deterministic "second figure" signal).
    await page.getByTestId('figure-jumper-status').waitFor({ state: 'visible' });
    expect(await textOf('figure-jumper-status')).toMatch(/Figure 2 of 2/);

    // Name figure 2 deliberately (checkpoint 113, §5a). The input pre-fills with
    // the auto-name; a real name persists across figure switches.
    expect(await page.getByTestId('figure-name').inputValue()).toBe('Figure 2');
    await page.getByTestId('figure-name').fill('French Ridge');
    await page.getByTestId('figure-name').blur();
    await page.waitForTimeout(100);
    expect(await page.getByTestId('figure-name').inputValue()).toBe('French Ridge');

    // The second figure is a fresh, un-captured page: capture it too.
    await page.getByTestId('capture-figure').waitFor({ state: 'visible' });
    await page.getByTestId('capture-figure').click();
    await page.waitForTimeout(100);

    // Flip back to figure 1: the jumper updates AND figure 1's own calibration is
    // restored (each figure keeps its own state; figure 2 is not calibrated). The
    // switch updates status + calibration synchronously (the image reload is async
    // but doesn't affect either).
    await page.getByTestId('figure-prev').click();
    await page.waitForTimeout(250);
    expect(await textOf('figure-jumper-status')).toMatch(/Figure 1 of 2/);
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);
    expect(await page.getByTestId('figure-name').inputValue()).toBe('Figure 1'); // its own auto-name

    // Forward again to figure 2: not calibrated -> the card shows the steps, not
    // the "Calibrated" status; and its deliberate name survived the round trip.
    await page.getByTestId('figure-next').click();
    await page.waitForTimeout(250);
    expect(await textOf('figure-jumper-status')).toMatch(/Figure 2 of 2/);
    expect(await textOf('calibrated-status')).not.toMatch(/Calibrated/);
    expect(await page.getByTestId('figure-name').inputValue()).toBe('French Ridge');

    // Remove figure 2 (checkpoint 112). It has no work to lose, so no confirm;
    // the session drops back to a single figure -> the jumper disappears, and the
    // survivor (figure 1, calibrated) goes live.
    await page.getByTestId('figure-remove').click();
    await page.waitForTimeout(250);
    expect(await page.getByTestId('figure-jumper-status').count()).toBe(0);
    expect(await page.getByTestId('figure-remove').count()).toBe(0);
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    fs.unlinkSync(pdfPath);
  });

  it('saves and reopens a MULTI-FIGURE project — every figure, its type, name and active index (checkpoint 115)', async () => {
    await resetWorkspace('xy');
    const pdfPath = tempFilePath('pdf');
    fs.writeFileSync(pdfPath, makePdf(2));
    await stubOpenProjectDialog(pdfPath);
    await page.getByTestId('open-image-button').click();
    await page.getByTestId('extract-another-figure').waitFor({ state: 'visible' });

    // Figure 1: capture, calibrate, one point at (5, 5).
    await page.getByTestId('capture-figure').click();
    await page.waitForTimeout(100);
    await calibrateXYStandard();
    await clickAt(250, 175); // reads (5, 5)

    // Figure 2: extract from the source, name it, capture, calibrate.
    await page.getByTestId('extract-another-figure').click();
    await page.getByTestId('figure-jumper-status').waitFor({ state: 'visible' });
    await page.getByTestId('figure-name').fill('French Ridge');
    await page.getByTestId('figure-name').blur();
    await page.waitForTimeout(100);
    await page.getByTestId('capture-figure').waitFor({ state: 'visible' });
    await page.getByTestId('capture-figure').click();
    await page.waitForTimeout(100);
    await calibrateXYStandard();

    // Save the two-figure project as a real .zip.
    const savePath = tempFilePath('zip');
    await stubSaveDialog(savePath);
    await page.getByTestId('save-project').click();
    await page.waitForTimeout(400);
    expect([...fs.readFileSync(savePath).subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04

    // Open a plain image to drop back to a single-figure session (a genuine
    // reset, so the reopen is a real load). Re-stub the image dialog to the
    // sample -- it currently points at the PDF.
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, SAMPLE_IMAGE);
    await page.getByTestId('open-image-button').click();
    await waitForImageFitted();
    expect(await page.getByTestId('figure-jumper-status').count()).toBe(0); // single figure again

    // Reopen the multi-figure project.
    await stubOpenProjectDialog(savePath);
    await page.getByTestId('open-project').click();
    await page.getByTestId('figure-jumper-status').waitFor({ state: 'visible' });

    // Both figures came back, active = figure 2 (where we were at save), named.
    expect(await textOf('figure-jumper-status')).toMatch(/Figure 2 of 2/);
    expect(await page.getByTestId('figure-name').inputValue()).toBe('French Ridge');
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    // Flip to figure 1: its calibration AND its (5, 5) point are restored.
    await page.getByTestId('figure-prev').click();
    await page.waitForTimeout(250);
    expect(await textOf('figure-jumper-status')).toMatch(/Figure 1 of 2/);
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);
    await expectRow([5, 5]);

    // Audit H2: after reopen the source PDF was re-bundled but not parsed (closePdf
    // ran on load). "Extract another graph" must re-parse it on demand and spawn a
    // new figure -- not be a dead button.
    await page.getByTestId('extract-another-figure').click();
    await page.waitForTimeout(500); // the on-demand loadPdf re-parse is async
    expect(await textOf('figure-jumper-status')).toMatch(/Figure 3 of 3/);

    fs.unlinkSync(pdfPath);
    fs.unlinkSync(savePath);
  });

  it('saves a figure captured AFTER a page flip — no stale-session error (audit H1)', async () => {
    await resetWorkspace('xy');
    const pdfPath = tempFilePath('pdf');
    fs.writeFileSync(pdfPath, makePdf(3)); // 3 pages, so figure 2 can live on a later page
    await stubOpenProjectDialog(pdfPath);
    await page.getByTestId('open-image-button').click();
    await page.getByTestId('extract-another-figure').waitFor({ state: 'visible' });

    // Figure 1: capture + calibrate on page 1.
    await page.getByTestId('capture-figure').click();
    await page.waitForTimeout(100);
    await calibrateXYStandard();

    // Extract another -> Figure 2 spawns on PAGE 1. Flip to page 3 BEFORE capturing
    // -- the flow that used to leave figs[1].session pointing at the empty page-1
    // session while the live work went to a new one.
    await page.getByTestId('extract-another-figure').click();
    await page.getByTestId('figure-jumper-status').waitFor({ state: 'visible' });
    await page.getByTestId('pdf-next').click();
    await waitForImageFitted();
    await page.getByTestId('pdf-next').click();
    await waitForImageFitted();
    await page.getByTestId('capture-figure').click();
    await page.waitForTimeout(100);
    await calibrateXYStandard();

    // Save must SUCCEED. Before the fix this aborted with "Can't save 'Figure 2' —
    // Calibrate the axes", losing both figures.
    const savePath = tempFilePath('zip');
    await stubSaveDialog(savePath);
    await page.getByTestId('save-project').click();
    await page.waitForTimeout(400);
    expect(await page.getByTestId('project-error').count()).toBe(0); // no error surfaced
    expect(fs.existsSync(savePath)).toBe(true);
    expect([...fs.readFileSync(savePath).subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    fs.unlinkSync(pdfPath);
    fs.unlinkSync(savePath);
  });
});

describe('Workspace: Segment Fill auto-trace (checkpoint 26)', () => {
  it('the tool-rail button is disabled until calibrated', async () => {
    await resetWorkspace('xy');
    expect(await page.getByTestId('mode-auto-extract').isDisabled()).toBe(true);
    await calibrateXYStandard();
    expect(await page.getByTestId('mode-auto-extract').isDisabled()).toBe(false);
  });

  it('Segment Fill is disabled for a Box Plot (point-group) chart, unlike Place Point', async () => {
    // A plain Bar chart keeps Segment Fill enabled...
    await resetWorkspace('bar');
    await clickAt(300, 400);
    await confirmValue('0');
    await clickAt(300, 100);
    await confirmValue('10');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);
    expect(await page.getByTestId('mode-auto-extract').isDisabled()).toBe(false);

    // ...but Box Plot's datasets carry point groups from the start (checkpoint
    // 107 -- no toggle to flip anymore), so Segment Fill, a curve flood-fill with
    // no group slot to file into, is disabled, while Place Point stays available.
    await resetWorkspace('boxplot');
    await clickAt(300, 400);
    await confirmValue('0');
    await clickAt(300, 100);
    await confirmValue('10');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);
    expect(await page.getByTestId('mode-place-point').isDisabled()).toBe(false); // still allowed
    expect(await page.getByTestId('mode-auto-extract').isDisabled()).toBe(true); // no group slot for a curve trace
  });

  // Local canvas (143,236) lands on the sample chart's real plotted curve
  // (samples/xy-stress-strain.png), not a gridline or axis border -- both
  // of those flood-fill across the whole plot width/height instead
  // (confirmed by hand while developing this test). The *exact* resulting
  // point count isn't asserted, deliberately: it depends on the container's
  // exact pixel width at click time (fitToContainer's scale/offset), which
  // varies slightly with window-chrome/devtools-attach timing between a
  // standalone script and the full vitest run -- confirmed by hand (121 in
  // isolation, 284 as part of the full suite, same seed coordinate and
  // fixture image both times). What's actually being verified -- a real
  // click on a real curve finds *some* bounded trace, not zero and not a
  // runaway fill -- doesn't need an exact number to be a meaningful check.
  it('traces a real curve from a single seed click without erroring, adding a plausible number of points', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();

    await selectAutoExtract('flood');
    await page.waitForTimeout(100);
    expect(await textOf('segment-fill-controls')).toMatch(/threshold/i);

    await clickAt(450, 250);
    await page.waitForTimeout(200);

    expect(await page.getByTestId('segment-fill-error').count()).toBe(0);
    const rowCount = await page.getByTestId('points-table').locator('tbody tr').count();
    expect(rowCount).toBeGreaterThan(5);
    // Was `toBeLessThan(500)` and passed at 465. Checkpoint 78 took it to 500,
    // the subsample cap, and that rise is the FIX rather than a regression:
    // this seed's fill has ~2 runs in most columns, and the old one-point-per-
    // column median silently dropped one of them. Measured old=465, new=500
    // (~930 raw) -- i.e. the old trace was reporting about half of what it
    // traced, and this assertion was quietly encoding that loss.
    //
    // ⚑ Worth its own look, logged not chased: ~2 runs per column means this
    // seed traces a CLOSED, frame-like shape -- so a test named "traces a real
    // curve" appears never to have traced the curve. Re-seeding it onto the
    // blue stress-strain curve is a separate piece of work (the seed is in
    // canvas coordinates, so it needs the fit-scale mapping).
    expect(rowCount).toBeLessThanOrEqual(500); // the cap, now legitimately reachable

    // A dense trace renders as a connecting line, not a furry band of dots
    // (checkpoint 131): its points are pixel-adjacent, so polylineRuns yields
    // at least one run. (A sparse/scatter series would give 0 -- asserted in the
    // NN-sort test, where 3 far-apart points stay dots.)
    expect(Number(await textOf('series-line-runs'))).toBeGreaterThan(0);

    const rows = page.getByTestId('points-table').locator('tbody tr');
    const firstPixel = await rows.first().textContent();
    const lastPixel = await rows.last().textContent();
    expect(firstPixel).not.toBe(lastPixel); // traced a real span, not a degenerate single point
  });

  // Not asserting a strict monotonic relationship between threshold and trace
  // size: on a real anti-aliased image a tighter threshold still isn't
  // guaranteed to yield fewer exported points, because the fill's boundary
  // shape (not just its area) decides how many columns and runs it touches.
  //
  // ⚑ This comment used to give a DIFFERENT reason, and that reason was a bug
  // we had already found and normalized. It read: "floodFill's `visited`
  // bitmask... includes rejected boundary pixels alongside accepted ones...
  // confirmed by hand while developing this test, not a bug introduced by this
  // checkpoint." That diagnosis was exactly right, and it was a REAL DEFECT —
  // the exported mask was the fill dilated by 1px, so a 1px line exported three
  // columns of points. It was seen, correctly explained, written down, and then
  // used to justify weakening this assertion, instead of being logged as a bug.
  // Fixed in checkpoint 78 (`seen` and `mask` are now two arrays).
  //
  // "A code comment is not a backlog" — CLAUDE.md's own root-cause lesson,
  // caught here in the act. The conclusion below still stands; the mechanism it
  // used to blame is gone.
  //
  // What this test actually checks, and what is reliably true: the threshold
  // input is live -- editing it changes which value the next click's trace
  // uses, and an extreme, very strict value still traces successfully rather
  // than erroring or crashing.
  it('the threshold input is live: an edited value is used by the next trace', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await selectAutoExtract('flood');
    await page.waitForTimeout(100);

    await page.locator('[data-testid="segment-fill-threshold"]').fill('2');
    expect(await page.locator('[data-testid="segment-fill-threshold"]').inputValue()).toBe('2');

    await clickAt(450, 250);
    await page.waitForTimeout(200);

    expect(await page.getByTestId('segment-fill-error').count()).toBe(0);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBeGreaterThan(0);
  });
});

describe('Workspace: Interpolation-assist (checkpoint 120)', () => {
  it('is disabled until calibrated, then enabled', async () => {
    await resetWorkspace('xy');
    expect(await page.getByTestId('mode-auto-extract').isDisabled()).toBe(true);
    await calibrateXYStandard();
    expect(await page.getByTestId('mode-auto-extract').isDisabled()).toBe(false);
  });

  it('fills a derived curve from a few guide points (more points than were clicked)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();

    await selectAutoExtract('guide');
    expect(await page.getByTestId('auto-extract-guide').getAttribute('aria-pressed')).toBe('true');

    // Three well-separated guide points along a curve (canvas-local coords).
    await clickAt(140, 450);
    await clickAt(250, 160);
    await clickAt(380, 130);
    await page.waitForTimeout(150);

    // 3 anchors + the spline fill between them => strictly more table rows than
    // the 3 points actually clicked.
    const rowCount = await page.getByTestId('points-table').locator('tbody tr').count();
    expect(rowCount).toBeGreaterThan(3);
  });

  it('shortcut 4 selects the Auto-extract tool once calibrated (v0.8)', async () => {
    // Interpolate no longer has its own hotkey -- it's a mechanism inside the
    // Auto-extract umbrella (hotkey 4 after the 2026-07-22 rail renumber), which
    // opens on the last-used mechanism.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.keyboard.press('4');
    expect(await page.getByTestId('mode-auto-extract').getAttribute('aria-pressed')).toBe('true');
  });

  it('the Eraser tool removes a clicked data point (2026-07-22)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard(); // lands in Place Point mode
    await clickAt(250, 175);
    expect(await page.locator('[data-testid^="point-row-"]').count()).toBe(1);

    // Activate the Eraser, then click the point's marker to remove it. A bare
    // canvas click in eraser mode adds nothing; only a marker click deletes.
    await page.getByTestId('mode-eraser').click();
    expect(await page.getByTestId('mode-eraser').getAttribute('aria-pressed')).toBe('true');
    await clickAt(250, 175);
    await page.waitForTimeout(100);
    expect(await page.locator('[data-testid^="point-row-"]').count()).toBe(0);
  });

  it('walks anchors with Q/W and deletes the selected anchor, refitting the curve', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await selectAutoExtract('guide');
    await clickAt(140, 450);
    await clickAt(380, 130);
    await page.waitForTimeout(150);
    const withFill = await page.getByTestId('points-table').locator('tbody tr').count();
    expect(withFill).toBeGreaterThan(3); // 2 anchors + spline fill; newest anchor (2) active

    // The active row is aria-selected in the data panel -- an on-screen proof of
    // which anchor is selected. The series is stored in CURVE order now, so anchor 1
    // is at row 0 (curve start) and anchor 2 is at the LAST row (curve end), with the
    // derived fill between them. The newest anchor (2) is selected on placement, so
    // the last row is active. Q steps back to anchor 1 (row 0), W forward to anchor 2
    // (last row) -- the walk skips the derived fill in between.
    const lastRow = withFill - 1;
    expect(await page.getByTestId(`point-row-${lastRow}`).getAttribute('aria-selected')).toBe('true');
    await page.keyboard.press('q');
    await page.waitForTimeout(50);
    expect(await page.getByTestId('point-row-0').getAttribute('aria-selected')).toBe('true');
    await page.keyboard.press('w');
    await page.waitForTimeout(50);
    expect(await page.getByTestId(`point-row-${lastRow}`).getAttribute('aria-selected')).toBe('true');

    // Step back to anchor 1 and delete it: a single guide point can't form a
    // curve, so the derived fill clears and exactly one row remains.
    await page.keyboard.press('q');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(1);
  });
});

describe('Workspace: Curve Fit & Geometry panels (checkpoint 27)', () => {
  // Same LINE_PIXELS fixture as engine/__tests__/curveFitPanel.test.ts:
  // x_data = (px-100)/30, y_data = (250-py)/15 under calibrateXYStandard's
  // calibration, chosen to land exactly on data-space y = 1 + 2x at
  // x = 0, 1, 2, 3 -- an exact fit (R² = 1), not an approximation, so
  // results can be asserted as exact strings. Safe from the shared-handle
  // click-eating trap (none of these pixels are a placed calibration
  // handle's own pixel -- closest is (100,235), 15px from the X1/Y1
  // handle at (100,250), well outside a marker's small hit radius).
  async function addLinePoints() {
    for (const [lx, ly] of [
      [100, 235],
      [130, 205],
      [160, 175],
      [190, 145],
    ] as const) {
      await clickAt(lx, ly);
    }
  }

  it('the Curve Fit and Geometry panels only appear for XY axes', async () => {
    await resetWorkspace('bar');
    await clickAt(300, 400);
    await confirmValue('0');
    await clickAt(300, 100);
    await confirmValue('10');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);
    // The floating-panel triggers (checkpoint 40) are XY-only: absent for Bar.
    expect(await page.getByTestId('curve-fit-trigger').count()).toBe(0);
    expect(await page.getByTestId('geometry-trigger').count()).toBe(0);

    await resetWorkspace('xy');
    await calibrateXYStandard();
    expect(await page.getByTestId('curve-fit-trigger').count()).toBe(1);
    expect(await page.getByTestId('geometry-trigger').count()).toBe(1);
  });

  it('fits an exact line, shows the result, and Clear Fit removes it', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await addLinePoints();

    await page.getByTestId('curve-fit-trigger').click();
    await page.getByTestId('curve-fit-run').click();
    await page.waitForTimeout(150);

    const results = await textOf('curve-fit-results');
    expect(results).toContain('y = 1.0000 + 2.0000·x');
    expect(results).toMatch(/R² = 1\.00000|R² = 0\.99999/); // exact fit, allow for float noise
    expect(results).toContain('n = 4 points');
    expect(await page.getByTestId('curve-fit-error').count()).toBe(0);

    await page.getByTestId('curve-fit-clear').click();
    await page.waitForTimeout(100);
    expect(await page.getByTestId('curve-fit-results').count()).toBe(0);
  });

  it('restricting to an x-range excludes points outside it', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await addLinePoints();

    await page.getByTestId('curve-fit-trigger').click();
    await page.getByTestId('curve-fit-restrict').click();
    await page.locator('[data-testid="curve-fit-xmin"]').fill('0');
    await page.locator('[data-testid="curve-fit-xmax"]').fill('1.5');
    await page.getByTestId('curve-fit-run').click();
    await page.waitForTimeout(150);

    expect(await textOf('curve-fit-results')).toContain('n = 2 points');
  });

  it('computing Geometry reports arc length/area, and the closed toggle changes the area label', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    // Deliberately not (100,250) -- that's the shared X1/Y1 calibration
    // handle's own pixel, which would swallow the click (see this file's
    // other describe blocks' notes on this exact trap). (1,0) to (4,4) is
    // the same 3-4-5 triangle shifted, giving the same exact arc
    // length/area as (0,0)-(3,4) without colliding with any handle.
    await clickAt(130, 250); // data (1, 0)
    await clickAt(220, 190); // data (4, 4)

    await page.getByTestId('geometry-trigger').click();
    await page.getByTestId('geometry-run').click();
    await page.waitForTimeout(150);

    let summary = await textOf('geometry-summary');
    expect(summary).toContain('Arc length = 5.00000');
    expect(summary).toContain('Area under curve = 6.00000');

    await page.getByTestId('geometry-closed').click();
    await page.getByTestId('geometry-run').click();
    await page.waitForTimeout(150);
    summary = await textOf('geometry-summary');
    expect(summary).toContain('Enclosed area');
  });

  it('reports a clear error instead of computing Geometry for fewer than 2 points', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(100, 250); // just one point

    await page.getByTestId('geometry-trigger').click();
    await page.getByTestId('geometry-run').click();
    await page.waitForTimeout(150);

    expect(await textOf('geometry-error')).toMatch(/at least 2 points/);
    expect(await page.getByTestId('geometry-summary').count()).toBe(0);
  });

  it('a saved and reopened project round-trips the curve fit result', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await addLinePoints();
    await page.getByTestId('curve-fit-trigger').click();
    await page.getByTestId('curve-fit-run').click();
    await page.waitForTimeout(150);
    expect(await textOf('curve-fit-results')).toContain('n = 4 points');
    // Close the Popover before clicking a top-bar button -- while it's open,
    // MUI's Popover backdrop covers the top bar, so a Save Project click would
    // hit the backdrop (closing the panel) instead of the button.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    const savePath = path.join(os.tmpdir(), `plottracer-e2e-curvefit-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, savePath);
    await page.getByTestId('save-project').click();
    await page.waitForTimeout(300);

    await resetWorkspace('xy'); // fresh, uncalibrated state before reopening
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, savePath);
    await page.getByTestId('open-project').click();
    await page.waitForTimeout(400);

    await page.getByTestId('curve-fit-trigger').click();
    const results = await textOf('curve-fit-results');
    expect(results).toContain('y = 1.0000 + 2.0000·x');
    expect(results).toContain('n = 4 points');
    // The degree/restrict controls sync to the loaded fit's own parameters.
    expect(await page.locator('[data-testid="curve-fit-degree"]').inputValue()).toBe('1');

    fs.unlinkSync(savePath);
  });
});

describe('Workspace: Grid Line Removal (checkpoint 28)', () => {
  it('shows a clear error when no image is loaded yet', async () => {
    // Deliberately not calling resetWorkspace() -- it always opens an
    // image as its first step; this test needs the app's true initial
    // state, before any image has been chosen.
    await page.getByTestId('grid-removal-trigger').click();
    await page.getByTestId('grid-removal-run').click();
    await page.waitForTimeout(150);
    expect(await textOf('grid-removal-error')).toMatch(/No image loaded/);
  });

  it('is usable before calibrating -- the panel is not axes-type or calibration gated', async () => {
    await resetWorkspace('xy'); // resetWorkspace itself leaves the session uncalibrated
    expect(await textOf('tips-bar')).toMatch(/1\/4/);

    await page.getByTestId('grid-removal-trigger').click();
    await page.getByTestId('grid-removal-run').click();
    await page.waitForTimeout(200);
    expect(await page.getByTestId('grid-removal-error').count()).toBe(0);
  });

  it('preserves the current zoom/pan (keepZoom) and clears any prior error', async () => {
    await resetWorkspace('xy');
    await page.mouse.move(canvasBox.x + 400, canvasBox.y + 300);
    await page.mouse.wheel(0, -300); // zoom in
    await page.waitForTimeout(150);
    const viewBefore = await textOf('view-state');

    await page.getByTestId('grid-removal-trigger').click();
    await page.getByTestId('grid-removal-run').click();
    await page.waitForTimeout(300);

    expect(await textOf('view-state')).toBe(viewBefore);
    expect(await page.getByTestId('grid-removal-error').count()).toBe(0);
  });

  it('the color and tolerance inputs are live and can be re-run without error', async () => {
    await resetWorkspace('xy');
    await page.getByTestId('grid-removal-trigger').click();

    await page.locator('[data-testid="grid-removal-tolerance"]').fill('10');
    expect(await page.locator('[data-testid="grid-removal-tolerance"]').inputValue()).toBe('10');

    await page.getByTestId('grid-removal-run').click();
    await page.waitForTimeout(200);
    expect(await page.getByTestId('grid-removal-error').count()).toBe(0);

    // Running it a second time (e.g. after adjusting tolerance again) must
    // not error just because it's already been applied once.
    await page.getByTestId('grid-removal-run').click();
    await page.waitForTimeout(200);
    expect(await page.getByTestId('grid-removal-error').count()).toBe(0);
  });
});

describe('Workspace: Auto-trace by colour (checkpoint 118)', () => {
  it('is unreachable before calibration (colour trace lives inside Auto-extract, v0.8)', async () => {
    // Colour trace is now a mechanism inside the Auto-extract umbrella, which is
    // greyed until calibrated -- tracing produces data points and those need a
    // coordinate system. The old "click Trace, get a Calibrate-first reason" path
    // is replaced by the tool simply being disabled (the button's state IS the
    // reason), consistent with the other tracing mechanisms.
    await resetWorkspace('xy');
    expect(await page.getByTestId('mode-auto-extract').isDisabled()).toBe(true);
  });

  it('a bare canvas click in "By colour" mode does NOT drop a stray data point (v0.8 audit #1)', async () => {
    // Colour trace runs via the Trace button only. A click on the plotted curve
    // is natural (the sibling Flood-fill mechanism traces by clicking the curve),
    // so the router MUST NOT fabricate a raw point in the active series here --
    // that would poison the record invisibly until export (tenet 1/9).
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await selectAutoExtract('colour');
    await clickAt(450, 250); // on a feature, clear of the card
    await page.waitForTimeout(150);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(0);
  });

  it('traces a curve by colour into the active series', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard(); // calibrate first, no panel open over the canvas
    // Trace the sample's navy stress-strain curve. Tolerance 160 matches the navy
    // but not the white background (navy->white distance ~315), so it traces the
    // curve, not the whole image.
    await selectAutoExtract('colour');
    await page.getByTestId('color-trace-color').fill('#1f4e79');
    await page.getByTestId('color-trace-tolerance').fill('160');
    await page.getByTestId('color-trace-run').click();
    await page.waitForTimeout(200);

    const info = await textOf('color-trace-info');
    expect(info).toMatch(/Traced [1-9]\d* points/); // a real trace, not "No pixels matched"
    expect(info).not.toMatch(/that is a lot of the image/); // and not the whole image
  });

  it('shows a live colour-match preview while the card is open, updating with tolerance (checkpoint 121)', async () => {
    await resetWorkspace('xy');
    // The preview itself is pixel-space, but the Auto-extract umbrella is greyed
    // until calibrated (v0.8), so calibrate first, then open the colour mechanism.
    await calibrateXYStandard();
    await selectAutoExtract('colour');
    await page.getByTestId('auto-extract-card').waitFor({ state: 'visible' });

    // The sample's navy curve at a tolerance that matches it: a real, bounded
    // highlight (not zero, not the whole image).
    await page.getByTestId('color-trace-color').fill('#1f4e79');
    await page.getByTestId('color-trace-tolerance').fill('160');
    await page.waitForTimeout(150);
    const preview160 = await textOf('color-trace-preview');
    expect(preview160).toMatch(/[1-9][\d,]* px highlighted/);

    // A much tighter tolerance matches fewer pixels -> the live count drops. This
    // is what proves the overlay is recomputed from the current inputs, not stale.
    const count160 = Number(preview160.replace(/,/g, '').match(/(\d+) px/)![1]);
    await page.getByTestId('color-trace-tolerance').fill('20');
    await page.waitForTimeout(150);
    const preview20 = await textOf('color-trace-preview');
    const count20 = Number(preview20.replace(/,/g, '').match(/(\d+) px/)?.[1] ?? '0');
    expect(count20).toBeLessThan(count160);

    // Leaving the colour mechanism tears the preview down -- the overlay never
    // lingers. (Toggling the wand off exits Auto-extract; the docked card isn't
    // an Escape-dismissable popover anymore.)
    await page.getByTestId('mode-auto-extract').click();
    await page.waitForTimeout(150);
    expect(await page.getByTestId('color-trace-preview').count()).toBe(0);
  });

  it('scatter mode reduces the colour mask to one point per blob (checkpoint 122)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await selectAutoExtract('colour');
    await page.getByTestId('auto-extract-card').waitFor({ state: 'visible' });

    // The min-marker-size control is scatter-only: absent for a curve.
    expect(await page.getByTestId('color-trace-min-blob').count()).toBe(0);
    await page.getByTestId('color-trace-shape').selectOption('scatter');
    expect(await page.getByTestId('color-trace-min-blob').count()).toBe(1);

    // Run the blob detector over the sample's navy curve: it reduces the matched
    // pixels to blob centroids (this sample is one connected curve, so the info
    // reports the blob-based wording rather than the curve trace's).
    await page.getByTestId('color-trace-color').fill('#1f4e79');
    await page.getByTestId('color-trace-tolerance').fill('160');
    await page.getByTestId('color-trace-run').click();
    await page.waitForTimeout(200);
    const info = await textOf('color-trace-info');
    expect(info).toMatch(/Placed [1-9]\d* point.*one per marker/);
  });

  // Helper: the live preview's highlighted-pixel count.
  async function previewCount(): Promise<number> {
    const t = await textOf('color-trace-preview');
    return Number(t.replace(/,/g, '').match(/(\d+) px/)?.[1] ?? '0');
  }

  it('defaults the trace region to the calibration box, and clearing traces the whole image (B1)', async () => {
    // 2026-07-22 walkthrough: a whole-image trace grabbed the title, axis lines
    // and tick labels (same colour as the curve), so the traced curve "crept"
    // outside the plot. The By-colour panel now opens with the region pre-set to
    // the calibration box — visible and clearable — so the first pass stays in.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await selectAutoExtract('colour');
    await page.getByTestId('auto-extract-card').waitFor({ state: 'visible' });
    await page.getByTestId('color-trace-color').fill('#1f4e79');
    await page.getByTestId('color-trace-tolerance').fill('160');
    await page.waitForTimeout(150);

    // Region defaulted: the clear (✕) affordance is present (not the "Restrict to
    // a box" prompt), and the highlighted count is the in-box count.
    expect(await page.getByTestId('color-trace-region-clear').count()).toBe(1);
    const boxCount = await previewCount();
    expect(boxCount).toBeGreaterThan(0);

    // Clearing removes the restriction -> whole image, which matches at least as
    // many pixels (the calibration box is a subset of the image).
    await page.getByTestId('color-trace-region-clear').click();
    await page.waitForTimeout(150);
    const wholeCount = await previewCount();
    expect(wholeCount).toBeGreaterThanOrEqual(boxCount);

    // Drawing a smaller box restricts again, below the whole-image count.
    await page.getByTestId('color-trace-region').click();
    await refreshCanvasBox();
    await page.mouse.move(canvasBox.x + 480, canvasBox.y + 160);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 620, canvasBox.y + 320, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(await page.getByTestId('color-trace-region-clear').count()).toBe(1);
    expect(await previewCount()).toBeLessThan(wholeCount);
  });

  it('the bundled scatter example traces one point per marker end to end (checkpoint 123)', async () => {
    // Open the scatter example (loads its image + pre-selects XY), capture the
    // figure, and calibrate. Calibration VALUES are irrelevant here: the blob
    // count is pixel-space (native resolution), so it doesn't depend on the fit.
    await page.getByTestId('help-trigger').click();
    await page.getByTestId('example-scatter').waitFor({ state: 'visible' });
    await page.getByTestId('example-scatter').click();
    await waitForImageFitted();
    await page.getByTestId('capture-figure').click();
    await page.waitForTimeout(100);
    await calibrateXYStandard();

    // Auto-trace ▸ Scattered points on the navy markers.
    await selectAutoExtract('colour');
    await page.getByTestId('auto-extract-card').waitFor({ state: 'visible' });
    // calibrateXYStandard's synthetic box does not bound this example's markers,
    // so clear the default calibration-box region to detect over the whole image
    // (the region default itself is exercised in the B1 test above).
    await page.getByTestId('color-trace-region-clear').click();
    await page.getByTestId('color-trace-color').fill('#1f4e79');
    await page.getByTestId('color-trace-tolerance').fill('60');
    await page.getByTestId('color-trace-shape').selectOption('scatter');
    await page.getByTestId('color-trace-run').click();
    await page.waitForTimeout(200);

    // The sample has 26 well-separated markers -> one centroid each. A tight band
    // (not exactly 26) tolerates a 1-px antialiasing-edge difference in the
    // browser's PNG decode, while still proving "one point per marker" — not one
    // giant blob (the whole curve) and not hundreds of noise specks.
    const rows = await page.getByTestId('points-table').locator('tbody tr').count();
    expect(rows).toBeGreaterThanOrEqual(24);
    expect(rows).toBeLessThanOrEqual(28);
  });
});

describe('Workspace: analysis panels are floating Popovers (checkpoint 40)', () => {
  // The three panels (Grid Removal / Curve Fit / Geometry) moved from inline
  // sidebar accordions (checkpoint 36) to floating Popovers opened from top-bar
  // trigger buttons (ui/src/FloatingPanel.tsx). MUI's Popover unmounts its body
  // when closed, so a panel's content (its run button) is simply absent from
  // the DOM until its trigger is clicked.
  it('the Grid Removal panel is closed by default and opens on its trigger', async () => {
    await resetWorkspace('xy');
    expect(await page.getByTestId('grid-removal-run').count()).toBe(0);

    await page.getByTestId('grid-removal-trigger').click();
    await page.getByTestId('grid-removal-run').waitFor({ state: 'visible' });
    expect(await page.getByTestId('grid-removal-panel').isVisible()).toBe(true);

    // Closes on an outside click (MUI Popover backdrop). Retried, the same
    // synthetic-click/ClickAwayListener timing note ZoomControls' own
    // outside-click test documents.
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.mouse.click(20, 20);
      await page.waitForTimeout(150);
      if ((await page.getByTestId('grid-removal-run').count()) === 0) break;
    }
    expect(await page.getByTestId('grid-removal-run').count()).toBe(0);
  });

  it('Curve Fit and Geometry are independent Popovers -- opening one leaves the other closed', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    expect(await page.getByTestId('curve-fit-run').count()).toBe(0);
    expect(await page.getByTestId('geometry-run').count()).toBe(0);

    await page.getByTestId('curve-fit-trigger').click();
    await page.getByTestId('curve-fit-run').waitFor({ state: 'visible' });
    // Opening Curve Fit did not open Geometry.
    expect(await page.getByTestId('geometry-run').count()).toBe(0);
  });
});

describe('Workspace: multi-dataset/series support (checkpoint 30)', () => {
  it('"+ Add Series" is disabled until calibrated', async () => {
    await resetWorkspace('xy');
    expect(await page.getByTestId('add-series').isDisabled()).toBe(true);
    await calibrateXYStandard();
    expect(await page.getByTestId('add-series').isDisabled()).toBe(false);
  });

  it('adding a series switches the active one; each keeps its own points independently', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // Series 1: (5, 5)
    await expectRow([5, 5]);

    await page.getByTestId('add-series').click();
    await page.waitForTimeout(100);
    // The new series is active and empty (dropdown shows its 0 count); the
    // spreadsheet shows every series at once now, so Series 1's row remains.
    expect(await page.getByTestId('series-option-1').textContent()).toContain('(0)');

    await clickAt(400, 100); // Series 2: (10, 10)
    // Row 1 holds each series independently: Series 1 (5,5), Series 2 (10,10).
    await expectRow([5, 5, 10, 10]);
  });

  it('renaming and recoloring a series updates that series only', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('add-series').click();
    await page.waitForTimeout(100);

    // Rename each series via the dropdown + the active-series name field.
    await page.getByTestId('series-select').selectOption('0');
    await page.waitForTimeout(80);
    await page.getByTestId('series-name').fill('Control');
    await page.getByTestId('series-name').blur();
    await page.getByTestId('series-select').selectOption('1');
    await page.waitForTimeout(80);
    await page.getByTestId('series-name').fill('Treated');
    await page.getByTestId('series-name').blur();
    expect(await page.getByTestId('series-option-0').textContent()).toContain('Control');
    expect(await page.getByTestId('series-option-1').textContent()).toContain('Treated');

    // Recolor the active series (Series 2); Series 1's color is untouched. The
    // colour controls live in a Popover off the swatch button now (ckpt 91), so
    // open it before reaching the hex field.
    await page.getByTestId('series-select').selectOption('1');
    await page.waitForTimeout(80);
    await page.getByTestId('series-color-button').click();
    await page.getByTestId('series-color').evaluate((el: HTMLInputElement) => {
      el.value = '#123456';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(await page.getByTestId('series-color').inputValue()).toBe('#123456');
    await page.keyboard.press('Escape'); // close the popover before switching series
    await page.getByTestId('series-select').selectOption('0');
    await page.waitForTimeout(80);
    await page.getByTestId('series-color-button').click();
    expect(await page.getByTestId('series-color').inputValue()).not.toBe('#123456');
  });

  it('recolours a series from a palette swatch — no native colour dialog (checkpoint 89)', async () => {
    // The bug: the series-colour picker was a native <input type="color">, the
    // exact dialog checkpoint 49 found CRASHES this Electron build on Linux
    // (fixed for Grid Removal, missed here). The swatches are the crash-free
    // path -- one click sets the colour, no dialog opens.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('series-color-button').click(); // open the colour popover
    // tab10's second colour is orange #ff7f0e -- click its swatch.
    await page.getByTestId('series-swatch-ff7f0e').click();
    await page.waitForTimeout(80);
    expect((await page.getByTestId('series-color').inputValue()).toLowerCase()).toBe('#ff7f0e');
  });

  it('removing a series keeps at least one and falls back to a sensible active series', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('add-series').click();
    await page.waitForTimeout(100);
    expect(await page.locator('[data-testid^="series-option-"]').count()).toBe(2);
    expect(await page.getByTestId('series-remove').isVisible()).toBe(true);

    // Removes the active series (the just-added Series 2).
    await page.getByTestId('series-remove').click();
    await page.waitForTimeout(100);
    expect(await page.locator('[data-testid^="series-option-"]').count()).toBe(1);
    // The sole remaining series has no delete button -- always keep at least one.
    expect(await page.getByTestId('series-remove').count()).toBe(0);
  });

  it('a saved and reopened project round-trips multiple series with their names, colors, and points', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('series-name').fill('Control'); // active series 0
    await page.getByTestId('series-name').blur();
    await clickAt(250, 175); // Control: (5, 5)

    await page.getByTestId('add-series').click();
    await page.waitForTimeout(100);
    await page.getByTestId('series-name').fill('Treated'); // active series 1
    await page.getByTestId('series-name').blur();
    await clickAt(400, 100); // Treated: (10, 10)

    const savePath = path.join(os.tmpdir(), `plottracer-e2e-multiseries-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, savePath);
    await page.getByTestId('save-project').click();
    await page.waitForTimeout(300);

    await resetWorkspace('xy'); // fresh, uncalibrated state before reopening
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, savePath);
    await page.getByTestId('open-project').click();
    await page.waitForTimeout(400);

    expect(await page.locator('[data-testid^="series-option-"]').count()).toBe(2);
    expect(await page.getByTestId('series-option-0').textContent()).toContain('Control');
    expect(await page.getByTestId('series-option-1').textContent()).toContain('Treated');

    // The spreadsheet shows both restored series at once: row 1 is
    // Control (5,5) then Treated (10,10).
    await expectRow([5, 5, 10, 10]);

    fs.unlinkSync(savePath);
  });

  it('an inactive series\' points render but are not draggable -- a drag there pans the background instead', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // Series 1: (5, 5), local (250,175)
    await page.getByTestId('add-series').click();
    await page.waitForTimeout(100);

    // Series 1's point at local (250,175) is now rendered as a non-
    // interactive inactive-series marker (Series 2 is active). Dragging
    // starting exactly there must fall through to the Stage background, not move
    // the point -- same "look but don't touch" mechanism Pan mode already relies
    // on (checkpoints 12/17). In Pan mode that fall-through is observable as a
    // pan (the mouse model routes a tool-mode left-drag to nothing, so we assert
    // the fall-through in the mode where it still visibly pans).
    await page.getByTestId('mode-pan').click();
    const before = await textOf('view-state');
    await dragMarker(250, 175, 300, 220);
    const after = await textOf('view-state');
    expect(after).not.toBe(before); // panned -> the drag reached the Stage, not the marker

    // Series 1's point is untouched -- still exactly (5, 5) in its column.
    // (Series 2 has no point -- the drag panned rather than placing one -- so
    // row 1 has only Series 1's pair after blank cells are filtered.)
    await expectRow([5, 5]);
  });

  it('renders an adaptive spreadsheet: a column per series, per-type value dims, no pixel column (checkpoint 57)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // Series 1: (5, 5)
    await page.getByTestId('add-series').click();
    await page.waitForTimeout(100);
    await clickAt(400, 100); // Series 2: (10, 10)

    // One header column per series.
    expect(await page.getByTestId('series-col-0').textContent()).toContain('Series 1');
    expect(await page.getByTestId('series-col-1').textContent()).toContain('Series 2');

    // XY value-dim headers are X and Y -- and the pixel column is gone.
    const headerText = await page.getByTestId('points-table').locator('thead').innerText();
    expect(headerText).toMatch(/\bX\b/);
    expect(headerText).toMatch(/\bY\b/);
    expect(headerText).not.toMatch(/px|pixel|on image/i);

    // Both series sit side by side in one row.
    await expectRow([5, 5, 10, 10]);
  });
});

describe('Workspace: Zoom Controls (checkpoint 34)', () => {
  // Parses "71%" -> 71. Same shape as this file's readViewState-adjacent
  // helpers above, kept local since only this describe block needs it.
  function readPercent(text: string): number {
    const m = text.match(/(\d+)%/);
    if (!m) throw new Error(`unexpected zoom-controls-button text: ${text}`);
    return Number(m[1]);
  }

  it('is disabled until an image is loaded', async () => {
    // Deliberately not calling resetWorkspace() -- it always opens an image
    // as its first step (same reasoning as the Grid Line Removal describe
    // block's own "no image loaded" test above); this one needs the app's
    // true initial state.
    expect(await page.getByTestId('zoom-controls-button').isDisabled()).toBe(true);
  });

  it('shows the fitted zoom percentage once an image loads, and opens a dropdown with Zoom In/Out/Fit/Actual Size', async () => {
    await resetWorkspace('xy');
    expect(await page.getByTestId('zoom-controls-button').isDisabled()).toBe(false);
    const fittedText = await textOf('zoom-controls-button');
    expect(fittedText).toMatch(/^\d+%/); // MUI's icon/span markup adds trailing whitespace to textContent

    await page.getByTestId('zoom-controls-button').click();
    await page.waitForTimeout(150);
    expect(await page.getByTestId('zoom-in').isVisible()).toBe(true);
    expect(await page.getByTestId('zoom-out').isVisible()).toBe(true);
    expect(await page.getByTestId('zoom-fit').isVisible()).toBe(true);
    expect(await page.getByTestId('zoom-100').isVisible()).toBe(true);
  });

  it('Zoom In/Out change the displayed percentage, matching the direction of the click', async () => {
    await resetWorkspace('xy');
    const fittedPercent = readPercent(await textOf('zoom-controls-button'));

    await page.getByTestId('zoom-controls-button').click();
    await page.waitForTimeout(150);
    await page.getByTestId('zoom-in').click();
    await page.waitForTimeout(150);
    const zoomedInPercent = readPercent(await textOf('zoom-controls-button'));
    expect(zoomedInPercent).toBeGreaterThan(fittedPercent);

    await page.getByTestId('zoom-out').click();
    await page.waitForTimeout(150);
    await page.getByTestId('zoom-out').click();
    await page.waitForTimeout(150);
    const zoomedOutPercent = readPercent(await textOf('zoom-controls-button'));
    expect(zoomedOutPercent).toBeLessThan(fittedPercent);
  });

  it('Actual Size shows exactly 100%, and Fit to Window returns to the original fitted percentage', async () => {
    await resetWorkspace('xy');
    const fittedPercent = readPercent(await textOf('zoom-controls-button'));

    await page.getByTestId('zoom-controls-button').click();
    await page.waitForTimeout(150);
    await page.getByTestId('zoom-100').click();
    await page.waitForTimeout(150);
    expect(readPercent(await textOf('zoom-controls-button'))).toBe(100);

    // The dropdown is still open (see the next test for why that's
    // deliberate) -- Fit to Window is right there to click again.
    await page.getByTestId('zoom-fit').click();
    await page.waitForTimeout(150);
    expect(readPercent(await textOf('zoom-controls-button'))).toBe(fittedPercent);
  });

  it('the dropdown stays open after a Zoom In click, matching Ketcher\'s own real behavior', async () => {
    await resetWorkspace('xy');

    await page.getByTestId('zoom-controls-button').click();
    await page.waitForTimeout(150);
    await page.getByTestId('zoom-in').click();
    await page.waitForTimeout(150);
    // Still open -- confirmed by the dropdown's own items still being
    // reachable, not just "didn't crash". A second click, to make sure
    // it wasn't a one-off.
    expect(await page.getByTestId('zoom-out').isVisible()).toBe(true);
    await page.getByTestId('zoom-in').click();
    await page.waitForTimeout(150);
    expect(await page.getByTestId('zoom-out').isVisible()).toBe(true);
  });

  it('closes on an outside click', async () => {
    await resetWorkspace('xy');

    await page.getByTestId('zoom-controls-button').click();
    await page.waitForTimeout(150);
    expect(await page.getByTestId('zoom-out').isVisible()).toBe(true);

    // A raw mouse click (not a locator .click(), which does its own
    // actionability wait that can hang on an element a modal backdrop is
    // intercepting) on a point well outside the dropdown -- MUI Popover's
    // own invisible backdrop catches it and closes.
    //
    // Retried up to 3 times, deliberately: confirmed by hand (a dedicated
    // debug script, elementFromPoint(20,20) verified it really is the
    // backdrop, not some other element eating the click) that the very
    // first synthetic outside click after opening the dropdown
    // occasionally doesn't register as a close, in both the dev harness
    // and the production entry point alike -- so it isn't a devtools- or
    // entry-point-specific cause, just some Playwright-synthetic-click/
    // MUI-ClickAwayListener timing interaction under automation this
    // wasn't worth chasing further, the same "confirmed real, not chased
    // further" call this file's own history has made before (e.g. the
    // checkpoint 25/29/30 sequential-Electron-launch resource-contention
    // notes). A second or third click reliably closes it. A real user's
    // outside click isn't affected -- this is specifically about how a
    // synthetic click is dispatched, not the app's own behavior.
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.mouse.click(20, 20);
      await page.waitForTimeout(150);
      if (!(await page.getByTestId('zoom-out').isVisible())) break;
    }
    expect(await page.getByTestId('zoom-out').isVisible()).toBe(false);
  });
});

describe('Workspace: Zoom Slider (checkpoint 37)', () => {
  function readPercent(text: string): number {
    const m = text.match(/(\d+)%/);
    if (!m) throw new Error(`unexpected zoom-controls-button text: ${text}`);
    return Number(m[1]);
  }

  // MUI's Slider renders its focusable thumb as a nested element with
  // role="slider" carrying aria-valuenow; the data-testid sits on the
  // styled root, so scope the role lookup under it.
  function sliderThumb() {
    return page.getByTestId('zoom-slider').getByRole('slider');
  }
  async function readSliderValue(): Promise<number> {
    const v = await sliderThumb().getAttribute('aria-valuenow');
    return Number(v);
  }

  it('is present in the dropdown and sits strictly between its endpoints at the fitted zoom', async () => {
    await resetWorkspace('xy');
    await page.getByTestId('zoom-controls-button').click();
    await page.waitForTimeout(150);
    expect(await page.getByTestId('zoom-slider').isVisible()).toBe(true);
    const v = await readSliderValue();
    // A freshly fitted image is neither at min (5%) nor max (2000%) zoom,
    // so its log-mapped slider position is strictly interior.
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(100);
  });

  it('driving the slider to each extreme sets exactly min (5%) and max (2000%) zoom', async () => {
    await resetWorkspace('xy');
    await page.getByTestId('zoom-controls-button').click();
    await page.waitForTimeout(150);

    // End/Home jump a MUI slider to its max/min -- the log mapping puts
    // those at scale 20 (2000%) and 0.05 (5%), the view's own limits.
    await sliderThumb().focus();
    await page.keyboard.press('End');
    await page.waitForTimeout(150);
    expect(readPercent(await textOf('zoom-controls-button'))).toBe(2000);

    await page.keyboard.press('Home');
    await page.waitForTimeout(150);
    expect(readPercent(await textOf('zoom-controls-button'))).toBe(5);
  });

  it('stays in sync with the discrete Zoom In button (they drive the same zoom state)', async () => {
    await resetWorkspace('xy');
    await page.getByTestId('zoom-controls-button').click();
    await page.waitForTimeout(150);
    const before = await readSliderValue();

    await page.getByTestId('zoom-in').click();
    await page.waitForTimeout(150);
    const after = await readSliderValue();
    expect(after).toBeGreaterThan(before);
  });
});

describe('Workspace: Undo/Redo (checkpoint 38)', () => {
  function seriesCount(): Promise<number> {
    return page.locator('[data-testid^="series-option-"]').count();
  }

  it('undoes and redoes a placed data point, with correct button enablement', async () => {
    await resetWorkspace('xy');
    // Fresh (post reset-calibration): the history baseline, nothing to undo.
    expect(await page.getByTestId('undo').isDisabled()).toBe(true);
    expect(await page.getByTestId('redo').isDisabled()).toBe(true);

    await calibrateXYStandard();
    await clickAt(250, 175);
    await expectRow([5, 5]);
    expect(await page.getByTestId('undo').isDisabled()).toBe(false);

    await page.getByTestId('undo').click();
    await page.waitForTimeout(100);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(0);
    expect(await page.getByTestId('redo').isDisabled()).toBe(false);

    await page.getByTestId('redo').click();
    await page.waitForTimeout(100);
    await expectRow([5, 5]);
    expect(await page.getByTestId('redo').isDisabled()).toBe(true);
  });

  it('rolls back the calibration itself with enough undos (multi-level history)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175);
    await expectRow([5, 5]);

    // One undo: the data point is gone but the axes are still calibrated.
    await page.getByTestId('undo').click();
    await page.waitForTimeout(100);
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    // Another undo rolls back the runCalibration step -> no longer calibrated.
    // The card status is always present now, so read its text ("N/M set" vs
    // "Calibrated ✓") rather than counting the element.
    await page.getByTestId('undo').click();
    await page.waitForTimeout(100);
    expect(await textOf('calibrated-status')).not.toMatch(/Calibrated/);
  });

  it('undoes and redoes adding a series', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    expect(await seriesCount()).toBe(1);

    await page.getByTestId('add-series').click();
    await page.waitForTimeout(100);
    expect(await seriesCount()).toBe(2);

    await page.getByTestId('undo').click();
    await page.waitForTimeout(100);
    expect(await seriesCount()).toBe(1);

    await page.getByTestId('redo').click();
    await page.waitForTimeout(100);
    expect(await seriesCount()).toBe(2);
  });

  it('coalesces a series rename into a single undo step (blur-commit, not per keystroke)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    const nameInput = page.getByTestId('series-name'); // active series (Series 1)
    await nameInput.click();
    await nameInput.fill('Sample A'); // several characters in one edit
    await nameInput.blur(); // commit-on-blur boundary
    await page.waitForTimeout(100);
    expect(await page.getByTestId('series-name').inputValue()).toBe('Sample A');

    // A single undo restores the ORIGINAL name in one step -- not one letter.
    await page.getByTestId('undo').click();
    await page.waitForTimeout(100);
    expect(await page.getByTestId('series-name').inputValue()).toBe('Series 1');
  });

  it('undoes and redoes via the keyboard (Ctrl+Z / Ctrl+Shift+Z)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175);
    await expectRow([5, 5]);

    // The shortcut is deliberately ignored while a text input has focus, so
    // move focus to a non-input first (a bare click on the page heading).
    await page.mouse.click(4, 4);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(0);

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(100);
    await expectRow([5, 5]);
  });
});

describe('Workspace: Editable datapoints (checkpoint 39)', () => {
  it('editing an XY data value repositions the point (data derived from the moved pixel) and is undoable', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175);
    await expectRow([5, 5]);

    // Click the x value to edit it, set it to 8, commit with Enter. The data
    // reading back as (8.000, 5.000) proves the point's *pixel* moved -- the
    // data column is derived from the pixel via pixelToData, so it can only
    // read 8 if the pixel was repositioned by the inverse (dataToPixel).
    await page.getByTestId('data-value-x-0').click();
    const input = page.getByTestId('data-edit-x-0');
    await input.fill('8');
    await input.press('Enter');
    await page.waitForTimeout(100);
    await expectRow([8, 5]);

    // The edit is one undo step.
    await page.mouse.click(4, 4);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    await expectRow([5, 5]);
  });

  it('leaves non-XY datapoint values read-only (no edit affordance)', async () => {
    // Bar axes: dataToPixel is an unimplemented stub, so the table is plain
    // text with no click-to-edit spans (data-value-*).
    await resetWorkspace('bar');
    await clickAt(300, 400);
    await confirmValue('0');
    await clickAt(300, 100);
    await confirmValue('10');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);
    await clickAt(300, 250);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(1);
    expect(await page.getByTestId('data-value-x-0').count()).toBe(0);
  });
});

describe('Workspace: keyboard point nudge (checkpoint 106)', () => {
  it('arrow keys nudge the selected point (zoom-scaled), and each nudge is its own undo step', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-place-point').click();
    await clickAt(250, 175); // reads (5,5); the newest point is auto-selected
    await expectRow([5, 5]);

    const [x0, y0] = await rowValues(0);
    // ArrowRight → +px → X up (X 0..10 over px 100..400); ArrowUp → -py → Y up
    // (Y 0..10 over px 250..100, so a smaller py is a larger Y). Shift = coarse;
    // press enough to move the value clearly -- direction is what we assert, and
    // it is zoom-independent by construction.
    for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowRight');
    for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowUp');
    await page.waitForTimeout(100);
    const [x1, y1] = await rowValues(0);
    expect(x1!).toBeGreaterThan(x0!);
    expect(y1!).toBeGreaterThan(y0!);

    // Each press commits on keyup, so it is its own undo step: one Ctrl+Z steps
    // back exactly one nudge (the last ArrowUp) -- Y drops but stays above start.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    const [, y2] = await rowValues(0);
    expect(y2!).toBeLessThan(y1!);
    expect(y2!).toBeGreaterThan(y0!);
  });

  it('Del removes the selected point', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-place-point').click();
    await clickAt(250, 175); // one point, auto-selected
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(1);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(0);
  });
});

// Enter/Esc/Del as global "accept / back out / remove" keys (mouse+keyboard
// theme, David 2026-07-20). Each mirrors an on-screen button, so it is an
// accelerator, not a hidden-only path -- it must behave exactly as clicking that
// button would.
describe('Workspace: Enter / Esc / Del global keys', () => {
  it('Enter runs calibration once all four points are placed (the "Calibrate" button)', async () => {
    await resetWorkspace('xy');
    // Place the four calibration points by hand (not calibrateXYStandard, which
    // clicks the button) so Enter is the thing that actually calibrates.
    await clickAt(100, 250);
    await confirmValue('0');
    await clickAt(400, 250);
    await confirmValue('10');
    await clickAt(100, 250);
    await confirmValue('0');
    await clickAt(100, 100);
    await confirmValue('10');
    expect(await textOf('calibrated-status')).not.toMatch(/Calibrated/);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);
  });

  it('Esc clears the active point selection (so a following Del deletes nothing)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-place-point').click();
    await clickAt(250, 175); // one point, auto-selected
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(1);
    await page.keyboard.press('Escape'); // back out of the selection
    await page.waitForTimeout(50);
    await page.keyboard.press('Delete'); // nothing selected now -> no-op
    await page.waitForTimeout(100);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(1);
  });

  it('Del removes the active measurement (the on-canvas "line")', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await enterMeasureMode();
    await page.waitForTimeout(200); // let measure mode settle (documented flake)
    await clickAt(460, 300); // slope endpoint A
    await clickAt(660, 180); // slope endpoint B -> records one slope measurement
    expect(await page.locator('[data-testid^="measure-row-"]').count()).toBe(1);
    await clickAt(460, 300); // click endpoint A to select the measurement
    expect(await textOf('tips-bar')).toMatch(/Measurement point selected/i);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);
    expect(await page.locator('[data-testid^="measure-row-"]').count()).toBe(0);
  });
});

// Mouse model (David 2026-07-20): left = active tool; Ctrl+Left and middle button
// pan from any tool; a plain left-drag in a tool mode neither pans nor places;
// right-click raises a target-sensitive quick menu.
describe('Workspace: mouse model + context menu', () => {
  async function dragButton(
    fromLx: number,
    fromLy: number,
    toLx: number,
    toLy: number,
    opts: { button?: 'left' | 'middle'; ctrl?: boolean; space?: boolean } = {}
  ) {
    await refreshCanvasBox();
    if (opts.ctrl) await page.keyboard.down('Control');
    // Space-pan arms only when focus is NOT on a control (v1.0 audit fix: a focused
    // button/dropdown keeps Space as its own activation key). Selecting a tool via
    // its rail button leaves that button focused, so blur it first to reach the
    // normal working state (focus on canvas/body) where Space pans.
    if (opts.space) {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
      await page.keyboard.down('Space');
    }
    await page.mouse.move(canvasBox.x + fromLx, canvasBox.y + fromLy);
    await page.mouse.down({ button: opts.button ?? 'left' });
    await page.mouse.move(canvasBox.x + toLx, canvasBox.y + toLy, { steps: 6 });
    await page.mouse.up({ button: opts.button ?? 'left' });
    if (opts.space) await page.keyboard.up('Space');
    if (opts.ctrl) await page.keyboard.up('Control');
    await page.waitForTimeout(120);
  }

  it('Ctrl+Left pans while a tool (Place Point) is active', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-place-point').click();
    const before = await viewOffset();
    await dragButton(300, 300, 380, 360, { ctrl: true });
    const after = await viewOffset();
    expect(after).not.toEqual(before);
    // and no point was placed by the pan gesture
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(0);
  });

  it('the middle button pans while a tool is active', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-place-point').click();
    const before = await viewOffset();
    await dragButton(300, 300, 380, 360, { button: 'middle' });
    const after = await viewOffset();
    expect(after).not.toEqual(before);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(0);
  });

  it('a plain left-drag in a tool mode neither pans nor places a point', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-place-point').click();
    const before = await viewOffset();
    await dragButton(300, 300, 380, 360); // plain left, clearly a drag
    const after = await viewOffset();
    expect(after).toEqual(before); // pan moved to Ctrl+Left / middle
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(0);
  });

  it('Space+Left pans while a tool (Place Point) is active, placing no point', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-place-point').click();
    const before = await viewOffset();
    await dragButton(300, 300, 380, 360, { space: true });
    const after = await viewOffset();
    expect(after).not.toEqual(before);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(0);
  });

  it('a Space+Left drag starting on a marker pans without moving the point', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-place-point').click();
    await clickAt(250, 175); // point at (5, 5)
    await expectRow([5, 5]);
    const before = await viewOffset();
    await dragButton(250, 175, 330, 235, { space: true });
    const after = await viewOffset();
    expect(after).not.toEqual(before); // panned
    await expectRow([5, 5]); // Space+Left cancels the marker drag in favour of the pan
  });

  it('Space is not stolen from a focused text field (the reverted-bug regression)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard(); // lands in Place Point; series-name field is present
    const name = page.getByTestId('series-name');
    await name.fill('');
    await name.focus();
    await page.keyboard.type('a b'); // the space must reach the field, not arm a pan
    expect(await name.inputValue()).toBe('a b');
  });

  it('Space does NOT arm a pan while a control (a focused button) has focus (audit B1/C4)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    // Focus a real button (the Place Point rail tool) and keep it focused: Space
    // is that button's activation key, so a Space+Left drag must NOT pan.
    await page.getByTestId('mode-place-point').focus();
    const before = await viewOffset();
    await refreshCanvasBox();
    await page.keyboard.down('Space'); // no blur -- button stays focused
    await page.mouse.move(canvasBox.x + 300, canvasBox.y + 300);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 380, canvasBox.y + 360, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    await page.waitForTimeout(120);
    expect(await viewOffset()).toEqual(before); // did not pan
  });

  it('right-clicking a data point offers Delete point, which removes it', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-place-point').click();
    await clickAt(250, 175); // one point
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(1);
    await refreshCanvasBox();
    await page.mouse.click(canvasBox.x + 250, canvasBox.y + 175, { button: 'right' });
    await page.getByTestId('ctx-delete-point').waitFor({ state: 'visible' });
    await page.getByTestId('ctx-delete-point').click();
    await page.waitForTimeout(100);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(0);
  });

  it('right-clicking empty canvas offers view actions (Fit to view / Reset zoom)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await refreshCanvasBox();
    // A corner unlikely to be under a calibration handle or point.
    await page.mouse.click(canvasBox.x + 550, canvasBox.y + 60, { button: 'right' });
    await page.getByTestId('ctx-fit-view').waitFor({ state: 'visible' });
    expect(await page.getByTestId('ctx-reset-zoom').isVisible()).toBe(true);
    await page.getByTestId('ctx-reset-zoom').click();
    await page.waitForTimeout(100);
    expect(await textOf('view-state')).toMatch(/scale: 1\.000/);
  });

  it('a middle-drag starting on a marker pans the view without moving the point', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-place-point').click();
    await clickAt(250, 175); // point at (5, 5)
    await expectRow([5, 5]);
    const before = await viewOffset();
    await dragButton(250, 175, 330, 235, { button: 'middle' });
    const after = await viewOffset();
    expect(after).not.toEqual(before); // panned
    await expectRow([5, 5]); // the point did not move (middle never drags a marker)
  });

  it('a Ctrl+Left drag starting on a marker pans without moving the point', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-place-point').click();
    await clickAt(250, 175); // point at (5, 5)
    await expectRow([5, 5]);
    const before = await viewOffset();
    await dragButton(250, 175, 330, 235, { ctrl: true });
    const after = await viewOffset();
    expect(after).not.toEqual(before); // panned
    await expectRow([5, 5]); // the marker drag was cancelled in favour of the pan
  });

  it('right-clicking a data point offers Edit value, which opens its inline editor', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-place-point').click();
    await clickAt(250, 175); // point 0 at (5, 5)
    await refreshCanvasBox();
    await page.mouse.click(canvasBox.x + 250, canvasBox.y + 175, { button: 'right' });
    await page.getByTestId('ctx-edit-value').click();
    // The sidebar X cell for point 0 is now an editable input (checkpoint 39) and
    // keeps focus (the menu's focus-restore is disabled so it isn't blurred shut).
    await page.getByTestId('data-edit-x-0').waitFor({ state: 'visible' });
    expect(await page.getByTestId('data-edit-x-0').inputValue()).toMatch(/^5\.0/);
  });

  it('right-clicking a measurement offers Delete measurement', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await enterMeasureMode();
    await page.waitForTimeout(200);
    await clickAt(460, 300); // slope endpoint A
    await clickAt(660, 180); // slope endpoint B -> one measurement
    expect(await page.locator('[data-testid^="measure-row-"]').count()).toBe(1);
    await refreshCanvasBox();
    await page.mouse.click(canvasBox.x + 460, canvasBox.y + 300, { button: 'right' }); // on endpoint A
    await page.getByTestId('ctx-delete-measurement').click();
    await page.waitForTimeout(100);
    expect(await page.locator('[data-testid^="measure-row-"]').count()).toBe(0);
  });
});

// Keyboard zoom lives on the native Electron View-menu accelerators
// (CmdOrCtrl+Equal/-/0/1 -> menu:zoom-*, electron-menu.cjs, wired to the canvas in
// ImageCanvas). Those fire OS-native and are NOT reachable via Playwright/CDP key
// dispatch, so they can't be e2e'd here (v1.0 audit test-gap #1, accepted). What IS
// testable, and matters, is the renderer's rule that primary-modified keys defer to
// the menu and must NEVER fall through to the bare-digit tool shortcuts -- otherwise
// Ctrl+1 (the menu's "Actual Size") would also switch tools and Ctrl+3 would delete
// a point (audit finding C1).
describe('Workspace: primary-modified keys defer to the native menu', () => {
  it('Ctrl+3 does not delete a point and Ctrl+1 does not switch tools', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard(); // lands in Place Point
    await page.getByTestId('mode-place-point').click();
    await clickAt(250, 175); // one point
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(1);
    // Bare '3' would delete the active point; Ctrl+3 must NOT (it is the menu's).
    await page.keyboard.press('Control+3');
    await page.waitForTimeout(80);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(1);
    // Bare '1' would switch to Calibrate; Ctrl+1 (menu "Actual Size") must NOT.
    await page.keyboard.press('Control+1');
    await page.waitForTimeout(80);
    expect(await page.getByTestId('mode-place-point').getAttribute('aria-pressed')).toBe('true');
    expect(await page.getByTestId('mode-calibrate').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('Workspace: drag-and-drop / paste image (checkpoint 45)', () => {
  const sampleBase64 = () => fs.readFileSync(SAMPLE_IMAGE).toString('base64');

  it('loads an image dropped onto the canvas', async () => {
    // Deliberately not resetWorkspace() -- that opens via the native dialog;
    // this exercises the drop path from the app's fresh (no-image) state.
    expect(await page.getByTestId('zoom-controls-button').isDisabled()).toBe(true);

    const dt = await page.evaluateHandle((b64) => {
      const arr = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([arr], 'dropped.png', { type: 'image/png' });
      const data = new DataTransfer();
      data.items.add(file);
      return data;
    }, sampleBase64());
    await page.dispatchEvent('[data-testid="canvas-container"]', 'drop', { dataTransfer: dt });

    await waitForImageFitted();
    // The image loaded: the top-bar zoom control (disabled with no image) is
    // now enabled via ImageCanvas's onStatusChange.
    expect(await page.getByTestId('zoom-controls-button').isDisabled()).toBe(false);
  });

  it('loads an image pasted from the clipboard (Ctrl+V)', async () => {
    expect(await page.getByTestId('zoom-controls-button').isDisabled()).toBe(true);

    await page.evaluate((b64) => {
      const arr = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([arr], 'pasted.png', { type: 'image/png' });
      const data = new DataTransfer();
      data.items.add(file);
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    }, sampleBase64());

    await waitForImageFitted();
    expect(await page.getByTestId('zoom-controls-button').isDisabled()).toBe(false);
  });
});

describe('Workspace: categorical line (checkpoint 101)', () => {
  it('calibrates value-only, captures points, and exports Position + Value', async () => {
    await resetWorkspace('categorical');
    // Only TWO calibration clicks -- both on the VALUE (Y) axis, no X. That's the
    // whole point: "X is not numeric", so there is no X value to click.
    await clickAt(100, 250);
    await confirmValue('0');
    await clickAt(100, 100);
    await confirmValue('100');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    // Place points at different x positions (out of order).
    await clickAt(350, 200);
    await clickAt(200, 150);

    const csvPath = path.join(os.tmpdir(), `plottracer-e2e-cat-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, csvPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-csv').click();
    await page.waitForTimeout(300);
    const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
    expect(lines[0]).toMatch(/Position/);
    expect(lines[0]).toMatch(/Value/);
    expect(lines.length).toBe(3); // header + 2 points
    // Position is derived left-to-right: the px=200 point is Position 1.
    const cols = lines[0]!.split(',');
    const posCol = cols.indexOf('Position');
    const positions = lines.slice(1).map((l) => Number(l.split(',')[posCol]));
    expect(positions.sort()).toEqual([1, 2]);
    fs.unlinkSync(csvPath);
  });
});

describe('Workspace: capture figure (checkpoint 102)', () => {
  it('gates calibration on capture, then captures the framed figure', async () => {
    await resetWorkspace('xy', { capture: false }); // don't auto-capture: test the flow
    // The capture affordance is offered before calibration -- on the calibration
    // card as the "Capture figure first" prompt (v0.8: the card is the capture
    // step until captured, then becomes the calibration card).
    expect(await page.getByTestId('capture-figure').count()).toBe(1);

    // Mandatory (checkpoint 103): calibration is gated on capture. In v0.8 the
    // gate is the Calibrate tool being DISABLED pre-capture (the rail is a
    // toolbox, not a catch-all) -- a stronger, on-screen guarantee than the old
    // runtime "capture first" refusal, and the refusal path is now unreachable
    // because the only enabled pre-capture tool is Pan.
    expect(await page.getByTestId('mode-calibrate').isDisabled()).toBe(true);

    // Capture (confirm auto-accepted). The whole fitted image IS the figure, so
    // this is a no-op crop: it establishes the figure-of-record without cropping.
    await page.getByTestId('capture-figure').click();
    await page.waitForTimeout(200);
    expect(await page.getByTestId('capture-figure').count()).toBe(0); // captured -> button gone
    expect(await page.getByTestId('mode-calibrate').isDisabled()).toBe(false); // now enabled

    // Now calibration proceeds.
    await page.getByTestId('mode-calibrate').click();
    await calibrateXYStandard();
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);
  });
});

describe('Workspace: supported-format guidance (checkpoint 65)', () => {
  const sampleBase64 = () => fs.readFileSync(SAMPLE_IMAGE).toString('base64');

  it('shows a first-run empty state naming the supported formats, then hides it once an image loads', async () => {
    // Fresh no-image state: the empty-state guidance is visible and names the
    // exact formats that actually load.
    await page.getByTestId('empty-state').waitFor({ state: 'visible' });
    const text = await page.getByTestId('empty-state').textContent();
    expect(text).toMatch(/PNG, JPG, GIF, BMP, WEBP, SVG/);
    expect(await page.getByTestId('empty-state-open').isVisible()).toBe(true);

    // Dropping a real image loads it and the empty state disappears.
    const dt = await page.evaluateHandle((b64) => {
      const arr = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([arr], 'dropped.png', { type: 'image/png' });
      const data = new DataTransfer();
      data.items.add(file);
      return data;
    }, sampleBase64());
    await page.dispatchEvent('[data-testid="canvas-container"]', 'drop', { dataTransfer: dt });
    await waitForImageFitted();
    expect(await page.getByTestId('empty-state').count()).toBe(0);
  });

  it('surfaces a clear error (not a silent no-op) when an unsupported file is dropped', async () => {
    await page.getByTestId('empty-state').waitFor({ state: 'visible' });

    // A non-image, non-paged-document file (PDF and TIFF are both supported now --
    // B7). It reaches loadImageFile via the drop handler's files[0] fallback and is
    // refused by name rather than silently ignored.
    const dt = await page.evaluateHandle(() => {
      const file = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], 'notes.bin', { type: 'application/octet-stream' });
      const data = new DataTransfer();
      data.items.add(file);
      return data;
    });
    await page.dispatchEvent('[data-testid="canvas-container"]', 'drop', { dataTransfer: dt });

    await page.getByTestId('open-error').waitFor({ state: 'visible' });
    const err = await page.getByTestId('open-error').textContent();
    expect(err).toMatch(/notes\.bin/);
    expect(err).toMatch(/PlotTracer reads/); // names the supported formats (which now include TIFF)
    // The canvas stays empty (no image was loaded) and still guides the user.
    expect(await page.getByTestId('empty-state').isVisible()).toBe(true);
  });
});

describe('Workspace: Help / examples (checkpoint 46)', () => {
  it('the Help ▸ About shows the app version (asked 2026-07-19)', async () => {
    // You should be able to tell which build you are running from inside the app,
    // not just the installer. The version is injected at build time from
    // package.json (ui/vite.config.ts __APP_VERSION__).
    await page.getByTestId('help-trigger').click();
    const version = await page.getByTestId('app-version').textContent();
    expect(version).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it('the Help dropdown lists example graphs; opening one loads its image and matching graph type', async () => {
    // Fresh state (no resetWorkspace): the zoom control is disabled with no image.
    expect(await page.getByTestId('zoom-controls-button').isDisabled()).toBe(true);

    await page.getByTestId('help-trigger').click();
    await page.getByTestId('example-polar').waitFor({ state: 'visible' });
    // All bundled examples are listed (one per graph type, plus the 4-series XY,
    // the scatter, the dash-coded release curves, and the multi-page PDF). 14
    // since v0.8 added the monochrome dash-styles example (Interpolation-assist)
    // -- the others: XY, XY-multi, scatter, error-bar, histogram, bar,
    // categorical, box-plot, polar, ternary, map, CCR, multi-page PDF.
    expect(await page.locator('[data-testid^="example-"]').count()).toBe(14);

    await page.getByTestId('example-polar').click();
    await waitForImageFitted();
    // The example's image loaded (zoom now enabled) and its graph type was
    // pre-selected.
    expect(await page.getByTestId('zoom-controls-button').isDisabled()).toBe(false);
    expect(await page.getByTestId('axes-type-select').textContent()).toContain('Polar');
  });

  it('the Line (categorical X) example loads and pre-selects its type (checkpoint 107)', async () => {
    // David: the categorical type needed an example so a first-time user can see
    // what it means. Verify the new entry wires to the right graph type.
    await page.getByTestId('help-trigger').click();
    await page.getByTestId('example-categorical').waitFor({ state: 'visible' });
    await page.getByTestId('example-categorical').click();
    await waitForImageFitted();
    expect(await page.getByTestId('zoom-controls-button').isDisabled()).toBe(false);
    expect(await page.getByTestId('axes-type-select').textContent()).toContain('Line (categorical X)');
  });

  it('the multi-page PDF example opens as a PDF with the page flipper (checkpoint 114)', async () => {
    // Unlike the image examples, this one opens through the pdf.js path so the
    // user can exercise the multi-figure flow directly. The deterministic
    // "PDF opened" signal is the retained-source button (waitForImageFitted can
    // resolve on a stale image -- ckpt 104's lesson).
    await page.getByTestId('help-trigger').click();
    await page.getByTestId('example-multipage-pdf').waitFor({ state: 'visible' });
    await page.getByTestId('example-multipage-pdf').click();
    await page.getByTestId('extract-another-figure').waitFor({ state: 'visible' });
    expect(await textOf('pdf-page-label')).toMatch(/Page 1 \/ 3/); // 3 figures, one per page
    expect(await page.getByTestId('source-pdf-bundled').count()).toBe(1); // source retained
  });
});

describe('Workspace: calibration & safety UX (checkpoint 37)', () => {
  it('reusing a placed pixel pre-fills the new value with the reused point\'s value', async () => {
    await resetWorkspace('xy');
    await page.getByTestId('common-origin').uncheck(); // manual-reuse path (see note above)
    await clickAt(100, 250);
    await confirmValue('7'); // X1 = 7
    await clickAt(400, 250);
    await confirmValue('10'); // X2

    // At the Y1 step, reuse X1's pixel: the value box should default to X1's
    // own value (7), since a reused pixel is the same physical point.
    await page.getByTestId('reuse-x1').click();
    await page.locator('[data-testid="data-value-input"]').waitFor({ state: 'visible' });
    expect(await page.locator('[data-testid="data-value-input"]').inputValue()).toBe('7');
  });

  it('a data point can be dropped on the origin even though a calibration handle sits there', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard(); // X1/Y1 share the origin pixel (100,250)
    await page.getByTestId('mode-place-point').click();

    // Clicking the origin -- directly on top of the X1/Y1 handles -- must place
    // a data point (0,0), not get swallowed by the handle (handles are inert
    // outside Calibrate mode now).
    await clickAt(100, 250);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(1);
    await expectRow([0, 0]);
  });

  it('warns before discarding unsaved work when the axes type is changed', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard(); // now dirty (calibration committed)
    await page.getByTestId('mode-place-point').click();
    await clickAt(250, 175); // a data point, definitely unsaved work

    dialogMessages = [];
    await page.getByTestId('axes-type-select').click();
    await page.getByTestId('axes-option-bar').click();
    // The confirm() fired (auto-accepted by the harness), and the switch went
    // through once accepted.
    expect(dialogMessages.some((m) => /unsaved work/i.test(m))).toBe(true);
    expect(await page.getByTestId('axes-type-select').textContent()).toContain('Bar');
  });

  it('grid-removal eyedropper: shows a hint, then samples a color from the image', async () => {
    await resetWorkspace('xy');
    await page.getByTestId('grid-removal-trigger').click();
    await page.getByTestId('grid-removal-eyedropper').click();
    // Panel closes, an on-canvas hint appears. Wait for the Popover (and its
    // invisible click-capturing backdrop) to fully detach before clicking the
    // canvas, or the sampling click lands on the closing backdrop instead.
    await page.getByTestId('eyedropper-hint').waitFor({ state: 'visible' });
    await page.getByTestId('grid-removal-panel').waitFor({ state: 'detached' });

    // Clicking the image samples that pixel's color and dismisses the hint.
    await clickAt(300, 150);
    expect(await page.getByTestId('eyedropper-hint').count()).toBe(0);
    // The sampled color is now shown in the (reopened) panel's hex field.
    await page.getByTestId('grid-removal-trigger').click();
    expect(await page.getByTestId('grid-removal-color').inputValue()).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('series eyedropper: takes the series colour from the image (checkpoint 90)', async () => {
    // The user's actual want: match a series to the colour the FIGURE draws it
    // in, via the same safe on-canvas sampler as Grid Removal -- NOT the native
    // screen-picker that crashed. One mechanism, routed by target.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('series-color-button').click(); // open the colour popover
    const before = await page.getByTestId('series-color').inputValue();

    // The eyedropper closes the popover (so the sampling click lands on the
    // image, not the backdrop) and arms the sampler.
    await page.getByTestId('series-eyedropper').click();
    await page.getByTestId('eyedropper-hint').waitFor({ state: 'visible' });
    // Wait for the Popover (and its invisible click-capturing backdrop) to fully
    // detach before the sampling click, or it lands on the closing backdrop
    // instead of the image (same guard the grid-removal eyedropper test uses).
    await page.getByTestId('series-color-menu').waitFor({ state: 'detached' });
    // Sample a spot on the figure with a definite colour.
    await clickAt(300, 150);
    expect(await page.getByTestId('eyedropper-hint').count()).toBe(0);

    // Reopen the popover to read the result: the active series' colour is now
    // whatever that pixel was -- a full hex, and different from the default.
    await page.getByTestId('series-color-button').click();
    const after = await page.getByTestId('series-color').inputValue();
    expect(after).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(after).not.toBe(before);
  });

  it('the Help dropdown closes when an example is selected', async () => {
    await page.getByTestId('help-trigger').click();
    await page.getByTestId('example-xy').waitFor({ state: 'visible' });
    await page.getByTestId('example-xy').click();
    // Choosing an example both loads it and dismisses the dropdown (it used to
    // stay open, obscuring the canvas). Wait for the Popover to leave the DOM
    // (MUI keeps it briefly during the close transition).
    await page.getByTestId('help-panel').waitFor({ state: 'detached' });
    await waitForImageFitted();
  });

  it('offers the 4-series multi-series example and loads it as an XY chart', async () => {
    await page.getByTestId('help-trigger').click();
    await page.getByTestId('example-xy-multi').waitFor({ state: 'visible' });
    expect(await page.getByTestId('example-xy-multi').textContent()).toContain('Multiseries');
    await page.getByTestId('example-xy-multi').click();
    await page.getByTestId('help-panel').waitFor({ state: 'detached' });
    await waitForImageFitted();
    expect(await textOf('axes-type-select')).toContain('XY');
  });

  it('the canvas cursor is a crosshair while placing points, a grab hand only when panning', async () => {
    await resetWorkspace('xy');
    // The inline cursor lives on the Konva stage wrapper div (not the base
    // image canvas), so read it off whichever div carries a cursor style.
    const cursor = () =>
      page.evaluate(() => {
        const d = [...document.querySelectorAll('div')].find((el) =>
          /cursor:\s*(crosshair|grab|grabbing)/.test(el.getAttribute('style') || '')
        );
        return (d?.getAttribute('style')?.match(/cursor:\s*(\w+)/) || [])[1] ?? null;
      });
    await page.getByTestId('mode-calibrate').click();
    expect(await cursor()).toBe('crosshair');
    await page.getByTestId('mode-pan').click();
    expect(await cursor()).toBe('grab');
  });

  // The Measure tool (a ruler in the left rail) folds out the Measure card --
  // the image-measurement UI (Distance/Angle/Area/Slope + recorded list). Canvas
  // measuring isn't wired yet; this covers the rail-icon toggle + fold-out shell.
  describe('Measure card', () => {
    it('folds the card out from the rail ruler and toggles it closed again', async () => {
      await resetWorkspace('xy');
      // Tool 5, not gated on calibration (Set-scale works on any image).
      expect(await page.getByTestId('mode-measure').isVisible()).toBe(true);
      // Hidden until the ruler is pressed.
      expect(await page.getByTestId('measure-card').count()).toBe(0);

      await page.getByTestId('mode-measure').click();
      expect(await page.getByTestId('measure-card').isVisible()).toBe(true);
      expect(await page.getByTestId('measure-tool-slope').isVisible()).toBe(true);
      // Uncalibrated → no chart reference yet (the ref now lives in the output
      // panel's Measurements section, v1.1 step 2).
      expect(await page.getByTestId('measure-ref').textContent()).toMatch(/Pixels|set a scale/i);

      // Pressing it again closes the card (press-again-to-close toggle).
      await page.getByTestId('mode-measure').click();
      await page.getByTestId('measure-card').waitFor({ state: 'detached' });
      expect(await page.getByTestId('measure-card').count()).toBe(0);
    });

    it('measures a slope in data units after calibration and records it', async () => {
      await resetWorkspace('xy');
      // Same calibration the other XY tests use: X 100->400 px = 0->10,
      // Y 250->100 px = 0->10, so a click at local (lx,ly) maps to data
      // x=(lx-100)/30, y=(250-ly)/15.
      await calibrateXYStandard();
      await page.getByTestId('mode-measure').click();
      // Slope is the default tool. Two points: (160,220)->data (2,2) and
      // (340,130)->data (8,8), so the secant slope is exactly (8-2)/(8-2)=1.
      await clickAt(350, 250);
      await clickAt(450, 200);
      const rows = await page.locator('[data-testid^="measure-row-"]').allTextContents();
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatch(/slope\s*1\b/);
      // Deleting it empties the recorded list.
      await page.locator('[data-testid^="measure-row-"] button[title="Delete"]').click();
      expect(await page.locator('[data-testid^="measure-row-"]').count()).toBe(0);
    });

    it('a measure click snaps to a data point and never moves or deletes it (v1.1)', async () => {
      await resetWorkspace('xy');
      await calibrateXYStandard(); // lands in Place Point
      await clickAt(250, 175); // a data point at (5,5)
      const before = await page.getByTestId('point-row-0').innerText();

      await page.getByTestId('mode-measure').click();
      await page.getByTestId('measure-tool-distance').click();
      // Click ~on the data point: in Measure mode the marker is inert, so the
      // click PLACES a measurement vertex (snapped to the point) instead of being
      // eaten by the marker's own select/drag (which used to move the point).
      await clickAt(252, 177);
      await clickAt(400, 100); // second vertex -> records the distance
      await page.waitForTimeout(50);
      expect(await page.locator('[data-testid^="measure-row-"]').count()).toBe(1);

      // Back in Place Point, the data point is untouched: still one, same value.
      await page.getByTestId('mode-place-point').click();
      expect(await page.locator('[data-testid^="point-row-"]').count()).toBe(1);
      expect(await page.getByTestId('point-row-0').innerText()).toBe(before);
    });

    it('sets a px→unit scale and measures a distance in real units (no calibration needed)', async () => {
      await resetWorkspace('xy');
      await page.getByTestId('mode-measure').click();

      // Set scale: two points, declare that span is 100 mm.
      await page.getByTestId('measure-set-scale').click();
      await clickAt(350, 200);
      await clickAt(450, 200);
      await page.getByTestId('set-scale-value').fill('100');
      await page.getByTestId('set-scale-unit').fill('mm');
      await page.getByTestId('set-scale-confirm').click();

      // With the Distance tool, the ref bar reflects the scale.
      await page.getByTestId('measure-tool-distance').click();
      expect(await page.getByTestId('measure-ref').textContent()).toMatch(/Scale:\s*1 px/);

      // Measuring the SAME segment must read back exactly the declared 100 mm,
      // whatever the on-screen pixel length happens to be.
      await clickAt(350, 200);
      await clickAt(450, 200);
      const rows = await page.locator('[data-testid^="measure-row-"]').allTextContents();
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatch(/100\s*mm/);
    });

    it('measures a right angle as 90°', async () => {
      await resetWorkspace('xy');
      await page.getByTestId('mode-measure').click();
      await page.getByTestId('measure-tool-angle').click();
      // vertex, then +x arm, then -y arm → a right angle (scale-invariant).
      await clickAt(300, 300);
      await clickAt(500, 300);
      await clickAt(300, 100);
      const rows = await page.locator('[data-testid^="measure-row-"]').allTextContents();
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatch(/^90°/);
    });

    it('closes a polygon area, gated on 3+ points', async () => {
      await resetWorkspace('xy');
      await page.getByTestId('mode-measure').click();
      await page.getByTestId('measure-tool-area').click();
      await clickAt(350, 200);
      await clickAt(400, 200);
      // Two points: Finish is disabled (need at least 3).
      expect(await page.getByTestId('area-finish').isDisabled()).toBe(true);
      await clickAt(400, 400);
      expect(await page.getByTestId('area-finish').isDisabled()).toBe(false);
      await page.getByTestId('area-finish').click();
      const rows = await page.locator('[data-testid^="measure-row-"]').allTextContents();
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatch(/px²/);
    });

    it('undo/redo covers a recorded measurement (checkpoint 56)', async () => {
      await resetWorkspace('xy');
      await page.getByTestId('mode-measure').click();
      // A distance needs no calibration, so this exercises measurement undo
      // independent of the session's own calibration undo.
      await page.getByTestId('measure-set-scale').click();
      await clickAt(350, 200);
      await clickAt(450, 200);
      await page.getByTestId('set-scale-value').fill('100');
      await page.getByTestId('set-scale-confirm').click();
      await page.getByTestId('measure-tool-distance').click();
      await clickAt(350, 200);
      await clickAt(450, 200);
      expect(await page.locator('[data-testid^="measure-row-"]').count()).toBe(1);

      await page.getByTestId('undo').click();
      expect(await page.locator('[data-testid^="measure-row-"]').count()).toBe(0);
      await page.getByTestId('redo').click();
      expect(await page.locator('[data-testid^="measure-row-"]').count()).toBe(1);
    });
  });
});

describe('Workspace: active point selection + delete (checkpoint 58)', () => {
  it('clicks a data point to select it, then Del deletes just that one', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // point 1: (5, 5)
    await clickAt(300, 150); // point 2: (~6.67, ~6.67)
    await clickAt(350, 130); // point 3: (~8.33, ~8)
    expect(await page.locator('[data-testid^="point-row-"]').count()).toBe(3);

    // Click the middle marker to make it the active point, then Del deletes it.
    await clickAt(300, 150);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);

    // Only the middle point is gone -- the 1st and 3rd remain (not the last).
    const rows: number[][] = [];
    for (const r of await page.locator('[data-testid^="point-row-"]').all()) {
      const cells = await r.locator('td').allInnerTexts();
      rows.push(cells.slice(1).map((c) => c.trim()).filter(Boolean).map(Number));
    }
    expect(rows.length).toBe(2);
    expect(rows[0]![0]).toBeCloseTo(5, 2);
    expect(rows[1]![0]).toBeCloseTo(8.333, 2);
  });

  it('Del peels off the newest (auto-selected) point when nothing was clicked', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // (5, 5)
    await clickAt(400, 100); // (10, 10) -- last, auto-selected
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);
    const rows = await page.locator('[data-testid^="point-row-"]').all();
    expect(rows.length).toBe(1);
    const cells = await rows[0]!.locator('td').allInnerTexts();
    expect(cells.slice(1).map((c) => c.trim()).filter(Boolean).map(Number)).toEqual([5, 5]);
  });
});

describe('Workspace: Select tool (marquee range-select + bulk delete)', () => {
  // Places 4 data points, then drags a box around a subset in Select mode and
  // deletes them in one Del. The Select tool subsumes the old delete-active
  // button: a click selects the nearest, a drag box-selects a range, Del removes
  // the whole selection, and it NEVER selects calibration handles (David).
  async function placeFourPoints() {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    // Well clear of the calibration handles at (100,250)/(400,250)/(100,100).
    await clickAt(200, 200);
    await clickAt(250, 180);
    await clickAt(320, 300);
    await clickAt(360, 320);
    expect(await page.locator('[data-testid^="point-row-"]').count()).toBe(4);
  }

  async function marquee(fromLx: number, fromLy: number, toLx: number, toLy: number) {
    await page.mouse.move(canvasBox.x + fromLx, canvasBox.y + fromLy);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + toLx, canvasBox.y + toLy, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(50);
  }

  it('box-selects a range of points and Del removes exactly them', async () => {
    await placeFourPoints();
    await page.getByTestId('mode-select').click();

    // A box around the first two points (200,200) and (250,180) only.
    await marquee(170, 150, 285, 230);
    expect(await textOf('tips-bar')).toMatch(/2 points selected/);

    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);

    // The two bottom-right points survive; the boxed pair is gone.
    const rows: number[][] = [];
    for (const r of await page.locator('[data-testid^="point-row-"]').all()) {
      const cells = await r.locator('td').allInnerTexts();
      rows.push(cells.slice(1).map((c) => c.trim()).filter(Boolean).map(Number));
    }
    expect(rows.length).toBe(2);
  });

  it('a marquee over the whole canvas never selects calibration handles', async () => {
    await placeFourPoints();
    await page.getByTestId('mode-select').click();

    // A box spanning every data point AND all three calibration handles. If
    // handles were selectable the count would exceed 4 -- it must stay 4.
    await marquee(70, 70, 420, 340);
    expect(await textOf('tips-bar')).toMatch(/4 points selected/);
  });

  it('single-click selects the nearest point; Esc clears the selection', async () => {
    await placeFourPoints();
    await page.getByTestId('mode-select').click();

    await clickAt(200, 200);
    expect(await textOf('tips-bar')).toMatch(/1 point selected/);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    expect(await textOf('tips-bar')).toMatch(/Click a point to select it/);
  });

  it('switching the active series clears a marquee selection (no cross-series delete)', async () => {
    // Release-gate audit finding (rc.2): selectedPointIndices had no stale-clear
    // guard, so a marquee made on Series 1 survived a switch to Series 2 -- the
    // tips bar kept claiming "N selected" and Del acted on the wrong series. This
    // must FAIL without the clear in handleSelectDataset.
    await placeFourPoints(); // 4 points in Series 1
    await page.getByTestId('add-series').click(); // Series 2 (empty), now active
    await page.getByTestId('series-select').selectOption('0'); // back to Series 1

    await page.getByTestId('mode-select').click();
    await marquee(170, 150, 285, 230); // box the first two points of Series 1
    expect(await textOf('tips-bar')).toMatch(/2 points selected/);

    // Switch to the empty Series 2 -- the selection must clear, not linger.
    await page.getByTestId('series-select').selectOption('1');
    await page.waitForTimeout(50);
    expect(await textOf('tips-bar')).not.toMatch(/points selected/);

    // And a Del now can't destroy Series 1's boxed points: switch back, all 4 remain.
    await page.keyboard.press('Delete');
    await page.waitForTimeout(50);
    await page.getByTestId('series-select').selectOption('0');
    await page.waitForTimeout(50);
    expect(await page.locator('[data-testid^="point-row-"]').count()).toBe(4);
  });

  // v1.1 #6: the Select tool became a Ketcher-style multi-tool -- a first click
  // activates the current sub-mode, a second opens the fold-out picker, and
  // picking a mode folds it in + makes it active. These behaviours are
  // placement-independent (they don't depend on where the fold-out sits).
  async function lasso(loop: [number, number][]) {
    await page.mouse.move(canvasBox.x + loop[0]![0], canvasBox.y + loop[0]![1]);
    await page.mouse.down();
    for (const [x, y] of loop.slice(1)) await page.mouse.move(canvasBox.x + x, canvasBox.y + y, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(50);
  }

  it('first click activates; a second opens the fold-out; picking a mode folds in + sticks', async () => {
    await placeFourPoints();
    const selectBtn = page.getByTestId('mode-select');

    await selectBtn.click(); // first click: activate the current sub-mode, NO card
    expect(await selectBtn.getAttribute('aria-pressed')).toBe('true');
    expect(await page.getByTestId('select-foldout-card').count()).toBe(0);

    await selectBtn.click(); // second click (already active): open the picker
    expect(await page.getByTestId('select-foldout-card').isVisible()).toBe(true);

    await page.getByTestId('select-mode-lasso').click(); // pick -> folds in
    expect(await page.getByTestId('select-foldout-card').count()).toBe(0);

    // Reopening shows Lasso as the active (pressed) mode -> the swap stuck.
    await selectBtn.click();
    expect(await page.getByTestId('select-mode-lasso').getAttribute('aria-pressed')).toBe('true');
  });

  it('the Select rail button carries a fold-out arrow', async () => {
    await placeFourPoints();
    expect(await page.getByTestId('mode-select').getByTestId('foldout-arrow').count()).toBe(1);
  });

  it('lasso sub-mode selects the points inside a freeform loop', async () => {
    await placeFourPoints();
    await page.getByTestId('mode-select').click(); // activate
    await page.getByTestId('mode-select').click(); // open picker
    await page.getByTestId('select-mode-lasso').click(); // pick lasso, folds in
    expect(await page.getByTestId('select-foldout-card').count()).toBe(0);

    // A loop around the two top-left points (200,200)+(250,180) only.
    await lasso([[170, 150], [285, 150], [285, 235], [170, 235], [170, 150]]);
    expect(await textOf('tips-bar')).toMatch(/2 points selected/);
  });

  it('whole-series sub-mode selects every point of the series on one click', async () => {
    await placeFourPoints();
    await page.getByTestId('mode-select').click();
    await page.getByTestId('mode-select').click();
    await page.getByTestId('select-mode-series').click();

    await clickAt(200, 200); // click ONE point -> the whole series
    expect(await textOf('tips-bar')).toMatch(/4 points selected/);
  });
});

describe('Workspace: resizable sidebar (checkpoint 60)', () => {
  it('widens the right panel by dragging its resize handle', async () => {
    await resetWorkspace('xy');
    const sidebarWidth = () =>
      page.locator('[style*="--sidebar-width"]').evaluate((el: HTMLElement) => el.style.getPropertyValue('--sidebar-width'));
    expect(await sidebarWidth()).toBe('320px');

    const handle = await page.getByTestId('sidebar-resize').boundingBox();
    if (!handle) throw new Error('resize handle has no bounding box');
    // Drag the handle left -> the sidebar (which grows leftward) gets wider.
    await page.mouse.move(handle.x + 3, handle.y + 120);
    await page.mouse.down();
    await page.mouse.move(handle.x - 140, handle.y + 120, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    expect(parseInt(await sidebarWidth(), 10)).toBeGreaterThan(420);
  });
});

describe('Workspace: image editing (checkpoint 62)', () => {
  it('rotates the image from the fold-out card, keeping calibrated data aligned', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // a data point reading (5, 5)

    // Mirrors the Measure card: a rail icon folds out the Image card.
    await page.getByTestId('mode-image-edit').click();
    expect(await page.getByTestId('image-edit-card').isVisible()).toBe(true);

    await page.getByTestId('image-edit-rotate-cw').click();
    await page.waitForTimeout(400);
    // The point (and calibration) rotated WITH the image, so its data value is
    // unchanged -- still (5, 5).
    const cells = await page.locator('[data-testid^="point-row-"]').first().locator('td').allInnerTexts();
    const vals = cells.slice(1).map((c) => c.trim()).filter(Boolean).map(Number);
    expect(vals[0]).toBeCloseTo(5, 1);
    expect(vals[1]).toBeCloseTo(5, 1);
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    // Press-again-to-close (the Measure-card dynamic).
    await page.getByTestId('mode-image-edit').click();
    await page.getByTestId('image-edit-card').waitFor({ state: 'detached' });
    expect(await page.getByTestId('image-edit-card').count()).toBe(0);
  });

  it('crops to a dragged rectangle, keeping calibrated data aligned (checkpoint 63)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard(); // handles at (100,250),(400,250),(100,100)
    await clickAt(250, 175); // a data point reading (5, 5)

    await page.getByTestId('mode-image-edit').click();
    await page.getByTestId('image-edit-crop').click();
    // Before a drag, the bar prompts for one and Apply is disabled.
    expect(await page.getByTestId('crop-bar').isVisible()).toBe(true);
    expect(await page.getByTestId('crop-apply').isDisabled()).toBe(true);

    // Drag a crop rectangle to the right of the folded-out Image Edit card. (A
    // drag starting UNDER the card now also works -- see the next test -- but this
    // one keeps the original right-side drag.) The point's data value survives
    // regardless of whether it's inside the crop (the crop is a uniform document
    // shift), so the rectangle need not enclose it.
    await refreshCanvasBox();
    await page.mouse.move(canvasBox.x + 470, canvasBox.y + 120);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 640, canvasBox.y + 320, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    expect(await page.getByTestId('crop-bar').innerText()).toMatch(/Crop to/);
    expect(await page.getByTestId('crop-apply').isDisabled()).toBe(false);

    await page.getByTestId('crop-apply').click();
    await page.waitForTimeout(400);

    // The crop shifted the whole document uniformly, so the point's data value
    // is unchanged -- still (5, 5) -- and the axes stay calibrated.
    const cells = await page.locator('[data-testid^="point-row-"]').first().locator('td').allInnerTexts();
    const vals = cells.slice(1).map((c) => c.trim()).filter(Boolean).map(Number);
    expect(vals[0]).toBeCloseTo(5, 1);
    expect(vals[1]).toBeCloseTo(5, 1);
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);
    // The crop confirm bar clears once applied.
    expect(await page.getByTestId('crop-bar').count()).toBe(0);
  });

  it('a crop drag can START under the fold-out card (v1.0 audit fix)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-image-edit').click();
    await page.getByTestId('image-edit-crop').click();
    expect(await page.getByTestId('crop-apply').isDisabled()).toBe(true);

    // Start the drag at local x=60 -- squarely UNDER the Image Edit card (it
    // overlays the left of the canvas). While the rectangle is being drawn the
    // card passes pointer events through, so the drag reaches the Konva stage and
    // the crop arms -- which it could not before this fix.
    await refreshCanvasBox();
    await page.mouse.move(canvasBox.x + 60, canvasBox.y + 90);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 300, canvasBox.y + 320, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // The rectangle registered: Apply is now enabled (it was disabled before).
    expect(await page.getByTestId('crop-bar').innerText()).toMatch(/Crop to/);
    expect(await page.getByTestId('crop-apply').isDisabled()).toBe(false);
  });

  it('deskews via the fine-angle slider and Auto-straighten (checkpoint 64)', async () => {
    await resetWorkspace('xy');
    // A deliberately TILTED x-axis: X1 at (100,250), X2 lower at (400,280) --
    // ~5.7° down-to-the-right, so Auto-straighten has real work to do.
    await clickAt(100, 250);
    await confirmValue('0');
    await clickAt(400, 280);
    await confirmValue('10');
    await clickAt(100, 250);
    await confirmValue('0');
    await clickAt(100, 100);
    await confirmValue('10');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);

    await page.getByTestId('mode-image-edit').click();

    // The slider drives the live preview angle (read back from the readout).
    await page.getByTestId('deskew-slider').focus();
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight'); // +3.0°
    expect(await page.getByTestId('deskew-angle').innerText()).toMatch(/3\.0°/);

    // Auto-straighten reads the tilted X1->X2 handles and seeds the angle that
    // levels them (~-5.7°); it does NOT apply on its own.
    await page.getByTestId('deskew-auto').click();
    const autoDeg = parseFloat(await page.getByTestId('deskew-angle').innerText());
    expect(autoDeg).toBeLessThan(-3); // clearly negative, levelling the down-right tilt
    expect(autoDeg).toBeGreaterThan(-8);

    // Apply bakes it; the slider resets and the axes remain calibrated.
    await page.getByTestId('deskew-apply').click();
    await page.waitForTimeout(400);
    expect(await page.getByTestId('deskew-angle').innerText()).toMatch(/0\.0°/);
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    // The strong correctness property: the x-axis is now genuinely level, so a
    // second Auto-straighten computes ~0°.
    await page.getByTestId('deskew-auto').click();
    expect(parseFloat(await page.getByTestId('deskew-angle').innerText())).toBeCloseTo(0, 1);
  });

  // Deferred audit #4: image edits used to history.reset(), so a rotate/flip/
  // crop/deskew could not be undone -- the snapshot restored the points but not
  // the raster, which would have stranded them on the wrong image. The snapshot
  // now carries the baked image src, so the edit is a normal undoable step.
  async function firstPointValue(): Promise<number[]> {
    const cells = await page.locator('[data-testid^="point-row-"]').first().locator('td').allInnerTexts();
    return cells.slice(1).map((c) => c.trim()).filter(Boolean).map(Number);
  }

  it('undoes and redoes a rotate — the raster reverts with the points (audit #4)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // a data point reading (5, 5)
    const dims0 = await textOf('image-dims');

    await page.getByTestId('mode-image-edit').click();
    await page.getByTestId('image-edit-rotate-cw').click();
    await page.waitForTimeout(400);
    const dimsRotated = await textOf('image-dims');
    expect(dimsRotated).not.toBe(dims0); // a 90° rotate swaps width/height
    // The edit is now undoable (it used to history.reset the stack).
    expect(await page.getByTestId('undo').isDisabled()).toBe(false);

    // Undo: the raster reverts to its pre-rotate dimensions, and the point +
    // calibration come back with it (value unchanged -- they rotated together).
    await page.getByTestId('undo').click();
    await page.waitForTimeout(400);
    expect(await textOf('image-dims')).toBe(dims0);
    const undone = await firstPointValue();
    expect(undone[0]).toBeCloseTo(5, 1);
    expect(undone[1]).toBeCloseTo(5, 1);
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    // Redo: back to the rotated raster.
    await page.getByTestId('redo').click();
    await page.waitForTimeout(400);
    expect(await textOf('image-dims')).toBe(dimsRotated);
  });

  it('undoes a crop — the raster and its provenance both roll back (re-editable crop, audit #4)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // (5, 5)
    const dims0 = await textOf('image-dims');

    await page.getByTestId('mode-image-edit').click();
    await page.getByTestId('image-edit-crop').click();
    await refreshCanvasBox();
    // Start the drag clear of the left image-edit fold-out card (it overlaps the
    // canvas). The crop shifts the whole document uniformly, so the point's data
    // value survives whether or not the rect encloses it -- calibration shifts too.
    await page.mouse.move(canvasBox.x + 450, canvasBox.y + 90);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 780, canvasBox.y + 450, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect(await page.getByTestId('crop-bar').innerText()).toMatch(/Crop to/);
    expect(await page.getByTestId('crop-apply').isDisabled()).toBe(false);
    await page.getByTestId('crop-apply').click();
    await page.waitForTimeout(400);
    const dimsCropped = await textOf('image-dims');
    expect(dimsCropped).not.toBe(dims0);
    expect(await textOf('provenance')).toMatch(/cropped from/);

    // Undo the crop: dimensions restored, the "cropped from" provenance gone, the
    // point kept and still reading (5, 5).
    await page.getByTestId('undo').click();
    await page.waitForTimeout(400);
    expect(await textOf('image-dims')).toBe(dims0);
    if (await page.getByTestId('provenance').count()) {
      expect(await textOf('provenance')).not.toMatch(/cropped from/);
    }
    const kept = await firstPointValue();
    expect(kept[0]).toBeCloseTo(5, 1);
    expect(kept[1]).toBeCloseTo(5, 1);
  });

  it('image editing is available BEFORE capture -- prep the raw source, then capture the clean figure (David 2026-07-21)', async () => {
    await resetWorkspace('xy', { capture: false }); // image loaded, NOT yet captured
    // The Image-edit rail tool is enabled pre-capture (it used to require capture).
    expect(await page.getByTestId('mode-image-edit').isDisabled()).toBe(false);

    await page.getByTestId('mode-image-edit').click();
    expect(await page.getByTestId('image-edit-card').count()).toBe(1);
    // Auto-straighten levels off calibration handles that don't exist yet, so it
    // self-greys pre-capture (nothing to design around).
    expect(await page.getByTestId('deskew-auto').isDisabled()).toBe(true);

    // Rotate the raw 900x700 sample 90 deg -- BEFORE any capture.
    await page.getByTestId('image-edit-rotate-cw').click();
    await page.waitForTimeout(400);

    // Close the image-edit card (press-again-to-close) so the top-center capture
    // prompt is back, then Capture: the prepared (rotated) raster is what gets frozen.
    await page.getByTestId('mode-image-edit').click();
    await page.getByTestId('image-edit-card').waitFor({ state: 'detached' });
    await page.getByTestId('capture-figure').click();
    await page.waitForTimeout(200);
    expect(await page.getByTestId('capture-figure').count()).toBe(0); // captured

    // Calibrate so the data sidebar (which carries the image-dims readout) renders,
    // then confirm the captured figure carries the pre-capture rotate: the raw
    // 900x700 became 700x900 -- proof the edit hit the raster before capture and
    // survived into the figure of record.
    await page.getByTestId('mode-calibrate').click();
    await calibrateXYStandard();
    expect(await textOf('image-dims')).toBe('700×900');
  });
});

/**
 * Checkpoint 66 -- Histogram as a graph type.
 *
 * Calibration is XY's exactly (a histogram's x axis is an ordinary numeric
 * axis), so calibrateXYStandard applies unchanged and the same local->data
 * mapping holds: x = (lx-100)/30, y = (250-ly)/15. What differs is capture:
 * each bin is a tuple of the bar's two top corners, so a bin spanning local
 * x 250..400 at local y 175 is binStart 5, binEnd 10, value 5.
 */
describe('Workspace: Histogram graph type (checkpoint 66)', () => {
  // Local copies: the originals live inside another describe block's scope.
  function tempFilePath(extension: string): string {
    return path.join(os.tmpdir(), `plottracer-e2e-hist-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
  }
  async function stubSaveDialog(targetPath: string) {
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, targetPath);
  }

  /** The bin table's cells for one row, as displayed. */
  async function binRow(index: number): Promise<string[]> {
    const cells = page.locator(`[data-testid="bin-row-${index}"] td`);
    const all = (await cells.allTextContents()).map((t) => t.trim());
    // Drop the trailing per-row delete-action cell (the ✕, checkpoint 129) so
    // this stays a readout of the bin's DATA columns (#, start, end, value).
    return all.slice(0, -1);
  }

  it('offers Histogram in the graph-type dropdown, beside XY rather than hidden behind Bar', async () => {
    await resetWorkspace('xy');
    await page.getByTestId('axes-type-select').click();
    const labels = await page.locator('[data-testid^="axes-option-"]').allTextContents();
    await page.keyboard.press('Escape');
    // Adjacency is the point: Bar is the tempting-but-wrong pick for a
    // histogram (it has no numeric x at all), so the right entry has to be
    // visible right next to it -- nothing here may depend on tribal knowledge.
    // "Error Bars" is deliberately gone (checkpoint 79): it was checkpoint 70's
    // interim graph type, and error bars are rail tool 7 now, so error attaches
    // to an ordinary series after you have traced it rather than being a kind of
    // chart you must pick before you start.
    // "Line (categorical X)" (checkpoint 101) sits beside Bar: it shares Bar's
    // value-only calibration (X is a category, not a number) but plots points.
    // "Box Plot" (checkpoint 107) joins them -- also BarAxes underneath -- promoted
    // from a hidden Bar toggle to a discoverable entry (a keystone-test fix).
    expect(labels.map((l) => l.trim())).toEqual(['XY', 'Histogram', 'Bar', 'Line (categorical X)', 'Box Plot', 'Polar', 'Ternary', 'Map', 'Circular Chart Recorder']);
  });

  it('captures a bin from a bar\'s two top corners -- both edges and the height', async () => {
    await resetWorkspace('histogram');
    await calibrateXYStandard();
    await clickAt(250, 175); // top-left corner  -> x=5,  y=5
    await clickAt(400, 175); // top-right corner -> x=10, y=5
    // 1 = row number, then the derived interval and magnitude.
    expect(await binRow(0)).toEqual(['1', '5', '10', '5']);
  });

  it('is independent of click order -- the right corner first gives the same bin', async () => {
    await resetWorkspace('histogram');
    await calibrateXYStandard();
    await clickAt(400, 175); // right corner clicked FIRST
    await clickAt(250, 175);
    expect(await binRow(0)).toEqual(['1', '5', '10', '5']);
  });

  it('shows a half-captured bin as its own row with no interval invented for it', async () => {
    await resetWorkspace('histogram');
    await calibrateXYStandard();
    await clickAt(250, 175); // only one corner so far
    // Which edge a lone click is isn't known until the second corner decides
    // the ordering, so every derived cell must stay blank rather than guess.
    expect(await binRow(0)).toEqual(['1', '—', '—', '—']);
  });

  it('names its tuples "bin", not Box Plot\'s "box"', async () => {
    await resetWorkspace('histogram');
    await calibrateXYStandard();
    const tip = await textOf('tips-bar');
    expect(tip).toContain('new bin');
    expect(tip).not.toContain('box');
  });

  it('exports bins as interval + value columns, skipping a half-captured bin', async () => {
    await resetWorkspace('histogram');
    await calibrateXYStandard();
    await clickAt(250, 175);
    await clickAt(400, 175); // complete bin: 5..10 @ 5
    await clickAt(160, 220); // a lone corner -- must not reach the file

    const csvPath = tempFilePath('csv');
    await stubSaveDialog(csvPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-csv').click();
    await page.waitForTimeout(300);

    const csv = fs.readFileSync(csvPath, 'utf8');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('bin start,bin end,value');
    // Raw floats, not the table's Intl-rounded text -- a click lands
    // sub-pixel, so compare with the tolerance this file uses throughout
    // rather than asserting exact decimals (see expectRow's own note).
    const cells = lines[1]!.split(',').map(Number);
    expect(cells[0]!).toBeCloseTo(5, 2);
    expect(cells[1]!).toBeCloseTo(10, 2);
    expect(cells[2]!).toBeCloseTo(5, 2);
    // Exactly one data row: half a bin has no interval, and a blank edge
    // would read downstream as a real zero.
    expect(lines).toHaveLength(2);
    fs.unlinkSync(csvPath);
  });

  it('a saved and reopened histogram comes back a Histogram, not a plain XY chart', async () => {
    // The schema-risk test. Histogram serializes as 'XYAxes' (inventing a
    // 'HistogramAxes' string would write a file neither upstream WPD nor the
    // old wpd-core app could read), so the graph type rides in the axes
    // metadata -- and the class name alone can no longer identify it. If that
    // disambiguation regresses, this project silently reopens as XY and the
    // bins become meaningless loose points.
    await resetWorkspace('histogram');
    await calibrateXYStandard();
    await clickAt(250, 175);
    await clickAt(400, 175);

    const savePath = tempFilePath('json');
    await stubSaveDialog(savePath);
    await page.getByTestId('save-project').click();
    await page.waitForTimeout(300);

    await resetWorkspace('xy'); // deliberately land on XY before reopening
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, savePath);
    await page.getByTestId('open-project').click();
    await page.waitForTimeout(400);

    expect((await page.getByTestId('axes-type-select').textContent())?.trim()).toContain('Histogram');
    expect(await binRow(0)).toEqual(['1', '5', '10', '5']);
    fs.unlinkSync(savePath);
  });
});

/**
 * Checkpoint 68 — per-axes calibration options.
 *
 * The 2026-07-15 parity re-audit's biggest finding: WPD exposes these on its
 * calibration sidebar and we hardcoded every one to a literal across 6 of 7
 * axes types, so log axes — table stakes for scientific figures — were both
 * unreachable and undiscoverable. See CLAUDE.md.
 */
describe('Workspace: per-axes calibration options (checkpoint 68)', () => {
  it('shows XY\'s options on the calibration card, where they can be discovered', async () => {
    await resetWorkspace('xy');
    // Reachability IS the fix here: the capability existed in core/ all along.
    await expect.poll(() => page.getByTestId('calib-option-isLogX').isVisible()).toBe(true);
    await expect.poll(() => page.getByTestId('calib-option-isLogY').isVisible()).toBe(true);
    await expect.poll(() => page.getByTestId('calib-option-skipRotation').isVisible()).toBe(true);
  });

  it('reads a log Y axis correctly end to end', async () => {
    await resetWorkspace('xy');
    await page.getByTestId('calib-option-isLogY').check();
    await page.getByTestId('common-origin').uncheck();
    await clickAt(100, 250); // X1 = 0
    await confirmValue('0');
    await clickAt(400, 250); // X2 = 10
    await confirmValue('10');
    await clickAt(100, 250); // Y1 = 1   @ local y 250
    await confirmValue('1');
    await clickAt(100, 100); // Y2 = 1000 @ local y 100 -> 3 decades over 150px
    await confirmValue('1000');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);

    await clickAt(250, 200); // one decade up from Y1
    await page.waitForTimeout(200);
    // Linear would read ~334 here; a log axis reads 10.
    const row = await textOf('points-table');
    expect(row).toContain('10');
  });

  it('defaults CCR to 1 week and Map to a bottom-left origin, matching WPD', async () => {
    // Both were silent divergences: we forced 'day' and 'top-left' while WPD's
    // own controls default to week / bottom-left.
    await resetWorkspace('ccr');
    expect(await page.getByTestId('calib-option-rotationTime').inputValue()).toBe('week');
    await resetWorkspace('map');
    expect(await page.getByTestId('calib-option-origin').inputValue()).toBe('bottom-left');
  });

  it('offers every axes type its own options — none left hardcoded', async () => {
    const expected: Record<string, string[]> = {
      xy: ['isLogX', 'isLogY', 'skipRotation'],
      bar: ['isLog', 'isRotated'],
      polar: ['isDegrees', 'isClockwise', 'isLogR'],
      ternary: ['isRange100', 'isNormal'],
      map: ['origin', 'units'],
      ccr: ['rotationTime', 'rotationDirection'],
    };
    for (const [type, keys] of Object.entries(expected)) {
      await resetWorkspace(type as 'xy');
      const found = await page
        .locator('[data-testid^="calib-option-"]')
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['testid']!.replace('calib-option-', '')));
      expect(found).toEqual(keys);
    }
  });
});

/**
 * Checkpoint 70 — Error Bars restored.
 *
 * NOT a new feature: the old `npm start` app has shipped this since
 * 2026-07-06 (ui-patches/overrides.js:663-944 + api-bridge.js:169). The
 * rebuild began 2026-07-08 and never carried it across — it had no checkpoint
 * number, while its sibling Box Plot (added a day earlier, same mechanism) did.
 * Found by the third-pass parity audit on 2026-07-15. See CLAUDE.md and
 * kn-development-principles/PAIRING-PRINCIPLES.md §A1.
 *
 * Calibration is XY's, so calibrateXYStandard applies and the same mapping
 * holds: x = (lx-100)/30, y = (250-ly)/15.
 */
// Checkpoint 79. The error CAPTURE UI, and the retirement of checkpoint 70's
// interim "Error Bars" graph type.
//
// The model (docs/error-bars-design.md, David 2026-07-17) is that **recording is
// not interpretation**: an error series is a completely normal series of points,
// and the only thing recorded is its unique name plus which series it relates
// to. No error kind, no symmetric/asymmetric mode, no ±. So these tests assert
// what was RECORDED -- the series, their names, their relation, their points --
// and never a derived reading of it.
// Checkpoint 84. The calibration's implied geometry is DRAWN.
//
// We drew the handles (ckpt 59) and nothing between them, so a mis-clicked
// handle produced a wrong-but-plausible chart with nothing on screen wrong --
// the silent-bad-data failure at its purest.
//
// ⚑ These tests sample the MIDPOINT between two handles, and that specificity is
// the whole point. A first draft counted coloured pixels on the overlay and
// PASSED WITHOUT THE FIX -- because the reticles are coloured ink too, and they
// move when you drag. It was measuring the handles, not the line between them.
// The midpoint is somewhere only the preview can put ink.
describe('Workspace: calibration geometry preview (checkpoint 84)', () => {
  /** Non-transparent overlay pixels inside a canvas-local CSS box. */
  async function overlayInkIn(box: { x: number; y: number; w: number; h: number }): Promise<number> {
    return page.evaluate((b) => {
      const cs = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
      for (const c of cs) {
        // The Konva overlay is the transparent one; the base image is opaque.
        const ratio = c.width / Math.max(1, c.clientWidth);
        const probe = c.getContext('2d')!.getImageData(0, 0, Math.min(c.width, 40), Math.min(c.height, 40)).data;
        let clear = 0;
        for (let i = 3; i < probe.length; i += 4) if (probe[i]! < 10) clear++;
        if (clear < 200) continue; // opaque -> the image, not the overlay
        const d = c
          .getContext('2d')!
          .getImageData(Math.round(b.x * ratio), Math.round(b.y * ratio), Math.round(b.w * ratio), Math.round(b.h * ratio)).data;
        let ink = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i]! > 30) ink++;
        return ink;
      }
      return -1;
    }, box);
  }

  it('draws the X axis you implied — ink appears BETWEEN the handles', async () => {
    await resetWorkspace('xy');
    // A band around the midpoint of X1(100,250)..X2(400,250). No reticle reaches
    // here, so before the preview it is empty overlay.
    const mid = { x: 230, y: 242, w: 40, h: 16 };
    expect(await overlayInkIn(mid)).toBe(0);

    await clickAt(100, 250);
    await confirmValue('0');
    await clickAt(400, 250);
    await confirmValue('10');
    await page.waitForTimeout(200);

    // Progressive by design: WPD shows nothing until all four points are down;
    // this is two clicks in, with no calibration run.
    expect(await overlayInkIn(mid)).toBeGreaterThan(0);
  });

  it('follows a dragged handle — live, not baked at click time', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-calibrate').click();
    await page.waitForTimeout(150);

    // Beyond the shortened axis but well inside the original: ink here now,
    // none after X2 is dragged back to x=200.
    const beyond = { x: 300, y: 242, w: 40, h: 16 };
    expect(await overlayInkIn(beyond)).toBeGreaterThan(0);

    await dragMarker(400, 250, 200, 250);
    await page.waitForTimeout(200);
    expect(await overlayInkIn(beyond)).toBe(0);
  });
});

// Checkpoint 83. The loupe shows YOUR OWN POINTS, not just the image.
//
// Until now it took `image` and nothing else -- one drawImage of the raw raster
// -- so the app's flagship precision tool could not answer the one question it
// exists for: did the point land ON the curve? There was no e2e coverage at all,
// which is how it stayed blind for 83 checkpoints. These tests read the loupe
// canvas's real pixels rather than asserting it merely exists.
// Checkpoint 83. The loupe shows YOUR OWN POINTS, not just the image.
//
// Until now it took `image` and nothing else -- one drawImage of the raw raster
// -- so the app's flagship precision tool could not answer the one question it
// exists for: did the point land ON the curve? There was no e2e coverage at all,
// which is how it stayed blind for 83 checkpoints. These tests read the loupe
// canvas's real pixels rather than asserting it merely exists.
// Checkpoint 83. The loupe shows YOUR OWN POINTS, not just the image.
//
// Until now it took `image` and nothing else -- one drawImage of the raw raster
// -- so the app's flagship precision tool could not answer the one question it
// exists for: did the point land ON the curve? There was no e2e coverage at all,
// which is how it stayed blind for 83 checkpoints. These tests read the loupe
// canvas's real pixels rather than asserting it merely exists.
// Checkpoint 83. The loupe shows YOUR OWN POINTS, not just the image.
//
// Until now it took `image` and nothing else -- one drawImage of the raw raster
// -- so the app's flagship precision tool could not answer the one question it
// exists for: did the point land ON the curve? There was no e2e coverage at all,
// which is how it stayed blind for 83 checkpoints. These tests read the loupe
// canvas's real pixels rather than asserting it merely exists.
// Checkpoint 86. Calibration options are reachable AFTER you calibrate.
//
// They used to vanish on calibrate (`!axes` gate), so noticing Y is log after
// tracing points left only a destructive Reset -- the workflow trapped you,
// which is a tenet-1 violation ("nothing may constrain graph in -> data out").
// Checkpoint 87. Switching graph type no longer destroys the document.
//
// It rebuilt the session from scratch and history.reset() made it
// UNRECOVERABLE (there was a confirm, but no way back). And XY<->Histogram share
// an identical calibration, thrown away for a relabel. Both are tenet-1
// violations ("nothing may constrain graph in -> reliable data out").
describe('Workspace: changing graph type is non-destructive (checkpoint 87)', () => {
  async function currentType(): Promise<string> {
    return textOf('axes-type-select');
  }
  async function selectType(id: string) {
    await page.getByTestId('axes-type-select').click();
    await page.getByTestId(`axes-option-${id}`).click();
    await page.waitForTimeout(200);
  }

  it('preserves calibration switching XY -> Histogram (identical frame)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    expect(await textOf('calibrated-status')).toContain('Calibrated');

    await selectType('histogram');
    // Still calibrated -- no re-clicking four points -- and now a histogram.
    expect(await textOf('calibrated-status')).toContain('Calibrated');
    expect(await currentType()).toContain('Histogram');
  });

  it('is UNDOABLE -- Ctrl+Z brings the whole old document back', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-place-point').click();
    await clickAt(200, 200);
    await clickAt(300, 150);
    expect(await page.locator('[data-testid^="point-row-"]').count()).toBe(2);

    // Switch to an INCOMPATIBLE type -- full reset (points gone, back to Bar).
    await selectType('bar');
    expect(await currentType()).toContain('Bar');
    expect(await page.locator('[data-testid^="point-row-"]').count()).toBe(0);

    // The tenet-1 fix: this used to be unrecoverable (history.reset). Undo
    // restores the graph type AND the points AND the calibration.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    expect(await currentType()).toContain('XY');
    expect(await page.locator('[data-testid^="point-row-"]').count()).toBe(2);
  });

  it('does full reset across an incompatible frame (Bar has different clicks)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await selectType('bar');
    // Bar's calibration is 2 points vs XY's 4 -- nothing to carry, so it drops
    // to an uncalibrated Bar chart rather than pretending.
    expect(await currentType()).toContain('Bar');
    expect(await textOf('calibrated-status')).not.toContain('Calibrated');
  });
});

describe('Workspace: calibration options survive calibration (checkpoint 86)', () => {
  it('lets you switch Log Y after calibrating, WITHOUT losing your points', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    // Trace some data -- the thing you must not lose.
    await page.getByTestId('mode-place-point').click();
    await clickAt(200, 200);
    await clickAt(300, 150);
    expect(await page.locator('[data-testid^="point-row-"]').count()).toBe(2);

    // The card auto-folded on calibrate; the options are not shown while folded.
    expect(await page.getByTestId('calib-option-isLogY').count()).toBe(0);

    // Unfold and flip Log Y -- the capability that used to require a full Reset.
    await page.getByTestId('calib-fold').click();
    await page.getByTestId('calib-option-isLogY').check();
    await page.waitForTimeout(200);

    // The whole point: the option changed and every point is still here.
    expect(await page.getByTestId('calib-option-isLogY').isChecked()).toBe(true);
    expect(await page.locator('[data-testid^="point-row-"]').count()).toBe(2);
  });

  it('auto-folds the card on calibrate, keeping the figure clear', async () => {
    await resetWorkspace('xy');
    // Options ARE visible during calibration (the card starts expanded).
    expect(await page.getByTestId('calib-option-isLogY').count()).toBe(1);
    await calibrateXYStandard();
    // ...and hidden after, because the card folded -- no click-swallow.
    await page.waitForTimeout(150);
    expect(await page.getByTestId('calib-option-isLogY').count()).toBe(0);
  });

  it('re-projects values live when an option changes post-calibration', async () => {
    // Not just cosmetic: flipping Log Y must re-read the existing handles, or the
    // reported values would be stale. Engine already did this (session.setOption);
    // ckpt 86 only stopped the UI from hiding the control.
    await resetWorkspace('xy');
    // Calibrate Y over 1..1000 so linear vs log give clearly different readings.
    await clickAt(100, 250);
    await confirmValue('0');
    await clickAt(400, 250);
    await confirmValue('10');
    await clickAt(100, 250);
    await confirmValue('1');
    await clickAt(100, 100);
    await confirmValue('1000');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);

    await page.getByTestId('mode-place-point').click();
    await clickAt(250, 175); // a third of the way up from Y1
    const linear = await textOf('point-row-0');

    await page.getByTestId('calib-fold').click();
    await page.getByTestId('calib-option-isLogY').check();
    await page.waitForTimeout(200);
    const log = await textOf('point-row-0');

    // The same pixel now reads a different value -- the re-projection happened.
    expect(log).not.toBe(linear);
  });
});

describe('Workspace: the loupe shows your own points (checkpoint 83)', () => {
  /** A cheap signature of the loupe's pixels, for comparing two states. */
  async function loupeSignature(): Promise<number> {
    return page.getByTestId('zoom-loupe').locator('canvas').evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let h = 0;
      for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i]! + d[i + 1]! * 3 + d[i + 2]! * 7) | 0;
      return h;
    });
  }

  it('draws a placed point inside the magnifier', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await refreshCanvasBox();

    // Hover a little to the SIDE of where the point will go, so it lands
    // off-centre in the loupe and cannot be confused with the centre reticle
    // (a screen offset of d appears at d * MAGNIFICATION inside the loupe).
    await page.mouse.move(canvasBox.x + 258, canvasBox.y + 200);
    await page.waitForTimeout(200);
    expect(await page.getByTestId('zoom-loupe').count()).toBe(1);
    const before = await loupeSignature();

    await clickAt(250, 200); // place a point right there
    await page.mouse.move(canvasBox.x + 258, canvasBox.y + 200);
    await page.waitForTimeout(200);
    const after = await loupeSignature();

    // Colour-independent and unambiguous: the same image crop, at the same
    // cursor, must LOOK DIFFERENT once a point exists under it. Before ckpt 83
    // these were identical -- the loupe took `image` and nothing else, so it was
    // structurally blind to your own points.
    expect(after).not.toBe(before);
  });

  it('is not painting everywhere — an empty region still shows the image alone', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await refreshCanvasBox();

    // Same cursor, far from any point: placing a point elsewhere must NOT change
    // what the loupe shows here. Guards the inverse of the test above -- that
    // the overlay is composited at the RIGHT place, not smeared across the view.
    await page.mouse.move(canvasBox.x + 430, canvasBox.y + 120);
    await page.waitForTimeout(200);
    const before = await loupeSignature();

    await clickAt(250, 200); // a point far away
    await page.mouse.move(canvasBox.x + 430, canvasBox.y + 120);
    await page.waitForTimeout(200);
    expect(await loupeSignature()).toBe(before);
  });

  it('shows calibration handles too — the loupe is how you place them precisely', async () => {
    // Handles live on the same overlay layer, so they arrive for free. This is
    // why the loupe was the right fix to make first: it improves CALIBRATION
    // accuracy, not just point placement.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-calibrate').click();
    await refreshCanvasBox();
    await page.mouse.move(canvasBox.x + 108, canvasBox.y + 250);
    await page.waitForTimeout(200);
    expect(await page.getByTestId('zoom-loupe').count()).toBe(1);
    // The X1 reticle is drawn in the calibration step colour; assert the loupe
    // is not a bare image crop by checking SOMETHING saturated is in there.
    const painted = await page.getByTestId('zoom-loupe').locator('canvas').evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const max = Math.max(d[i]!, d[i + 1]!, d[i + 2]!);
        const min = Math.min(d[i]!, d[i + 1]!, d[i + 2]!);
        if (max - min > 60) n++; // saturated => not greyscale chart paper
      }
      return n;
    });
    expect(painted).toBeGreaterThan(0);
  });
});

describe('Workspace: the loupe dodges an open tool card (2026-07-20)', () => {
  // David: "overlay + dodge" -- a left fold-out card keeps floating over the
  // figure, but the loupe must hop clear of it rather than hide behind, or draw
  // over, the card you are driving. Without the avoid-rect wiring the loupe's
  // default up-offset reaches back up into a card the cursor sits just below.
  it('keeps the loupe out of the Measure card when hovering in the band below it', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await enterMeasureMode();
    await refreshCanvasBox();

    const card = await page.getByTestId('measure-card').boundingBox();
    if (!card) throw new Error('measure card not visible');

    // Hover on the canvas within the card's x-band but just BELOW the card, so
    // the loupe's up-offset would land on the card unless it dodges.
    const hoverX = card.x + 20;
    const hoverY = Math.min(card.y + card.height + 25, canvasBox.y + canvasBox.height - 25);
    await page.mouse.move(hoverX, hoverY, { steps: 3 });
    await page.waitForTimeout(200);

    expect(await page.getByTestId('zoom-loupe').count()).toBe(1);
    const loupe = await page.getByTestId('zoom-loupe').boundingBox();
    if (!loupe) throw new Error('loupe not visible');

    const overlaps =
      loupe.x < card.x + card.width &&
      loupe.x + loupe.width > card.x &&
      loupe.y < card.y + card.height &&
      loupe.y + loupe.height > card.y;
    expect(overlaps).toBe(false);
  });
});

describe('Workspace: error capture (checkpoint 79)', () => {
  it('the bundled error-bar example opens as XY, with the picker intact (C3)', async () => {
    // Finding C3, my own regression from ckpt 79: the sample still declared the
    // retired 'errorbar' type, so changeAxesType fell back to XY while the
    // dropdown's state stayed 'errorbar' -- a MUI Select with no matching item,
    // rendering BLANK. The ckpt-79 e2e missed it entirely.
    await page.getByTestId('help-trigger').click();
    await page.getByTestId('example-errorbar').click();
    await page.waitForTimeout(400);
    // The picker shows a real type, not an empty box.
    expect(await textOf('axes-type-select')).toContain('XY');
    // And the tool that the example is FOR is right there.
    expect(await page.getByTestId('mode-error-bars').count()).toBe(1);
  });

  it('is a rail tool, NOT a graph type — so you trace first and add error after', async () => {
    await resetWorkspace('xy');
    // The retirement, asserted directly: the dropdown must no longer offer it.
    // As a graph type the choice came BEFORE you started (trace an XY curve,
    // then want error, and you started over) -- problem #1 of the tuple model.
    const options = await page.locator('[data-testid="axes-type-select"] option').allTextContents();
    expect(options.join('|')).not.toMatch(/error/i);
    // Reachable instead as tool 7, visible on the rail with its shortcut badge.
    expect(await page.getByTestId('mode-error-bars').count()).toBe(1);
  });

  it('records a cap AND its mirror into two related, user-named series', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(400, 200); // one datum on Series 1
    await page.getByTestId('mode-error-bars').click();
    // Drag from the datum UP to where the figure draws the cap. The drag IS the
    // link -- nothing else declares it.
    await dragMarker(400, 200, 400, 160);
    const names = await page.locator('[data-testid="series-select"] option').allTextContents();
    // Named from what the user typed ("SD"), one series per role. The name is
    // the ONLY place meaning lives, which is why there is no errorKind field.
    expect(names.join('|')).toMatch(/SD upper/);
    expect(names.join('|')).toMatch(/SD lower/);
  });

  it('the mirrored cap is a STARTING POSITION, not a symmetry claim', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(400, 200);
    await page.getByTestId('mode-error-bars').click();
    await dragMarker(400, 200, 400, 160);
    // Move the lower cap far from where the mirror put it. Nothing may
    // re-symmetrize it or complain: an asymmetric bar is just a bar whose cap
    // you moved (David: "we do not NEED to constrain them in any way").
    const labels = await page.locator('[data-testid="series-select"] option').allTextContents();
    const lowerLabel = labels.find((l) => l.startsWith('SD lower'))!;
    await page.getByTestId('series-select').selectOption({ label: lowerLabel });
    await page.waitForTimeout(150);
    // The mirror put the lower cap at y=240 (reflected through the datum at 200).
    // Drag it far away; nothing may snap it back or object.
    await dragMarker(400, 240, 400, 285);
    const after = await page.locator('[data-testid="series-select"] option').allTextContents();
    // Still exactly one cap -- the drag MOVED it, it did not add one.
    expect(after.find((l) => l.startsWith('SD lower'))).toMatch(/\(1\)/);
  });

  it('an error series is an ORDINARY series — it appears in the spreadsheet as one', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(400, 200);
    await page.getByTestId('mode-error-bars').click();
    await dragMarker(400, 200, 400, 160);
    // No bespoke "Error bars" table, no ± column: recording, not interpretation.
    expect(await textOf('points-table')).not.toMatch(/±/);
    expect(await page.getByTestId('series-col-1').count()).toBe(1);
  });

  it('keyboard Del on a datum cascades its error bar — the fourth delete door (2026-07-22 audit)', async () => {
    // The Eraser / Select+Del / right-click doors all cascade; the Place-Point
    // keyboard Del must too, or it orphans the caps (they re-match to the wrong
    // datum and fabricate a whisker on export).
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(400, 200); // datum on Series 1
    await page.getByTestId('mode-error-bars').click();
    await dragMarker(400, 200, 400, 160); // -> SD upper (1) + SD lower (1)

    // Back on the parent series in Place Point: select the datum via its table
    // row (a canvas click here would ADD a point), then press Del.
    await page.getByTestId('series-select').selectOption({ index: 0 });
    await page.getByTestId('mode-place-point').click();
    await page.getByTestId('point-row-0').click();
    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);

    // The datum AND both caps are gone — no half-bar left behind.
    const names = await page.locator('[data-testid="series-select"] option').allTextContents();
    expect(names.find((l) => l.startsWith('SD upper'))).toMatch(/\(0\)/);
    expect(names.find((l) => l.startsWith('SD lower'))).toMatch(/\(0\)/);
  });

  it('refuses to hang a cap on nothing — a press off-datum pans instead', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(400, 200);
    await page.getByTestId('mode-error-bars').click();
    // Press far from any datum: no snap, so no link drag and no series created.
    await dragMarker(420, 120, 420, 90);
    const names = await page.locator('[data-testid="series-select"] option').allTextContents();
    expect(names.join('|')).not.toMatch(/SD/);
  });

  it('is greyed until a series has points to attach error to (v0.8, David)', async () => {
    // Error bars are a property of a point: with nothing traced there is nothing
    // to attach error to, so the rail tool is disabled rather than clickable-
    // with-a-hint. A greyed tool that only wakes once there's data states its
    // precondition without a mystery -- the button's own state is the message.
    await resetWorkspace('xy');
    // Uncalibrated, no points -> disabled.
    expect(await page.getByTestId('mode-error-bars').isDisabled()).toBe(true);
    await calibrateXYStandard();
    // Calibrated but still no data point -> still disabled.
    expect(await page.getByTestId('mode-error-bars').isDisabled()).toBe(true);
    // Place one point -> now there's a series to attach error to.
    await clickAt(400, 200);
    expect(await page.getByTestId('mode-error-bars').isDisabled()).toBe(false);
    await page.getByTestId('mode-error-bars').click();
    expect(await page.getByTestId('mode-error-bars').getAttribute('aria-pressed')).toBe('true');
  });

  it('names are derived visibly — "SD" becomes "SD upper"/"SD lower" before you drag', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(400, 200);
    await page.getByTestId('mode-error-bars').click();
    await page.getByTestId('error-base-name').fill('95% CI');
    expect(await textOf('error-name-hint')).toMatch(/95% CI upper/);
    expect(await textOf('error-name-hint')).toMatch(/95% CI lower/);
  });
});

/**
 * Checkpoint 71 — "Reset calibration" is honest and undoable.
 *
 * Found by the fourth-pass audit of WPD's controller layer, which enumerated
 * every *refusal* WPD performs. The input-validation half of that seam was
 * recovered at checkpoint 69; this is the other half — WPD's
 * destructive-action confirmations (`okCancelPopup` appears 4x in its
 * controllers; the new app had exactly one `window.confirm` anywhere).
 *
 * The bug: the button says "Reset calibration" but discarded every series,
 * point and measurement — verified at 250 points across 2 series -> 0 — while
 * `history.reset()` emptied the undo stack so none of it came back, and
 * `markClean()` disarmed the unsaved-work guard too. Both safety nets down, no
 * dialog, and a label that actively promises the data is safe.
 */
describe('Workspace: Reset calibration is honest and undoable (checkpoint 71)', () => {
  it('warns before discarding traced data — naming what is actually lost', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(400, 175);
    dialogMessages.length = 0;
    await page.getByTestId('reset-calibration').click();
    await page.waitForTimeout(200);
    // The label says "calibration"; the dialog must say what really goes.
    expect(dialogMessages.join(' ')).toMatch(/clear every data point/i);
  });

  it('does NOT nag when there is nothing to lose', async () => {
    await resetWorkspace('xy');
    await clickAt(100, 250); // a lone calibration handle, no data
    await confirmValue('0');
    dialogMessages.length = 0;
    await page.getByTestId('reset-calibration').click();
    await page.waitForTimeout(200);
    // A dialog on a free action is noise the user learns to dismiss — which is
    // exactly how a real warning gets ignored later.
    expect(dialogMessages).toEqual([]);
  });

  it('confirms before "Clear all points" wipes a series, and is undoable', async () => {
    // Audit follow-up: Clear-all-points and Delete-series wiped a whole series
    // with no dialog while Reset/Remove-figure confirmed. Now all four confirm,
    // gated on there being something to lose (same as Reset above).
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(400, 175);
    dialogMessages.length = 0;
    await page.getByTestId('clear-points').click();
    await page.waitForTimeout(200);
    expect(dialogMessages.join(' ')).toMatch(/every point in the active series/i);
    // The dialog is auto-accepted (as a user clicking Ok), so the point is gone.
    expect(await page.locator('[data-testid^="point-row-"]').count()).toBe(0);
  });

  it('is undoable — Ctrl+Z brings the data back', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(400, 175); // (5, 5)
    await clickAt(400, 100); // (10, 10)
    expect(await page.locator('[data-testid^="point-row-"]').count()).toBe(2);

    await page.getByTestId('reset-calibration').click(); // dialog auto-accepted
    await page.waitForTimeout(250);
    expect(await page.locator('[data-testid^="point-row-"]').count()).toBe(0);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    // The whole point: history.reset() used to make this unrecoverable.
    expect(await page.locator('[data-testid^="point-row-"]').count()).toBe(2);
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);
  });
});

/**
 * Checkpoint 73 — capability gates, not identity gates.
 *
 * Found by the fourth-pass audit of our OWN new code: Histogram and Error Bars
 * build a real XYAxes with identical steps and a working dataToPixel, but six
 * sites tested `config.id === 'xy'` — the config's NAME rather than the axes'
 * CAPABILITY. So those charts silently lost Curve Fit, slope measurement,
 * auto-straighten and click-to-edit, and were told "Calibrate an XY chart
 * first" on a chart the user had just calibrated as XY.
 */
describe('Workspace: capability gates (checkpoint 73)', () => {
  // Checkpoint 73's headline test ("offers Curve Fit on an Error Bars chart,
  // fitting the Values only — n = 3 points from 9 placed") is GONE, deliberately,
  // and it is worth saying why rather than leaving a hole.
  //
  // It proved that getFitPoints' group-skipping branch (written at ckpt 27,
  // unreachable until 73) was finally live. Checkpoint 79 retires the "Error
  // Bars" graph type, which was the only config that was XY-backed AND grouped
  // AND curve-fittable — so that branch is unreachable again. **That is correct,
  // not a regression:** the branch only ever existed to skip Upper/Lower groups
  // in the tuple model, and under the error model an error series is an ordinary
  // ungrouped series, so there is nothing to skip. Curve Fit through a series
  // that has error is now just Curve Fit through an XY series, covered by the
  // ckpt 27 tests. The surviving grouped type (Box Plot, on Bar) does not offer
  // Curve Fit at all. Logged for the audit rather than fixed here: getFitPoints'
  // group-skipping is now dead code.
  it('does NOT offer Curve Fit on a Histogram — fitting bin corners is meaningless', async () => {
    await resetWorkspace('histogram');
    await calibrateXYStandard();
    // Group 0 is "Bin start", so a fit would run through bin corners.
    expect(await page.getByTestId('curve-fit-trigger').count()).toBe(0);
  });

  it('keeps Geometry XY-only — it rejects grouped datasets outright', async () => {
    // A capability check here would be worse UX: the panel would open and could
    // only ever print an error (engine/geometryPanel.ts:28).
    // Vehicle changed to Histogram at ckpt 79 (was the retired Error Bars type):
    // it is the surviving XY-backed GROUPED config, which is what this asserts.
    await resetWorkspace('histogram');
    await calibrateXYStandard();
    expect(await page.getByTestId('geometry-trigger').count()).toBe(0);
    await resetWorkspace('xy');
    await calibrateXYStandard();
    expect(await page.getByTestId('geometry-trigger').count()).toBe(1);
  });

  it('measures a slope on a Histogram instead of demanding an XY chart', async () => {
    // Vehicle changed to Histogram at ckpt 79 (was the retired Error Bars type).
    // The gate under test is unchanged and still load-bearing: `axesKind === 'xy'`
    // rather than `config.id === 'xy'`, so a chart that IS XY underneath but is
    // not NAMED xy keeps its capabilities.
    await resetWorkspace('histogram');
    await calibrateXYStandard();
    await enterMeasureMode();
    await clickAt(350, 250);
    await clickAt(450, 200);
    await page.waitForTimeout(200);
    // Slope needs only pixelToData, which this chart has -- so the Slope tool is
    // offered (icon-only strip now, v1.1 step 2; no label text to match).
    expect(await page.getByTestId('measure-tool-slope').isVisible()).toBe(true);
  });
});

// Checkpoint 75. Series names stop being cosmetic here: the error-capture model
// (docs/error-bars-design.md) relates one series to another BY NAME, so a
// duplicate is an ambiguous relationship rather than an untidy column header.
describe('series names are unique (checkpoint 75)', () => {
  // Local, matching this file's established idiom (the checkpoint 25/66/70
  // blocks each keep their own pair rather than sharing a hoisted one).
  function tempFilePathNames(extension: string): string {
    return path.join(os.tmpdir(), `plottracer-e2e-names-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
  }
  async function stubSaveDialogNames(targetPath: string) {
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, targetPath);
  }

  it('adding a series after renaming onto its number no longer collides', async () => {
    // The live bug this checkpoint found, driven through the real UI: rename
    // "Series 1" to "Series 2", press Add, and both were called "Series 2".
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('series-name').fill('Series 2');
    await page.getByTestId('series-name').blur();
    await page.getByTestId('add-series').click();
    await page.waitForTimeout(100);
    expect(await page.getByTestId('series-name').inputValue()).toBe('Series 3');
  });

  it('refuses a duplicate name, says why, and keeps the previous one', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('series-name').fill('Control');
    await page.getByTestId('series-name').blur();
    await page.getByTestId('add-series').click();
    await page.waitForTimeout(100);
    await page.getByTestId('series-name').fill('Control');
    await page.getByTestId('series-name').blur();
    await page.waitForTimeout(100);

    expect(await textOf('series-name-error')).toMatch(/already exists/i);
    // The name it had before the rejected edit, not the duplicate.
    expect(await page.getByTestId('series-name').inputValue()).toBe('Series 2');
  });

  it('shows the reason live, at the keystroke that causes it', async () => {
    // The point of the draft: you find out while typing, not after looking away.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('series-name').fill('Control');
    await page.getByTestId('series-name').blur();
    await page.getByTestId('add-series').click();
    await page.waitForTimeout(100);
    await page.getByTestId('series-name').fill('Control'); // no blur
    await page.waitForTimeout(100);
    expect(await textOf('series-name-error')).toMatch(/already exists/i);
  });

  it('refuses a blank name', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('series-name').fill('   ');
    await page.getByTestId('series-name').blur();
    await page.waitForTimeout(100);
    expect(await textOf('series-name-error')).toMatch(/needs a name/i);
    expect(await page.getByTestId('series-name').inputValue()).toBe('Series 1');
  });

  it('still accepts an ordinary rename, and exports it as the column header', async () => {
    // The guard must not break the thing it guards: the name is where meaning
    // lives (a series called "SD" IS the error kind), so it has to reach the file.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('series-name').fill('Sample A');
    await page.getByTestId('series-name').blur();
    await clickAt(250, 175);
    await page.waitForTimeout(100);

    await page.getByTestId('export-scope-all').click();
    const csvPath = tempFilePathNames('csv');
    await stubSaveDialogNames(csvPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-csv').click();
    await page.waitForTimeout(300);
    expect(fs.readFileSync(csvPath, 'utf8')).toContain('Sample A');
    fs.unlinkSync(csvPath);
  });
});
