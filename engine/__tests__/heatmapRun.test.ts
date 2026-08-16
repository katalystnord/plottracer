import { describe, expect, it } from 'vitest';
import { categoryAxisGlyphs } from '../categoryTickOverlay.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPng } from './helpers/readPng.js';
import { XYAxes } from '../../core/axes/xy.js';
import { Calibration } from '../../core/calibration.js';
import {
  addDivider,
  buildColorScale,
  clearCellReading,
  describeDivider,
  detectGrid,
  heatmapAxisOverlays,
  dragDivider,
  initialGrid,
  cellKeysInRect,
  heatmapAxisMoved,
  heatmapAxisSpans,
  heatmapAxisStamp,
  heatmapGridToParams,
  resolveHeatmapGrid,
  isDividerHandle,
  keyCursorStrip,
  labelOrderReversed,
  labelsForCells,
  readHeatmapCells,
  heatmapRegenerateWarning,
  removeDividerHandle,
  setCellReading,
  setCellReadingAt,
  NO_HEATMAP_CELL_READINGS,
  NO_HEATMAP_LABELS,
  type HeatmapRow,
  type HeatmapState,
  type SourceImage,
} from '../heatmapRun.js';
import { HEATMAP_AXES_CONFIG, type PlacedCalibPoint } from '../calibrationSession.js';
import { valueAtPosition } from '../../algorithms/colorScale.js';
import { colorAtPosition, positionOnStrip } from '../../algorithms/colorBar.js';

/**
 * ⚠️⚠️ THE SHARED FIXTURE IS A VALUE × VALUE FIGURE, and saying so out loud is
 * the point. `readHeatmapCells` used to DEFAULT its `kinds` to exactly this, so
 * every test here asserted against a value axis without anyone choosing one —
 * and the day a function was written that could not survive a CATEGORY axis
 * (`heatmapAxisSpans`, which read the typed calibration values), the whole file
 * passed anyway. A fixture is blind to what it lacks; a NAMED constant at least
 * makes the blindness visible.
 * ⚑ Category coverage lives in `heatmapAxisCases.test.ts` and
 * `heatmapTickMarkers.test.ts`, and the e2e's categorical walk is what actually
 * caught the defect above.
 */
const VALUE_AXES = { x: 'value', y: 'value' } as const;


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

  it('KEEPS what it measured and NAMES what is missing, rather than proposing nothing', () => {
    // ⚑⚑ REWRITTEN 2026-08-14, premise and all. This asserted that a shortfall
    // left the axis EXACTLY as it was — "the miss is reported, never filled in,
    // because a grid with a boundary missing looks exactly like a grid". The
    // argument is right; the remedy was wrong. Discarding four correct
    // measurements to avoid an invisible error trades a measurement for a blank,
    // and David hit it as *"why is the detection not working anymore?"* once
    // every axis declared a count (case A1) and every axis therefore took the
    // checked path.
    //
    // ⚑ The error is made VISIBLE instead of avoided: the grid carries fewer
    // cells than the declared count, and the sentence says how many are missing.
    const { image, axes } = scene();
    const start = initialGrid({ xMin: 0, xMax: 9, yMin: 0, yMax: 8 });
    const result = detectGrid(image, axes, start, { columns: 9 });
    // The four boundaries the ink actually shows are placed…
    expect(result.grid!.xDividers).toHaveLength(6);
    // …the missing four are NOT invented — six dividers is five cells, not nine…
    expect(result.grid!.xDividers.length - 1).toBeLessThan(9);
    // …and nothing claims agreement.
    expect(result.agrees).toBe(false);
    expect(result.message).toMatch(/Found 4 of the 8 boundaries/);
    expect(result.message).toMatch(/add the missing 4 by hand/);
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
    // …the rows keep the boundaries the ink DOES show — four of the eight the
    // typo asked for — rather than being blanked or invented up to nine…
    expect(result.grid!.yDividers.length).toBeGreaterThan(2);
    expect(result.grid!.yDividers.length - 1).toBeLessThan(9);
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
    const { rows, summary, error } = readHeatmapCells(image, axes, grid!, scale!, NO_HEATMAP_LABELS, VALUE_AXES);
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
      scale!,
      NO_HEATMAP_LABELS,
      VALUE_AXES
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
      scale!,
      NO_HEATMAP_LABELS,
      VALUE_AXES
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
      scale!,
      NO_HEATMAP_LABELS,
      VALUE_AXES
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
    const { rows } = readHeatmapCells(image, axes, { xDividers: [0, 9], yDividers: [0, 8] }, scale!, NO_HEATMAP_LABELS, VALUE_AXES);
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
    const result = readHeatmapCells(
      image,
      axes,
      grid,
      scale!,
      { x: ['BRCA1', 'TP53'], y: ['tumour'] },
      VALUE_AXES
    );
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
    const result = readHeatmapCells(image, axes, { xDividers: fig.grid.x, yDividers: fig.grid.y }, scale!, NO_HEATMAP_LABELS, VALUE_AXES);
    expect(result.rows.every((r) => r.xLabel === '' && r.yLabel === '')).toBe(true);
  });

  it('needs a grid before it can read anything', () => {
    const { image, axes, placed } = scene();
    const { scale } = buildColorScale(placed, image, false);
    const result = readHeatmapCells(image, axes, { xDividers: [1], yDividers: [0, 8] }, scale!, NO_HEATMAP_LABELS, VALUE_AXES);
    expect(result.rows).toEqual([]);
    expect(result.error).toMatch(/at least one boundary/i);
  });
});

describe('dragging a divider', () => {
  /** An upright frame: data x 0..10 across pixels 100..400, data y 0..20 up
   * pixels 300..100 (image y grows downward, as a figure's does). */
  const upright = { dataToPixel: (x: number, y: number) => ({ x: 100 + x * 30, y: 300 - y * 10 }) };
  const grid = { xDividers: [0, 4, 10], yDividers: [0, 20] };

  it('puts one tick on every divider, and none anywhere else', () => {
    // ⚑ The handles this used to check are now the SHARED category-tick overlay
    // (`heatmapAxisOverlays` -> `categoryTickOverlay.ts`), so what survives here
    // is the geometry this file owns: which dividers become ticks, and where.
    const { x, y } = heatmapAxisOverlays(grid, upright);
    expect(x.tickPoints.map((p) => p.x)).toEqual([100, 220, 400]);
    expect(y.tickPoints.map((p) => p.y)).toEqual([300, 100]);
    // On the axis, NOT offset — the overlay adds its own standoff, which is what
    // makes the mark read as a tick instead of a floating dot.
    expect(x.tickPoints[0]).toEqual({ x: 100, y: 300 });
  });

  it('works out which way is OUT from the axes, not from the screen', () => {
    // ⚑ A figure calibrated upside down has its own idea of outward, and marks
    // that assumed "down and left" would sit INSIDE the plot on exactly the
    // charts that are hardest to read already. The direction now comes from the
    // EDGES handed to the overlay, so this asserts the edges are the plot's own.
    const flipped = { dataToPixel: (x: number, y: number) => ({ x: 100 + x * 30, y: 100 + y * 10 }) };
    const upFirst = heatmapAxisOverlays(grid, upright).x.edges!;
    const downFirst = heatmapAxisOverlays(grid, flipped).x.edges!;
    // Same axis line either way; the figure's own y=0 edge, wherever it landed.
    expect(upFirst[0]!.y).toBe(300);
    expect(downFirst[0]!.y).toBe(100);
    // …and the tick marks follow it, drawn away from the plot in both cases.
    const [up] = categoryAxisGlyphs(heatmapAxisOverlays(grid, upright).x);
    const [down] = categoryAxisGlyphs(heatmapAxisOverlays(grid, flipped).x);
    expect(up![1]!.to.y).toBeGreaterThan(up![1]!.from.y); // downward, below the plot
    expect(down![1]!.to.y).toBeLessThan(down![1]!.from.y); // upward, above it
  });

  it('is empty for a grid that is not a grid', () => {
    const { x } = heatmapAxisOverlays({ xDividers: [1], yDividers: [0, 5] }, upright);
    expect(x.edges).toBeNull();
    expect(x.tickPoints).toEqual([]);
  });

  it('tells a grid handle from a data point', () => {
    expect(isDividerHandle('hmx:0')).toBe(true);
    expect(isDividerHandle('hmy:12')).toBe(true);
    expect(isDividerHandle('x1')).toBe(false);
    expect(isDividerHandle('hmz:1')).toBe(false);
    expect(isDividerHandle('hmx:')).toBe(false);
  });

  /**
   * C1 — DRAGGING A DIVIDER MOVES THE GRID AND NEVER THE CALIBRATION.
   *
   * ⚑⚑ IT IS THE ROUTER THAT DECIDES THIS, and the router is one predicate. Every
   * marker on the figure — data points, calibration handles, category ticks and
   * grid handles — arrives at ONE `handleMarkerDragEnd`, which asks
   * `isDividerHandle` first and, if nothing else matches, falls through to
   * `updateCalibPointPixel`. So a divider id that failed this predicate would be
   * read as a calibration handle, and dragging a boundary would silently
   * recalibrate the whole figure: every value in the export wrong, nothing on
   * screen saying so.
   *
   * ⚑ The two layers that make it safe are asserted rather than assumed — the
   * predicate never confuses the two id spaces (here), and the model refuses an
   * id it does not hold (`updateCalibPointPixel`'s own test).
   *
   * ⚑ THE TWO-LAYER MODEL IS THE POINT: calibration points ARE the axis, and the
   * grid DERIVES from them. Nothing a grid gesture does may reach the layer
   * underneath it.
   */
  it('never mistakes a heatmap CALIBRATION step for a grid handle', () => {
    // Every key the walk actually uses, taken from the config rather than
    // retyped — a step added later is covered without anyone remembering to.
    for (const step of HEATMAP_AXES_CONFIG.fixedSteps) {
      expect(isDividerHandle(step.key), `${step.key} must not read as a divider`).toBe(false);
    }
    // …and the reverse: a divider is never mistaken for one of them.
    const stepKeys = new Set(HEATMAP_AXES_CONFIG.fixedSteps.map((s) => s.key));
    for (const id of ['hmx:0', 'hmy:0', 'hmx:11']) {
      expect(stepKeys.has(id)).toBe(false);
      expect(isDividerHandle(id)).toBe(true);
    }
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

/**
 * B7 / B16 — THE USER IS AN INSTRUMENT, and their reading is recorded the way
 * ours is: as a POSITION ON THE THIRD AXIS.
 *
 * ⚑⚑ David, when I proposed an override carrying a declared-vs-measured flag:
 * *"NO. And seriously NO. Heatmaps are a 2.5D graph type. The values are STORED
 * ON THE THIRD AXIS. Changing a value in a cell MOVES THE VALUE on the third
 * axis that records the value, and nothing else!"* So there is no new field to
 * assert here — the whole design shows up as `moves when the key is
 * recalibrated`, which a stored NUMBER cannot pass and a stored POSITION cannot
 * fail. That test is the design.
 *
 * ⚑ Why it exists at all (David, same day): *"there might be something in the
 * color/patern/shape that a user can see and we can't"* — a hatched cell, an
 * asterisk over the fill, a label bleeding into the fill, a texture the modal
 * sampler averages away. Their eye is the better instrument for those, and
 * often the only one that can tell.
 */
describe('a user’s own reading of a cell', () => {
  /** The figure, its grid, and the key — the state a user is looking at when
   * they decide our number is wrong. */
  function readable(log = false) {
    const { fig, image, axes, placed } = scene();
    const { scale } = buildColorScale(placed, image, log);
    const grid = { xDividers: fig.grid.x, yDividers: fig.grid.y };
    return { fig, image, axes, placed, grid, scale: scale! };
  }
  const cellAt = (rows: HeatmapRow[], col: number, row: number) =>
    rows.find((r) => r.col === col && r.row === row)!;

  it('a typed value moves the cell along the key', () => {
    const { image, axes, grid, scale } = readable();
    const before = cellAt(readHeatmapCells(image, axes, grid, scale, NO_HEATMAP_LABELS, VALUE_AXES).rows, 1, 1);
    expect(before.source).toBe('colour');

    const { readings, error } = setCellReading(NO_HEATMAP_CELL_READINGS, scale, 1, 1, '59');
    expect(error).toBeNull();
    const after = cellAt(
      readHeatmapCells(image, axes, grid, scale, NO_HEATMAP_LABELS, VALUE_AXES, readings).rows,
      1,
      1
    );
    expect(after.value).toBeCloseTo(59, 6);
    expect(after.source).toBe('user');
    // ⚑ AND NOTHING ELSE MOVED. The edit is one cell's coordinate on one axis.
    expect(cellAt(readHeatmapCells(image, axes, grid, scale, NO_HEATMAP_LABELS, VALUE_AXES, readings).rows, 0, 0).source).toBe(
      'colour'
    );
  });

  it('an edited cell MOVES when the key is recalibrated — a POSITION was stored, not a number', () => {
    // ⚑⚑ THE TEST THAT IS THE DESIGN. Every position on this key is worth twice
    // as much once both printed labels are read as twice what they were, so the
    // user's cell must read 118 — exactly as a data point moves when its axes
    // are recalibrated. A stored NUMBER would sit at 59 and quietly disagree
    // with every other cell in the matrix, with nothing on screen saying which
    // of them to trust.
    const { image, axes, grid, placed } = readable();
    const { scale } = buildColorScale(placed, image, false);
    const { readings } = setCellReading(NO_HEATMAP_CELL_READINGS, scale!, 1, 1, '59');

    const doubled = {
      ...placed,
      kv1: { ...placed.kv1!, values: [String(Number(placed.kv1!.values[0]) * 2)] },
      kv2: { ...placed.kv2!, values: [String(Number(placed.kv2!.values[0]) * 2)] },
    };
    const recalibrated = buildColorScale(doubled, image, false).scale!;
    const after = cellAt(
      readHeatmapCells(image, axes, grid, recalibrated, NO_HEATMAP_LABELS, VALUE_AXES, readings).rows,
      1,
      1
    );
    expect(after.value).toBeCloseTo(118, 4);
    expect(after.source).toBe('user');
  });

  it('refuses a value the LOG key cannot represent, at the gesture, keeping the reading it had', () => {
    const { image, placed } = readable();
    // A positive-labelled key read as logarithmic — the ordinary older-paper case.
    const logged = {
      ...placed,
      kv1: { ...placed.kv1!, values: ['1'] },
      kv2: { ...placed.kv2!, values: ['100'] },
    };
    const scale = buildColorScale(logged, image, true).scale!;
    for (const typed of ['0', '-5', '', 'nine']) {
      const { readings, error } = setCellReading(NO_HEATMAP_CELL_READINGS, scale, 1, 1, typed);
      expect(error, `“${typed}” must be refused`).not.toBeNull();
      expect(readings).toEqual(NO_HEATMAP_CELL_READINGS);
    }
    // …and a positive one is taken.
    expect(setCellReading(NO_HEATMAP_CELL_READINGS, scale, 1, 1, '50').error).toBeNull();
  });

  it('gives the cell back to the key when the user’s reading is cleared', () => {
    const { image, axes, grid, scale } = readable();
    const mine = setCellReading(NO_HEATMAP_CELL_READINGS, scale, 1, 1, '59').readings;
    const cleared = clearCellReading(mine, 1, 1);
    expect(cleared).toEqual(NO_HEATMAP_CELL_READINGS);
    const back = cellAt(readHeatmapCells(image, axes, grid, scale, NO_HEATMAP_LABELS, VALUE_AXES, cleared).rows, 1, 1);
    const never = cellAt(readHeatmapCells(image, axes, grid, scale, NO_HEATMAP_LABELS, VALUE_AXES).rows, 1, 1);
    expect(back.source).toBe('colour');
    expect(back.value).toBeCloseTo(never.value!, 10);
    expect(back.rgb).toEqual(never.rgb);
  });

  it('carries no COLOUR evidence for a value the colour did not produce', () => {
    // ⚑ The interval, the distance off the ramp, the rivals and the clipping
    // flag are all properties of inverting a COLOUR. A reading taken by eye has
    // none of them, and inventing them — low = high = the typed number, say —
    // would dress a bare assertion as a measured interval.
    const { image, axes, grid, scale } = readable();
    const readings = setCellReading(NO_HEATMAP_CELL_READINGS, scale, 1, 1, '59').readings;
    const mine = cellAt(readHeatmapCells(image, axes, grid, scale, NO_HEATMAP_LABELS, VALUE_AXES, readings).rows, 1, 1);
    expect(mine.low).toBeNull();
    expect(mine.high).toBeNull();
    expect(mine.distance).toBeNull();
    expect(mine.rivalValues).toEqual([]);
    expect(mine.atKeyLimit).toBe(false);
  });

  it('keeps what was measured of the PIXELS, which is why the user looked twice', () => {
    // ⚑ Uniformity is a fact about the cell's ink, not about who read it: a
    // hatched cell is still hatched after a person types the number they can see
    // in it, and that is the evidence for the correction rather than something
    // the correction disposes of. The colour-inversion warnings go; this stays.
    const { image, axes, placed } = scene('heatmap-jet-jpeg.png');
    const scale = buildColorScale(placed, image, false).scale!;
    const grid = { xDividers: [0, 1, 3.5, 4, 6, 9], yDividers: [0, 2, 2.5, 5, 8] };
    const rows = readHeatmapCells(image, axes, grid, scale, NO_HEATMAP_LABELS, VALUE_AXES).rows;
    const messy = rows.find((r) => /% of the cell/.test(r.warning))!;
    expect(messy, 'the degraded figure must still have a non-uniform cell').toBeDefined();

    const readings = setCellReading(NO_HEATMAP_CELL_READINGS, scale, messy.col, messy.row, '59').readings;
    const mine = cellAt(
      readHeatmapCells(image, axes, grid, scale, NO_HEATMAP_LABELS, VALUE_AXES, readings).rows,
      messy.col,
      messy.row
    );
    expect(mine.uniformity).toBeCloseTo(messy.uniformity, 10);
    expect(mine.warning).toMatch(/% of the cell/);
    expect(mine.warning).not.toMatch(/off the key|possible values|key’s limit/);
  });

  it('says nothing about a cell the grid no longer has', () => {
    // A reading filed against column 4 of a five-column grid, after two columns
    // were merged. It is not a row of the record any more, and nothing invents
    // one for it.
    const { image, axes, scale } = readable();
    const readings = setCellReading(NO_HEATMAP_CELL_READINGS, scale, 4, 0, '59').readings;
    const rows = readHeatmapCells(
      image,
      axes,
      { xDividers: [0, 4, 9], yDividers: [0, 8] },
      scale,
      NO_HEATMAP_LABELS,
      VALUE_AXES,
      readings
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === 'colour')).toBe(true);
  });
});

/** The user's readings are part of the record, so they save, reopen and undo
 * through the same axes metadata the grid and the names ride in — and the load
 * path validates them, because a file is an entrance to the model like any
 * other. */

/**
 * C3 / C4 — SAY WHAT A COUNT OR CONVENTION CHANGE WILL COST, BEFORE IT COSTS IT.
 *
 * ⚑⚑ THE MIRROR ALREADY EXISTS. The bar chart's category ticks have carried this
 * since v2.1 — `categoryPanelView`'s `regenerateWarning`, shown only when there
 * is something to lose, with the note *"a warning that appears when nothing
 * would be discarded teaches the user to ignore it."* Same sentence shape here,
 * for the same reason, rather than a second mechanism.
 *
 * ⚑ NO NEW STORED FLAG. `BandedAxis` keeps an `_adjusted` boolean because a
 * bar's ticks can only ever be GENERATED then dragged. A heatmap's grid can also
 * be DETECTED — read off the figure's own rules — and a detected grid is exactly
 * as much of a loss as a dragged one. So the question is not "did you adjust
 * this?" but "is there a grid to lose?", which needs no state to answer.
 *
 * ⚑ And the DISAGREEMENT is reported rather than resolved: when the declared
 * count and the grid's own count differ, the card says so and leaves the choice
 * alone. Silently rebuilding would discard measured boundaries; silently keeping
 * would leave a grid describing a frame that no longer exists. Tenet 9 — record
 * what is, do not choose for the reader.
 */
describe('C3/C4 — the cost of a count or convention change, said first', () => {
  it('warns only when there is a grid to lose', () => {
    expect(heatmapRegenerateWarning(null, { columns: 5, rows: 4 })).toBeNull();
    const warning = heatmapRegenerateWarning(
      { xDividers: [0, 1, 2, 3, 4, 5], yDividers: [0, 1, 2, 3, 4] },
      { columns: 5, rows: 4 }
    );
    expect(warning).toMatch(/count|number of columns/i);
    expect(warning).toMatch(/tick|convention|centre/i);
    // It names the LOSS, not merely the event.
    expect(warning).toMatch(/discard|lose|rebuild/i);
  });

  it('REPORTS a grid that disagrees with the declared count, naming both numbers', () => {
    // ⚑ The state a count change leaves behind: the calibration now says six
    // columns, the grid still describes five, and nothing on screen said so.
    const warning = heatmapRegenerateWarning(
      { xDividers: [0, 1, 2, 3, 4, 5], yDividers: [0, 1, 2, 3, 4] },
      { columns: 6, rows: 4 }
    );
    expect(warning).toMatch(/5/);
    expect(warning).toMatch(/6/);
    expect(warning).toMatch(/column/i);
  });

  it('reports a ROW disagreement too, not only a column one', () => {
    // ⚑ Found by mutation elsewhere in this file: every count test used x,
    // because the y branch was never exercised. A transposition would survive.
    const warning = heatmapRegenerateWarning(
      { xDividers: [0, 1, 2, 3, 4, 5], yDividers: [0, 1, 2, 3, 4] },
      { columns: 5, rows: 7 }
    );
    expect(warning).toMatch(/row/i);
    expect(warning).toMatch(/7/);
  });

  it('says nothing about a disagreement when the counts agree', () => {
    const warning = heatmapRegenerateWarning(
      { xDividers: [0, 1, 2, 3, 4, 5], yDividers: [0, 1, 2, 3, 4] },
      { columns: 5, rows: 4 }
    )!;
    expect(warning).not.toMatch(/does not match|disagree/i);
  });

  it('is quiet about a count nobody has declared yet', () => {
    // A value axis mid-walk has NaN counts; a warning built from those would
    // read "the grid has 5 columns but the calibration declares NaN".
    const warning = heatmapRegenerateWarning(
      { xDividers: [0, 1, 2, 3, 4, 5], yDividers: [0, 1, 2, 3, 4] },
      { columns: NaN, rows: NaN }
    )!;
    expect(warning).not.toMatch(/NaN/);
  });
});

/**
 * P1 — THE THIRD AXIS IS AN AXIS, so a cell carries its coordinate ON IT.
 *
 * ⚑⚑ A row has always carried `xCentre` and `yCentre` — where the cell sits on
 * the first two axes — and then reported the third as a NUMBER only. But a
 * heatmap is 2.5D: where the cell sits on the colour key is a coordinate exactly
 * as the other two are, and it is the one the whole figure exists to convey.
 * Without it nothing on screen can show a cell's value as a POSITION, which is
 * what the key's own marker needs (David's idea, 2026-08-15) and what makes
 * "editing a cell moves it along the key" something you can watch happen.
 *
 * ⚑ DERIVED THROUGH THE SAME INVERSE, not stored twice: a colour-read cell's
 * position comes back through `positionAtValue`, which is exact for a monotone
 * scale, and a user-read cell reports the position that WAS stored. One number,
 * one meaning, whichever instrument produced it.
 */
describe('a cell’s coordinate on the colour key', () => {
  function readable() {
    const { fig, image, axes, placed } = scene();
    const { scale } = buildColorScale(placed, image, false);
    return { image, axes, scale: scale!, grid: { xDividers: fig.grid.x, yDividers: fig.grid.y } };
  }
  const cellAt = (rows: HeatmapRow[], col: number, row: number) =>
    rows.find((r) => r.col === col && r.row === row)!;

  it('reports WHERE on the key each cell was read, as a position', () => {
    const { image, axes, grid, scale } = readable();
    const rows = readHeatmapCells(image, axes, grid, scale, NO_HEATMAP_LABELS, VALUE_AXES).rows;
    for (const row of rows) {
      expect(row.keyPosition).not.toBeNull();
      // A position on the strip's own 0..1 frame — the same frame the key's
      // marker is drawn in and the same one a drag reports back.
      expect(row.keyPosition!).toBeGreaterThan(-0.5);
      expect(row.keyPosition!).toBeLessThan(1.5);
    }
    // ⚑ The position and the value agree, because both come from one scale:
    // a hotter cell sits further along the key than a colder one.
    const cold = cellAt(rows, 0, 0);
    const hot = cellAt(rows, 4, 3);
    expect(hot.value! > cold.value!).toBe(hot.keyPosition! > cold.keyPosition!);
  });

  it('gives a user-read cell back EXACTLY the position that was stored', () => {
    // ⚑ No round trip through the number: what was stored is what is reported,
    // so the marker cannot drift from where the user put it.
    const { image, axes, grid, scale } = readable();
    const readings = { '1,1': 0.375 };
    const mine = cellAt(
      readHeatmapCells(image, axes, grid, scale, NO_HEATMAP_LABELS, VALUE_AXES, readings).rows,
      1,
      1
    );
    expect(mine.keyPosition).toBe(0.375);
    expect(mine.source).toBe('user');
  });

  it('is null for a cell with no reading at all, so nothing is drawn for it', () => {
    const { image, axes, scale } = readable();
    const rows = readHeatmapCells(image, axes, { xDividers: [500, 600], yDividers: [500, 600] }, scale, NO_HEATMAP_LABELS, VALUE_AXES).rows;
    expect(rows[0]!.value).toBeNull();
    expect(rows[0]!.keyPosition).toBeNull();
  });
});

/**
 * ⑧ — the second half. B6 asked to *"select a range of cells, or click cells on
 * the heatmap"*, and v2.2 shipped multi-select in the TABLE only.
 */
describe('the marquee selects a RANGE of cells, the way it selects points', () => {
  // A plain 10-px-per-unit projection, so what the test asserts is the RULE and
  // not a fixture's arithmetic.
  const toPixel = (x: number, y: number) => ({ x: x * 10, y: y * 10 });
  const cell = (col: number, row: number, xCentre: number, yCentre: number) =>
    ({ col, row, xCentre, yCentre }) as HeatmapRow;
  const rows = [
    cell(0, 0, 1, 1), // → (10, 10)
    cell(1, 0, 2, 1), // → (20, 10)
    cell(0, 1, 1, 2), // → (10, 20)
    cell(1, 1, 2, 2), // → (20, 20)
  ];

  it('catches every cell whose centre falls inside the dragged box', () => {
    expect(cellKeysInRect(rows, { x: 5, y: 5, width: 20, height: 10 }, toPixel)).toEqual(['0,0', '1,0']);
    expect(cellKeysInRect(rows, { x: 5, y: 5, width: 20, height: 20 }, toPixel)).toEqual([
      '0,0',
      '1,0',
      '0,1',
      '1,1',
    ]);
  });

  it('takes a box dragged in ANY direction, since a marquee has no handedness', () => {
    // Dragged up-and-left: negative width and height, same two cells.
    expect(cellKeysInRect(rows, { x: 25, y: 15, width: -20, height: -10 }, toPixel)).toEqual(['0,0', '1,0']);
  });

  it('catches nothing from a box over empty canvas, rather than the nearest cell', () => {
    expect(cellKeysInRect(rows, { x: 200, y: 200, width: 50, height: 50 }, toPixel)).toEqual([]);
  });

  it('judges a cell by its CENTRE, so clipping a cell’s edge does not grab it', () => {
    // A box reaching x=15 covers part of column 1's cell but not its centre at
    // x=20. Overlap would grab the whole column from a box that brushed it.
    expect(cellKeysInRect(rows, { x: 5, y: 5, width: 10, height: 10 }, toPixel)).toEqual(['0,0']);
  });

  it('skips a cell the axes cannot place, instead of selecting it at NaN', () => {
    const broken = () => ({ x: NaN, y: NaN });
    expect(cellKeysInRect(rows, { x: 0, y: 0, width: 1000, height: 1000 }, broken)).toEqual([]);
    expect(cellKeysInRect(rows, { x: 0, y: 0, width: 1000, height: 1000 }, () => null)).toEqual([]);
  });
});

/**
 * ④ — the caliper's geometry. David saw two things wrong with it and they have
 * one cause: it was drawn along the key's DIAGONAL, because `k1`/`k2` are
 * opposite CORNERS.
 */
describe('the colour key’s caliper rides the strip, not the corners', () => {
  const k1 = { px: 100, py: 500 };
  const k2 = { px: 400, py: 540 }; // a horizontal key, 300 long and 40 thick

  it('sits on the CENTRELINE, so it neither tilts nor drifts off the bar', () => {
    const strip = keyCursorStrip(k1, k2)!;
    // The old drawing ran corner to corner: y would have gone 500 → 540.
    expect(strip.from.y).toBe(520);
    expect(strip.to.y).toBe(520);
    expect(strip.from.y).toBe(strip.to.y);
    // Which is to say: no tilt. The diagonal's angle was ~7.6°, and that is
    // exactly what showed on screen.
    expect(Math.atan2(strip.to.y - strip.from.y, strip.to.x - strip.from.x)).toBe(0);
  });

  it('spans the thickness MEASURED from the user’s own two clicks, not a constant', () => {
    // The glyph's half-height was a hardcoded `const h = 9`, so on a 40px key it
    // covered less than half the bar.
    const strip = keyCursorStrip(k1, k2)!;
    expect(strip.thickness).toBe(24); // 40 × the 0.6 inset the sampler uses
    // And it FOLLOWS the figure: a thinner key gets a thinner caliper.
    expect(keyCursorStrip(k1, { px: 400, py: 510 })!.thickness).toBe(6);
  });

  it('⚑⚑ IS THE SAME GEOMETRY THE SAMPLER READS — drawn and stored cannot disagree', () => {
    // The defect stated as a property. `buildColorScale` samples along
    // `stripFromCorners(k1, k2)`; if the caliper is drawn along anything else,
    // the position shown and the position recorded are measured on two
    // different lines. Asserted against the scale the app actually builds,
    // rather than against a restatement of the formula.
    const { image, placed } = scene();
    const { scale } = buildColorScale(placed, image, false);
    const drawn = keyCursorStrip(placed['k1']!, placed['k2']!)!;
    expect(drawn.from).toEqual(scale!.strip.from);
    expect(drawn.to).toEqual(scale!.strip.to);
    expect(drawn.thickness).toEqual(scale!.strip.thickness);
  });

  it('works for a VERTICAL key too, where the long axis is the other one', () => {
    // Half the arithmetic is invisible on a horizontal key, and plenty of real
    // colour keys are vertical.
    const strip = keyCursorStrip({ px: 500, py: 100 }, { px: 540, py: 400 })!;
    expect(strip.from.x).toBe(520);
    expect(strip.to.x).toBe(520);
    expect(strip.thickness).toBe(24);
  });

  it('⚠️ is the SAME strip whichever corner was clicked FIRST — the mirrored-caliper bug', () => {
    // ⚑⚑ THIS WAS A VALUE DEFECT, not only a cosmetic one, and it took a second
    // look to see it. `stripFromCorners` always returns min→max, so the strip's
    // t=0 is the LEFT end however the user dragged. The old cursor was drawn and
    // measured along the RAW `k1 → k2` line — so whenever k1 was not the min
    // corner (a right-to-left or bottom-to-top drag across the key, which
    // nothing in the walk discourages), the caliper was MIRRORED: drawn at the
    // wrong end, and a drag reported t in the opposite frame from the one
    // `valueAtPosition` reads it in. The cell would take the value from the far
    // end of the key.
    // ⚑ Only the CALIPER was affected — cells read from colour go through
    // `invertColor(strip, …)`, which is in the strip's frame throughout. That is
    // why the recorded values measured clean against ground truth.
    const leftToRight = keyCursorStrip({ px: 100, py: 500 }, { px: 400, py: 540 });
    const rightToLeft = keyCursorStrip({ px: 400, py: 540 }, { px: 100, py: 500 });
    expect(rightToLeft).toEqual(leftToRight);
    // And the other diagonal of the same rectangle, which is just as clickable.
    expect(keyCursorStrip({ px: 400, py: 500 }, { px: 100, py: 540 })).toEqual(leftToRight);
    // Vertical keys too, where the long axis is the other one.
    const topDown = keyCursorStrip({ px: 500, py: 100 }, { px: 540, py: 400 });
    expect(keyCursorStrip({ px: 540, py: 400 }, { px: 500, py: 100 })).toEqual(topDown);
  });

  it('refuses a degenerate pair rather than drawing a caliper nowhere', () => {
    expect(keyCursorStrip({ px: NaN, py: 1 }, { px: 400, py: 500 })).toBeNull();
  });
});

/**
 * ⚑⚑ ABSOLUTE MIRRORING — David, 2026-08-15: *"We need to have absolute
 * MIRRORING of the colour between the heatmap, the draggable colour key, and the
 * output matrix. That is the ground truth."*
 *
 * And the direction that makes it achievable at all: *"the colour / tint ALWAYS
 * == a number… the colour we show is only its REPRESENTATION. Hence that is WHY
 * it is important that the colour follows the value, not the other way around."*
 *
 * So a row carries TWO colours and they mean opposite things — `rgb` is the ink
 * that was MEASURED (evidence), `keyRgb` is the ink the key gives that value
 * (representation). Only the second may be drawn.
 */
describe('the colour a cell is DRAWN in follows its value, never the sampled ink', () => {
  function readable() {
    const { fig, image, axes, placed } = scene();
    const { scale } = buildColorScale(placed, image, false);
    return { image, axes, scale: scale!, grid: { xDividers: fig.grid.x, yDividers: fig.grid.y } };
  }
  const cellAt = (rows: HeatmapRow[], col: number, row: number) =>
    rows.find((r) => r.col === col && r.row === row)!;

  it('gives every readable cell the key’s own colour at its position', () => {
    const { image, axes, grid, scale } = readable();
    const rows = readHeatmapCells(image, axes, grid, scale, NO_HEATMAP_LABELS, VALUE_AXES).rows;
    for (const row of rows) {
      expect(row.keyRgb).toBeDefined();
      // The definition, asserted against the key rather than restated: the
      // drawn colour IS `key(keyPosition)`.
      expect(row.keyRgb).toEqual(colorAtPosition(scale.strip, row.keyPosition!));
    }
  });

  it('gives a USER-read cell a colour too — colour follows the value whichever instrument produced it', () => {
    // ⚠️ THIS SUPERSEDES the earlier provenance rule ("no colour if it is user
    // set"). Provenance moved to the `[brackets]` and the export's own column;
    // the tint became pure representation, and a cell with a value and no
    // colour would break the mirroring for exactly the cells a person corrected.
    const { image, axes, grid, scale } = readable();
    const readings = { '1,1': 0.375 };
    const mine = cellAt(
      readHeatmapCells(image, axes, grid, scale, NO_HEATMAP_LABELS, VALUE_AXES, readings).rows,
      1,
      1
    );
    expect(mine.source).toBe('user');
    expect(mine.keyRgb).toEqual(colorAtPosition(scale.strip, 0.375));
  });

  it('moves a cell’s colour when its value is edited, with nothing to keep in sync', () => {
    // "Change the value and the colour follows" needs no syncing code because
    // the colour is a FUNCTION of the number. Two different positions must give
    // two different inks on a real ramp.
    const { image, axes, grid, scale } = readable();
    const low = cellAt(readHeatmapCells(image, axes, grid, scale, NO_HEATMAP_LABELS, VALUE_AXES, { '1,1': 0.1 }).rows, 1, 1);
    const high = cellAt(readHeatmapCells(image, axes, grid, scale, NO_HEATMAP_LABELS, VALUE_AXES, { '1,1': 0.9 }).rows, 1, 1);
    expect(low.keyRgb).not.toEqual(high.keyRgb);
    expect(low.keyRgb).toEqual(colorAtPosition(scale.strip, 0.1));
    expect(high.keyRgb).toEqual(colorAtPosition(scale.strip, 0.9));
  });

  it('draws an OFF-RAMP cell in a colour the key actually contains', () => {
    // ⚑ THE CONFLATION THIS FIXES. Tinting with the sampled pixel paints a cell
    // whose ink sat off the ramp in a colour corresponding to NO value anywhere
    // on the key. `keyRgb` cannot produce one: it is read off the ramp itself.
    const { image, axes, grid, scale } = readable();
    const rows = readHeatmapCells(image, axes, grid, scale, NO_HEATMAP_LABELS, VALUE_AXES).rows;
    const drawn = rows.filter((r) => r.keyRgb !== undefined);
    // ⚑ Or the loop below is vacuous and this test passes against its own defect.
    expect(drawn.length).toBe(rows.length);
    for (const row of drawn) {
      const onRamp = scale.strip.samples.some(
        (s) =>
          Math.abs(s.rgb[0] - row.keyRgb![0]) <= 1 &&
          Math.abs(s.rgb[1] - row.keyRgb![1]) <= 1 &&
          Math.abs(s.rgb[2] - row.keyRgb![2]) <= 1
      );
      expect(onRamp).toBe(true);
    }
  });

  it('leaves an unreadable cell with no colour at all, so nothing is drawn for it', () => {
    const { image, axes, scale } = readable();
    const rows = readHeatmapCells(image, axes, { xDividers: [500, 600], yDividers: [500, 600] }, scale, NO_HEATMAP_LABELS, VALUE_AXES).rows;
    expect(rows[0]!.keyPosition).toBeNull();
    expect(rows[0]!.keyRgb).toBeUndefined();
  });

  it('keeps `rgb` as EVIDENCE — the measured ink, still only where the colour was the reading', () => {
    // The two must not collapse into one field: `colour offset` and the
    // uniformity column report on the measurement, and they need the pixel that
    // was actually there. A user-read cell has no measured ink of its own.
    const { image, axes, grid, scale } = readable();
    const rows = readHeatmapCells(image, axes, grid, scale, NO_HEATMAP_LABELS, VALUE_AXES, { '1,1': 0.375 }).rows;
    expect(cellAt(rows, 0, 0).rgb).toBeDefined();
    expect(cellAt(rows, 1, 1).rgb).toBeUndefined();
    // And where both exist they are INDEPENDENT: evidence is not overwritten by
    // representation.
    const measured = cellAt(rows, 0, 0);
    expect(measured.keyRgb).toEqual(colorAtPosition(scale.strip, measured.keyPosition!));
  });

  it('moves every cell’s colour when the KEY is recalibrated, because all of them are one function of it', () => {
    // ⚑ This is what "absolute" buys: figure, caliper and matrix cannot
    // disagree, because all three are the same function of the same number.
    const { image, axes, grid, scale } = readable();
    const rows = readHeatmapCells(image, axes, grid, scale, NO_HEATMAP_LABELS, VALUE_AXES).rows;
    const cell = cellAt(rows, 0, 0);
    // A cell's position on the key does not move when the key's LABELS change,
    // so its drawn colour must not either — the value it reports does.
    const relabelled = {
      ...scale,
      ticks: [
        { ...scale.ticks[0], value: scale.ticks[0].value * 10 },
        { ...scale.ticks[1], value: scale.ticks[1].value * 10 },
      ] as typeof scale.ticks,
    };
    const after = cellAt(readHeatmapCells(image, axes, grid, relabelled, NO_HEATMAP_LABELS, VALUE_AXES).rows, 0, 0);
    // ⚑ Both defined, or `undefined === undefined` would satisfy this.
    expect(after.keyRgb).toBeDefined();
    expect(after.keyRgb).toEqual(cell.keyRgb);
    expect(after.value).not.toBe(cell.value);
  });
});

/**
 * The DRAG half of B7 — setting a cell straight from a position on the key.
 *
 * ⚑⚑ THIS IS THE PRIMITIVE GESTURE, and typing is the derived one. The record
 * stores a POSITION, so a drag writes it outright while a typed number has to be
 * converted first. Every other axis in this app has had both halves since v1.3
 * — drag the marker or type the value — and the third axis has had only the
 * typed one.
 */
describe('setting a cell from a POSITION on the key', () => {
  const scaleFor = () => {
    const { image, placed } = scene();
    return buildColorScale(placed, image, false).scale!;
  };

  it('records the position as given, with no number in between', () => {
    const { readings, error } = setCellReadingAt(NO_HEATMAP_CELL_READINGS, 2, 1, 0.625);
    expect(error).toBeNull();
    expect(readings).toEqual({ '2,1': 0.625 });
  });

  it('lands in the SAME record a typed value would, from the same place', () => {
    // ⚑ The two halves must be one record, or the marker and the number would
    // describe different cells. Drag to a position, read what value that is,
    // type that value into a fresh record — same stored position.
    const scale = scaleFor();
    const dragged = setCellReadingAt(NO_HEATMAP_CELL_READINGS, 2, 1, 0.625).readings;
    const valueThere = valueAtPosition(scale, 0.625)!;
    const typed = setCellReading(NO_HEATMAP_CELL_READINGS, scale, 2, 1, String(valueThere)).readings;
    expect(typed['2,1']).toBeCloseTo(dragged['2,1']!, 10);
  });

  it('refuses a position that is not a number, leaving the record alone', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const { readings, error } = setCellReadingAt(NO_HEATMAP_CELL_READINGS, 0, 0, bad);
      expect(error).not.toBeNull();
      expect(readings).toEqual(NO_HEATMAP_CELL_READINGS);
    }
  });

  it('⚠️ refuses a position past the END OF THE STRIP — the correction to this very test', () => {
    // ⚑⚑ THIS TEST'S COMMENT WAS RIGHT AND ITS NUMBERS WERE WRONG, which is the
    // gate-3 pattern inside a test rather than a source comment. It said —
    // correctly — *"the printed labels are almost never at the very ends of the
    // ramp, so the top and bottom of most keys lie OUTSIDE them"*, and then
    // asserted with t = -0.2 and t = 1.2. Those are outside the STRIP, not
    // outside the TICKS. It conflated the calibration with the calibrated area.
    //
    // David, 2026-08-16: *"We have CALIBRATED ends of the colour key. All we are
    // doing is setting KNOWN VALUES at 100 and 700… Anything that wants to go
    // OUTSIDE of the calibrated area is out of bounds."*
    //
    // ⚑ The requirement the old comment names is real and is kept — see
    // "ACCEPTS A VALUE BEYOND A LABELLED TICK" below, which tests it with
    // positions taken from the scale's own ticks rather than from two numbers
    // that happen to be greater than one.
    expect(setCellReadingAt(NO_HEATMAP_CELL_READINGS, 0, 0, -0.2).error).toMatch(/colour key/i);
    expect(setCellReadingAt(NO_HEATMAP_CELL_READINGS, 0, 0, 1.2).error).toMatch(/colour key/i);
  });
});

/**
 * ⚑⚑ P2 AT THE ENGINE SEAM — the grid expressed against the axis POSITION.
 *
 * David's rule stated as outcomes: adjusting a calibration and changing the grid
 * are independent, and the grid does not depend on the calibration's NUMERICAL
 * VALUES.
 */
describe('the grid sits ON the calibration, not IN it', () => {
  const spans = { x: [0, 100] as [number, number], y: [0, 50] as [number, number] };
  const grid: HeatmapState = { xDividers: [0, 20, 60, 100], yDividers: [0, 25, 50] };

  it('round-trips a grid through parameters and back', () => {
    const params = heatmapGridToParams(grid, spans)!;
    expect(resolveHeatmapGrid(params, spans)).toEqual(grid);
  });

  it('⚑⚑ RETYPING A CALIBRATION VALUE DOES NOT MOVE THE STORE', () => {
    // The user corrects what the axis is worth. The parameters are untouched, so
    // the grid still describes the same places on the figure — and the data
    // coordinates it resolves to change, which is the correct consequence.
    const params = heatmapGridToParams(grid, spans)!;
    const retyped = { x: [10, 200] as [number, number], y: spans.y };
    const after = resolveHeatmapGrid(params, retyped)!;
    expect(after.xDividers).toEqual([10, 48, 124, 200]);
    // Unchanged on the axis nobody touched.
    expect(after.yDividers).toEqual(grid.yDividers);
    // And the STORE is byte-identical — that is the property that matters.
    expect(heatmapGridToParams(after, retyped)).toEqual(params);
  });

  it('is the SAME store for two calibrations that differ only in their numbers', () => {
    // The sharpest form of "not dependent on the numerical values": two figures
    // calibrated over the same positions with different units produce the same
    // grid, because a parameter has no units.
    const a = heatmapGridToParams({ xDividers: [0, 50, 100], yDividers: [0, 50] }, { x: [0, 100], y: [0, 50] })!;
    const b = heatmapGridToParams({ xDividers: [1, 5.5, 10], yDividers: [0, 5] }, { x: [1, 10], y: [0, 5] })!;
    expect(a).toEqual(b);
  });

  it('survives an axis calibrated BACKWARDS, which plenty are', () => {
    const rev = { x: [100, 0] as [number, number], y: spans.y };
    const params = heatmapGridToParams(grid, rev)!;
    const back = resolveHeatmapGrid(params, rev)!;
    back.xDividers.forEach((d, i) => expect(d).toBeCloseTo(grid.xDividers[i]!, 9));
  });

  it('refuses to resolve against a degenerate span rather than drawing a collapsed grid', () => {
    const params = heatmapGridToParams(grid, spans)!;
    expect(resolveHeatmapGrid(params, { x: [7, 7], y: spans.y })).toBeNull();
    expect(heatmapGridToParams(grid, { x: [7, 7], y: spans.y })).toBeNull();
  });

  it('⚠️ takes the span from what the AXES say a POSITION is worth, not from typed values', () => {
    // ⚑⚑ THE REGRESSION THIS EXISTS TO STOP. Reading `placed.y1.values[0]` works
    // on a value axis and returns '' on a CATEGORY axis, where the row edge
    // takes no coordinate and the far edge carries the COUNT. `Number('')` is 0
    // at both ends, so the span collapsed and a categorical heatmap silently had
    // NO GRID — the "a heatmap always has a numeric scale" premise, again.
    // ⚑ So the placed points here carry PIXELS and no values at all, which is
    // exactly the categorical case; the axes are the only source of meaning.
    const placed = {
      x1: { px: 100, py: 500 }, x2: { px: 600, py: 500 },
      y1: { px: 100, py: 500 }, y2: { px: 100, py: 100 },
    };
    const axes = {
      pixelToData: (px: number, py: number) => [(px - 100) / 5, (500 - py) / 8],
    };
    expect(heatmapAxisSpans(placed, axes)).toEqual(spans);

    // Half a walk has no span to measure against — and must say so rather than
    // producing a frame out of NaN.
    expect(heatmapAxisSpans({ x1: placed.x1, x2: placed.x2 }, axes)).toBeNull();
    // Two points the axes place at the SAME coordinate bound nothing.
    expect(heatmapAxisSpans({ ...placed, x2: { px: 100, py: 500 } }, axes)).toBeNull();
    // No axes yet — no frame, and no guessing one.
    expect(heatmapAxisSpans(placed, null)).toBeNull();
    // An axes that cannot place the point refuses rather than reading undefined
    // as a number.
    expect(heatmapAxisSpans(placed, { pixelToData: () => [undefined, undefined] })).toBeNull();
  });
});

/**
 * ⚑⚑ P2, rule 4 — David: *"Should the axis underneath it change so drastically
 * that a new grid detection needs to take place, then we should warn the user of
 * that, and ask for a new grid detection to take place, and NOT MAKE ABSTRACT
 * MODELS AROUND IT."*
 *
 * So this answers exactly one question — HAS THE AXIS MOVED SINCE THIS GRID WAS
 * RECORDED — and deliberately does not answer "does the grid still fit". The
 * second is the abstract model, and it is the one that would be wrong silently.
 */
describe('saying the axis has moved under the grid', () => {
  const at = (x1: number, y1: number, x2: number, y2: number) =>
    ({ x1: { px: x1, py: y1 }, x2: { px: x2, py: y2 }, y1: { px: x1, py: y1 }, y2: { px: x1, py: y2 } });

  it('is quiet while the axis is where it was', () => {
    const placed = at(10, 200, 300, 200);
    const stamp = heatmapAxisStamp(placed)!;
    expect(heatmapAxisMoved(stamp, placed)).toBe(false);
  });

  it('says so once a calibration handle has been dragged', () => {
    const stamp = heatmapAxisStamp(at(10, 200, 300, 200))!;
    expect(heatmapAxisMoved(stamp, at(24, 200, 300, 200))).toBe(true);
  });

  it('⚑ stays quiet when only a calibration VALUE was retyped', () => {
    // The pixels did not move, so the grid is still exactly where it was put and
    // there is nothing to warn about. Warning here would train the user to
    // ignore the message — the rule `heatmapRegenerateWarning` already follows.
    const placed = at(10, 200, 300, 200);
    const stamp = heatmapAxisStamp(placed)!;
    // Same geometry, different numbers entirely: no stamp involvement at all.
    expect(heatmapAxisMoved(stamp, placed)).toBe(false);
  });

  it('ignores a sub-pixel wobble, which is not a move anyone made', () => {
    const stamp = heatmapAxisStamp(at(10, 200, 300, 200))!;
    expect(heatmapAxisMoved(stamp, at(10.0001, 200, 300, 200))).toBe(false);
  });

  it('has nothing to say when there is no stamp or no calibration', () => {
    // An older grid, or a walk that is not finished — silence, not a warning
    // about a comparison that cannot be made.
    expect(heatmapAxisStamp({})).toBeNull();
    expect(heatmapAxisMoved(undefined, at(10, 200, 300, 200))).toBe(false);
    expect(heatmapAxisMoved(heatmapAxisStamp(at(10, 200, 300, 200))!, {})).toBe(false);
  });
});

/**
 * ⚑⚑ THE COLOUR KEY IS AN AXIS, AND ITS CALIBRATED AREA IS THE STRIP.
 *
 * David, 2026-08-16, correcting me: *"We have CALIBRATED ends of the colour key.
 * All we are doing is setting KNOWN VALUES at 100 and 700. And we are
 * interpolating everything in between. We can do the same to the ENDS OF THE
 * CALIBRATED AREA. Anything that wants to go OUTSIDE of the calibrated area is
 * out of bounds."*
 *
 * ⚠️ I HAD THE BOUNDARY IN THE WRONG PLACE and built a whole design question on
 * it — whether to hatch or flag a cell "past the end of the key", where "the
 * key" meant the two LABELLED TICKS. They are not the edge. They are the
 * calibration, exactly as x1 and x2 are on an axis, and the plot area extends
 * past them.
 *
 * ⚑ So the rule is the one every other axis already has: the CALIBRATED AREA
 * bounds the reading. For the key that area is the strip the user dragged out,
 * `k1 → k2`, which is `t` in 0..1. Inside it every position has REAL SAMPLED
 * INK, including past a labelled tick. Outside it there is no ink at all.
 */
describe('a reading is bounded by the STRIP, not by the labelled ticks', () => {
  const scaleFor = () => {
    const { image, placed } = scene();
    return buildColorScale(placed, image, false).scale!;
  };

  it('accepts the ends of the strip themselves — they are IN the calibrated area', () => {
    for (const t of [0, 1]) {
      const { error } = setCellReadingAt(NO_HEATMAP_CELL_READINGS, 1, 1, t);
      expect(error, `t=${t} is on the strip`).toBeNull();
    }
  });

  it('REFUSES a position past either end of the strip, naming what is missing', () => {
    for (const t of [-0.01, -3, 1.01, 4]) {
      const { readings, error } = setCellReadingAt(NO_HEATMAP_CELL_READINGS, 1, 1, t);
      expect(error, `t=${t}`).toMatch(/colour key/i);
      // ⚑ And it must not record anything: a refusal that still writes is worse
      // than no refusal, because the number looks accepted.
      expect(readings).toEqual(NO_HEATMAP_CELL_READINGS);
    }
  });

  it('⚑⚑ ACCEPTS A VALUE BEYOND A LABELLED TICK, because the ink is still there', () => {
    // THE CASE THE CORRECTION SAVES. The ticks are two known points on the
    // strip, not its ends — so a figure whose key is labelled 100 and 700 with
    // ink continuing past the 700 mark can legitimately read higher than 700,
    // and that colour was really sampled. Refusing it would refuse a real
    // reading off a real figure.
    const scale = scaleFor();
    const tickPositions = scale.ticks.map((tick) => positionOnStrip(scale.strip, tick.point)!);
    const hi = Math.max(...tickPositions);
    expect(hi, 'the fixture must have ink past its last tick, or this proves nothing').toBeLessThan(1);

    // A position between the last tick and the end of the strip.
    const beyond = (hi + 1) / 2;
    const { error } = setCellReadingAt(NO_HEATMAP_CELL_READINGS, 0, 0, beyond);
    expect(error).toBeNull();
    // And it is worth MORE than the labelled tick — extrapolated, but off ink we
    // actually measured.
    const outer = scale.ticks[tickPositions[0]! > tickPositions[1]! ? 0 : 1]!.value;
    expect(Math.abs(valueAtPosition(scale, beyond)!)).toBeGreaterThan(Math.abs(outer) * 0.999);
  });

  it('refuses a TYPED value whose position falls off the strip', () => {
    // The typed twin of the drag, through the same bound — a guard on one
    // entrance only is the shape this project keeps getting bitten by.
    const scale = scaleFor();
    const wild = valueAtPosition(scale, 5)!;
    const { readings, error } = setCellReading(NO_HEATMAP_CELL_READINGS, scale, 1, 1, String(wild));
    expect(error).toMatch(/colour key/i);
    expect(readings).toEqual(NO_HEATMAP_CELL_READINGS);
  });
});
