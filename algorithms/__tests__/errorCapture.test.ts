import { describe, it, expect } from 'vitest';
import {
  capFreeDirection,
  constrainCap,
  errorSeriesName,
  mirrorCap,
  nearestPixel,
  oppositeRole,
  roleFromDrag,
} from '../errorCapture.js';

describe('roleFromDrag', () => {
  // Image-pixel y grows downward, so "up" is toward a SMALLER y. Reading the
  // role in raw pixel space without this inversion would file every upward drag
  // as a `lower` cap -- the whole bar would render and export upside down.
  it('reads a drag up the screen as the upper cap', () => {
    expect(roleFromDrag({ x: 100, y: 100 }, { x: 100, y: 60 })).toBe('upper');
  });

  it('reads a drag down the screen as the lower cap', () => {
    expect(roleFromDrag({ x: 100, y: 100 }, { x: 100, y: 140 })).toBe('lower');
  });

  it('reads horizontal drags as left/right', () => {
    expect(roleFromDrag({ x: 100, y: 100 }, { x: 160, y: 100 })).toBe('right');
    expect(roleFromDrag({ x: 100, y: 100 }, { x: 40, y: 100 })).toBe('left');
  });

  it('resolves a diagonal drag to its dominant component rather than refusing', () => {
    // Mostly-up wins over slightly-right. The whisker then draws vertically and
    // is visibly wrong if that was not meant, which is cheaper to fix than an
    // error message for a gesture the user can simply redo.
    expect(roleFromDrag({ x: 100, y: 100 }, { x: 110, y: 40 })).toBe('upper');
    expect(roleFromDrag({ x: 100, y: 100 }, { x: 160, y: 90 })).toBe('right');
  });

  it('refuses a zero-length drag', () => {
    expect(roleFromDrag({ x: 100, y: 100 }, { x: 100, y: 100 })).toBeNull();
  });
});

describe('mirrorCap', () => {
  it('reflects a vertical cap across the datum', () => {
    expect(mirrorCap({ x: 100, y: 100 }, { x: 100, y: 60 })).toEqual({ x: 100, y: 140 });
  });

  it('reflects a horizontal cap across the datum', () => {
    expect(mirrorCap({ x: 100, y: 100 }, { x: 160, y: 100 })).toEqual({ x: 40, y: 100 });
  });

  it('maps the datum\'s line onto itself, whatever direction it runs', () => {
    // A point reflection preserves any line through the centre, so a cap that
    // has been constrained to its datum's (possibly tilted, possibly radial)
    // value axis has a mirror that is automatically on the same line. This is
    // why mirroring needs no axes and no role.
    const datum = { x: 100, y: 100 };
    const cap = { x: 130, y: 60 }; // on some diagonal line through the datum
    const m = mirrorCap(datum, cap);
    // collinear with datum and cap, on the far side
    const cross = (cap.x - datum.x) * (m.y - datum.y) - (cap.y - datum.y) * (m.x - datum.x);
    expect(cross).toBeCloseTo(0, 9);
    expect(m).toEqual({ x: 70, y: 140 });
  });

  it('is an involution — mirroring the mirror returns the original cap', () => {
    const datum = { x: 100, y: 100 };
    const cap = { x: 100, y: 60 };
    expect(mirrorCap(datum, mirrorCap(datum, cap))).toEqual(cap);
  });
});

describe('capFreeDirection / constrainCap — the one constraint', () => {
  /** A plain screen-aligned XY mapping: x = px/10, y = (300-py)/10. */
  const plainXY = {
    pixelToData: (px: number, py: number) => [px / 10, (300 - py) / 10],
    dataToPixel: (x: number, y: number) => ({ x: x * 10, y: 300 - y * 10 }),
  };

  /** The stub every non-XY axes ships (core/axes/bar.ts:93). */
  const stubbed = {
    pixelToData: (px: number, py: number) => [px / 10, (300 - py) / 10],
    dataToPixel: () => ({ x: 0, y: 0 }),
  };

  /** A 1-D axes: Bar's pixelToData returns a single value. */
  const oneDimensional = {
    pixelToData: (_px: number, py: number) => [(300 - py) / 10],
    dataToPixel: (_x: number, y: number) => ({ x: 0, y: 300 - y * 10 }),
  };

  it('finds the value axis on a plain XY chart (up the screen)', () => {
    const d = capFreeDirection(plainXY, { x: 100, y: 200 }, 'upper')!;
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.y).toBeCloseTo(-1, 6); // increasing y is toward a smaller pixel y
  });

  it('finds a TILTED value axis — the reason "lock x" is wrong', () => {
    // Rotation correction has been on by default since checkpoint 68, so a
    // plain XY chart's y-direction need not run up the screen. Here it is
    // rotated 45 degrees.
    const k = Math.SQRT1_2;
    const rotated = {
      pixelToData: (px: number, py: number) => [k * px - k * py, -k * px - k * py],
      dataToPixel: (x: number, y: number) => ({ x: k * x - k * y, y: -k * x - k * y }),
    };
    const d = capFreeDirection(rotated, { x: 50, y: -50 }, 'upper')!;
    expect(d.x).toBeCloseTo(-k, 6);
    expect(d.y).toBeCloseTo(-k, 6);
  });

  it('returns null on a stubbed dataToPixel — no constraint, not a refusal', () => {
    expect(capFreeDirection(stubbed, { x: 100, y: 200 }, 'upper')).toBeNull();
  });

  it('returns null on a 1-D axes, which has no second value to step', () => {
    expect(capFreeDirection(oneDimensional, { x: 100, y: 200 }, 'upper')).toBeNull();
  });

  it('projects a drifting cap back onto the datum\'s line', () => {
    const datum = { x: 100, y: 200 };
    const direction = capFreeDirection(plainXY, datum, 'upper')!;
    // The drag wandered 8px sideways; the cap belongs on the datum's own x, or
    // errorBar.ts's ROLE_MATCH_AXIS could resolve it onto a neighbouring datum.
    const constrained = constrainCap(datum, { x: 108, y: 150 }, direction);
    expect(constrained.x).toBeCloseTo(100, 6);
    expect(constrained.y).toBeCloseTo(150, 6);
  });

  it('leaves the cap untouched when there is no direction', () => {
    const cap = { x: 108, y: 150 };
    expect(constrainCap({ x: 100, y: 200 }, cap, null)).toEqual(cap);
  });
});

describe('oppositeRole', () => {
  it('pairs each role with its opposite', () => {
    expect(oppositeRole('upper')).toBe('lower');
    expect(oppositeRole('lower')).toBe('upper');
    expect(oppositeRole('left')).toBe('right');
    expect(oppositeRole('right')).toBe('left');
  });
});

describe('nearestPixel', () => {
  const points = [
    { x: 10, y: 10 },
    { x: 100, y: 100 },
    { x: 200, y: 50 },
  ];

  it('snaps to the nearest point within range', () => {
    expect(nearestPixel(points, { x: 104, y: 97 }, 12)).toEqual({ index: 1, point: { x: 100, y: 100 } });
  });

  it('returns null past maxDistance rather than yanking a whisker off a far point', () => {
    expect(nearestPixel(points, { x: 400, y: 400 }, 12)).toBeNull();
  });

  it('returns null for an empty series', () => {
    expect(nearestPixel([], { x: 10, y: 10 }, 12)).toBeNull();
  });
});

describe('errorSeriesName', () => {
  it('derives one name per role from the base the user typed', () => {
    expect(errorSeriesName('SD', 'upper')).toBe('SD upper');
    expect(errorSeriesName('SD', 'lower')).toBe('SD lower');
  });

  it('trims, so " SD " and "SD" cannot become two different series', () => {
    expect(errorSeriesName('  SD  ', 'upper')).toBe('SD upper');
  });
});
