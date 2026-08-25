import { describe, it, beforeEach, afterEach } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import path from 'node:path';
import { ozoneArgs } from './e2eContainment.js';

const REPO_ROOT = path.resolve(__dirname, '../..');
const RUN = process.env['CROWDED_SHOT'] === '1';
const OUT = process.env['CROWDED_OUT'] ?? '/tmp/crowded.png';

let app: ElectronApplication;
let page: Page;

describe.runIf(RUN)('crowded shot', () => {
  beforeEach(async () => {
    app = await electron.launch({
      args: [...ozoneArgs(), path.join(REPO_ROOT, 'ui/electron-dev.cjs'), '--built'],
      cwd: REPO_ROOT, timeout: 30000, env: { ...process.env, WPD_E2E: '1' },
    });
    page = await app.firstWindow();
    page.on('dialog', (d) => void d.accept());
    await app.evaluate(({ dialog }, p2) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p2] });
    }, path.join(REPO_ROOT, 'samples/bar-tensile-strength.png'));
  });
  afterEach(async () => { await app.close(); });

  it('shot', async () => {
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
    const drag = async (ax: number, ay: number, bx: number, by: number) => {
      await refresh();
      await page.mouse.move(box.x + ax, box.y + ay); await page.mouse.down();
      await page.mouse.move(box.x + bx, box.y + by, { steps: 6 }); await page.mouse.up();
      await page.waitForTimeout(200);
    };
    await page.waitForTimeout(250);
    await page.getByTestId('common-origin').uncheck();
    await clickAt(150, 744); await confirm('0');
    await clickAt(150, 167); await confirm('450');
    await clickAt(100, 744); await clickAt(825, 744); await confirm('6');
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(500);
    await drag(105, 744, 180, 305);   // Flax
    await drag(228, 744, 300, 383);   // Hemp - the real bar
    await drag(240, 560, 258, 578);   // the swatch, same band
    await drag(350, 744, 425, 478);   // Jute
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    await page.getByTestId('conflict-row-hidden').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT });
  }, 90000);
});
