/**
 * A CONTOUR plot's colour key (v2.6, L3): the level axis calibrated by colour.
 *
 * ⚑⚑ A LINE CONTOUR'S KEY IS NOT A STRIP. matplotlib's colorbar for
 * `ax.contour(..., cmap=)` is a white bar crossed by one coloured STROKE per
 * level - the heatmap's strip reader (`algorithms/colorBar.ts`) expects a
 * continuous ramp and would refuse it or read the white between strokes. So
 * the key is read along its long axis as a series of coloured samples: each
 * stroke (or, on a filled key, each step of the ramp) is a colour at a
 * position. A line's level is the position of the sample whose colour matches
 * its ink, turned into a value through the two labelled ticks - in the level
 * axis's own scale (linear or log).
 */
import type { RGB } from './ink.js';

export interface KeySample {
  /** 0 at the first corner's end of the long axis, 1 at the other. */
  t: number;
  rgb: RGB;
}

export interface LineKey {
  samples: KeySample[];
  /** Start and end of the long axis, image px. */
  from: [number, number];
  to: [number, number];
}

/**
 * Read the key between two opposite corners of its bar. The long side is the
 * key's axis; along it, every position whose middle third is not paper gives a
 * sample (the median colour across the bar there).
 */
export function readLineKey(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, a: [number, number], b: [number, number]): LineKey | null {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  const vertical = y1 - y0 >= x1 - x0;
  // the key's axis runs from the FIRST corner's end, so a key clicked top-first reads top-first
  const from: [number, number] = vertical ? [(x0 + x1) / 2, a[1] <= b[1] ? y0 : y1] : [a[0] <= b[0] ? x0 : x1, (y0 + y1) / 2];
  const to: [number, number] = vertical ? [(x0 + x1) / 2, a[1] <= b[1] ? y1 : y0] : [a[0] <= b[0] ? x1 : x0, (y0 + y1) / 2];
  const len = vertical ? y1 - y0 : x1 - x0;
  const across = vertical ? [x0 + (x1 - x0) / 3, x1 - (x1 - x0) / 3] : [y0 + (y1 - y0) / 3, y1 - (y1 - y0) / 3];
  const px = (x: number, y: number): RGB => {
    const xi = Math.max(0, Math.min(w - 1, Math.round(x))), yi = Math.max(0, Math.min(h - 1, Math.round(y)));
    const o = (yi * w + xi) * 4;
    return [rgba[o]!, rgba[o + 1]!, rgba[o + 2]!];
  };
  const paperish = (c: RGB): boolean => c[0] > 235 && c[1] > 235 && c[2] > 235;
  const samples: KeySample[] = [];
  // a 2 px margin inside the bar: its outline is not a colour of the key
  for (let s = 2; s <= len - 2; s++) {
    const t = s / len;
    const along = vertical ? from[1] + (to[1] - from[1]) * t : from[0] + (to[0] - from[0]) * t;
    const cs: RGB[] = [];
    for (let c = Math.ceil(across[0]!); c <= Math.floor(across[1]!); c++) cs.push(vertical ? px(c, along) : px(along, c));
    if (!cs.length) continue;
    const med = [0, 1, 2].map((k) => cs.map((c) => c[k]!).sort((p, q) => p - q)[Math.floor(cs.length / 2)]!) as unknown as RGB;
    if (!paperish(med)) samples.push({ t, rgb: med });
  }
  return samples.length ? { samples, from, to } : null;
}

/** Where a tick's pixel falls along the key's axis, 0..1. */
export function keyPosition(key: LineKey, p: [number, number]): number {
  const vx = key.to[0] - key.from[0], vy = key.to[1] - key.from[1];
  const L2 = vx * vx + vy * vy;
  return L2 > 0 ? ((p[0] - key.from[0]) * vx + (p[1] - key.from[1]) * vy) / L2 : 0;
}

/**
 * The position on the key of the sample nearest in colour to `rgb`, or null
 * when no sample is near enough to be the same ink (`maxDist`, RGB distance).
 * Where several adjacent samples match (a stroke is a few px thick), their
 * middle is taken. The nearest stroke always wins; `maxDist` only decides when a
 * colour is on no stroke at all. 30: a line's anti-aliased ink sits up to ~20
 * from its own stroke, and the old 45 was twice the ~22 between neighbouring
 * levels (contour-coloured-key, audit D5).
 */
export function keyPositionOfColour(key: LineKey, rgb: RGB, maxDist = 30): number | null {
  const d = key.samples.map((s) => Math.hypot(s.rgb[0] - rgb[0], s.rgb[1] - rgb[1], s.rgb[2] - rgb[2]));
  let best = -1;
  for (let i = 0; i < d.length; i++) if (best < 0 || d[i]! < d[best]!) best = i;
  if (best < 0 || d[best]! > maxDist) return null;
  // the run of near-equally good samples around the best one: the stroke's middle
  let lo = best, hi = best;
  const near = d[best]! + 12;
  while (lo > 0 && d[lo - 1]! <= near && key.samples[best]!.t - key.samples[lo - 1]!.t < 0.03) lo--;
  while (hi < d.length - 1 && d[hi + 1]! <= near && key.samples[hi + 1]!.t - key.samples[best]!.t < 0.03) hi++;
  return (key.samples[lo]!.t + key.samples[hi]!.t) / 2;
}

/** A position on the key as a value, through two labelled ticks, in the axis's scale. */
export function keyValueAt(t: number, tickA: { t: number; value: number }, tickB: { t: number; value: number }, log: boolean): number | null {
  if (Math.abs(tickB.t - tickA.t) < 1e-9) return null;
  if (log) {
    if (tickA.value <= 0 || tickB.value <= 0) return null;
    const la = Math.log10(tickA.value), lb = Math.log10(tickB.value);
    return Math.pow(10, la + ((lb - la) * (t - tickA.t)) / (tickB.t - tickA.t));
  }
  return tickA.value + ((tickB.value - tickA.value) * (t - tickA.t)) / (tickB.t - tickA.t);
}

/**
 * A line's ink colour, from the image at its own points: the median of the
 * samples that are not paper. Null when the line sits on nothing coloured.
 */
export function lineInkColour(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, pts: readonly { x: number; y: number }[]): RGB | null {
  const cs: RGB[] = [];
  const step = Math.max(1, Math.floor(pts.length / 200));
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i]!;
    const xi = Math.round(p.x), yi = Math.round(p.y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
    const o = (yi * w + xi) * 4;
    const c: RGB = [rgba[o]!, rgba[o + 1]!, rgba[o + 2]!];
    if (!(c[0] > 235 && c[1] > 235 && c[2] > 235)) cs.push(c);
  }
  if (cs.length < 3) return null;
  return [0, 1, 2].map((k) => cs.map((c) => c[k]!).sort((p, q) => p - q)[Math.floor(cs.length / 2)]!) as unknown as RGB;
}

/**
 * The resolution a level read off the key has (audit B8): how much the value
 * changes over one pixel of the key at position t. A level is rounded to this
 * and no further - a fixed number of significant figures gave every line on a
 * key from 10000 to 10010 the same level, 10000.
 */
export function keyResolution(keyLengthPx: number, tickA: { t: number; value: number }, tickB: { t: number; value: number }, log: boolean, t: number): number {
  const dt = 1 / Math.max(1, keyLengthPx);
  const a = keyValueAt(t, tickA, tickB, log), b = keyValueAt(t + dt, tickA, tickB, log);
  if (a === null || b === null) return 0;
  const step = Math.abs(b - a);
  if (!(step > 0)) return 0;
  // one significant figure of the per-pixel step: a power of ten at or below it
  return Math.pow(10, Math.floor(Math.log10(step)));
}
