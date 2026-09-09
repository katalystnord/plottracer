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

    // ⚑⚑ THE TICKS THE FIGURE DRAWS, on the button David asked for. It has to
    // MOVE them: the generated set is evenly spaced from the two clicked ends,
    // so the observable is that at least one tick is no longer where the even
    // division put it, and that the card says what it did.
    // ⚑ `Moved` is only ever said when the model ACCEPTED the set - the message
    // takes `applied`, which is `applyDetectedCategoryTicks`'s own return. That
    // the ticks then sit on the detected positions is asserted at the model, in
    // engine/__tests__/categoryTickDetection.test.ts; what this adds is that the
    // button exists, reaches the detector through the real canvas pixels, and
    // reports back on screen.
    await page.getByTestId('detect-ticks').click();
    await expect
      .poll(() => page.getByTestId('detect-ticks-notice').textContent(), { timeout: 10000 })
      .toMatch(/Moved 6 ticks/);

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

    // ⚠️⚑⚑ THE PER-ROW CROP AND THE `Rotate` BUTTON ARE GONE (v2.5), and what
    // they were tested against is worth keeping: rotate turned ONE row a quarter
    // turn, and four presses brought it back. Both were per-LABEL answers to a
    // per-AXIS question - `axisQuarterTurn` already picked one turn for the whole
    // axis - and neither could help the case that prompted the rebuild, since a
    // 45 degree axis has no good quarter turn at all. The band is now straightened
    // at the angle the whole axis is drawn at and read ONCE, so there is no
    // per-label crop left to show or to turn.
    // The offer window, with one row per category.
    await page.getByTestId('ocr-review-card').waitFor({ timeout: 60000 });
    for (let i = 0; i < EXPECTED.length; i++) {
      await expect
        .poll(() => page.getByTestId(`ocr-text-${i}`).inputValue(), { timeout: 10000 })
        .toBe(EXPECTED[i]);
    }

    // ⚑⚑ WHAT IT READ AT, AND THE HANDLE ON IT.
    //
    // David: *"should we not re-add some form of user control at the point of
    // showing what the automated state has found? Else, what is the point of
    // showing it to the user?"* The angle was measured and thrown away by the
    // only caller, so nothing said whether the band had been read at the angle
    // the labels are drawn at or at the sweep's fallback - and there was no way
    // to disagree. v2.4 had `Rotate`; removing it without a replacement was a
    // regression, not a deferred feature.
    const angleOf = async (): Promise<number> =>
      Number(((await page.getByTestId('ocr-angle-value').textContent()) ?? '').replace(/[^-0-9]/g, ''));
    const measured = await angleOf();
    // This figure's labels are horizontal, so the sweep should be near flat -
    // and the card must SAY the number, whatever it is.
    expect(Math.abs(measured), `read at ${measured} degrees on a horizontal axis`).toBeLessThanOrEqual(15);
    expect(await page.getByTestId('ocr-angle-source').textContent()).toMatch(/measured/i);

    // ⚑ A control that would do nothing does not invite a press: Read again is
    // disabled until the slider actually differs from what the rows were read at.
    expect(await page.getByTestId('ocr-read-again').isDisabled()).toBe(true);

    // ⚑⚑ ONE DEGREE. David: *"we need to make the steps finer than we had
    // before."* Before was `Rotate`, a QUARTER TURN a press. A single degree off
    // a horizontal axis still reads, which is what makes this deterministic -
    // the point here is the mechanism, not the OCR's tolerance.
    const asked = measured + 1;
    await page.getByTestId('ocr-angle').fill(String(asked));
    expect(await angleOf(), 'the readout follows the slider').toBe(asked);
    expect(await page.getByTestId('ocr-read-again').isDisabled()).toBe(false);

    await page.getByTestId('ocr-read-again').click();
    // ⚑ ONE READ, not a sweep - so this returns quickly, and the card says whose
    // angle it is now showing.
    await expect
      .poll(() => page.getByTestId('ocr-angle-source').textContent(), { timeout: 60000 })
      .toMatch(/the angle you set/i);
    expect(await angleOf(), 'the card reports the angle it actually read at').toBe(asked);

    // ⚑⚑ AND THE ROWS SURVIVED. Losing a card of names to a guessed angle is
    // the expensive accident this card already refuses to allow a stray click.
    expect(await page.getByTestId('ocr-text-0').count()).toBe(1);

    // ⚑⚑ AND OUR OWN READING IS STILL ON OFFER. Found by reading the card cold
    // in a screenshot: the measured angle vanished the moment you set one of
    // your own, so the automated finding - the thing being shown - was erased by
    // the control meant to make it useful, with no way back to it.
    expect(await page.getByTestId('ocr-angle-source').textContent()).toContain(
      `We measured ${measured}°`
    );
    await page.getByTestId('ocr-angle-reset').click();
    await expect
      .poll(() => page.getByTestId('ocr-angle-source').textContent(), { timeout: 60000 })
      .toMatch(/measured by reading the band/i);
    // ⚑ Back to OUR answer means it is ours again, not "the angle you set".
    expect(await angleOf()).toBe(measured);

    if (process.env['OCR_SHOT']) await page.screenshot({ path: process.env['OCR_SHOT'] });

    // ⚑ Escape backs out and writes nothing - and it has to work with nothing in
    // the card focused, which is the state it opens in.
    await page.keyboard.press('Escape');
    await expect.poll(() => page.getByTestId('ocr-review-card').count(), { timeout: 5000 }).toBe(0);
    await page.getByTestId('ocr-read-labels').click();
    await refresh();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1, { steps: 12 });
    await page.mouse.up();
    await page.getByTestId('ocr-review-card').waitFor({ timeout: 60000 });

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
