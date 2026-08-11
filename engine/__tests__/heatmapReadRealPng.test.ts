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
 * "where on the key is this colour", phase 2 "what is that position worth" —
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
  const strip = sampleColorBar(img.data, img.width, img.height, fig.key.from, fig.key.to, {
    thickness: 5,
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

/** Truth for a cell, matched by its declared bounds rather than by index — an
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
    // — half a lookup-table entry, the floor any inversion through this key can
    // reach.
    const { cells, fig } = read('heatmap-viridis.png');
    const errors = cells.map((c) => Math.abs(c.reading!.value - truthFor(fig, c).value));
    expect(max(errors)).toBeLessThan(1.0);
    expect(mean(errors)).toBeLessThan(0.4);
  });

  it('covers every truth value with the band it reports', () => {
    for (const name of ['heatmap-viridis.png', 'heatmap-jet.png']) {
      const { cells, fig } = read(name);
      for (const cell of cells) {
        const t = truthFor(fig, cell);
        expect(cell.reading!.low).toBeLessThanOrEqual(t.value);
        expect(cell.reading!.high).toBeGreaterThanOrEqual(t.value);
      }
    }
  });

  it('a cell that reports itself CLEAN is right — 42 of 42, across three figures', () => {
    // ⚑⚑ THE PRODUCT'S CLAIM, at the level a user actually sees it. A cell says
    // it is clean when its colour sits exactly on the key's ramp (distance 0) AND
    // the whole cell is that colour (uniformity 1). Measured across all three
    // figures: 42 cells said so and 42 were correct. Nine cells were wrong, all
    // on the quality-35 JPEG, and every one of them said something was off.
    //
    // ⚑ AND IT TOOK BOTH MEASURES TO GET THERE. Eight of the nine had a non-zero
    // distance. The ninth did not: JPEG happened to land that cell on a colour
    // the key really does print, so distance was 0 and the reading was wrong by
    // 0.3 °C with nothing in the colour to show it. What caught it was
    // UNIFORMITY — only 43% of the cell was the colour we read. The third
    // evidence channel earned its place on its first outing against a real
    // figure, on the one case the other two could not see.
    let looksClean = 0;
    let cleanAndCorrect = 0;
    let missed = 0;
    let missedButFlagged = 0;
    for (const name of ['heatmap-viridis.png', 'heatmap-jet.png', 'heatmap-jet-jpeg.png']) {
      const { cells, fig } = read(name);
      for (const cell of cells) {
        const t = truthFor(fig, cell);
        const covered = cell.reading!.low <= t.value && cell.reading!.high >= t.value;
        if (cell.reading!.distance === 0 && cell.uniformity === 1) {
          looksClean++;
          if (covered) cleanAndCorrect++;
        }
        if (!covered) {
          missed++;
          if (cell.reading!.distance > 0 || cell.uniformity < 1) missedButFlagged++;
        }
      }
    }
    expect(cleanAndCorrect).toBe(looksClean);
    expect(looksClean).toBe(42);
    expect(missedButFlagged).toBe(missed);
    expect(missed).toBeGreaterThan(0);
  });

  it('says a degraded figure is degraded — 2 clean cells out of 20', () => {
    // The counterpart to the claim above, and what stops it being vacuous: the
    // verdict has to be able to say NO. On the same 20 cells, quality-35 JPEG
    // leaves only two that can vouch for themselves.
    const { cells } = read('heatmap-jet-jpeg.png');
    const clean = cells.filter((c) => c.reading!.distance === 0 && c.uniformity === 1);
    expect(clean).toHaveLength(2);
    expect(read('heatmap-jet.png').cells.every((c) => c.reading!.distance === 0)).toBe(true);
  });

  it('reports a flat printed cell as UNIFORM, and says so per cell', () => {
    // ⚑ The third piece of evidence, and the one the other two cannot give: a
    // cell's colour can sit exactly on the ramp while a third of the cell is ink
    // that is not data. On a clean `pcolormesh` every cell is one flat colour,
    // so uniformity is 1 — which is what makes a lower number elsewhere mean
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
    // second column on — and would still return 20 plausible numbers.
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
      expect(Math.abs(cell.reading!.value - truthFor(fig, cell).value)).toBeLessThan(1.0);
    }
  });
});
