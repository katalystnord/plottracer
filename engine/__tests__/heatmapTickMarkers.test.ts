import { describe, expect, it } from 'vitest';
import { categoryAxisGlyphs, categoryTickMarkers } from '../categoryTickOverlay.js';
import { heatmapAxisOverlays, readHeatmapCells, NO_HEATMAP_LABELS } from '../heatmapRun.js';
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


/** One cell, read from a synthetic ramp — enough to see what the row carries. */
function readOneCell() {
  const width = 40;
  const height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const t = (i % width) / (width - 1);
    data[i * 4] = Math.round(255 * t);
    data[i * 4 + 1] = 0;
    data[i * 4 + 2] = Math.round(255 * (1 - t));
    data[i * 4 + 3] = 255;
  }
  const proj = { dataToPixel: (x: number, y: number) => ({ x: x * 10, y: y * 10 }) };
  const scale = {
    strip: { from: { x: 0, y: 15 }, to: { x: 39, y: 15 }, thickness: 3,
      samples: Array.from({ length: 40 }, (_, i) => ({
        t: i / 39,
        rgb: [Math.round(255 * (i / 39)), 0, Math.round(255 * (1 - i / 39))] as [number, number, number],
      })) },
    ticks: [
      { point: { x: 0, y: 15 }, value: 0 },
      { point: { x: 39, y: 15 }, value: 100 },
    ] as const,
    log: false,
  };
  const { rows } = readHeatmapCells(
    { data, width, height },
    proj,
    { xDividers: [0, 1], yDividers: [0, 1] },
    scale as never,
    NO_HEATMAP_LABELS,
    { x: 'value', y: 'value' }
  );
  return rows[0]!;
}

describe('B16 — a cell says WHICH INSTRUMENT read it', () => {
  /**
   * ⚑⚑ David: *"if there is a printed number in a cell, the printed number is
   * the preferred number. But we must still be able to edit it... And perhaps
   * that needs a right click popup selection menu on each cell? Select, use OCR
   * number, or Use number based on key calibration."*
   *
   * All three are MEASUREMENTS and they fail in opposite ways — OCR reads ink as
   * glyphs and fails discretely; the colour reads ink as a ramp and fails
   * continuously and silently; the user sees what both machines are blind to.
   * A consumer treating an OCR'd 59 and a colour-inverted 58.7 as the same kind
   * of number is wrong about both, which is why the source belongs in the row.
   *
   * ⚑ This is NOT the declared-vs-measured flag David rejected. Nothing here is
   * invented; it records WHICH measurement.
   */
  it('reports a colour reading as coming from the colour, with the colour', () => {
    const s = readOneCell();
    expect(s.source).toBe('colour');
    expect(s.rgb).toHaveLength(3);
  });

  it('keeps the sampled colour, so the table can mirror the figure', () => {
    // ⚑ The indicator IS the evidence — the matrix is tinted with what was
    // sampled, so a shadowed column shows as a darker band in the table beside
    // numbers that look perfectly reasonable.
    const s = readOneCell();
    expect(s.rgb!.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)).toBe(true);
  });
});
