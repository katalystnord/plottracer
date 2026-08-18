import { describe, it, expect } from 'vitest';
import { computeWhiskerGlyph, CAP_HALF } from '../errorBarGlyph.js';

// ⚑ This file used to test computeErrorBarGlyph -- the RETIRED tuple model's
// two-ended bar -- and nothing else. That function was reachable only through the
// retired 'errorbar' graph type, deleted in v1.5, so its three tests were green
// over code no user could run, while the whisker glyph the LIVE error tool
// actually draws had no test at all. Inverted here.
describe('whisker glyph (checkpoint 79) -- what the live error tool draws', () => {
  it('⚑ draws a tick WIDER than the datum marker it sits beside', () => {
    // The cap's job is to be legible AGAINST the data point, and the datum
    // draws as a ring of radius 7 (see ui/src/ImageCanvas.tsx) with crosshair
    // arms. The inherited constant was 8, spanning 16px against a 14px marker,
    // so the whisker's end vanished into the circle. This pins the RELATIONSHIP
    // rather than the digit -- the number may be tuned, but a cap narrower than
    // the marker is the defect, not a preference.
    const DATUM_MARKER_RADIUS = 7;
    expect(CAP_HALF).toBeGreaterThan(DATUM_MARKER_RADIUS);

    const w = computeWhiskerGlyph({ x: 100, y: 100 }, { x: 100, y: 40 });
    const tick = w.cap;
    const width = Math.hypot(tick.to.x - tick.from.x, tick.to.y - tick.from.y);
    expect(width).toBeGreaterThan(DATUM_MARKER_RADIUS * 2);
  });

  it('draws the bar out to the cap, then a tick across the CAP end only', () => {
    const w = computeWhiskerGlyph({ x: 100, y: 100 }, { x: 100, y: 40 });
    // The datum end draws no tick of its own: it already has its data dot, and a
    // tick there would read as a second cap.
    expect(w.bar).toEqual({ from: { x: 100, y: 100 }, to: { x: 100, y: 40 } });
    // The tick sits at the CAP, normal to a vertical bar so horizontal...
    expect(w.cap.from.y).toBeCloseTo(40);
    expect(w.cap.to.y).toBeCloseTo(40);
    // ...and centred on it.
    expect((w.cap.from.x + w.cap.to.x) / 2).toBeCloseTo(100);
  });

  it('leans the tick with the bar, so a rotated calibration cannot detach it', () => {
    const w = computeWhiskerGlyph({ x: 0, y: 0 }, { x: 100, y: 100 }); // 45°
    const tick = w.cap;
    // Dot product with the bar's own direction must be ~0.
    expect((tick.to.x - tick.from.x) * 100 + (tick.to.y - tick.from.y) * 100).toBeCloseTo(0, 6);
    // Centred on the cap, not on the datum.
    expect((tick.from.x + tick.to.x) / 2).toBeCloseTo(100);
    expect((tick.from.y + tick.to.y) / 2).toBeCloseTo(100);
  });

  it('still draws a visible tick when a cap sits ON its datum (zero error)', () => {
    // A cap on its datum is a claim of perfect certainty -- more dangerous here
    // than a wrong number -- so it must never render as nothing at all.
    const w = computeWhiskerGlyph({ x: 100, y: 100 }, { x: 100, y: 100 });
    // ⚑ The CAP is what must stay visible; the BAR is honestly empty.
    const width = Math.hypot(w.cap.to.x - w.cap.from.x, w.cap.to.y - w.cap.from.y);
    expect(width).toBeGreaterThan(0);
    expect(w.bar.from).toEqual(w.bar.to);
  });
});
