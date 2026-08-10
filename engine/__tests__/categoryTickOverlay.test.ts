import { describe, expect, it } from 'vitest';
import {
  CATEGORY_TICK_COLOR,
  CONVENTION_LABELS,
  categoryAxisGlyphs,
  categoryPanelSummary,
  categoryPanelView,
  categoryTickIndexFromId,
  categoryTickMarkers,
  isMarkingCategoryAxis,
  type CategoryPanelInput,
} from '../categoryTickOverlay.js';

/**
 * The category tick OVERLAY and the fold-out's state machine.
 *
 * ⚑ These are the two halves that would otherwise sit in `ui/`, where mutation
 * testing cannot reach them and the only instrument is a 20-minute Electron
 * run. Everything here is about what is DRAWN and what is ASKED — no assertion
 * in this file should ever be about a measured value, because ticks decide none.
 */

const H = [{ x: 100, y: 500 }, { x: 600, y: 500 }] as const; // horizontal, left to right

function panel(over: Partial<CategoryPanelInput> = {}) {
  return categoryPanelView({
    supported: true,
    isCalibrated: true,
    open: true,
    hasGeometry: false,
    seedPixel: null,
    edgesPlaced: 0,
    hasAdjustments: false,
    ...over,
  });
}

describe('the drawn axis', () => {
  it('draws nothing at all until an axis is marked', () => {
    expect(categoryAxisGlyphs({ edges: null, tickPoints: [] })).toEqual([]);
    expect(categoryTickMarkers({ edges: null, tickPoints: [{ x: 1, y: 2 }] })).toEqual([]);
  });

  it('draws the axis, its two ends, and one mark per tick', () => {
    const runs = categoryAxisGlyphs({ edges: H, tickPoints: [{ x: 225, y: 500 }, { x: 475, y: 500 }] });
    expect(runs).toHaveLength(1);
    const [axis, endA, endB, t1, t2] = runs[0]!;
    expect(axis).toEqual({ from: { x: 100, y: 500 }, to: { x: 600, y: 500 } });
    // Ends cross the axis; ticks only stand off it.
    expect(endA).toEqual({ from: { x: 100, y: 489 }, to: { x: 100, y: 511 } });
    expect(endB).toEqual({ from: { x: 600, y: 489 }, to: { x: 600, y: 511 } });
    expect(t1).toEqual({ from: { x: 225, y: 500 }, to: { x: 225, y: 514 } });
    expect(t2).toEqual({ from: { x: 475, y: 500 }, to: { x: 475, y: 514 } });
  });

  it('⚑ ticks stand off DOWNWARD on an upright chart — where a figure prints them', () => {
    const tick = categoryAxisGlyphs({ edges: H, tickPoints: [{ x: 300, y: 500 }] })[0]![3]!;
    expect(tick.to.y).toBeGreaterThan(tick.from.y);
    expect(tick.to.x).toBe(tick.from.x);
  });

  it('the marks rotate with the axis rather than staying image-aligned', () => {
    // A horizontal-bars chart: the category axis runs down the left side.
    const vertical = [{ x: 100, y: 100 }, { x: 100, y: 600 }] as const;
    const tick = categoryAxisGlyphs({ edges: vertical, tickPoints: [{ x: 100, y: 300 }] })[0]![3]!;
    expect(tick.to.y).toBe(tick.from.y);
    expect(tick.to.x).toBeLessThan(tick.from.x); // outward, away from the plot
  });

  it('works on a tilted axis, at the right stand-off length', () => {
    const tilted = [{ x: 0, y: 0 }, { x: 300, y: 400 }] as const; // length 500
    const tick = categoryAxisGlyphs({ edges: tilted, tickPoints: [{ x: 150, y: 200 }] })[0]![3]!;
    const dx = tick.to.x - tick.from.x;
    const dy = tick.to.y - tick.from.y;
    expect(Math.hypot(dx, dy)).toBeCloseTo(14, 9);
    // Perpendicular to the axis: the dot product with its direction is zero.
    expect(dx * 300 + dy * 400).toBeCloseTo(0, 6);
  });
});

describe('the drag handles', () => {
  it('gives every tick a draggable handle with a recoverable id', () => {
    const markers = categoryTickMarkers({ edges: H, tickPoints: [{ x: 225, y: 500 }, { x: 475, y: 500 }] });
    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({ id: 'categoryTick0', x: 225, y: 500, draggable: true });
    expect(markers[1]!.id).toBe('categoryTick1');
    expect(markers.every((m) => m.color === CATEGORY_TICK_COLOR)).toBe(true);
  });

  it('⚑ gives the axis EDGES no handle — the destructive gesture must not be the easiest', () => {
    // Every tick is a function of the two edges, so dragging one rescales them
    // all and discards any the user adjusted. Re-placing the axis lives in the
    // fold-out, where it can warn first.
    const markers = categoryTickMarkers({ edges: H, tickPoints: [{ x: 225, y: 500 }] });
    expect(markers.map((m) => m.id)).toEqual(['categoryTick0']);
    expect(markers.some((m) => m.x === 100 || m.x === 600)).toBe(false);
  });

  it('reads a tick index back out of a marker id, and refuses anything else', () => {
    expect(categoryTickIndexFromId('categoryTick0')).toBe(0);
    expect(categoryTickIndexFromId('categoryTick12')).toBe(12);
    expect(categoryTickIndexFromId('x1')).toBeNull();
    expect(categoryTickIndexFromId('categoryTick')).toBeNull();
    expect(categoryTickIndexFromId('categoryTickA')).toBeNull();
    expect(categoryTickIndexFromId('mycategoryTick1')).toBeNull();
  });
});

describe('the fold-out only offers itself when it can do something', () => {
  it('is unavailable on a type with no categories', () => {
    expect(panel({ supported: false }).phase).toBe('unavailable');
  });

  it('⚑ is unavailable until the value axis is calibrated — it never gates it', () => {
    expect(panel({ isCalibrated: false }).phase).toBe('unavailable');
  });

  it('sits closed until the user opens it', () => {
    expect(panel({ open: false }).phase).toBe('closed');
  });

  it('asks for the axis once opened, and for the count once the axis is marked', () => {
    expect(panel().phase).toBe('mark-axis');
    expect(panel({ hasGeometry: true }).phase).toBe('declaring');
  });

  it('a marked axis still reads as closed while the fold-out is shut', () => {
    expect(panel({ open: false, hasGeometry: true }).phase).toBe('closed');
  });
});

describe('what the fold-out asks for', () => {
  it('⚑ asks for ONE click when the value origin can stand in for the first edge', () => {
    const v = panel({ seedPixel: { px: 100, py: 500 } });
    expect(v.canReuseSeed).toBe(true);
    expect(v.prompt).toBe(
      'Click where the categories end. The value origin is already the start — drag it later if that is wrong.'
    );
  });

  it('asks for two when there is no seed to reuse', () => {
    const v = panel({ seedPixel: null });
    expect(v.canReuseSeed).toBe(false);
    expect(v.prompt).toBe('Click where the categories start, then where they end.');
  });

  it('asks for the second once the first is down', () => {
    const v = panel({ seedPixel: null, edgesPlaced: 1 });
    expect(v.prompt).toBe('Now click where the categories end.');
  });

  it('stops offering the seed once an edge has been placed by hand', () => {
    expect(panel({ seedPixel: { px: 1, py: 2 }, edgesPlaced: 1 }).canReuseSeed).toBe(false);
  });

  it('asks nothing once the axis is marked', () => {
    expect(panel({ hasGeometry: true }).prompt).toBeNull();
  });

  it('routes canvas clicks to edge placement only while it is asking for one', () => {
    expect(isMarkingCategoryAxis(panel())).toBe(true);
    expect(isMarkingCategoryAxis(panel({ hasGeometry: true }))).toBe(false);
    expect(isMarkingCategoryAxis(panel({ open: false }))).toBe(false);
    expect(isMarkingCategoryAxis(panel({ supported: false }))).toBe(false);
  });
});

describe('the regenerate warning', () => {
  it('⚑ appears only when there is something to lose', () => {
    // A warning shown when nothing would be discarded teaches people to dismiss
    // warnings, which is worse than not warning at all.
    expect(panel({ hasGeometry: true, hasAdjustments: false }).regenerateWarning).toBeNull();
    expect(panel({ hasGeometry: true, hasAdjustments: true }).regenerateWarning).toBe(
      'Changing the count or the tick style rebuilds the ticks evenly, discarding the ones you moved.'
    );
  });

  it('is not raised before there is any geometry to rebuild', () => {
    expect(panel({ hasGeometry: false, hasAdjustments: true }).regenerateWarning).toBeNull();
  });
});

describe('the words on screen', () => {
  it('the summary invites the user in, then reports what is declared', () => {
    expect(categoryPanelSummary(false, 0)).toBe('Mark category ticks?');
    expect(categoryPanelSummary(true, 1)).toBe('Category ticks — 1 category');
    expect(categoryPanelSummary(true, 5)).toBe('Category ticks — 5 categories');
  });

  it('names both conventions in the figure’s terms, not ours', () => {
    expect(CONVENTION_LABELS.centred).toBe('Under each category');
    expect(CONVENTION_LABELS.edge).toBe('Between categories');
  });
});
