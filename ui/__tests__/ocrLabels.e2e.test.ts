import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import path from 'node:path';
import { ozoneArgs } from './e2eContainment.js';

/**
 * ⚑⚑ READING THE CATEGORY NAMES OFF THE FIGURE, IN THE REAL APP (v2.4).
 *
 * The one thing no unit test can answer: whether the GESTURE exists on screen
 * and does what the prompt says it will. The pure halves are covered in
 * `engine/__tests__/ocrRegion.test.ts` and the whole pipeline against ground
 * truth in `ocrCategoryNames.test.ts`; what is left is the part a person has to
 * be able to find and perform.
 *
 * ⚑⚑ GATE 4: THIS TEST MAY ONLY CLICK WHAT A PROMPT ON SCREEN TELLS IT TO.
 * The button says `Read labels from the figure`; the tips bar then says *"Drag a
 * box round the row of category labels on the figure"*, and the box below is
 * exactly that - the labels' own row, under the axis, found by eye on the
 * rendered figure. Nothing here needs an order, a coordinate or a precondition
 * that the screen does not state. If a later edit makes it need one, that is a
 * UI defect found at the moment the test is written, not a detail of the test.
 *
 * ⚑ The calibration anchors come from the figure's OWN truth file, converted
 * through the view the app reports - the swatch shot's rule, and the reason a
 * wrong fixture cannot masquerade as a working feature.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const FIGURE = path.join(REPO_ROOT, 'samples/bar-tensile-strength.png');
/** From samples/bar-tensile-strength.truth.json. */
const EXPECTED = ['Flax', 'Hemp', 'Jute', 'Kenaf', 'Sisal', 'Ramie'];

let app: ElectronApplication;
let page: Page;

describe('OCR: reading category names off the figure', () => {
  beforeEach(async () => {
    app = await electron.launch({
      args: [...ozoneArgs(), path.join(REPO_ROOT, 'ui/electron-dev.cjs'), '--built'],
      cwd: REPO_ROOT,
      timeout: 30000,
      env: { ...process.env, WPD_E2E: '1' },
    });
    page = await app.firstWindow();
    page.on('dialog', (d) => void d.accept());
    await app.evaluate(({ dialog }, p2) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p2] });
    }, FIGURE);
  });
  afterEach(async () => {
    await app.close();
  });

  it('turns one drag round the labels into six named categories', { timeout: 180000 }, async () => {
    await page.getByTestId('open-image-button').click();
    await page.waitForTimeout(1500);
    await page.getByTestId('axes-type-trigger').click();
    await page.getByTestId('axes-option-bar').click();
    await page.getByTestId('capture-figure').click();
    await page.waitForTimeout(300);

    let box = (await page.locator('canvas').first().boundingBox())!;
    const refresh = async () => {
      box = (await page.locator('canvas').first().boundingBox())!;
    };
    const clickAt = async (lx: number, ly: number) => {
      await refresh();
      await page.mouse.click(box.x + lx, box.y + ly);
      await page.waitForTimeout(140);
    };
    const confirm = async (v: string) => {
      await page.mouse.move(5, 5);
      await page.waitForTimeout(150);
      await page.locator('[data-testid="data-value-input"]').fill(v, { timeout: 8000, force: true });
      await page.locator('[data-testid="confirm-data-value"]').click({ timeout: 8000, force: true });
      await page.waitForTimeout(160);
    };

    const status = await page.getByTestId('view-state').textContent();
    const m = /scale: ([0-9.]+), offset: \(([-0-9.]+), ([-0-9.]+)\)/.exec(status ?? '');
    if (!m) throw new Error(`no view in status line: ${status}`);
    const [scale, ox, oy] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const at = (px: number, py: number): [number, number] => [px * scale + ox, py * scale + oy];

    await page.waitForTimeout(250);
    await page.getByTestId('common-origin').uncheck();
    await clickAt(...at(77.53, 660.28));
    await confirm('0');
    await clickAt(...at(77.53, 39.33));
    await confirm('450');
    await clickAt(...at(87.45, 660.28));
    await clickAt(...at(874.05, 660.28));
    await confirm('6');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(600);

    // ⚑ The offer is ON SCREEN, on the card that describes the axis it fills.
    await page.getByTestId('ocr-read-labels').click();
    await page.waitForTimeout(200);

    // The row of labels, under the axis - what the tips bar just asked for.
    await refresh();
    const [x0, y0] = at(87.45, 664);
    const [x1, y1] = at(874.05, 694);
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1, { steps: 12 });
    await page.mouse.up();

    // The offer window, with one row per category and the pixels it read.
    await page.getByTestId('ocr-review-card').waitFor({ timeout: 60000 });
    for (let i = 0; i < EXPECTED.length; i++) {
      await expect
        .poll(() => page.getByTestId(`ocr-text-${i}`).inputValue(), { timeout: 10000 })
        .toBe(EXPECTED[i]);
      // ⚑⚑ EVERY ROW SHOWS ITS OWN CROP. It is how the rotation is shown, and
      // how a badly aimed box stops being a number to interpret.
      expect(await page.getByTestId(`ocr-thumb-${i}`).isVisible()).toBe(true);
    }

    if (process.env['OCR_SHOT']) await page.screenshot({ path: process.env['OCR_SHOT'] });
    // ⚑ NOTHING HAS REACHED THE RECORD YET - the whole provenance answer.
    expect(await page.getByTestId('bar-cell-0-0').textContent()).not.toContain('Flax');

    await page.getByTestId('ocr-apply').click();
    await page.waitForTimeout(400);
    expect(await page.getByTestId('ocr-review-card').count()).toBe(0);

    // ...and now they are names in the panel, indistinguishable from typed ones,
    // because a person read and approved every one of them.
    for (let i = 0; i < EXPECTED.length; i++) {
      await expect
        .poll(() => page.getByTestId(`bar-category-name-${i}`).textContent(), { timeout: 5000 })
        .toContain(EXPECTED[i]!);
    }
  });
});
