/**
 * v2.7 - the LEGEND read inside a box the user marked (the Legend detection
 * card, David 2026-10-17). One entry per legend line: its text, and the colour
 * of the sample drawn just left of it (a swatch, a line, a marker).
 *
 * Two instruments, the same answer:
 *   - a DRAWN figure: the page's own text pieces, and the drawn shape nearest
 *     left of each line of text, on its line - its colour and its kind are the
 *     drawing's;
 *   - a PICTURE: PaddleOCR's words (with their boxes), and the most common
 *     colour in a strip just left of each line of text, the background left
 *     out. The kind of sample is not claimed there: pixels alone do not say it.
 *
 * Nothing is applied here: the card shows the entries, the user edits them,
 * and "Accept legend read" is what uses them.
 */
import type { PlacedDrawing } from '../algorithms/findLines/fromDrawing.js';
import type { PlacedText } from './drawingPlacement.js';

type RGB = [number, number, number];
type Box = { x0: number; y0: number; x1: number; y1: number };

export interface LegendEntry {
  name: string;
  /** The sample's colour, 0-255, or null when none was found beside the text. */
  colour: RGB | null;
  /** What the sample is, when the drawing says; null on a picture. */
  sample: 'swatch' | 'line' | 'marker' | null;
  textBox: Box;
}
export interface OcrWord { text: string; bbox: Box }

interface TextLine { text: string; box: Box; size: number }

const inside = (b: Box, r: Box) => b.x0 >= r.x0 && b.y0 >= r.y0 && b.x1 <= r.x1 && b.y1 <= r.y1;

/** Text pieces joined into the legend's lines of text: pieces that overlap in
 * height and follow each other closely; a wider gap starts another entry (a
 * legend set in columns). Top to bottom, then left to right. */
function linesOf(pieces: readonly { text: string; box: Box; size: number }[]): TextLine[] {
  const sorted = [...pieces].filter((p) => p.text.trim()).sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
  const lines: TextLine[] = [];
  for (const p of sorted) {
    const line = lines.find((l) => {
      const overlap = Math.min(l.box.y1, p.box.y1) - Math.max(l.box.y0, p.box.y0);
      const gap = p.box.x0 - l.box.x1;
      return overlap >= 0.5 * Math.min(l.box.y1 - l.box.y0, p.box.y1 - p.box.y0) && gap > -0.5 * p.size && gap < 1.0 * p.size;
    });
    if (!line) {
      lines.push({ text: p.text.trim(), box: { ...p.box }, size: p.size });
      continue;
    }
    const gap = p.box.x0 - line.box.x1;
    line.text += (gap > 0.15 * p.size ? ' ' : '') + p.text.trim();
    line.box = { x0: Math.min(line.box.x0, p.box.x0), y0: Math.min(line.box.y0, p.box.y0), x1: Math.max(line.box.x1, p.box.x1), y1: Math.max(line.box.y1, p.box.y1) };
  }
  return lines.sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
}

export function readLegendFromDrawing(d: PlacedDrawing, text: readonly PlacedText[], box: Box): LegendEntry[] {
  const lines = linesOf(text.filter((t) => inside(t.box, box)).map((t) => ({ text: t.str, box: t.box, size: t.size })));
  const out: LegendEntry[] = [];
  for (const l of lines) {
    const h = l.size;
    let best: { gap: number; colour: RGB; sample: 'swatch' | 'line' | 'marker' } | null = null;
    for (const s of d.shapes) {
      for (const sp of s.subs) {
        if (sp.length < 2) continue;
        const xs = sp.map((p) => p[0]), ys = sp.map((p) => p[1]);
        const b = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
        if (!inside(b, box)) continue;
        const w = b.x1 - b.x0, ht = b.y1 - b.y0;
        if (w > 6 * h || ht > 2 * h) continue; // the legend's frame, or something else
        const cy = (b.y0 + b.y1) / 2;
        if (cy < l.box.y0 - 0.3 * h || cy > l.box.y1 + 0.3 * h) continue; // not on this line
        const gap = l.box.x0 - b.x1;
        if (gap < -0.5 || gap > 3 * h) continue; // not just left of the text
        const closed = Math.hypot(sp[0]![0] - sp[sp.length - 1]![0], sp[0]![1] - sp[sp.length - 1]![1]) < 0.05 * h;
        const sample = s.filled && closed ? (w >= 1.5 * h ? 'swatch' : 'marker') : s.stroked && !closed ? 'line' : s.stroked ? 'marker' : null;
        if (!sample) continue;
        const colour = (s.filled && closed ? s.fill : s.stroke) as RGB;
        // a line sample wins over a marker drawn on it, as the series is the line
        const better = !best || (sample === 'line' && best.sample === 'marker') || (!(best.sample === 'line' && sample === 'marker') && gap < best.gap);
        if (better) best = { gap, colour: [...colour] as RGB, sample };
      }
    }
    if (best) out.push({ name: l.text, colour: best.colour, sample: best.sample, textBox: l.box });
  }
  return out;
}

export function readLegendFromPixels(words: readonly OcrWord[], rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, box: Box): LegendEntry[] {
  // a "word" with no letter or digit is a sample read as text ("=", "-"), not a name
  const lines = linesOf(words.filter((w) => inside(w.bbox, box) && /[\p{L}\p{N}]/u.test(w.text)).map((w) => ({ text: w.text, box: w.bbox, size: w.bbox.y1 - w.bbox.y0 })));
  const out: LegendEntry[] = [];
  for (const l of lines) {
    const h = l.box.y1 - l.box.y0;
    const x0 = Math.max(Math.floor(box.x0), Math.floor(l.box.x0 - 4 * h)), x1 = Math.min(Math.ceil(l.box.x0 - 0.15 * h), width - 1);
    const y0 = Math.max(Math.floor(l.box.y0), 0), y1 = Math.min(Math.ceil(l.box.y1), height - 1);
    // the most common colour in the strip, the background left out
    const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * width + x) * 4;
        const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!;
        if (r > 225 && g > 225 && b > 225) continue; // the background
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        const k = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
        k.n++; k.r += r; k.g += g; k.b += b;
        buckets.set(key, k);
      }
    }
    const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
    const colour: RGB | null = top && top.n >= 6 ? [Math.round(top.r / top.n), Math.round(top.g / top.n), Math.round(top.b / top.n)] : null;
    out.push({ name: l.text, colour, sample: null, textBox: l.box });
  }
  return out;
}

/** Before the text reader sees a legend on a picture: strongly COLOURED pixels
 * (a swatch, a coloured sample line) turned white, so they cannot be read as
 * glyphs (two swatches stacked once read as "="). Legend text is dark and
 * unsaturated, and is kept. In place. */
export function whitenColour(rgba: Uint8ClampedArray | Uint8Array): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 60) rgba[i] = rgba[i + 1] = rgba[i + 2] = 255;
  }
}
