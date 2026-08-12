import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPng } from './helpers/readPng.js';
import { XYAxes } from '../../core/axes/xy.js';
import { Calibration } from '../../core/calibration.js';
import {
  addDivider,
  buildColorScale,
  describeDivider,
  detectGrid,
  dividerHandles,
  dragDivider,
  initialGrid,
  isDividerHandle,
  labelOrderReversed,
  labelsForCells,
  readHeatmapCells,
  removeDividerHandle,
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

  // ⚑⚑ THE OTHER FOUR REFUSALS HAD NO TEST AT ALL — found by mutation, which
  // reported the sentences as no-coverage. These are the words the user reads
  // when the tool declines to measure something, and this file's stated job is
  // translating a code into a sentence that names the requirement; an empty or
  // wrong one would have shipped unnoticed. Asserting on the WORDS of a refusal
  // is what found three MISSING refusals in the axes classes.
  it('refuses a key clicked off the image, and says so', () => {
    const { image, placed } = scene();
    const off = { ...placed, k2: { px: image.width + 50, py: 10, values: [] } };
    expect(buildColorScale(off, image, false).error).toMatch(/must both be on the image/i);
  });

  it('refuses a key with nothing on it, naming transparency', () => {
    // A fully transparent strip: nothing was drawn where the user pointed.
    const blank: SourceImage = { data: new Uint8ClampedArray(40 * 40 * 4), width: 40, height: 40 };
    const onBlank = {
      k1: { px: 4, py: 20, values: [] },
      k2: { px: 36, py: 20, values: [] },
      kv1: { px: 8, py: 20, values: ['0'] },
      kv2: { px: 32, py: 20, values: ['100'] },
    };
    expect(buildColorScale(onBlank, blank, false).error).toMatch(/transparent/i);
  });

  it('refuses a tick whose value is not a number', () => {
    const { image, placed } = scene();
    const typo = { ...placed, kv1: { ...placed['kv1']!, values: ['twenty'] } };
    expect(buildColorScale(typo, image, false).error).toMatch(/must both be numbers/i);
  });

  it('REFUSES A BANDED KEY, naming why — and no real ramp trips it', () => {
    // ⚑⚑ THE THIRD AGREED CASE THAT WAS NEVER BUILT. The settled record says a
    // DISCRETE key (significance bands, cluster IDs, land cover) identifies a
    // LABEL, not a number, and must be refused naming why. Inverting a cell
    // against it lands on a plateau covering a whole range; reporting the middle
    // of that range is a number the figure does not contain, arriving with no
    // symptom — the exact failure this module exists to prevent.
    const bands = 6;
    const width = 400;
    const height = 40;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const band = Math.min(bands - 1, Math.floor((x / width) * bands));
        const i = (y * width + x) * 4;
        data[i] = 20 + band * 40;
        data[i + 1] = 90;
        data[i + 2] = 200 - band * 30;
        data[i + 3] = 255;
      }
    }
    const banded: SourceImage = { data, width, height };
    const placedOnBands = {
      k1: { px: 4, py: 20, values: [] },
      k2: { px: 396, py: 20, values: [] },
      kv1: { px: 40, py: 20, values: ['1'] },
      kv2: { px: 360, py: 20, values: ['6'] },
    };
    const refused = buildColorScale(placedOnBands, banded, false);
    expect(refused.scale).toBeNull();
    expect(refused.error).toMatch(/discrete bands/i);
    // It says what the cost is, not just that it declined.
    expect(refused.error).toMatch(/not contain|by eye/i);

    // ⚑ AND THE FIXTURES ARE THE OTHER HALF OF THIS TEST. A detector that
    // refuses banded keys is worthless if it also refuses viridis — the real
    // keys measure 108–260 levels against a threshold of 20, and this is what
    // keeps that margin honest as the sampler changes.
    const { image, placed } = scene();
    expect(buildColorScale(placed, image, false).error).toBeNull();
  });

  it('refuses two ticks clicked at the same place on the strip', () => {
    const { image, placed } = scene();
    const same = { ...placed, kv2: { ...placed['kv2']!, px: placed['kv1']!.px, py: placed['kv1']!.py } };
    expect(buildColorScale(same, image, false).error).toMatch(/same place along the strip/i);
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
    const start = initialGrid({ xMin: 0, xMax: 9, yMin: 0, yMax: 8 });
    const result = detectGrid(image, axes, start, { columns: 9 });
    // ⚑ The x axis is left EXACTLY as it was — the miss is reported, never
    // filled in, because a grid with a boundary missing looks exactly like a
    // grid and its cells are silently twice as wide as the figure's.
    expect([...result.grid!.xDividers]).toEqual([...start.xDividers]);
    expect(result.agrees).toBe(false);
    expect(result.message).toMatch(/Found 4 of the 8 boundaries/);
    expect(result.message).toMatch(/by hand/);
  });

  it('KEEPS the axis that succeeded when the other one misses', () => {
    // ⚑⚑ David typed a 6 where his figure has 5 rows. Detection found all four
    // COLUMN boundaries and then threw them away because the rows could not be
    // met — leaving a 1 × 5 grid and five cells of nonsense at x = 12. The
    // refusal was right about the rows and wrong about everything else.
    const { image, axes } = scene();
    const start = initialGrid({ xMin: 0, xMax: 9, yMin: 0, yMax: 8 });
    const result = detectGrid(image, axes, start, { columns: 5, rows: 9 });
    // The columns are there…
    expect(result.grid).not.toBeNull();
    expect(result.grid!.xDividers).toHaveLength(6);
    // …the rows are untouched, not invented…
    expect([...result.grid!.yDividers]).toEqual([...start.yDividers]);
    // …and the message still says which half failed, and that it did.
    expect(result.message).toMatch(/5 columns/);
    expect(result.message).toMatch(/by hand/);
    expect(result.agrees).toBe(false);
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

  it('says so in the ROW when a cell sits at the key’s limit', () => {
    // The warning has to reach the user, not just the object: a clipped cell is
    // the one wrong value with nothing else to give it away.
    const { image, axes, placed } = scene();
    const { scale } = buildColorScale(placed, image, false);
    // The bottom-left cell of this figure is its coldest; widen the grid to a
    // single cell so the read covers the key's extremes.
    const { rows } = readHeatmapCells(image, axes, { xDividers: [0, 9], yDividers: [0, 8] }, scale!);
    expect(rows).toHaveLength(1);
    if (rows[0]!.atKeyLimit) expect(rows[0]!.warning).toMatch(/key’s limit/);
    // And whatever this particular cell does, the flag and the sentence agree.
    expect(rows[0]!.atKeyLimit).toBe(/key’s limit/.test(rows[0]!.warning));
  });

  it('attaches the axis NAME to every cell in that column or row', () => {
    // ⚑⚑ "The label is the coordinate." A category axis's cells are identified
    // by the name the figure prints; without it the export hands back 1, 2, 3.
    const { image, axes, placed, fig } = scene();
    const { scale } = buildColorScale(placed, image, false);
    const grid = { xDividers: fig.grid.x, yDividers: fig.grid.y };
    const result = readHeatmapCells(image, axes, grid, scale!, {
      x: ['BRCA1', 'TP53'],
      y: ['tumour'],
    });
    const columns = fig.grid.x.length - 1;
    expect(result.rows[0]).toMatchObject({ col: 0, row: 0, xLabel: 'BRCA1', yLabel: 'tumour' });
    expect(result.rows[1]).toMatchObject({ col: 1, xLabel: 'TP53' });
    // ⚑ A SHORT LIST IS NOT AN ERROR — the unnamed cells keep the coordinates
    // they always had, rather than the user being pushed into inventing names.
    expect(result.rows[2]!.xLabel).toBe('');
    expect(result.rows[columns]!.yLabel).toBe('');
    // …and the measured geometry is untouched by any of it.
    expect(result.rows[0]!.xCentre).toBeCloseTo((fig.grid.x[0]! + fig.grid.x[1]!) / 2, 10);
  });

  it('leaves every label empty when the figure names nothing', () => {
    const { image, axes, placed, fig } = scene();
    const { scale } = buildColorScale(placed, image, false);
    const result = readHeatmapCells(image, axes, { xDividers: fig.grid.x, yDividers: fig.grid.y }, scale!);
    expect(result.rows.every((r) => r.xLabel === '' && r.yLabel === '')).toBe(true);
  });

  it('needs a grid before it can read anything', () => {
    const { image, axes, placed } = scene();
    const { scale } = buildColorScale(placed, image, false);
    const result = readHeatmapCells(image, axes, { xDividers: [1], yDividers: [0, 8] }, scale!);
    expect(result.rows).toEqual([]);
    expect(result.error).toMatch(/at least one boundary/i);
  });
});

describe('dragging a divider', () => {
  /** An upright frame: data x 0..10 across pixels 100..400, data y 0..20 up
   * pixels 300..100 (image y grows downward, as a figure's does). */
  const upright = { dataToPixel: (x: number, y: number) => ({ x: 100 + x * 30, y: 300 - y * 10 }) };
  const grid = { xDividers: [0, 4, 10], yDividers: [0, 20] };

  it('puts one handle on every divider, OUTSIDE the plot', () => {
    const handles = dividerHandles(grid, upright);
    expect(handles.map((h) => h.id)).toEqual(['hmx:0', 'hmx:1', 'hmx:2', 'hmy:0', 'hmy:1']);
    // x handles sit below the plot's bottom edge (y = 300), not on it.
    expect(handles[0]).toEqual({ id: 'hmx:0', x: 100, y: 316 });
    expect(handles[1]!.x).toBe(220); // the divider at data x = 4
    // y handles sit to the LEFT of the left edge (x = 100).
    expect(handles[3]).toEqual({ id: 'hmy:0', x: 84, y: 300 });
  });

  it('works out which way is OUT from the axes, not from the screen', () => {
    // ⚑ A figure calibrated upside down has its own idea of outward. Handles
    // that assumed "down and left" would sit INSIDE the plot on exactly the
    // charts that are hardest to read already.
    const flipped = { dataToPixel: (x: number, y: number) => ({ x: 100 + x * 30, y: 100 + y * 10 }) };
    const handles = dividerHandles(grid, flipped);
    // The plot's y = 0 edge is now at the TOP, so its handles go ABOVE it.
    expect(handles[0]!.y).toBe(84);
  });

  it('is empty for a grid that is not a grid', () => {
    expect(dividerHandles({ xDividers: [1], yDividers: [0, 5] }, upright)).toEqual([]);
  });

  it('tells a grid handle from a data point', () => {
    expect(isDividerHandle('hmx:0')).toBe(true);
    expect(isDividerHandle('hmy:12')).toBe(true);
    expect(isDividerHandle('x1')).toBe(false);
    expect(isDividerHandle('hmz:1')).toBe(false);
    expect(isDividerHandle('hmx:')).toBe(false);
  });

  it('moves the divider to where it was dropped', () => {
    expect(dragDivider(grid, 'hmx:1', { x: 7, y: 3 })).toEqual({
      xDividers: [0, 7, 10],
      yDividers: [0, 20],
    });
  });

  it('reads ONLY the axis the handle belongs to', () => {
    // ⚑ The gesture is constrained without a drag mode: an x handle takes the
    // drop's x and ignores its y, so it slides along its own axis wherever the
    // pointer goes.
    const a = dragDivider(grid, 'hmx:1', { x: 7, y: 3 });
    const b = dragDivider(grid, 'hmx:1', { x: 7, y: 999 });
    expect(a).toEqual(b);
    // …and a y handle is the mirror image.
    expect(dragDivider(grid, 'hmy:1', { x: -50, y: 12 })).toEqual({
      xDividers: [0, 4, 10],
      yDividers: [0, 12],
    });
  });

  it('REFUSES a drag past a neighbour, so the handle springs back', () => {
    // ⚑⚑ The model's rule, surfaced as a gesture. Re-sorting instead would keep
    // the geometry valid and renumber every cell past the one being dragged:
    // every value still right, every one filed under the wrong column.
    expect(dragDivider(grid, 'hmx:1', { x: 11, y: 0 })).toBeNull();
    expect(dragDivider(grid, 'hmx:1', { x: -1, y: 0 })).toBeNull();
    // The OUTER dividers have no neighbour beyond them and may go anywhere.
    expect(dragDivider(grid, 'hmx:2', { x: 99, y: 0 })!.xDividers).toEqual([0, 4, 99]);
  });

  it('refuses an id that is not a handle, and a drop that is not a number', () => {
    expect(dragDivider(grid, 'x1', { x: 5, y: 5 })).toBeNull();
    expect(dragDivider(grid, 'hmx:9', { x: 5, y: 5 })).toBeNull();
    expect(dragDivider(grid, 'hmx:1', { x: NaN, y: 5 })).toBeNull();
  });
});

describe('which way the figure READS', () => {
  /** Upright: data y grows UP the page, so row 0 (yMin) is the BOTTOM row. */
  const upright = { dataToPixel: (x: number, y: number) => ({ x: 100 + x * 30, y: 300 - y * 10 }) };
  /** Calibrated upside down: data y grows DOWN, so row 0 is already the top. */
  const flipped = { dataToPixel: (x: number, y: number) => ({ x: 100 + x * 30, y: 100 + y * 10 }) };
  /** Mirrored x: the first column sits on the RIGHT. */
  const mirrored = { dataToPixel: (x: number, y: number) => ({ x: 400 - x * 30, y: 300 - y * 10 }) };
  const grid = { xDividers: [0, 4, 10], yDividers: [0, 10, 20] };

  it('says ROWS run against the reading order on an ordinary figure', () => {
    // ⚑⚑ THE AUDIT'S FINDING. A person copying names off a published heatmap
    // reads them top-down; cell row 0 is yMin, at the bottom. Without the flip
    // the first name lands on the last row — every value right, every name
    // filed against the wrong one, and nothing on screen saying so.
    expect(labelOrderReversed(grid, upright)).toEqual({ x: false, y: true });
  });

  it('is MEASURED, not assumed — an upside-down calibration reads the other way', () => {
    // ⚑ The reason this is a function and not the constant `{x:false, y:true}`.
    expect(labelOrderReversed(grid, flipped)).toEqual({ x: false, y: false });
    expect(labelOrderReversed(grid, mirrored)).toEqual({ x: true, y: true });
  });

  it('claims no order at all for a grid that is not a grid', () => {
    expect(labelOrderReversed({ xDividers: [1], yDividers: [0, 5] }, upright)).toEqual({ x: false, y: false });
  });

  it('lines the typed names up with the cells they name', () => {
    const typed = { x: ['left', 'right'], y: ['top', 'bottom'] };
    // Columns are already left-to-right; rows are flipped onto the cells.
    expect(labelsForCells(typed, grid, upright)).toEqual({
      x: ['left', 'right'],
      y: ['bottom', 'top'],
    });
    // …and the same call on the flipped figure leaves the rows alone.
    expect(labelsForCells(typed, grid, flipped).y).toEqual(['top', 'bottom']);
  });
});

describe('adding and removing a boundary', () => {
  const grid = { xDividers: [0, 4, 10], yDividers: [0, 20] };

  it('says which divider a handle is, in the figure’s own units', () => {
    expect(describeDivider(grid, 'hmx:1')).toEqual({ axis: 'x', index: 1, value: 4 });
    expect(describeDivider(grid, 'hmy:1')).toEqual({ axis: 'y', index: 1, value: 20 });
    expect(describeDivider(grid, 'hmx:9')).toBeNull();
    expect(describeDivider(grid, 'x1')).toBeNull();
  });

  it('drops the new boundary in the MIDDLE OF THE WIDEST CELL', () => {
    // ⚑⚑ Where a missing boundary actually is. Detection that found every rule
    // but one leaves that cell twice its neighbours' width, so the widest cell
    // is the evidence — not a parking spot.
    const added = addDivider(grid, 'x');
    expect(added!.grid.xDividers).toEqual([0, 4, 7, 10]);
    expect(added!.grid.yDividers).toBe(grid.yDividers);
  });

  it('hands back the handle it created, so the user can see what moved', () => {
    // The new divider is the SECOND on the axis here, and its handle id has to
    // name that index or a card selecting it would select a different boundary.
    const added = addDivider({ xDividers: [0, 6, 8], yDividers: [0, 20] }, 'x');
    expect(added!.grid.xDividers).toEqual([0, 3, 6, 8]);
    expect(added!.handleId).toBe('hmx:1');
    expect(describeDivider(added!.grid, added!.handleId)).toEqual({ axis: 'x', index: 1, value: 3 });
  });

  it('splits the single starting cell when there is nothing else to split', () => {
    const added = addDivider(grid, 'y');
    expect(added!.grid.yDividers).toEqual([0, 10, 20]);
    expect(added!.handleId).toBe('hmy:1');
  });

  it('refuses on a grid that is not a grid, and on a cell with no room left', () => {
    expect(addDivider({ xDividers: [1], yDividers: [0, 20] }, 'x')).toBeNull();
    // Two dividers a hair apart have no midpoint distinct from either of them.
    expect(addDivider({ xDividers: [1, 1 + 1e-10], yDividers: [0, 20] }, 'x')).toBeNull();
  });

  it('removes the boundary a handle belongs to, merging its two cells', () => {
    expect(removeDividerHandle(grid, 'hmx:1')).toEqual({
      xDividers: [0, 10],
      yDividers: [0, 20],
    });
  });

  it('REFUSES to remove the last boundary of an axis — one cell is still a grid', () => {
    expect(removeDividerHandle(grid, 'hmy:0')).toBeNull();
    expect(removeDividerHandle(grid, 'hmy:1')).toBeNull();
    expect(removeDividerHandle(grid, 'hmz:0')).toBeNull();
    expect(removeDividerHandle(grid, 'hmx:9')).toBeNull();
  });

  it('removes a ROW boundary too, not only a column one', () => {
    // ⚑ Found by mutation: every removal test used the x axis, because the
    // fixture's y axis had only its outer two dividers and every y case refused
    // before reaching the branch. A transposition there — returning the x list
    // for a y handle — would have survived silently.
    const twoWay = { xDividers: [0, 4, 10], yDividers: [0, 5, 20] };
    expect(removeDividerHandle(twoWay, 'hmy:1')).toEqual({
      xDividers: [0, 4, 10],
      yDividers: [0, 20],
    });
  });

  it('lets an OUTER boundary go once there is an interior one to take its place', () => {
    // ⚑ Nothing marks the outer dividers as special: removing hmx:0 leaves the
    // cell that started at 4 as the grid's new left edge, which is exactly what
    // a user cropping a stray column off the figure means to do.
    expect(removeDividerHandle(grid, 'hmx:0')!.xDividers).toEqual([4, 10]);
  });
});
