import { describe, it, expect } from 'vitest';
import { resolveMeasureClick, snapToNearestPoint, type MeasureClickInput } from '../measureCapture.js';

const P = (x: number, y: number) => ({ x, y });
/** A plain linear pixel→data map, so a slope is arithmetic rather than a fixture. */
const linear = (x: number, y: number) => [x, -y] as const;

function click(over: Partial<MeasureClickInput> = {}): MeasureClickInput {
  return {
    point: P(0, 0),
    pending: [],
    settingScale: false,
    tool: 'distance',
    slopeReady: true,
    toData: linear,
    ...over,
  };
}

describe('snapToNearestPoint - an assist that must never move a deliberate vertex', () => {
  const pts = [
    { px: 100, py: 100 },
    { px: 140, py: 100 },
  ];

  it('anchors exactly on a data point within reach', () => {
    expect(snapToNearestPoint(104, 103, pts, 1)).toEqual({ x: 100, y: 100 });
  });

  it('leaves a click in open space exactly where it was put', () => {
    expect(snapToNearestPoint(400, 400, pts, 1)).toEqual({ x: 400, y: 400 });
  });

  it('takes the NEAREST point, not the first in range', () => {
    expect(snapToNearestPoint(139, 100, pts, 1)).toEqual({ x: 140, y: 100 });
  });

  it('⚑ keeps the reach at ~12 SCREEN px, so it feels the same at any zoom', () => {
    // The threshold is in the click's own (image) space, so it must SHRINK as
    // the view is magnified. Without dividing by the zoom, snapping would
    // swallow ever more of the figure the further you zoomed in - exactly when
    // the user is being most precise.
    const near = { px: 100, py: 100 };
    // 11 image px away: inside 12 at 1x, outside 12/4 = 3 at 4x.
    expect(snapToNearestPoint(111, 100, [near], 1)).toEqual({ x: 100, y: 100 });
    expect(snapToNearestPoint(111, 100, [near], 4)).toEqual({ x: 111, y: 100 });
    // Zoomed OUT to 0.25x the reach is 12/0.25 = 48 image px, so a point 40
    // away - far out of reach at 1x - now snaps.
    expect(snapToNearestPoint(60, 100, [near], 1)).toEqual({ x: 60, y: 100 });
    expect(snapToNearestPoint(60, 100, [near], 0.25)).toEqual({ x: 100, y: 100 });
  });

  it('is exclusive at the boundary, and survives a zero scale', () => {
    expect(snapToNearestPoint(112, 100, [{ px: 100, py: 100 }], 1)).toEqual({ x: 112, y: 100 });
    expect(() => snapToNearestPoint(1, 1, [{ px: 0, py: 0 }], 0)).not.toThrow();
  });

  it('has nothing to snap to on an empty series', () => {
    expect(snapToNearestPoint(5, 6, [], 1)).toEqual({ x: 5, y: 6 });
  });
});

describe('Set-scale outranks the tool', () => {
  it('collects the first point, then hands over to the value+unit form', () => {
    expect(resolveMeasureClick(click({ settingScale: true, tool: 'angle' }))).toEqual({
      kind: 'collect',
      points: [P(0, 0)],
    });
    // ⚑ Not from the origin: with a=(0,0) the distance is |b|, so a sign slip
    // in either subtraction would read identically.
    const r = resolveMeasureClick(click({ settingScale: true, point: P(13, 24), pending: [P(10, 20)] }));
    expect(r).toEqual({ kind: 'scale-draft', points: [P(10, 20), P(13, 24)], distancePx: 5 });
  });
});

describe('slope', () => {
  it('refuses without a calibrated XY chart, and says what to do', () => {
    expect(resolveMeasureClick(click({ tool: 'slope', slopeReady: false }))).toEqual({
      kind: 'refuse',
      message: 'Calibrate an XY chart first to measure a slope.',
    });
    expect(resolveMeasureClick(click({ tool: 'slope', toData: null }))?.kind).toBe('refuse');
  });

  it('collects the first point once the chart can actually carry a slope', () => {
    expect(resolveMeasureClick(click({ tool: 'slope', point: P(2, 3) }))).toEqual({
      kind: 'collect',
      points: [P(2, 3)],
    });
  });

  it('refuses BEFORE collecting anything - a refused tool must not bank points', () => {
    expect(resolveMeasureClick(click({ tool: 'slope', slopeReady: false, pending: [P(1, 1)] })).kind).toBe('refuse');
  });

  it('computes the quotient in DATA space, not pixels', () => {
    // linear() flips y, so a downward-right pixel run is a POSITIVE data slope.
    // ⚑ Neither point is the origin: from (0,0) the deltas equal the values, so
    // a `-` slipped to `+` in either term would give the same answer.
    const r = resolveMeasureClick(click({ tool: 'slope', pending: [P(1, -1)], point: P(3, -5) }));
    expect(r).toMatchObject({ kind: 'record', tool: 'slope', slope: 2 });
  });

  it('hands back a raw NUMBER, never a formatted string', () => {
    // ⚑ core/measurementValues.ts's rule: formatting stays in ui/. A module
    // here returning "2.000" would re-commit the defect that made a rounded
    // display string the only copy of the value.
    const r = resolveMeasureClick(click({ tool: 'slope', pending: [P(0, 0)], point: P(2, -4) }));
    if (r.kind !== 'record') throw new Error('unreachable');
    expect(typeof r.slope).toBe('number');
  });

  it('reports a vertical line as non-finite rather than refusing', () => {
    const r = resolveMeasureClick(click({ tool: 'slope', pending: [P(0, 0)], point: P(0, -4) }));
    if (r.kind !== 'record') throw new Error('unreachable');
    expect(Number.isFinite(r.slope!)).toBe(false);
  });

  it('anchors its label midway between the two points', () => {
    const r = resolveMeasureClick(click({ tool: 'slope', pending: [P(0, 0)], point: P(4, -2) }));
    expect(r).toMatchObject({ labelAt: P(2, -1) });
  });
});

describe('distance', () => {
  it('collects one point, then records with a midpoint label', () => {
    expect(resolveMeasureClick(click({ tool: 'distance' })).kind).toBe('collect');
    const r = resolveMeasureClick(click({ tool: 'distance', pending: [P(0, 0)], point: P(10, 20) }));
    expect(r).toEqual({ kind: 'record', tool: 'distance', points: [P(0, 0), P(10, 20)], labelAt: P(5, 10) });
  });

  it('carries no slope - it is not that kind of measurement', () => {
    const r = resolveMeasureClick(click({ tool: 'distance', pending: [P(0, 0)], point: P(1, 1) }));
    if (r.kind !== 'record') throw new Error('unreachable');
    expect(r.slope).toBeUndefined();
  });

  it('needs no axes at all - a distance in pixels is still a real measurement', () => {
    expect(
      resolveMeasureClick(click({ tool: 'distance', pending: [P(0, 0)], point: P(1, 1), slopeReady: false, toData: null })).kind
    ).toBe('record');
  });
});

describe('angle', () => {
  it('collects until three points are down', () => {
    expect(resolveMeasureClick(click({ tool: 'angle' })).kind).toBe('collect');
    expect(resolveMeasureClick(click({ tool: 'angle', pending: [P(0, 0)] })).kind).toBe('collect');
  });

  it('⚑ REORDERS vertex-first clicks into [arm, vertex, arm]', () => {
    // The user clicks the VERTEX first (the tips bar says so), but both the
    // canvas and measurementValue() read the middle entry as the vertex.
    // Storing the click order would measure the angle at an ARM instead - and
    // the number still looks perfectly plausible, which is what makes it nasty.
    const vertex = P(0, 0);
    const armA = P(10, 0);
    const armB = P(0, 10);
    const r = resolveMeasureClick(click({ tool: 'angle', pending: [vertex, armA], point: armB }));
    expect(r).toEqual({ kind: 'record', tool: 'angle', points: [armA, vertex, armB], labelAt: vertex });
  });

  it('anchors its label AT the vertex, not at a midpoint', () => {
    const r = resolveMeasureClick(click({ tool: 'angle', pending: [P(7, 7), P(10, 0)], point: P(0, 10) }));
    expect(r).toMatchObject({ labelAt: P(7, 7) });
  });
});

describe('area, and a tool not yet chosen', () => {
  it('keeps accumulating vertices - the card’s Finish button closes it', () => {
    for (const pending of [[], [P(0, 0)], [P(0, 0), P(1, 0)], [P(0, 0), P(1, 0), P(1, 1)]]) {
      const r = resolveMeasureClick(click({ tool: 'area', pending, point: P(9, 9) }));
      expect(r.kind, `${pending.length} down`).toBe('collect');
      expect((r as { points: unknown[] }).points).toHaveLength(pending.length + 1);
    }
  });

  it('treats no tool as Area rather than recording something unasked', () => {
    expect(resolveMeasureClick(click({ tool: null, pending: [P(0, 0), P(1, 1)] })).kind).toBe('collect');
  });
});

describe('the pending list is never mutated', () => {
  it('returns a new array, leaving the caller’s own list alone', () => {
    const pending = [P(0, 0)];
    const r = resolveMeasureClick(click({ tool: 'area', pending, point: P(1, 1) }));
    expect(pending).toHaveLength(1);
    expect((r as { points: unknown[] }).points).toHaveLength(2);
  });
});
