import { describe, expect, it } from 'vitest';
import { categoryAxisGlyphs, categoryTickMarkers } from '../categoryTickOverlay.js';
import { heatmapAxisOverlays } from '../heatmapRun.js';
import type { PixelProjector } from '../../algorithms/heatmapRead.js';

/**
 * ITEM 6 — a heatmap's boundaries are TICK MARKERS, not dots.
 *
 * ⚑⚑ David, twice: *"We still have points and not selectable tick markers that
 * we said that we were going to reuse from bar tick characterisation. We said
 * that we were going to stop inventing new things and REUSE things that we
 * already have."* He was right, and the measurement is stark: the heatmap drew
 * `dividerHandles` — bare marker dots outside the plot — and borrowed only the
 * COLOUR from v2.1's category ticks. No axis line, no end marks, no tick marks.
 * The bar chart has drawn all three since v2.1, from `categoryTickOverlay.ts`.
 *
 * ⚑ WHAT THE REUSE COSTS THE SHARED CODE: two declarations. A bar chart's axis
 * EDGES are frozen and get their own labelled marks; a heatmap's outer
 * boundaries are ORDINARY DIVIDERS that drag like any other (the two-layer
 * model), so it asks for no separate end marks — and it brings its own ids,
 * because `hmx:3` is what its drag handler answers to. Nothing else differs,
 * which is the point.
 */

/** A plot box 100…500 across and 300…100 up, one pixel per unit. */
const axes: PixelProjector = {
  dataToPixel: (x: number, y: number) => ({ x: 100 + x * 40, y: 300 - y * 40 }),
};

const grid = { xDividers: [0, 1, 2, 3], yDividers: [0, 2, 4] };

describe('a heatmap axis becomes the SAME overlay a bar chart draws', () => {
  it('offers every divider as a tick point, with the axis as its edges', () => {
    const { x, y } = heatmapAxisOverlays(grid, axes);
    // Four x boundaries -> four tick points, and the axis spans the outer two.
    expect(x.tickPoints).toHaveLength(4);
    expect(x.edges![0]!.x).toBeCloseTo(100, 6);
    expect(x.edges![1]!.x).toBeCloseTo(220, 6);
    expect(y.tickPoints).toHaveLength(3);
  });

  it('DRAWS the axis and a mark per divider — the thing that was missing', () => {
    const { x } = heatmapAxisOverlays(grid, axes);
    const runs = categoryAxisGlyphs(x);
    expect(runs).toHaveLength(1);
    // One axis line + one tick per divider. No separate END marks: a heatmap's
    // outer boundaries are ordinary dividers and draw their own ticks, so
    // marking them twice would say they are a different kind of thing.
    expect(runs[0]).toHaveLength(1 + x.tickPoints.length);
  });

  it('keeps the ids its drag handler answers to', () => {
    const { x, y } = heatmapAxisOverlays(grid, axes);
    expect(categoryTickMarkers(x).map((m) => m.id)).toEqual(['hmx:0', 'hmx:1', 'hmx:2', 'hmx:3']);
    expect(categoryTickMarkers(y).map((m) => m.id)).toEqual(['hmy:0', 'hmy:1', 'hmy:2']);
  });

  it('makes EVERY divider draggable, outer ones included', () => {
    // ⚑ The two-layer model: the calibration is the axis and is edited through
    // its own markers; the grid derives from it and is adjustable throughout.
    // A bar chart freezes its edges because every tick is a function of them —
    // a heatmap's are not, so the reason does not carry over.
    const { x } = heatmapAxisOverlays(grid, axes);
    expect(categoryTickMarkers(x).every((m) => m.draggable)).toBe(true);
  });

  it('still marks a BAR chart’s two edges, unchanged', () => {
    // The guard on the shared code: the default is what v2.1 shipped.
    const bar = {
      edges: [{ x: 100, y: 300 }, { x: 500, y: 300 }] as const,
      tickPoints: [{ x: 200, y: 300 }, { x: 400, y: 300 }],
    };
    const markers = categoryTickMarkers(bar);
    expect(markers.map((m) => m.id)).toEqual([
      'categoryAxisStart', 'categoryAxisEnd', 'categoryTick0', 'categoryTick1',
    ]);
    expect(markers[0]!.draggable).toBe(false);
    expect(markers[2]!.draggable).toBe(true);
    // …and its glyph run still carries the axis, both end marks and both ticks.
    expect(categoryAxisGlyphs(bar)[0]).toHaveLength(1 + 2 + 2);
  });
});
