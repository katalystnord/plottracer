import { describe, expect, it } from 'vitest';
import { BandedAxis } from '../bandedAxis.js';

/**
 * A BANDED AXIS — the band mechanism, with no idea what the axis means (v2.2).
 *
 * ⚑⚑ WHY THIS FILE EXISTS. `core/categoryAxis.ts` is TWO things fused: a banded
 * axis (edges, convention, declared count, generated ticks in PARAMETER space,
 * one adjustment flag) and a shared NAME LIST that a bar chart's datasets bind
 * to. The settled heatmap design said v2.1's category ticks were the structural
 * foundation; the build read the memo's *"NOT `core/categoryAxis.ts` — a heatmap
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
 * ⚑ PARAMETER SPACE IS THE POINT — 0 at the first edge, 1 at the second. It is
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
    // that result — the invariant v2.1 established, restated here because this
    // class is now where it lives.
    const edges = axis('edge', 4).getDividerParams();
    const centred = axis('centred', 4).getDividerParams();
    expect(centred).toEqual(edges);
  });
});

describe('C2 — the axis moves and the dividers move with it', () => {
  it('keeps every divider in proportion when the edges are MOVED', () => {
    // ⚑⚑ David: *"The tick dividers are dependent on the axis end points. If the
    // axis moves, they do too."* Two layers: the calibration is the axis and is
    // edited only through its own markers; the grid derives from it. In
    // parameter space that is free — but only if moving the edges does NOT
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
    // Placing is bar's gesture — the axis is being defined, so the ticks are
    // generated fresh. Moving is the heatmap's — the axis already exists and is
    // being corrected, so adjustments survive. Same state, two verbs.
    const a = axis('edge', 4);
    a.moveTick(1, { x: 260, y: 500 });
    expect(a.hasAdjustments()).toBe(true);

    a.setEdges({ x: 100, y: 500 }, { x: 900, y: 500 });
    expect(a.hasAdjustments()).toBe(false);
    expect(a.getTickParams()).toEqual([0.25, 0.5, 0.75]);
  });
});

describe('C3/C4 — what a regeneration costs, and saying so first', () => {
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
    // Outside the span still belongs to the nearest band — a cell drawn a pixel
    // past the plot box is not a category the figure does not have.
    expect(a.bandIndexAt({ x: 50, y: 500 })).toBe(0);
    expect(a.bandIndexAt({ x: 900, y: 500 })).toBe(3);
  });
});
