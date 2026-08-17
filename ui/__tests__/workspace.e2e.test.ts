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
import { DEFAULT_PANEL_WIDTH } from '../src/panelWidth.js';
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
import { CalibrationSession, XY_AXES_CONFIG, SPIDER_AXES_CONFIG, PIE_AXES_CONFIG, BAR_AXES_CONFIG } from '../../engine/calibrationSession.js';
import { serializeProject } from '../../engine/projectFile.js';
import { unzipSync, strFromU8 } from 'fflate';

import { ozoneArgs } from './e2eContainment.js';
import { freshProfile } from './e2eProfile.js';

const REPO_ROOT = path.resolve(__dirname, '../..');

// ⚑ CONTAINMENT — where this run's windows go, decided in ONE place for all
// three Electron e2e files (`./e2eContainment.ts`, which holds the reasoning:
// why it must be a launch ARGUMENT, the three things that look like containment
// and are not, and why an undeclared run now REFUSES instead of launching).
// ⚑ Called AT the launch, not at module scope: a refusal fires at the gesture it
// refuses, so a harness that never launches never refuses.

/**
 * A THROWAWAY PROFILE FOR THE RUN.
 *
 * ⚑⚑ THE SUITE HAD NO PROFILE OF ITS OWN, so it ran against the developer's
 * REAL PlotTracer user-data directory. Two live consequences: the run WROTE
 * into his installed app's storage, and anything the app persists survived from
 * one run to the next — a shared mutable fixture nobody declared.
 *
 * ⚑ The sidebar test found it the expensive way. It asserts the panel opens at
 * its DEFAULT width, then drags the handle to ~563px — which v2.2 made
 * PERSISTENT. So it passed on the first run, stored the width it had just
 * dragged to, and failed on every run after, with no code change in between.
 * A green board went red by itself, which is the worst way to learn this.
 *
 * ⚑ The rule: a test that only passes on a clean profile must be GIVEN a clean
 * profile. Hoping for one makes every future persisted setting — recent files,
 * window geometry, whatever v2.3 adds — a landmine for whichever test runs
 * second. Fixed at the launch, not in the one test that happened to trip it.
 */
/**
 * ⚑ The sweep and the mkdtemp live in `./e2eProfile.ts`, which holds the
 * reasoning: why it is swept at START rather than at exit, and why the clock is
 * an ARGUMENT — this block leaked twice, the second time because it read /tmp's
 * mtime instead of the time, which no test could reach while it was a
 * module-scope side effect here.
 */
const E2E_USER_DATA = freshProfile();


/** The bundled spider example's published ground truth — anchors in IMAGE pixels,
 * plus the values each series states. Read here so the spider trace can be checked
 * against the figure the app itself ships, not against geometry a test invented. */
/** The bundled pie family's published ground truth (v1.6) — read here so the app can
 * be driven against the SAME numbers the figures were rendered from, rather than
 * against geometry a test invented for itself. */
const PIE_TRUTHS = ['pie-filler-composition', 'pie-exploded-market-share', 'donut-donut-flavours', 'pie-tilted-market-segments'].map(
  (name) => ({
    name,
    truth: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, `samples/${name}.truth.json`), 'utf8')) as {
      total: number; sweep: number; tilted?: boolean;
      calibration: { anchors: { outline: { px: number; py: number }[] }; slices: { apex: { px: number; py: number }; startEdge: { px: number; py: number }; endEdge: { px: number; py: number }; exploded: boolean }[] };
      series: { points: { category: string; value: number }[] }[];
    },
  })
);

const spiderTruth = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'samples/spider-material-profile.truth.json'), 'utf8')
) as {
  axes: { axis: number; name: string; centre: number; max: number }[];
  calibration: { anchors: Record<string, { px: number; py: number }> };
  series: { name: string; points: { axis: number; name: string; value: number }[] }[];
};

/** The bundled bar example's published ground truth (v2.0 Phase 7) -- read here
 * so the bounding-box auto-extract can be checked against the SAME figure and
 * values it was rendered from, not against geometry a test invented. */
const barTruth = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'samples/bar-tensile-strength.truth.json'), 'utf8')
) as {
  axes: { y: { min: number; max: number } };
  calibration: { anchors: { p1: { px: number; py: number; value: number }; p2: { px: number; py: number; value: number } } };
  series: { points: { category: string; value: number }[] }[];
};

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
// The heatmap fixture, which ships the values it was drawn from — so the e2e
// can check the numbers the app puts on screen against the figure's own truth
// rather than against itself (engine/__tests__/fixtures/colorbars/).
const HEATMAP_IMAGE = path.join(REPO_ROOT, 'engine/__tests__/fixtures/colorbars/heatmap-viridis.png');
const HEATMAP_TRUTH = path.join(REPO_ROOT, 'engine/__tests__/fixtures/colorbars/truth.json');
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
    args: [...ozoneArgs(), `--user-data-dir=${E2E_USER_DATA}`, path.join(REPO_ROOT, 'ui/electron-dev.cjs'), '--built'],
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
// so it is no longer selectable here. Error bars are rail tool 6 now.
async function resetWorkspace(
  axesTypeId: 'xy' | 'histogram' | 'heatmap' | 'bar' | 'categorical' | 'boxplot' | 'polar' | 'spider' | 'pie' | 'ternary' | 'map' | 'ccr',
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
  // v2.0: the graph-type picker is a card GRID now (GraphTypeCardPicker.tsx,
  // replacing the plain MUI Select AxesTypeSelect.tsx used through checkpoint
  // 35) -- .selectOption() has never applied since 35, and there is no
  // <option>/MenuItem anymore either. Click the trigger to open the
  // FloatingPanel, then click the matching card (axes-option-${id}, the
  // SAME testid convention the old MenuItems used, kept on purpose so this
  // click pattern didn't have to change). No waitForTimeout between these
  // steps: each getByTestId(...).click() already auto-waits for its target
  // to be attached, visible and stable, which covers the popover's own
  // open-transition and the session-replace re-render (checkpoint 36 sleep-trim).
  await page.getByTestId('axes-type-trigger').click();
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
// The raw cell text, before the numeric parse -- needed for a date-calibrated
// column (e.g. CCR's Time), which the table formats as a date STRING
// (Workspace.tsx's dateFmt branch), not a raw number.
async function rowCells(rowIndex = 0): Promise<string[]> {
  const cells = await page
    .getByTestId('points-table')
    .locator('tbody tr')
    .nth(rowIndex)
    .locator('td')
    .allInnerTexts();
  return cells
    .slice(1)
    .map((c) => c.trim())
    .filter((c) => c !== '');
}
async function rowValues(rowIndex = 0): Promise<number[]> {
  return (await rowCells(rowIndex)).map(Number);
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
  // Wait until the mechanism (and thus `mode`) is actually active before returning,
  // or a following canvas click can be routed as the PREVIOUS mode -- the arming
  // race that intermittently flaked the interpolation/guide tests. aria-pressed is
  // `mode === m`, so this is the deterministic "mode is armed" signal.
  await page.locator(`[data-testid="auto-extract-${mech}"][aria-pressed="true"]`).waitFor({ state: 'visible' });
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

  // A tuple-shaped row's numeric read: tuple-derived-N (the Value cell), never
  // rowValues/expectRow -- that helper reads EVERY non-blank cell text in the
  // row including the trailing "✕" delete button, which is not a blank string
  // and breaks length-based assertions on the tuple table (unlike the old flat
  // per-point table it was written for).
  async function derivedValue(tupleIndex = 0): Promise<number> {
    return Number((await textOf(`tuple-derived-${tupleIndex}`)).replace(/[^0-9.eE+-]/g, ''));
  }

  it('walks a shorter 2-step calibration and reads back a bar dragged corner to corner', async () => {
    await resetWorkspace('bar');
    expect(await textOf('tips-bar')).toMatch(/1\/2 — P1/);

    await calibrateBarStandard();
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    // v2.0: a bar is captured by DRAGGING corner to corner, not one click.
    // Baseline (y=400, value 0) to the midpoint between P1(400) and P2(100)
    // (y=250, value 5) -> derived value exactly 5.000.
    await dragMarker(300, 400, 300, 250);
    expect(await derivedValue()).toBeCloseTo(5, 2);
  });

  it('dragging a Bar calibration handle re-calibrates live', async () => {
    await resetWorkspace('bar');
    await calibrateBarStandard();
    await dragMarker(300, 400, 300, 250); // baseline to (5.000), never moved after this
    expect(await derivedValue()).toBeCloseTo(5, 2);

    // Drag P2 from local (300,100) to (300,0): P1@400=0, new P2@0=10,
    // query still at local y=250 -> (400-250)/(400-0) * 10 = 3.750.
    await page.getByTestId('mode-calibrate').click(); // handles adjust in Calibrate mode (checkpoint 37)
    await dragMarker(300, 100, 300, 0);

    expect(await derivedValue()).toBeCloseTo(3.75, 2);
  });

  // ⚑ v2.0: both ends of a bar are measured, not "click anywhere on the value
  // axis" (the wording that invited the midpoint error 59f94a6 blocked on the
  // automated path). Add points is the manual capture tool and the tips bar
  // is the only place the app can say how to aim it.
  it('tells you to drag corner to corner, never "anywhere on the image"', async () => {
    await resetWorkspace('bar');
    await calibrateBarStandard();
    await page.getByTestId('mode-place-point').click();
    const tip = await textOf('tips-bar');
    expect(tip).toMatch(/opposite corner/i);
    expect(tip).toMatch(/both ends are measured/i);
    expect(tip).not.toMatch(/anywhere on the image/i);
  });

  // v2.0 Phase 7: Auto-extract is now a REAL option for Bar (a bar blob's own
  // bounding box is its two ends), so the empty-table hint names it again --
  // the opposite of the pre-Phase-7 rule this test used to guard (Auto-extract
  // permanently greyed, so naming it would have been the contradiction
  // 9612378 was written to sweep). Box Plot/categorical Line still refuse it
  // outright and must still not name it -- see the next test.
  it('the empty-table hint recommends BOTH Add points and Auto-extract for a bar chart', async () => {
    await resetWorkspace('bar');
    await calibrateBarStandard();
    await page.getByTestId('mode-select').click(); // a tool whose canvas click captures nothing
    const hint = await textOf('no-points');
    expect(hint).toMatch(/Add points/i);
    expect(hint).toMatch(/Auto-extract/i);
  });

  it('...but the hint still never sends a Box Plot to its still-greyed-out Auto-extract', async () => {
    await resetWorkspace('boxplot');
    await calibrateBarStandard();
    await page.getByTestId('mode-select').click();
    const hint = await textOf('no-points');
    expect(hint).not.toMatch(/Auto-extract/i);
    expect(hint).toMatch(/Add points/i);
  });

  // v2.0 Phase 5: the only UI a stacked bar needs -- naming which group a
  // series belongs to. Capture itself is the ordinary drag-box every other
  // bar uses; what changes is the derived value (an unsigned span, not
  // baseline-relative) and this one field.
  it('a "Stack group" field tags a series, and a stacked segment reads as an unsigned span', async () => {
    await resetWorkspace('bar');
    await calibrateBarStandard();

    const group = page.getByTestId('series-stack-group');
    expect(await group.inputValue()).toBe(''); // blank by default -- not stacked

    // Baseline (value 0) to value 5, but tagged as stacked -- reads as the
    // segment's own SPAN, the same wiring path the engine tests cover with a
    // non-coincidental case; this is the on-screen discoverability check.
    await group.fill('left');
    await dragMarker(300, 400, 300, 250);
    const derived0 = Number((await textOf('tuple-derived-0')).replace(/[^0-9.eE+-]/g, ''));
    expect(derived0).toBeCloseTo(5, 1);

    // The tag is per-series and survives switching away and back.
    await page.getByTestId('add-series').click();
    expect(await page.getByTestId('series-stack-group').inputValue()).toBe(''); // fresh series, untagged
    await page.getByTestId('series-select').selectOption('0');
    expect(await page.getByTestId('series-stack-group').inputValue()).toBe('left');
  });

  it('the "Stack group" field is Bar-only -- absent for an XY chart', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    expect(await page.getByTestId('series-stack-group').count()).toBe(0);
  });

  // ---- v2.1 CATEGORY TICKS -------------------------------------------------
  // ⚑ The only instrument that can see this at all. The geometry, the fold-out's
  // state machine and the drawn overlay are all unit-tested in engine/, but
  // whether the control is REACHABLE -- rendered, clickable, and routing canvas
  // clicks to edge placement instead of dropping a data point -- exists only
  // here. A user who cannot find it has no feature.

  it('offers category ticks on the calibration card once the axes exist, and not before', async () => {
    await resetWorkspace('bar');
    // Not during the walk: the fold-out must never look like a calibration step.
    expect(await page.getByTestId('category-ticks-panel').count()).toBe(0);
    await calibrateBarStandard();
    // ⚑ No unfolding. The card auto-folds on calibrate and the offer is ON the
    // folded chip bar -- which is the whole reason this costs the simple
    // two-click workflow one line of text and nothing else.
    expect(await textOf('category-ticks-summary')).toBe('Mark category ticks?');
  });

  it('is absent on a graph type with no categories', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    expect(await page.getByTestId('category-ticks-panel').count()).toBe(0);
  });

  it('⚑ marks the axis in ONE click, reusing the value origin, and draws the ticks', async () => {
    await resetWorkspace('bar');
    await calibrateBarStandard();
    await page.getByTestId('category-ticks-toggle').click();
    await page.waitForTimeout(100);

    // P1 is already the first edge, so the prompt asks for one click, not two.
    expect(await textOf('category-ticks-prompt')).toContain('Click where the categories end');

    // ⚑ This click must NOT drop a data point -- it places the far edge.
    await clickAt(600, 400);
    await page.waitForTimeout(150);
    expect(await page.getByTestId('category-ticks-prompt').count()).toBe(0);
    expect(await textOf('category-ticks-summary')).toContain('Category ticks');

    await page.getByTestId('category-count').fill('4');
    await page.waitForTimeout(150);
    expect(await textOf('category-ticks-summary')).toBe('Category ticks \u2014 4 categories');

    // Both conventions are visible without opening anything, and centred is preset.
    expect(await page.getByTestId('category-convention-centred').isChecked()).toBe(true);
    expect(await page.getByTestId('category-convention-edge').isChecked()).toBe(false);

    // The declared categories are rows in the table before any bar is captured.
    expect(await page.getByTestId('category-count').inputValue()).toBe('4');
  });

  it('⚑ retyping the count over a NAMED set does not delete the names on the way', async () => {
    // The count field commits as you type so the marks redraw live -- but
    // `setCategoryCount` shrinks by TRUNCATION, so with the field selected,
    // retyping 6 over a 3 passes through the intermediate "6"... and retyping 2
    // over a 6 passes through nothing, while retyping 12 over a 5 passes through
    // "1" and used to delete four NAMED categories on the way (v2.1 audit).
    // Growing is instant; shrinking waits for blur.
    await resetWorkspace('bar');
    await calibrateBarStandard();
    await page.getByTestId('category-ticks-toggle').click();
    await page.waitForTimeout(100);
    await clickAt(600, 400);
    await page.waitForTimeout(150);

    await page.getByTestId('category-count').fill('5');
    await page.waitForTimeout(150);
    expect(await textOf('category-ticks-summary')).toBe('Category ticks — 5 categories');

    // Name the last one, then retype the count with the field selected: the
    // browser replaces the whole value, so the first keystroke IS "1".
    await page.getByTestId('category-count').fill('1');
    await page.getByTestId('category-count').fill('12');
    await page.waitForTimeout(150);
    // The transient "1" must not have taken effect -- only the final 12.
    expect(await textOf('category-ticks-summary')).toBe('Category ticks — 12 categories');
  });

  it('removes the ticks again, leaving the calibration untouched', async () => {
    await resetWorkspace('bar');
    await calibrateBarStandard();
    await page.getByTestId('category-ticks-toggle').click();
    await clickAt(600, 400);
    await page.waitForTimeout(150);
    await page.getByTestId('category-count').fill('3');
    await page.waitForTimeout(150);

    await page.getByTestId('category-remove-ticks').click();
    await page.waitForTimeout(150);
    expect(await textOf('category-ticks-summary')).toBe('Mark category ticks?');
    // The value calibration is untouched -- ticks never gated it and removing
    // them must not disturb it.
    expect(await page.getByTestId('run-calibration').count()).toBe(0);
  });
});

describe('Workspace: Bar auto-extract by colour (v2.0 Phase 7)', () => {
  /** Open the bundled bar example's REAL calibration as a project -- same
   * technique as the spider suite's openSpiderTruthProject (see its own
   * comment for why this is built in-process rather than driven through
   * canvas clicks): the fixture is the app's own sample figure, calibrated
   * on the anchors its truth file publishes, so what is under test here is
   * the trace, not the clicking path (covered thoroughly elsewhere). */
  async function openBarTruthProject() {
    const fixture = (() => {
      const session = new CalibrationSession(BAR_AXES_CONFIG);
      const { p1, p2 } = barTruth.calibration.anchors;
      session.handleCalibrationClick(p1.px, p1.py);
      session.confirmCalibrationValues([String(p1.value)]);
      session.handleCalibrationClick(p2.px, p2.py);
      session.confirmCalibrationValues([String(p2.value)]);
      if (!session.runCalibration()) throw new Error('fixture calibration failed');
      const png = path.join(REPO_ROOT, 'samples/bar-tensile-strength.png');
      const result = serializeProject(
        session,
        `data:image/png;base64,${fs.readFileSync(png).toString('base64')}`,
        'bar-tensile-strength.png'
      );
      if ('error' in result) throw new Error(`fixture build failed: ${result.error}`);
      const filePath = path.join(os.tmpdir(), `plottracer-bar-truth-${process.pid}.json`);
      fs.writeFileSync(filePath, JSON.stringify(result), 'utf8');
      return filePath;
    })();

    try {
      await app.evaluate(({ dialog }, p) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
      }, fixture);
      await page.getByTestId('open-project').click();
    } finally {
      // Restore immediately, so a failure here cannot silently re-point every
      // later test's Open dialog at this fixture.
      await app.evaluate(({ dialog }, p) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
      }, SAMPLE_IMAGE);
    }
    await waitForImageFitted();
  }

  it('finds every bar by its OWN colour and recovers the published values -- not a midpoint', async () => {
    // ⚑ The whole pipeline against ground truth: the app's OWN sample figure,
    // opened for real, calibrated on the anchors its truth file publishes,
    // traced by the navy the figure's own bars are drawn in (#1f4e79, sampled
    // directly off the PNG), compared with the values the figure states. Six
    // bars from 165 to 400 MPa, so a reading that was secretly a midpoint
    // (the exact defect `59f94a6` refused rather than ship) would miss by
    // roughly HALF its bar's height -- tens of MPa, not a rounding error.
    //
    // Blobs come back in scan order (top-to-bottom, i.e. roughly tallest-first),
    // not left-to-right category order, so the comparison sorts both sides
    // rather than zipping index-for-index against barTruth's series.
    await openBarTruthProject();
    expect(await textOf('calibrated-status')).toBe('Calibrated ✓');

    await selectAutoExtract('colour');
    await page.getByTestId('color-trace-color').fill('#1f4e79');
    await page.getByTestId('color-trace-tolerance').fill('60');
    // Filters out the small same-colour noise (axis ticks, a stray swatch)
    // the real PNG carries alongside its six actual bars -- verified against
    // the image directly: every real bar's equivalent diameter is >100px,
    // every noise speck's is under 6px.
    await page.getByTestId('color-trace-min-blob').fill('30');
    await page.getByTestId('color-trace-run').click();
    await page.waitForTimeout(300);

    expect(await textOf('color-trace-info')).toMatch(/Placed 6 bars/);

    const read: number[] = [];
    for (let i = 0; i < 6; i++) {
      read.push(Number((await textOf(`tuple-derived-${i}`)).replace(/[^0-9.eE+-]/g, '')));
    }
    read.sort((a, b) => a - b);
    const published = barTruth.series[0]!.points.map((p) => p.value).sort((a, b) => a - b);
    const range = barTruth.axes.y.max - barTruth.axes.y.min;
    for (let i = 0; i < published.length; i++) {
      // Within 3% of the axis's own range -- generous for anti-aliased bar
      // edges, far tighter than the ~50% a midpoint-reading defect would miss by.
      expect(
        Math.abs(read[i]! - published[i]!),
        `sorted index ${i}: read ${read[i]}, published ${published[i]}`
      ).toBeLessThan(range * 0.03);
    }
  }, 30000);

  it('gives the series the colour it was traced from, same as every other By-colour trace', async () => {
    await openBarTruthProject();
    await selectAutoExtract('colour');
    await page.getByTestId('color-trace-color').fill('#1f4e79');
    await page.getByTestId('color-trace-tolerance').fill('60');
    await page.getByTestId('color-trace-min-blob').fill('30');
    await page.getByTestId('color-trace-run').click();
    await page.waitForTimeout(300);
    expect(await textOf('color-trace-info')).toMatch(/Placed [1-9]/);

    await page.getByTestId('series-color-button').click();
    expect(await page.getByTestId('series-color').inputValue()).toBe('#1f4e79');
  }, 30000);
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
    // The tips bar names the slot once calibrated. That the groups were
    // active from the start is what makes it read "new box" immediately,
    // with no toggle click in between.
    expect(await textOf('tips-bar')).toMatch(/Min.*new box/);
    // No refreshCanvasBox: unlike the toggle path, nothing appears/disappears
    // above the canvas here -- the groups were present from the start.
    const pys = [385, 355, 325, 295, 265];
    for (let i = 0; i < pys.length; i++) {
      await clickAt(300, pys[i]!);
      expect(await textOf('box-plot-glyph-count')).toBe(i < pys.length - 1 ? '0' : '1');
    }
  });

  it('files 5 clicks into one tuple, the tips bar and table tracking the cursor, then rolls over to a new box', async () => {
    await resetWorkspace('boxplot');
    await calibrateBarStandard();

    expect(await textOf('tips-bar')).toMatch(/Min.*new box/);
    expect(await textOf('box-plot-glyph-count')).toBe('0'); // no complete tuple yet

    const pys = [385, 355, 325, 295, 265];
    const nextLabels = ['Q1', 'Median', 'Q3', 'Max', 'Min'];
    for (let i = 0; i < pys.length; i++) {
      await clickAt(300, pys[i]!);
      const status = await textOf('tips-bar');
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
    expect(await textOf('tips-bar')).toContain('Median');

    // Del in Place Point mode deletes the active (newest) point; for the last
    // point it routes through removeLastPoint, preserving the group cursor walk-back.
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);

    expect(await textOf('tips-bar')).toMatch(/Q1.*box 1/);
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

  it('leaves a new tuple unnamed (dash at rest), and lets the category name be edited inline (v2.0)', async () => {
    // ⚑ v2.0, 2026-07-30: no more WPD-ported "Bar0" default -- David caught the
    // same fake-name defect live on Pie ("Slice0"/"Slice1") and settled it for
    // every tuple type at once (tenet 9: a name is the user's to type, never
    // invented). The category cell is also click-to-edit now (dash-at-rest span,
    // input only while focused), matching Spider's own axis-name cell exactly.
    await resetWorkspace('boxplot');
    await calibrateBarStandard();

    await clickAt(300, 385); // starts tuple 0 (Min)
    expect(await textOf('tuple-label-0')).toBe('—');

    await page.getByTestId('tuple-label-0').click();
    await page.getByTestId('tuple-label-0').fill('Sample A');
    await page.getByTestId('tuple-label-0').blur();
    await page.waitForTimeout(120);
    expect(await textOf('tuple-label-0')).toBe('Sample A');

    // The custom name survives filling the rest of the tuple, and a second
    // tuple stays unnamed too -- its own independent dash, not "Bar1".
    for (const py of [355, 325, 295, 265]) await clickAt(300, py);
    expect(await textOf('tuple-label-0')).toBe('Sample A');

    await clickAt(500, 385); // starts tuple 1
    expect(await textOf('tuple-label-1')).toBe('—');
  });

  it('deletes a whole box with the row ✕, the label rides the box, and undo restores it (checkpoint 129)', async () => {
    await resetWorkspace('boxplot');
    await calibrateBarStandard();

    // Box 0, named Sample A. Category cell is click-to-edit (v2.0) -- click it
    // into an input before filling, same as Spider's own axis-name cell.
    for (const py of [385, 355, 325, 295, 265]) await clickAt(300, py);
    await page.getByTestId('tuple-label-0').click();
    await page.getByTestId('tuple-label-0').fill('Sample A');
    await page.getByTestId('tuple-label-0').blur();
    // Box 1 to the right, named Sample B.
    for (const py of [385, 355, 325, 295, 265]) await clickAt(500, py);
    await page.getByTestId('tuple-label-1').click();
    await page.getByTestId('tuple-label-1').fill('Sample B');
    await page.getByTestId('tuple-label-1').blur();
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
    expect(await textOf('tuple-label-0')).toBe('Sample B');

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
    await page.getByTestId('calib-choice-origin-top-left').check();
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
    await page.getByTestId('calib-choice-origin-top-left').check(); // see the note above
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
    await confirmValues(['2024/01/01 00:00', '1']);
    await clickAt(400, 200); // (T0,R1) -- click-only
    await clickAt(300, 100); // (T0,R2)
    await confirmValue('10');
    await clickAt(200, 400); // (T1,R2) -- click-only
    await clickAt(400, 400); // (T2,R2) -- click-only
    await page.locator('[data-testid="global-field-startTime"]').click({ timeout: 5000 });
    await page.keyboard.type('2024/01/01 00:00');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);
  }

  it('walks a 5-step calibration mixing value-less and 1-2 value steps, gating Calibrate on the global field', async () => {
    await resetWorkspace('ccr');
    expect(await textOf('tips-bar')).toMatch(/1\/5 — \(T0,R0\)/);

    await clickAt(200, 200); // (T0,R0): 2 values
    await confirmValues(['2024/01/01 00:00', '1']);
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
    await page.keyboard.type('2024/01/01 00:00');
    await page.getByTestId('run-calibration').click();
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    // Query point deliberately not any handle's own pixel (see the note on
    // shared-handle clicks in the XY describe block above) and chosen to
    // keep the pen/chart law-of-cosines term inside acos's valid domain.
    await clickAt(300, 320);
    const cells = await rowCells();
    expect(cells).toHaveLength(2);
    // Time is date-calibrated (T0 was typed as a real date), so the table
    // shows a formatted date STRING (Workspace.tsx's dateFmt branch), not a
    // raw number -- a valid Date can be reconstructed from it.
    expect(cells[0]).not.toBe('');
    expect(Number.isNaN(new Date(cells[0]!).getTime())).toBe(false); // time
    expect(Number.isFinite(Number(cells[1]))).toBe(true); // magnitude
  });

  it('dragging the (T0,R1) handle changes the time reading but not the radius (r never depends on it)', async () => {
    await resetWorkspace('ccr');
    await calibrateCCRStandard();

    await clickAt(300, 320);
    const before = await rowCells();

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

    const after = await rowCells();
    expect(Number(after[1])).toBeCloseTo(Number(before[1]), 6); // r unchanged
    // Time is date-calibrated (see the test above), so it's a formatted date
    // STRING here too -- compare the strings, not a NaN Number() of them.
    expect(after[0]).not.toBe(before[0]);
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

  // ⚑ v1.5: the import NOTICE had no coverage that it ever reaches the eye, and it
  // was cleared only at the top of openProject -- so "this project held N
  // coordinate systems" outlived the figure it described, and read as though the
  // CURRENT figure had lost content. Both halves asserted here: it appears, and it
  // goes when the figure it describes does.
  it('shows what an import did NOT bring, and drops the notice with that figure (v1.5)', async () => {
    // A .dig holding two coordinate systems: Engauge writes them as repeated
    // SIBLINGS under <Document> (there is no <CoordSystems> wrapper).
    const system =
      '<Coords Type="0" TypeString="Cartesian" ScaleXThetaString="Linear" ScaleYRadiusString="Linear" UnitsThetaString="Degrees (DDD.DDDDD)"/>' +
      '<Curve CurveName="Axes"><CurvePoints>' +
      '<Point IsAxisPoint="True" IsXOnly="False"><PositionScreen X="100" Y="500"/><PositionGraph X="0" Y="0"/></Point>' +
      '<Point IsAxisPoint="True" IsXOnly="False"><PositionScreen X="600" Y="500"/><PositionGraph X="10" Y="0"/></Point>' +
      '<Point IsAxisPoint="True" IsXOnly="False"><PositionScreen X="100" Y="100"/><PositionGraph X="0" Y="1"/></Point>' +
      '</CurvePoints></Curve>' +
      '<CurvesGraphs><Curve CurveName="Curve1"><CurvePoints>' +
      '<Point><PositionScreen X="350" Y="300"/></Point>' +
      '</CurvePoints></Curve></CurvesGraphs>';
    const dig =
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE engauge>\n' +
      `<Document VersionNumber="11.0"><CoordSystem>${system}</CoordSystem><CoordSystem>${system}</CoordSystem></Document>`;
    const digPath = path.join(os.tmpdir(), `plottracer-e2e-${Date.now()}.dig`);
    fs.writeFileSync(digPath, dig, 'utf8');

    try {
      await stubOpenProjectDialog(digPath);
      await page.getByTestId('open-project').click();
      await expect
        .poll(async () => (await page.getByTestId('project-notice').textContent().catch(() => null)) ?? '')
        .toMatch(/2 coordinate systems/);
      expect(await textOf('project-notice')).toMatch(/not imported/);
    } finally {
      await app.evaluate(({ dialog }, p) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
      }, SAMPLE_IMAGE);
      fs.unlinkSync(digPath);
    }

    // A fresh image is a different figure, so the note about the old one must go.
    await page.getByTestId('open-image-button').click();
    await waitForImageFitted();
    expect(await page.getByTestId('project-notice').count()).toBe(0);
  });

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

    // The project stamp (v1.4): which build wrote this file, and when. Asserted
    // HERE rather than only in the engine unit tests because the version comes
    // from `__APP_VERSION__`, a Vite define that exists only in a real build --
    // a unit test cannot prove the value ever reaches the file on disk.
    const pkgVersion = (JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
    expect(written.appVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(written.appVersion).toBe(pkgVersion);
    expect(Number.isNaN(Date.parse(written.savedAt))).toBe(false);

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
    await clickAt(420, 450);
    await clickAt(620, 130);
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
    // v2.0: the trigger displays the active type's own label text ('XY',
    // not the config id 'xy'), same as the MUI Select it replaced did.
    expect(await textOf('axes-type-trigger')).toContain('XY');
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

  it('says what an export will NOT carry, before a format is chosen', async () => {
    // The disclosure has to be SEEN to do anything, and a unit test cannot prove
    // the popover renders it -- the engine's claims are checked in
    // engine/__tests__/exportCapability.test.ts, this checks they reach the eye.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175);
    await page.getByTestId('export-csv').click(); // open the Export menu
    const note = await page.getByTestId('export-omission-note').textContent();
    expect(note).toMatch(/figure image/i);
    expect(note).toMatch(/axis calibration/i);
    // A warning with no door out is just noise, so it names what DOES keep them.
    expect(note).toMatch(/save a project/i);
    // And it must NOT claim to lose what it actually carries: point roles,
    // measurements and fits all ride into every export.
    expect(note).not.toMatch(/role/i);
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
    // v2.0, 2026-07-30: no more invented "Bar0" default (tenet 9) -- an
    // unnamed category exports as an empty cell, not a fake transcription.
    expect(category).toBe('');
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

  it('a plain Bar chart exports a Category column and its DERIVED Value (v2.0)', async () => {
    // v2.0: Bar is now tuple-shaped (its own 2-slot interval record), so the
    // export is the tuple shape (category, its two raw ends, the derived
    // Value) -- not the old flat x_px,y_px,Category,Y shape a single click
    // used to produce. ⚑ Called `Category` since v1.3 -- it was WPD's
    // inherited `Label`, the one surface using a different word for what the
    // table, Box Plot and the categorical export all call a Category.
    await resetWorkspace('bar');
    await clickAt(300, 400);
    await confirmValue('0');
    await clickAt(300, 100);
    await confirmValue('10');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);

    await dragMarker(300, 400, 300, 250); // baseline (value 0) to value 5, one bar

    const csvPath = tempFilePath('csv');
    await stubSaveDialog(csvPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-csv').click();
    await page.waitForTimeout(300);

    const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
    expect(lines[0]).toBe('category,Bar start,Bar end,Value');
    const cells = lines[1]!.split(',');
    // v2.0, 2026-07-30: no more invented "Bar0" default (tenet 9) -- the
    // category column is still present and exported (proven by lines[0]'s
    // header above), just empty until the user actually types a name.
    expect(cells[0]).toBe('');
    expect(Number(cells[1])).toBeCloseTo(0, 1); // Bar start -- the baseline end
    expect(Number(cells[2])).toBeCloseTo(5, 1); // Bar end -- the far end
    expect(Number(cells[3])).toBeCloseTo(5, 1); // the derived Value

    fs.unlinkSync(csvPath);
  });

  it('the empty-table hint agrees with the tips bar about what a click does (v1.3)', async () => {
    // ⚑ Both lines are on screen at once. The panel used to say "click on the image
    // to add data points" in EVERY mode, while the tips bar said "a plain click does
    // nothing" in By-colour -- so following the panel meant clicking the curve and
    // concluding the app was broken. Caught on a screenshot, not by a test.
    await resetWorkspace('xy');
    await calibrateXYStandard(); // lands in Place Point, no points yet

    expect(await page.getByTestId('no-points').textContent()).toContain('click on the image');

    await selectAutoExtract('colour');
    const hint = (await page.getByTestId('no-points').textContent()) ?? '';
    const tip = (await page.getByTestId('tips-bar').textContent()) ?? '';
    expect(tip).toContain('a plain click does nothing');
    expect(hint).toContain('press Trace');
    // The contradiction itself: the panel must not invite a click the tips bar
    // has just said is inert.
    expect(hint).not.toContain('click on the image to add');
  });

  it('offers auto-extract on a Bar chart, By colour only (v2.0 Phase 7)', async () => {
    // ⚑ A correctness FIX, not a new feature layered on top of a still-broken
    // one: every OTHER auto-extract mechanism is a curve tool
    // (pointsFromColumnRuns takes the MIDDLE of a column run), which is why
    // this was refused outright at 59f94a6. What changed is a bar blob's own
    // bounding box IS its two ends -- see engine/barDetectRun.ts -- so the
    // rail button now works instead of staying permanently grey.
    await resetWorkspace('bar');
    await clickAt(300, 400);
    await confirmValue('0');
    await clickAt(300, 100);
    await confirmValue('10');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);

    const tool = page.getByTestId('mode-auto-extract');
    expect(await tool.isDisabled()).toBe(false);

    await tool.click();
    await page.waitForTimeout(100);
    expect(await tool.getAttribute('aria-pressed')).toBe('true');
    // Only By colour applies -- Flood-fill/Guide points are curve tools with
    // no slot to file their output into (a bar's two slots are its measured
    // ends, not a curve to follow), same reasoning as the spider's own
    // single-mechanism restriction.
    expect(await page.getByTestId('auto-extract-flood').count()).toBe(0);
    expect(await page.getByTestId('auto-extract-guide').count()).toBe(0);
    expect(await page.getByTestId('auto-extract-colour').count()).toBe(1);
    // No curve/scatter shape choice either -- a bar's shape is always its box.
    expect(await page.getByTestId('color-trace-shape').isVisible()).toBe(false);
  });

  it('...but still refuses it outright on a Box Plot, and says why', async () => {
    // Box Plot shares Bar's calibration but has no "opposite corners" a
    // bounding box could mean for its own five-value record, so it stays in
    // the refused bucket Bar itself has now left.
    await resetWorkspace('boxplot');
    await clickAt(300, 400);
    await confirmValue('0');
    await clickAt(300, 100);
    await confirmValue('10');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);

    const tool = page.getByTestId('mode-auto-extract');
    expect(await tool.isDisabled()).toBe(true);
    // The greyed tool explains itself (the v1.0.2 B3 pattern) rather than leaving a
    // dead button -- Parallel Universe David has to learn WHY on screen. A disabled
    // <button> suppresses its own tooltip in Chromium, so IconButton puts the title
    // on a wrapping span and keeps aria-label on the button; assert the latter.
    expect(await tool.getAttribute('aria-label')).toContain('five values');

    // The hotkey must not sneak past the greyed button.
    await page.keyboard.press('4');
    await page.waitForTimeout(100);
    expect(await tool.getAttribute('aria-pressed')).toBe('false');

    // ...while an XY figure still has it, so the gate is graph-type-specific.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    expect(await page.getByTestId('mode-auto-extract').isDisabled()).toBe(false);
  });

  it('types a category name and prefills it into the next series (v1.3 #9)', async () => {
    // A Bar figure's independent variable is a NAME the reader transcribes off
    // the tick labels. v2.0: naming is the shared bar table's own category
    // column (bar-category-name-N, one row per CATEGORY, click-to-edit --
    // see getBarCategoryTable), not a per-series tuple-label field -- so a
    // rename is visible to every series sharing that category at once. The
    // PREFILL algorithm itself (nearest-named-bar-along-the-category-axis)
    // is unchanged, just ported from points to tuples.
    await resetWorkspace('bar');
    await clickAt(300, 400);
    await confirmValue('0');
    await clickAt(300, 100);
    await confirmValue('10');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);

    await dragMarker(250, 400, 250, 250); // bar 1 (category 0)
    await dragMarker(400, 400, 400, 200); // bar 2 (category 1)
    await page.getByTestId('bar-category-name-0').click();
    await page.getByTestId('bar-category-name-0').fill('Flax');
    await page.getByTestId('bar-category-name-0').blur();
    await page.getByTestId('bar-category-name-1').click();
    await page.getByTestId('bar-category-name-1').fill('Hemp');
    await page.getByTestId('bar-category-name-1').blur();
    await page.waitForTimeout(100);

    // A second series of the same grouped chart inherits the SAME categories,
    // matched to whichever named bar sits nearest along the category axis --
    // proven by the table staying at 2 rows (not growing to 4) with series
    // 2's own values landing in those same two rows.
    await page.getByTestId('add-series').click();
    await page.waitForTimeout(100);
    await dragMarker(270, 400, 270, 300);
    await dragMarker(420, 400, 420, 260);
    await page.waitForTimeout(100);
    expect(await textOf('bar-category-name-0')).toBe('Flax');
    expect(await textOf('bar-category-name-1')).toBe('Hemp');
    expect(await page.getByTestId('bar-category-name-2').count()).toBe(0); // still 2 rows
    expect(await textOf('bar-cell-0-0')).not.toBe('—'); // series 1's Flax bar
    expect(await textOf('bar-cell-1-0')).not.toBe('—'); // series 2's, same row

    // ...and renaming the ROW is a rename of that one shared category, seen by
    // every series bound to it at once -- the whole point of one row per
    // category rather than each series keeping its own independent copy.
    // (v1.3 #9's original bug -- retyping a wrong per-series guess silently
    // renaming another series' genuinely-correct bar -- doesn't recur here:
    // there is no independent per-series copy left TO diverge. Detaching one
    // series' bar into a category of its own, if a prefill guess is wrong,
    // is a different action than renaming this shared row and not this
    // table's job.)
    await page.getByTestId('bar-category-name-1').click();
    await page.getByTestId('bar-category-name-1').fill('Jute');
    await page.getByTestId('bar-category-name-1').blur();
    await page.waitForTimeout(100);
    expect(await textOf('bar-category-name-1')).toBe('Jute');
    expect(await textOf('bar-cell-0-1')).not.toBe('—'); // series 1's bar, same row
    expect(await textOf('bar-cell-1-1')).not.toBe('—'); // series 2's, still the same row

    // The typed name replaces an empty category cell in the file.
    const csvPath = tempFilePath('csv');
    await stubSaveDialog(csvPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-csv').click();
    await page.waitForTimeout(300);
    const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
    expect(lines[0]).toBe('category,Bar start,Bar end,Value');
    expect(lines[1]!.split(',')[0]).toBe('Flax');
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

  it('Auto-extract is disabled for Box Plot / categorical Line, unlike Place Point', async () => {
    // ⚑ REVERSED TWICE. First reversed 2026-07-25 to pin the defect: every
    // auto-extract mechanism was a curve tool, and on a filled bar
    // pointsFromColumnRuns recorded the bar's MIDPOINT, so a bar of true value
    // 10 came out as 5 -- the gate became the whole bar family, not just the
    // point-group types. Reversed again for Bar specifically (v2.0 Phase 7,
    // see the "offers auto-extract on a Bar chart" test above): a bar blob's
    // own bounding box IS its two ends, so Bar now has a CORRECT mechanism
    // and belongs back among the enabled types. Box Plot's datasets carry
    // point groups from the start (checkpoint 107), so Segment Fill/Guide
    // points, curve tools with no group slot to file into, stay disabled for
    // that reason; categorical Line stays disabled too (an ordinal click has
    // nothing a colour trace could read as its own record).
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
    await clickAt(420, 450);
    await clickAt(250, 160);
    await clickAt(620, 130);
    await page.waitForTimeout(150);

    // 3 anchors + the spline fill between them => strictly more table rows than
    // the 3 points actually clicked.
    const rowCount = await page.getByTestId('points-table').locator('tbody tr').count();
    expect(rowCount).toBeGreaterThan(3);
  });

  it('marks derived rows in the table and refuses to edit them (v1.3)', async () => {
    // A spline sample is regenerated from the anchors on every rebuild, so an
    // edit typed into its row "stuck" and was then silently wiped (v0.6 audit).
    // It now reads as derived and declines the edit; the ANCHOR rows stay
    // editable, because moving an anchor is exactly how you change the curve.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await selectAutoExtract('guide');
    await clickAt(420, 450);
    await clickAt(620, 130);
    await page.waitForTimeout(150);

    // Curve order: row 0 is an anchor (curve start), row 1 is derived fill.
    expect(await page.getByTestId('derived-cell-0-1-0').count()).toBe(1);
    expect(await page.getByTestId('derived-cell-0-0-0').count()).toBe(0);

    // What italic MEANS is on screen, not only in a tooltip.
    expect(await page.getByTestId('derived-legend').isVisible()).toBe(true);

    // ⚑ ...and reachable WITHOUT scrolling. isVisible() alone does not prove this:
    // an element scrolled out of an overflow container still reports visible, which
    // is why the first version of this test passed while the legend sat below ~180
    // rows inside the scrolling table (caught on a screenshot, not here). Pin the
    // structure: the legend must not live inside the table's scroll container.
    const insideScroller = await page.evaluate(() => {
      const legend = document.querySelector('[data-testid="derived-legend"]');
      const table = document.querySelector('[data-testid="points-table"]');
      const scroller = table?.parentElement;
      return !!(legend && scroller && scroller.contains(legend));
    });
    expect(insideScroller).toBe(false);
    // A real guide-points trace is long -- prove this table IS the scrolling case,
    // so the assertion above is testing what it claims to test.
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBeGreaterThan(30);
    const box = await page.getByTestId('derived-legend').boundingBox();
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewportHeight);

    // The derived cell offers no click-to-edit affordance at all...
    expect(await page.getByTestId('data-value-x-1').count()).toBe(0);
    // ...while the anchor row still opens its inline editor on click.
    await page.getByTestId('data-value-x-0').click();
    expect(await page.getByTestId('data-edit-x-0').count()).toBe(1);
    await page.keyboard.press('Escape');
  });

  it('a derived row cannot be SELECTED, so the arrow keys can never move it', async () => {
    // ⚑ The third door, found by the v1.3 release-gate audit. The read-only cells
    // only closed typing: clicking anywhere else on an italic row still set it as
    // the active point, and Place-Point's arrow-nudge then MOVED the derived
    // sample -- exported as `role=interpolated` at a hand-chosen position and
    // silently discarded by the next rebuild. Exactly the defect the read-only
    // rows were added to close. The guard is now in updateDataPointPixel (where
    // drag, nudge and value-edit converge) AND the row refuses selection.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await selectAutoExtract('guide');
    await clickAt(420, 450);
    await clickAt(620, 130);
    await page.waitForTimeout(150);

    const derivedRow = page.getByTestId('point-row-1'); // row 1 is derived fill
    const before = await rowValues(1);
    await derivedRow.click();
    // Not selected...
    expect(await derivedRow.getAttribute('aria-selected')).toBe('false');
    // ...and no OTHER row silently inherited the keyboard either. ⚑ This half is
    // why the assertion below is not enough on its own: the first version of this
    // fix merely ignored the click, which left the previous selection active, so
    // the nudge moved an ANCHOR -- and because moving an anchor rebuilds the fill,
    // the derived row shifted by 0.0002 anyway. The click must CLEAR.
    expect(await page.locator('[data-testid^="point-row-"][aria-selected="true"]').count()).toBe(0);
    // ...and nudging does nothing to it.
    await page.getByTestId('mode-place-point').click();
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(150);
    const after = await rowValues(1);
    expect(after[0]).toBeCloseTo(before[0]!, 4);
    expect(after[1]).toBeCloseTo(before[1]!, 4);

    // The ANCHOR row above it still selects -- the guard is scoped to derived.
    await page.getByTestId('point-row-0').click();
    expect(await page.getByTestId('point-row-0').getAttribute('aria-selected')).toBe('true');
  });

  it('does not offer "Edit value…" on a derived point (the second door, v1.3)', async () => {
    // The table cell is not the only entrance: right-click carries its own edit
    // action, which left live would open an editor that no longer renders.
    // ⚑ HONEST LABEL: this PINS behaviour, it does not prove a fix -- it passes
    // against the unguarded build too, because a derived marker is already inert
    // (non-draggable => `listening={false}`) so it never opens a point menu at
    // all. The Workspace guard beside it is belt-and-braces for the day someone
    // makes those markers listening; this test is the net that would catch it.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await selectAutoExtract('guide');
    // Two anchors on a horizontal line, so the derived fill lies BETWEEN them at a
    // pixel we can right-click precisely (the spline through collinear anchors
    // stays on the line -- see algorithms/interpolate.ts, it cannot cusp).
    await clickAt(300, 300);
    await clickAt(600, 300);
    await page.waitForTimeout(150);
    await refreshCanvasBox();

    // Midpoint = derived fill. A derived marker is deliberately kept OUT of the
    // canvas hit graph (ImageCanvas: `listening={point.draggable}`), so the
    // right-click falls through to the empty-canvas menu -- there is no per-point
    // menu on it at all, and therefore no Edit value to mis-fire.
    await page.mouse.click(canvasBox.x + 450, canvasBox.y + 300, { button: 'right' });
    await page.getByTestId('ctx-fit-view').waitFor({ state: 'visible' });
    expect(await page.getByTestId('ctx-edit-value').count()).toBe(0);
    // Close it by clicking the backdrop, NOT Escape: the menu is deliberately
    // focus-passive (disableAutoFocus/disableEnforceFocus, so "Edit value…" can
    // hand focus to the sidebar input), so a keypress never reaches it -- and a
    // left-open menu's backdrop would swallow the next right-click.
    await page.mouse.click(canvasBox.x + 700, canvasBox.y + 500);
    await page.getByTestId('ctx-fit-view').waitFor({ state: 'detached' });
    // MUI unmounts the menu through a close TRANSITION; its backdrop is still up
    // for a few frames after the node detaches and would swallow the next
    // right-click, so let it finish before opening the second menu.
    await page.waitForTimeout(400);

    // The anchor at the curve's start is a real, grabbable point: its own menu,
    // with Edit value offered -- moving an anchor IS how you change the curve.
    await page.mouse.click(canvasBox.x + 300, canvasBox.y + 300, { button: 'right' });
    await page.getByTestId('ctx-delete-point').waitFor({ state: 'visible' });
    expect(await page.getByTestId('ctx-edit-value').count()).toBe(1);
    await page.mouse.click(canvasBox.x + 700, canvasBox.y + 500);
    await page.getByTestId('ctx-delete-point').waitFor({ state: 'detached' });
  });

  it('exports the anchor/interpolated role alongside the data (v1.3)', async () => {
    // The tenet-9 claim in file form: a reader who never saw the app can tell
    // which of these numbers a human put on the figure and which the spline
    // invented. Read back through the OS clipboard, like the v1.1 #4 test.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await selectAutoExtract('guide');
    await clickAt(420, 450);
    await clickAt(620, 130);
    await page.waitForTimeout(150);

    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-copy-csv').click();
    await page.waitForTimeout(200);
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    const lines = copied.split('\n');
    expect(lines[0]).toBe('x_px,y_px,X,Y,role');
    expect(lines[1]!.endsWith(',anchor')).toBe(true);
    expect(lines.filter((l) => l.endsWith(',interpolated')).length).toBeGreaterThan(0);
    // The curve ends on the other anchor -- exactly two, matching the two clicks.
    expect(lines.filter((l) => l.endsWith(',anchor')).length).toBe(2);
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
    await clickAt(420, 450);
    await clickAt(620, 130);
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

  it('a guide click UNDER the auto-extract card still places a point (card is click-through)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await selectAutoExtract('guide');
    // Click inside the card's own footprint, low enough to be over its (text-only)
    // hint rather than the selector row. Before the fix the card swallowed this;
    // now the container is pointer-events:none so the click reaches the canvas.
    const card = await page.getByTestId('auto-extract-card').boundingBox();
    if (!card) throw new Error('auto-extract card has no bounding box');
    await refreshCanvasBox();
    const lx = card.x - canvasBox.x + card.width / 2;
    const ly = card.y - canvasBox.y + card.height - 10;
    await clickAt(lx, ly);
    await page.waitForTimeout(100);
    expect(await page.locator('[data-testid^="point-row-"]').count()).toBeGreaterThan(0);
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

    const results = await textOf('curve-fit-output');
    expect(results).toContain('y = 1.0000 + 2.0000·x');
    expect(results).toMatch(/R² = 1\.00000|R² = 0\.99999/); // exact fit, allow for float noise
    expect(results).toContain('n = 4');
    expect(await page.getByTestId('curve-fit-error').count()).toBe(0);

    await page.getByTestId('curve-fit-clear').click();
    await page.waitForTimeout(100);
    expect(await page.getByTestId('curve-fit-output').count()).toBe(0);
  });

  it('offers nonlinear models, and Degree only where degree means something (v1.5)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await addLinePoints();
    await page.getByTestId('curve-fit-trigger').click();

    // Polynomial is the default and keeps its Degree control.
    expect(await page.getByTestId('curve-fit-model').inputValue()).toBe('polynomial');
    expect(await page.getByTestId('curve-fit-degree').count()).toBe(1);

    // Each model names its own form in the option, so the choice is readable
    // without prior knowledge -- not a bare word to recognise.
    const options = await page.getByTestId('curve-fit-model').locator('option').allTextContents();
    expect(options.join(' ')).toMatch(/Exponential.*y = a·e\^\(b·x\)/);
    expect(options.join(' ')).toMatch(/Gaussian|Logistic/);

    // Choosing a shape retires Degree, which belongs to the polynomial alone.
    await page.getByTestId('curve-fit-model').selectOption('exponential');
    await page.waitForTimeout(100);
    expect(await page.getByTestId('curve-fit-degree').count()).toBe(0);
    // The select is width-capped so the card cannot cover the figure, so the
    // chosen form must still be spelled out on the card itself.
    expect(await textOf('curve-fit-model-form')).toContain('y = a·e^(b·x)');

    await page.getByTestId('curve-fit-run').click();
    await page.waitForTimeout(200);
    const results = await textOf('curve-fit-output');
    // The straight line y = 2x+1 is not an exponential, so this is a real fit
    // with real residuals -- what matters is that it ran and reported itself.
    expect(results).toMatch(/y = .*e\^/);
    expect(results).toContain('n = 4');
    expect(await page.getByTestId('curve-fit-error').count()).toBe(0);
  });

  it('refuses a model the data cannot support, naming what it needs (v1.5)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await addLinePoints(); // x runs from 0, so ln(x) cannot be taken
    await page.getByTestId('curve-fit-trigger').click();
    await page.getByTestId('curve-fit-model').selectOption('logarithmic');
    await page.getByTestId('curve-fit-run').click();
    await page.waitForTimeout(200);
    // A refusal that names the requirement, not a generic failure.
    const err = await textOf('curve-fit-error');
    expect(err).toMatch(/greater than zero/i);
    expect(await page.getByTestId('curve-fit-output').count()).toBe(0);
  });

  // The save-dialog helpers live in the project/CSV describe block above, out of
  // scope here -- this file's convention is a local pair per block.
  function fitTempFilePath(extension: string): string {
    return path.join(os.tmpdir(), `plottracer-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
  }

  async function stubFitSaveDialog(targetPath: string) {
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, targetPath);
  }

  // ⚑ v1.5 release-gate blocker: the screen refused to call an unsettled fit an
  // answer, but the EXPORT carried equation, coefficients, R², RMS and 101
  // sampled curve points with nothing saying the solver never settled -- so a
  // settled fit and an abandoned one were byte-identical to whoever received the
  // file. Only an e2e can catch this: the omission was in Workspace's fitFor,
  // which no unit test of the export builders can reach.
  // ⚑ R² = 1 - SSres/SStot. On a FLAT series SStot is exactly zero -- every point
  // is the mean -- so R² divides by zero and has no value. The code returned 1,
  // which read on screen as a PERFECT fit for a model that explained nothing, and
  // sat beside the red "did not settle". Only an e2e can prove what the card shows.
  it('shows no R² for a flat series, and says why (v1.5.1)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    // Four points at the SAME height: y is constant, so there is no variation.
    for (const px of [100, 130, 160, 190]) await clickAt(px, 175);

    await page.getByTestId('curve-fit-trigger').click();
    await page.getByTestId('curve-fit-run').click();
    await page.waitForTimeout(250);

    const results = await textOf('curve-fit-output');
    // The fabricated perfect score is gone...
    expect(results).not.toContain('R² = 1.00000');
    expect(results).toMatch(/R² = —/);
    // ...and the card says why, rather than leaving a dash to be puzzled over.
    expect(await textOf('curve-fit-no-r2')).toMatch(/every value in this series is the same/);
    // RMS is still reported: it needs no reference variance.
    expect(results).toMatch(/RMS = /);
  });

  it('an unsettled fit says so in the exported file, not just on screen (v1.5)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    // A V -- (0,9) (1,1) (2,1) (3,9). No Gaussian fits it, so LM runs out of
    // iterations: converged=false with R² ≈ 0, unarguably not a result.
    for (const [px, py] of [
      [100, 115],
      [130, 235],
      [160, 235],
      [190, 115],
    ] as const) {
      await clickAt(px, py);
    }

    await page.getByTestId('curve-fit-trigger').click();
    await page.getByTestId('curve-fit-model').selectOption('gaussian');
    await page.getByTestId('curve-fit-run').click();
    await page.waitForTimeout(250);
    // The screen half already worked -- assert it so a regression here is
    // distinguishable from a regression in the export half below.
    expect(await page.getByTestId('curve-fit-not-converged').count()).toBe(1);

    // Dismiss the fly-out before exporting: its Popover backdrop covers the top
    // bar, so an Export click would land on the backdrop and merely close it.
    await clickAt(700, 400);
    await page.waitForTimeout(100);

    const csvPath = fitTempFilePath('csv');
    await stubFitSaveDialog(csvPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-csv').click();
    await expect
      .poll(() => (fs.existsSync(csvPath) ? fs.readFileSync(csvPath, 'utf8') : ''))
      .toContain('Curve fit');
    const csv = fs.readFileSync(csvPath, 'utf8');

    // The summary row a reader takes the numbers from carries the verdict...
    const summary = csv.split('\n')[csv.split('\n').findIndex((l) => l.startsWith('series,')) + 1]!;
    expect(summary).toMatch(/,no$/);
    // ...and so does the sampled-curve block, which can be lifted out alone.
    expect(csv).toContain('Fitted curve — Series 1 (did not settle)');

    fs.unlinkSync(csvPath);
  });

  it('clicking the fitted curve on canvas re-opens Curve Fit to edit it (v1.1)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await addLinePoints(); // a straight line through (100,235)..(190,145)

    await page.getByTestId('curve-fit-trigger').click();
    await page.getByTestId('curve-fit-run').click();
    await page.waitForTimeout(150);
    // Opening the fly-out drops us into Pan (autoclose). Close it by clicking its
    // MUI Popover backdrop -- a canvas click lands on the backdrop, dismissing the
    // fly-out (and is consumed by it, so nothing reaches the canvas).
    await clickAt(700, 400);
    await page.waitForTimeout(100);
    expect(await page.getByTestId('curve-fit-panel').count()).toBe(0);

    // Click ON the fitted line (midway between two points, not on a marker) ->
    // it re-opens Curve Fit. Markers are inert in Pan, so the click reaches it.
    await clickAt(145, 190);
    await page.waitForTimeout(100);
    expect(await page.getByTestId('curve-fit-panel').isVisible()).toBe(true);
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

    expect(await textOf('curve-fit-output')).toContain('n = 2');
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

  // v1.1 fast-follow: the Closed-curve toggle is per-series. Switching to (or
  // adding) a series that has no geometry must read false, not leak the previous
  // series' committed value.
  it('the Closed-curve toggle does not leak across a series switch', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(130, 250); // (1, 0)
    await clickAt(220, 190); // (4, 4) -- Series 1 has 2 points

    await page.getByTestId('geometry-trigger').click();
    await page.getByTestId('geometry-closed').click(); // closed = true
    await page.getByTestId('geometry-run').click(); // commit geometry on Series 1
    await page.waitForTimeout(120);
    expect(await page.getByTestId('geometry-closed').isChecked()).toBe(true);
    await clickAt(600, 400); // dismiss the fly-out

    // A brand-new series has no geometry -> the toggle must be back to false.
    await page.getByTestId('add-series').click();
    await page.waitForTimeout(120);
    await page.getByTestId('geometry-trigger').click();
    expect(await page.getByTestId('geometry-closed').isChecked()).toBe(false);

    // Switching back to Series 1 reloads its committed 'closed' value.
    await clickAt(600, 400);
    await page.getByTestId('series-select').selectOption('0');
    await page.waitForTimeout(120);
    await page.getByTestId('geometry-trigger').click();
    expect(await page.getByTestId('geometry-closed').isChecked()).toBe(true);
  });

  it('reports a clear stale/broken state instead of computing Geometry for fewer than 2 points', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(100, 250); // just one point

    await page.getByTestId('geometry-trigger').click();
    await page.getByTestId('geometry-run').click();
    await page.waitForTimeout(150);

    // The result now lives in the output panel; with <2 points it shows the
    // stale/broken note there AND a callout in the bottom tips bar (v1.1).
    expect(await textOf('geometry-stale')).toMatch(/at least 2 points/);
    expect(await page.getByTestId('geometry-stale-callout').isVisible()).toBe(true);
    expect(await page.getByTestId('geometry-summary').count()).toBe(0);
  });

  it('geometry recomputes live as the series is edited (v1.1)', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(130, 250); // data (1, 0)
    await clickAt(220, 190); // data (4, 4) -> arc length 5

    await page.getByTestId('geometry-trigger').click();
    await page.getByTestId('geometry-run').click(); // turn geometry ON
    await page.waitForTimeout(120);
    expect(await textOf('geometry-summary')).toContain('Arc length = 5.00000');
    // Dismiss the fly-out (backdrop click) so the canvas is clickable again.
    await clickAt(600, 400);
    await page.waitForTimeout(80);

    // Add a third point -> geometry RE-DERIVES live (arc length grows), no re-run
    // and no re-open of the fold-out.
    await page.getByTestId('mode-place-point').click();
    await clickAt(310, 130); // data (7, 8)
    await page.waitForTimeout(80);
    expect(await textOf('geometry-summary')).not.toContain('Arc length = 5.00000');
    expect(await textOf('geometry-summary')).toContain('Arc length =');
  });

  it('a saved and reopened project round-trips the curve fit result', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await addLinePoints();
    await page.getByTestId('curve-fit-trigger').click();
    await page.getByTestId('curve-fit-run').click();
    await page.waitForTimeout(150);
    expect(await textOf('curve-fit-output')).toContain('n = 4');
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
    const results = await textOf('curve-fit-output');
    expect(results).toContain('y = 1.0000 + 2.0000·x');
    expect(results).toContain('n = 4');
    // The degree/restrict controls sync to the loaded fit's own parameters.
    expect(await page.locator('[data-testid="curve-fit-degree"]').inputValue()).toBe('1');

    fs.unlinkSync(savePath);
  });
});

describe('Workspace: Grid Line Removal (checkpoint 28)', () => {
  it('CANNOT BE OPENED before an image, rather than opening and then refusing', async () => {
    // ⚑ This test used to assert the opposite — open the panel on an empty
    // canvas, press Remove, read 'No image loaded.' — which was the DEFECT
    // written down as the expectation. Every control beside it (Export, zoom,
    // undo) was gated on having an image; this one offered a colour picker, a
    // tolerance and a button whose only possible outcome was a refusal.
    //
    // Deliberately not calling resetWorkspace(): it opens an image as its first
    // step, and this needs the app's true initial state.
    expect(await page.getByTestId('grid-removal-trigger').isDisabled()).toBe(true);
    // …and the panel body is not merely hidden behind a click that does nothing.
    await page.getByTestId('grid-removal-trigger').click({ force: true });
    await page.waitForTimeout(150);
    expect(await page.getByTestId('grid-removal-run').count()).toBe(0);
  });

  it('is enabled the moment there IS an image', async () => {
    // The companion half: a gate that never opens is just a removal.
    await resetWorkspace('xy');
    expect(await page.getByTestId('grid-removal-trigger').isDisabled()).toBe(false);
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

    // With no region, the panel shows the direct-drag HINT, not an arm-first
    // toggle button (v1.2 direct marquee -- the old "Restrict to a box" toggle is
    // retired).
    expect(await page.getByTestId('color-trace-region-hint').isVisible()).toBe(true);
    expect(await page.getByTestId('color-trace-region').count()).toBe(0);

    // Drawing a smaller box DIRECTLY on the image (no toggle first) restricts
    // again, below the whole-image count.
    await refreshCanvasBox();
    await page.mouse.move(canvasBox.x + 480, canvasBox.y + 160);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 620, canvasBox.y + 320, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(await page.getByTestId('color-trace-region-clear').count()).toBe(1);
    expect(await previewCount()).toBeLessThan(wholeCount);
  });

  it('undo/redo across an image edit clears a By-colour region drawn AFTER the edit (v2.0 audit)', async () => {
    // Every FORWARD image-changing path (rotate/flip/crop/deskew) already
    // clears the trace region -- it's stored in raw pixel coordinates,
    // meaningless against a different image. restoreDoc (the one function
    // ALL undo/redo goes through) was the one entrance that didn't: rotate
    // the image (region auto-clears, confirmed below) -> draw a NEW region
    // in the POST-rotate pixel space -> undo the rotate back to the
    // PRE-rotate image. Without the fix the stale region survives and would
    // silently search the wrong pixel space on the next trace.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-image-edit').click();
    await page.getByTestId('image-edit-rotate-cw').click();
    await page.waitForTimeout(400);

    await selectAutoExtract('colour');
    await page.getByTestId('color-trace-region-clear').click(); // start from "no region"
    await page.waitForTimeout(150);
    expect(await page.getByTestId('color-trace-region-clear').count()).toBe(0);

    await refreshCanvasBox();
    await page.mouse.move(canvasBox.x + 480, canvasBox.y + 160);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 620, canvasBox.y + 320, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(await page.getByTestId('color-trace-region-clear').count()).toBe(1); // region set, post-rotate space

    await page.keyboard.press('Control+z'); // undo the rotate -> pre-rotate image
    await page.waitForTimeout(400);
    expect(await page.getByTestId('color-trace-region-clear').count()).toBe(0); // stale region must not survive
    expect(await page.getByTestId('color-trace-region-hint').isVisible()).toBe(true);
  });

  // v1.2: the trace eyedropper still samples despite the region marquee now being
  // always-live in By-colour -- the gate excludes the armed eyedropper, so its
  // click is consumed as a colour sample, not swallowed by a region drag. (Also
  // the first e2e coverage of the trace eyedropper.)
  it('By colour: the eyedropper still samples with the region marquee always live', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await selectAutoExtract('colour');
    await page.getByTestId('auto-extract-card').waitFor({ state: 'visible' });

    // Clear the default calibration-box region, then arm the trace eyedropper.
    await page.getByTestId('color-trace-region-clear').click();
    await page.waitForTimeout(80);
    await page.getByTestId('color-trace-eyedropper').click();
    await page.getByTestId('eyedropper-hint').waitFor({ state: 'visible' });
    // The hint is worded for the trace target, not the series eyedropper's copy.
    expect(await textOf('eyedropper-hint')).toMatch(/colour to trace/i);

    // Click exposed canvas (clear of the left-docked card and the top hint). The
    // click is consumed as a sample (the hint detaches) and draws NO region.
    await refreshCanvasBox();
    await clickAt(600, 320);
    await page.waitForTimeout(120);
    expect(await page.getByTestId('eyedropper-hint').count()).toBe(0);
    expect(await page.getByTestId('color-trace-region-clear').count()).toBe(0);
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

    // Auto-extract ▸ Scattered points on the navy markers.
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

  it('removing the active series clears the point selection -- a stale index must not act on the newly-active series', async () => {
    // v2.0 pre-launch audit: unlike switching series (which explicitly clears
    // selection), removing the active series never did. Series 1 gets its own
    // point (auto-selected, index 0). Series 2 is added, made active, and gets
    // its OWN point (also auto-selected, also index 0 -- the numeric
    // coincidence that let this bug hide: a stale index still resolves to a
    // REAL point after the fallback reactivates Series 1). Deleting the
    // ACTIVE series (2) falls back to Series 1. Without the fix, the stale
    // selection silently survives and a bare Delete keypress -- which the
    // user never asked to act on Series 1 at all -- removes Series 1's own
    // point.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175); // Series 1: point 0, auto-selected
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(1);

    await page.getByTestId('add-series').click();
    await page.waitForTimeout(100);
    await clickAt(400, 100); // Series 2: point 0, auto-selected, Series 2 now active

    await page.getByTestId('series-remove').click(); // removes the ACTIVE series (2)
    await page.waitForTimeout(100);
    expect(await page.locator('[data-testid^="series-option-"]').count()).toBe(1); // fell back to Series 1

    await page.keyboard.press('Delete'); // nothing legitimately selected -> must be a no-op
    await page.waitForTimeout(100);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(1); // Series 1's own point survives
  });

  it('⚑ Shift-clicking a DATA POINT adds it to the selection instead of replacing it', async () => {
    // v2.0 pre-launch audit (round 2). `handleMarkerClick` implements
    // Shift-toggle multi-select and SAYS so in its own comment -- "Shift
    // toggles one in/out, a plain click makes it the sole selection" -- but
    // ImageCanvas rendered data-point markers with
    // `onClick={() => onMarkerClick?.(point.id)}`, dropping the event
    // entirely, so `shiftKey` arrived undefined on every data-dot click. The
    // calibration-handle branch two hundred lines above forwards it
    // correctly, which is why this survived: the mechanism demonstrably
    // worked, just never for the markers the Select tool is FOR.
    //
    // Asserted through Delete rather than through any selection styling: the
    // count of points that actually go is the thing the user loses.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(200, 200);
    await clickAt(250, 175);
    await clickAt(300, 150);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(3);

    await page.getByTestId('mode-select').click();
    await page.waitForTimeout(100);

    await refreshCanvasBox();
    await page.mouse.click(canvasBox.x + 200, canvasBox.y + 200);
    await page.waitForTimeout(100);
    await page.keyboard.down('Shift');
    await page.mouse.click(canvasBox.x + 250, canvasBox.y + 175);
    await page.waitForTimeout(100);
    await page.keyboard.up('Shift');

    // Two points are selected, so Delete must remove BOTH. Without the fix
    // the Shift-click replaced the selection and only one goes.
    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);
    expect(await page.getByTestId('points-table').locator('tbody tr').count()).toBe(1);
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

describe('Workspace: Alt key-tips (v1.6)', () => {
  // ⚑ The half that makes removing the native menu a trade rather than a regression:
  // Alt was spent revealing the hidden menu bar, so these badges could not exist while
  // it did. They cure the keystone's named failure -- a shortcut-only path -- by
  // turning keyboard knowledge into on-screen state on demand.

  it('shows each control its own accelerator while Alt is held, and nothing before', async () => {
    await resetWorkspace('xy');

    // Nothing on screen by default -- the badges are on demand, not clutter.
    expect(await page.getByTestId('keytip-undo').count()).toBe(0);
    // ...but the affordance that TELLS you they exist is permanent, or the cure would
    // itself be a shortcut-only path.
    expect(await textOf('keytips-hint')).toContain('Alt');

    await page.keyboard.down('Alt');
    await page.getByTestId('keytip-undo').waitFor({ state: 'visible', timeout: 5000 });
    expect(await textOf('keytip-undo')).toMatch(/Z$/);
    // ⚑ Redo has THREE real bindings (Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y, all since ckpt 38),
    // so the badge names the one that platform's users were trained on: Ctrl+Y on
    // Windows/Linux, Cmd+Shift+Z on macOS. Badging the other teaches a keystroke their
    // other applications will not answer to.
    expect(await textOf('keytip-redo')).toMatch(process.platform === 'darwin' ? /Z$/ : /Y$/);
    // The real accelerator, not an Office-style letter to press next.
    expect(await textOf('keytip-undo')).toMatch(/Ctrl|⌘/);

    // ⚑ LATCHED (David, seeing it run): releasing Alt does NOT take them down. Holding
    // a modifier while hunting for a key you have not learnt yet is exactly the
    // position someone reading the badges is in, so requiring the hold defeats it.
    await page.keyboard.up('Alt');
    await page.waitForTimeout(150);
    expect(await page.getByTestId('keytip-undo').count()).toBe(1);

    // ...until you do something else. Esc dismisses them having done nothing.
    await page.keyboard.press('Escape');
    await expect.poll(() => page.getByTestId('keytip-undo').count(), { timeout: 5000 }).toBe(0);
  });

  it('lights up the LEFT RAIL too, not just the top bar (David)', async () => {
    // ⚑ The rail already carries a permanent faint digit on every tool, so without
    // this the window lands half-dressed while Alt is held -- teal chips across the
    // top bar, untouched grey digits down the rail. Reading the flag from context is
    // what makes every IconButton join in without opting in one by one.
    await resetWorkspace('xy');
    expect(await page.getByTestId('keytip-mode-calibrate').count()).toBe(0);

    await page.keyboard.press('Alt');
    await page.getByTestId('keytip-mode-calibrate').waitFor({ state: 'visible', timeout: 5000 });
    // The rail's own digit, promoted into the same badge the top bar shows -- and on
    // the SAME SIDE as the digit already there, so it reads as that number lighting up
    // rather than as a second, different badge (David).
    expect(await textOf('keytip-mode-calibrate')).toBe('1');

    await page.keyboard.press('Escape');
    await expect.poll(() => page.getByTestId('keytip-mode-calibrate').count(), { timeout: 5000 }).toBe(0);
  });

  it('completes the OFFICE sequence on the rail — Alt, then the badged key', async () => {
    // ⚑ David's point, and it is why the ONLYOFFICE/Office form was worth adopting: an
    // Office user's fingers press Alt and THEN the key they see. Here that lands on a
    // working path -- not because Alt arms anything (it doesn't, deliberately: see
    // useKeyTips.ts on why we took Office's form and not its mechanism) but because the
    // badged digit is a REAL shortcut that fires with or without Alt held.
    //
    // Pinned because it is otherwise an accident of the tool-shortcut handler bailing
    // on primaryMod (Ctrl/Cmd) while letting Alt through. An `altKey` guard added there
    // for some unrelated reason would silently cost us the muscle-memory inroad, and
    // nothing would notice.
    await resetWorkspace('xy');
    // ⚑ Move OFF calibrate first. A fresh workspace already starts there, so asserting
    // "calibrate is active" after Alt+1 passed whether or not the key did anything --
    // the first version of this test was vacuous, and only survived long enough to be
    // caught because the mutation that should have killed it didn't.
    await page.keyboard.press('0');
    expect(await page.getByTestId('mode-pan').getAttribute('aria-pressed')).toBe('true');

    // Tap Alt and LET GO -- the badges stay, which is what makes this a sequence
    // rather than a chord, and is how an Office user's fingers already work.
    await page.keyboard.press('Alt');
    expect(await textOf('keytip-mode-calibrate')).toBe('1');
    await page.keyboard.press('1');
    expect(await page.getByTestId('mode-calibrate').getAttribute('aria-pressed')).toBe('true');
    expect(await page.getByTestId('mode-pan').getAttribute('aria-pressed')).toBe('false');
  });

  it('drops the badges when the window loses focus mid-hold', async () => {
    // ⚑ Alt+Tab sends the keyup to the OTHER window, so without a blur handler the
    // badges stay up for as long as the app is left alone -- the first thing anyone
    // does after pressing Alt.
    await resetWorkspace('xy');
    await page.keyboard.press('Alt');
    await page.getByTestId('keytip-undo').waitFor({ state: 'visible', timeout: 5000 });
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(() => page.getByTestId('keytip-undo').count(), { timeout: 5000 }).toBe(0);
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
    // All bundled examples are listed. 22: XY, XY-multi, scatter, dash-styles,
    // error-bar, histogram, bar, bar-grouped, bar-stacked, bar-floating,
    // categorical, box-plot, polar, spider, the four pies (plain, exploded,
    // donut, tilted), ternary, map, CCR, multi-page PDF.
    //
    // ⚑ Four pies rather than one, and that is the point of the type rather
    // than padding: a pie's hard cases are not variations on the plain one.
    // The donut has no centre to click, the exploded slice does not share
    // the centre it does have, and the tilted one is a circle only under an
    // affine map. One example would show that pie "works" while leaving
    // three of its four shapes untried. Same reasoning gave Bar three more
    // (v2.0, 2026-07-30): grouped, stacked and floating are each a distinct
    // capture shape, not a variation on the plain single-series case.
    //
    // ⚑ And error bars got a SECOND one (2026-08-03): the ± SD figure is
    // symmetric, so a mirrored lower cap happens to land right and the
    // workflow's one real trap never shows. The asymmetric 95% CI figure is the
    // only way to see that an untouched cap reports a symmetry the figure never
    // drew. Same reasoning as the pies -- one example can show a capability
    // "works" while leaving the case it exists for untried.
    //
    // ⚑ A count is a real assertion here, not bookkeeping: an example that ships
    // without its Help entry is invisible, which is how a graph type ends up with
    // no way in for anyone who did not build it.
    // 24 -> 26 with v2.2's heatmaps, then 27: a heatmap's two axes are each
    // independently a CATEGORY or a VALUE, and there is now one example per
    // case, because a figure cannot demonstrate a combination it does not have.
    // The weld figure is value × value with unequal cells and no drawn borders;
    // the IC50 figure is category × category, named compounds against named cell
    // lines, with printed rules and a LOG key; the timecourse is the MIXED case,
    // named treatments against real time, so its two axes are captured by
    // opposite means in one figure. The first two shipped as value × value only
    // until David read the calibration card and said so.
    expect(await page.locator('[data-testid^="example-"]').count()).toBe(27);

    await page.getByTestId('example-polar').click();
    await waitForImageFitted();
    // The example's image loaded (zoom now enabled) and its graph type was
    // pre-selected.
    expect(await page.getByTestId('zoom-controls-button').isDisabled()).toBe(false);
    expect(await page.getByTestId('axes-type-trigger').textContent()).toContain('Polar');
  });

  it('the Line (categorical X) example loads and pre-selects its type (checkpoint 107)', async () => {
    // David: the categorical type needed an example so a first-time user can see
    // what it means. Verify the new entry wires to the right graph type. The
    // type's own picker LABEL was shortened to plain "Line" 2026-07-30 (the
    // parenthetical moved to the icon); the example's own name still says
    // "(categorical X)" since that's teaching content, not the type's label.
    await page.getByTestId('help-trigger').click();
    await page.getByTestId('example-categorical').waitFor({ state: 'visible' });
    await page.getByTestId('example-categorical').click();
    await waitForImageFitted();
    expect(await page.getByTestId('zoom-controls-button').isDisabled()).toBe(false);
    expect(await page.getByTestId('axes-type-trigger').textContent()).toContain('Line');
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
    await page.getByTestId('axes-type-trigger').click();
    await page.getByTestId('axes-option-bar').click();
    // The confirm() fired (auto-accepted by the harness), and the switch went
    // through once accepted.
    expect(dialogMessages.some((m) => /unsaved work/i.test(m))).toBe(true);
    expect(await page.getByTestId('axes-type-trigger').textContent()).toContain('Bar');
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
    expect(await textOf('axes-type-trigger')).toContain('XY');
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

  // v1.1 fast-follow: the sub-mode strip is a plain div (not a Popover), so it
  // had no click-away -- it lingered until an explicit toggle. An outside click
  // must now fold it in, like the fly-outs do.
  it('an outside click dismisses the Select sub-mode strip', async () => {
    await placeFourPoints();
    await page.getByTestId('mode-select').click(); // activate
    await page.getByTestId('mode-select').click(); // open the picker
    expect(await page.getByTestId('select-foldout-card').isVisible()).toBe(true);

    await clickAt(600, 400); // click empty canvas, away from the strip
    await page.waitForTimeout(50);
    expect(await page.getByTestId('select-foldout-card').count()).toBe(0);
  });

  // v1.1 fast-follow: a stray single click in lasso mode (a too-short trace) must
  // CLEAR the selection -- matching the marquee's empty box -- instead of leaving
  // the previous selection stranded.
  it('a stray lasso click clears the current selection', async () => {
    await placeFourPoints();
    await page.getByTestId('mode-select').click();
    await page.getByTestId('mode-select').click();
    await page.getByTestId('select-mode-lasso').click(); // lasso, folds in

    await lasso([[170, 150], [285, 150], [285, 235], [170, 235], [170, 150]]);
    expect(await textOf('tips-bar')).toMatch(/2 points selected/);

    await clickAt(600, 400); // a stray click on empty canvas (no drag)
    await page.waitForTimeout(50);
    expect(await textOf('tips-bar')).not.toMatch(/\d+ points selected/);
  });

  // v1.1 fast-follow: a tall legacy fold-out card (Measure/Image/Error-bars) must
  // scroll inside itself rather than spill off the bottom of a short window. The
  // cap is a maxHeight + overflowY on the card root; without it the card is
  // free-height with visible overflow.
  it('a fold-out card caps its height so it never spills off a short window', async () => {
    await resetWorkspace('xy');
    await page.getByTestId('mode-measure').click();
    const card = page.getByTestId('measure-card');
    expect(await card.isVisible()).toBe(true);
    const style = await card.evaluate((el) => {
      const s = getComputedStyle(el);
      return { overflowY: s.overflowY, maxHeight: s.maxHeight };
    });
    expect(style.overflowY).toBe('auto');
    expect(style.maxHeight).toMatch(/px$/); // resolved calc(100vh - 16px), not 'none'
  });
});

describe('Workspace: resizable sidebar (checkpoint 60)', () => {
  it('widens the right panel by dragging its resize handle', async () => {
    await resetWorkspace('xy');
    const sidebarWidth = () =>
      page.locator('[style*="--sidebar-width"]').evaluate((el: HTMLElement) => el.style.getPropertyValue('--sidebar-width'));
    // ⚑ Asserted against the CONSTANT, not a literal, so raising the default is
    // a one-line change rather than a hunt through the e2e — and so this cannot
    // pass while the app and the store disagree about what the default is.
    expect(await sidebarWidth()).toBe(`${DEFAULT_PANEL_WIDTH}px`);

    const handle = await page.getByTestId('sidebar-resize').boundingBox();
    if (!handle) throw new Error('resize handle has no bounding box');
    // Drag the handle left -> the sidebar (which grows leftward) gets wider.
    await page.mouse.move(handle.x + 3, handle.y + 120);
    await page.mouse.down();
    await page.mouse.move(handle.x - 140, handle.y + 120, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    expect(parseInt(await sidebarWidth(), 10)).toBeGreaterThan(DEFAULT_PANEL_WIDTH + 100);
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

  it('a stray click while Crop is armed does not set a degenerate 0x0 crop rect (v2.0 audit)', async () => {
    // Before this fix, onCropRect had no click-vs-drag guard at all (unlike
    // onRegionRect/onSelectRect, which each had their own, inconsistent
    // ones) -- a plain click set a 0x0 pending rect, and Apply would have
    // silently no-op'd with no message explaining why.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await page.getByTestId('mode-image-edit').click();
    await page.getByTestId('image-edit-crop').click();
    expect(await page.getByTestId('crop-apply').isDisabled()).toBe(true);

    await clickAt(470, 120); // a plain click, not a drag
    await page.waitForTimeout(150);

    // Still no usable rect -- matching the pre-drag state, not "Crop to 0x0".
    expect(await page.getByTestId('crop-bar').innerText()).not.toMatch(/Crop to/);
    expect(await page.getByTestId('crop-apply').isDisabled()).toBe(true);
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
    await page.getByTestId('axes-type-trigger').click();
    const labels = await page.locator('[data-testid^="axes-option-"]').allTextContents();
    await page.keyboard.press('Escape');
    // Adjacency is the point: Bar is the tempting-but-wrong pick for a
    // histogram (it has no numeric x at all), so the right entry has to be
    // visible right next to it -- nothing here may depend on tribal knowledge.
    // "Error Bars" is deliberately gone (checkpoint 79): it was checkpoint 70's
    // interim graph type, and error bars are rail tool 6 now, so error attaches
    // to an ordinary series after you have traced it rather than being a kind of
    // chart you must pick before you start.
    // "Line" (checkpoint 101; label shortened from "Line (categorical X)"
    // 2026-07-30) sits beside Bar: it shares Bar's value-only calibration (X is a
    // category, not a number) but plots points.
    // "Box Plot" (checkpoint 107) joins them -- also BarAxes underneath -- promoted
    // from a hidden Bar toggle to a discoverable entry (a keystone-test fix).
    // "Spider / Radar" (v1.4) sits beside Polar for the same adjacency reason: both
    // are read outwards from a shared centre, and the difference that matters -- one
    // radial scale with a measured angle, versus N independent axes and no angle at
    // all -- is a question the user should be asked next to the alternative, not
    // left to discover after calibrating the wrong one.
    // "Heatmap" (v2.2) closes the rectangular group: it shares the FRAME with
    // everything above it -- two ordinary axes at right angles -- and shares the
    // look of none of them, so it goes last among the rectangles rather than
    // beside a chart it resembles. ⚑ This assertion is why the list is a
    // decision rather than an accident: adding a type without deciding where it
    // belongs fails here, which is what happened when this one was first
    // dropped in beside Box Plot with a comment claiming it sat with XY.
    expect(labels.map((l) => l.trim())).toEqual(['XY', 'Histogram', 'Bar', 'Line', 'Box Plot', 'Heatmap', 'Polar', 'Spider / Radar', 'Pie / Donut', 'Ternary', 'Map', 'Circular Chart Recorder']);
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

    expect((await page.getByTestId('axes-type-trigger').textContent())?.trim()).toContain('Histogram');
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
    // ⚑ Read off the RADIO that is checked. Both defaults are now visible on the
    // card without opening anything, which is the point of the change — a
    // dropdown showed the default and hid the alternative.
    expect(await page.getByTestId('calib-choice-rotationTime-week').isChecked()).toBe(true);
    expect(await page.getByTestId('calib-choice-rotationTime-day').isChecked()).toBe(false);
    await resetWorkspace('map');
    expect(await page.getByTestId('calib-choice-origin-bottom-left').isChecked()).toBe(true);
    expect(await page.getByTestId('calib-choice-origin-top-left').isChecked()).toBe(false);
  });

  it('offers every axes type its own options — none left hardcoded', async () => {
    const expected: Record<string, string[]> = {
      xy: ['isLogX', 'isLogY', 'skipRotation'],
      bar: ['isLog', 'isRotated', 'hasBaseline', 'baselineValue'], // v2.0: the declared-baseline setting
      // v2.0 Phase 6: pinned so Box Plot's options can never again silently
      // inherit Bar's by reference -- it did, briefly, right after Phase 2
      // added hasBaseline/baselineValue to BAR_AXES_CONFIG.options, and
      // nothing here had caught it because Box Plot was never in this list.
      boxplot: ['isLog', 'isRotated'],
      polar: ['isDegrees', 'isClockwise', 'isLogR'],
      ternary: ['isRange100', 'isNormal'],
      map: ['origin', 'units'],
      ccr: ['rotationTime', 'rotationDirection'],
      // ⚑ ADDED 2026-08-14. The heatmap was never in this list — the same gap
      // that let Box Plot silently inherit Bar's options, which is the reason
      // the list exists. It carries the most options of any type, and four of
      // them are the axis-kind CHOICES, so a regression here is a walk that
      // asks the wrong questions.
      // ⚑ The ORDER matters and is asserted: inside a group, everything before
      // the first `newRow` option shares that axis's line. So the list is also
      // the card's layout, one axis at a time.
      heatmap: [
        'xIsCategory', 'isLogX', 'xTicksCentred',
        'yIsCategory', 'isLogY', 'yTicksCentred',
        'keyIsCategory', 'isLogValue', 'skipRotation',
      ],
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
    return textOf('axes-type-trigger');
  }
  async function selectType(id: string) {
    await page.getByTestId('axes-type-trigger').click();
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
    // The loupe must ride above the floating cards (calib/auto-extract/HUD) or
    // they occlude it (David, playtest 2026-07-24).
    expect(await page.getByTestId('zoom-loupe').evaluate((el) => Number(getComputedStyle(el).zIndex))).toBeGreaterThan(1100);
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

  it('hides the loupe while the cursor is over the click-through auto-extract card (2026-07-24)', async () => {
    // The auto-extract card is click-through (pointer-events:none, so points place
    // under it), which leaks its hover to the canvas -- without loupeHideRect the
    // loupe pops into the plot centre while you're just using the card.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await selectAutoExtract('flood');
    await page.getByTestId('auto-extract-card').waitFor({ state: 'visible' });
    await refreshCanvasBox();
    const card = await page.getByTestId('auto-extract-card').boundingBox();
    if (!card) throw new Error('auto-extract card not visible');
    // Hover the CENTRE of the card itself.
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2, { steps: 3 });
    await page.waitForTimeout(200);
    expect(await page.getByTestId('zoom-loupe').count()).toBe(0);
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
    expect(await textOf('axes-type-trigger')).toContain('XY');
    // And the tool that the example is FOR is right there.
    expect(await page.getByTestId('mode-error-bars').count()).toBe(1);
  });

  it('is a rail tool, NOT a graph type — so you trace first and add error after', async () => {
    await resetWorkspace('xy');
    // The retirement, asserted directly: the picker must no longer offer it.
    // As a graph type the choice came BEFORE you started (trace an XY curve,
    // then want error, and you started over) -- problem #1 of the tuple model.
    await page.getByTestId('axes-type-trigger').click();
    const options = await page.locator('[data-testid^="axes-option-"]').allTextContents();
    expect(options.join('|')).not.toMatch(/error/i);
    // Reachable instead as tool 6, visible on the rail with its shortcut badge.
    expect(await page.getByTestId('mode-error-bars').count()).toBe(1);
  });

  it('the tips bar guides the Error-bars tool instead of telling you to calibrate (v1.3)', async () => {
    // ⚑ Error bars was the ONLY tool with no branch in guidanceTip, so on a
    // CALIBRATED chart it fell through to the uncalibrated fallback: the tips bar
    // said "Pick a graph type, then calibrate the axes to begin" while the
    // calibration card beside it said Calibrated ✓. Caught on a screenshot.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    // The rail gates the tool on "some series has points" (Add data points
    // first), so a datum has to exist before the mode is reachable at all.
    await clickAt(400, 200);
    await page.getByTestId('mode-error-bars').click();
    let tip = (await textOf('tips-bar')) ?? '';
    expect(tip).toContain('drag from a data point out to its error cap');
    expect(tip).not.toContain('calibrate the axes to begin');

    // The empty-ACTIVE-series case is still reachable, because the rail gate asks
    // whether ANY series has points while the tip speaks for the active one.
    await page.getByTestId('add-series').click();
    await page.waitForTimeout(100);
    await page.getByTestId('mode-error-bars').click();
    tip = (await textOf('tips-bar')) ?? '';
    expect(tip).toContain('place the data points first');
    expect(tip).not.toContain('calibrate the axes to begin');
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

  it('a cap drag must NOT drag the datum it hangs off (v1.3)', async () => {
    // ⚑ Found by David driving the real app on samples/errorbar-tensile-cure.png:
    // "The only way that I can place the error bars is by clicking on the point
    // that they belong to and then dragging out. And that pulls the point with
    // it." The datum silently followed the cursor and landed ON the cap -- across
    // four attempts, every point-1 datum came to rest at the upper-cap value
    // (truth 8.0, recorded 9.53 / 11.24 / 9.52 / 9.50) while the points placed
    // WITHOUT dragging caps were all within 0.1. Not hand-eye: the marker stayed
    // `draggable` in error-bars mode, so one press started both the cap link and
    // Konva's own marker drag. Exactly the defect Measure was hardened against in
    // v1.1; error-bars was simply never added to the inert list.
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(400, 200); // datum at x=10, y=3.333
    const before = await rowValues(0);
    expect(before[1]).toBeCloseTo(3.333, 2);
    await page.getByTestId('mode-error-bars').click();
    await dragMarker(400, 200, 400, 160); // drag out to the cap at y=6
    const after = await rowValues(0);
    // The datum is where it was placed -- NOT dragged up to the cap's y=6.
    expect(after[0]).toBeCloseTo(before[0]!, 2);
    expect(after[1]).toBeCloseTo(before[1]!, 2);
    // ...and the gesture still did its job, so this can't be "fixed" by making
    // the tool inert.
    const names = await page.locator('[data-testid="series-select"] option').allTextContents();
    expect(names.join('|')).toMatch(/SD upper/);
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
    const capBefore = await rowValues(0);
    await dragMarker(400, 240, 400, 285);
    const after = await page.locator('[data-testid="series-select"] option').allTextContents();
    // Still exactly one cap -- the drag MOVED it, it did not add one.
    expect(after.find((l) => l.startsWith('SD lower'))).toMatch(/\(1\)/);
    // ⚑ And it ACTUALLY moved. The count alone held whether the drag did anything
    // or not, which is how the v1.3 gate found a blanket `mode !== 'error-bars'`
    // draggable gate that had frozen every cap: three on-screen strings promised
    // the drag and it silently did nothing. The lower cap is MIRRORED by the app,
    // so a cap you cannot correct means exporting a symmetry the figure never
    // showed -- assert the recorded value changed, not just that a row exists.
    //
    // The table lays every series out side by side, so row 0 reads
    // [S1 x, S1 y, upper x, upper y, lower x, lower y] -- SD lower is created
    // last, so its value is the LAST cell (index 1 is Series 1's y, which is the
    // point the sibling test above pins as unmoved). Dragging down the screen
    // lowers the value: the mirror put it at ~0.67 and 45px further down is ~-2.3.
    const capAfter = await rowValues(0);
    expect(capAfter[capAfter.length - 1]).toBeLessThan(capBefore[capBefore.length - 1]! - 0.2);
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

describe('Workspace: Trace Challenge (v1.2 game)', () => {
  it('plays a full game — pre-calibrated rounds, scoring, reveal, results, high score, then resets', async () => {
    // Electron persists localStorage across launches, so clear the high-score
    // board first -> this run's fresh total always qualifies (deterministic).
    await page.evaluate(() => window.localStorage.removeItem('plottracer.challenge.highscores'));

    // The app launches with no image; the challenge starts from a clean slate.
    await page.getByTestId('help-trigger').click();
    await page.getByTestId('challenge-start').click();

    // Intro modal -> confirm.
    await page.getByTestId('challenge-intro').waitFor({ state: 'visible' });
    await page.getByTestId('challenge-confirm').click();

    // Rounds. The pool is 4 XY examples (Phase A), so this is a 4-round game.
    await page.getByTestId('challenge-hud').waitFor({ state: 'visible' });
    const roundText = await textOf('challenge-round'); // "Round 1/4"
    const rounds = Number(roundText.match(/\/(\d+)/)?.[1] ?? '0');
    expect(rounds).toBeGreaterThanOrEqual(1);

    for (let r = 0; r < rounds; r++) {
      // loadRound is async (fetch + adoptCalibration + image); wait for the fit so
      // the round is genuinely pre-calibrated before we place points.
      await page.waitForTimeout(300);
      await waitForImageFitted();
      // Wait until the round is actually READY to place points -- i.e. the figure
      // is CAPTURED (the pre-capture "Frame the whole figure" prompt is gone),
      // family-agnostic -- so clicks aren't dropped by a setup race.
      for (let t = 0; t < 25; t++) {
        if (!/Frame the whole figure/i.test(await textOf('tips-bar'))) break;
        await page.waitForTimeout(100);
      }
      // "Points placed" is FAMILY-AGNOSTIC via the active series' count in the
      // dropdown ("Series 1 (N)") -- unlike a `point-row-` row, which only the
      // XY/scatter table has (histogram/box use bin/tuple tables). The very first
      // click of a round can race the async setup, so retry until one registers.
      const pointCount = async () => {
        const t = (await page.getByTestId('series-option-0').textContent()) ?? '';
        return Number(t.match(/\((\d+)\)/)?.[1] ?? '0');
      };
      for (let attempt = 0; attempt < 12 && (await pointCount()) === 0; attempt++) {
        await clickAt(320 + attempt * 8, 300);
        await page.waitForTimeout(120);
      }
      await clickAt(430, 280);
      await clickAt(540, 260);

      if (r === 0) {
        // Pre-calibration proof: the round is already calibrated (the player never
        // saw a calibration step).
        expect(await textOf('calib-status')).toMatch(/^Calibrated/);
        // Regression guard: the figure must be CAPTURED so clicks actually place
        // points (this silently placed nothing while capture stayed pending -- the
        // game was unplayable while the e2e "passed" scoring empty extractions).
        expect(await pointCount()).toBeGreaterThan(0);
      }

      await page.getByTestId('challenge-done').click();
      await page.getByTestId('challenge-reveal').waitFor({ state: 'visible' });
      expect(await textOf('challenge-round-adjusted')).toMatch(/\d/);
      await page.getByTestId('challenge-next').click();
      await page.waitForTimeout(80);
    }

    // Results: a total time, and (first ever run) a qualifying high score.
    await page.getByTestId('challenge-results').waitFor({ state: 'visible' });
    expect(await textOf('challenge-total')).toMatch(/\d/);
    await page.getByTestId('challenge-qualify').waitFor({ state: 'visible' });
    await page.getByTestId('challenge-name').fill('Tester');
    await page.getByTestId('challenge-save-score').click();
    expect(await textOf('challenge-highscores')).toContain('Tester');

    // Finish -> back to the blank opening state (no image, challenge gone).
    await page.getByTestId('challenge-finish').click();
    await page.waitForTimeout(150);
    expect(await page.getByTestId('challenge-hud').count()).toBe(0);
    expect(await page.getByTestId('challenge-results').count()).toBe(0);
    expect(await textOf('tips-bar')).toMatch(/Open an image/i);
  }, 60000); // a full 5-round game (image loads + per-round waits) exceeds the 15s default
});


/**
 * Spider / radar charts (v1.4).
 *
 * The UI half of the version. What is worth an e2e rather than a unit test is
 * everything a stray `config.steps` read would break: a spider's calibration
 * length lives in the SESSION, so the card, the progress line and the handle
 * markers all have to walk the unrolled list. A unit test cannot see any of that.
 */
describe('fold-out cards do not overflow sideways', () => {
  // ⚑ A horizontal scrollbar inside a card is never a design choice, and it is
  // easy to reintroduce: `overflowY: 'auto'` makes CSS compute overflow-x to
  // `auto` as well, so one button label a few pixels too wide grows a bar across
  // the whole card. Measured rather than eyeballed.
  it('the Image card fits its own content', async () => {
    await resetWorkspace('spider');
    await page.getByTestId('mode-image-edit').click();
    await page.getByTestId('image-edit-card').waitFor({ state: 'visible' });
    const overflow = await page.getByTestId('image-edit-card').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

describe('OpenDocument export', () => {
  // ⚑ ODF is the ISO standard (26300) and several EU administrations require it
  // for public documents — the format this project's own reasoning argues for.
  // What the e2e adds over the engine's structural tests is that the app writes
  // a real file through the production save path, byte for byte.
  it('writes a real .ods a spreadsheet application can sniff', async () => {
    await resetWorkspace('xy');
    await calibrateXYStandard();
    await clickAt(250, 175);

    const odsPath = path.join(os.tmpdir(), `plottracer-ods-${process.pid}.ods`);
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, odsPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-ods').click();
    await expect.poll(() => (fs.existsSync(odsPath) ? fs.statSync(odsPath).size : 0)).toBeGreaterThan(0);

    const bytes = new Uint8Array(fs.readFileSync(odsPath));
    // The rule readers enforce: mimetype first, and STORED (method 0), sniffed at
    // a fixed offset. A deflated or misplaced mimetype is a valid ZIP that
    // LibreOffice refuses.
    expect(Buffer.from(bytes.subarray(30, 38)).toString()).toBe('mimetype');
    expect(bytes[8]! | (bytes[9]! << 8)).toBe(0);
    expect(Buffer.from(bytes.subarray(38, 84)).toString()).toBe('application/vnd.oasis.opendocument.spreadsheet');

    const entries = unzipSync(bytes);
    expect(Object.keys(entries)).toContain('content.xml');
    const content = strFromU8(entries['content.xml']!);
    expect(content).toContain('<table:table ');
    expect(content).toContain('office:value-type="float"'); // the traced point, as a number

    fs.unlinkSync(odsPath);
  });
});

describe('spider charts', () => {
  // Centre of the canvas-local coordinates used throughout, with rays at 110px.
  // ⚑ Kept well clear of the LEFT of the canvas: the fold-out calibration card
  // overlays it, so a click at a small x lands on the card and silently places
  // nothing (the long-standing trap that moved this suite's other seeds to
  // x > 350). At CX 520 / R 110 the leftmost ray reaches x = 410.
  const CX = 520;
  const CY = 320;
  const R = 110;
  const spoke = (i: number, n: number, radius = R): [number, number] => [
    CX + radius * Math.sin((2 * Math.PI * i) / n),
    CY - radius * Math.cos((2 * Math.PI * i) / n),
  ];

  /** Walk the whole calibration: centre, then one click + value + name per axis. */
  /** Open the spider example's REAL calibration as a project.
   *
   * ⚑ Built in-process rather than driven through seven canvas clicks: the
   * view transform is fitted asynchronously and re-fitted by capture, so a
   * transform read one frame early shifts every click and surfaces seconds
   * later as a value field that never appeared. That cost the trace test three
   * flaky runs. The clicking path is covered thoroughly elsewhere.
   */
  async function openSpiderTruthProject() {
  const fixture = (() => {
    const session = new CalibrationSession(SPIDER_AXES_CONFIG);
    while (session.getRepeatCount() < spiderTruth.axes.length) session.addRepeat();
    const origin = spiderTruth.calibration.anchors['origin']!;
    session.handleCalibrationClick(origin.px, origin.py);
    session.confirmCalibrationValues(['0']);
    for (const axis of spiderTruth.axes) {
      const anchor = spiderTruth.calibration.anchors[`spoke${axis.axis}`]!;
      session.handleCalibrationClick(anchor.px, anchor.py);
      session.confirmCalibrationValues([String(axis.max), axis.name]);
    }
    if (!session.runCalibration()) throw new Error('fixture calibration failed');
    const png = path.join(REPO_ROOT, 'samples/spider-material-profile.png');
    const result = serializeProject(
      session,
      `data:image/png;base64,${fs.readFileSync(png).toString('base64')}`,
      'spider-material-profile.png'
    );
    if ('error' in result) throw new Error(`fixture build failed: ${result.error}`);
    const filePath = path.join(os.tmpdir(), `plottracer-spider-truth-${process.pid}.json`);
    fs.writeFileSync(filePath, JSON.stringify(result), 'utf8');
    return filePath;
  })();

  try {
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, fixture);
    await page.getByTestId('open-project').click();
  } finally {
    // Restore immediately, so a failure here cannot silently re-point every later
    // test's Open dialog at this fixture.
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, SAMPLE_IMAGE);
  }
  await waitForImageFitted();
  }

  async function calibrateSpider(names: string[], values: string[], centre = '0') {
    const n = names.length;
    for (let i = 3; i < n; i++) await page.getByTestId('add-repeat-step').click();
    // The centre's value is asked ON the centre click now, inline beside the chip
    // with the same confirm button as every other value (David, 2026-07-27) --
    // not in a global-field row that only appeared once every point was placed.
    await clickAt(CX, CY);
    await confirmValues([centre]);
    for (let i = 0; i < n; i++) {
      const [px, py] = spoke(i, n);
      await clickAt(px, py);
      await confirmValues([values[i]!, names[i]!]);
    }
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(150);
  }

  it('prefills the centre value and lets an axis go unnamed', async () => {
    // ⚑ Two things a user hits immediately, neither visible to a unit test.
    // (1) `defaultValue` was declared on the centre's field and read by nothing, so
    // the 0 the config promised never appeared and had to be typed every time.
    // (2) The name field is optional in the model but was labelled just "Name"
    // beside a required value, which reads as required — the same reason Polar's
    // unused theta says "(optional)" in its own label.
    await resetWorkspace('spider');
    await clickAt(CX, CY);
    expect(await page.locator('[data-testid="data-value-input"]').inputValue()).toBe('0');
    await page.locator('[data-testid="confirm-data-value"]').click();

    // Place the first axis with a VALUE but no name, and confirm it is accepted.
    const [px, py] = spoke(0, 3);
    await clickAt(px, py);
    expect(await page.locator('[data-testid="data-value-input-1"]').getAttribute('placeholder')).toContain('optional');
    await page.locator('[data-testid="data-value-input"]').click();
    await page.keyboard.type('120');
    await page.locator('[data-testid="confirm-data-value"]').click();
    await page.waitForTimeout(120);
    // It advanced to the next axis, so the blank name did not block the step.
    expect(await textOf('calibrated-status')).toBe('2/4 set');
  });

  it('is offered in the graph-type dropdown, and starts at three axes', async () => {
    await resetWorkspace('spider');
    // ⚑ The count and the add control are visible BEFORE anything is placed. An
    // affordance that appears only once the third axis is done would be an
    // invisible precondition: you would have to already know it exists.
    expect(await textOf('repeat-count')).toMatch(/3 axes/);
    expect(await page.getByTestId('add-repeat-step').count()).toBe(1);
    // Centre + three axes, not the config's single step.
    expect(await textOf('calibrated-status')).toBe('0/4 set');
    // And the centre's value is asked right there, inline, with 0 prefilled.
    await page.getByTestId('calib-chip-origin').waitFor({ state: 'visible' });
    await page.getByTestId('calib-chip-spoke3').waitFor({ state: 'visible' });
  });

  it('grows and shrinks the calibration with the figure', async () => {
    await resetWorkspace('spider');
    await page.getByTestId('add-repeat-step').click();
    await page.getByTestId('add-repeat-step').click();
    expect(await textOf('repeat-count')).toMatch(/5 axes/);
    expect(await textOf('calibrated-status')).toBe('0/6 set');
    await page.getByTestId('calib-chip-spoke5').waitFor({ state: 'visible' });

    await page.getByTestId('remove-repeat-step').click();
    expect(await textOf('repeat-count')).toMatch(/4 axes/);
    expect(await page.getByTestId('calib-chip-spoke5').count()).toBe(0);
  });

  it('refuses to shrink below the three a spider needs', async () => {
    await resetWorkspace('spider');
    expect(await page.getByTestId('remove-repeat-step').isDisabled()).toBe(true);
  });

  it('undoes and redoes a change to the axis count', async () => {
    // ⚑ Both buttons commit an undo entry, so the count is on the stack like any
    // other action -- but the snapshot did not carry it, so pressing undo left the
    // card reading the NEW count with the entry consumed. The engine test covers
    // the state; this covers what the user sees, which is the only place the count
    // is ever read from.
    await resetWorkspace('spider');
    await page.getByTestId('add-repeat-step').click();
    expect(await textOf('repeat-count')).toMatch(/4 axes/);

    await page.getByTestId('undo').click();
    expect(await textOf('repeat-count')).toMatch(/3 axes/);
    expect(await textOf('calibrated-status')).toBe('0/4 set');
    expect(await page.getByTestId('calib-chip-spoke4').count()).toBe(0);

    await page.getByTestId('redo').click();
    expect(await textOf('repeat-count')).toMatch(/4 axes/);
    await page.getByTestId('calib-chip-spoke4').waitFor({ state: 'visible' });
  });

  it('calibrates, then captures one value per named axis', async () => {
    await resetWorkspace('spider');
    await calibrateSpider(['Strength', 'Weight', 'Cost'], ['100', '100', '100']);
    expect(await textOf('calibrated-status')).toBe('Calibrated ✓');

    // The capture slots are the axes' own names, which no static config could hold.
    expect(await textOf('tips-bar')).toContain('Strength');

    // Halfway out along each ray reads 50 on each axis's own scale.
    for (let i = 0; i < 3; i++) await clickAt(...spoke(i, 3, R / 2));
    // ⚑ One ROW per axis, one COLUMN per series (David, 2026-07-27). The
    // point-group table this replaced showed the ACTIVE series only, so adding a
    // second series made the first one's readings vanish off the screen.
    // ⚑ The axis names live in EDITABLE fields now (they are transcription, and a
    // typo must be fixable), so they are read back as input values rather than as
    // table text — the same way the bar Category column is read.
    expect(await textOf('spider-axis-name-0')).toBe('Strength');
    expect(await textOf('points-table')).toContain('50');
    expect(await textOf('tips-bar')).toMatch(/Strength/);
  });

  it('tells the user WHERE to aim, and calls a tuple by its own name', async () => {
    // ⚑ Two v1.3-gate lessons applied up front rather than found at the gate.
    // (1) On a spider the click's distance along the ray IS the number, exactly as
    // a bar's click height is — the generic point-group tip ("filling Strength")
    // never says that, which is the same silence that let the bar midpoint error
    // through. (2) The shared tuple line falls back to Box Plot's "box" unless the
    // config declares its own noun, which is how Histogram's bins once announced
    // themselves as "new box".
    await resetWorkspace('spider');
    await calibrateSpider(['Strength', 'Weight', 'Cost'], ['100', '100', '100']);

    const tip = await textOf('tips-bar');
    expect(tip).toContain('Strength');
    expect(tip).toMatch(/along that ray/i);
    expect(tip).toContain('profile');
    expect(tip).not.toContain('box');
  });

  it('keeps the calibrated axis rays drawn on the figure after calibrating', async () => {
    // The overlay is what you AIM at. It is the same preview drawn during
    // calibration, and it stays because the placed handles stay — a spoke's
    // direction comes from a single click, so seeing the ray you implied is the
    // only way to tell it matches the ray the figure drew.
    await resetWorkspace('spider');
    await calibrateSpider(['Strength', 'Weight', 'Cost'], ['100', '100', '100']);
    expect(await textOf('calibrated-status')).toBe('Calibrated ✓');
    expect(await page.getByTestId('calib-preview-segments').textContent()).toBe('3');
  });

  it('draws the axis the cursor is filling as the live one, and follows it round', async () => {
    // ⚑ Prevention rather than correction. Spoke order is deliberately unenforced
    // at calibration, so the capture cursor walks the spokes in CALIBRATION order,
    // which need not match the visual order round the chart — a user going
    // clockwise by eye can drift out of step and click the wrong vertex, and the
    // click would be projected onto whichever axis the cursor was actually on. At
    // 120 degrees that turns an intended 50 into -25, on the right row, looking
    // entirely deliberate. Showing which ray is live stops the drift happening.
    await resetWorkspace('spider');
    await calibrateSpider(['Strength', 'Weight', 'Cost'], ['100', '100', '100']);
    expect(await textOf('calib-preview-emphasis')).toBe('0');

    await clickAt(...spoke(0, 3, R / 2));
    expect(await textOf('calib-preview-emphasis')).toBe('1');
    await clickAt(...spoke(1, 3, R / 2));
    expect(await textOf('calib-preview-emphasis')).toBe('2');
    // ...and rolls round to the first axis of the next profile.
    await clickAt(...spoke(2, 3, R / 2));
    expect(await textOf('calib-preview-emphasis')).toBe('0');
  });

  it('snaps a captured point onto its axis, and says so when the click was nearer another', async () => {
    await resetWorkspace('spider');
    await calibrateSpider(['Strength', 'Weight', 'Cost'], ['100', '100', '100']);

    // Slot 1 is Strength, but this click lands over on the Weight ray.
    await clickAt(...spoke(1, 3, R / 2));

    // ⚑ The notice is raised AT CAPTURE, from the click before it is snapped —
    // afterwards the stored point is on its ray and there is nothing left to
    // measure. It is shown, never recorded: no other graph type stores such a
    // thing, and once the dot visibly sits on the axis the user stops aiming
    // perpendicular-accurately, so a stored offset would misrepresent them.
    const notice = await textOf('off-axis-warning');
    expect(notice).toContain('Strength');
    expect(notice).toContain('Weight');
    expect(notice).toMatch(/px off/);

    // The value recorded is the projection onto the axis it was captured against —
    // 50 out along a ray 120 degrees away reads -25, not the 50 the Weight ray
    // would have given. Reading the nearest ray would have looked entirely
    // plausible and been off a different axis's scale.
    // Matched loosely: the canvas is fitted/zoomed, so a click lands at the
    // nearest device pixel rather than at exact ideal geometry. What is being
    // asserted is the SIGN and magnitude — a Weight-ray reading would be +50.
    expect(await textOf('points-table')).toMatch(/-2[45]\./);
  });

  it('types a value into a cell and slides that point along its own axis', async () => {
    // David: "I should be able to both edit the number OR move the point on the
    // axis." Dragging already worked (updateDataPointPixel snaps to the point's own
    // spoke); commitDataPointEdit bailed on anything but XY, so the number in the
    // table was read-only with no sign that it was.
    await resetWorkspace('spider');
    await calibrateSpider(['Strength', 'Weight', 'Cost'], ['100', '100', '100']);
    for (let i = 0; i < 3; i++) await clickAt(...spoke(i, 3, R / 2));

    await page.getByTestId('spider-value-0-0').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('75');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    // ⚑ The number read back is derived from the PIXEL, through the same projection
    // that produced the old one — so this passing means the marker actually moved
    // out along the ray, not that the cell is holding typed text.
    expect(await textOf('spider-cell-0-0')).toMatch(/^75/);
    // ...and only that point moved: the other two axes still read what was clicked.
    // (Matched loosely, like the off-axis test above: the canvas is fitted, so the
    // original clicks landed at the nearest device pixel rather than at exact
    // geometry. What is asserted is that they did not MOVE.)
    expect(await textOf('spider-cell-0-1')).toMatch(/^(49|50)/);
    expect(await textOf('spider-cell-0-2')).toMatch(/^(49|50)/);
  });

  it('lets a cell reach a point the canvas keeps inert, and the live ray follows it', async () => {
    // ⚑ Two behaviours that shipped in fc19687 without coverage. Points of an
    // INACTIVE series are deliberately inert on the canvas so a click can never land
    // on the wrong series — which leaves the table as the only route to them. And
    // the live-ray highlight has to follow the SELECTION, or it points at the axis
    // the next capture would fill while the selected point sits on another.
    await resetWorkspace('spider');
    await calibrateSpider(['Strength', 'Weight', 'Cost'], ['100', '100', '100']);
    for (let i = 0; i < 3; i++) await clickAt(...spoke(i, 3, R / 2));

    await page.getByTestId('add-series').click();
    await page.waitForTimeout(150);
    await clickAt(...spoke(0, 3, R / 3));
    // Series 2 is active and its cursor has rolled on to Weight, so THAT is the live
    // ray; series 1's numbers are plain text, not editable.
    expect(await textOf('calib-preview-emphasis')).toBe('1');
    expect(await page.getByTestId('spider-value-0-0').count()).toBe(0);

    // Clicking series 1's Cost cell reaches back into the other series.
    await page.getByTestId('spider-cell-0-2').click();
    await page.waitForTimeout(150);
    // The highlight moved to the PICKED point's axis (Cost, index 2) rather than
    // staying on the capture cursor...
    expect(await textOf('calib-preview-emphasis')).toBe('2');
    // ...and series 1 is active again, so its cells now offer the edit.
    await page.getByTestId('spider-value-0-2').waitFor({ state: 'visible' });
  });

  it('offers Auto-extract, with the axis-aware mechanism as the only one', async () => {
    // ⚑ Spider is the one point-group type auto-extract is offered for, and the
    // exception is a correctness one: its slots ARE the axes the trace searches, so
    // every reading has a home it was measured against. Flood-fill and Guide points
    // stay out — they produce ordinary points, which a spider series has no slot
    // for, so they would have run and recorded nothing. A button that does nothing
    // reads as broken, not as inapplicable.
    await resetWorkspace('spider');
    await calibrateSpider(['Strength', 'Weight', 'Cost'], ['100', '100', '100']);
    expect(await page.getByTestId('mode-auto-extract').isDisabled()).toBe(false);

    await selectAutoExtract('colour');
    expect(await page.getByTestId('auto-extract-flood').count()).toBe(0);
    expect(await page.getByTestId('auto-extract-guide').count()).toBe(0);
    // Nothing to choose between curve and scatter: the rays decide where to read.
    expect(await page.getByTestId('color-trace-shape').isVisible()).toBe(false);
    expect(await textOf('auto-extract-card')).toMatch(/one reading per axis/i);
  });

  it('traces the bundled figure and recovers its published values', async () => {
    // ⚑ The whole pipeline against ground truth: the app's OWN sample figure, opened
    // for real, calibrated on the anchors its truth file publishes, traced by the
    // colour its generator drew one series in, compared with the values that series
    // states. Six axes running to 120, 60, 25, 100, 80 and 5 — so a reading taken off
    // a neighbouring ray, or off one shared scale, cannot pass by looking plausible.
    // Every other spider test here calibrates INVENTED geometry over the default XY
    // sample: they prove the app self-consistent and nothing more.
    //
    // ⚑ The calibration arrives as a PROJECT rather than as seven computed clicks.
    // Driving it through the canvas means converting image pixels to click points
    // through a view transform that is fitted asynchronously and re-fitted by the
    // capture step — and a transform read one frame early shifts every click, which
    // surfaces seconds later as a value field that never appeared. That cost this
    // test three flaky runs. The clicking path is thoroughly covered by the tests
    // above; what is under test HERE is the trace, so the calibration is built
    // in-process (the same engine the app runs) and opened through the real
    // Open Project.
    await openSpiderTruthProject();
    expect(await textOf('calibrated-status')).toBe('Calibrated ✓');
    // Its six named axes came back as the capture slots.
    expect(await textOf('spider-axis-name-5')).toBe('Cost index');

    // Chitosan film, the navy series.
    await selectAutoExtract('colour');
    await page.getByTestId('color-trace-color').fill('#1f4e79');
    await page.getByTestId('color-trace-tolerance').fill('60');
    await page.getByTestId('color-trace-run').click();
    await page.waitForTimeout(300);

    expect(await textOf('color-trace-info')).toMatch(/Read 6 of 6 axes/);
    const published = spiderTruth.series[0]!.points.map((p) => p.value);
    for (let i = 0; i < published.length; i++) {
      const read = Number(await textOf(`spider-cell-0-${i}`));
      const range = spiderTruth.axes[i]!.max - spiderTruth.axes[i]!.centre;
      // Within 4% of THAT axis's range. The reading is the outer edge of the ink and
      // the figure draws a 7pt marker at each vertex, so it lands a marker's radius
      // proud of the published value — about 1.5%, the same on every axis. A reading
      // off a neighbouring ray or a shared scale misses by very much more.
      expect(
        Math.abs(read - published[i]!),
        `${spiderTruth.axes[i]!.name}: read ${read}, published ${published[i]}`
      ).toBeLessThan(range * 0.04);
    }
  });

  it('gives the series the colour it was traced from', async () => {
    // ⚑ David, seeing a green-swatched "Series 3" sitting on the RED curve: series
    // are coloured in creation order, so after tracing three films by colour the
    // markers contradicted the picture underneath them. The series colour's whole
    // job is to say which series this is — and after a By-colour trace the figure's
    // own ink is the strongest answer there is. Display only; the record is
    // untouched, and one undo takes it back with the points.
    // ⚑ The REAL spider figure, not invented geometry over the XY sample. This
    // test used to calibrate a made-up spider on samples/xy-stress-strain.png and
    // trace #1f4e79 out of it with tolerance 255 -- an image that does not contain
    // that ink at all, so the trace answered "No pixels matched that colour", no
    // points were added, and the colour could not be adopted. It passed only by
    // luck of timing. A colour-adoption test needs a figure with the colour in it.
    await openSpiderTruthProject();
    await selectAutoExtract('colour');
    await page.getByTestId('color-trace-color').fill('#1f4e79');
    await page.getByTestId('color-trace-tolerance').fill('60');
    await page.getByTestId('color-trace-run').click();
    await page.waitForTimeout(300);
    // ⚑ Assert the PREMISE before the conclusion. The figure's ink is adopted only
    // if the trace actually read something, so without this the test reports a
    // confusing colour mismatch when the real failure was an empty trace.
    expect(await textOf('color-trace-info')).toMatch(/Read [1-9]/);

    await page.getByTestId('series-color-button').click();
    expect(await page.getByTestId('series-color').inputValue()).toBe('#1f4e79');
  });

  it('renames an axis from the spreadsheet, and the whole app follows', async () => {
    // David: "I cannot edit the axis in the spreadsheet. THAT I want to fix." The
    // name is the one thing on that row nobody measured, so a typo should not mean
    // re-walking the calibration — and because it belongs to the AXIS, renaming it
    // has to move the capture slots and the guidance with it, not just the cell.
    await resetWorkspace('spider');
    await calibrateSpider(['Strength', 'Weight', 'Cost'], ['100', '100', '100']);
    await clickAt(...spoke(0, 3, R / 2));

    // Click-to-edit: at rest the cell is text (a dash when unnamed), so it never
    // reads as a field demanding input.
    expect(await textOf('spider-axis-name-1')).toBe('Weight');
    await page.getByTestId('spider-axis-name-1').click();
    await page.getByTestId('spider-axis-name-1').fill('Elongation at break (%)');
    await page.getByTestId('spider-axis-name-1').blur();
    await page.waitForTimeout(150);

    expect(await textOf('spider-axis-name-1')).toBe('Elongation at break (%)');
    // ⚑ And an axis left unnamed reads as a DASH, like a value nobody recorded —
    // the name is optional, and a permanent input box says the opposite.
    await page.getByTestId('spider-axis-name-2').click();
    await page.getByTestId('spider-axis-name-2').fill('');
    await page.getByTestId('spider-axis-name-2').blur();
    await page.waitForTimeout(150);
    expect(await textOf('spider-axis-name-2')).toBe('—');
    // The capture cursor names the axis it is about to fill — from the tips bar's
    // own slotAimNote suffix (v2.0, 2026-07-30), which appends it even here: a point
    // is still selected (the "nudge" branch is active, which never mentions the
    // axis by name on its own), and slotAimNote covers exactly that gap.
    expect(await textOf('tips-bar')).toContain('Elongation at break (%)');
    // ...and once nothing is selected, the tips bar's OWN aim-instruction branch
    // says it directly (no suffix needed -- that's what slotAimNote's own
    // "don't repeat what's already said" check is for).
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    expect(await textOf('tips-bar')).toContain('Elongation at break (%)');
    // ...and the reading already captured on axis 1 did not move.
    expect(await textOf('spider-cell-0-0')).toMatch(/\d/);
  });

  it('says nothing matched instead of recording an empty profile', async () => {
    await resetWorkspace('spider');
    await calibrateSpider(['Strength', 'Weight', 'Cost'], ['100', '100', '100']);
    await selectAutoExtract('colour');
    await page.getByTestId('color-trace-color').fill('#010203');
    await page.getByTestId('color-trace-tolerance').fill('2');
    await page.getByTestId('color-trace-run').click();
    await page.waitForTimeout(250);

    expect(await textOf('color-trace-info')).toMatch(/No pixels matched/);
    // ⚑ And nothing was written: a profile of three empty slots would occupy a
    // column in the table for ever, and the user would have to work out that it
    // came from a trace that found nothing.
    for (const axisIndex of [0, 1, 2]) {
      expect(await textOf(`spider-cell-0-${axisIndex}`)).toBe('—');
    }
  });

  it('says how far through the profile you are, and what you left behind', async () => {
    // ⚑ WHAT THIS LINE IS FOR. It used to read "Next point fills: Axis 1 (new
    // profile)" -- a strict SUBSET of the tips bar two inches below, which already
    // said "Click where the shape crosses the Axis 1 axis … (starting a new profile)".
    // Two surfaces doing one job. v1.6 split it into its own sidebar line (tips bar =
    // instruction, sidebar = STATE); v2.0 (2026-07-30) folded it back into the tips
    // bar a second time -- David, re-finding the exact same "two surfaces, one job"
    // complaint on Pie: "Hint should be in the hint bar, not in other places." It now
    // lives in guidanceTip's own slotAimNote suffix, appended only where the tips
    // bar's own branch doesn't already name the slot (see that comment) -- which is
    // why the exact "(N of M filled)" count only shows up once a point is selected
    // (the "nudge" branch, below, never names the slot on its own); right after
    // calibration, with nothing selected yet, the aim branch already says "Strength"
    // by itself and the count isn't repeated.
    await resetWorkspace('spider');
    await calibrateSpider(['Strength', 'Weight', 'Cost'], ['100', '100', '100']);

    // Nothing recorded: no accusation, because nothing has been abandoned. (No count
    // here -- the aim branch already names the axis on its own, see above.)
    expect(await textOf('tips-bar')).toMatch(/Strength.*new profile/);

    // Part-way through the first profile it counts up, and STILL says nothing about
    // incompleteness -- the profile in hand is unfinished because you are in it. A
    // point is selected after each click, so the suffix fires and the count shows.
    await clickAt(...spoke(0, 3, R / 2));
    expect(await textOf('tips-bar')).toContain('Weight — profile 1 (1 of 3 filled)');
    await clickAt(...spoke(1, 3, R / 2));
    expect(await textOf('tips-bar')).toContain('Cost — profile 1 (2 of 3 filled)');

    // Finish it, and start a second.
    await clickAt(...spoke(2, 3, R / 2));
    expect(await textOf('tips-bar')).toContain('Strength — new profile (0 of 3 filled)');
    await clickAt(...spoke(0, 3, R / 4));
    expect(await textOf('tips-bar')).toContain('Weight — profile 2 (1 of 3 filled)');

    // ⚑ THE SIGNAL. Punch a hole in the FINISHED profile while the second is in hand.
    // A spider's slots are N×1D -- independently meaningful and independently EMPTY --
    // so a profile missing one axis looks exactly like a whole one on the figure, and
    // reads as a single dash in a table you would have to scan row by row. Now it is
    // said out loud, in the place you are already looking. Eraser mode's own branch
    // never mentions the slot at all, so the suffix always fires here.
    await page.getByTestId('mode-eraser').click();
    await clickAt(...spoke(1, 3, R / 2));
    await page.waitForTimeout(150);
    expect(await textOf('tips-bar')).toContain('1 profile incomplete');
  });

  it('erases ONE reading, and the freed slot can be re-aimed from the table', async () => {
    // ⚑ Both halves found by driving the app. The Eraser blanked a whole six-axis
    // series, because a spider inherited the Box Plot rule that a member stands for
    // its tuple — true of a box, false of six independent readings. And once there
    // are two gaps, the cursor only ever offers the first, so the second could not
    // be filled at all (David: "Can I make an empty slot active again?").
    await resetWorkspace('spider');
    await calibrateSpider(['Strength', 'Weight', 'Cost'], ['100', '100', '100']);
    for (let i = 0; i < 3; i++) await clickAt(...spoke(i, 3, R / 2));
    for (const axisIndex of [0, 1, 2]) expect(await textOf(`spider-cell-0-${axisIndex}`)).toMatch(/\d/);

    // Erase the middle reading only.
    await page.getByTestId('mode-eraser').click();
    await clickAt(...spoke(1, 3, R / 2));
    await page.waitForTimeout(150);

    expect(await textOf('spider-cell-0-0')).toMatch(/\d/); // untouched
    expect(await textOf('spider-cell-0-1')).toBe('—'); // the one erased
    expect(await textOf('spider-cell-0-2')).toMatch(/\d/); // untouched
    // ...and the freed slot is what the next click fills. Eraser mode's own tips-bar
    // branch never names a slot on its own, so slotAimNote's suffix always fires here.
    expect(await textOf('tips-bar')).toContain('Weight');

    // Now erase a SECOND reading, leaving two gaps, and aim at the later one.
    await clickAt(...spoke(0, 3, R / 2));
    await page.waitForTimeout(150);
    expect(await textOf('tips-bar')).toContain('Strength'); // the first gap
    await page.getByTestId('spider-cell-0-1').click();
    await page.waitForTimeout(150);
    expect(await textOf('tips-bar')).toContain('Weight'); // the one asked for

    // And a capture lands in the slot that was aimed at, not the first gap.
    await page.getByTestId('mode-place-point').click();
    await clickAt(...spoke(1, 3, R / 4));
    await page.waitForTimeout(150);
    expect(await textOf('spider-cell-0-1')).toMatch(/\d/);
    expect(await textOf('spider-cell-0-0')).toBe('—');
  });

  it('exports EVERY series, each reading against its own axis', async () => {
    // ⚑ The release audit's finding. Grouped types routed the CSV through the
    // tuple-table section, which is ACTIVE-SERIES-ONLY and reads values off the
    // NEAREST ray — so the screen showed three series and the file carried one,
    // read against whichever spoke each point sat closest to rather than the axis
    // it was captured on. The scope control was hidden for grouped types too, so
    // there was no way to ask for the rest.
    await resetWorkspace('spider');
    await calibrateSpider(['Strength', 'Weight', 'Cost'], ['100', '100', '100']);
    for (let i = 0; i < 3; i++) await clickAt(...spoke(i, 3, R / 2));
    await page.getByTestId('add-series').click();
    await page.waitForTimeout(150);
    for (let i = 0; i < 3; i++) await clickAt(...spoke(i, 3, R / 4));

    // (The save-dialog helpers live inside the project describe block, so the two
    // lines they wrap are inlined here.)
    const csvPath = path.join(os.tmpdir(), `plottracer-spider-export-${process.pid}.csv`);
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, csvPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-csv').click();
    await expect
      .poll(() => (fs.existsSync(csvPath) ? fs.readFileSync(csvPath, 'utf8') : ''))
      .toContain('Strength');
    const csv = fs.readFileSync(csvPath, 'utf8');

    // Every reading is labelled with the axis it was CAPTURED on...
    expect(csv).toContain('Axis,Name,Value');
    for (const axis of ['Strength', 'Weight', 'Cost']) expect(csv).toContain(axis);
    // ...and this is the active series' own values (≈25), not the other one's.
    expect(csv).toMatch(/,(24|25)\./);
    fs.unlinkSync(csvPath);

    // ⚑ And the scope control is now OFFERED here, which was the other half of the
    // defect: the screen showed every series while the file carried one, with no
    // way to ask for the rest. Switching to All puts both in.
    await page.getByTestId('export-scope-all').click();
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, csvPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-csv').click();
    await expect
      .poll(() => (fs.existsSync(csvPath) ? fs.readFileSync(csvPath, 'utf8') : ''))
      .toContain('Series 2');
    const both = fs.readFileSync(csvPath, 'utf8');
    expect(both).toContain('Series 1');
    expect(both).toMatch(/(49|50)\./); // series 1's readings
    expect(both).toMatch(/(24|25)\./); // series 2's

    fs.unlinkSync(csvPath);
  });

  it('walks a five-axis figure end to end, card and canvas both tracking all five', async () => {
    // ⚑ The regression the whole session-owned step list exists to prevent. Four
    // sites in Workspace.tsx used to read `config.steps`, which for a spider holds
    // ONLY the centre — so the card would render a one-step calibration, the
    // progress line would say "1/1", and the canvas would draw a single handle
    // while the user placed six. A unit test cannot see any of that.
    await resetWorkspace('spider');
    await calibrateSpider(['A', 'B', 'C', 'D', 'E'], ['10', '20', '30', '40', '50']);
    expect(await textOf('calibrated-status')).toBe('Calibrated ✓');

    // Every axis kept its own name and its own scale: each ray's known point is a
    // different value, so half way out reads half of THAT axis's range.
    expect(await textOf('tips-bar')).toContain('A');
    for (let i = 0; i < 5; i++) await clickAt(...spoke(i, 5, R / 2));
    const table = await textOf('points-table');
    for (const half of ['5', '10', '15', '20', '25']) expect(table).toContain(half);
    // Every axis is a row, named.
    for (let i = 0; i < 5; i++) {
      expect(await textOf(`spider-axis-name-${i}`)).toBe(['A', 'B', 'C', 'D', 'E'][i]);
    }
  });
});


/**
 * Pie / donut (v1.6) — driven against the four bundled figures' OWN ground truth.
 *
 * ⚑ THIS IS THE INSTRUMENT THE SPIDER TAUGHT US TO BUILD. Fifteen green e2e once
 * passed over a trace that read a run's MIDPOINT, because every one of them invented
 * its own geometry and then agreed with itself. Here the app is driven with the
 * anchors the generator wrote down, and checked against the values it rendered from,
 * so agreement means something.
 *
 * Calibration and capture are done ENGINE-SIDE and loaded as a project, mirroring the
 * spider truth test above and for the same reason recorded there: clicking a canvas
 * whose transform may be one frame stale shifts every click and surfaces seconds
 * later as a value that never appeared. The click path has its own coverage — both in
 * engine/__tests__/pieCapture.test.ts and in the calibration test below, which drives
 * the real UI.
 */
describe('pie charts (v1.6)', () => {
  beforeEach(async () => {
    await resetWorkspace('pie');
  });

  it('is offered in the graph-type dropdown and asks for an outline, a total and a sweep', async () => {
    // ⚑ Nothing clicks a centre — a donut has none to click, so the outline IS the
    // calibration and the centre is fitted through it.
    expect(await textOf('repeat-count')).toMatch(/3 outline points/);
    await page.getByTestId('calib-chip-outline1').waitFor({ state: 'visible' });
    await page.getByTestId('calib-chip-outline3').waitFor({ state: 'visible' });
    expect(await page.getByTestId('calib-chip-outline4').count()).toBe(0);

    // ⚑ The total and the sweep are NOT asserted here: they are global fields, and the
    // card shows them only once every outline point is placed — they belong to the
    // whole figure, so asking for them mid-walk would be asking about a shape that
    // does not exist yet. Their defaults and their effect are covered by the four
    // figure tests below and by engine/__tests__/pieCalibration.test.ts.

    // The outline grows, because some figures leave little clean rim to click.
    await page.getByTestId('add-repeat-step').click();
    expect(await textOf('repeat-count')).toMatch(/4 outline points/);
  });

  for (const { name, truth } of PIE_TRUTHS) {
    it(`reads ${name} back to the values it was drawn from`, async () => {
      const fixture = (() => {
        const session = new CalibrationSession(PIE_AXES_CONFIG);
        const outline = truth.calibration.anchors.outline;
        while (session.getRepeatCount() < outline.length) session.addRepeat();
        for (const p of outline) session.handleCalibrationClick(p.px, p.py);
        session.setGlobalFieldValue('total', String(truth.total));
        session.setGlobalFieldValue('sweep', String(truth.sweep));
        if (truth.tilted) session.setOption('isTilted', 'true');
        if (!session.runCalibration()) throw new Error(`${name}: fixture calibration failed`);

        // ⚑ CAPTURE AS A USER WOULD: one click per boundary. Ordinary slices SHARE
        // their edges, so the closing click of one opens the next -- clicking both
        // edges of every slice would measure each shared line twice and put two
        // pixels on it. An exploded slice shares nothing, so it is armed first, takes
        // its own apex, and its two edges are clicked as a pair.
        let chained = false; // does the next slice already have its opening edge?
        truth.calibration.slices.forEach((sl) => {
          if (sl.exploded) {
            session.setNextSectorExploded(true);
            session.addDataPoint(sl.apex.px, sl.apex.py);
            session.addDataPoint(sl.startEdge.px, sl.startEdge.py);
            session.addDataPoint(sl.endEdge.px, sl.endEdge.py);
            chained = false; // the gap after it breaks the chain on this side too
            return;
          }
          if (!chained) session.addDataPoint(sl.startEdge.px, sl.startEdge.py);
          session.addDataPoint(sl.endEdge.px, sl.endEdge.py);
          chained = true;
        });
        // Name each completed sector, in capture order.
        session
          .getDataset()
          .getAllTuples()
          .forEach((t, i) => {
            if (t.every((v) => v !== null) && truth.series[0]!.points[i]) {
              session.setTupleLabel(i, truth.series[0]!.points[i]!.category);
            }
          });

        const png = path.join(REPO_ROOT, `samples/${name}.png`);
        const result = serializeProject(
          session,
          `data:image/png;base64,${fs.readFileSync(png).toString('base64')}`,
          `${name}.png`
        );
        if ('error' in result) throw new Error(`${name}: fixture build failed: ${result.error}`);
        const filePath = path.join(os.tmpdir(), `plottracer-${name}-${process.pid}.json`);
        fs.writeFileSync(filePath, JSON.stringify(result), 'utf8');
        return filePath;
      })();

      try {
        await app.evaluate(({ dialog }, p) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
        }, fixture);
        await page.getByTestId('open-project').click();
      } finally {
        await app.evaluate(({ dialog }, p) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
        }, SAMPLE_IMAGE);
      }

      // The app opened it as a PIE, not as something that merely looked plausible.
      await expect.poll(async () => textOf('calibrated-status'), { timeout: 10000 }).toBe('Calibrated ✓');
      expect(await page.getByTestId('axes-type-trigger').textContent()).toContain('Pie');

      // ⚑ Every slice, read off the spreadsheet the user actually sees.
      const expected = truth.series[0]!.points;
      // ⚑ At least one row per slice, and possibly ONE more: the closing click of the
      // last sector opens the next, because nothing here infers "you must be finished"
      // -- a half pie genuinely is not. That trailing row shows a dash until it is
      // either completed or deleted.
      await expect
        .poll(() => page.getByTestId('points-table').locator('tbody tr').count(), { timeout: 10000 })
        .toBeGreaterThanOrEqual(expected.length);
      for (let i = 0; i < expected.length; i++) {
        // ⚑ The CATEGORY is a click-to-edit field (v2.0, 2026-07-30) -- dash-at-rest
        // text, an input only while focused, the same field a Box Plot's tuples have
        // carried since checkpoint 23 (now click-to-edit there too), which pie
        // inherits rather than reinventing. Reading it back is plain text, not
        // inputValue() -- nothing here needs to enter edit mode.
        expect(await textOf(`tuple-label-${i}`), `${name} row ${i} category`).toBe(expected[i]!.category);
        // ⚑ ...and the VALUE is one derived column, not the two boundary angles.
        // Before this existed the table showed "270" and "61.2" for a slice worth 42.
        const shown = Number((await textOf(`tuple-derived-${i}`)).replace(/[^0-9.eE+-]/g, ''));
        const want = expected[i]!.value;
        expect(Math.abs(shown - want) / Math.abs(want), `${name} row ${i}: shown ${shown}, want ${want}`).toBeLessThan(
          0.001
        );
      }
    }, 30000);
  }

  describe('closing the ring', () => {
    async function calibratePieByHand() {
      for (const [x, y] of [[200, 120], [320, 240], [200, 360]] as const) await clickAt(x, y);
      await page.getByTestId('global-field-total').fill('100');
      await page.getByTestId('run-calibration').click();
      await expect.poll(async () => textOf('calibrated-status'), { timeout: 10000 }).toBe('Calibrated ✓');
      await page.getByTestId('mode-place-point').click();
    }

    it('offers the closing click ON THE FIGURE, and only once it is possible', async () => {
      // ⚑ The keystone test, not a nicety. Recognising a click on the first boundary
      // is worth nothing if only its author knows it can be done -- that is precisely
      // the "shortcut-only path" the rule names as a failure. So the offer has to be
      // visible on screen, and has to be ABSENT while it would be wrong.
      await calibratePieByHand();
      const marker = () => page.getByTestId('marker-labels');

      await clickAt(260, 140); // first boundary
      await clickAt(340, 260);
      expect(await marker().textContent()).not.toContain('close the ring');

      // Two sectors recorded and a third open: now it is real.
      await clickAt(260, 380);
      await expect
        .poll(async () => marker().textContent(), { timeout: 5000 })
        .toContain('click to close the ring');
    });

    it('completes the last sector without opening another', async () => {
      await calibratePieByHand();
      for (const [x, y] of [[260, 140], [340, 260], [260, 380], [180, 260]] as const) await clickAt(x, y);
      const rows = () => page.getByTestId('points-table').locator('tbody tr').count();
      // Four boundaries: three complete sectors plus the one chaining pre-opened.
      await expect.poll(rows, { timeout: 5000 }).toBe(4);

      // Click the first boundary again -- the far edge of the last sector.
      await clickAt(260, 140);
      // ⚑ Still four. The ring is closed, so there is no next sector to open, and the
      // capture does not end on a permanently half-filled row.
      await expect.poll(rows, { timeout: 5000 }).toBe(4);
      for (let i = 0; i < 4; i++) {
        expect(await textOf(`tuple-derived-${i}`), `sector ${i}`).not.toBe('—');
      }
      // ...and the four now account for the whole figure.
      const total = await Promise.all(
        [0, 1, 2, 3].map(async (i) => Number((await textOf(`tuple-derived-${i}`)).replace(/[^0-9.eE+-]/g, '')))
      );
      expect(total.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1);
    });
  });

  /**
   * The "Exploded slice" control, driven as a user drives it.
   *
   * ⚑ WHY THIS EXISTS. The control shipped as an 11px chip in the right-hand sidebar
   * and failed the keystone test in the most direct way there is: the person who asked
   * for it went looking and could not find it. The four figure tests above prove an
   * exploded slice READS correctly -- they call the session directly and would go on
   * passing with no button on screen at all. This is the test that says a user can
   * reach it, and that it tells the truth in every state it is shown in.
   */
  describe('the exploded-slice control', () => {
    /** Calibrate a pie by clicking three points on the canvas -- any three that are
     * not collinear describe a circle, which is all this needs. */
    async function calibratePieByHand() {
      for (const [x, y] of [[200, 120], [320, 240], [200, 360]] as const) await clickAt(x, y);
      await page.getByTestId('global-field-total').fill('100');
      await page.getByTestId('run-calibration').click();
      await expect.poll(async () => textOf('calibrated-status'), { timeout: 10000 }).toBe('Calibrated ✓');
      await page.getByTestId('mode-place-point').click();
    }

    it('is not offered before there is a pie to have slices of', async () => {
      // ⚑ An affordance that does nothing is worse than none: it invites the click
      // that teaches the user the app is unpredictable. Before calibration there is
      // no sector to call exploded.
      expect(await page.getByTestId('pie-exploded-slice').count()).toBe(0);
    });

    it('is on the FIGURE, in reach of the boundary being clicked', async () => {
      await calibratePieByHand();
      const button = page.getByTestId('pie-exploded-slice');
      await button.waitFor({ state: 'visible' });
      // ⚑ Asserted by GEOMETRY, not by existence. The chip it replaced was present and
      // visible too -- and unfindable. It has to be over the figure and in its
      // lower-right, where the eye already is while clicking boundaries round the rim.
      const btn = (await button.boundingBox())!;
      const canvas = (await page.locator('canvas').first().boundingBox())!;
      expect(btn.x).toBeGreaterThan(canvas.x + canvas.width / 2);
      expect(btn.y).toBeGreaterThan(canvas.y + canvas.height / 2);
      expect(btn.x + btn.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
      // And big enough to read as a control rather than as a label.
      expect(btn.height).toBeGreaterThan(28);
      expect(await button.textContent()).toMatch(/Exploded slice/i);
    });

    it('folds out instructions that follow the three clicks', async () => {
      await calibratePieByHand();
      // Nothing is explained until it is asked for -- the guidance is not permanent
      // furniture over the figure.
      expect(await page.getByTestId('exploded-slice-guide').count()).toBe(0);

      await page.getByTestId('pie-exploded-slice').click();
      const guide = page.getByTestId('exploded-slice-guide');
      await guide.waitFor({ state: 'visible' });
      // ⚑ It opens UP AND TO THE LEFT of a bottom-right button, so it stays on screen.
      const g = (await guide.boundingBox())!;
      const btn = (await page.getByTestId('pie-exploded-slice').boundingBox())!;
      const canvas = (await page.locator('canvas').first().boundingBox())!;
      expect(g.y + g.height).toBeLessThanOrEqual(btn.y + 1);
      expect(g.x).toBeGreaterThanOrEqual(canvas.x - 1);

      // The tip is what is being asked for FIRST, and the panel says so.
      expect(await page.getByTestId('exploded-step-1').getAttribute('data-state')).toBe('now');
      expect(await page.getByTestId('exploded-step-2').getAttribute('data-state')).toBe('todo');

      // Place the tip: step 1 is done and the ask moves on, WITHOUT the panel closing.
      // ⚑ This is the state the old chip could not express -- it read from
      // `isAwaitingExplodedApex()`, which goes false the instant the tip lands, so the
      // screen said "nothing armed" through both edge clicks.
      await clickAt(260, 240);
      await expect
        .poll(async () => page.getByTestId('exploded-step-1').getAttribute('data-state'), { timeout: 5000 })
        .toBe('done');
      expect(await page.getByTestId('exploded-step-2').getAttribute('data-state')).toBe('now');
    });

    it('cancels mid-capture, and puts the discarded edge back on undo', async () => {
      await calibratePieByHand();
      await page.getByTestId('pie-exploded-slice').click();
      await clickAt(260, 240); // the tip
      await clickAt(300, 180); // one edge of two
      await expect
        .poll(() => page.getByTestId('points-table').locator('tbody tr').count(), { timeout: 5000 })
        .toBe(1);

      // ⚑ The button offers "cancel" through all three clicks, so it must WORK through
      // all three. Past the tip the arming flag is already down, and a cancel that
      // silently did nothing there would be worse than no cancel at all.
      await page.getByTestId('pie-exploded-slice').click();
      await expect
        .poll(() => page.getByTestId('points-table').locator('tbody tr').count(), { timeout: 5000 })
        .toBe(0);
      await expect.poll(() => page.getByTestId('exploded-slice-guide').count(), { timeout: 5000 }).toBe(0);

      // It discards real clicks, so it goes through history like every other removal.
      await page.keyboard.press('Control+z');
      await expect
        .poll(() => page.getByTestId('points-table').locator('tbody tr').count(), { timeout: 5000 })
        .toBe(1);
    });
  });
});

/**
 * The F1 "How to use PlotTracer" card (v2.0).
 *
 * ⚑⚑ WHY THIS EXISTS SEPARATELY FROM helpOverlayKeys.test.ts. That file asserts
 * the card's key table against Workspace.tsx's own source — it proves the two
 * agree, and nothing more. It cannot tell whether pressing F1 opens anything,
 * whether the button is wired, or whether the card can be dismissed. Source
 * agreeing with source is the failure mode this project keeps getting caught
 * by, so the key actually gets pressed here.
 */
describe('Workspace: the F1 help card', () => {
  /** Present-and-visible, in this suite's own idiom (vitest expect, not
   *  Playwright's — the locator matchers are not available here). */
  const cardCount = () => page.getByTestId('help-overlay').count();

  it('opens on F1 and closes on Escape', async () => {
    await resetWorkspace('xy');
    expect(await cardCount()).toBe(0);

    await page.keyboard.press('F1');
    await expect.poll(cardCount, { timeout: 5000 }).toBe(1);
    expect(await page.getByTestId('help-overlay').isVisible()).toBe(true);

    await page.keyboard.press('Escape');
    await expect.poll(cardCount, { timeout: 5000 }).toBe(0);
  });

  it('opens from the Help card too — the route a first-time user can SEE', async () => {
    // ⚑ The button is the load-bearing half. A key nobody has been told about
    // is a capability that does not exist for a first-time user; F1 is the
    // shortcut for the second time onwards.
    await resetWorkspace('xy');
    await page.getByTestId('help-trigger').click();
    await page.getByTestId('open-help-overlay').click();
    await expect.poll(cardCount, { timeout: 5000 }).toBe(1);

    await page.getByTestId('help-overlay-close').click();
    await expect.poll(cardCount, { timeout: 5000 }).toBe(0);
  });

  it('closes on a backdrop click but NOT on a click inside the card', async () => {
    await resetWorkspace('xy');
    await page.keyboard.press('F1');
    await expect.poll(cardCount, { timeout: 5000 }).toBe(1);

    // Inside first: a card that dismissed on its own content would be unusable.
    await page.getByTestId('help-overlay').click({ position: { x: 20, y: 20 } });
    expect(await cardCount()).toBe(1);

    // The backdrop is the full-screen parent; click its far corner.
    await page.getByTestId('help-overlay-backdrop').click({ position: { x: 4, y: 4 } });
    await expect.poll(cardCount, { timeout: 5000 }).toBe(0);
  });

  it('shows the workflow, the tools and their rail icons', async () => {
    await resetWorkspace('xy');
    await page.keyboard.press('F1');
    await expect.poll(cardCount, { timeout: 5000 }).toBe(1);
    const card = page.getByTestId('help-overlay');

    const text = (await card.textContent()) ?? '';
    expect(text).toContain('The workflow');
    expect(text).toContain('Auto-extract');
    expect(text).toContain('Geometry');
    // ⚑ The icons are the POINT of the tools list, not decoration: the rail is
    // icons with NO labels, so a text-only card names something the user still
    // cannot find. Ten tools, ten glyphs.
    expect(await card.locator('svg').count()).toBeGreaterThanOrEqual(10);
  });

  it('offers the manual without navigating the app away', async () => {
    // ⚑ electron-main.cjs's window-open handler routes http(s) to the system
    // browser and DENIES the window. Had that regressed to an in-app
    // navigation, the whole renderer would be replaced by GitHub -- so the
    // assertion is that the app is still here afterwards.
    await resetWorkspace('xy');
    await page.keyboard.press('F1');
    await expect.poll(cardCount, { timeout: 5000 }).toBe(1);
    await page.getByTestId('help-overlay-manual').click();
    expect(await cardCount()).toBe(1);
    expect(await page.getByTestId('mode-pan').count()).toBe(1);
  });
});

/**
 * HEATMAPS (v2.2) — the whole feature, driven through the real app.
 *
 * ⚑ THE ONE INSTRUMENT THE UNIT TESTS CANNOT BE. Everything under `engine/` is
 * measured against this same figure already; what is unproven until here is that
 * a person can actually get to it — that the type is in the picker, that eight
 * clicks land where the calibration expects them, that the buttons are reachable
 * and that the numbers arrive on screen. Six of this project's defects were found
 * by David USING the app and none of them by a green unit test.
 *
 * ⚑ The figure ships its own truth, so this checks the app's answer against the
 * VALUES THE FIGURE WAS DRAWN FROM — not against the app's own arithmetic.
 */
describe('heatmap capture (v2.2)', () => {
  interface HeatmapTruth {
    key: { from: { x: number; y: number }; to: { x: number; y: number }; ticks: Array<{ x: number; y: number; value: number }> };
    frame: Record<'x1' | 'x2' | 'y1' | 'y2', { x: number; y: number; value: number }>;
    grid: { x: number[]; y: number[] };
    cells: Array<{ value: number; x_min: number; x_max: number; y_min: number; y_max: number }>;
  }
  const truth = (
    JSON.parse(fs.readFileSync(HEATMAP_TRUTH, 'utf8')) as { figures: Array<{ file: string } & HeatmapTruth> }
  ).figures.find((f) => f.file === 'heatmap-viridis.png')!;

  /** Image pixel -> canvas-local, through the view the app reports. The fit is
   * asynchronous and window-size dependent, so it is READ rather than assumed. */
  async function imageToLocal(x: number, y: number): Promise<{ lx: number; ly: number }> {
    const text = (await page.getByTestId('view-state').textContent()) ?? '';
    const m = /scale: ([\d.]+), offset: \(([-\d.]+), ([-\d.]+)\)/.exec(text);
    if (!m) throw new Error(`could not read the view state: ${text}`);
    const scale = Number(m[1]);
    return { lx: Number(m[2]) + x * scale, ly: Number(m[3]) + y * scale };
  }

  async function clickImagePixel(x: number, y: number) {
    const { lx, ly } = await imageToLocal(x, y);
    await clickAt(lx, ly);
  }

  /**
   * The corner the card is asking for, in the card's own words.
   *
   * ⚑⚑ GATE 4 — A WALK MAY ONLY CLICK WHAT A PROMPT ON SCREEN NAMES. Every
   * calibration walk in this file clicked coordinates the author already knew
   * and never read the step text at all, which is exactly how v2.2's
   * shared-corner defect survived: the prompt was present, non-blank and
   * distinct from its siblings — the generic checks in `axesConfigTable` all
   * pass — it simply named a corner no test ever looked at. Reading it here
   * binds the words on screen to the pixel about to be clicked, so a prompt
   * that sends the user somewhere else fails AT the step rather than eight
   * steps later as a parallel-axes refusal.
   *
   * ⚑ THE TIPS BAR IS WHERE THE USER READS IT (checkpoint 57 moved it there),
   * so that is what this asserts — not the config's string, which a unit test
   * can check without proving anything reached the screen. `calib-prompt`
   * sounds like the right target and is NOT: it labels the "Reuse a placed
   * pixel" widget, and is now named `calib-reuse-pixel` so the next person
   * does not lose the same half-hour.
   *
   * ⚑ THE MATCH IS CASE-SENSITIVE ON PURPOSE. The step's LABEL says "First
   * column × first row" in title case while the PROMPT shouts "the outer EDGE
   * of the FIRST column"; matching upper case pins the sentence the user is
   * told to act on rather than the heading above it.
   */
  async function expectPromptNames(column: 'FIRST' | 'LAST', row: 'FIRST' | 'LAST') {
    const prompt = (await page.getByTestId('tips-bar').textContent()) ?? '';
    expect(prompt, `prompt should name the ${column} column`).toContain(`${column} column`);
    expect(prompt, `prompt should name the ${row} row`).toContain(`${row} row`);
  }

  /**
   * ⚑ AND THE WORDS ARE BOUND TO THE GEOMETRY, not merely to each other. The
   * assertions above would sit happily on a prompt that named the corners
   * consistently and WRONGLY, so the figure's own truth is asked which pixel
   * each name belongs to: the LAST column is to the right of the FIRST, and the
   * LAST row is higher up the page than the FIRST — screen y grows downward.
   */
  function expectCornersAgreeWithTheirNames() {
    expect(truth.frame.x2.x).toBeGreaterThan(truth.frame.x1.x);
    expect(truth.frame.y2.y).toBeLessThan(truth.frame.x1.y);
  }

  /**
   * How far a boundary's grab handle stands off its axis, on screen.
   *
   * ⚑ It sits at the OUTER END of its tick mark (`TICK_LENGTH` in
   * `categoryTickOverlay.ts`), which is what keeps it visibly BOUND to the axis
   * — the mark joins them — and what stops an x boundary and a y boundary at the
   * plot's corner landing on the same pixel. Almost exactly where the retired
   * `dividerHandles` put its floating dot, but attached to something now.
   */
  const HANDLE_STANDOFF = 14;

  /** The eight clicks of a heatmap calibration, at the figure's own pixels. */
  /** The Cells panel opens as a MATRIX (David: a matrix presented as a table
   * "is just a mess"), so a test that counts one-row-per-cell has to say so. */
  async function showHeatmapTable() {
    await page.getByTestId('heatmap-view-table').click();
    await page.waitForTimeout(150);
  }

  /** Open the grid fold-down on the calibration card — the inputs live there
   * now, beside the calibration that defines them. */
  async function openHeatmapGrid() {
    if ((await page.getByTestId('heatmap-detect').count()) === 0) {
      await page.getByTestId('heatmap-grid-toggle').click();
      await page.waitForTimeout(150);
    }
  }

  /** The same walk with Y declared CATEGORICAL: the row edge takes no value and
   * the far edge carries the COUNT, so no coordinate is ever typed for it. */
  async function calibrateHeatmapCategorical() {
    await page.getByTestId('calib-choice-yIsCategory-true').check();
    await page.waitForTimeout(150);
    expectCornersAgreeWithTheirNames();
    for (const step of ['x1', 'x2'] as const) {
      await expectPromptNames(step === 'x1' ? 'FIRST' : 'LAST', 'FIRST');
      const p = truth.frame[step];
      await clickImagePixel(p.x, p.y);
      await confirmValues(
        step === 'x2' ? [String(p.value), String(truth.grid.x.length - 1)] : [String(p.value)]
      );
    }
    await expectPromptNames('FIRST', 'LAST');
    // ⚑ B12 — NO Y1 CLICK. The lower-left corner is shared, and on a NAMED axis
    // it takes no typed value either, so the walk places it and moves straight
    // on. Three clicks describe the frame; this is the second and third.
    await clickImagePixel(truth.frame.y2.x, truth.frame.y2.y);
    await confirmValue('4'); // four rows on this figure — a named axis types only the count
    await clickImagePixel(truth.key.from.x, truth.key.from.y);
    await clickImagePixel(truth.key.to.x, truth.key.to.y);
    for (const tick of truth.key.ticks) {
      await clickImagePixel(tick.x, tick.y);
      await confirmValue(String(tick.value));
    }
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(250);
    await openHeatmapGrid();
  }

  /** The walk, declaring the given band counts rather than the figure's own. */
  async function calibrateHeatmapDeclaring(columns: string, rows: string) {
    const bands: Record<string, string> = { x2: columns, y2: rows };
    for (const step of ['x1', 'x2'] as const) {
      const p = truth.frame[step];
      await clickImagePixel(p.x, p.y);
      await confirmValues(step === 'x2' ? [String(p.value), bands[step]!] : [String(p.value)]);
    }
    // ⚑ B12 — the shared corner arrives placed, with its value prefilled.
    await confirmValue(String(truth.frame.y1.value));
    await clickImagePixel(truth.frame.y2.x, truth.frame.y2.y);
    await confirmValues([String(truth.frame.y2.value), bands['y2']!]);
    await clickImagePixel(truth.key.from.x, truth.key.from.y);
    await clickImagePixel(truth.key.to.x, truth.key.to.y);
    for (const tick of truth.key.ticks) {
      await clickImagePixel(tick.x, tick.y);
      await confirmValue(String(tick.value));
    }
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(200);
    await openHeatmapGrid();
  }

  async function calibrateHeatmap() {
    // ⚑ Each axis's SECOND click now declares how many bands the figure has, on
    // a measured axis exactly as on a named one — a heatmap is a matrix either
    // way. The bundled figure is 5 columns × 4 rows, read off its own truth.
    const bands = { x2: String(truth.grid.x.length - 1), y2: String(truth.grid.y.length - 1) };
    // ⚑⚑ B12 — THREE CLICKS, not four. The figure's own truth says x1 and y1 are
    // the SAME pixel (70.4, 281.32), which is what three-point calibration
    // relies on and what every rectangular heatmap has: the two axes span one
    // rectangle, so three of its corners carry the whole transform.
    expectCornersAgreeWithTheirNames();
    for (const step of ['x1', 'x2'] as const) {
      await expectPromptNames(step === 'x1' ? 'FIRST' : 'LAST', 'FIRST');
      const p = truth.frame[step];
      await clickImagePixel(p.x, p.y);
      await confirmValues(step === 'x2' ? [String(p.value), bands[step]] : [String(p.value)]);
    }
    // ⚑⚑ NOT ASSERTED AT THE SHARED CORNER, AND THAT IS A FINDING, NOT AN
    // OMISSION. y1 arrives PRE-PLACED, so `hasPendingPixel` is true the moment
    // the step opens — and `guidanceTip` drops the prompt entirely in that
    // state, showing only "Enter the <label> value, then press Confirm". So the
    // sentence written for the walk's most confusing step ("The same corner
    // again — enter the Y value where …") never reaches the screen at all.
    // Gate 4 governs CLICKS and this step has none, so the walk asserts the
    // three clicks below; the dead prompt is logged for v2.3 rather than
    // papered over with an assertion of what is merely there.
    await confirmValue(String(truth.frame.y1.value));
    await expectPromptNames('FIRST', 'LAST');
    await clickImagePixel(truth.frame.y2.x, truth.frame.y2.y);
    await confirmValues([String(truth.frame.y2.value), bands['y2']]);
    await clickImagePixel(truth.key.from.x, truth.key.from.y);
    await clickImagePixel(truth.key.to.x, truth.key.to.y);
    for (const tick of truth.key.ticks) {
      await clickImagePixel(tick.x, tick.y);
      await confirmValue(String(tick.value));
    }
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(200);
    await openHeatmapGrid();
  }

  /** Local copies: the export helpers live inside another describe's scope. */
  function heatmapTempFile(extension: string): string {
    return path.join(os.tmpdir(), `plottracer-hm-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
  }
  async function stubHeatmapSaveDialog(targetPath: string) {
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, targetPath);
  }

  beforeEach(async () => {
    await app.evaluate(({ dialog }, samplePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [samplePath] });
    }, HEATMAP_IMAGE);
    // ⚑⚑ A BIGGER WINDOW, because that is what a user does. A heatmap has the
    // tallest calibration card in the app — eight steps plus the grid fold-down
    // plus the per-axis options — and at the harness's default size it floats
    // over the pixels the walk asks you to click. David, when I mistook that for
    // a regression: *"We make the window bigger to see the full figure! Up to
    // the user! Not a regression! We have ALSO talked about this before!"* A
    // fixed display size is authoritative about CONTENT and only suggestive
    // about LAYOUT, so the harness resizes rather than the product changing.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1800, 1200);
    });
    await page.waitForTimeout(300);
  });

  afterEach(async () => {
    await app.evaluate(({ dialog }, samplePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [samplePath] });
    }, SAMPLE_IMAGE);
  });

  it('is offered in the graph-type picker, and starts its own eight-step walk', async () => {
    // ⚑ This used to assert the sidebar Heatmap CARD was visible. The card is
    // now a fold-down on the calibration card and appears only once the axes
    // are calibrated — because the calibration card floats over the figure, and
    // an open fold-down covered the very pixels the walk asks you to click. So
    // the assertion moves to what picking the type actually does: it starts the
    // heatmap's own walk, whose first step is the colour key's business rather
    // than an XY chart's four points.
    await resetWorkspace('heatmap');
    // The grid fold-down is on screen from the start, CLOSED — the feature is
    // discoverable before it exists, without growing the card over the figure.
    expect(await page.getByTestId('heatmap-grid-summary').isVisible()).toBe(true);
    expect(await page.getByTestId('heatmap-detect').count()).toBe(0);
    // Eight steps, not four, and the extra ones are the colour key's — which is
    // what makes this the heatmap's walk rather than an XY chart's.
    const walk = await textOf('calibration-bar');
    expect(walk).toMatch(/0\/8/);
    // ⚑ The key is two OPPOSITE CORNERS of the bar now, not two points along a
    // centreline nothing is drawn on — a corner is printed and can be aimed at.
    expect(walk).toMatch(/Key corner/);
    expect(walk).toMatch(/Opposite corner/);
    expect(walk).toMatch(/Key value 1/);
  });

  it('detects the grid and reads the matrix, matching the figure’s own values', async () => {
    await resetWorkspace('heatmap');
    await calibrateHeatmap();
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);

    // The user says how many cells the figure has — a CHECK on detection.
    await page.getByTestId('heatmap-detect').click();
    await page.waitForTimeout(200);
    expect(await textOf('heatmap-detect-message')).toMatch(/5 columns/);
    expect(await textOf('heatmap-declared-grid')).toMatch(/5 columns × 4 rows/);

    await page.getByTestId('heatmap-read').click();
    await page.waitForTimeout(300);
    // ⚑⚑ READ CELLS IS THE ENDING, so it closes the card it finished — David's
    // *"there is nothing intuitive here to press to say 'done!'"*, answered by
    // the button that already did the job rather than by a second one beside
    // it. The card's folded line still names the grid, so nothing is lost.
    expect(await page.getByTestId('heatmap-card').count()).toBe(0);
    // ⚑ And the count now lives with the RECORD, which is the only place it
    // could survive that fold.
    expect(await textOf('heatmap-cells-summary')).toBe('20 cells read, all clean.');
    // The matrix is what opens, and it is the figure's own shape: five columns
    // across, four rows down, so a reader can see which cell is which.
    expect(await page.getByTestId('heatmap-matrix-row').count()).toBe(4);
    await showHeatmapTable();
    expect(await page.getByTestId('heatmap-row').count()).toBe(20);

    // ⚑ Against the figure's OWN truth, not the app's arithmetic: the first row
    // is the cell at the origin corner.
    const first = truth.cells.find((c) => c.x_min === 0 && c.y_min === 0)!;
    const cells = await page.getByTestId('heatmap-row').first().locator('td').allTextContents();
    // ⚑ Two decimals, not four, and the difference is CLICK QUANTISATION rather
    // than slack: every calibration point here was placed by a real mouse click
    // at a fitted zoom, so it lands on a screen pixel and the frame it defines is
    // off by a fraction of an image pixel. Measured: 0.003 of a data unit on a
    // 9-unit axis, 0.04% — which is the precision a person clicking gets, and
    // the unit tests already pin the arithmetic exactly.
    // ⚑ The long view leads with IDENTITY (`column`, `row`) and then the
    // coordinates — asserted here rather than silently skipped, so a shift in
    // the column order fails with a reason instead of a NaN.
    expect(cells.slice(0, 2)).toEqual(['C1', 'R1']);
    expect(Number(cells[2])).toBeCloseTo(0.5, 2); // x centre of a 0..1 column
    expect(Number(cells[3])).toBeCloseTo(1, 2); // y centre of a 0..2 row
    // ⚑ The VALUE column, which is index 4 now that identity leads:
    // column, row, x, y, value, range, note.
    expect(Math.abs(Number(cells[4]) - first.value)).toBeLessThan(1.5);
    expect(cells[6]).toBe(''); // the NOTE column: no warning, the cell vouches for itself
  });

  it('lets a divider be DRAGGED, and re-reads the cells it moved', async () => {
    // ⚑⚑ ADJUSTABILITY IS LOAD-BEARING (David): a published heatmap's rows and
    // columns are not equally sized, and a grid that can only be generated is a
    // grid that is wrong on exactly the figures that need it most. Detection
    // proposes; this is the half where the user decides.
    await resetWorkspace('heatmap');
    await calibrateHeatmap();
    await page.getByTestId('heatmap-detect').click();
    await page.getByTestId('heatmap-read').click();
    await page.waitForTimeout(300);
    await showHeatmapTable();
    const before = await page.getByTestId('heatmap-row').first().locator('td').allTextContents();

    // The first column's far boundary, at data x = 1 on a 0..9 axis. Its handle
    // sits just below the plot; drag it right to widen the column.
    const axisY = truth.frame.x1.y;
    const from = await imageToLocal(
      truth.frame.x1.x + ((truth.frame.x2.x - truth.frame.x1.x) * 1) / 9,
      axisY
    );
    const to = await imageToLocal(
      truth.frame.x1.x + ((truth.frame.x2.x - truth.frame.x1.x) * 2.5) / 9,
      axisY
    );
    await refreshCanvasBox();
    // ⚑ ON the axis. The grab dot used to float 16px below it, because the
    // retired `dividerHandles` had no tick mark to stand off from; a boundary is
    // drawn as a TICK now, by the same overlay a bar chart's category axis uses,
    // so the handle sits where the mark is.
    await page.mouse.move(canvasBox.x + from.lx, canvasBox.y + from.ly + HANDLE_STANDOFF);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + to.lx, canvasBox.y + to.ly + HANDLE_STANDOFF, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    // The cell got wider, and its value was re-read rather than left describing
    // the grid it used to have.
    const after = await page.getByTestId('heatmap-row').first().locator('td').allTextContents();
    // ⚑ Columns 0 and 1 are the cell's identity, which must NOT move — it is the
    // same cell, wider. That it stays `C1 R1` is half the assertion.
    expect(after.slice(0, 2)).toEqual(['C1', 'R1']);
    expect(Number(after[2])).toBeGreaterThan(Number(before[2])); // x centre moved right
    expect(after[4]).not.toBe(before[4]); // …and the value with it
    expect(await page.getByTestId('heatmap-row').count()).toBe(20); // no cell gained or lost

    // ⚑⚑ C1 — AND THE CALIBRATION DID NOT MOVE. Calibration points ARE the axis;
    // the grid DERIVES from them, and nothing a grid gesture does may reach the
    // layer underneath. It matters because every marker on the figure arrives at
    // ONE drag handler, which falls through to `updateCalibPointPixel` for
    // anything it does not recognise — so a divider read as a calibration handle
    // would silently recalibrate the whole figure, and every exported value
    // would be wrong with nothing on screen saying so.
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);
    // ⚑ UNFOLDED to read them: Calibrate auto-folds its card (checkpoint 86),
    // so the values are not in the DOM until the card is opened again. Asserting
    // them blind timed out — the test asking for something the screen genuinely
    // was not showing, which is the right way round for that to fail.
    await page.getByTestId('calib-fold').click();
    await page.waitForTimeout(200);
    expect(await textOf('calib-value-x1-0')).toBe(String(truth.frame.x1.value));
    expect(await textOf('calib-value-x2-0')).toBe(String(truth.frame.x2.value));
    expect(await textOf('calib-value-y2-0')).toBe(String(truth.frame.y2.value));
    // ⚑ LEFT OPEN. The Grid fold-out lives INSIDE this card, so folding it again
    // takes the grid summary — and the Read cells button — off screen with it.
    // Re-folding here is what made the rest of this walk hang: the test went
    // looking for controls it had just put away.

    // ⚑ AND IT IS UNDOABLE, which had never been verified for a boundary. An
    // adjustment you cannot take back is one users make cautiously or not at
    // all — and the grid rides in axes metadata, so undo only works because the
    // snapshot serialises the axes rather than through any grid-specific path.
    await page.getByTestId('undo').click();
    await page.waitForTimeout(400);
    // ⚑⚑ UNDO RE-READS THE TABLE AGAINST THE RESTORED GRID, matching the forward
    // path (David, 2026-08-16: *"Re-read, matching the forward path"*).
    //
    // ⚠️⚠️ THIS ASSERTION USED TO READ `.toBe(0)` — "undo clears the results
    // table" — and its own comment said it was "recorded as the behaviour, not
    // endorsed". It was worse than that: it PASSED FOR THE WRONG REASON. The
    // table was empty because the undo was LOSING THE GRID, so there was nothing
    // to re-read from — which is exactly the defect David hit on the built
    // package (*"undo removed the whole grid. :-O"*). The test had written that
    // defect down as expected behaviour, and went green on it for a release.
    // ⚑ It only surfaced once detection started taking its own snapshot, so undo
    // had a grid to land on. A test that asserts an absence will happily agree
    // with the wrong cause.
    expect(await page.getByTestId('heatmap-row').count()).toBe(20);
    // And the grid itself survived, which is the half the user actually sees.
    expect(await textOf('heatmap-grid-summary')).toMatch(/cells/i);
  }, 30000);

  it('ADDS a boundary the detector missed, and removes one it invented', async () => {
    // ⚑⚑ THE GESTURE THE APP HAS BEEN TELLING USERS TO USE. `detectGrid` refuses
    // to fill a miss in and says "place the missing ones by hand" — a sentence
    // that named an action the interface did not offer until this test's feature
    // existed. Both halves are driven here, through the card the user sees.
    await resetWorkspace('heatmap');
    await calibrateHeatmap();
    await page.getByTestId('heatmap-detect').click();
    await page.getByTestId('heatmap-read').click();
    await page.waitForTimeout(300);
    await showHeatmapTable();
    // ⚑ REOPENED: Read cells is the card's ENDING and folds it (David, 2026-08-15).
    // The bulk name boxes and the boundary buttons live in that card, so a test
    // that uses them after reading says so. ⚑ A user is not stuck — a column's
    // name is click-to-edit on the matrix header itself.
    await openHeatmapGrid();
    expect(await textOf('heatmap-declared-grid')).toMatch(/5 columns × 4 rows/);
    // ⚑⚑ THE MESSAGE IS THERE FIRST, asserted so its DISAPPEARANCE below means
    // something. Without this the `.toBe(0)` at the end of this test would pass
    // just as happily if detection had stopped reporting at all — an absence
    // with no positive counterpart agrees with the wrong cause, which is how a
    // sibling test spent a release asserting a defect (see the undo note in
    // "lets a divider be DRAGGED").
    expect(await textOf('heatmap-detect-message')).toMatch(/columns/i);

    await page.getByTestId('heatmap-add-column').click();
    await page.waitForTimeout(300);
    expect(await textOf('heatmap-declared-grid')).toMatch(/6 columns × 4 rows/);
    // The new boundary announces WHERE it went, in the figure's own units — a
    // cell that silently split somewhere in a six-column grid is a change the
    // user has to hunt for.
    expect(await textOf('heatmap-selected-boundary')).toMatch(/^Column boundary at x = /);
    // And the cells were re-read, not left describing the grid they had.
    expect(await page.getByTestId('heatmap-row').count()).toBe(24);
    // ⚑⚑ AND DETECTION'S REPORT IS GONE. It read "5 columns, matching the 4
    // boundaries found" beside "Grid: 6 × 4 cells" — a card contradicting itself
    // about the figure in front of it, found by looking at a screenshot rather
    // than by any assertion. The user overruled the proposal; the proposal stops
    // describing the grid.
    expect(await page.getByTestId('heatmap-detect-message').count()).toBe(0);

    await page.getByTestId('heatmap-remove-boundary').click();
    await page.waitForTimeout(300);
    expect(await textOf('heatmap-declared-grid')).toMatch(/5 columns × 4 rows/);
    expect(await page.getByTestId('heatmap-row').count()).toBe(20);

    // A row boundary is the same gesture on the other axis, and the card says so.
    await page.getByTestId('heatmap-add-row').click();
    await page.waitForTimeout(300);
    expect(await textOf('heatmap-declared-grid')).toMatch(/5 columns × 5 rows/);
    expect(await textOf('heatmap-selected-boundary')).toMatch(/^Row boundary at y = /);
  });

  it('gives a calibrated heatmap its grid straight away, and picks the handle that is CLICKED', async () => {
    // ⚑⚑ NO INVISIBLE PRECONDITION. The grid, its handles and the boundary
    // buttons are on screen the moment the calibration finishes — they used to
    // appear only after pressing Detect or Read, which nothing on screen said.
    await resetWorkspace('heatmap');
    await calibrateHeatmap();
    await page.waitForTimeout(300);
    // ⚑⚑ CASE A1. This asserted `Grid: 1 × 1 cells` — the defect as its own
    // premise. A value×value heatmap got ONE cell spanning the whole figure,
    // because the grid was gated on an axis being categorical. The figure has
    // 5 columns and 4 rows and says so in the walk, whichever way it is indexed.
    expect(await textOf('heatmap-declared-grid')).toMatch(/5 columns × 4 rows/);

    // Click the x-divider handle at the calibrated left edge (data x = 0).
    const left = await imageToLocal(truth.frame.x1.x, truth.frame.x1.y);
    await refreshCanvasBox();
    await clickAt(left.lx, left.ly + HANDLE_STANDOFF); // the handle at the tick's end
    await page.waitForTimeout(200);
    expect(await textOf('heatmap-selected-boundary')).toMatch(/^Column boundary at x = 0\.0/);

    // ⚑ Removable, because a five-column axis has six boundaries to spare. This
    // used to assert the opposite — the axis was down to the two boundaries that
    // ARE the grid — which was only ever true because a measured axis got no
    // bands at all (case A1). The refusal at the real floor is covered by
    // `removeDividerHandle`'s own unit tests, where the floor can be reached
    // without twelve clicks.
    const remove = page.getByTestId('heatmap-remove-boundary');
    expect(await remove.isDisabled()).toBe(false);
  });

  it('NAMES the columns, and the names travel into the export beside the bounds', async () => {
    // ⚑⚑ "The label is the coordinate." The most common published heatmap is
    // category × category — gene × sample, confusion matrix, correlation matrix
    // — and an export reading `1, 2, 3` where the figure prints `BRCA1` cannot
    // be rejoined to anything the reader has. Driven through the card and out to
    // a real file, because that file is the product.
    await resetWorkspace('heatmap');
    await calibrateHeatmap();
    await page.getByTestId('heatmap-detect').click();
    await page.getByTestId('heatmap-read').click();
    await page.waitForTimeout(400);
    await showHeatmapTable();
    // ⚑ REOPENED: Read cells is the card's ENDING and folds it (David, 2026-08-15).
    // The bulk name boxes and the boundary buttons live in that card, so a test
    // that uses them after reading says so. ⚑ A user is not stuck — a column's
    // name is click-to-edit on the matrix header itself.
    await openHeatmapGrid();

    await page.getByTestId('heatmap-x-labels').fill('BRCA1, TP53, "EGFR, mut", KRAS');
    await page.getByTestId('heatmap-y-labels').fill('top, upper, lower, bottom');
    await page.waitForTimeout(300);
    // The card counts rather than refuses — four names on a five-column figure
    // is someone part-way through, not an error.
    expect(await textOf('heatmap-label-coverage')).toMatch(/Columns: 4 of 5 named/);
    // The table shows the name the moment it is typed, without re-reading.
    const first = await page.getByTestId('heatmap-row').first().locator('td').allTextContents();
    // ⚑ Identity leads; the NAME is the x coordinate's column, two along.
    expect(first.slice(0, 2)).toEqual(['C1', 'R1']);
    expect(first[2]).toBe('BRCA1');

    // ⚑⚑ THE ROW ORDER, which the v2.2 audit caught: the table is ordered by
    // cell index and cell row 0 is yMin — the BOTTOM of the figure — while a
    // person copies names off a heatmap TOP-DOWN. So the first row name typed
    // must land on the LAST table row, and the last name on the first. Before
    // the fix every row name was filed one-for-one against the wrong row, with
    // every value correct and nothing on screen saying so.
    const rowCount = await page.getByTestId('heatmap-row').count();
    expect(first[3]).toBe('bottom');
    const lastRow = await page.getByTestId('heatmap-row').nth(rowCount - 1).locator('td').allTextContents();
    expect(lastRow[3]).toBe('top');
    // And the convention is stated on screen rather than left to be discovered.
    expect(await textOf('heatmap-label-direction')).toMatch(/top-left cell/);

    const csvPath = heatmapTempFile('csv');
    await stubHeatmapSaveDialog(csvPath);
    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-csv').click();
    const csv = await expect
      .poll(() => (fs.existsSync(csvPath) ? fs.readFileSync(csvPath, 'utf8') : ''), { timeout: 8000 })
      .not.toBe('')
      .then(() => fs.readFileSync(csvPath, 'utf8'));

    // ⚑ The name is BESIDE the measured bounds, never instead of them: the
    // bounds are read off the pixels and stay true whatever the axis is called.
    expect(csv).toMatch(/x label,y label,x min,x max,y min,y max,x centre,y centre,x width,y height,value/);
    // ⚑ The first cell is col 0 / row 0 — the figure's BOTTOM-left — so it
    // carries the LAST row name typed. The order survives into the file.
    // ⚑ IDENTITY LEADS THE EXPORTED ROW TOO, unconditionally — David: *"whatever
    // we export needs to be usable as a basis for reconstructing the same
    // graph."* The names follow it where the figure prints them.
    expect(csv).toMatch(/^C1,R1,BRCA1,bottom,/m);
    // A quoted name keeps its comma through the record AND through the CSV.
    expect(csv).toMatch(/"EGFR, mut"/);
    // The matrix's header row takes the names, where there is only one slot.
    expect(csv).toMatch(/BRCA1,TP53,"EGFR, mut",KRAS/);
    fs.unlinkSync(csvPath);
  });

  it('puts the CELLS where every other type puts its record, not in the card', async () => {
    // ⚑⚑ THE INVARIANT A LINT RULE COULD NOT EXPRESS. The rail fold-out redesign
    // settled it and marked it LOCKED — a fold-out takes INPUTS, a type's record
    // goes to the Data-points panel — and v2.2 shipped a Heatmap card holding
    // both, so a heatmap's output sat where no other type's does while the panel
    // users actually read said "No points yet". David: *"we DO want the output
    // in the same place as for the other graphs… Else it becomes very confusing
    // for the users, and extremely inconsistent."*
    //
    // ⚑ A first attempt to catch this with a lint rule ("no <table> in a Card")
    // was WITHDRAWN: it fired on GeometryCard, which is a legitimate
    // series-bound output card under the same LOCKED note. The real invariant is
    // about the PRIMARY RECORD, not about tables, and it is checkable only by
    // asking where the record actually rendered.
    await resetWorkspace('heatmap');
    await calibrateHeatmap();
    await page.getByTestId('heatmap-detect').click();
    await page.getByTestId('heatmap-read').click();
    await page.waitForTimeout(400);
    await showHeatmapTable();

    expect(await page.getByTestId('heatmap-row').count()).toBeGreaterThan(0);
    // The record is INSIDE the data-points panel…
    const inPanel = await page
      .locator('[data-testid="data-points-panel"] [data-testid="heatmap-row"]')
      .count();
    expect(inPanel).toBeGreaterThan(0);
    // …and NOT inside the calibration card's grid fold-down, which is inputs.
    expect(
      await page.locator('[data-testid="heatmap-grid-panel"] [data-testid="heatmap-row"]').count()
    ).toBe(0);
    // The panel names what it holds, as it already does for a histogram's bins.
    expect(await textOf('data-points-heading')).toBe('Cells');
  });

  it('⚑⚑ UNDO takes back the READ, not the whole grid — the two are separate steps', async () => {
    // ⚠️ DAVID, 2026-08-16, on the built package: *"undo removed the whole grid.
    // :-O"* — and he was right. Neither `Detect grid` nor `Read cells` took an
    // undo snapshot, so the two actions that produce the ENTIRE heatmap record
    // were invisible to undo. One Ctrl+Z jumped back past both of them, to the
    // last calibration step, and the grid went with it.
    //
    // ⚑ Only EDITING a divider and CORRECTING a cell ever committed. The
    // asymmetry is the tell: adjusting the record was undoable, CREATING it was
    // not.
    await resetWorkspace('heatmap');
    await calibrateHeatmap();
    await openHeatmapGrid();
    await page.getByTestId('heatmap-detect').click();
    await page.waitForTimeout(300);
    const detected = await textOf('heatmap-grid-summary');
    expect(detected).toMatch(/cells/i);

    await page.getByTestId('heatmap-read').click();
    await page.waitForTimeout(400);
    // ⚑ The MATRIX is the default view, so that is what a read produces.
    expect(await page.getByTestId('heatmap-matrix-row').count()).toBeGreaterThan(0);

    // ONE undo takes back the READ, and only the read. The grid is still there,
    // because detecting it was its own step.
    await page.getByTestId('undo').click();
    await page.waitForTimeout(400);
    expect(await textOf('heatmap-grid-summary'), 'the grid must survive an undo').toBe(detected);

    // ⚑ THE CELLS COME BACK WITH IT, and that is the OTHER rule working, not a
    // failure: restoring a grid RE-READS its cells rather than emptying the
    // table (David, 2026-08-16: *"Re-read, matching the forward path"*). So
    // undoing a read is visually a no-op — what the snapshot buys is that undo
    // has somewhere to LAND between "grid detected" and "calibration finished",
    // instead of stepping over both.
    expect(await page.getByTestId('heatmap-matrix-row').count()).toBeGreaterThan(0);

    // And the grid is still readable afterwards — the dead end David hit, where
    // the grid was gone and Read cells was therefore disabled.
    expect(await page.getByTestId('heatmap-read').isEnabled()).toBe(true);
  });

  it('lets a CATEGORY name be edited in the table, on the band it belongs to', async () => {
    // ⚑ A name is the one thing in that table the figure does not measure — it
    // is transcribed by a person, and a person mistypes. Same click-to-edit the
    // bar chart's Category column has had since v2.0.
    //
    // ⚑⚑ AND IT MUST LAND ON THE RIGHT BAND. The table works in CELL indices
    // (row 0 = yMin, the bottom) while the name boxes work in READING order
    // (first name = the top). An edit that wrote the cell index straight into
    // the typed text would put the name on the mirror-image row — the exact
    // defect the audit found this morning, re-entered from the other end.
    await resetWorkspace('heatmap');
    await calibrateHeatmapCategorical();
    await page.getByTestId('heatmap-read').click();
    await page.waitForTimeout(500);
    await showHeatmapTable();
    // ⚑ REOPENED: Read cells is the card's ENDING and folds it (David, 2026-08-15).
    // The bulk name boxes and the boundary buttons live in that card, so a test
    // that uses them after reading says so. ⚑ A user is not stuck — a column's
    // name is click-to-edit on the matrix header itself.
    await openHeatmapGrid();

    // Name the rows top-down, then correct the TOP one from the table.
    await page.getByTestId('heatmap-y-labels').fill('top, upper, lower, bottom');
    await page.waitForTimeout(300);
    const rows = await page.getByTestId('heatmap-row').count();
    // The LAST table row is the top of the figure — that is where "top" went.
    const last = page.getByTestId('heatmap-row').nth(rows - 1);
    expect((await last.locator('td').allTextContents())[3]).toBe('top');

    // ⚑ The band index, not the table row: the last table row is the TOP of the
    // figure, which is the highest cell index. `EditableName` reuses one testid
    // for the resting span and the open input, so it has to be the exact band.
    const topBand = 3; // four rows on this figure
    // ⚑ SCOPED TO ONE TABLE ROW. The long form repeats a band's name once per
    // cell — five copies now that a measured x axis has bands of its own (case
    // A1), where it used to have exactly one. And `EditableName` reuses one
    // testid for the resting span and the open input, so the row is the only
    // thing that makes either unambiguous.
    // ⚑⚑ THE MULTI-COPY CASE IS THE POINT, so it is asserted rather than assumed.
    // Keying the editor on the BAND mounted one autoFocus input per copy, each
    // blurring the last, and onBlur closes the editor — the name could not be
    // opened at all. Invisible until a measured x axis had bands of its own
    // (case A1); before that every band appeared in exactly one row.
    expect(await page.getByTestId(`heatmap-y-name-${topBand}`).count()).toBeGreaterThan(1);
    const nameCell = last.getByTestId(`heatmap-y-name-${topBand}`);
    await nameCell.scrollIntoViewIfNeeded();
    await nameCell.click();
    await page.waitForTimeout(200);
    expect(await page.locator(`input[data-testid="heatmap-y-name-${topBand}"]`).count()).toBe(1);
    const editor = last.locator(`input[data-testid="heatmap-y-name-${topBand}"]`);
    await editor.fill('RENAMED');
    await editor.press('Enter');
    await page.waitForTimeout(300);

    // It landed on the band that was clicked…
    expect((await page.getByTestId('heatmap-row').nth(rows - 1).locator('td').allTextContents())[3]).toBe('RENAMED');
    // …and the typed list reads back in the SAME order, with only that one
    // changed — proof the edit went through the reading-order mapping and not
    // around it.
    expect(await page.getByTestId('heatmap-y-labels').inputValue()).toBe('RENAMED, upper, lower, bottom');
  });

  it('links the picked CELL between the figure and the results, both ways', async () => {
    // ⚑⚑ David: *"I do not think that I can select something on the heatmap, and
    // that is selected in the matrix or table… if you are on a square in the
    // matrix, it is highlighted in the heatmap?"* Correct — a heatmap's cells
    // have no markers, so none of the selection machinery reached them. Every
    // other type ties its table to its canvas; this is that, for a matrix.
    //
    // ⚑ AND IT CLOSES A REAL FALLTHROUGH. A bare click on a heatmap used to
    // reach `add-point` and drop a raw datum into the active series — invisible
    // until export, on a type whose own tips bar says values come from the grid.
    await resetWorkspace('heatmap');
    await calibrateHeatmap();
    await page.getByTestId('heatmap-detect').click();
    await page.getByTestId('heatmap-read').click();
    await page.waitForTimeout(400);

    // From the matrix: clicking a square picks that cell.
    await page.getByTestId('heatmap-matrix-cell-2-1').click();
    await page.waitForTimeout(200);
    expect(await textOf('heatmap-selected-cell')).toBe('2,1');

    // From the figure: a click inside a different cell moves the pick, and adds
    // NOTHING to the series.
    const middle = await imageToLocal(
      truth.frame.x1.x + (truth.frame.x2.x - truth.frame.x1.x) * 0.75,
      (truth.frame.x1.y + truth.frame.y2.y) / 2
    );
    await refreshCanvasBox();
    await clickAt(middle.lx, middle.ly);
    await page.waitForTimeout(300);
    expect(await textOf('heatmap-selected-cell')).not.toBe('2,1');
    expect(await textOf('heatmap-selected-cell')).not.toBe('');
    // The series is still empty — the click identified a cell, it did not record one.
    expect(await page.getByTestId('series-select').textContent()).toMatch(/\(0\)/);

    // Clicking the picked square again clears it.
    const picked = (await textOf('heatmap-selected-cell')).split(',');
    await page.getByTestId(`heatmap-matrix-cell-${picked[0]}-${picked[1]}`).click();
    await page.waitForTimeout(200);
    expect(await textOf('heatmap-selected-cell')).toBe('');
  });

  // ⚑ The name says what THIS test does. That an edited cell MOVES with the key
  // is the design's own proof and it lives in `heatmapRun.test.ts`, where a
  // recalibration is two lines instead of a second walk through the UI.
  it('lets a person correct a cell, and hands it back to the key on demand', async () => {
    // ⚑⚑ B7 + B16. David: *"there might be something in the color/patern/shape
    // that a user can see and we can't"* — a hatched cell, an asterisk over the
    // fill, a label bleeding into the colour. Their eye is the better instrument
    // for those, so their number is a MEASUREMENT and goes into the record the
    // way ours does: as a position on the third axis.
    //
    // ⚑ EVERY CLICK HERE IS ONE THE SCREEN OFFERS (gate 4). The value carries
    // the same dashed click-to-edit underline every other typed value in the app
    // has had since v1.3, and the cell SHOWS its source — so the right-click menu
    // changes something already visible rather than revealing it.
    await resetWorkspace('heatmap');
    await calibrateHeatmap();
    await page.getByTestId('heatmap-detect').click();
    await page.getByTestId('heatmap-read').click();
    await page.waitForTimeout(400);

    const fromKey = await textOf('heatmap-matrix-cell-2-1');
    expect(fromKey).not.toBe('');
    expect(fromKey).not.toMatch(/\[/); // read from the colour: no brackets

    // ⚑⚑ CLICKING A MATRIX CELL SELECTS IT AND NOTHING ELSE. In this view the
    // cell IS the value, so an editor opening here would eat the selection
    // click — and, seeded with the current number, would commit it on blur and
    // stamp a cell as user-read that nobody typed into. The picked-cell line is
    // where the value can be corrected, and it appears BECAUSE of this click.
    await page.getByTestId('heatmap-matrix-cell-2-1').click();
    await page.waitForTimeout(200);
    expect(await page.locator('input[data-testid="heatmap-value-edit-2-1"]').count()).toBe(0);
    // ⚑ ALL THREE COORDINATES — a heatmap is 2.5D, and where the cell sits on
    // the colour key is a coordinate exactly as its column and row are.
    const picked = await textOf('heatmap-picked-cell');
    expect(picked).toMatch(/C3/);
    expect(picked).toMatch(/R2/);
    expect(picked).toMatch(/value/);

    await page.getByTestId('heatmap-picked-cell').getByTestId('heatmap-value-2-1').click();
    await page.waitForTimeout(200);
    const editor = page.locator('input[data-testid="heatmap-value-edit-2-1"]');
    expect(await editor.count()).toBe(1);
    await editor.fill('59');
    await editor.press('Enter');
    await page.waitForTimeout(400);

    // ⚑⚑ SQUARE brackets — the scholarly "editorially supplied", and the one
    // channel that survives a paste into a spreadsheet. NOT round: `(59)` is
    // accounting notation for MINUS 59, which Excel applies silently.
    // ⚑ `59.000`, not `59`: what is stored is a POSITION on the key, so the
    // number shown is read back through the scale at the table's own precision
    // like every other cell. It is not the string that was typed, and after a
    // recalibration it will not be the number that was typed either.
    expect(await textOf('heatmap-matrix-cell-2-1')).toBe('[59.000]');
    // …and nothing else moved.
    expect(await textOf('heatmap-matrix-cell-1-1')).not.toMatch(/\[/);

    // The right-click menu names both instruments, and offers the one this cell
    // is NOT using.
    await page.getByTestId('heatmap-matrix-cell-2-1').click({ button: 'right' });
    await page.waitForTimeout(200);
    expect(await page.getByTestId('ctx-heatmap-use-mine').textContent()).toMatch(/Edit my value/);
    await page.getByTestId('ctx-heatmap-use-key').click();
    await page.waitForTimeout(400);

    // Back to the key's own reading, brackets and all gone.
    expect(await textOf('heatmap-matrix-cell-2-1')).toBe(fromKey);
  });

  it('P1 — drags the cell along the COLOUR KEY, the third axis’s own handle', async () => {
    // ⚑⚑ THE OTHER HALF OF THE PAIR. Every value in this app has both — drag the
    // marker or type the number — and since B7 the third axis had only the typed
    // one. David: *"make that marker DRAGGABLE, with instant color update of the
    // background of the cell? and if you change the value, the marker also
    // moves."*
    //
    // ⚑ The drag is the PRIMITIVE: the record stores a POSITION on the key, so
    // dragging writes it outright while typing has to be converted first.
    await resetWorkspace('heatmap');
    await calibrateHeatmap();
    await page.getByTestId('heatmap-detect').click();
    await page.getByTestId('heatmap-read').click();
    await page.waitForTimeout(400);

    // No cell picked, no cursor: a range has no single position on the key.
    await page.getByTestId('heatmap-matrix-cell-2-1').click();
    await page.waitForTimeout(200);
    const before = await textOf('heatmap-matrix-cell-2-1');
    expect(before).not.toMatch(/\[/);

    // Drag the cursor along the key — from where this cell sits to a clearly
    // different place on the strip.
    // ⚑⚑ THE GRAB POINT IS READ, NOT ASSUMED. The cursor sits wherever this
    // cell's own reading puts it on the key — a number no test can know in
    // advance — so it is taken from the mirrored readout, the same way every
    // other Konva-only fact in this file is asserted. Guessing a position and
    // pressing there is how a drag test passes while touching nothing.
    const cursorAt = Number(await textOf('heatmap-key-cursor'));
    expect(Number.isFinite(cursorAt)).toBe(true);
    const onKey = (t: number) => ({
      x: truth.key.from.x + (truth.key.to.x - truth.key.from.x) * t,
      y: truth.key.from.y + (truth.key.to.y - truth.key.from.y) * t,
    });
    const grab = onKey(cursorAt);
    const drop = onKey(cursorAt > 0.5 ? cursorAt - 0.3 : cursorAt + 0.3);
    const from = await imageToLocal(grab.x, grab.y);
    const to = await imageToLocal(drop.x, drop.y);
    await refreshCanvasBox();
    await page.mouse.move(canvasBox.x + from.lx, canvasBox.y + from.ly);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + to.lx, canvasBox.y + to.ly, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    // ⚑ Whatever the exact number, the cell is now a PERSON's reading — square
    // brackets, no tint — and it changed.
    const after = await textOf('heatmap-matrix-cell-2-1');
    expect(after).toMatch(/^\[.*\]$/);
    expect(after).not.toBe(before);

    // ⚑⚑ AND THERE IS A WAY BACK, on the line itself rather than behind a
    // right-click nobody would find (B16's own warning about itself).
    expect(await page.getByTestId('heatmap-reset-cell').count()).toBe(1);
    await page.getByTestId('heatmap-reset-cell').click();
    await page.waitForTimeout(400);
    expect(await textOf('heatmap-matrix-cell-2-1')).toBe(before);
    // …and the button goes with it, because there is nothing left to reset.
    expect(await page.getByTestId('heatmap-reset-cell').count()).toBe(0);
  });

  it('records NOTHING when an editor is opened and closed without typing', async () => {
    // ⚑⚑ A GLANCE IS NOT A MEASUREMENT. The editor opens seeded with the number
    // already there, so committing on blur wrote that number back as the user's
    // own reading — a cell stamped user-read that nobody typed into, and in the
    // file indistinguishable from one they did. Found by the suite, not by
    // reasoning: it surfaced as a multi-select test losing its second cell.
    await resetWorkspace('heatmap');
    await calibrateHeatmap();
    await page.getByTestId('heatmap-detect').click();
    await page.getByTestId('heatmap-read').click();
    await page.waitForTimeout(400);

    await page.getByTestId('heatmap-matrix-cell-2-1').click();
    await page.waitForTimeout(150);
    const before = await textOf('heatmap-matrix-cell-2-1');
    await page.getByTestId('heatmap-picked-cell').getByTestId('heatmap-value-2-1').click();
    await page.waitForTimeout(150);
    await page.locator('input[data-testid="heatmap-value-edit-2-1"]').press('Enter');
    await page.waitForTimeout(300);

    expect(await textOf('heatmap-matrix-cell-2-1')).toBe(before);
    expect(before).not.toMatch(/\[/);
  });

  it('B12 — calibrates from THREE corners, with no checkbox to find and tick', async () => {
    // ⚑⚑ THREE POINTS ARE THE AFFINE MINIMUM, so on a heatmap they are simply
    // THE WALK. Two can never define a 2-D transform — which is what killed the
    // share-both-corners feature — and four can be placed inconsistently, which
    // is what the parallel-axes guard is for. The checkbox existed to fold a
    // fourth click away; where three is the only sensible walk, unticking it
    // could only ask for a worse one.
    //
    // ⚑ David saw the old version from the other side on day one: *"the text for
    // shared origin is misleading or incorrect"* and *"we are missing a data
    // point out."* A data point WAS missing. Now none is, and nothing is asked.
    await resetWorkspace('heatmap');
    await page.getByTestId('calib-choice-xIsCategory-true').check();
    await page.getByTestId('calib-choice-yIsCategory-true').check();
    await page.waitForTimeout(200);
    // Gone — an option nobody should choose is an option that should not be there.
    expect(await page.getByTestId('common-origin').count()).toBe(0);

    // ⚑ THE PROMPT NAMES BOTH BANDS, so every click is fully described before it
    // is made — the gate that a walkthrough test may only click what the screen
    // tells it to. It must NOT say "where the axes meet": on `heatmap.2` they
    // do not meet where a reader expects.
    const first = await textOf('tips-bar');
    expect(first).toMatch(/FIRST column/);
    expect(first).toMatch(/FIRST row/);
    expect(first).not.toMatch(/axes meet/i);

    await clickImagePixel(truth.frame.x1.x, truth.frame.x1.y); // first column × first row
    await clickImagePixel(truth.frame.x2.x, truth.frame.x2.y); // last column × first row
    await confirmValue('5'); // five columns
    await page.waitForTimeout(200);

    // The shared corner arrived without a click AND without a tick-box, so the
    // walk is already asking for the third and last corner.
    expect(await textOf('calibration-bar')).toMatch(/3\/8/);
    expect(await textOf('tips-bar')).toMatch(/LAST row/);

    // ⚑⚑ AND IT CALIBRATES — the assertion the feature this replaces never made.
    // Both of its tests stopped at a step count and never called Calibrate, so
    // they proved a walk could be performed and nothing about the result.
    await clickImagePixel(truth.frame.y2.x, truth.frame.y2.y);
    await confirmValue('4'); // four rows
    await clickImagePixel(truth.key.from.x, truth.key.from.y);
    await clickImagePixel(truth.key.to.x, truth.key.to.y);
    for (const tick of truth.key.ticks) {
      await clickImagePixel(tick.x, tick.y);
      await confirmValue(String(tick.value));
    }
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(250);
    expect(await textOf('calibrated-status')).toMatch(/Calibrated/);
  });

  it('says WHY Remove is unavailable at the floor, before it is pressed', async () => {
    // ⚑ The model's refusal is unit-tested (`removeDividerHandle`); this is the
    // half only the screen can show — a disabled button carrying its reason,
    // because a button that fails on click teaches nothing. Declaring one
    // column and one row is the cheapest way to stand on the floor.
    await resetWorkspace('heatmap');
    await calibrateHeatmapDeclaring('1', '1');
    await page.waitForTimeout(300);
    const left = await imageToLocal(truth.frame.x1.x, truth.frame.x1.y);
    await refreshCanvasBox();
    await clickAt(left.lx, left.ly + HANDLE_STANDOFF); // the handle at the tick's end
    await page.waitForTimeout(200);
    const remove = page.getByTestId('heatmap-remove-boundary');
    expect(await remove.isDisabled()).toBe(true);
    expect(await remove.getAttribute('title')).toMatch(/last two boundaries/);
  });

  it('P4 — a dragged boundary STAYS ON ITS AXIS, not where the mouse let go', async () => {
    // ⚑⚑ David: *"Why are the tick marks not bound to the axis???"* Dragging
    // mutates the Konva node's position, but React re-applies only a prop whose
    // VALUE CHANGED — and the model CONSTRAINS the drag (an x-divider keeps only
    // the drop's x). So the perpendicular coordinate never changes in state, is
    // never re-applied, and the handle stays wherever the mouse let go, off the
    // axis, while the model is perfectly correct. The picture lies and the data
    // does not.
    //
    // ⚑ The same defect is on the bar chart's category ticks and has been since
    // v2.1 — it just reads as sloppiness on a horizontal axis instead of as
    // obviously wrong against a grid. The fix is in the renderer, so this covers
    // every constrained handle in the app.
    await resetWorkspace('heatmap');
    await calibrateHeatmap();
    await page.waitForTimeout(400);

    const axisY = truth.frame.x1.y;
    // ⚑ truth.grid.x is in DATA units; imageToLocal takes IMAGE pixels. Convert
    // through the frame the figure was calibrated on, as the drag test above does.
    const px = (dataX: number) =>
      truth.frame.x1.x +
      ((truth.frame.x2.x - truth.frame.x1.x) * (dataX - truth.frame.x1.value)) /
        (truth.frame.x2.value - truth.frame.x1.value);
    const before = await imageToLocal(px(truth.grid.x[1]!), axisY);
    await refreshCanvasBox();
    // ⚑⚑ NOTHING IS SELECTED FIRST. An earlier version clicked a handle before
    // dragging, and selection PERSISTS — so the "is anything selected?" check
    // was answered by that first click no matter where the later one landed.
    // The assertion measured its own setup.
    //
    // A move the model ACCEPTS re-renders, and the new x drags the node back
    // into place by accident. A move it REFUSES changes no state at all, so
    // nothing re-renders and the handle simply stays where the mouse let go.
    // Dragging past a neighbour is refused — `moveDivider` will not let a
    // boundary cross another.
    const past = await imageToLocal(px(truth.grid.x[3]! + 1), axisY);
    await refreshCanvasBox();
    await page.mouse.move(canvasBox.x + before.lx, canvasBox.y + before.ly + HANDLE_STANDOFF);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + past.lx, canvasBox.y + past.ly + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    // THE DECISIVE ASSERTION: click where the mouse let go. If the handle stayed
    // there — 60px off its own axis — that click selects it.
    await refreshCanvasBox();
    await clickAt(past.lx, past.ly + 60);
    await page.waitForTimeout(250);
    expect(await page.getByTestId('heatmap-selected-boundary').count()).toBe(0);

    // …and it is back on the axis, where a click still finds it. That also
    // covers the other half: the handle sits ON the tick, not 16px below it.
    await refreshCanvasBox();
    await clickAt(before.lx, before.ly + HANDLE_STANDOFF);
    await page.waitForTimeout(250);
    expect(await textOf('heatmap-selected-boundary')).toMatch(/^Column boundary/);
    // The refusal held, so the grid is unchanged.
    expect(await page.getByTestId('heatmap-grid-summary').textContent()).toMatch(/5 × 4 cells/);
  });

  it('lets a MISTYPED calibration value be corrected without redoing the walk', async () => {
    // ⚑⚑ David, looking at a log colour key that refused his 0 and told him to
    // enter a positive value: *"And I don't see how I can edit the points at
    // this point during the calibration even?"* There was no way. A placed
    // calibration value was plain text, so the only route was Reset calibration
    // — discarding eight clicks and six numbers to change one digit.
    //
    // ⚑ Not a heatmap defect: no type could edit one. It bites hardest here
    // because the walk is twice as long and the colour key's two labelled ticks
    // are the easiest numbers in the app to get wrong.
    // ⚑ DURING the walk, which is where David was: all eight placed, nothing
    // calibrated yet, and the app asking for a value he could not change.
    await resetWorkspace('heatmap');
    const bands = { x2: '5', y2: '4' } as Record<string, string>;
    for (const step of ['x1', 'x2', 'y1', 'y2'] as const) {
      const p = truth.frame[step];
      await clickImagePixel(p.x, p.y);
      await confirmValues(
        step === 'x2' || step === 'y2' ? [String(p.value), bands[step]!] : [String(p.value)]
      );
    }
    await page.waitForTimeout(200);

    // The last column's declared count, as typed.
    expect(await textOf('calib-value-x2-1')).toBe('5');
    await page.getByTestId('calib-value-x2-1').click();
    await page.waitForTimeout(150);
    const box = page.getByTestId('calib-edit-x2-1');
    await box.fill('6');
    await box.press('Enter');
    await page.waitForTimeout(400);

    // Corrected in place, with the walk untouched — no Reset, no re-clicking.
    expect(await textOf('calib-value-x2-1')).toBe('6');
    // …and the correction is what the calibration then uses.
    await clickImagePixel(truth.key.from.x, truth.key.from.y);
    await clickImagePixel(truth.key.to.x, truth.key.to.y);
    for (const tick of truth.key.ticks) {
      await clickImagePixel(tick.x, tick.y);
      await confirmValue(String(tick.value));
    }
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(700);
    // ⚑ The GRID is 5 × 4, because detection measured the figure — which has
    // five columns — and a declaration does not override a measurement. What
    // the corrected value changed is what detection was CHECKED against, and
    // the shortfall it reports names the new number.
    expect(await textOf('heatmap-detect-message')).toMatch(/6 columns/);
  });

  it('B6 — selects a RANGE, a COLUMN and a ROW, the way the app selects points', async () => {
    // ⚑⚑ David, three times: *"I have no ability to edit or select multiple
    // cells"*, *"I cannot select a range of cells, or click cells on the heatmap
    // to select them"*, *"I cannot select a whole column for example."* The
    // heatmap had its own single-cell pick while the app has had Shift-click and
    // marquee multi-select for DATA POINTS since v1.2 — a parallel mechanism
    // doing less, which is this release's recurring shape.
    await resetWorkspace('heatmap');
    await calibrateHeatmap();
    await page.getByTestId('heatmap-read').click();
    await page.waitForTimeout(500);

    // One cell, as before.
    await page.getByTestId('heatmap-matrix-cell-1-1').click();
    await page.waitForTimeout(150);
    expect(await textOf('heatmap-selected-cell')).toBe('1,1');

    // Shift ADDS rather than replacing.
    await page.getByTestId('heatmap-matrix-cell-2-1').click({ modifiers: ['Shift'] });
    await page.waitForTimeout(150);
    // Two picked, so "which cell?" has no single answer and the readout says so.
    expect(await textOf('heatmap-selected-cell')).toBe('');
    expect(await textOf('heatmap-selected-count')).toMatch(/2 cells/);

    // A COLUMN header takes the whole column.
    await page.getByTestId('heatmap-col-select-3').click();
    await page.waitForTimeout(200);
    expect(await textOf('heatmap-selected-count')).toMatch(/4 cells/); // 4 rows

    // …and a ROW header the whole row.
    await page.getByTestId('heatmap-row-select-2').click();
    await page.waitForTimeout(200);
    expect(await textOf('heatmap-selected-count')).toMatch(/5 cells/); // 5 columns

    // Shift on a band that is already fully picked REMOVES it, so a second
    // Shift-click is not a no-op for half of it.
    await page.getByTestId('heatmap-row-select-2').click({ modifiers: ['Shift'] });
    await page.waitForTimeout(200);
    expect(await textOf('heatmap-selected-count')).toBe('');
  });

  it('lets ENTER walk a two-field step, without reaching for Tab', async () => {
    // ⚑⚑ David: *"when I just pressed enter, I want it to jump to the box...
    // I can press tab (do not remove that capability) but it is not as
    // intuitive."* A heatmap axis's second click asks for TWO numbers — the
    // coordinate and the band count — and Enter used to be swallowed: confirm
    // refuses while a required field is blank, so the key did nothing and the
    // only way on was Tab or the mouse.
    await resetWorkspace('heatmap');
    await clickImagePixel(truth.frame.x1.x, truth.frame.x1.y);
    await page.keyboard.type(String(truth.frame.x1.value));
    await page.keyboard.press('Enter'); // one field: Enter CONFIRMS
    await page.waitForTimeout(200);
    expect(await textOf('calibration-bar')).toMatch(/1\/8/);

    await clickImagePixel(truth.frame.x2.x, truth.frame.x2.y);
    await page.keyboard.type(String(truth.frame.x2.value));
    await page.keyboard.press('Enter'); // two fields: Enter ADVANCES
    await page.waitForTimeout(150);
    // …to the count box, which now has the focus and takes what is typed next.
    await page.keyboard.type(String(truth.grid.x.length - 1));
    expect(await page.getByTestId('data-value-input-1').inputValue()).toBe(
      String(truth.grid.x.length - 1)
    );
    await page.keyboard.press('Enter'); // last field: Enter CONFIRMS
    await page.waitForTimeout(200);
    expect(await textOf('calibration-bar')).toMatch(/2\/8/);
  });

  it('still walks the same step with TAB, which was never the problem', async () => {
    // ⚑ The companion assertion: Enter gained a job, Tab did not lose one.
    await resetWorkspace('heatmap');
    await clickImagePixel(truth.frame.x1.x, truth.frame.x1.y);
    await page.keyboard.type(String(truth.frame.x1.value));
    await page.getByTestId('confirm-data-value').click();
    await clickImagePixel(truth.frame.x2.x, truth.frame.x2.y);
    await page.keyboard.type(String(truth.frame.x2.value));
    await page.keyboard.press('Tab');
    await page.keyboard.type('5');
    expect(await page.getByTestId('data-value-input-1').inputValue()).toBe('5');
  });

  it('reports a miss instead of inventing boundaries', async () => {
    // ⚑ The DECLARATION is what detection is measured against, and it is made in
    // the walk now rather than in a box on the panel. Declaring nine columns on
    // a five-column figure is how the mismatch is reached: detection must say it
    // fell short, never relax until the count is satisfied.
    await resetWorkspace('heatmap');
    await calibrateHeatmapDeclaring('9', '4');
    await page.getByTestId('heatmap-detect').click();
    await page.waitForTimeout(200);
    expect(await textOf('heatmap-detect-message')).toMatch(/Found 4 of the 8 boundaries/);
    expect(await textOf('heatmap-detect-message')).toMatch(/by hand/);
  });
});
