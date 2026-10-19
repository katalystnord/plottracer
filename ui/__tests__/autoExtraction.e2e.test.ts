/**
 * Automatic graph extraction (beta), phase 1, walked through the built app
 * (docs/v2.7-figure-type.md, "Phase 1": every case is David's, 2026-10-16/18).
 *
 * ⚑ Gate 4: a walkthrough clicks only what a prompt on screen tells it to click. Capture
 * ("Capture figure first"), the choice card's two buttons, the Graph type card ("Please select
 * graph type."), the apology card's two buttons, the leave buttons, [Read graph axis] and
 * [Accept suggested graph axis] all name themselves.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import path from 'node:path';
import { ozoneArgs } from './e2eContainment.js';
import { createRequire } from 'node:module';

const { decodePng } = createRequire(import.meta.url)(path.resolve(__dirname, '../electron-ocr-png.cjs')) as {
  decodePng: (b: Buffer) => { data: Uint8Array; width: number; height: number };
};

const REPO_ROOT = path.resolve(__dirname, '../..');
const SAMPLE = (n: string) => path.join(REPO_ROOT, 'samples', `${n}.png`);
const VECTOR = (n: string) => path.join(REPO_ROOT, 'engine/__tests__/fixtures/vector', `${n}.pdf`);

let app: ElectronApplication;
let page: Page;

async function openAndCapture(file: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, file);
  await page.getByTestId('open-image-button').click();
  await page.getByTestId('capture-figure').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  await page.getByTestId('capture-figure').click();
}

const text = async (id: string) => ((await page.getByTestId(id).textContent()) ?? '').trim();
/** The violet grips along the lowest violet row of the canvas (the grips under the X axis), as
 * their centres in page coordinates, left to right. */
async function lowestVioletGrips(): Promise<{ x: number; y: number }[]> {
  const box = (await page.locator('canvas').first().boundingBox())!;
  const img = decodePng(await page.locator('canvas').first().screenshot());
  const violet = (x: number, y: number) => {
    const i = (y * img.width + x) * 4;
    return Math.abs(img.data[i]! - 124) < 30 && Math.abs(img.data[i + 1]! - 58) < 30 && Math.abs(img.data[i + 2]! - 237) < 30;
  };
  const sx = img.width / box.width;
  for (let y = img.height - 1; y >= 0; y--) {
    const xs: number[] = [];
    for (let x = 0; x < img.width; x++) if (violet(x, y)) xs.push(x);
    if (xs.length < 4) continue;
    const runs: number[][] = [];
    for (const x of xs) {
      const last = runs[runs.length - 1];
      if (last && x - last[last.length - 1]! <= 3) last.push(x);
      else runs.push([x]);
    }
    return runs.map((r) => ({ x: box.x + (r[0]! + r[r.length - 1]!) / 2 / sx, y: box.y + (y - 3) / sx }));
  }
  return [];
}
/** Pixels of the canvas in the structure violet (#7c3aed), the colour of the app's tick marks. */
async function violetPixels(): Promise<number> {
  const img = decodePng(await page.locator('canvas').first().screenshot());
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (Math.abs(img.data[i]! - 124) < 30 && Math.abs(img.data[i + 1]! - 58) < 30 && Math.abs(img.data[i + 2]! - 237) < 30) n++;
  }
  return n;
}
/** The suggestion has answered: the step guide card says which type, or none. */
async function suggestion(): Promise<string> {
  const card = page.getByTestId('step-guide-card');
  await page.waitForFunction(() => document.querySelector('[data-testid="step-guide-card"]')?.getAttribute('data-suggestion') !== 'pending', null, { timeout: 30000 });
  return (await card.getAttribute('data-suggestion')) ?? '';
}

describe('Automatic graph extraction (beta), phase 1', () => {
  beforeEach(async () => {
    app = await electron.launch({
      args: [...ozoneArgs(), path.join(REPO_ROOT, 'ui/electron-dev.cjs'), '--built'],
      cwd: REPO_ROOT,
      timeout: 30000,
      env: { ...process.env, WPD_E2E: '1' },
    });
    page = await app.firstWindow();
    page.on('dialog', (d) => void d.accept());
  });
  afterEach(async () => {
    await app.close();
  });

  it('case 1: a figure just captured shows the choice in the calibration card\'s place', { timeout: 120000 }, async () => {
    await openAndCapture(SAMPLE('bar-tensile-strength'));
    const choice = page.getByTestId('graph-extraction-choice');
    await choice.waitFor();
    expect(await choice.locator('strong').textContent()).toBe('Graph extraction workflow');
    expect(await page.getByRole('button', { name: 'Try automatic graph extraction (beta)' }).count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Go to manual guided extraction' }).count()).toBe(1);
    // David, 2026-10-18: only the manual button is the teal primary one; each has its explanation under it
    expect(await page.getByTestId('choose-manual').getAttribute('data-variant')).toBe('primary');
    expect(await page.getByTestId('choose-automatic').getAttribute('data-variant')).toBeNull();
    expect(await text('choose-automatic-explanation')).toMatch(/^Experimental/);
    expect(await text('choose-manual-explanation')).not.toBe('');
    expect(await page.getByTestId('reset-calibration').count()).toBe(0); // not the calibration card yet
    expect(await page.getByTestId('step-guide-card').count()).toBe(0); // nothing automatic has started
  });

  it('case 2: manual guided extraction is today\'s calibration card with the hint in italics', { timeout: 120000 }, async () => {
    await openAndCapture(SAMPLE('bar-tensile-strength'));
    await page.getByRole('button', { name: 'Go to manual guided extraction' }).click();
    await page.getByTestId('reset-calibration').waitFor();
    expect(await text('manual-hint')).toBe('Start by selecting the appropriate graph type.');
    expect(await page.getByTestId('manual-hint').evaluate((e) => getComputedStyle(e).fontStyle)).toBe('italic');
  });

  it('case 3: automatic opens the Graph type card with Bar in green, and the step guide card in the lower right', { timeout: 120000 }, async () => {
    await openAndCapture(SAMPLE('bar-tensile-strength'));
    await page.getByRole('button', { name: 'Try automatic graph extraction (beta)' }).click();
    await page.getByTestId('axes-type-panel').waitFor();
    expect(await suggestion()).toBe('bar');
    expect(await page.getByTestId('axes-option-bar').getAttribute('data-suggested')).toBe('true');
    expect(await page.locator('[data-suggested="true"]').count()).toBe(1);
    // nothing is selected: the user clicks a type
    expect(await page.locator('[data-testid^="axes-option-"][aria-pressed="true"]').count()).toBe(0);
    const guide = page.getByTestId('step-guide-card');
    expect(await text('step-guide-instruction')).toBe('Please select graph type.');
    // (while the Graph type card is open the rest of the window is behind its pop-over, as for every
    // fold-out in the app, so the guide card's controls are looked up by test id here)
    expect(await text('leave-automatic')).toBe('Leave automated mode');
    expect(await guide.locator('button').count()).toBe(1); // no Previous or Next
    // lower right corner of the canvas
    const canvas = (await page.locator('canvas').first().boundingBox())!;
    const card = (await guide.boundingBox())!;
    expect(card.x + card.width).toBeGreaterThan(canvas.x + canvas.width * 0.6);
    expect(card.y + card.height).toBeGreaterThan(canvas.y + canvas.height * 0.6);
  });

  it('case 4: a figure no type reaches 70% on (a spider chart) gets no green', { timeout: 120000 }, async () => {
    await openAndCapture(SAMPLE('spider-material-profile'));
    await page.getByRole('button', { name: 'Try automatic graph extraction (beta)' }).click();
    await page.getByTestId('axes-type-panel').waitFor();
    expect(await suggestion()).toBe('none');
    expect(await page.locator('[data-suggested="true"]').count()).toBe(0);
  });

  it('cases 5-7: Pie gets the apology card; back reopens the Graph type card; continue gives the manual card with Pie', { timeout: 120000 }, async () => {
    await openAndCapture(SAMPLE('pie-filler-composition'));
    await page.getByRole('button', { name: 'Try automatic graph extraction (beta)' }).click();
    await page.getByTestId('axes-type-panel').waitFor();
    await page.getByTestId('axes-option-pie').click();
    const apology = page.getByTestId('apology-card');
    await apology.waitFor();
    expect(await apology.textContent()).toContain('Apologies, but we have not yet implemented an automatic extraction for this graph type.');
    // a message that the walk cannot go on carries the triangle, as everywhere (David, 2026-10-19)
    expect(await page.getByTestId('apology-text').locator('svg').count()).toBe(1);
    await page.getByTestId('axes-type-panel').waitFor({ state: 'detached' });
    expect(await page.getByTestId('step-guide-card').count()).toBe(0);
    // centre of the canvas
    const canvas = (await page.locator('canvas').first().boundingBox())!;
    const box = (await apology.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - (canvas.x + canvas.width / 2))).toBeLessThan(canvas.width * 0.1);

    await page.getByRole('button', { name: 'Back to graph type selection' }).click();
    await page.getByTestId('axes-type-panel').waitFor();
    expect(await page.getByTestId('step-guide-card').count()).toBe(1);

    await page.getByTestId('axes-option-pie').click();
    await page.getByRole('button', { name: 'Continue with manual guided extraction' }).click();
    await page.getByTestId('reset-calibration').waitFor();
    expect(await page.getByTestId('axes-type-trigger').textContent()).toContain('Pie');
  });

  it('case 8: leaving at the graph type step gives the manual path with the captured figure kept', { timeout: 120000 }, async () => {
    await openAndCapture(SAMPLE('bar-tensile-strength'));
    await page.getByRole('button', { name: 'Try automatic graph extraction (beta)' }).click();
    await page.getByTestId('step-guide-card').waitFor();
    await page.keyboard.press('Escape'); // the Graph type card is a fold-out; the guide card stays
    await page.getByRole('button', { name: 'Leave automated mode' }).click();
    await page.getByTestId('reset-calibration').waitFor();
    expect(await page.getByTestId('capture-figure').count()).toBe(0); // still captured
  });

  it('cases 9-12 (revised, David 2026-10-18): the calibration card; a drawn figure\'s axes read, its tick marks drawn as the app\'s tick marks, accepted and calibrated; the fold folds it all', { timeout: 180000 }, async () => {
    await openAndCapture(VECTOR('labels-linear'));
    await page.getByRole('button', { name: 'Try automatic graph extraction (beta)' }).click();
    await page.getByTestId('axes-type-panel').waitFor();
    await page.getByTestId('axes-option-xy').click();
    const card = page.getByTestId('axes-card');
    await card.waitFor();
    // case 9: the header on top; then [< Previous] [Leave automated mode] [Reset calibration]
    // in one row; Read and Accept graph axis points, each explained; no Next
    expect(await text('calibrated-status')).toBe('0/4 set');
    const row = await Promise.all(['auto-previous', 'leave-automatic', 'reset-calibration'].map((id) => page.getByTestId(id).boundingBox()));
    expect(Math.abs(row[0]!.y - row[1]!.y)).toBeLessThan(3);
    expect(Math.abs(row[1]!.y - row[2]!.y)).toBeLessThan(3);
    expect(row[0]!.x).toBeLessThan(row[1]!.x);
    expect(row[1]!.x).toBeLessThan(row[2]!.x);
    expect((await page.getByTestId('calib-fold').boundingBox())!.y).toBeLessThan(row[0]!.y);
    // David, 2026-10-18: the row fits inside the card, and Read and Accept are their own size, not
    // the card's full width
    const bar = (await page.getByTestId('calibration-bar').boundingBox())!;
    expect(row[2]!.x + row[2]!.width).toBeLessThanOrEqual(bar.x + bar.width);
    const cardWidth = (await card.boundingBox())!.width;
    for (const id of ['read-graph-axis', 'accept-graph-axis']) {
      expect((await page.getByTestId(id).boundingBox())!.width, id).toBeLessThan(cardWidth * 0.75);
    }
    expect(await page.getByRole('button', { name: 'Accept graph axis points' }).isDisabled()).toBe(true);
    expect(await text('read-graph-axis-explanation')).not.toBe('');
    expect(await text('accept-graph-axis-explanation')).not.toBe('');
    expect(await page.getByRole('button', { name: 'Next >' }).count()).toBe(0);
    for (const id of ['common-origin', 'calib-option-isLogX', 'calib-option-isLogY', 'calib-option-skipRotation', 'run-calibration']) {
      expect(await page.getByTestId(id).count(), id).toBe(0);
    }
    // the fold folds the whole card
    await page.getByTestId('calib-fold').click();
    expect(await card.count()).toBe(0);
    await page.getByTestId('calib-fold').click();
    await card.waitFor();
    // case 10: Read graph axis places the suggested axis points as the app's own calibration handles
    // (David, 2026-10-18: "you are NOT using the axis points here... REUSE MECHANICS IN THE SOFTWARE")
    expect(await violetPixels()).toBe(0);
    expect(await text('tips-bar')).toMatch(/Read graph axis/);
    const accept = page.getByTestId('accept-graph-axis');
    for (let i = 0; i < 20 && (await accept.isDisabled()); i++) {
      await page.getByRole('button', { name: 'Read graph axis' }).click();
      await page.waitForTimeout(500);
    }
    expect(await text('calibrated-status')).toBe('4/4 set');
    expect(await text('tips-bar')).toMatch(/Accept graph axis points/);
    expect(await text('tips-bar')).not.toMatch(/Calibrate/);
    // the values read are not listed in the card (David: "they are printed on the graph instead"),
    // and nothing needs a warning on this figure
    expect(await page.getByTestId('label-axes-offer').count()).toBe(0);
    expect(await page.getByTestId('label-axes-warnings').count()).toBe(0);
    // the tick marks read are drawn with the app's own tick mark graphics, in its structure violet
    expect(await violetPixels()).toBeGreaterThan(50);
    // teal when it can be used: the card-ending teal, as Calibrate
    expect(await accept.textContent()).toBe('Accept graph axis points');
    expect(await accept.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe('rgb(239, 239, 239)');
    // the read and accept buttons stand alone, so they sit centred, with space under the row above
    const cardBox = (await card.boundingBox())!;
    for (const b of [page.getByTestId('read-graph-axis'), accept]) {
      const bb = (await b.boundingBox())!;
      expect(Math.abs(bb.x + bb.width / 2 - (cardBox.x + cardBox.width / 2))).toBeLessThan(3);
    }
    const rowBottom = Math.max(...row.map((r) => r!.y + r!.height));
    expect((await page.getByTestId('read-graph-axis').boundingBox())!.y - rowBottom).toBeGreaterThanOrEqual(10);
    // the first acceptance: on to the tick marks, which stay drawn; no Read at this stage
    await accept.click();
    expect(await accept.textContent()).toBe('Accept tick marks');
    expect(await page.getByTestId('read-graph-axis').count()).toBe(0);
    expect(await text('tips-bar')).toMatch(/Accept tick marks/);
    expect(await violetPixels()).toBeGreaterThan(50);
    // the tick marks are the adjustable tick markers (David, 2026-10-19): a grip drags its tick along
    // the axis, and Ctrl+Z puts it back
    const before = await lowestVioletGrips();
    expect(before.length).toBeGreaterThanOrEqual(3);
    const grip = before[1]!; // a tick with neighbours on both sides
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x + 12, grip.y + 30, { steps: 6 });
    await page.mouse.up();
    await page.mouse.move(2, 300);
    await page.waitForTimeout(300);
    const after = await lowestVioletGrips();
    expect(after.length).toBe(before.length); // along the axis, never off it: still on the grips' row
    expect(after[1]!.x - grip.x).toBeGreaterThan(6);
    expect(Math.abs(after[0]!.x - before[0]!.x)).toBeLessThan(2); // the others stay
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect(Math.abs((await lowestVioletGrips())[1]!.x - grip.x)).toBeLessThan(2);
    expect(await text('calibrated-status')).toBe('4/4 set');
    // Previous goes back one stage, to the axis points, which are kept
    await page.getByRole('button', { name: '< Previous' }).click();
    expect(await accept.textContent()).toBe('Accept graph axis points');
    expect(await text('calibrated-status')).toBe('4/4 set');
    await accept.click();
    // the final acceptance completes the calibration; the legend step is not built, so the walk
    // hands over to the manual path with everything kept
    await accept.click();
    expect(await text('calibrated-status')).toBe('Calibrated ✓');
    expect(await card.count()).toBe(0);
  });

  it('a label the vetting corrected is a warning at the bottom of the card, with a triangle', { timeout: 180000 }, async () => {
    await openAndCapture(VECTOR('labels-refused'));
    await page.getByRole('button', { name: 'Try automatic graph extraction (beta)' }).click();
    await page.getByTestId('axes-type-panel').waitFor();
    await page.getByTestId('axes-option-xy').click();
    await page.getByTestId('axes-card').waitFor();
    for (let i = 0; i < 20 && (await page.getByTestId('label-axes-warnings').count()) === 0; i++) {
      await page.getByRole('button', { name: 'Read graph axis' }).click();
      await page.waitForTimeout(500);
    }
    expect(await text('label-axes-corrected-x-0')).toBe('X: 6 was read as "9" and corrected from its neighbours.');
    expect(await text('label-axes-y')).toBe('Y could not be read: only one label sits at a tick mark; two are needed.');
    expect(await page.getByTestId('label-axes-warnings').locator('svg').count()).toBeGreaterThanOrEqual(2);
    // at the bottom of the card
    const card = (await page.getByTestId('axes-card').boundingBox())!;
    const w = (await page.getByTestId('label-axes-warnings').boundingBox())!;
    expect(Math.abs(card.y + card.height - (w.y + w.height))).toBeLessThan(4);
    // only one axis was read, so there are no axis points to accept
    expect(await page.getByRole('button', { name: 'Accept graph axis points' }).isDisabled()).toBe(true);
  });

  it('leaving at the calibration step keeps what was placed', { timeout: 120000 }, async () => {
    await openAndCapture(SAMPLE('bar-tensile-strength'));
    await page.getByRole('button', { name: 'Try automatic graph extraction (beta)' }).click();
    await page.getByTestId('axes-type-panel').waitFor();
    await page.getByTestId('axes-option-xy').click();
    await page.getByTestId('axes-card').waitFor();
    await page.getByRole('button', { name: 'Leave automated mode' }).click();
    await page.getByTestId('manual-hint').waitFor();
    expect(await page.getByTestId('axes-card').count()).toBe(0);
  });

  it('case 11: Previous on the axes card undoes the step and shows the graph type step again', { timeout: 120000 }, async () => {
    await openAndCapture(SAMPLE('bar-tensile-strength'));
    await page.getByRole('button', { name: 'Try automatic graph extraction (beta)' }).click();
    await page.getByTestId('axes-type-panel').waitFor();
    await page.getByTestId('axes-option-xy').click();
    await page.getByTestId('axes-card').waitFor();
    await page.getByRole('button', { name: '< Previous' }).click();
    await page.getByTestId('axes-type-panel').waitFor();
    expect(await page.getByTestId('step-guide-card').count()).toBe(1);
    expect(await page.getByTestId('axes-card').count()).toBe(0);
  });

  it('the magnifier is never drawn over the calibration card (David, 2026-10-18, a screenshot)', { timeout: 120000 }, async () => {
    await openAndCapture(SAMPLE('xy-stress-strain'));
    await page.getByTestId('choose-manual').click();
    const card = (await page.getByTestId('calibration-bar').boundingBox())!;
    // the cursor on the figure just below the card's middle, where the loupe's default spot (up and to
    // the right of the cursor) lands on the card
    await page.mouse.move(card.x + card.width / 2, card.y + card.height + 20);
    await page.mouse.move(card.x + card.width / 2 + 2, card.y + card.height + 22);
    const loupe = page.getByTestId('zoom-loupe');
    await loupe.waitFor();
    const l = (await loupe.boundingBox())!;
    const overlap = l.x < card.x + card.width && l.x + l.width > card.x && l.y < card.y + card.height && l.y + l.height > card.y;
    expect(overlap).toBe(false);
  });

  it('a reason the walk cannot go on is a warning with the triangle, at the bottom of the card (David, 2026-10-19)', { timeout: 120000 }, async () => {
    await openAndCapture(SAMPLE('bar-tensile-strength'));
    await page.getByRole('button', { name: 'Try automatic graph extraction (beta)' }).click();
    await page.getByTestId('axes-type-panel').waitFor();
    await page.getByTestId('axes-option-bar').click();
    const card = page.getByTestId('axes-card');
    await card.waitFor();
    await page.getByRole('button', { name: 'Read graph axis' }).click();
    const w = page.getByTestId('read-axis-warnings');
    await w.waitFor();
    // (a picture: the detector is not built yet, so the walk cannot read its axes)
    expect(await text('read-axis-notice')).toMatch(/cannot|not built|not available/);
    expect(await w.locator('svg').count()).toBe(1);
    const c = (await card.boundingBox())!;
    const b = (await w.boundingBox())!;
    expect(Math.abs(c.y + c.height - (b.y + b.height))).toBeLessThan(4);
  });
});
