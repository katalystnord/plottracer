import { describe, expect, it } from 'vitest';
import {
  CATEGORY_TICK_COLOR,
  CONVENTION_LABELS,
  categoryAxisGlyphs,
  categoryPanelSummary,
  categoryPanelView,
  categoryTickIndexFromId,
  categoryTickMarkers,
  categoryMarkMessage,
  isMarkingCategoryAxis,
  CATEGORY_PANEL_HINT,
  CATEGORY_TICK_DRAG_HINT,
  type CategoryPanelInput,
} from '../categoryTickOverlay.js';

/**
 * The category tick OVERLAY and the fold-out's state machine.
 *
 * ⚑ These are the two halves that would otherwise sit in `ui/`, where mutation
 * testing cannot reach them and the only instrument is a 20-minute Electron
 * run. Everything here is about what is DRAWN and what is ASKED - no assertion
 * in this file should ever be about a measured value, because ticks decide none.
 */

const H = [{ x: 100, y: 500 }, { x: 600, y: 500 }] as const; // horizontal, left to right

function panel(over: Partial<CategoryPanelInput> = {}) {
  return categoryPanelView({
    supported: true,
    isCalibrated: true,
    open: true,
    hasGeometry: false,
    placeBothEdges: false,
    seedPixel: null,
    seedLabel: 'P1',
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

  it('⚑ ticks stand off DOWNWARD on an upright chart - where a figure prints them', () => {
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
    const ticks = markers.filter((m) => categoryTickIndexFromId(m.id) !== null);
    expect(ticks).toHaveLength(2);
    // ⚑ The handle stands off at the OUTER END of its tick, not on the axis
    // line: it stays bound to the axis by the mark itself, and on a heatmap -
    // where two axes meet at the plot corner - it is what stops an x boundary
    // and a y boundary at the origin landing on the same pixel.
    expect(ticks[0]).toMatchObject({ id: 'categoryTick0', x: 225, y: 514, draggable: true });
    expect(ticks[1]!.id).toBe('categoryTick1');
    expect(markers.every((m) => m.color === CATEGORY_TICK_COLOR)).toBe(true);
  });

  it('⚑ marks the axis ENDS visibly, and names them', () => {
    // Drawn only as glyph segments they were invisible in practice -- the
    // segment channel carries no colour, so they rendered dark straight on the
    // figure's own axis and the marked SPAN could not be seen at all. David
    // spotted it in a screenshot: "I cannot see that you ever set the end".
    const markers = categoryTickMarkers({ edges: H, tickPoints: [{ x: 350, y: 500 }] });
    const start = markers.find((m) => m.id === 'categoryAxisStart');
    const end = markers.find((m) => m.id === 'categoryAxisEnd');
    expect(start).toMatchObject({ x: 100, y: 500, label: 'Categories start' });
    expect(end).toMatchObject({ x: 600, y: 500, label: 'Categories end' });
  });

  it('⚑ but the ends are NOT draggable - visible is not the same as grabbable', () => {
    // Every tick is a function of the two edges, so dragging one rescales them
    // all and discards any the user adjusted. Re-placing the axis lives in the
    // fold-out, where it can warn first.
    const markers = categoryTickMarkers({ edges: H, tickPoints: [{ x: 225, y: 500 }] });
    for (const id of ['categoryAxisStart', 'categoryAxisEnd']) {
      expect(markers.find((m) => m.id === id)!.draggable, id).toBe(false);
    }
    // ...and neither end can be mistaken for a tick by the drag router.
    expect(categoryTickIndexFromId('categoryAxisStart')).toBeNull();
    expect(categoryTickIndexFromId('categoryAxisEnd')).toBeNull();
  });

  it('⚑ does not wear the calibration amber - P1 sits on the very same pixel', () => {
    // Two different kinds of thing in one place must not wear one uniform.
    expect(CATEGORY_TICK_COLOR).not.toBe('#e0a458');
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

  it('⚑ is unavailable until the value axis is calibrated - it never gates it', () => {
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
      'Click where the categories end. P1 (the amber handle) is being reused as the start - press Re-place axis if that is wrong.'
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
      'Changing the count or the tick style, or re-placing the axis, rebuilds the ticks evenly and discards the ones you moved.'
    );
  });

  it('is not raised before there is any geometry to rebuild', () => {
    expect(panel({ hasGeometry: false, hasAdjustments: true }).regenerateWarning).toBeNull();
  });
});

describe('the words on screen', () => {
  it('the summary invites the user in, then reports what is declared', () => {
    expect(categoryPanelSummary(false, 0)).toBe('Mark category ticks?');
    expect(categoryPanelSummary(true, 1)).toBe('Category ticks - 1 category');
    expect(categoryPanelSummary(true, 5)).toBe('Category ticks - 5 categories');
  });

  it('names both conventions in the figure’s terms, not ours', () => {
    expect(CONVENTION_LABELS.centred).toBe('Under each category');
    expect(CONVENTION_LABELS.edge).toBe('Between categories');
  });
});

describe('⚑ a refused mark says why (review #10)', () => {
  it('says nothing when nothing has failed', () => {
    expect(categoryMarkMessage(null)).toBeNull();
  });

  it('names the reason, and what to do instead', () => {
    // The only way marking refuses is a zero-length axis -- the second click
    // landing on the first edge. Without a message the click did nothing, the
    // prompt was unchanged, and the app simply appeared to ignore the user.
    const msg = categoryMarkMessage('too-close');
    expect(msg).toBe(
      'That is the same point as the start of the axis - click where the categories END, further along.'
    );
  });

  it('tells the user what to do, not just what went wrong', () => {
    // The project's own rule for errors: explain the fix, not only the fault.
    expect(categoryMarkMessage('too-close')).toContain('further along');
  });
});


describe('⚑⚑ "Re-place axis" can place BOTH ends - the walk that was unreachable', () => {
  const seed = { px: 100, py: 500 };

  it('reuses P1 by default, which is the one-click offer', () => {
    const v = panel({ seedPixel: seed });
    expect(v.canReuseSeed).toBe(true);
    expect(v.prompt).toContain('P1 (the amber handle) is being reused');
  });

  it('⚑⚑ it names the handle THIS TYPE actually has - a Line has no P1', () => {
    // ⚠️ FOUND BY DRIVING THE BUILT APP, and it is gate 4's exact class: *"a
    // walkthrough test may only click what a prompt on screen tells it to
    // click."* Extending category ticks to categorical Line (v2.3) gave a chart
    // whose seed handle is labelled **V1** a prompt telling the user to look for
    // **P1**. The handle it names is not on the figure.
    //
    // ⚑ The label comes from the type's own seed step, so a thirteenth type
    // cannot inherit somebody else's handle name. `categoryTicks.originStep` was
    // always a NAME rather than a literal for this reason; this is the prompt
    // catching up with it.
    const v = categoryPanelView({
      supported: true,
      isCalibrated: true,
      open: true,
      hasGeometry: false,
      seedPixel: { px: 10, py: 10 },
      seedLabel: 'V1',
      edgesPlaced: 0,
      placeBothEdges: false,
      hasAdjustments: false,
    });
    expect(v.prompt).toContain('V1 (the amber handle) is being reused');
    expect(v.prompt).not.toContain('P1');
  });

  it('⚑ but asks for BOTH ends once the user says so', () => {
    // THE DEFECT (v2.1 audit): `canReuseSeed` was `seedPixel !== null &&
    // edgesPlaced === 0`, and P1 exists the moment the figure is calibrated --
    // so it was permanently true, `edgesPlaced` permanently 0, and both of the
    // prompts below were dead strings no user could ever see. P1's own prompt is
    // "a known bar value (e.g. 0)"; clicking that gridline mid-plot is ordinary
    // calibration and anchored the category axis in the middle of the figure
    // with nothing on screen able to move it.
    const v = panel({ seedPixel: seed, placeBothEdges: true });
    expect(v.canReuseSeed).toBe(false);
    expect(v.prompt).toBe('Click where the categories start, then where they end.');
  });

  it('⚑ and then asks for the second, so the walk is reachable end to end', () => {
    const v = panel({ seedPixel: seed, placeBothEdges: true, edgesPlaced: 1 });
    expect(v.canReuseSeed).toBe(false);
    expect(v.prompt).toBe('Now click where the categories end.');
  });
});


describe('⚑ the two capabilities that were documented only in MANUAL (v2.1 audit)', () => {
  it('the hint names the touching-bars payoff, which is the biggest one', () => {
    // Splitting a merged run at the marked boundaries is the #1 fixable
    // auto-extract limit, and someone staring at exactly that figure had nothing
    // on screen telling them to open the fold-out.
    expect(CATEGORY_PANEL_HINT).toContain('touching same-coloured bars');
  });

  it('the hint still leads with the case most people have', () => {
    // The addition must not bury the ordinary reason under the specialist one.
    expect(CATEGORY_PANEL_HINT.indexOf('more than one series')).toBeLessThan(
      CATEGORY_PANEL_HINT.indexOf('touching same-coloured bars')
    );
  });

  it('⚑ dragging a tick is announced on screen, not only in the manual', () => {
    // The ticks are 4px unlabelled dots; the only previous on-screen trace of
    // this was the warning's "discarding the ones you moved", which is legible
    // only to someone who already knew.
    expect(CATEGORY_TICK_DRAG_HINT).toContain('Drag');
    expect(CATEGORY_TICK_DRAG_HINT.toLowerCase()).toContain('evenly spaced');
  });
});

/**
 * A DIVIDER IS AN AID, NOT A PRECISE REFERENCE - and the drawing has to say so.
 *
 * ⚑⚑ Both a bar chart's category ticks and a heatmap's grid boundaries were
 * marked `kind: 'calibration'`, which renders the CROSSHAIR RETICLE that exists,
 * in its own words, "so an axis handle reads as a precise reference, not a data
 * dot". A boundary you are expected to nudge onto the figure's own rule is the
 * opposite of a precise reference. Drawing them alike made two false claims at
 * once: that a divider adjusted by eye carries a calibration point's authority,
 * and that a calibration point may be dragged as casually as a divider.
 *
 * ⚑ It is the TWO-LAYER MODEL made visible - calibration points ARE the axis,
 * the grid DERIVES from them (agreed 2026-08-13) - which is why it is the same
 * change on both types rather than a heatmap tweak.
 *
 * ⚑ B1/B2 fall out of the same distinction: under `edge` the derived end
 * COINCIDES with the calibration point, and two marks on one pixel that look
 * identical are indistinguishable by construction. They are now different
 * shapes, so the pair reads as what it is.
 */
describe('the weight of a tick handle', () => {
  const edges: [{ x: number; y: number }, { x: number; y: number }] = [
    { x: 100, y: 300 },
    { x: 400, y: 300 },
  ];

  it('draws a draggable divider as an AID, never as a calibration reticle', () => {
    const markers = categoryTickMarkers({
      edges,
      tickPoints: [
        { x: 160, y: 300 },
        { x: 220, y: 300 },
      ],
      markEnds: false,
    });
    expect(markers).toHaveLength(2);
    for (const m of markers) {
      expect(m.draggable).toBe(true);
      expect(m.kind, 'a divider must not wear the precise-reference reticle').toBe('aid');
    }
  });

  it('keeps the AXIS ENDS as calibration marks, because that is what they are', () => {
    // ⚑ The two edges are not adjustable - every tick is a function of them, and
    // they are non-draggable for exactly that reason. They ARE references, so
    // they keep the reference mark. The distinction is authority, not decoration.
    const markers = categoryTickMarkers({ edges, tickPoints: [{ x: 160, y: 300 }] });
    const ends = markers.filter((m) => m.draggable === false);
    expect(ends).toHaveLength(2);
    for (const m of ends) expect(m.kind).toBe('calibration');
  });
});
