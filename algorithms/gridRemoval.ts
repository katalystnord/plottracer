/**
 * Faithful TypeScript port of the pure functions from
 * ui-patches/engauge-algos.js's Grid Line Removal section (Phase 2.3 -
 * see that file's header for the original provenance note). Ported per
 * CLAUDE.md's Step 1 scope.
 *
 * One deliberate interface adjustment, not a behavior change: the
 * original constructs a DOM `ImageData` object internally, which ties
 * this pure pixel-transform to a browser/Electron-renderer global that
 * doesn't exist in Node or a headless service. `removeGridLinesOp` here
 * returns a plain `{ data, width, height }` instead - the caller wraps
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

/**
 * A hex colour string as an RGB triple, or NULL if it is not one.
 *
 * ⚑⚑ IT USED TO ANSWER ANYTHING (v2.3 re-audit, F38). The grid colour is a FREE
 * TEXT box - it has to be, so a colour can be pasted in - and this ran
 * `parseInt(hex, 16)` over whatever was in it. `#e6e6e` (five digits, one
 * keystroke short) parses happily as a completely different colour, and pure
 * nonsense gives NaN, whose `& 255` is 0 - so a typo silently meant *remove
 * BLACK*, which on a scientific figure is the curve, the axis lines and the
 * tick labels. The operation repaints the image, so the user finds out by
 * looking at the damage.
 *
 * ⚑ NULL, not a fallback colour. There is no honest default here: any colour we
 * substituted would erase SOMETHING the user did not ask us to erase. The
 * caller refuses at the gesture instead - CLAUDE.md, pattern 5.
 *
 * ⚑ Three-digit shorthand is accepted because a person typing a colour by hand
 * writes `#ccc`, and refusing a form every browser accepts would read as a bug.
 */
export function hexToRGB(hex: string): RGB | null {
  const body = hex.trim().replace(/^#/, '');
  if (!/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(body)) return null;
  const full = body.length === 3 ? body.replace(/./g, (c) => c + c) : body;
  const v = parseInt(full, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
