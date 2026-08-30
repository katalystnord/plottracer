import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ozoneArgs } from './e2eContainment.js';

/**
 * ⚑⚑⚑ DRIVES THE PACKAGED BINARY, NOT THE REPO (v2.4).
 *
 * Every other test in this project asks whether the code agrees with itself.
 * This one asks the only question a `files` rule can be wrong about: **is the
 * thing we shipped complete?**
 *
 * ⚠️ WHY IT HAD TO EXIST. v2.4 stopped packaging 107MB of `node_modules` that
 * nothing could reach - the renderer has no `require` at all (contextIsolation,
 * nodeIntegration off, a `file://` document), and main requires only `electron`,
 * `path`, `fs` and `tesseract.js`. That reasoning is sound and it is still only
 * reasoning: a missing transitive dependency shows up ONLY in the packaged app,
 * ONLY when a feature is used, and every test in the repo would stay green.
 * So the three features whose libraries were dropped get driven for real:
 *
 *   · PDF (pdf.js, and its worker)   - `pdfjs-dist`, 18MB, no longer shipped
 *   · XLSX export (exceljs)          - 7.5MB, no longer shipped, lazy-loaded
 *   · reading a label (tesseract.js) - the one package that IS still shipped,
 *                                      from a tree trimmed to two wasm builds
 *
 * ⚑ RUN IT AFTER A PACKAGE BUILD:
 *
 *     npm run ui:dist:linux
 *     ls /tmp/.X11-unix/X99 >/dev/null 2>&1 || {
 *       rm -f /tmp/.X99-lock
 *       nohup Xvfb :99 -screen 0 1600x1000x24 >/tmp/xvfb99.log 2>&1 &
 *     }
 *     env -u WAYLAND_DISPLAY DISPLAY=:99 PLOTTRACER_OZONE_PLATFORM=x11 \
 *       PACKAGED_APP=1 npx vitest run ui/__tests__/packagedApp.e2e.test.ts
 *
 * ⚑ OPT-IN, and it REFUSES rather than skipping when the binary is missing. A
 * test that quietly does nothing is the failure mode this project has already
 * paid for twice: read the first line of a run, and a check that did not run
 * must say so.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const BINARY = path.join(REPO_ROOT, 'dist-ui/linux-unpacked/plottracer');
const RUN = process.env['PACKAGED_APP'] === '1';

let app: ElectronApplication;
let page: Page;

describe.runIf(RUN)('the packaged app is complete', () => {
  beforeAll(async () => {
    if (!fs.existsSync(BINARY)) {
      throw new Error(
        `PACKAGED_APP=1 but there is no packaged app at ${BINARY}. Run \`npm run ui:dist:linux\` first - skipping silently would make this check worthless.`
      );
    }
    app = await electron.launch({
      executablePath: BINARY,
      args: ozoneArgs(),
      timeout: 60000,
      env: { ...process.env, WPD_E2E: '1' },
    });
    page = await app.firstWindow();
    page.on('dialog', (d) => void d.accept());
  }, 120000);

  afterAll(async () => {
    await app?.close();
  });

  const stubOpen = async (filePath: string) => {
    await app.evaluate(({ dialog }, p2) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p2] });
    }, filePath);
  };

  it('renders a PDF page, with pdfjs-dist no longer in the package', async () => {
    await stubOpen(path.join(REPO_ROOT, 'samples/multipage-figures.pdf'));
    await page.getByTestId('open-image-button').click();
    // ⚑ The page LABEL is the observable: it only appears once pdf.js has
    // decoded the document AND its worker has come up, which is the half a
    // missing bundle would break.
    await expect
      .poll(() => page.getByTestId('pdf-page-label').textContent(), { timeout: 60000 })
      .toMatch(/Page 1 \//);
  }, 120000);

  it('writes an XLSX, with exceljs no longer in the package', async () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pt-packaged-')), 'export.xlsx');
    await app.evaluate(({ dialog }, p2) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p2 });
    }, out);
    await stubOpen(path.join(REPO_ROOT, 'samples/bar-tensile-strength.png'));
    await page.getByTestId('open-image-button').click();
    await page.waitForTimeout(1500);
    // A calibrated figure, because an export is of a RECORD - the walk here is
    // the same four clicks ocrLabels.e2e makes, from the same truth file.
    await page.getByTestId('axes-type-trigger').click();
    await page.getByTestId('axes-option-bar').click();
    await page.getByTestId('capture-figure').click();
    await page.waitForTimeout(300);
    const box = (await page.locator('canvas').first().boundingBox())!;
    const status = await page.getByTestId('view-state').textContent();
    const m = /scale: ([0-9.]+), offset: \(([-0-9.]+), ([-0-9.]+)\)/.exec(status ?? '');
    if (!m) throw new Error(`no view in status line: ${status}`);
    const [scale, ox, oy] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const clickAt = async (px: number, py: number) => {
      await page.mouse.click(box.x + px * scale + ox, box.y + py * scale + oy);
      await page.waitForTimeout(140);
    };
    const confirm = async (v: string) => {
      await page.mouse.move(5, 5);
      await page.waitForTimeout(150);
      await page.locator('[data-testid="data-value-input"]').fill(v, { timeout: 8000, force: true });
      await page.locator('[data-testid="confirm-data-value"]').click({ timeout: 8000, force: true });
      await page.waitForTimeout(160);
    };
    await page.getByTestId('common-origin').uncheck();
    await clickAt(77.53, 660.28);
    await confirm('0');
    await clickAt(77.53, 39.33);
    await confirm('450');
    await clickAt(87.45, 660.28);
    await clickAt(874.05, 660.28);
    await confirm('6');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(600);

    await page.getByTestId('export-csv').click();
    await page.getByTestId('export-format-xlsx').click();
    // ⚑ The FILE, not a toast. exceljs is lazy-loaded, so nothing before the
    // bytes are on disk proves the chunk resolved.
    await expect.poll(() => fs.existsSync(out), { timeout: 60000 }).toBe(true);
    // A real workbook, not a zero-byte file left by a failed writer.
    expect(fs.statSync(out).size).toBeGreaterThan(1000);
  }, 120000);

  it('reads a category label, from a tesseract tree trimmed to two wasm builds', async () => {
    // ⚑ Straight at the OCR boundary rather than through the whole calibration
    // walk: what is in question here is whether the packaged tree can LOAD its
    // engine, and the gesture that reaches it is covered in ocrLabels.e2e.
    const png = fs
      .readFileSync(path.join(REPO_ROOT, 'engine/__tests__/fixtures/ocr/label-flax.png'))
      .toString('base64');
    const answer = await page.evaluate(
      (b64) => (window as unknown as { electronAPI: { readText: (s: string) => Promise<{ text?: string; confidence?: number; error?: string }> } }).electronAPI.readText(b64),
      png
    );
    expect(answer.error, 'the packaged app could not start its OCR engine').toBeUndefined();
    expect(answer.text?.trim()).toBe('Flax');
  }, 120000);

  it('leaves no language data in the install directory', async () => {
    // ⚠️ The default writes `eng.traineddata` to the working directory, which for
    // an installed app is root-owned. Asserted HERE as well as in the unit test,
    // because this is the only place the working directory is the real one.
    expect(fs.existsSync(path.join(path.dirname(BINARY), 'eng.traineddata'))).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(BINARY), 'resources/app/eng.traineddata'))).toBe(
      false
    );
  });
});
