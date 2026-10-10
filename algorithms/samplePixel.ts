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

/**
 * The INK colour near a click: of the pixels within `radius`, the one that
 * differs most from the window's commonest colour (its paper).
 *
 * ⚑⚑ FOR A THIN LINE, THE PIXEL UNDER THE CURSOR IS USUALLY AN EDGE. An
 * anti-aliased line is mostly a mix of ink and paper, so a pipette that takes
 * one pixel hands Find lines a pale grey for a black line - and then every line
 * reads as several pixels wider than it is, and neighbours look merged. David
 * picked `#b3b3b3` off the black contour example and got 17 lines and 18
 * "lines run together" places where the true colour gives 7 and none.
 */
export function sampleInkRgb(image: PixelSource, x: number, y: number, radius = 3): RGB {
  const cx = Math.round(x), cy = Math.round(y);
  const px: RGB[] = [];
  for (let yy = cy - radius; yy <= cy + radius; yy++) {
    for (let xx = cx - radius; xx <= cx + radius; xx++) {
      if (xx < 0 || yy < 0 || xx >= image.width || yy >= image.height) continue;
      const o = (yy * image.width + xx) * 4;
      px.push([image.data[o]!, image.data[o + 1]!, image.data[o + 2]!]);
    }
  }
  if (!px.length) return samplePixelRgb(image, x, y);
  const counts = new Map<string, { c: RGB; n: number }>();
  for (const c of px) {
    const k = c.map((v) => v >> 4).join(',');
    const e = counts.get(k);
    if (e) e.n++;
    else counts.set(k, { c, n: 1 });
  }
  const paper = [...counts.values()].sort((a, b) => b.n - a.n)[0]!.c;
  let best = px[0]!, bd = -1;
  for (const c of px) {
    const d = (c[0] - paper[0]) ** 2 + (c[1] - paper[1]) ** 2 + (c[2] - paper[2]) ** 2;
    if (d > bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}
