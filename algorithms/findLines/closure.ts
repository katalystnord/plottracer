/**
 * Does a hand-captured line CLOSE in the ink? (v2.6, C3 / F8 for lines captured
 * by hand - agreed with David 2026-10-10: "a hand-captured contour line is
 * closed by the same ink check as a found one".)
 *
 * ⚑ NOT A DISTANCE RULE. Measured on 2026-10-07: a traced loop's two ends land
 * 9-14 px apart while a single traced dash's can be 3.6 px apart, so how close
 * the ends are cannot tell closed from open. What can: the points turn through
 * one full loop, AND the gap between the two ends is covered by the line's own
 * ink - the line visibly carries on from its last point to its first.
 */
import { inkCoverage, type RGB } from './ink.js';
import { hermite, sub, unit, type Pt } from './geom.js';

/** Signed turning summed at each vertex - right for sparse clicks, where
 * `netTurn`'s 3 px resampling (made for Find lines' pixel-dense lines) repeats
 * points and measures nonsense. */
function vertexTurn(p: readonly Pt[]): number {
  let acc = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const a = Math.atan2(p[i]![1] - p[i - 1]![1], p[i]![0] - p[i - 1]![0]);
    const b = Math.atan2(p[i + 1]![1] - p[i]![1], p[i + 1]![0] - p[i]![0]);
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    acc += d;
  }
  return acc;
}

export function inkClosesLoop(
  rgba: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  points: readonly Pt[],
  ink: RGB,
  maxGap = 60
): boolean {
  if (points.length < 6) return false;
  const a = points[points.length - 1]!, b = points[0]!;
  if (a[0] === b[0] && a[1] === b[1]) return false; // already closed
  // nearly a full turn without the gap (a loop clicked most of the way round),
  // and not more than one (a spiral is not a loop)
  const turn = Math.abs(vertexTurn(points));
  if (turn < 2 * Math.PI - 1.6 || turn > 2 * Math.PI + 0.8) return false;
  const gap = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (gap > maxGap) return false;
  if (gap < 1) return true;
  // the gap is tested along the same fair curve Find lines bridges with: a
  // Hermite leaving the last point along the line's direction there and
  // arriving at the first along its direction - a loop's ink follows the
  // curve, not the straight chord between the ends
  const tOut = unit(sub(a, points[points.length - 2]!));
  const tIn = unit(sub(points[1]!, b));
  const path = [a, ...hermite(a, tOut, b, tIn), b];
  // coverage in a window around that path only - enough margin for the background
  // estimate (a 9 px closing) to see paper on both sides of the line
  const m = 14;
  const xs = path.map((p) => p[0]), ys = path.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - m), y0 = Math.max(0, Math.floor(Math.min(...ys)) - m);
  const x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)) + m), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)) + m);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const crop = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) crop.set(rgba.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x1 + 1) * 4), y * cw * 4);
  const cov = inkCoverage(crop, cw, ch, ink);
  const onInk = (x: number, y: number): boolean => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = Math.round(x) - x0 + dx, yy = Math.round(y) - y0 + dy;
      if (xx < 0 || yy < 0 || xx >= cw || yy >= ch) continue;
      const i = yy * cw + xx;
      if (cov.alpha[i]! > 0.3 && cov.residual[i]! < 70 && cov.contrast[i]! > 40) return true;
    }
    return false;
  };
  const hit = path.filter((p) => onInk(p[0], p[1])).length;
  return hit / path.length >= 0.85;
}
