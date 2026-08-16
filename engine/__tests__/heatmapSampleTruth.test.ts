import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPng } from './helpers/readPng.js';
import { XYAxes } from '../../core/axes/xy.js';
import { Calibration } from '../../core/calibration.js';
import { buildColorScale, detectGrid, heatmapBounds as heatmapBoundsOf, initialGrid, heatmapBandCounts, initialGridFor, readHeatmapCells, NO_HEATMAP_LABELS } from '../heatmapRun.js';
import { CalibrationSession, HEATMAP_AXES_CONFIG } from '../calibrationSession.js';
import type { PlacedCalibPoint } from '../calibrationSession.js';

/**
 * THE THREE BUNDLED HEATMAP EXAMPLES, traced against their own committed truth
 * (v2.2) — one per case the record enumerates, because a heatmap's two axes are
 * each independently a CATEGORY or a VALUE and a figure cannot demonstrate a
 * combination it does not have.
 *
 * ⚑ THE EXAMPLES ARE A PROMISE. Every one of them ships the exact values it was
 * rendered from, and a user can only judge this tool by whether what comes out
 * matches what went in. A bundled figure the app reads WRONG is worse than no
 * example at all — so each is traced here, end to end, by the same functions the
 * card calls.
 *
 * ⚑ Each covers what the others cannot:
 *
 *   weld ....... VALUE × VALUE. UNEQUAL cells, no drawn borders — every boundary
 *                is a bare colour discontinuity, and nothing about the answer
 *                can come from assuming a pitch.
 *   assay ...... CATEGORY × CATEGORY. Regular cells WITH printed white rules (a
 *                border changes colour twice, once at each edge) and a LOG
 *                colour key, where reading the key as linear is wrong by a
 *                FACTOR, not by a rounding. Its axes print NAMES, so it cannot
 *                be calibrated by typing coordinates at all.
 *   timecourse . CATEGORY × VALUE, the mixed case: named treatments against real
 *                time with unequal bins, so the two axes are captured by
 *                OPPOSITE means in one figure.
 *
 * ⚠️ The first two shipped as value × value only — the assay figure was DRAWN
 * with numeric axes because that was all the tool could calibrate — until David
 * read the calibration card: *"Both examples heatmaps only use value axis. That
 * does not hold."* An example drawn to fit the tool's limits hides the limit
 * twice: once here, and once from every user who takes the bundled figures as
 * what the tool is for.
 */

interface SampleTruth {
  axes: { value: { min: number; max: number; log: boolean } };
  calibration: {
    anchors: Record<'x1' | 'x2' | 'y1' | 'y2' | 'k1' | 'k2' | 'kv1' | 'kv2', { px: number; py: number; value?: number }>;
  };
  grid: { x: number[]; y: number[] };
  cells: Array<{ xMin: number; xMax: number; yMin: number; yMax: number; value: number }>;
}

function sample(name: string): { truth: SampleTruth; image: { data: Uint8ClampedArray; width: number; height: number }; axes: XYAxes; placed: Record<string, PlacedCalibPoint> } {
  const truth = JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../samples/${name}.truth.json`, import.meta.url)), 'utf8')
  ) as SampleTruth;
  const image = readPng(fileURLToPath(new URL(`../../samples/${name}.png`, import.meta.url)));
  const a = truth.calibration.anchors;
  const cal = new Calibration();
  cal.addPoint(a.x1.px, a.x1.py, String(a.x1.value), '');
  cal.addPoint(a.x2.px, a.x2.py, String(a.x2.value), '');
  cal.addPoint(a.y1.px, a.y1.py, '', String(a.y1.value));
  cal.addPoint(a.y2.px, a.y2.py, '', String(a.y2.value));
  const axes = new XYAxes();
  expect(axes.calibrate(cal, false, false, true)).toBe(true);
  const placed: Record<string, PlacedCalibPoint> = {
    k1: { px: a.k1.px, py: a.k1.py, values: [] },
    k2: { px: a.k2.px, py: a.k2.py, values: [] },
    kv1: { px: a.kv1.px, py: a.kv1.py, values: [String(a.kv1.value)] },
    kv2: { px: a.kv2.px, py: a.kv2.py, values: [String(a.kv2.value)] },
  };
  return { truth, image, axes, placed };
}

/** Read the whole figure the way the card does. */
function traceSample(name: string) {
  const { truth, image, axes, placed } = sample(name);
  const isLog = truth.axes.value.log;
  const { scale, error } = buildColorScale(placed, image, isLog);
  expect(error).toBeNull();
  const bounds = {
    xMin: truth.grid.x[0]!,
    xMax: truth.grid.x[truth.grid.x.length - 1]!,
    yMin: truth.grid.y[0]!,
    yMax: truth.grid.y[truth.grid.y.length - 1]!,
  };
  const detected = detectGrid(image, axes, initialGrid(bounds), {
    columns: truth.grid.x.length - 1,
    rows: truth.grid.y.length - 1,
  });
  // ⚑ STATED, not defaulted. `kinds` only flags the coordinates as ordinals for
  // the export — it cannot move a value — so value×value is right for a
  // truth comparison. Writing it down is the point: this file compares against
  // ground truth and had been asserting a default nobody chose.
  const read = readHeatmapCells(
    image,
    axes,
    detected.grid ?? initialGrid(bounds),
    scale!,
    NO_HEATMAP_LABELS,
    { x: 'value', y: 'value' }
  );
  return { truth, detected, read };
}

/** Relative error, because a log figure spans decades and an absolute
 * tolerance would be meaningless at one end of it. */
const relative = (read: number, want: number): number => Math.abs(read - want) / Math.abs(want);

/**
 * The truth cell whose bounds match, to within the precision the DETECTED grid
 * can place a boundary.
 *
 * ⚑ Not an exact match: the grid under test came from the ink, so its
 * boundaries land within a pixel of the drawn ones rather than exactly on the
 * numbers the figure was generated from. Matching by index instead would still
 * line up if the matrix came out transposed, which is the mistake worth
 * catching.
 */
function truthCellFor(truth: SampleTruth, row: { xMin: number; yMin: number }) {
  const tol = 0.05 * Math.min(
    truth.grid.x[1]! - truth.grid.x[0]!,
    truth.grid.y[1]! - truth.grid.y[0]!
  );
  return truth.cells.find(
    (c) => Math.abs(c.xMin - row.xMin) <= tol && Math.abs(c.yMin - row.yMin) <= tol
  );
}

describe('the bundled heatmap examples read back what they were drawn from', () => {
  it('weld cross-section: finds its UNEQUAL grid from bare colour changes', () => {
    const { truth, detected } = traceSample('heatmap-weld-temperature');
    expect(detected.agrees).toBe(true);
    expect(detected.grid!.xDividers).toHaveLength(truth.grid.x.length);
    truth.grid.x.forEach((want, i) => expect(detected.grid!.xDividers[i]).toBeCloseTo(want, 1));
    truth.grid.y.forEach((want, i) => expect(detected.grid!.yDividers[i]).toBeCloseTo(want, 1));
    // The columns really are all different widths — if they were not, finding
    // them would prove nothing.
    const widths = new Set(truth.grid.x.slice(1).map((v, i) => v - truth.grid.x[i]!));
    expect(widths.size).toBeGreaterThan(3);
  });

  it('weld cross-section: every cell within 0.3% of its true temperature', () => {
    const { truth, read } = traceSample('heatmap-weld-temperature');
    expect(read.rows).toHaveLength(truth.cells.length);
    // ⚑ TWO DEGREES ABSOLUTE, and that is the key's own floor rather than a
    // slack tolerance: 256 lookup-table entries over a 60–780 °C key is 2.8 °C
    // per entry, so half an entry — 1.4 °C — is the finest any inversion through
    // this figure can be. Measured worst case: 1.4 °C.
    for (const row of read.rows) {
      const want = truthCellFor(truth, row);
      expect(want, `no truth cell at ${row.xMin},${row.yMin}`).toBeDefined();
      expect(Math.abs(row.value! - want!.value), `cell ${row.col},${row.row}`).toBeLessThan(2);
    }
    expect(read.summary).toBe('20 cells read, all clean.');
  });

  it('IC50 assay: reads a LOG key correctly, which a linear read could not', () => {
    // ⚑ The claim that matters here: on a key spanning 3 to 600, reading the
    // scale as linear is not slightly wrong, it is wrong by a factor — a cell
    // worth 10 comes out near 200. Every cell landing within 1% of truth is only
    // possible if the logarithm is actually being applied.
    const { truth, read } = traceSample('heatmap-assay-log');
    expect(read.rows).toHaveLength(truth.cells.length);
    // ⚑ RELATIVE, and 2% is this key's own floor: 256 entries over the 2.3
    // decades from 3 to 600 nM is a ratio of 1.021 per entry, so half an entry
    // is about 1%. A linear misreading would be out by a FACTOR, not by 2%.
    for (const row of read.rows) {
      const want = truthCellFor(truth, row);
      expect(want, `no truth cell at ${row.xMin},${row.yMin}`).toBeDefined();
      expect(relative(row.value!, want!.value), `cell ${row.col},${row.row}`).toBeLessThan(0.02);
    }
  });

  it('IC50 assay: finds the grid through its DRAWN white rules', () => {
    // A printed border changes colour twice, once at each edge. Reporting both
    // would give 2n boundaries and a sliver cell between every pair.
    const { truth, detected } = traceSample('heatmap-assay-log');
    expect(detected.agrees).toBe(true);
    expect(detected.grid!.xDividers).toHaveLength(truth.grid.x.length);
    truth.grid.x.forEach((want, i) => expect(detected.grid!.xDividers[i]).toBeCloseTo(want, 1));
    truth.grid.y.forEach((want, i) => expect(detected.grid!.yDividers[i]).toBeCloseTo(want, 1));
  });

  it('both examples report every cell as clean — no example ships a warning', () => {
    // ⚑ A bundled example the app cannot read confidently would teach a new user
    // that the tool is unreliable, on the very first thing they open.
    for (const name of ['heatmap-weld-temperature', 'heatmap-assay-log']) {
      const { read } = traceSample(name);
      const flagged = read.rows.filter((r) => r.warning !== '');
      expect(flagged.map((r) => `${r.col},${r.row}: ${r.warning}`), name).toEqual([]);
    }
  });
});

describe('the MIXED case — a category axis against a value axis', () => {
  /**
   * ⚑⚑ THE THIRD OF FOUR ENUMERATED CASES, and until this figure existed
   * nothing demonstrated it: both bundled heatmaps were value × value, which is
   * what David caught — *"Both examples heatmaps only use value axis. That does
   * not hold."* Rows here are named treatments with no coordinate at all;
   * columns are time, with UNEQUAL bins. The two axes are therefore captured by
   * opposite means in one figure, which is the case a same-kind figure cannot
   * show.
   */
  it('reads every cell of the timecourse figure, and none of them warns', () => {
    const { truth, image, axes, placed } = sample('heatmap-timecourse');
    const { scale } = buildColorScale(placed, image, false);
    const grid = { xDividers: truth.grid.x, yDividers: truth.grid.y };
    const { rows, summary, error } = readHeatmapCells(image, axes, grid, scale!, undefined, {
      x: 'value',
      y: 'category',
    });
    expect(error).toBeNull();
    expect(rows).toHaveLength(truth.cells.length);
    for (const row of rows) {
      const want = truth.cells.find(
        (c) => Math.abs(c.xMin - row.xMin) < 1e-6 && Math.abs(c.yMin - row.yMin) < 1e-6
      )!;
      expect(want, `no truth cell at ${row.xMin},${row.yMin}`).toBeDefined();
      expect(Math.abs(row.value! - want.value)).toBeLessThan(1.5);
    }
    // ⚑ A bundled example that ships a warning teaches the wrong thing — the
    // narrow early bins of a real sampling schedule have to survive the reader.
    expect(summary).toMatch(/all clean/);
    expect(rows.every((r) => r.xIsCategory === false && r.yIsCategory === true)).toBe(true);
  });
});

describe('the SAME figure read through a CATEGORY calibration', () => {
  /**
   * ⚑⚑ TWO PATHS, ONE FIGURE, AND THEY MUST AGREE. The assay example's axes are
   * genuinely categorical — compound × cell line — and it was drawn with numeric
   * axes only because that is all the tool could calibrate when it was made
   * (David spotted the assumption from the calibration card: *"this assumes
   * value based axis, no?"*). Its bands are unit-wide, so a category
   * calibration's derived 0…N frame lands on exactly the same pixels as the
   * value calibration's — which makes the two paths comparable, and any
   * disagreement a defect rather than a difference of convention.
   *
   * ⚑ Nobody types a coordinate on this path. Two edge clicks and a COUNT.
   */
  function categorySession(columns: number, rows: number): CalibrationSession<XYAxes> {
    const truth = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../samples/heatmap-assay-log.truth.json', import.meta.url)), 'utf8')
    ) as SampleTruth;
    const a = truth.calibration.anchors;
    const s = new CalibrationSession<XYAxes>(HEATMAP_AXES_CONFIG);
    s.setOption('xIsCategory', 'true');
    s.setOption('yIsCategory', 'true');
    s.setOption('isLogValue', 'true');
    const walk: Array<[number, number, string[]]> = [
      [a.x1.px, a.x1.py, []],
      [a.x2.px, a.x2.py, [String(columns)]],
      [a.y1.px, a.y1.py, []],
      [a.y2.px, a.y2.py, [String(rows)]],
      [a.k1.px, a.k1.py, []],
      [a.k2.px, a.k2.py, []],
      [a.kv1.px, a.kv1.py, [String(a.kv1.value)]],
      [a.kv2.px, a.kv2.py, [String(a.kv2.value)]],
    ];
    for (const [px, py, values] of walk) {
      s.handleCalibrationClick(px, py);
      if (values.length > 0) s.confirmCalibrationValues(values);
    }
    expect(s.runCalibration()).toBe(true);
    return s;
  }

  it('DECLARING the counts gives the figure’s own grid, with no detection at all', () => {
    // ⚑ The count is already a declaration, so the bands are declared rather
    // than guessed: six columns and five rows land exactly on the committed
    // grid. A user who has counted the categories has told us where every
    // boundary is.
    const { truth } = sample('heatmap-assay-log');
    const session = categorySession(6, 5);
    const axes = session.getAxes()!;
    const grid = initialGridFor(heatmapBoundsOf(axes)!, heatmapBandCounts(axes as never));
    expect([...grid.xDividers]).toEqual(truth.grid.x);
    expect([...grid.yDividers]).toEqual(truth.grid.y);
  });

  it('reads every cell to the SAME value the value-axis path does', () => {
    const { truth, image, placed } = sample('heatmap-assay-log');
    const session = categorySession(6, 5);
    const axes = session.getAxes()!;
    const { scale } = buildColorScale(placed, image, true);
    const grid = initialGridFor(heatmapBoundsOf(axes)!, heatmapBandCounts(axes as never));
    const { rows, error } = readHeatmapCells(image, axes, grid, scale!, undefined, {
      x: 'category',
      y: 'category',
    });
    expect(error).toBeNull();
    expect(rows).toHaveLength(truth.cells.length);
    for (const row of rows) {
      const want = truth.cells.find(
        (c) => Math.abs(c.xMin - row.xMin) < 1e-6 && Math.abs(c.yMin - row.yMin) < 1e-6
      )!;
      expect(want, `no truth cell at ${row.xMin},${row.yMin}`).toBeDefined();
      // A LOG key, so agreement is judged as a RATIO — an absolute tolerance
      // would be meaningless across 3…600 nM.
      expect(Math.abs(row.value! / want.value - 1)).toBeLessThan(0.05);
    }
  });

  it('marks the coordinates as ORDINALS, so nobody reads band 3 as 3 mm', () => {
    const { image, placed } = sample('heatmap-assay-log');
    const session = categorySession(6, 5);
    const axes = session.getAxes()!;
    const { scale } = buildColorScale(placed, image, true);
    const grid = initialGridFor(heatmapBoundsOf(axes)!, heatmapBandCounts(axes as never));
    const { rows } = readHeatmapCells(image, axes, grid, scale!, undefined, { x: 'category', y: 'category' });
    expect(rows[0]!.xIsCategory).toBe(true);
    expect(rows[0]!.yIsCategory).toBe(true);
  });
});
