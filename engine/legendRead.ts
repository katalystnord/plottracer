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
import { paperColour } from '../algorithms/lineStyle.js';

type RGB = [number, number, number];
type Box = { x0: number; y0: number; x1: number; y1: number };

export interface LegendEntry {
  name: string;
  /** The sample's colour, 0-255, or null when none was found beside the text. */
  colour: RGB | null;
  /** What the sample is, when the drawing says; null on a picture. */
  sample: 'swatch' | 'line' | 'marker' | null;
  textBox: Box;
  /** Where the sample is: the drawn shape, or on a picture the strip just left of the text its colour is taken from.
   * Its line style is measured there (v2.7, series told apart by their line style). */
  sampleBox: Box | null;
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
    let best: { gap: number; colour: RGB; sample: 'swatch' | 'line' | 'marker'; box: Box } | null = null;
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
        if (better) best = { gap, colour: [...colour] as RGB, sample, box: b };
      }
    }
    if (best) out.push({ name: l.text, colour: best.colour, sample: best.sample, textBox: l.box, sampleBox: best.box });
  }
  return out;
}

export function readLegendFromPixels(words: readonly OcrWord[], rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, box: Box): LegendEntry[] {
  // a "word" with no letter or digit is a sample read as text ("=", "-"), not a name
  const all = linesOf(words.filter((w) => inside(w.bbox, box) && /[\p{L}\p{N}]/u.test(w.text)).map((w) => ({ text: w.text, box: w.bbox, size: w.bbox.y1 - w.bbox.y0 })));
  const stripOf = (l: TextLine): Box => {
    const h = l.box.y1 - l.box.y0;
    return {
      x0: Math.max(Math.floor(box.x0), Math.floor(l.box.x0 - 4 * h)),
      // ⚑ well short of the text (v2.7): a read word's box starts a pixel or two right of its first glyph, so a strip
      // up to it took the first letter's stroke as one more mark of the sample. matplotlib leaves 0.8 em between them.
      x1: Math.min(Math.ceil(l.box.x0 - 0.5 * h), width - 1),
      y0: Math.max(Math.floor(l.box.y0), 0),
      y1: Math.min(Math.ceil(l.box.y1), height - 1),
    };
  };
  // ⚑ and a word read INSIDE another entry's sample strip, on its row, whose ink is a thin band, is that sample (a
  // dotted line read as "na", v2.7: 3 rows of ink in a 7-row box). Letters fill their box's height, so a short name
  // in a one-row legend that lies in the next entry's strip is still a name (the code review, 2026-11-05).
  const paper = paperColour(rgba, width, height);
  const inkRows = (b: Box): number => {
    let n = 0;
    for (let y = Math.max(0, Math.floor(b.y0)); y <= Math.min(height - 1, Math.ceil(b.y1)); y++) {
      for (let x = Math.max(0, Math.floor(b.x0)); x <= Math.min(width - 1, Math.ceil(b.x1)); x++) {
        const i = (y * width + x) * 4;
        if (Math.max(Math.abs(rgba[i]! - paper[0]), Math.abs(rgba[i + 1]! - paper[1]), Math.abs(rgba[i + 2]! - paper[2])) > 80) {
          n++;
          break;
        }
      }
    }
    return n;
  };
  const lines = all.filter((l) => !all.some((o) => {
    if (o === l) return false;
    const st = stripOf(o);
    const cy = (l.box.y0 + l.box.y1) / 2;
    const inStrip = l.box.x0 >= st.x0 - 1 && l.box.x1 <= o.box.x0 && cy >= o.box.y0 && cy <= o.box.y1;
    return inStrip && inkRows(l.box) <= Math.max(2, 0.5 * (l.box.y1 - l.box.y0));
  }));
  const out: LegendEntry[] = [];
  for (const l of lines) {
    const { x0, x1, y0, y1 } = stripOf(l);
    const colour = sampleInk(rgba, width, height, { x0, y0, x1, y1 });
    const kind = colour ? sampleKind(rgba, width, { x0, y0, x1, y1 }, colour, l.box.y1 - l.box.y0) : null;
    out.push({ name: l.text, colour, sample: kind?.sample ?? null, textBox: l.box, sampleBox: kind?.box ?? { x0, y0, x1, y1 } });
  }
  return out;
}

/**
 * What a sample on a picture is, where the drawing cannot say (v2.7; docs/v2.7-workflow-walk.md, "Series told apart by
 * their markers"): its ink (within 60 of the sample's colour) runs across the strip, at least 1.3 text heights, for a
 * line (matplotlib draws a line's sample 2 em long), and stands within one text height each way for a marker, whose box
 * is then the marker's own. Anything between is not said, and the type's first tool reads it, as before.
 */
function sampleKind(rgba: Uint8ClampedArray | Uint8Array, width: number, strip: Box, colour: RGB, textHeight: number): { sample: 'line' | 'marker'; box: Box } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = strip.y0; y <= strip.y1; y++) {
    for (let x = strip.x0; x <= strip.x1; x++) {
      const i = (y * width + x) * 4;
      if (Math.max(Math.abs(rgba[i]! - colour[0]), Math.abs(rgba[i + 1]! - colour[1]), Math.abs(rgba[i + 2]! - colour[2])) > 60) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) return null;
  const across = x1 - x0 + 1, tall = y1 - y0 + 1;
  if (across >= 1.3 * textHeight) return { sample: 'line', box: strip };
  if (across <= textHeight && tall <= textHeight) return { sample: 'marker', box: { x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y1 + 1 } };
  return null;
}

/**
 * A legend sample's ink: its strongest pixels, the 15% furthest from the paper, averaged; null with too few to say.
 *
 * ⚑⚑ NOT THE COMMONEST COLOUR (v2.7). That was the answer, and on a thin or dotted sample line it is the grey of the
 * anti-aliased edge, not the ink: the dash-coded figure's black samples read as [59, 59, 59] and the dotted one as
 * [215, 215, 215], which made it another ink. The pixels furthest from the paper are the ink itself, on a swatch (all
 * of it) as on a hairline.
 */
export function sampleInk(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, b: Box): RGB | null {
  const px: { r: number; g: number; b: number; d: number }[] = [];
  for (let y = Math.max(0, Math.floor(b.y0)); y <= Math.min(height - 1, Math.ceil(b.y1)); y++) {
    for (let x = Math.max(0, Math.floor(b.x0)); x <= Math.min(width - 1, Math.ceil(b.x1)); x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i]!, g = rgba[i + 1]!, bl = rgba[i + 2]!;
      if (r > 225 && g > 225 && bl > 225) continue; // the background
      px.push({ r, g, b: bl, d: 765 - r - g - bl + (Math.max(r, g, bl) - Math.min(r, g, bl)) * 2 });
    }
  }
  if (px.length < 6) return null;
  px.sort((p, q) => q.d - p.d);
  const top = px.slice(0, Math.max(3, Math.ceil(px.length * 0.15)));
  const mean = (k: 'r' | 'g' | 'b') => Math.round(top.reduce((s2, p) => s2 + p[k], 0) / top.length);
  return [mean('r'), mean('g'), mean('b')];
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
