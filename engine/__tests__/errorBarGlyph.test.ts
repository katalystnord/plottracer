import { describe, it, expect } from 'vitest';
import { computeWhiskerGlyph } from '../errorBarGlyph.js';

// ⚑ This file used to test computeErrorBarGlyph -- the RETIRED tuple model's
// two-ended bar -- and nothing else. That function was reachable only through the
// retired 'errorbar' graph type, deleted in v1.5, so its three tests were green
// over code no user could run, while the whisker glyph the LIVE error tool
// actually draws had no test at all. Inverted here.
describe('whisker glyph (checkpoint 79) -- what the live error tool draws', () => {
  it('draws the bar out to the cap, then a tick across the CAP end only', () => {
    const segs = computeWhiskerGlyph({ x: 100, y: 100 }, { x: 100, y: 40 });
    // Two segments, not three: the datum end already draws its own data dot, and
    // a tick there would read as a second cap.
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ from: { x: 100, y: 100 }, to: { x: 100, y: 40 } });
    // The tick sits at the CAP, normal to a vertical bar so horizontal...
    expect(segs[1]!.from.y).toBeCloseTo(40);
    expect(segs[1]!.to.y).toBeCloseTo(40);
    // ...and centred on it.
    expect((segs[1]!.from.x + segs[1]!.to.x) / 2).toBeCloseTo(100);
  });

  it('leans the tick with the bar, so a rotated calibration cannot detach it', () => {
    const segs = computeWhiskerGlyph({ x: 0, y: 0 }, { x: 100, y: 100 }); // 45°
    const tick = segs[1]!;
    // Dot product with the bar's own direction must be ~0.
    expect((tick.to.x - tick.from.x) * 100 + (tick.to.y - tick.from.y) * 100).toBeCloseTo(0, 6);
    // Centred on the cap, not on the datum.
    expect((tick.from.x + tick.to.x) / 2).toBeCloseTo(100);
    expect((tick.from.y + tick.to.y) / 2).toBeCloseTo(100);
  });

  it('still draws a visible tick when a cap sits ON its datum (zero error)', () => {
    // A cap on its datum is a claim of perfect certainty -- more dangerous here
    // than a wrong number -- so it must never render as nothing at all.
    const segs = computeWhiskerGlyph({ x: 100, y: 100 }, { x: 100, y: 100 });
    expect(segs).toHaveLength(1);
    const length = Math.hypot(segs[0]!.to.x - segs[0]!.from.x, segs[0]!.to.y - segs[0]!.from.y);
    expect(length).toBeGreaterThan(0);
  });
});
