import type { RGB } from './colorFilter.js';

/** Enough of an ImageData to read a pixel out of. */
export interface PixelSource {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * The colour at one pixel - rounded and clamped to the image.
 *
 * ⚑⚑ THREE COPIES OF FOUR LINES, and the third was written the same day this
 * was extracted (v2.3, theme G). The grid eyedropper, the series/trace
 * eyedropper and the new Colour measurement each rounded the click, clamped it
 * to the bounds, computed `(y * width + x) * 4` and read three channels. Each
 * copy was locally reasonable; together they are a rule with three homes, and
 * the clamp is the part that must not be forgotten - a click at -3 would index
 * backwards into the array and hand back a colour from somewhere else entirely.
 *
 * ⚑ Rounds rather than floors: a click reported at 0.6 is nearer pixel 1, and
 * every caller was already rounding. Stated here so they cannot drift apart.
 */
export function samplePixelRgb(image: PixelSource, x: number, y: number): RGB {
  const cx = Math.max(0, Math.min(image.width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(image.height - 1, Math.round(y)));
  const o = (cy * image.width + cx) * 4;
  return [image.data[o]!, image.data[o + 1]!, image.data[o + 2]!];
}
