/**
 * Faithful TypeScript port of the pure functions from
 * ui-patches/engauge-algos.js's Grid Line Removal section (Phase 2.3 —
 * see that file's header for the original provenance note). Ported per
 * CLAUDE.md's Step 1 scope.
 *
 * One deliberate interface adjustment, not a behavior change: the
 * original constructs a DOM `ImageData` object internally, which ties
 * this pure pixel-transform to a browser/Electron-renderer global that
 * doesn't exist in Node or a headless service. `removeGridLinesOp` here
 * returns a plain `{ data, width, height }` instead — the caller wraps
 * `data` in `new ImageData(data, width, height)` at whatever boundary
 * actually needs a canvas-compatible object. Keeps this file usable from
 * a headless service too, not just the Electron UI.
 */

export type RGB = [number, number, number];

export interface GridRemovalResult {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  keepZoom: true;
}

/**
 * Replace pixels whose RGB color is within `tolerance` of `gridRGB` with
 * `replaceRGB`. Squared-distance comparison avoids sqrt per pixel.
 * `src` is a flat RGBA byte array (4 bytes per pixel), same shape as
 * ImageData.data.
 */
export function removeGridLinesOp(
  src: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  gridRGB: RGB,
  replaceRGB: RGB,
  tolerance: number
): GridRemovalResult {
  const dst = new Uint8ClampedArray(width * height * 4);
  const [gr, gg, gb] = gridRGB;
  const [rr, rg, rb] = replaceRGB;
  const t2 = tolerance * tolerance;

  for (let i = 0; i < src.length; i += 4) {
    const dr = src[i]! - gr;
    const dg = src[i + 1]! - gg;
    const db = src[i + 2]! - gb;
    if (dr * dr + dg * dg + db * db <= t2) {
      dst[i] = rr;
      dst[i + 1] = rg;
      dst[i + 2] = rb;
      dst[i + 3] = src[i + 3]!;
    } else {
      dst[i] = src[i]!;
      dst[i + 1] = src[i + 1]!;
      dst[i + 2] = src[i + 2]!;
      dst[i + 3] = src[i + 3]!;
    }
  }
  return { data: dst, width, height, keepZoom: true };
}

export function hexToRGB(hex: string): RGB {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
