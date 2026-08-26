/**
 * THE WEBSITE GALLERY, RE-SHOT FROM THE BUILT APP.
 *
 * ⚑⚑ THIS IS AN INSTRUMENT, NOT A PHOTO SESSION. The last time these were taken
 * by hand (2026-08-23) driving the app for them produced NINE findings in one
 * sitting, none of which any test had anything to say about. David, starting
 * this round: *"We were here 3 days ago and found so many things that did not
 * work then."* So every frame is meant to be READ, and what it shows is the
 * output.
 *
 * ⚑⚑ THE WALK IS PROMPT-DRIVEN, which is CLAUDE.md's fourth gate made
 * mechanical: this harness reads the step the calibration bar is asking for and
 * supplies the matching anchor. It cannot click a coordinate no prompt asked
 * for, and if a walk gains a step the harness follows it instead of silently
 * calibrating something else.
 *
 * ⚠️ AND THE ANCHORS ARE THE FIGURE'S OWN. They come from each sample's
 * committed `.truth.json`, converted through the view the app reports in its
 * status line. Eyeballed coordinates are how the swatch harness came to
 * photograph a defect while every line of code was correct - a wrong fixture and
 * an absent feature look identical from a screenshot.
 *
 * Usage:
 *   WEBSITE_SHOTS=1 SHOT_OUT=/tmp/shots npx vitest run ui/__tests__/websiteShots.e2e.test.ts
 *   WEBSITE_SHOTS=1 SHOT_ONLY=pie ...   one card only
 */
import { describe, it, beforeAll, afterAll } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ozoneArgs } from './e2eContainment.js';

const REPO_ROOT = path.resolve(__dirname, '../..');
const RUN = process.env['WEBSITE_SHOTS'] === '1';
const OUT = process.env['SHOT_OUT'] ?? '/tmp/shots';
const ONLY = process.env['SHOT_ONLY'] ?? '';

/** A step label as the calibration bar prints it, to a truth-file anchor key. */
const ANCHOR_KEY: Record<string, string> = {
  cat1: 'c1',
  catn: 'c2',
};
const anchorKeyFor = (label: string) => {
  const k = label.toLowerCase().replace(/[\s.]/g, '');
  return ANCHOR_KEY[k] ?? k;
};

interface Card {
  /** The website file this replaces, without the extension. */
  name: string;
  sample: string;
  type: string;
  /** What the caption on the site claims this frame shows. Read the frame
   *  against THIS, not against "does it look nice". */
  claim: string;
  /** Everything after the walk: capture, trace, fit. */
  after?: (d: Driver) => Promise<void>;
}

interface Driver {
  page: Page;
  /** Image pixels to canvas coordinates, through the view the app reports. */
  at(px: number, py: number): Promise<[number, number]>;
  click(px: number, py: number): Promise<void>;
  drag(a: [number, number], b: [number, number]): Promise<void>;
  testId(id: string): ReturnType<Page['getByTestId']>;
  text(id: string): Promise<string>;
  wait(ms: number): Promise<void>;
}


/** By-colour auto-extract, through the wand that fronts it. */
async function traceColour(d: Driver, hex: string, shape?: 'curve' | 'scatter', opts?: { minBlob?: string; tolerance?: string }) {
  const pressed = await d.testId('mode-auto-extract').getAttribute('aria-pressed');
  if (pressed !== 'true') await d.testId('mode-auto-extract').click();
  await d.testId('auto-extract-colour').click();
  await d.page.locator('[data-testid="auto-extract-colour"][aria-pressed="true"]').waitFor();
  await d.wait(200);
  await d.testId('color-trace-color').fill(hex);
  if (shape && (await d.testId('color-trace-shape').count()) > 0) {
    await d.testId('color-trace-shape').selectOption(shape);
  }
  if (opts?.minBlob && (await d.testId('color-trace-min-blob').count()) > 0) {
    await d.testId('color-trace-min-blob').fill(opts.minBlob);
  }
  if (opts?.tolerance) await d.testId('color-trace-tolerance').fill(opts.tolerance);
  await d.wait(150);
  await d.testId('color-trace-run').click();
  await d.wait(900);
}

const CARDS: Card[] = [
  {
    name: 'shot-hero',
    sample: 'xy-dashed-release',
    type: 'xy',
    claim: 'Four dash-coded curves that cross, two traced from a handful of guide points, and the points land on the ink.',
    async after(d) {
      // ⚑ ONE SERIES PER CURVE, which is what the figure is: four formulations.
      // Their inks are near-greys of different value, so this is also the
      // greyscale-ish case the site claims the tool handles.
      const inks = ['#3f3f3f', '#5f5f5f', '#7f7f7f', '#1f4e79'];
      for (let i = 0; i < inks.length; i += 1) {
        if (i > 0) {
          await d.testId('add-series').click();
          await d.wait(250);
        }
        await traceColour(d, inks[i]!, 'curve', { tolerance: '28' });
      }
    },
  },
  {
    name: 'shot-scatter-fit',
    sample: 'scatter-crosslink-modulus',
    type: 'xy',
    claim: 'A scatter plot with a fitted trend line; the fit exports as its own block.',
    async after(d) {
      await traceColour(d, '#1f4e79', 'scatter', { minBlob: '4' });
      await d.testId('curve-fit-trigger').click();
      await d.wait(300);
      await d.testId('curve-fit-model').selectOption('polynomial');
      await d.testId('curve-fit-degree').selectOption('2');
      await d.testId('curve-fit-run').click();
      await d.wait(700);
    },
  },
  {
    name: 'shot-histogram',
    sample: 'histogram-pore-size',
    type: 'histogram',
    claim: 'True histogram bins - the interval each bar spans and its height, not just centres.',
    async after(d) {
      await traceColour(d, '#1f4e79', undefined, { minBlob: '6' });
    },
  },
  {
    name: 'shot-bar',
    sample: 'bar-floating-temperature',
    type: 'bar',
    claim: 'Floating bars measured end to end; a range that crosses zero stays one bar.',
    async after(d) {
      await traceColour(d, '#1f4e79', undefined, { minBlob: '6' });
    },
  },
  {
    name: 'shot-boxplot',
    sample: 'bar-box-plot-tensile-strength',
    type: 'boxplot',
    claim: 'Quartiles and whiskers captured per category, named and exported side by side.',
  },
  {
    name: 'shot-heatmap',
    sample: 'heatmap-timecourse',
    type: 'heatmap',
    claim: 'Every cell read through a calibrated colour key, on boundaries measured from the figure - unequal columns come back unequal.',
  },
  {
    name: 'shot-pie',
    sample: 'pie-exploded-market-share',
    type: 'pie',
    claim: 'The centre FITTED from the outline, an exploded slice captured about its own apex, sectors summing to 99.77% rather than a tidied 100.',
  },
  {
    name: 'shot-spider',
    sample: 'spider-material-profile',
    type: 'spider',
    claim: 'Six axes each calibrated on its own scale, three series traced by colour.',
  },
  {
    name: 'shot-errorbars',
    sample: 'errorbar-failure-time-asymmetric',
    type: 'xy',
    claim: 'Asymmetric caps placed where the figure draws them; +360.87 above and -208.70 below on the first point.',
  },
];

let app: ElectronApplication;
let page: Page;

async function launch(sample: string) {
  app = await electron.launch({
    // ⚑⚑ 2x DEVICE PIXELS OVER A NORMAL-SIZED WINDOW, which is what the
    // gallery's existing assets are: 2888x1888 is a ~1444x944 window on a
    // fractionally-scaled 4K display. Simply making the WINDOW 2880 wide is not
    // the same thing and looks wrong - the app does not upscale a figure past
    // 1:1, so a 900px sample sat at 100% in a vast empty canvas while David's
    // own shots have it filling the frame at 93%.
    args: [
      ...ozoneArgs(),
      '--force-device-scale-factor=2',
      path.join(REPO_ROOT, 'ui/electron-dev.cjs'),
      '--built',
    ],
    cwd: REPO_ROOT,
    timeout: 30000,
    env: { ...process.env, WPD_E2E: '1' },
  });
  page = await app.firstWindow();
  // ⚑ The window the existing gallery assets were taken at, in CSS pixels; the
  // 2x device scale above turns each frame into the ~2888x1888 the site expects.
  // ⚠️ CLAUDE.md: a fixed display size is authoritative about CONTENT and only
  // suggestive about LAYOUT. These frames are evidence of what the app SAYS.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setSize(Number(process.env['SHOT_W'] ?? 1444), Number(process.env['SHOT_H'] ?? 944));
  });
  await page.waitForTimeout(600);
  page.on('dialog', (d) => void d.accept());
  await app.evaluate(({ dialog }, p2) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p2] });
  }, path.join(REPO_ROOT, 'samples', `${sample}.png`));
  await page.getByTestId('open-image-button').click();
  await page.waitForTimeout(1600);
}

function driverFor(): Driver {
  const box = async () => (await page.locator('canvas').first().boundingBox())!;
  const view = async () => {
    const s = (await page.getByTestId('view-state').textContent()) ?? '';
    const m = /scale: ([0-9.]+), offset: \(([-0-9.]+), ([-0-9.]+)\)/.exec(s);
    if (!m) throw new Error(`no view in status line: ${s}`);
    return { scale: Number(m[1]), ox: Number(m[2]), oy: Number(m[3]) };
  };
  const at = async (px: number, py: number): Promise<[number, number]> => {
    const v = await view();
    return [px * v.scale + v.ox, py * v.scale + v.oy];
  };
  return {
    page,
    at,
    async click(px, py) {
      const [lx, ly] = await at(px, py);
      const b = await box();
      await page.mouse.click(b.x + lx, b.y + ly);
      await page.waitForTimeout(140);
    },
    async drag(a, b2) {
      const [ax, ay] = await at(a[0], a[1]);
      const [bx, by] = await at(b2[0], b2[1]);
      const b = await box();
      await page.mouse.move(b.x + ax, b.y + ay);
      await page.mouse.down();
      await page.mouse.move(b.x + bx, b.y + by, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(200);
    },
    testId: (id) => page.getByTestId(id),
    text: async (id) => (await page.getByTestId(id).textContent()) ?? '',
    wait: (ms) => page.waitForTimeout(ms),
  };
}

/** Type a value into the step prompt, when the step asks for one. */
async function confirmValue(v: string) {
  await page.mouse.move(5, 5);
  await page.waitForTimeout(120);
  const input = page.locator('[data-testid="data-value-input"]');
  if ((await input.count()) === 0) return false;
  await input.first().fill(v, { timeout: 6000, force: true });
  await page.locator('[data-testid="confirm-data-value"]').first().click({ timeout: 6000, force: true });
  await page.waitForTimeout(160);
  return true;
}

/**
 * Walk the calibration by READING WHAT IS ASKED FOR.
 *
 * ⚑ The step's own label picks the anchor, so this cannot click a coordinate no
 * prompt requested - and a walk that gains a step is followed rather than
 * silently skipped. Returns the labels it answered, so a caller can say what
 * the figure actually asked.
 */
async function walkCalibration(d: Driver, anchors: Record<string, { px: number; py: number; value?: unknown }>) {
  const answered: string[] = [];
  for (let guard = 0; guard < 14; guard += 1) {
    // ⚑⚑ THE TIPS BAR, NOT THE STEP MATRIX. The matrix marks the live step with
    // "click image", which is only true while a CLICK is what is wanted - a
    // shared corner arrives already placed and waiting for its VALUE, and the
    // matrix has no way to say so, so the walk looked finished three steps
    // early. The tips bar prints "<label>: <prompt>" for whatever the step
    // actually needs, which is the sentence a user reads too.
    const tip = await d.text('tips-bar');
    const m = /Calibration step \d+\/\d+ - ([^:]{1,12}):/.exec(tip);
    const label = m ? m[1]!.trim() : null;
    if (!label) break;
    const key = anchorKeyFor(label);
    const a = anchors[key];
    if (!a) throw new Error(`step "${label}" (key ${key}) has no anchor; have ${Object.keys(anchors).join(',')}`);
    // ⚑ A step whose pixel is ALREADY PLACED (a reused corner) must not be
    // clicked again - the prompt says so in its own words, and clicking would
    // move a point the walk had already settled.
    const reused = /same corner again|already/i.test(tip);
    if (!reused) await d.click(a.px, a.py);
    if (a.value !== undefined) await confirmValue(String(a.value));
    else await confirmValue('');
    answered.push(label);
  }
  return answered;
}

describe.runIf(RUN)('website gallery shots', () => {
  beforeAll(() => {
    mkdirSync(OUT, { recursive: true });
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  for (const card of CARDS) {
    if (ONLY && !card.name.includes(ONLY)) continue;
    it(
      `${card.name} - ${card.claim}`,
      async () => {
        await launch(card.sample);
        const d = driverFor();
        await page.getByTestId('axes-type-trigger').click();
        await page.getByTestId(`axes-option-${card.type}`).click();
        await page.getByTestId('capture-figure').click();
        await page.waitForTimeout(400);

        const truth = JSON.parse(
          readFileSync(path.join(REPO_ROOT, 'samples', `${card.sample}.truth.json`), 'utf8')
        ) as { calibration?: { anchors?: Record<string, { px: number; py: number; value?: unknown }> } };
        const anchors = truth.calibration?.anchors ?? {};
        const answered = await walkCalibration(d, anchors);
        // eslint-disable-next-line no-console
        console.log(`${card.name}: walk asked for [${answered.join(', ')}]`);
        if (process.env['SHOT_PRECALIB'] === '1') {
          await page.screenshot({ path: path.join(OUT, `${card.name}-precalib.png`), scale: 'device' });
        }
        await page.getByTestId('run-calibration').click();
        await page.waitForTimeout(700);

        if (card.after) await card.after(d);
        {
          const b = (await page.locator('canvas').first().boundingBox())!;
          const v = (await page.getByTestId('view-state').textContent()) ?? '';
          // eslint-disable-next-line no-console
          console.log(`PROBE ${card.name}: canvas ${Math.round(b.width)}x${Math.round(b.height)} CSS at (${Math.round(b.x)},${Math.round(b.y)}) | ${v.trim()}`);
        }
        // ⚑ `device`, not the CSS default - otherwise the 2x above is thrown
        // away at the moment of capture and the file comes out half-size.
        await page.screenshot({ path: path.join(OUT, `${card.name}.png`), scale: 'device' });
        await app.close();
      },
      180000
    );
  }
});
