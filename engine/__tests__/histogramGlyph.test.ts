import { describe, it, expect } from 'vitest';
import { computeBinGlyph } from '../histogramGlyph.js';

/**
 * The bin staple — what makes a captured histogram bin *look* like a bin.
 *
 * ⚑ WHY THIS FILE EXISTS. The 2026-07-31 full mutation run scored
 * `engine/histogramGlyph.ts` at **0.00%**: 13 mutants, every one of them
 * NO-COVERAGE. Not one test in the tree called this function. Its whole body
 * could be replaced with `return []` and the entire suite would still pass —
 * a captured histogram would render as two unrelated numbered dots, which is
 * the exact defect the module was written to fix (found by driving the real
 * app at checkpoint 66, per its own header).
 *
 * Its sibling `engine/boxPlotGlyph.ts` scores 100%. This is the same kind of
 * pure pixel geometry with the same testability; it had simply never been
 * asked.
 *
 * What the glyph must be, and why each part is asserted below:
 *  - a SPAN between the two captured corners — the interval, which is the
 *    whole point of capturing a histogram rather than a scatter;
 *  - a short tick DROPPING at each edge, so an edge reads as an edge;
 *  - and NOT a rectangle down to a baseline, because the bar's foot was never
 *    captured (tenets 9/10: the drawing may not assert what the data doesn't
 *    say).
 */

/** The constant the module keeps private; pinned here so a silent change to
 * it fails loudly rather than quietly restyling every bin. */
const EDGE_TICK = 12;

describe('computeBinGlyph — the staple', () => {
  const a = { x: 100, y: 40 };
  const b = { x: 160, y: 40 };

  it('draws exactly three segments: the span, then one tick per edge', () => {
    // ⚑ Kills the "return []" / empty-array mutants outright: a glyph that
    // draws nothing is precisely the pre-checkpoint-66 bug.
    expect(computeBinGlyph(a, b)).toHaveLength(3);
  });

  it('spans corner to corner as given, so the captured interval is visible', () => {
    const [span] = computeBinGlyph(a, b);
    expect(span).toEqual({ from: { x: 100, y: 40 }, to: { x: 160, y: 40 } });
  });

  it('drops a tick DOWNWARD from each corner, at that corner s own x', () => {
    // ⚑ The two `+ EDGE_TICK` arithmetic mutants (to `-`) both survived
    // uncaught; asserting the exact y — and that it is BELOW the corner in
    // image coordinates, where y grows downward — is what rules them out. A
    // tick drawn upward would sit in the plot area rather than under the bar.
    const [, leftTick, rightTick] = computeBinGlyph(a, b);
    expect(leftTick).toEqual({ from: { x: 100, y: 40 }, to: { x: 100, y: 40 + EDGE_TICK } });
    expect(rightTick).toEqual({ from: { x: 160, y: 40 }, to: { x: 160, y: 40 + EDGE_TICK } });
    expect(leftTick!.to.y).toBeGreaterThan(leftTick!.from.y);
    expect(rightTick!.to.y).toBeGreaterThan(rightTick!.from.y);
  });

  it('anchors each tick to its OWN corner, never both to the same one', () => {
    // The object-literal mutants let a tick be rebuilt from the wrong corner;
    // distinct x's on the two ticks is what separates that from correct.
    const [, leftTick, rightTick] = computeBinGlyph(a, b);
    expect(leftTick!.from.x).toBe(a.x);
    expect(rightTick!.from.x).toBe(b.x);
    expect(leftTick!.from.x).not.toBe(rightTick!.from.x);
  });

  it('takes the corners in CLICK order without normalising them', () => {
    // Documented behaviour: "a line is symmetric and the ordering only matters
    // to the bin math". So a right-then-left capture draws the same staple
    // with the span reversed — the ordering is the bin math's business
    // (algorithms/histogram.ts sorts by x), not the drawing's.
    const reversed = computeBinGlyph(b, a);
    expect(reversed[0]).toEqual({ from: { x: 160, y: 40 }, to: { x: 100, y: 40 } });
    expect(reversed[1]!.from.x).toBe(160);
    expect(reversed[2]!.from.x).toBe(100);
  });

  it('handles corners at different heights, ticking from each corner s own y', () => {
    // A hand-clicked bar top rarely lands at exactly equal y. The staple must
    // follow what was actually clicked rather than levelling the two — the
    // averaging into a single bin height is the BIN MATH's decision
    // (binFromCorners), and the drawing must not pre-empt it.
    const [span, leftTick, rightTick] = computeBinGlyph({ x: 10, y: 50 }, { x: 20, y: 54 });
    expect(span).toEqual({ from: { x: 10, y: 50 }, to: { x: 20, y: 54 } });
    expect(leftTick!.to.y).toBe(50 + EDGE_TICK);
    expect(rightTick!.to.y).toBe(54 + EDGE_TICK);
  });

  it('still returns a well-formed staple for a zero-width bin', () => {
    const segments = computeBinGlyph({ x: 77, y: 5 }, { x: 77, y: 5 });
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ from: { x: 77, y: 5 }, to: { x: 77, y: 5 } });
    expect(segments[1]!.to.y).toBe(5 + EDGE_TICK);
  });

  it('never draws a closing baseline — three segments, none joining the two ticks feet', () => {
    // ⚑ The module's own stated refusal, asserted so it cannot be "improved"
    // into a rectangle by someone who thinks a bin should look closed. The
    // bar's foot is a DERIVED guess (the axis may be cropped or offset), so
    // drawing it would assert something the capture never measured.
    const segments = computeBinGlyph(a, b);
    const footY = 40 + EDGE_TICK;
    const joinsTheFeet = segments.some(
      (s) => s.from.y === footY && s.to.y === footY && s.from.x !== s.to.x
    );
    expect(joinsTheFeet).toBe(false);
  });
});
