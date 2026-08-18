import { describe, expect, it } from 'vitest';
import { BandedAxis,
  bandIndexIn,
  bandIndexForParam,
  paramOfSpan,
  valueOfSpan,
  pointAtParam,
  paramAtPoint,
} from '../bandedAxis.js';

/**
 * A BANDED AXIS - the band mechanism, with no idea what the axis means (v2.2).
 *
 * ⚑⚑ WHY THIS FILE EXISTS. `core/categoryAxis.ts` is TWO things fused: a banded
 * axis (edges, convention, declared count, generated ticks in PARAMETER space,
 * one adjustment flag) and a shared NAME LIST that a bar chart's datasets bind
 * to. The settled heatmap design said v2.1's category ticks were the structural
 * foundation; the build read the memo's *"NOT `core/categoryAxis.ts` - a heatmap
 * has two independent axes, binding it there would make one axis rename the
 * other"* as covering the whole class. That is right about the NAME LIST and
 * wrong about the BAND MECHANISM, and the over-application is what produced a
 * second divider store, a second set of marker graphics and a second count box.
 *
 * So the halves come apart: this class is the band mechanism, `CategoryAxis`
 * composes it plus the names, and a heatmap's x, y (and, in shape, colour) axis
 * each own one. Nothing here knows whether it is horizontal, vertical, or a
 * colour key.
 *
 * ⚑ PARAMETER SPACE IS THE POINT - 0 at the first edge, 1 at the second. It is
 * what makes "if the axis moves, the dividers move with it" true by
 * construction rather than by a synchronisation pass, and it is exactly what
 * absolute data coordinates could not express (see the C2 case below).
 */

/** An axis running left to right across 400 image pixels, 4 bands declared. */
function axis(convention: 'centred' | 'edge' = 'edge', count = 4): BandedAxis {
  const a = new BandedAxis();
  a.setConvention(convention);
  a.setEdges({ x: 100, y: 500 }, { x: 500, y: 500 });
  a.setCount(count);
  return a;
}

describe('a banded axis needs no names', () => {
  it('divides an axis that has no name list at all', () => {
    // ⚑⚑ THE CASE THE OLD SHAPE COULD NOT STATE. In `CategoryAxis` the band
    // count IS `_categories.length`, so an axis with no names has no bands. A
    // heatmap's value axis has no names and still has columns.
    const a = axis('edge', 4);
    expect(a.getDividerParams()).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(a.getDividerPoints().map((p) => p.x)).toEqual([100, 200, 300, 400, 500]);
  });

  it('puts the SAME dividers on the figure from either convention', () => {
    // The two conventions differ in what the user CLICKS, never in the bands
    // that result - the invariant v2.1 established, restated here because this
    // class is now where it lives.
    const edges = axis('edge', 4).getDividerParams();
    const centred = axis('centred', 4).getDividerParams();
    expect(centred).toEqual(edges);
  });
});

describe('C2 - the axis moves and the dividers move with it', () => {
  it('keeps every divider in proportion when the edges are MOVED', () => {
    // ⚑⚑ David: *"The tick dividers are dependent on the axis end points. If the
    // axis moves, they do too."* Two layers: the calibration is the axis and is
    // edited only through its own markers; the grid derives from it. In
    // parameter space that is free - but only if moving the edges does NOT
    // regenerate.
    const a = axis('edge', 4);
    a.moveTick(1, { x: 260, y: 500 }); // drag the middle divider off-centre
    const before = [...a.getTickParams()];
    expect(a.hasAdjustments()).toBe(true);

    // The calibration marker is dragged: same direction, twice the span.
    expect(a.moveEdges({ x: 100, y: 500 }, { x: 900, y: 500 })).toBe(true);

    // Parameters untouched; pixels follow the axis.
    expect(a.getTickParams()).toEqual(before);
    expect(a.hasAdjustments()).toBe(true);
    // Dividers at params [0, 0.25, 0.4, 0.75, 1] over the new 800px span: the
    // dragged one keeps its 0.4, so it stays 40% along the axis it belongs to.
    expect(a.getDividerPoints().map((p) => p.x)).toEqual([100, 300, 420, 700, 900]);
  });

  it('REFUSES to move the edges onto a degenerate axis', () => {
    // The `calibrate()`-that-cannot-fail shape, at this class's other door:
    // coincident edges make every parameter NaN while the move reports success.
    const a = axis();
    expect(a.moveEdges({ x: 100, y: 500 }, { x: 100, y: 500 })).toBe(false);
    expect(a.getDividerPoints().map((p) => p.x)).toEqual([100, 200, 300, 400, 500]);
  });

  it('distinguishes PLACING the edges from MOVING them', () => {
    // Placing is bar's gesture - the axis is being defined, so the ticks are
    // generated fresh. Moving is the heatmap's - the axis already exists and is
    // being corrected, so adjustments survive. Same state, two verbs.
    const a = axis('edge', 4);
    a.moveTick(1, { x: 260, y: 500 });
    expect(a.hasAdjustments()).toBe(true);

    a.setEdges({ x: 100, y: 500 }, { x: 900, y: 500 });
    expect(a.hasAdjustments()).toBe(false);
    expect(a.getTickParams()).toEqual([0.25, 0.5, 0.75]);
  });
});

describe('C3/C4 - what a regeneration costs, and saying so first', () => {
  it('reports adjustments so the caller can warn BEFORE discarding them', () => {
    const a = axis('edge', 4);
    expect(a.hasAdjustments()).toBe(false);
    a.moveTick(1, { x: 260, y: 500 });
    expect(a.hasAdjustments()).toBe(true);
  });

  it('discards adjustments on a COUNT change', () => {
    const a = axis('edge', 4);
    a.moveTick(1, { x: 260, y: 500 });
    a.setCount(5);
    expect(a.hasAdjustments()).toBe(false);
    expect(a.getTickParams()).toEqual([0.2, 0.4, 0.6, 0.8]);
  });

  it('discards adjustments on a CONVENTION change', () => {
    const a = axis('edge', 4);
    a.moveTick(1, { x: 260, y: 500 });
    a.setConvention('centred');
    expect(a.hasAdjustments()).toBe(false);
  });

  it('refuses a count that is not a positive whole number', () => {
    const a = axis();
    for (const bad of [0, -1, 2.5, NaN, Infinity]) {
      expect(a.setCount(bad)).toBe(false);
    }
    expect(a.getCount()).toBe(4);
  });
});

describe('a divider is dragged the same way whatever the axis means', () => {
  it('clamps a dragged divider strictly between its neighbours', () => {
    const a = axis('edge', 4);
    // Dragged far past the last divider: it stops short of it, never crosses.
    expect(a.moveTick(0, { x: 9000, y: 500 })).toBe(true);
    const params = a.getTickParams();
    expect(params[0]!).toBeLessThan(params[1]!);
    expect(params[0]!).toBeGreaterThan(0);
  });

  it('answers which band a point falls in', () => {
    const a = axis('edge', 4);
    expect(a.bandIndexAt({ x: 150, y: 500 })).toBe(0);
    expect(a.bandIndexAt({ x: 450, y: 500 })).toBe(3);
    // Outside the span still belongs to the nearest band - a cell drawn a pixel
    // past the plot box is not a category the figure does not have.
    expect(a.bandIndexAt({ x: 50, y: 500 })).toBe(0);
    expect(a.bandIndexAt({ x: 900, y: 500 })).toBe(3);
  });
});

/**
 * ⚑⚑ ONE ALGORITHM, THREE IMPLEMENTATIONS, TWO POLICIES - found by the v2.2
 * audit's reuse pass, grepping for the LOOP rather than for a name.
 *
 *   core/bandedAxis.ts   bandIndexForParam   CLAMPS   (documented)
 *   core/heatmapGrid.ts  bandOf              REFUSES  (documented)
 *   engine/barDetectRun.ts (inline)          CLAMPS   (undocumented)
 *
 * ⚑ The first two DISAGREE ON PURPOSE and both say so: a bar just past the last
 * divider still belongs to the category a reader would name, while a point
 * outside a matrix has no row at all and inventing one would put a value in a
 * cell the figure does not have. That difference is real and stays.
 *
 * ⚠️ THE THIRD SITE NEVER STATED A CHOICE, and its clamp is exactly why a legend
 * swatch lands in "Category 4" instead of being reported as unplaceable. So the
 * fix is not to pick one policy - it is to make every site NAME the one it wants,
 * which turns an accident of which copy was reached for into a decision someone
 * had to make.
 */
describe('bandIndexIn - the one band lookup, with its out-of-range policy named', () => {
  const dividers = [0, 10, 20, 30];

  it('finds the band a value falls in, under either policy', () => {
    for (const outside of ['clamp', 'refuse'] as const) {
      expect(bandIndexIn(dividers, 0, outside)).toBe(0);
      expect(bandIndexIn(dividers, 9.9, outside)).toBe(0);
      expect(bandIndexIn(dividers, 10, outside)).toBe(1);
      expect(bandIndexIn(dividers, 25, outside)).toBe(2);
    }
  });

  it('includes the far edge in the LAST band, so the end of the grid is not a gap', () => {
    expect(bandIndexIn(dividers, 30, 'refuse')).toBe(2);
    expect(bandIndexIn(dividers, 30, 'clamp')).toBe(2);
  });

  it('CLAMPS or REFUSES outside, and that is the only difference between them', () => {
    expect(bandIndexIn(dividers, -5, 'clamp')).toBe(0);
    expect(bandIndexIn(dividers, 99, 'clamp')).toBe(2);
    expect(bandIndexIn(dividers, -5, 'refuse')).toBeNull();
    expect(bandIndexIn(dividers, 99, 'refuse')).toBeNull();
  });

  it('refuses a non-finite value and a list that bounds no band, whichever policy', () => {
    for (const outside of ['clamp', 'refuse'] as const) {
      expect(bandIndexIn(dividers, Number.NaN, outside)).toBeNull();
      expect(bandIndexIn([5], 5, outside)).toBeNull();
      expect(bandIndexIn([], 0, outside)).toBeNull();
    }
  });

  it('⚑ is what bandIndexForParam now IS - the wrapper cannot drift from it', () => {
    // Asserted against the delegate rather than restated: the reason three copies
    // existed is that each was written out longhand, so each could be edited
    // alone. A wrapper that computes nothing cannot.
    for (const t of [-0.5, 0, 0.25, 0.5, 1, 1.5, Number.NaN]) {
      expect(bandIndexForParam(t, [0, 0.5, 1])).toBe(bandIndexIn([0, 0.5, 1], t, 'clamp'));
    }
  });
});

/**
 * ⚑⚑ A3 - THE SCALAR CORE, shared rather than expressed twice.
 *
 * The v2.2 audit found "0 at one end, 1 at the other" written in two places:
 * `paramAtPoint`/`pointAtParam` here, in 2-D image space, and
 * `gridParamsFrom`/`dividersFromParams` in `core/heatmapGrid.ts`, in 1-D data
 * space. They are not two ideas - the 1-D case IS the 2-D case with the
 * perpendicular component absent - but nothing said so and nothing enforced it.
 *
 * ⚑ David chose to EXTRACT rather than to document (option C): a reason living
 * only in a comment is exactly what produced this release's worst defect.
 */
describe('paramOfSpan / valueOfSpan - the affine core both frames now share', () => {
  it('maps a value to its position along a span, and back', () => {
    expect(paramOfSpan(25, 0, 100)).toBe(0.25);
    expect(valueOfSpan(0.25, 0, 100)).toBe(25);
  });

  it('handles a span that runs BACKWARDS, which plenty of axes do', () => {
    expect(paramOfSpan(75, 100, 0)).toBe(0.25);
    expect(valueOfSpan(0.25, 100, 0)).toBe(75);
  });

  it('does not clamp - past an end is a real position, not an error', () => {
    // The `centred` tick convention puts the outermost boundaries half a band
    // BEYOND the calibration points, so negative parameters are ordinary.
    expect(paramOfSpan(-10, 0, 100)).toBe(-0.1);
    expect(valueOfSpan(1.5, 0, 100)).toBe(150);
  });

  it('is NaN for a span of nothing, rather than dividing to Infinity', () => {
    // ⚑ The same degeneracy `paramAtPoint` guards, and for the reason recorded
    // there: a span that underflows to zero divides to ±Infinity, which sails
    // through any caller that only checks for NaN.
    expect(paramOfSpan(5, 7, 7)).toBeNaN();
  });

  it('⚑⚑ AGREES WITH paramAtPoint FOR A POINT ON THE AXIS - the claim, enforced', () => {
    // This is what replaces the comment. `paramAtPoint` is a PROJECTION and
    // cannot compose from the scalar core (it must also handle points OFF the
    // line) - so instead of asserting they share code, assert they share
    // ANSWERS wherever both are defined. A divergence in either now fails here.
    const edges = [{ x: 10, y: 20 }, { x: 110, y: 220 }] as const;
    for (const t of [-0.3, 0, 0.25, 0.5, 1, 1.4]) {
      const on = pointAtParam(edges, t);
      expect(paramAtPoint(edges, on)).toBeCloseTo(paramOfSpan(on.x, edges[0].x, edges[1].x), 10);
      expect(paramAtPoint(edges, on)).toBeCloseTo(t, 10);
    }
  });

  it('⚑ pointAtParam IS valueOfSpan per component - asserted, not restated', () => {
    const edges = [{ x: 10, y: 20 }, { x: 110, y: 220 }] as const;
    for (const t of [0, 0.5, 1, 2]) {
      expect(pointAtParam(edges, t)).toEqual({
        x: valueOfSpan(t, edges[0].x, edges[1].x),
        y: valueOfSpan(t, edges[0].y, edges[1].y),
      });
    }
  });
});
