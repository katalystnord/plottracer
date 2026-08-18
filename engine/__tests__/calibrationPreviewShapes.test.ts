import { describe, expect, it } from 'vitest';
import { calibrationPreview } from '../calibrationPreview.js';

/**
 * The calibration preview for SPIDER and PIE, and the live-step emphasis.
 *
 * ⚑ WHY THIS FILE EXISTS. `calibrationPreview.ts` scored 62.67% with 29
 * uncovered mutants, and the existing suite never builds a spider or a pie
 * shape at all - the two branches that are not a table lookup. `spiderPairs`
 * derives its rays from the placed steps, and the pie branch FITS A CIRCLE.
 * Neither is exercised, and nor is the emphasis colour.
 *
 * The preview is not decoration. Both types calibrate from a direction or an
 * outline rather than from two points on a printed axis, so there is nothing
 * in the image to check the result against:
 *
 *  - a spider spoke's DIRECTION comes from one click, so a spoke placed
 *    slightly off tilts the whole scale and every value along it moves, with
 *    nothing on screen wrong;
 *  - a pie's centre is DERIVED, and on a donut there is no centre in the
 *    figure to compare it against at all.
 *
 * Drawing them back over the figure is the only check the user gets, which
 * makes a preview that silently draws nothing - or draws garbage - a defect
 * in the reading, not in the rendering.
 */

type Kind = 'xy' | 'bar' | 'polar' | 'ternary' | 'map' | 'ccr' | 'spider' | 'pie';

const shape = (axesKind: Kind, keys: string[], colors: Record<string, string> = {}) => ({
  axesKind,
  steps: keys.map((key) => ({ key, color: colors[key] ?? '#00ff00' })),
});

const placed = (pts: Record<string, [number, number]>) =>
  Object.fromEntries(Object.entries(pts).map(([k, [px, py]]) => [k, { px, py }]));

describe('a spider’s rays are derived from the steps that exist', () => {
  const spokes = ['origin', 'axis1', 'axis2', 'axis3'];

  it('⚑ joins the CENTRE to every placed spoke, and never spoke to spoke', () => {
    // The rays are what the calibration measures a direction along. A segment
    // between two spokes would draw a triangle the figure never had.
    const p = calibrationPreview(
      shape('spider', spokes),
      placed({ origin: [100, 100], axis1: [200, 100], axis2: [100, 200], axis3: [50, 50] })
    );
    expect(p.segments).toHaveLength(3);
    for (const s of p.segments) expect(s.from).toEqual({ x: 100, y: 100 });
    expect(p.segments.map((s) => s.to)).toEqual([
      { x: 200, y: 100 },
      { x: 100, y: 200 },
      { x: 50, y: 50 },
    ]);
  });

  it('draws each ray as soon as ITS spoke is placed, not when all are', () => {
    // Progressive, like every other pair - the user is checking each spoke as
    // they click it.
    const p = calibrationPreview(
      shape('spider', spokes),
      placed({ origin: [100, 100], axis2: [100, 200] })
    );
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0]!.to).toEqual({ x: 100, y: 200 });
  });

  it('draws nothing at all before the centre is placed', () => {
    // Every ray starts at the origin; without it there is no direction to
    // show, and joining the spokes to each other would be an invention.
    const p = calibrationPreview(shape('spider', spokes), placed({ axis1: [200, 100], axis2: [100, 200] }));
    expect(p.segments).toEqual([]);
  });

  it('grows with the spoke count, which lives on the SESSION not the config', () => {
    // A spider's spokes are unrolled per session; a config-driven pair table
    // could only ever describe the origin.
    const six = ['origin', 'a', 'b', 'c', 'd', 'e', 'f'];
    const p = calibrationPreview(
      shape('spider', six),
      placed({ origin: [0, 0], a: [1, 0], b: [2, 0], c: [3, 0], d: [4, 0], e: [5, 0], f: [6, 0] })
    );
    expect(p.segments).toHaveLength(6);
  });

  it('has no circles - a spider is rays, not a fitted shape', () => {
    const p = calibrationPreview(shape('spider', spokes), placed({ origin: [100, 100], axis1: [200, 100] }));
    expect(p.circles).toEqual([]);
  });
});

describe('the LIVE step is drawn in the machine’s own magenta', () => {
  const spokes = ['origin', 'axis1', 'axis2'];
  const MAGENTA = '#ff00c8';

  it('⚑ highlights the emphasised ray in magenta, NOT in the step’s own colour', () => {
    // Spider rays take their colour from the shared origin step, which is
    // green - and a green highlight over a green series is no highlight at
    // all. The bundled spider example has exactly that.
    const p = calibrationPreview(
      shape('spider', spokes, { origin: '#00ff00' }),
      placed({ origin: [100, 100], axis1: [200, 100], axis2: [100, 200] }),
      'axis2'
    );
    const live = p.segments.find((s) => s.emphasis);
    expect(live).toBeDefined();
    expect(live!.color).toBe(MAGENTA);
    expect(live!.to).toEqual({ x: 100, y: 200 });
  });

  it('leaves every other ray in its own colour, with no emphasis flag', () => {
    const p = calibrationPreview(
      shape('spider', spokes, { origin: '#00ff00' }),
      placed({ origin: [100, 100], axis1: [200, 100], axis2: [100, 200] }),
      'axis2'
    );
    const rest = p.segments.filter((s) => !s.emphasis);
    expect(rest).toHaveLength(1);
    expect(rest[0]!.color).toBe('#00ff00');
    expect(rest[0]).not.toHaveProperty('emphasis');
  });

  it('emphasises on the SECOND point of a pair, which is the one being placed', () => {
    // Naming the first would highlight the segment the user just finished
    // rather than the one under the cursor.
    const p = calibrationPreview(
      shape('xy', ['x1', 'x2', 'y1', 'y2']),
      placed({ x1: [0, 0], x2: [10, 0], y1: [0, 0], y2: [0, 10] }),
      'x2'
    );
    expect(p.segments.filter((s) => s.emphasis)).toHaveLength(1);
    expect(p.segments.find((s) => s.emphasis)!.to).toEqual({ x: 10, y: 0 });
  });

  it('emphasises nothing when no key is given', () => {
    const p = calibrationPreview(shape('xy', ['x1', 'x2']), placed({ x1: [0, 0], x2: [10, 0] }));
    expect(p.segments.every((s) => !s.emphasis)).toBe(true);
  });

  it('falls back to grey for a step the shape does not declare', () => {
    const p = calibrationPreview(
      { axesKind: 'xy', steps: [] },
      placed({ x1: [0, 0], x2: [10, 0], y1: [0, 0], y2: [0, 10] })
    );
    expect(p.segments[0]!.color).toBe('#888888');
  });
});

describe('a pie previews the FITTED circle, not segments', () => {
  // Four points on a circle centred (100,100) radius 50.
  const rim = placed({ p1: [150, 100], p2: [100, 150], p3: [50, 100], p4: [100, 50] });
  const pieShape = shape('pie', ['p1', 'p2', 'p3', 'p4']);

  it('⚑ joins NOTHING - a pie’s rim points are not a polygon', () => {
    // Segments between rim clicks would draw a quadrilateral the figure never
    // had, and would hide the one thing worth seeing.
    expect(calibrationPreview(pieShape, rim).segments).toEqual([]);
  });

  it('fits the circle through the rim points and draws it back over the figure', () => {
    const p = calibrationPreview(pieShape, rim);
    const ring = p.circles.find((c) => !c.marker);
    expect(ring).toBeDefined();
    expect(ring!.cx).toBeCloseTo(100, 6);
    expect(ring!.cy).toBeCloseTo(100, 6);
    expect(ring!.r).toBeCloseTo(50, 6);
  });

  it('⚑ marks the DERIVED centre, so it is a thing the user can disagree with', () => {
    // On a donut there is nothing in the image at the centre; without the
    // crosshair the derived middle is an invisible assumption.
    const p = calibrationPreview(pieShape, rim);
    const marker = p.circles.find((c) => c.marker);
    expect(marker).toBeDefined();
    expect(marker!.cx).toBeCloseTo(100, 6);
    expect(marker!.cy).toBeCloseTo(100, 6);
    // Sized in SCREEN pixels rather than figure units - a figure-scaled
    // crosshair was lost in the tangle where the slices meet.
    expect(marker!.r).toBe(9);
  });

  it('needs THREE points before it fits anything', () => {
    const two = placed({ p1: [150, 100], p2: [100, 150] });
    expect(calibrationPreview(pieShape, two).circles).toEqual([]);
    const three = placed({ p1: [150, 100], p2: [100, 150], p3: [50, 100] });
    expect(calibrationPreview(pieShape, three).circles.length).toBeGreaterThan(0);
  });

  it('⚑ SKIPS a collinear fit rather than drawing an infinite circle', () => {
    // Three points on a line have no circumcircle. Rendering the blow-up
    // would have the user checking their calibration against our bug.
    const line = placed({ p1: [0, 0], p2: [10, 0], p3: [20, 0] });
    expect(calibrationPreview(pieShape, line).circles).toEqual([]);
  });

  it('draws both the ring and its marker in the machine’s magenta', () => {
    const p = calibrationPreview(pieShape, rim);
    for (const c of p.circles) expect(c.color).toBe('#ff00c8');
  });
});
