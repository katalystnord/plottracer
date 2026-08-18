import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPng } from './helpers/readPng.js';
import { XYAxes } from '../../core/axes/xy.js';
import { Calibration } from '../../core/calibration.js';
import {
  detectDividers,
  proposeDividers,
  reconcileWithCount,
  type PlotBox,
} from '../../algorithms/gridDetect.js';

/**
 * Boundary detection measured against real renders (v2.2, phase 3).
 *
 * ⚑ THE FIXTURES DRAW NO CELL BORDERS AT ALL (`edgecolors='none'`), which is the
 * HARDER of the two cases: every boundary here is a bare colour discontinuity
 * with no rule to find. If it works without ink to follow, a figure that does
 * print its gridlines is easier, not different - the same measurement finds
 * both, which is why there is no "does this figure have gridlines?" mode.
 *
 * ⚑ And the cells are UNEQUAL, so nothing about the answer can come from
 * assuming a pitch: columns are 1.0 / 2.5 / 0.5 / 2.0 / 3.0 wide and rows
 * 2.0 / 0.5 / 2.5 / 3.0 tall.
 */

interface TruthFigure {
  file: string;
  frame: Record<'x1' | 'x2' | 'y1' | 'y2', { x: number; y: number; value: number }>;
  grid: { x: number[]; y: number[] };
}

const truth = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/colorbars/truth.json', import.meta.url)), 'utf8')
) as { figures: TruthFigure[] };

function scene(file: string): { box: PlotBox; img: ReturnType<typeof readPng>; fig: TruthFigure } {
  const fig = truth.figures.find((f) => f.file === file)!;
  const img = readPng(fileURLToPath(new URL(`./fixtures/colorbars/${file}`, import.meta.url)));
  const cal = new Calibration();
  cal.addPoint(fig.frame.x1.x, fig.frame.x1.y, String(fig.frame.x1.value), '');
  cal.addPoint(fig.frame.x2.x, fig.frame.x2.y, String(fig.frame.x2.value), '');
  cal.addPoint(fig.frame.y1.x, fig.frame.y1.y, '', String(fig.frame.y1.value));
  cal.addPoint(fig.frame.y2.x, fig.frame.y2.y, '', String(fig.frame.y2.value));
  const axes = new XYAxes();
  expect(axes.calibrate(cal, false, false, true)).toBe(true);
  const gx = fig.grid.x;
  const gy = fig.grid.y;
  const last = (a: number[]): number => a[a.length - 1]!;
  const box: PlotBox = [
    axes.dataToPixel(gx[0]!, gy[0]!),
    axes.dataToPixel(last(gx), gy[0]!),
    axes.dataToPixel(gx[0]!, last(gy)),
    axes.dataToPixel(last(gx), last(gy)),
  ];
  return { box, img, fig };
}

/** The figure's true interior boundaries, as positions along the box. */
function truePositions(edges: number[]): number[] {
  const span = edges[edges.length - 1]! - edges[0]!;
  return edges.slice(1, -1).map((v) => (v - edges[0]!) / span);
}

describe('detecting a heatmap’s cell boundaries on real renders', () => {
  it('finds every boundary, and only those, on a cleanly encoded figure', () => {
    for (const file of ['heatmap-viridis.png', 'heatmap-jet.png']) {
      const { box, img, fig } = scene(file);
      for (const axis of ['x', 'y'] as const) {
        const expected = truePositions(axis === 'x' ? fig.grid.x : fig.grid.y);
        const found = detectDividers(img.data, img.width, img.height, box, axis)
          .candidates.map((c) => c.position)
          .sort((a, b) => a - b);
        expect(found, `${file} ${axis}`).toHaveLength(expected.length);
        expected.forEach((want, i) => {
          // Within 0.005 of the box - about 1.5px on a 550px plot, i.e. the
          // width of the anti-aliased step itself.
          expect(found[i], `${file} ${axis} boundary ${i}`).toBeCloseTo(want, 2);
        });
      }
    }
  });

  it('does not propose the plot box’s own edges', () => {
    // ⚑ The step from the paper to the first cell is the LARGEST change in the
    // whole profile - 222 RGB units on this figure, three times any real
    // boundary. Proposing it would hand the user two dividers sitting on the
    // edges they had just placed themselves.
    const { box, img } = scene('heatmap-viridis.png');
    const { profile, candidates } = detectDividers(img.data, img.width, img.height, box, 'x');
    expect(Math.max(...profile)).toBeGreaterThan(200);
    expect(Math.max(...candidates.map((c) => c.strength))).toBeLessThan(100);
    expect(candidates.every((c) => c.position > 0.02 && c.position < 0.98)).toBe(true);
  });

  it('keeps the true boundaries at the TOP of the ranking on a degraded figure', () => {
    // ⚑ Quality-35 JPEG adds spurious peaks - of course it does, and the module
    // reports them rather than hiding them. What has to hold is that the real
    // boundaries are the STRONGEST, because that is what makes the ranking
    // usable as a proposal and the strength worth showing.
    const { box, img, fig } = scene('heatmap-jet-jpeg.png');
    for (const axis of ['x', 'y'] as const) {
      const expected = truePositions(axis === 'x' ? fig.grid.x : fig.grid.y);
      const { candidates } = detectDividers(img.data, img.width, img.height, box, axis);
      // ⚑ At LEAST the real ones - never fewer. An earlier version demanded
      // strictly more, on the grounds that JPEG always adds spurious peaks; then
      // widening the merge window from 5px to 8px (for the drawn rules in the
      // bundled IC50 example) absorbed the spurious ones on this figure's x axis
      // and the test failed for an IMPROVEMENT. The claim worth making is that
      // the true boundaries rank at the top, which holds either way.
      expect(candidates.length).toBeGreaterThanOrEqual(expected.length);
      const top = candidates
        .slice(0, expected.length)
        .map((c) => c.position)
        .sort((a, b) => a - b);
      expected.forEach((want, i) => {
        // ⚑ A looser tolerance than the clean figures get, and it is a
        // measurement rather than a concession: JPEG smears the step over
        // several pixels, and the worst boundary here lands 0.0067 of the box
        // away from the truth - about 1.8px. The clean renders keep the 1.5px
        // bound above; saying so is the point, since a user reading a degraded
        // figure should expect their dividers to need a nudge.
        expect(Math.abs(top[i]! - want), `${axis} boundary ${i}`).toBeLessThan(0.008);
      });
    }
  });

  it('turns a declared cell count into exactly the right grid', () => {
    // ⚑ THE COUNT AS A CHECK, NOT A TARGET. The user says "five columns"; the
    // detector has already found what it found; the count picks the five
    // strongest and says whether that agrees. Nothing widens a threshold to make
    // the number come out right.
    const { box, img, fig } = scene('heatmap-jet-jpeg.png');
    const { candidates } = detectDividers(img.data, img.width, img.height, box, 'x');
    const grid = proposeDividers(candidates, fig.grid.x.length - 1)!;
    expect(grid).toHaveLength(fig.grid.x.length);
    expect(grid[0]).toBe(0);
    expect(grid[grid.length - 1]).toBe(1);
    truePositions(fig.grid.x).forEach((want, i) => {
      expect(grid[i + 1]).toBeCloseTo(want, 2);
    });
  });

  it('reports a MISS rather than inventing a boundary', () => {
    // Asked for more cells than there is evidence for, the answer is "I could
    // not find them", not a grid with plausible spacing. A grid missing a
    // boundary looks exactly like a grid.
    const { box, img } = scene('heatmap-viridis.png');
    const { candidates } = detectDividers(img.data, img.width, img.height, box, 'x');
    const report = reconcileWithCount(candidates, 8);
    expect(report.agrees).toBe(false);
    expect(report.found).toBe(4);
    expect(report.expected).toBe(7);
    expect(report.missing).toBe(3);
    expect(proposeDividers(candidates, 8)).toBeNull();
    // …and the count it does agree with is the figure's own.
    expect(reconcileWithCount(candidates, 5).agrees).toBe(true);
  });
});
