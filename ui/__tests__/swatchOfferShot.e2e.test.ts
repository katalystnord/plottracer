import { describe, it, beforeEach, afterEach } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import path from 'node:path';
import { ozoneArgs } from './e2eContainment.js';

/**
 * A frame of the held-back-swatch offer, for reading COLD.
 *
 * ⚑⚑ THE ONE THING NO UNIT TEST HERE CAN ANSWER. `partitionSwatchSuspects` is
 * measured and so is the sentence, but "does a person meet an offer they can
 * act on" is a question about pixels. The rule it has to satisfy is a hard one:
 * every capability must be visible through the interface itself. A refusal the
 * reader cannot see is worse than no refusal.
 *
 * Dev-only, on the pattern `crowdedShot` set:
 *   SWATCH_SHOT=1 SWATCH_OUT=/tmp/swatch.png npx vitest run ui/__tests__/swatchOfferShot.e2e.test.ts
 *
 * ⚠️ Coordinates are read off the RENDERED figure and the calibration card
 * overlays the canvas, so value-axis clicks stay left of it.
 */
const REPO_ROOT = path.resolve(__dirname, '../..');
const RUN = process.env['SWATCH_SHOT'] === '1';
const OUT = process.env['SWATCH_OUT'] ?? '/tmp/swatch.png';

let app: ElectronApplication;
let page: Page;

describe.runIf(RUN)('swatch hold-back offer shot', () => {
  beforeEach(async () => {
    app = await electron.launch({
      args: [...ozoneArgs(), path.join(REPO_ROOT, 'ui/electron-dev.cjs'), '--built'],
      cwd: REPO_ROOT, timeout: 30000, env: { ...process.env, WPD_E2E: '1' },
    });
    page = await app.firstWindow();
    page.on('dialog', (d) => void d.accept());
    await app.evaluate(({ dialog }, p2) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p2] });
    }, path.join(REPO_ROOT, 'samples/bar-grouped-viability.png'));
  });
  afterEach(async () => { await app.close(); });

  it('shot', { timeout: 120000 }, async () => {
    await page.getByTestId('open-image-button').click();
    await page.waitForTimeout(1500);
    await page.getByTestId('axes-type-trigger').click();
    await page.getByTestId('axes-option-bar').click();
    await page.getByTestId('capture-figure').click();
    await page.waitForTimeout(300);
    let box = (await page.locator('canvas').first().boundingBox())!;
    const refresh = async () => { box = (await page.locator('canvas').first().boundingBox())!; };
    const clickAt = async (lx: number, ly: number) => {
      await refresh(); await page.mouse.click(box.x + lx, box.y + ly); await page.waitForTimeout(140);
    };
    const confirm = async (v: string) => {
      await page.mouse.move(5, 5); await page.waitForTimeout(150);
      await page.locator('[data-testid="data-value-input"]').fill(v, { timeout: 8000, force: true });
      await page.locator('[data-testid="confirm-data-value"]').click({ timeout: 8000, force: true });
      await page.waitForTimeout(160);
    };
    // ⚑⚑ THE ANCHORS COME FROM THE FIGURE'S OWN TRUTH FILE, converted to canvas
    // coordinates by the view the app reports - not eyeballed. The first draft
    // of this test typed value 0 at a pixel 55px BELOW the bars' feet, so no
    // shape reached the declared baseline, the swatch test correctly reported
    // nothing, and the frame showed the defect instead of the fix. A wrong
    // fixture and an absent feature look identical from here.
    const status = await page.getByTestId('view-state').textContent();
    const m = /scale: ([0-9.]+), offset: \(([-0-9.]+), ([-0-9.]+)\)/.exec(status ?? '');
    if (!m) throw new Error(`no view in status line: ${status}`);
    const [scale, ox, oy] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const at = (px: number, py: number): [number, number] => [px * scale + ox, py * scale + oy];

    await page.waitForTimeout(250);
    await page.getByTestId('common-origin').uncheck();
    await clickAt(...at(67.78, 660.28)); await confirm('0');
    await clickAt(...at(67.78, 39.33)); await confirm('70');
    await clickAt(...at(74.08, 660.28)); await clickAt(...at(877.42, 660.28)); await confirm('4');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(600);

    // By-colour on the first series' ink. The figure's legend carries a swatch
    // in exactly that colour at x 763-790 - measured off the PNG, which is the
    // whole reason this sample was chosen.
    // The wand fronts the mechanisms (v0.8), same as `workspace.e2e.test.ts`.
    await page.getByTestId('mode-auto-extract').click();
    await page.getByTestId('auto-extract-colour').click();
    await page.locator('[data-testid="auto-extract-colour"][aria-pressed="true"]').waitFor();
    await page.waitForTimeout(300);
    await page.getByTestId('color-trace-color').fill('#c0392b');
    await page.waitForTimeout(200);
    await page.getByTestId('color-trace-run').click();
    await page.waitForTimeout(800);
    // ⚑ The offer has to be ON SCREEN, not merely in state. This is the whole
    // question the shot exists to answer.
    await page.screenshot({ path: OUT, fullPage: false });
    await page.getByTestId('swatch-hold-back-offer').waitFor({ timeout: 5000 });
  });
});
