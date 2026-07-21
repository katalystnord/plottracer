import { describe, it, expect } from 'vitest';
import { computeErrorBarGlyph } from '../errorBarGlyph.js';

describe('error-bar glyph (checkpoint 70/72)', () => {
  it('draws the bar plus a cap at each end', () => {
    const segs = computeErrorBarGlyph({ x: 100, y: 50 }, { x: 100, y: 150 });
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ from: { x: 100, y: 50 }, to: { x: 100, y: 150 } });
  });

  it('makes the caps PERPENDICULAR to the bar, not assumed horizontal', () => {
    // The detail worth preserving: a rotated calibration leans the bar, and
    // caps drawn straight across would visibly detach from it.
    const segs = computeErrorBarGlyph({ x: 0, y: 0 }, { x: 100, y: 100 }); // 45°
    const cap = segs[1]!;
    const cdx = cap.to.x - cap.from.x;
    const cdy = cap.to.y - cap.from.y;
    // Dot product with the bar's own direction must be ~0.
    expect(cdx * 100 + cdy * 100).toBeCloseTo(0, 6);
  });

  it('draws a visible cross for a degenerate bar rather than vanishing', () => {
    // Adversarial review of ckpt 70 found the code claimed this and did the
    // opposite: `|| 1` yields the ZERO vector, collapsing all three segments.
    const segs = computeErrorBarGlyph({ x: 100, y: 100 }, { x: 100, y: 100 });
    const cap = segs[1]!;
    const capLength = Math.hypot(cap.to.x - cap.from.x, cap.to.y - cap.from.y);
    expect(capLength).toBeGreaterThan(0);
  });
});
