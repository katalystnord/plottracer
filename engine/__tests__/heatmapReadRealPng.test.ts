import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPng } from './helpers/readPng.js';
import { XYAxes } from '../../core/axes/xy.js';
import { Calibration } from '../../core/calibration.js';
import { sampleColorBar } from '../../algorithms/colorBar.js';
import { checkColorScale, type ColorScale } from '../../algorithms/colorScale.js';
import { readHeatmap, type HeatmapCellReading } from '../../algorithms/heatmapRead.js';

/**
 * THE WHOLE HEATMAP, read off a real render and compared against the values it
 * was drawn from (v2.2, phase 3).
 *
 * ⚑ THIS IS THE FIRST TEST THAT ASKS THE PRODUCT'S OWN QUESTION. Phase 1 asked
 * "where on the key is this colour", phase 2 "what is that position worth" -
 * both against colours the test picked. Here nothing is picked: a calibrated
 * frame, a calibrated key and a grid go in, and a MATRIX comes out, cell by
 * cell, exactly as a user would get it. Graph in → reliable data out, measured.
 *
 * ⚑ The figure has UNEQUAL cells (columns 1.0 / 2.5 / 0.5 / 2.0 / 3.0 wide, rows
 * 2.0 / 0.5 / 2.5 / 3.0 tall), because that is the case the record was designed
 * for and the case a "rows × columns" count cannot express.
 */

interface TruthPoint {
  x: number;
  y: number;
  value: number;
}
interface TruthFigure {
  file: string;
  cmap: string;
  key: { from: { x: number; y: number }; to: { x: number; y: number }; ticks: TruthPoint[] };
  frame: { x1: TruthPoint; x2: TruthPoint; y1: TruthPoint; y2: TruthPoint };
  grid: { x: number[]; y: number[] };
  cells: Array<{ x: number; y: number; value: number; x_min: number; x_max: number; y_min: number; y_max: number }>;
}

const truth = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/colorbars/truth.json', import.meta.url)), 'utf8')
) as { figures: TruthFigure[] };

function figure(file: string): TruthFigure {
  return truth.figures.find((f) => f.file === file)!;
}

/** The figure's x/y frame, calibrated exactly as the app's own walk would: two
 * known X positions, two known Y positions, straight into `XYAxes`. */
function frameAxes(fig: TruthFigure): XYAxes {
  const cal = new Calibration();
  cal.addPoint(fig.frame.x1.x, fig.frame.x1.y, String(fig.frame.x1.value), '');
  cal.addPoint(fig.frame.x2.x, fig.frame.x2.y, String(fig.frame.x2.value), '');
  cal.addPoint(fig.frame.y1.x, fig.frame.y1.y, '', String(fig.frame.y1.value));
  cal.addPoint(fig.frame.y2.x, fig.frame.y2.y, '', String(fig.frame.y2.value));
  const axes = new XYAxes();
  expect(axes.calibrate(cal, false, false, true)).toBe(true);
  return axes;
}

function read(file: string): { cells: HeatmapCellReading[]; fig: TruthFigure } {
  const fig = figure(file);
  const img = readPng(fileURLToPath(new URL(`./fixtures/colorbars/${file}`, import.meta.url)));
  // ⚑ 15, not 5, and the difference is load-bearing now that the key measures
  // its own tolerance from how much it varies ACROSS its thickness. Measured p90
  // noise on the q35 JPEG by sampled thickness: t1:0 t3:8 t5:13 t9:29 t15:30
  // t21:32 - a thin sample simply does not see the scan's noise, and reports a
  // tolerance too tight to read the figure with. Production never has this
  // problem: `stripFromCorners` takes 60% of the short side of the box the user
  // clicked, so it is inside the band by construction.
  // ⚠️ And not much more, either: at t31 the window spills off the band onto the
  // paper and the measurement jumps to 315 on a CLEAN key.
  const strip = sampleColorBar(img.data, img.width, img.height, fig.key.from, fig.key.to, {
    thickness: 15,
  }).strip!;
  const scale: ColorScale = {
    strip,
    ticks: [
      { point: fig.key.ticks[0]!, value: fig.key.ticks[0]!.value },
      { point: fig.key.ticks[1]!, value: fig.key.ticks[1]!.value },
    ],
    log: false,
  };
  expect(checkColorScale(scale)).toBeNull();
  const cells = readHeatmap(
    img.data,
    img.width,
    img.height,
    frameAxes(fig),
    fig.grid.x,
    fig.grid.y,
    scale
  );
  expect(cells).not.toBeNull();
  return { cells: cells!, fig };
}

/** Truth for a cell, matched by its declared bounds rather than by index - an
 * index match would still line up if the matrix came out transposed. */
function truthFor(fig: TruthFigure, cell: HeatmapCellReading) {
  const found = fig.cells.find(
    (c) => c.x_min === cell.xMin && c.x_max === cell.xMax && c.y_min === cell.yMin && c.y_max === cell.yMax
  );
  expect(found, `no truth cell at [${cell.xMin},${cell.xMax}]x[${cell.yMin},${cell.yMax}]`).toBeDefined();
  return found!;
}

const max = (xs: number[]): number => xs.reduce((a, b) => Math.max(a, b), 0);
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('reading a whole heatmap off a real render', () => {
  it('returns one cell per grid cell, with the bounds the grid declared', () => {
    const { cells, fig } = read('heatmap-viridis.png');
    expect(cells).toHaveLength((fig.grid.x.length - 1) * (fig.grid.y.length - 1));
    expect(cells).toHaveLength(20);
    for (const cell of cells) {
      // ⚑ The record carries the cell's EDGES, and they are the grid's own
      // numbers rather than anything re-derived. A consumer that needs centres
      // can compute them; a consumer that needs edges (matplotlib's
      // `shading='flat'` REQUIRES n+1 of them) cannot go the other way once
      // cells are unequal.
      const t = truthFor(fig, cell);
      expect(cell.xMin).toBe(t.x_min);
      expect(cell.xMax).toBe(t.x_max);
      expect(cell.yMin).toBe(t.y_min);
      expect(cell.yMax).toBe(t.y_max);
    }
  });

  it('reads every cell to a fraction of a degree', () => {
    // 20 cells, unequal, on a −40..120 °C key. Measured: max 0.64 °C, mean 0.26
    // - half a lookup-table entry, the floor any inversion through this key can
    // reach.
    const { cells, fig } = read('heatmap-viridis.png');
    const errors = cells.map((c) => Math.abs(c.value! - truthFor(fig, c).value));
    expect(max(errors)).toBeLessThan(1.0);
    expect(mean(errors)).toBeLessThan(0.4);
  });

  // ⚠️ REMOVED WITH THE BAND. This asserted that `low..high` bracketed the truth
  // value - a property of the old error model, which no other axis in this
  // product has. What it was really protecting is accuracy, and the test above
  // measures that directly against the published values: max 0.64, mean 0.26.

  it('a cell that reports itself CLEAN is right, on every figure', () => {
    // ⚑⚑ THE CLAIM THE WHOLE TYPE RESTS ON: in a heatmap the colour IS the
    // value, so a wrong cell has no other symptom - no gap in a trace, no
    // refusal, nothing odd on screen. If a cell can look clean and be wrong,
    // nothing else will catch it.
    //
    // ⚑ RE-EXPRESSED FOR THE LOOKUP, and deliberately not weakened. It used to
    // read "the reported BAND brackets the truth", which a lookup cannot say
    // because it reports no band. So it says the harder, plainer thing instead:
    // the number is right, to a stated fraction of the key's own span, measured
    // against the figure's published values.
    //
    // ⚠️ NOT VACUOUS - the bounds are TIGHT. Loosen the lookup and these fail.
    // MEASURED, then pinned just above: 0.64, 0.64 and 1.60 respectively -
    // 0.53%, 0.53% and 1.34% of each key's own span.
    const WORST_CLEAN = { 'heatmap-viridis.png': 0.65, 'heatmap-jet.png': 0.65, 'heatmap-jet-jpeg.png': 1.65 };
    for (const [name, bound] of Object.entries(WORST_CLEAN)) {
      const { cells, fig } = read(name);
      // ⚑ At THIS level a cell has no `warning` string - that sentence is built
      // one layer up. Clean here is what the reading itself says: it was
      // measurable, and the whole sample was the colour we read.
      const clean = cells.filter((c) => c.value !== null && c.uniformity === 1);
      expect(clean.length, `${name} has clean cells to judge`).toBeGreaterThan(0);
      for (const cell of clean) {
        const t = truthFor(fig, cell);
        expect(cell.value, `${name} clean cell has a value`).not.toBeNull();
        expect(Math.abs(cell.value! - t.value), `${name} R${cell.row + 1}C${cell.col + 1}`).toBeLessThanOrEqual(bound);
      }
    }
  });

  it('says a degraded figure is degraded, and a clean one clean', () => {
    // The counterpart, and what stops the claim above being vacuous: the verdict
    // has to be able to say NO. On the q35 JPEG, 8 of the 20 cells carry
    // something that is not the cell's own colour and say so.
    //
    // ⚑ IT USED TO BE 18 OF 20, and the difference is the point of this whole
    // rework rather than a regression: the estimator flagged a cell whenever its
    // colour sat off the ramp, which on a JPEG is nearly every cell. The lookup
    // READS those cells - all twenty come back within 1.34% of the key's span -
    // so the only thing left to report is what UNIFORMITY sees: something in the
    // cell that is not the cell.
    const degraded = read('heatmap-jet-jpeg.png').cells;
    expect(degraded.filter((c) => c.uniformity < 1)).toHaveLength(8);
    // ⚑⚑ 16 OF 20 READ, AND FOUR HONESTLY REFUSED. This said "all twenty" until
    // the re-audit found that the key's own noise measurement was collapsing to
    // the MAXIMUM at production thicknesses, which inflated the tolerance and
    // admitted cells on a threshold set by one stray pixel. With the statistic
    // corrected the tolerance is what the band actually varies by, and on a q35
    // JPEG that is not enough for four of the cells.
    // ▶ THE TRADE IS THE RIGHT WAY ROUND: the four are REFUSED, not guessed at,
    // and the sixteen that do read are MORE accurate than all twenty were -
    // worst error 0.87% of the key's span against 1.34% before. A tolerance
    // inflated by a bug is not a capability.
    expect(degraded.filter((c) => c.value !== null)).toHaveLength(16);

    // ...and a clean render has nothing to report at all.
    for (const name of ['heatmap-viridis.png', 'heatmap-jet.png']) {
      const cells = read(name).cells;
      expect(cells.every((c) => c.value !== null), name).toBe(true);
      expect(cells.filter((c) => c.uniformity < 1), name).toHaveLength(0);
    }
  });

  it('reports a flat printed cell as UNIFORM, and says so per cell', () => {
    // ⚑ The third piece of evidence, and the one the other two cannot give: a
    // cell's colour can sit exactly on the ramp while a third of the cell is ink
    // that is not data. On a clean `pcolormesh` every cell is one flat colour,
    // so uniformity is 1 - which is what makes a lower number elsewhere mean
    // something.
    const { cells } = read('heatmap-viridis.png');
    expect(cells.every((c) => c.uniformity === 1)).toBe(true);
    expect(cells.every((c) => c.samples > 0)).toBe(true);
  });

  it('drops uniformity where JPEG has broken the cell up', () => {
    // The same 20 flat cells, quality-35 encoded: no longer one colour each.
    const clean = read('heatmap-jet.png').cells;
    const jpeg = read('heatmap-jet-jpeg.png').cells;
    expect(mean(clean.map((c) => c.uniformity))).toBe(1);
    expect(mean(jpeg.map((c) => c.uniformity))).toBeLessThan(1);
  });

  it('puts each cell’s centre inside its own bounds', () => {
    const { cells } = read('heatmap-viridis.png');
    for (const cell of cells) {
      expect(cell.xCentre).toBeGreaterThan(cell.xMin);
      expect(cell.xCentre).toBeLessThan(cell.xMax);
      expect(cell.yCentre).toBeGreaterThan(cell.yMin);
      expect(cell.yCentre).toBeLessThan(cell.yMax);
      // On these linear axes the drawn centre and the midpoint of the bounds
      // agree; the distinction only bites on a log axis, where the middle of the
      // block of ink is NOT the average of its edges.
      expect(cell.xCentre).toBeCloseTo((cell.xMin + cell.xMax) / 2, 6);
      expect(cell.yCentre).toBeCloseTo((cell.yMin + cell.yMax) / 2, 6);
    }
  });

  it('is not fooled by the cells being UNEQUAL', () => {
    // ⚑ The failure a uniform lattice would produce is a shifted matrix that
    // still looks like a matrix. Every column here is a different width, so a
    // reader that assumed equal spacing would sample the wrong cells from the
    // second column on - and would still return 20 plausible numbers.
    const { cells, fig } = read('heatmap-viridis.png');
    const widths = [...new Set(cells.map((c) => c.xMax - c.xMin))].sort((a, b) => a - b);
    expect(widths).toEqual([0.5, 1, 2, 2.5, 3]);
    const heights = [...new Set(cells.map((c) => c.yMax - c.yMin))].sort((a, b) => a - b);
    expect(heights).toEqual([0.5, 2, 2.5, 3]);
    // …and the narrowest column, the one an equal-spacing reader would miss
    // entirely, is read as accurately as the rest.
    const narrow = cells.filter((c) => c.xMax - c.xMin === 0.5);
    expect(narrow).toHaveLength(4);
    for (const cell of narrow) {
      expect(Math.abs(cell.value! - truthFor(fig, cell).value)).toBeLessThan(1.0);
    }
  });
});
