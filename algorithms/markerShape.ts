/**
 * A marker's shape, measured off its pixels, and how unlike two markers are (v2.7 study; docs/v2.7-workflow-walk.md,
 * "Series told apart by their markers").
 *
 * Compared directly, a legend sample's marker against the markers in the plot, as line styles are: no vocabulary of
 * named shapes stands between them. What is measured:
 *   - the outline: how far the marker reaches from its centre along each of 16 directions (its support function),
 *     relative to its mean reach (a circle is flat, a square peaks on the diagonals, a triangle has three peaks, and
 *     up and down differ; a plus and a diamond, or a cross and a square, share it and differ in the next two);
 *   - how filled it is: its ink over the area its outline encloses (a filled marker near 1, an open one well under);
 *   - how much of its reach it fills: its ink over the disc of its mean reach (a cross or plus is thin);
 *   - its size: its mean reach.
 */

export interface MarkerShape {
  /** Mean reach from the centre, px. */
  size: number;
  /** Reach per direction (16, from +x turning toward +y), over the mean reach. */
  reach: number[];
  /** Ink over the area the outline encloses. */
  fill: number;
  /** Ink over the disc of the mean reach. */
  mass: number;
  /** Ink pixels. */
  area: number;
}

const DIRS = 16;

/** Closer than this, two markers are one marker, whatever their sizes (measured: the same marker within 0.88; different
 * kinds at least 1.23 generated, 1.47 on real figures). */
export const SAME_MARKER = 1.0;

/** The shape of the marker whose pixels (indices into a `w`-wide image) are `pix`; null for fewer than 4. */
export function markerShape(pix: readonly number[], w: number): MarkerShape | null {
  if (pix.length < 4) return null;
  let sx = 0, sy = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const i of pix) {
    const x = i % w, y = (i - x) / w;
    sx += x;
    sy += y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = sx / pix.length, cy = sy / pix.length;
  // ⚑ the support function: how far the marker reaches along each direction, the furthest any of its pixels lies
  // (each pixel a unit square, so its far corner). Defined in every direction even for a marker 5 px across, where
  // binning pixels by their angle left most directions empty.
  const reach = new Array<number>(DIRS).fill(-Infinity);
  for (let k = 0; k < DIRS; k++) {
    const a = (k * 2 * Math.PI) / DIRS, ux = Math.cos(a), uy = Math.sin(a);
    const corner = 0.5 * (Math.abs(ux) + Math.abs(uy));
    for (const i of pix) {
      const x = i % w, y = (i - x) / w;
      const d = (x - cx) * ux + (y - cy) * uy + corner;
      if (d > reach[k]!) reach[k] = d;
    }
  }
  const mean = reach.reduce((a, b) => a + b, 0) / DIRS || 1;
  // the area the outline encloses: the bounding box less what can be reached from its border without crossing ink
  const bw = maxX - minX + 3, bh = maxY - minY + 3;
  const ink = new Uint8Array(bw * bh);
  for (const i of pix) {
    const x = i % w, y = (i - x) / w;
    ink[(y - minY + 1) * bw + (x - minX + 1)] = 1;
  }
  const out = new Uint8Array(bw * bh);
  const stack = [0];
  out[0] = 1;
  while (stack.length) {
    const j = stack.pop()!;
    const x = j % bw, y = (j - x) / bw;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
      const n = ny * bw + nx;
      if (out[n] || ink[n]) continue;
      out[n] = 1;
      stack.push(n);
    }
  }
  let enclosed = 0;
  for (let j = 0; j < bw * bh; j++) if (!out[j]) enclosed++;
  return {
    size: mean,
    reach: reach.map((r) => r / mean),
    fill: pix.length / Math.max(1, enclosed),
    mass: pix.length / (Math.PI * mean * mean),
    area: pix.length,
  };
}

/** How unlike two markers are: 0 the same. The outline, the fill and the mass; not the size, as a legend may draw its
 * markers at half the plot's size (measured on PMC2680616: 5 to 7 px against 10 to 12). */
export function markerDistance(a: MarkerShape, b: MarkerShape): number {
  let r = 0;
  for (let k = 0; k < DIRS; k++) r += Math.abs(a.reach[k]! - b.reach[k]!);
  return r / DIRS / 0.05 + Math.abs(a.fill - b.fill) / 0.15 + Math.abs(a.mass - b.mass) / 0.15;
}
