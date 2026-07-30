/**
 * A DEV-ONLY driver that leaves the spider example open, calibrated and part-way
 * through capture, so a frame can be grabbed off the virtual display.
 *
 * ⚑ This exists because Konva output is not DOM-inspectable: the workspace e2e can
 * assert WHICH ray is live (via a hidden readout) but not that the canvas draws it
 * any differently — verified by neutering the rendering, after which the e2e still
 * passed. Screenshotting the app on the Xvfb display closes that gap without
 * taking over anyone's screen.
 *
 * Skipped unless SPIDER_SHOT=1, so it never runs in the normal suite: it is a
 * capture harness, not a test, and it deliberately asserts almost nothing.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const RUN = process.env['SPIDER_SHOT'] === '1';

// ⚑ CONTAINMENT: the ozone platform must be a launch ARGUMENT, not an env hint and
// not appendSwitch inside the entry -- both are applied after the platform is
// chosen, so the app lands on the developer's real screen. See the long note in
// workspace.e2e.test.ts; verified by counting the windows that appear on :99.
const OZONE_ARGS = process.env['PLOTTRACER_OZONE_PLATFORM']
  ? [`--ozone-platform=${process.env['PLOTTRACER_OZONE_PLATFORM']}`]
  : [];


let app: ElectronApplication;
let page: Page;

describe.runIf(RUN)('spider screenshot harness', () => {
  beforeEach(async () => {
    app = await electron.launch({
      args: [...OZONE_ARGS, path.join(REPO_ROOT, 'ui/electron-dev.cjs'), '--built'],
      cwd: REPO_ROOT,
      timeout: 30000,
      env: { ...process.env, WPD_E2E: '1' },
    });
    page = await app.firstWindow();
    page.on('dialog', (d) => void d.accept());
    // Stub the native open dialog onto the spider example, exactly as the
    // workspace harness does for its own sample.
    await app.evaluate(({ dialog }, samplePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [samplePath] });
    }, path.join(REPO_ROOT, 'samples/spider-material-profile.png'));
  });

  afterEach(async () => {
    await app.close();
  });

  it('opens the spider example, calibrates it and starts capturing', async () => {
    const CX = 520;
    const CY = 320;
    const R = 110;
    const spoke = (i: number, n: number, radius = R): [number, number] => [
      CX + radius * Math.sin((2 * Math.PI * i) / n),
      CY - radius * Math.cos((2 * Math.PI * i) / n),
    ];

    await page.getByTestId('open-image-button').click();
    await page.waitForTimeout(1200);
    await page.getByTestId('axes-type-trigger').click();
    await page.getByTestId('axes-option-spider').click();
    await page.getByTestId('capture-figure').click();
    await page.waitForTimeout(200);

    const box = (await page.locator('canvas').first().boundingBox())!;
    const clickAt = async (lx: number, ly: number) => {
      await page.mouse.click(box.x + lx, box.y + ly);
      await page.waitForTimeout(120);
    };
    const confirm = async (values: string[]) => {
      for (let i = 0; i < values.length; i++) {
        const id = i === 0 ? 'data-value-input' : `data-value-input-${i}`;
        await page.locator(`[data-testid="${id}"]`).click({ timeout: 5000 });
        await page.keyboard.press('Control+a');
        await page.keyboard.type(values[i]!);
      }
      await page.locator('[data-testid="confirm-data-value"]').click({ timeout: 5000 });
      await page.waitForTimeout(120);
    };

    await clickAt(CX, CY);
    await confirm(['0']);
    const names = ['Tensile', 'Elongation', 'Barrier', 'Transparency', 'Biodegradation', 'Cost'];
    const maxima = ['120', '60', '25', '100', '80', '5'];
    for (let i = 0; i < 6; i++) {
      if (i >= 3) await page.getByTestId('add-repeat-step').click();
      await clickAt(...spoke(i, 6));
      await confirm([maxima[i]!, names[i]!]);
    }
    await page.getByTestId('run-calibration').click();
    await page.waitForTimeout(300);

    // Capture two axes, so the live ray has moved on and the table has values.
    await clickAt(...spoke(0, 6, R * 0.7));
    await clickAt(...spoke(1, 6, R * 0.5));

    // Hold the state open long enough for the frame grab.
    await page.waitForTimeout(9000);
  }, 60000);
});
