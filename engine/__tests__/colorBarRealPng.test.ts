import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPng } from './helpers/readPng.js';
import {
  invertColor,
  medoidColor,
  positionOnStrip,
  sampleColorBar,
  type ColorBarStrip,
} from '../../algorithms/colorBar.js';
import type { RGB } from '../../algorithms/colorFilter.js';

/**
 * The colour bar, measured against REAL RENDERS rather than a ramp a test drew.
 *
 * ⚑ WHY THIS FILE EXISTS SEPARATELY FROM `algorithms/__tests__/colorBar.test.ts`.
 * The unit tests invert ramps written byte by byte, where every cell colour is
 * exactly a colour on the key. Nothing in a heatmap's real failure mode looks
 * like that: the risk is a colour moved by ANTI-ALIASING, by a 256-entry lookup
 * table, or by JPEG, which inverts to a slightly wrong number and shows no
 * symptom at all. A synthetic ramp cannot ask that question, and this is exactly
 * the trap the spider over-read fell into for three releases.
 *
 * The fixtures are matplotlib renders that ship the values they were drawn from
 * (`samples/generators/gen_colorbar_fixtures.py`), so this measures the whole
 * chain — sample the key, invert a cell, map through two labelled ticks — against
 * ground truth.
 *
 * ⚑⚑ IT FOUND TWO DEFECTS THE SYNTHETIC TESTS COULD NOT SEE, both of them the
 * silent kind. A colormap is a LOOKUP TABLE, so a key repeats each colour over a
 * plateau of pixels: (1) taking the first tied position biased every reading to
 * the low end of its plateau, a constant signed error that averaging cells does
 * not remove, and (2) a band narrower than one step of the key excluded the true
 * value while reporting distance 0. Neither is expressible in a ramp that is
 * continuous by construction.
 *
 * ⚑ THE CLAIM UNDER TEST IS NOT "THE ERROR IS SMALL". On the JPEG fixture it is
 * not small. The claim is that the error is REPORTED — see the silent-miss test,
 * which is the one that matters most in this file.
 */

interface TruthCell {
  x: number;
  y: number;
  value: number;
}
interface TruthTick {
  x: number;
  y: number;
  value: number;
}
interface TruthFigure {
  file: string;
  cmap: string;
  key: {
    from: { x: number; y: number };
    to: { x: number; y: number };
    ticks: TruthTick[];
    height_px: number;
  };
  cells: TruthCell[];
}

const truth = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/colorbars/truth.json', import.meta.url)), 'utf8')
) as { figures: TruthFigure[] };

function figure(file: string): TruthFigure {
  const found = truth.figures.find((f) => f.file === file);
  if (!found) throw new Error(`no truth for ${file}`);
  return found;
}

type Image = { data: Uint8ClampedArray; width: number; height: number };

function loadPixels(file: string): Image {
  return readPng(fileURLToPath(new URL(`./fixtures/colorbars/${file}`, import.meta.url)));
}

/** The key as the app will read it: down the middle of the strip, a few pixels
 * thick so a frame or a tick clipping the window is outvoted. */
function keyStrip(fig: TruthFigure, img: Image): ColorBarStrip {
  const result = sampleColorBar(img.data, img.width, img.height, fig.key.from, fig.key.to, {
    thickness: 5,
  });
  expect(result.reason).toBeNull();
  return result.strip!;
}

function pixelAt(img: Image, x: number, y: number): RGB {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
}

/** A cell sampled the way phase 3's capture will: the medoid of a small window,
 * which is a colour that was actually printed rather than a blend of a cell and
 * whatever crosses it. */
function cellColor(img: Image, x: number, y: number, half = 2): RGB {
  const window: RGB[] = [];
  for (let dy = -half; dy <= half; dy++)
    for (let dx = -half; dx <= half; dx++) {
      const px = Math.round(x) + dx;
      const py = Math.round(y) + dy;
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
      window.push(pixelAt(img, px, py));
    }
  return medoidColor(window)!;
}

interface CellOutcome {
  error: number;
  covered: boolean;
  bandWidth: number;
  distance: number;
  ambiguous: boolean;
}

/**
 * Read every cell of a figure through its key, exactly as the app will: two
 * labelled ticks give position → value, and the reading's band is carried
 * through the same mapping so the uncertainty stays in the figure's own units.
 */
function readFigure(fig: TruthFigure, sample: (img: Image, c: TruthCell) => RGB): CellOutcome[] {
  const img = loadPixels(fig.file);
  const strip = keyStrip(fig, img);
  const [tickA, tickB] = [fig.key.ticks[0]!, fig.key.ticks[1]!];
  const tA = positionOnStrip(strip, tickA)!;
  const tB = positionOnStrip(strip, tickB)!;
  const toValue = (t: number): number =>
    tickA.value + ((t - tA) / (tB - tA)) * (tickB.value - tickA.value);

  return fig.cells.map((cell) => {
    const reading = invertColor(strip, sample(img, cell))!;
    const ends = [toValue(reading.tLow), toValue(reading.tHigh)];
    const lo = Math.min(...ends);
    const hi = Math.max(...ends);
    return {
      error: Math.abs(toValue(reading.t) - cell.value),
      covered: cell.value >= lo && cell.value <= hi,
      bandWidth: hi - lo,
      distance: reading.distance,
      ambiguous: reading.rivals.length > 0,
    };
  });
}

const max = (xs: number[]): number => xs.reduce((a, b) => Math.max(a, b), 0);
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const HEATMAPS = ['heatmap-viridis.png', 'heatmap-jet.png', 'heatmap-jet-jpeg.png'];

describe('colour bar against real matplotlib renders', () => {
  it('reads a clean heatmap to a fraction of a degree', () => {
    // Measured on a −40..120 °C key ~550px long: viridis max 0.64 °C, mean 0.26;
    // jet max 0.64, mean 0.24. That residue is the key's own lookup table — 256
    // entries over 160 °C is 0.625 °C per entry, so half an entry is the floor
    // any inversion through this key can reach. We are at it.
    for (const name of ['heatmap-viridis.png', 'heatmap-jet.png']) {
      const outcomes = readFigure(figure(name), (img, c) => cellColor(img, c.x, c.y));
      expect(outcomes).toHaveLength(20);
      expect(max(outcomes.map((o) => o.error))).toBeLessThan(1.0);
      expect(mean(outcomes.map((o) => o.error))).toBeLessThan(0.4);
      expect(outcomes.every((o) => o.covered)).toBe(true);
    }
  });

  it('NEVER misses silently — every band that missed the truth said so', () => {
    // ⚑⚑ THE CENTRAL CLAIM OF THE WHOLE MODULE, and the only one that would
    // still matter if the accuracy were worse. In a heatmap the colour IS the
    // value, so a wrong reading has no other symptom: no missing point, no
    // refusal, nothing odd on screen. What makes that survivable is that the
    // reading carries its own evidence.
    //
    // Measured across all three heatmap fixtures (60 cells): 7 cells' bands
    // missed the truth, ALL of them on the quality-35 JPEG, and every one
    // reported a non-zero distance off the ramp. All 42 cells that reported
    // distance 0 were covered. Not one cell was both wrong and confident.
    let silent = 0;
    let flagged = 0;
    let exact = 0;
    for (const name of HEATMAPS) {
      for (const o of readFigure(figure(name), (img, c) => cellColor(img, c.x, c.y))) {
        if (o.distance === 0) exact++;
        if (!o.covered) {
          if (o.distance === 0) silent++;
          else flagged++;
        }
      }
    }
    expect(silent).toBe(0);
    // The flag has to be doing work rather than being permanently on: most cells
    // report an exact match, so "distance > 0" singles out a real minority.
    expect(exact).toBeGreaterThan(40);
    expect(flagged).toBeGreaterThan(0);
  });

  it('widens the band on `jet`s ill-conditioned stretch, located by measurement', () => {
    // ⚑ THE PRECONCEPTION WAS HALF WRONG AND THE FIXTURE SETTLED IT. `jet` is
    // ill-conditioned "near its ends" — but measured against its own lookup
    // table, its mean step (4.26 RGB units per entry) is more than DOUBLE
    // viridis's (1.90), so over most of its length jet is the better-conditioned
    // of the two in RGB terms and its bands are NARROWER. The ill-conditioning is
    // local: four consecutive entries around u = 0.11–0.12 are byte-identical.
    // A first version of this test asserted "jet's bands are wider than
    // viridis's" and was simply false.
    const fig = figure('heatmap-jet.png');
    const img = loadPixels(fig.file);
    const strip = keyStrip(fig, img);
    const [tickA, tickB] = [fig.key.ticks[0]!, fig.key.ticks[1]!];
    const xOfValue = (v: number): number =>
      tickA.x + ((v - tickA.value) / (tickB.value - tickA.value)) * (tickB.x - tickA.x);
    const bandAt = (value: number): number => {
      const reading = invertColor(strip, pixelAt(img, xOfValue(value), fig.key.from.y))!;
      return reading.tHigh - reading.tLow;
    };
    // u = 0.115 of the −40..120 range is −21.6 °C, the flat patch; 40 °C and
    // 88 °C sit in the steep stretches either side of it.
    expect(bandAt(-21.6)).toBeGreaterThan(bandAt(40) * 1.8);
    expect(bandAt(-21.6)).toBeGreaterThan(bandAt(88) * 1.8);
  });

  it('reports the damage JPEG does rather than absorbing it', () => {
    const clean = readFigure(figure('heatmap-jet.png'), (img, c) => cellColor(img, c.x, c.y));
    const jpeg = readFigure(figure('heatmap-jet-jpeg.png'), (img, c) => cellColor(img, c.x, c.y));
    // The same figure, the same cells, the same key — only the encoder differs.
    expect(max(jpeg.map((o) => o.error))).toBeGreaterThan(max(clean.map((o) => o.error)));
    expect(max(jpeg.map((o) => o.distance))).toBeGreaterThan(0);
    expect(max(clean.map((o) => o.distance))).toBe(0);
  });

  it('a medoid window is at least as good a sample as a single pixel', () => {
    // Why phase 3's capture must sample a WINDOW: on a degraded figure one pixel
    // can sit inside a JPEG ringing artefact, and the medoid outvotes it.
    const fig = figure('heatmap-jet-jpeg.png');
    const single = readFigure(fig, (img, c) => pixelAt(img, c.x, c.y));
    const window = readFigure(fig, (img, c) => cellColor(img, c.x, c.y));
    expect(max(window.map((o) => o.error))).toBeLessThanOrEqual(max(single.map((o) => o.error)));
  });

  it('finds two candidate positions on a real cyclic key', () => {
    // ⚑ AMBIGUITY, NOT IMPRECISION. `twilight` ends on the colour it starts on,
    // so a cell of that colour has two exact answers. Picking one would be a coin
    // toss with no symptom; the module returns both.
    const fig = figure('key-cyclic.png');
    const img = loadPixels(fig.file);
    const strip = keyStrip(fig, img);
    const reading = invertColor(strip, pixelAt(img, fig.key.from.x, fig.key.from.y))!;
    expect(reading.rivals).toHaveLength(1);
    // At the far end, not next door — that is what makes it a rival rather than
    // the same band read twice.
    expect(Math.abs(reading.rivals[0]!.t - reading.t)).toBeGreaterThan(0.9);
  });

  it('refuses a strip clicked across the key instead of along it', () => {
    // The mis-click that would otherwise map every cell in the figure to one
    // meaningless value. Real render, real key, wrong gesture.
    const fig = figure('heatmap-viridis.png');
    const img = loadPixels(fig.file);
    const midX = (fig.key.from.x + fig.key.to.x) / 2;
    const result = sampleColorBar(
      img.data,
      img.width,
      img.height,
      { x: midX, y: fig.key.from.y - fig.key.height_px / 2 + 2 },
      { x: midX, y: fig.key.from.y + fig.key.height_px / 2 - 2 }
    );
    expect(result.reason).toBe('no-ramp');
  });

  it('locates the two labelled ticks along the strip in the order they were clicked', () => {
    const fig = figure('heatmap-viridis.png');
    const img = loadPixels(fig.file);
    const strip = keyStrip(fig, img);
    const tA = positionOnStrip(strip, fig.key.ticks[0]!)!;
    const tB = positionOnStrip(strip, fig.key.ticks[1]!)!;
    expect(tA).toBeGreaterThan(0);
    expect(tB).toBeLessThan(1);
    expect(tA).toBeLessThan(tB);
    // A tick clicked a few pixels above the bar is the same tick: the component
    // across the strip carries no information and must not move the position.
    const nudged = positionOnStrip(strip, {
      x: fig.key.ticks[0]!.x,
      y: fig.key.ticks[0]!.y - 6,
    })!;
    expect(nudged).toBeCloseTo(tA, 10);
  });
});
