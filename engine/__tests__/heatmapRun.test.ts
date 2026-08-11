import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPng } from './helpers/readPng.js';
import { XYAxes } from '../../core/axes/xy.js';
import { Calibration } from '../../core/calibration.js';
import {
  buildColorScale,
  detectGrid,
  initialGrid,
  readHeatmapCells,
  type SourceImage,
} from '../heatmapRun.js';
import type { PlacedCalibPoint } from '../calibrationSession.js';

/**
 * The heatmap capture run, driven the way the CARD will drive it (v2.2, 3b).
 *
 * ⚑ This is the layer the UI calls, so it is tested with the UI's own inputs:
 * the placed calibration points as a session hands them over, and the image as
 * the canvas hands it over. What the UI is then left holding is a button and a
 * label — which matters because mutation testing cannot see `ui/` at all, and
 * its only other instrument is an 18-minute Electron run.
 */

interface TruthFigure {
  file: string;
  key: { from: { x: number; y: number }; to: { x: number; y: number }; ticks: Array<{ x: number; y: number; value: number }> };
  frame: Record<'x1' | 'x2' | 'y1' | 'y2', { x: number; y: number; value: number }>;
  grid: { x: number[]; y: number[] };
  cells: Array<{ value: number; x_min: number; x_max: number; y_min: number; y_max: number }>;
}

const truth = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/colorbars/truth.json', import.meta.url)), 'utf8')
) as { figures: TruthFigure[] };

function scene(file = 'heatmap-viridis.png') {
  const fig = truth.figures.find((f) => f.file === file)!;
  const png = readPng(fileURLToPath(new URL(`./fixtures/colorbars/${file}`, import.meta.url)));
  const image: SourceImage = { data: png.data, width: png.width, height: png.height };
  const cal = new Calibration();
  cal.addPoint(fig.frame.x1.x, fig.frame.x1.y, String(fig.frame.x1.value), '');
  cal.addPoint(fig.frame.x2.x, fig.frame.x2.y, String(fig.frame.x2.value), '');
  cal.addPoint(fig.frame.y1.x, fig.frame.y1.y, '', String(fig.frame.y1.value));
  cal.addPoint(fig.frame.y2.x, fig.frame.y2.y, '', String(fig.frame.y2.value));
  const axes = new XYAxes();
  expect(axes.calibrate(cal, false, false, true)).toBe(true);

  // The four key clicks, exactly as the session stores them.
  const placed: Record<string, PlacedCalibPoint> = {
    k1: { px: fig.key.from.x, py: fig.key.from.y, values: [] },
    k2: { px: fig.key.to.x, py: fig.key.to.y, values: [] },
    kv1: { px: fig.key.ticks[0]!.x, py: fig.key.ticks[0]!.y, values: [String(fig.key.ticks[0]!.value)] },
    kv2: { px: fig.key.ticks[1]!.x, py: fig.key.ticks[1]!.y, values: [String(fig.key.ticks[1]!.value)] },
  };
  return { fig, image, axes, placed };
}

describe('buildColorScale', () => {
  it('samples the key from the image and calibrates it from the two ticks', () => {
    const { image, placed } = scene();
    const { scale, error } = buildColorScale(placed, image, false);
    expect(error).toBeNull();
    expect(scale!.strip.samples.length).toBeGreaterThan(400);
  });

  it('says what is missing before the key is fully clicked', () => {
    const { image, placed } = scene();
    const partial = { k1: placed['k1']!, k2: placed['k2']! };
    const { scale, error } = buildColorScale(partial, image, false);
    expect(scale).toBeNull();
    expect(error).toMatch(/not calibrated yet/i);
  });

  it('refuses the across-the-bar mis-click with a sentence that says what to do', () => {
    const { image, placed } = scene();
    const acrossTheBar = {
      ...placed,
      k2: { px: placed['k1']!.px + 1, py: placed['k1']!.py + 2, values: [] },
    };
    const { error } = buildColorScale(acrossTheBar, image, false);
    expect(error).toMatch(/along its length/i);
  });

  it('refuses a key whose two ticks carry the same number', () => {
    const { image, placed } = scene();
    const same = { ...placed, kv2: { ...placed['kv2']!, values: placed['kv1']!.values } };
    expect(buildColorScale(same, image, false).error).toMatch(/same value/i);
  });

  it('refuses a log key that is not positive, naming the requirement', () => {
    const { image, placed } = scene();
    const negative = { ...placed, kv1: { ...placed['kv1']!, values: ['-20'] } };
    expect(buildColorScale(negative, image, true).error).toMatch(/positive values/i);
  });
});

describe('detectGrid', () => {
  it('fills in a grid that matches the figure, from the ink', () => {
    const { fig, image, axes } = scene();
    const start = initialGrid({ xMin: 0, xMax: 9, yMin: 0, yMax: 8 });
    expect(start.xDividers).toEqual([0, 9]);
    const result = detectGrid(image, axes, start, { columns: 5, rows: 4 });
    expect(result.agrees).toBe(true);
    expect(result.grid!.xDividers).toHaveLength(6);
    fig.grid.x.forEach((want, i) => {
      expect(result.grid!.xDividers[i]).toBeCloseTo(want, 1);
    });
    fig.grid.y.forEach((want, i) => {
      expect(result.grid!.yDividers[i]).toBeCloseTo(want, 1);
    });
    expect(result.message).toMatch(/5 columns/);
  });

  it('offers everything it found when no count is declared', () => {
    const { image, axes } = scene();
    const result = detectGrid(image, axes, initialGrid({ xMin: 0, xMax: 9, yMin: 0, yMax: 8 }));
    expect(result.grid!.xDividers).toHaveLength(6);
    expect(result.message).toMatch(/4 column boundaries found/);
  });

  it('REPORTS a miss rather than filling one in', () => {
    // ⚑ Asked for more cells than there is evidence for, the answer is a
    // sentence, not a plausible grid. A grid with a boundary missing looks
    // exactly like a grid.
    const { image, axes } = scene();
    const result = detectGrid(image, axes, initialGrid({ xMin: 0, xMax: 9, yMin: 0, yMax: 8 }), {
      columns: 9,
    });
    expect(result.grid).toBeNull();
    expect(result.agrees).toBe(false);
    expect(result.message).toMatch(/Found 4 of the 8 boundaries/);
    expect(result.message).toMatch(/by hand/);
  });

  it('needs an outer boundary on each axis first', () => {
    const { image, axes } = scene();
    const result = detectGrid(image, axes, { xDividers: [3], yDividers: [0, 8] });
    expect(result.grid).toBeNull();
    expect(result.message).toMatch(/outer boundary/i);
  });
});

describe('readHeatmapCells', () => {
  it('reads the figure end to end and reports every cell as clean', () => {
    // ⚑ THE WHOLE FEATURE, in the order a user performs it: calibrate the key,
    // detect the grid, read the cells.
    const { fig, image, axes, placed } = scene();
    const { scale } = buildColorScale(placed, image, false);
    const { grid } = detectGrid(image, axes, initialGrid({ xMin: 0, xMax: 9, yMin: 0, yMax: 8 }), {
      columns: 5,
      rows: 4,
    });
    const { rows, summary, error } = readHeatmapCells(image, axes, grid!, scale!);
    expect(error).toBeNull();
    expect(rows).toHaveLength(20);
    expect(summary).toBe('20 cells read, all clean.');
    for (const row of rows) {
      const t = fig.cells.find(
        (c) =>
          Math.abs(c.x_min - row.xMin) < 0.05 &&
          Math.abs(c.x_max - row.xMax) < 0.05 &&
          Math.abs(c.y_min - row.yMin) < 0.05 &&
          Math.abs(c.y_max - row.yMax) < 0.05
      )!;
      expect(t, `no truth cell for ${row.xMin}..${row.xMax}`).toBeDefined();
      expect(Math.abs(row.value! - t.value)).toBeLessThan(1.5);
      expect(row.warning).toBe('');
    }
  });

  it('tells the user how many cells need a look on a degraded figure', () => {
    // ⚑ The counterpart, and what stops the summary being decoration: on a
    // quality-35 JPEG most cells cannot vouch for themselves, and the card says
    // so instead of presenting 20 confident numbers.
    const { image, axes, placed } = scene('heatmap-jet-jpeg.png');
    const { scale } = buildColorScale(placed, image, false);
    const { rows, summary } = readHeatmapCells(
      image,
      axes,
      { xDividers: [0, 1, 3.5, 4, 6, 9], yDividers: [0, 2, 2.5, 5, 8] },
      scale!
    );
    expect(summary).toMatch(/^20 cells read; \d+ need a look\.$/);
    expect(rows.filter((r) => r.warning !== '').length).toBeGreaterThan(10);
    // The warnings name what is wrong, in the figure's own terms.
    expect(rows.some((r) => /off the key/.test(r.warning))).toBe(true);
    expect(rows.some((r) => /% of the cell/.test(r.warning))).toBe(true);
  });

  it('carries the bounds, the centre and the interval into the row', () => {
    const { image, axes, placed } = scene();
    const { scale } = buildColorScale(placed, image, false);
    const { rows } = readHeatmapCells(
      image,
      axes,
      { xDividers: [0, 1, 3.5, 4, 6, 9], yDividers: [0, 2, 2.5, 5, 8] },
      scale!
    );
    const first = rows[0]!;
    expect(first).toMatchObject({ col: 0, row: 0, xMin: 0, xMax: 1, yMin: 0, yMax: 2 });
    expect(first.xCentre).toBeCloseTo(0.5, 6);
    expect(first.low).toBeLessThan(first.value!);
    expect(first.high).toBeGreaterThan(first.value!);
    expect(first.rivalValues).toEqual([]);
  });

  it('reports a cell it could not read as EMPTY, never as zero', () => {
    const { image, axes, placed } = scene();
    const { scale } = buildColorScale(placed, image, false);
    // A grid dragged far off the figure.
    const { rows } = readHeatmapCells(
      image,
      axes,
      { xDividers: [500, 600], yDividers: [500, 600] },
      scale!
    );
    expect(rows[0]!.value).toBeNull();
    expect(rows[0]!.warning).toBe('Not on the image');
  });

  it('needs a grid before it can read anything', () => {
    const { image, axes, placed } = scene();
    const { scale } = buildColorScale(placed, image, false);
    const result = readHeatmapCells(image, axes, { xDividers: [1], yDividers: [0, 8] }, scale!);
    expect(result.rows).toEqual([]);
    expect(result.error).toMatch(/at least one boundary/i);
  });
});
