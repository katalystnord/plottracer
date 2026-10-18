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
    expect(await choice.textContent()).toContain('Graph extraction');
    expect(await page.getByRole('button', { name: 'Try automatic graph extraction (beta)' }).count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Go to manual guided extraction' }).count()).toBe(1);
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
    expect(await text('leave-automatic')).toBe('Leave automatic extraction');
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
    await page.getByRole('button', { name: 'Leave automatic extraction' }).click();
    await page.getByTestId('reset-calibration').waitFor();
    expect(await page.getByTestId('capture-figure').count()).toBe(0); // still captured
  });

  it('cases 9-12: XY gives the axes card; a drawn figure\'s axes are read and accepted; Previous goes back; leaving keeps them', { timeout: 180000 }, async () => {
    await openAndCapture(VECTOR('labels-linear'));
    await page.getByRole('button', { name: 'Try automatic graph extraction (beta)' }).click();
    await page.getByTestId('axes-type-panel').waitFor();
    await page.getByTestId('axes-option-xy').click();
    const card = page.getByTestId('calibration-bar');
    await page.getByTestId('axes-card').waitFor();
    // case 9: the axes card, top to bottom
    expect(await card.getByRole('button', { name: 'Leave automatic extraction mode' }).count()).toBe(1);
    expect(await text('calibrated-status')).toBe('0/4 set');
    expect(await page.getByTestId('reset-calibration').count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Accept suggested graph axis' }).isDisabled()).toBe(true);
    expect(await page.getByTestId('axes-card').textContent()).toContain('Select an axis point to adjust it.');
    expect(await page.getByRole('button', { name: '< Previous' }).count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Next >' }).count()).toBe(1);
    for (const id of ['common-origin', 'calib-option-isLogX', 'calib-option-isLogY', 'calib-option-skipRotation']) {
      expect(await page.getByTestId(id).count(), id).toBe(0);
    }
    // case 10: Read graph axis (the PDF's drawing is read after capture; the card says if not yet)
    for (let i = 0; i < 20 && (await page.getByTestId('label-axes-x').count()) === 0; i++) {
      await page.getByRole('button', { name: 'Read graph axis' }).click();
      await page.waitForTimeout(500);
    }
    expect(await text('label-axes-x')).toBe('X: 0, 20, 40, 60, 80, 100');
    expect(await page.getByRole('button', { name: 'Accept suggested graph axis' }).isDisabled()).toBe(false);
    await page.getByRole('button', { name: 'Accept suggested graph axis' }).click();
    expect(await text('calibrated-status')).toBe('4/4 set');
    // case 12 (leave keeps what was accepted) before case 11, which undoes it
    await card.getByRole('button', { name: 'Leave automatic extraction mode' }).click();
    await page.getByTestId('manual-hint').waitFor();
    expect(await text('calibrated-status')).toBe('4/4 set');
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
});
