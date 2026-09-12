import { describe, expect, it } from 'vitest';
import {
  CalibrationSession,
  STACKED_AXES_CONFIG,
  type CalibratedAxes,
} from '../calibrationSession.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * ⚑⚑⚑ STACKED BAR CHARTS - the agreed model, as cases, before the config exists.
 *
 * David, 2026-09-12, after driving a stacked figure and finding that typing 7
 * into a segment's `Value` recorded 5.02: *"we need to take a whole step back,
 * and actively make stacked bar charts its own major chart type, with its own
 * set of rules, where boundaries are connected. I.e. you cannot change one
 * without the other."*
 *
 * THE MODEL, in his words and settled with him:
 *
 * - Calibration is **identical to Bar**. Nothing new.
 * - Capture is the **same drag-box**, both corners, because the box is what
 *   measures the bar's WIDTH along the category axis.
 * - **Series 1's base IS the baseline.** Not measured, not optional. A column
 *   whose lowest segment does not reach the baseline is not a stacked bar chart;
 *   it is a floating stacked bar chart, which is a different type we have not
 *   built and which does not get an option on this one.
 * - **Series k's base IS series k-1's top.** One number, two owners - so it
 *   cannot drift and cannot be edited into disagreement. That is the LINK.
 * - The order of the chain is **read from the pixels**, outward from the
 *   baseline, so a negative stack needs no rule of its own.
 * - The reported value is the segment's **height**, DERIVED. That is the major
 *   differentiator from a Bar, whose datum is a position on the axis. A stacked
 *   chart's datum is a magnitude; the absolute top is an artefact of what is
 *   stacked underneath it.
 *
 * ⚠️ BUILT AS IF IT HAD ALWAYS BEEN HERE. David: *"build it like it was new and
 * correct from the beginning. Otherwise we will have baggage for no reason at
 * all."* There is no migration from Bar's `isStacked`, no relabel on load and no
 * notice: that option simply ceases to exist.
 *
 * ⚑ WHY THE OLD MODEL WAS WRONG, measured on David's own figure: each shared
 * edge was captured twice, once as the lower segment's top and once as the upper
 * segment's base, and the two copies disagreed by 0.08, 0.08 and 0.03. The
 * figure drew that edge once. A record carrying two numbers for it cannot state
 * that the segments touch, so a generator handed it draws a stack with a
 * hairline gap the original never had.
 */

/** A calibrated Stacked session: 0 at y=500, 10 at y=100, so 40px == 1 unit. */
function stackedSession(): CalibrationSession<CalibratedAxes> {
  const s = new CalibrationSession(STACKED_AXES_CONFIG);
  s.handleCalibrationClick(300, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(300, 100);
  s.confirmCalibrationValues(['10']);
  walkCategoryAxis(s);
  expect(s.runCalibration(), s.getCalibrationError() ?? 'no error').toBe(true);
  return s as unknown as CalibrationSession<CalibratedAxes>;
}

const yFor = (value: number) => 500 - value * 40;

/** Capture one segment as the drag-box the walk asks for: bottom then top. */
function captureSegment(
  s: CalibrationSession<CalibratedAxes>,
  x: number,
  fromValue: number,
  toValue: number
): void {
  const any = s as unknown as { addDataPoint(x: number, y: number): unknown };
  any.addDataPoint(x, yFor(fromValue));
  any.addDataPoint(x, yFor(toValue));
}

/** The heights this series reports, one per captured category.
 *  ⚑ Column 1: the panel reports `Base` and `Value`, because a generator wants
 *  `bar(x, height, bottom)` and needs both. Base is DERIVED from the chain. */
function heights(s: CalibrationSession<CalibratedAxes>, seriesIndex: number): (number | null)[] {
  const any = s as unknown as {
    getTupleRows(i?: number): { cells: (number | null)[] }[];
  };
  return any.getTupleRows(seriesIndex).map((r) => r.cells[1] ?? null);
}

describe('a stacked column is a chain from the baseline', () => {
  it('⚑⚑ two segments: the lower one is measured from the BASELINE', () => {
    const s = stackedSession();
    captureSegment(s, 150, 0, 2); // series 1, sitting on the baseline
    expect(heights(s, 0)[0]).toBeCloseTo(2, 6);
  });

  it('⚑⚑ the upper segment is measured from the one BELOW, not from its own box', () => {
    const s = stackedSession();
    captureSegment(s, 150, 0, 2);
    (s as unknown as { addDataset(n: string): unknown }).addDataset('upper');
    // ⚠️ Dragged sloppily: the user starts 0.1 above the true edge, which is
    // ordinary hand accuracy. The height must still be 3, because the base is
    // the segment below's top and NOT this box's own bottom corner.
    captureSegment(s, 150, 2.1, 5);
    expect(heights(s, 1)[0]).toBeCloseTo(3, 6);
  });

  it('⚑ three segments chain, each from the one beneath it', () => {
    const s = stackedSession();
    const add = (n: string) => (s as unknown as { addDataset(x: string): unknown }).addDataset(n);
    captureSegment(s, 150, 0, 2);
    add('middle');
    captureSegment(s, 150, 2, 5);
    add('top');
    captureSegment(s, 150, 5, 9);
    expect(heights(s, 0)[0]).toBeCloseTo(2, 6);
    expect(heights(s, 1)[0]).toBeCloseTo(3, 6);
    expect(heights(s, 2)[0]).toBeCloseTo(4, 6);
  });

  it('⚑⚑ a negative segment stacks DOWNWARD from the baseline, by the same rule', () => {
    const s = stackedSession();
    captureSegment(s, 150, 0, -2);
    (s as unknown as { addDataset(n: string): unknown }).addDataset('lower still');
    captureSegment(s, 150, -2, -5);
    // Magnitude is the height; the sign says which side of the origin it was
    // drawn on, which is what lets a generator redraw it.
    expect(heights(s, 0)[0]).toBeCloseTo(-2, 6);
    expect(heights(s, 1)[0]).toBeCloseTo(-3, 6);
  });

  it('⚑ a category a series did not draw is skipped, and the one above chains past it', () => {
    const s = stackedSession();
    const add = (n: string) => (s as unknown as { addDataset(x: string): unknown }).addDataset(n);
    // Category A gets all three; category B's middle series drew nothing.
    captureSegment(s, 150, 0, 2);
    captureSegment(s, 250, 0, 3);
    add('middle');
    captureSegment(s, 150, 2, 5);
    add('top');
    captureSegment(s, 150, 5, 9);
    captureSegment(s, 250, 3, 7); // B's top sits straight on B's bottom
    expect(heights(s, 2)[1]).toBeCloseTo(4, 6);
  });

  it('⚑⚑ the drag-box still measures the WIDTH, which is why both corners are taken', () => {
    const s = stackedSession();
    const any = s as unknown as {
      addDataPoint(x: number, y: number): unknown;
      getTupleRows(i?: number): { positionSpan?: readonly [number, number] }[];
    };
    any.addDataPoint(120, yFor(0));
    any.addDataPoint(180, yFor(2));
    expect(any.getTupleRows(0)[0]?.positionSpan, 'the box reports its extent').toBeTruthy();
  });
});

describe('the link: you cannot change one without the other', () => {
  it('⚑⚑ editing a middle height moves the ones above WITHOUT changing their values', () => {
    const s = stackedSession();
    const add = (n: string) => (s as unknown as { addDataset(x: string): unknown }).addDataset(n);
    captureSegment(s, 150, 0, 2);
    add('middle');
    captureSegment(s, 150, 2, 5);
    add('top');
    captureSegment(s, 150, 5, 9);

    // Type 6 into the MIDDLE segment's height. It was 3.
    const any = s as unknown as {
      setStackedHeight(seriesIndex: number, tupleIndex: number, height: number): boolean;
    };
    expect(any.setStackedHeight(1, 0, 6)).toBe(true);

    expect(heights(s, 0)[0], 'the one below is untouched').toBeCloseTo(2, 6);
    expect(heights(s, 1)[0], 'the edited one is what was typed').toBeCloseTo(6, 6);
    expect(heights(s, 2)[0], 'the one above keeps its VALUE').toBeCloseTo(4, 6);
  });

  it('⚑ and the edited number reads back as typed, not as an axis position', () => {
    // The defect this type exists to remove: on a Bar with `isStacked`, typing 7
    // into a segment whose base was 2 recorded 5, because the editor moved the
    // far corner to the absolute 7. A stacked chart's datum is a MAGNITUDE.
    const s = stackedSession();
    captureSegment(s, 150, 0, 2);
    (s as unknown as { addDataset(n: string): unknown }).addDataset('upper');
    captureSegment(s, 150, 2, 5);
    const any = s as unknown as {
      setStackedHeight(seriesIndex: number, tupleIndex: number, height: number): boolean;
    };
    any.setStackedHeight(1, 0, 7);
    expect(heights(s, 1)[0]).toBeCloseTo(7, 6);
  });
});
