import { describe, expect, it } from 'vitest';
import {
  CATEGORY_TICK_COLOR,
  CATEGORY_TICK_DRAG_HINT,
  CONVENTION_LABELS,
  categoryAidGlyphs,
  categoryRegenerateWarning,
  categoryStageLine,
  categoryTickIndexFromId,
  categoryTickMarkers,
} from '../categoryTickOverlay.js';
import { HEATMAP_AXES_CONFIG } from '../axesTypeConfigs.js';

/**
 * The category tick OVERLAY and what the categorical STAGE says.
 *
 * ⚑ These are the two halves that would otherwise sit in `ui/`, where mutation
 * testing cannot reach them and the only instrument is a 20-minute Electron
 * run. Everything here is about what is DRAWN and what is ASKED - no assertion
 * in this file should ever be about a measured value, because ticks decide none.
 */

const H = [{ x: 100, y: 500 }, { x: 600, y: 500 }] as const; // horizontal, left to right

describe('the drawn axis', () => {
  it('draws nothing at all until an axis is marked', () => {
    expect(categoryAidGlyphs({ edges: null, tickPoints: [] })).toEqual([]);
    expect(categoryTickMarkers({ edges: null, tickPoints: [{ x: 1, y: 2 }] })).toEqual([]);
  });

  it('draws the axis, its two ends, and one mark per tick', () => {
    const glyphs = categoryAidGlyphs({ edges: H, tickPoints: [{ x: 225, y: 500 }, { x: 475, y: 500 }] });
    // One drawn thing per mark: the axis, its two ends, and a tick each.
    expect(glyphs).toHaveLength(5);
    const [axis, endA, endB, t1, t2] = glyphs;
    expect(axis!.segments[0]).toEqual({ from: { x: 100, y: 500 }, to: { x: 600, y: 500 } });
    // Ends cross the axis; ticks only stand off it.
    expect(endA!.segments[0]).toEqual({ from: { x: 100, y: 489 }, to: { x: 100, y: 511 } });
    expect(endB!.segments[0]).toEqual({ from: { x: 600, y: 489 }, to: { x: 600, y: 511 } });
    expect(t1!.segments[0]).toEqual({ from: { x: 225, y: 500 }, to: { x: 225, y: 514 } });
    expect(t2!.segments[0]).toEqual({ from: { x: 475, y: 500 }, to: { x: 475, y: 514 } });
  });

  /**
   * ⚑⚑ A MARK AND ITS HANDLE ARE ONE OBJECT. They were two - a black segment in
   * the bin layer and a violet square 14px away in the marker layer, of which
   * only the square could be moved. David: *"Why is the tick marker these two
   * separate pieces and you can only move one?"*
   */
  it('⚑⚑ a tick names the handle it IS, and carries its own grip', () => {
    const glyphs = categoryAidGlyphs({ edges: H, tickPoints: [{ x: 225, y: 500 }] });
    const tick = glyphs[3]!;
    expect(tick.markerId).toBe('categoryTick0');
    // The grip sits at the mark's outer end - the same pixel the separate
    // square used to occupy, so nothing moved on screen.
    expect(tick.grip).toEqual({ x: 225, y: 514 });
    expect(tick.segments[0]!.to).toEqual(tick.grip);
    // The axis and its frozen ends name no handle: every tick derives from them.
    expect(glyphs.slice(0, 3).every((g) => g.markerId === null && g.grip === null)).toBe(true);
  });

  /**
   * ⚑⚑ PATTERN 4: A CONSTRAINED GESTURE MUST BE BOUND TO ITS CONSTRAINT ON
   * SCREEN. `moveTick` has always projected the drop point onto the axis and
   * clamped it between its neighbours, so the RECORD was right - and the picture
   * was not, because Konva moves the dragged node wherever the cursor goes. The
   * mark leaned off the axis under the cursor and snapped back on release, which
   * teaches the user that a tick off the axis is a thing they might get.
   */
  it('⚑⚑ a tick declares the LINE its drag is confined to - the axis itself', () => {
    const [tick] = categoryTickMarkers({ edges: H, tickPoints: [{ x: 225, y: 500 }] }).slice(2);
    expect(tick!.dragLine?.direction).toEqual({ x: 1, y: 0 });
    // The origin is the GRIP, which is where the drag actually starts.
    expect(tick!.dragLine?.origin).toEqual({ x: 225, y: 514 });
  });

  it('⚑ and it follows a tilted axis rather than the screen', () => {
    const tilted = [{ x: 0, y: 0 }, { x: 300, y: 400 }] as const;
    const [tick] = categoryTickMarkers({ edges: tilted, tickPoints: [{ x: 150, y: 200 }] }).slice(2);
    expect(tick!.dragLine?.direction.x).toBeCloseTo(0.6, 9);
    expect(tick!.dragLine?.direction.y).toBeCloseTo(0.8, 9);
  });

  it('⚑ and the marker sits at the mark\u2019s outer end, where the grip is drawn', () => {
    const [tick] = categoryTickMarkers({ edges: H, tickPoints: [{ x: 225, y: 500 }] }).slice(2);
    // ⚠️ THE HIT AREA DELIBERATELY STOPS SHORT OF THE AXIS. A first version gave
    // the marker an invisible line spanning the whole mark so it could be
    // grabbed anywhere along it - and the mark's inner end sits ON the category
    // axis, which is where a bar's drag-box starts on a chart whose categories
    // run along the baseline. The tick swallowed the bar capture. The renderer's
    // 11px disc around this point already covers all but the ~3px nearest the
    // axis, which is exactly the part that collided.
    expect(tick!.x).toBe(225);
    expect(tick!.y).toBe(514);
  });

  it('⚑ ticks stand off DOWNWARD on an upright chart - where a figure prints them', () => {
    const tick = categoryAidGlyphs({ edges: H, tickPoints: [{ x: 300, y: 500 }] })[3]!.segments[0]!;
    expect(tick.to.y).toBeGreaterThan(tick.from.y);
    expect(tick.to.x).toBe(tick.from.x);
  });

  it('the marks rotate with the axis rather than staying image-aligned', () => {
    // A horizontal-bars chart: the category axis runs down the left side.
    const vertical = [{ x: 100, y: 100 }, { x: 100, y: 600 }] as const;
    const tick = categoryAidGlyphs({ edges: vertical, tickPoints: [{ x: 100, y: 300 }] })[3]!.segments[0]!;
    expect(tick.to.y).toBe(tick.from.y);
    expect(tick.to.x).toBeLessThan(tick.from.x); // outward, away from the plot
  });

  it('works on a tilted axis, at the right stand-off length', () => {
    const tilted = [{ x: 0, y: 0 }, { x: 300, y: 400 }] as const; // length 500
    const tick = categoryAidGlyphs({ edges: tilted, tickPoints: [{ x: 150, y: 200 }] })[3]!.segments[0]!;
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

/**
 * ⛔⛔ THE FOLD-OUT'S STATE MACHINE IS GONE, AND SO ARE ITS TESTS (v2.4).
 *
 * Removed with it: `the fold-out only offers itself when it can do something`,
 * `what the fold-out asks for`, `a refused mark says why`, `"Re-place axis" can
 * place BOTH ends - the walk that was unreachable`, `the card David called 'not
 * even functional'`, and `the stage line does not assert a count nobody
 * declared`. Every one of them described a MARKING GESTURE performed after
 * calibration, seeded from a value-axis handle - the arrangement that let a
 * category axis run diagonally across a figure.
 *
 * ⚑ They are not ported, because the states they covered cannot be reached:
 * there is no phase, no seed, no half-placed edge, no refusal for a second click
 * on the first, and no marked-axis-without-a-count. The two ends are calibration
 * steps (`BAR_AXES_CONFIG.fixedSteps`) and the walk's own tests cover them; what
 * this file still owns is what is DRAWN and what the stage SAYS.
 */

describe('the stage line', () => {
  it('names the count the calibration declared', () => {
    expect(categoryStageLine(12, false)).toBe('Categories - 12 categories');
  });

  it('says "1 category", not "1 categories"', () => {
    expect(categoryStageLine(1, false)).toBe('Categories - 1 category');
  });

  /**
   * ⚑⚑ TICKS EXISTING IS NOT THE SAME AS SOMEBODY HAVING LOOKED AT THEM, and
   * that distinction is new. Before v2.4 an axis only existed once the user had
   * marked it by hand, so the two were the same fact; now the walk produces
   * ticks the instant it finishes, and a card that treated THAT as the stage
   * being finished would fold itself shut at the moment the user reached for a
   * marker.
   */
  it('⚑⚑ reports the stage finished only once the ending has been pressed', () => {
    expect(categoryStageLine(12, false)).not.toContain('✓');
    expect(categoryStageLine(12, true)).toBe('Categories - 12 categories ✓');
  });
});

describe('the regenerate warning', () => {
  it('says nothing when nothing would be lost', () => {
    expect(categoryRegenerateWarning(false)).toBeNull();
  });

  /**
   * ⚑ A warning that appears when nothing would be discarded teaches the user to
   * ignore it - so it fires only where there is something to lose, and it names
   * the control that would do the losing rather than standing on the card.
   */
  it('⚑ warns only once a tick has actually been dragged', () => {
    expect(categoryRegenerateWarning(true)).toContain('discards the ones you moved');
  });
});

describe('the words on screen', () => {
  /**
   * ⚑⚑ ONE FACT, ONE VOCABULARY. These used to read `Under each category` /
   * `Between categories` while the heatmap said `Centres` / `Boundaries` for the
   * identical `TickConvention`, so a user meeting both had to be told they were
   * the same question. David: *"we should be CONSISTENT and use the same
   * mechanism / drawing in all places so that users can recognize them easily."*
   */
  it('⚑⚑ are the heatmap\u2019s words, so the same question reads the same way', () => {
    expect(CONVENTION_LABELS.centred).toBe('Centres');
    expect(CONVENTION_LABELS.edge).toBe('Boundaries');
  });

  /**
   * ⚑ And the heatmap's own controls are BUILT from this constant, so the two
   * cannot drift apart again by someone editing one of them. Grepping the NAME
   * is what finds a shared literal; this test is what keeps it shared.
   */
  it('⚑ and the heatmap\u2019s tick-convention choices come from this same constant', () => {
    const ticks = HEATMAP_AXES_CONFIG.options?.find((o) => o.key === 'xTicksCentred');
    const choices = ticks && 'choices' in ticks ? ticks.choices : undefined;
    expect(choices?.map((c) => c.label)).toEqual([CONVENTION_LABELS.edge, CONVENTION_LABELS.centred]);
  });

  it('the drag hint names the gesture, because nothing else on screen does', () => {
    expect(CATEGORY_TICK_DRAG_HINT).toContain('Drag any of them');
  });
});

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
describe('⚑ the axis-edge labels lean INWARD, so neither runs off the figure', () => {
  it('each one is pushed away from a point just outside its own end', () => {
    // David's screenshot: the right-hand label was cut to `Categ` at the plot
    // boundary, because every label takes the same up-and-to-the-right offset
    // and the axis ends where the figure does.
    const markers = categoryTickMarkers({
      edges: [{ x: 100, y: 500 }, { x: 900, y: 500 }],
      tickPoints: [],
    });
    const start = markers.find((m) => m.id === 'categoryAxisStart')!;
    const end = markers.find((m) => m.id === 'categoryAxisEnd')!;
    // Away-points sit OUTSIDE the span, so `marker - away` points into it.
    expect(start.labelAway!.x).toBeLessThan(100);
    expect(end.labelAway!.x).toBeGreaterThan(900);
  });

  it('⚑ and it follows the axis, not the screen - a vertical axis leans along itself', () => {
    const markers = categoryTickMarkers({
      edges: [{ x: 80, y: 600 }, { x: 80, y: 100 }],
      tickPoints: [],
    });
    const start = markers.find((m) => m.id === 'categoryAxisStart')!;
    const end = markers.find((m) => m.id === 'categoryAxisEnd')!;
    expect(start.labelAway!.y).toBeGreaterThan(600);
    expect(end.labelAway!.y).toBeLessThan(100);
  });
});
