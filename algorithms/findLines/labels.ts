/**
 * Contour labels as each line's IDENTITY (David: "we often have an
 * identification in the contour lines and we can use that to tell them apart").
 *
 * matplotlib's clabel, in reverse: a label is centred in a gap of its OWN line,
 * the gap is the label's width plus padding, and the text is turned to the
 * gap's chord. So every bridged gap holding label ink is a SLOT, and the slot's
 * line is the line the label names.
 *
 * Reading rules (each refusal keeps its reason, N2):
 * - an unsure read (reader's confidence under MIN_CONF) is refused;
 * - "02" style reads are refused: no number format prints a leading zero, so
 *   the decimal point was lost;
 * - ONE FORMAT PER FIGURE: a library labels every line with the same format,
 *   so where at least two confident reads show the figure's decimals, a read of
 *   two or more digits with FEWER is refused (a lost decimal point).
 */
import type { FoundLine } from './lines.js';
import type { Pt } from './geom.js';

export interface LabelSlot {
  line: number;
  p0: Pt;
  p1: Pt;
  /** Degrees, the chord's direction folded into -90..90 (text is kept upright). */
  angle: number;
  /** Half the text band's height, px. */
  halfH: number;
  /** Where the label ink starts and ends along the chord, px from p0. */
  inkFrom: number;
  inkTo: number;
}

export function labelSlots(lines: readonly FoundLine[], labelInk: readonly Pt[][], lineWidth: number): LabelSlot[] {
  const minGap = 4 * lineWidth + 6;
  const cents = labelInk.filter((p) => p.length).map((p) => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length] as Pt);
  const out: LabelSlot[] = [];
  lines.forEach((L, k) => {
    for (const [p0, p1] of L.gaps) {
      const vx = p1[0] - p0[0], vy = p1[1] - p0[1];
      const Lg = Math.hypot(vx, vy);
      if (Lg < minGap) continue; // a dash gap
      const ux = vx / Lg, uy = vy / Lg;
      const nx = -uy, ny = ux;
      const inside: number[] = [];
      cents.forEach((c, i) => {
        const rx = c[0] - p0[0], ry = c[1] - p0[1];
        const along = rx * ux + ry * uy;
        const across = rx * nx + ry * ny;
        if (along > -2 && along < Lg + 2 && Math.abs(across) < Math.max(0.6 * Lg, 8)) inside.push(i);
      });
      if (!inside.length) continue;
      let maxAcr = 0, from = Infinity, to = -Infinity;
      const ink = labelInk.filter((p) => p.length);
      for (const i of inside) {
        for (const q of ink[i]!) {
          maxAcr = Math.max(maxAcr, Math.abs((q[0] - p0[0]) * nx + (q[1] - p0[1]) * ny));
          const al = (q[0] - p0[0]) * ux + (q[1] - p0[1]) * uy;
          from = Math.min(from, al);
          to = Math.max(to, al);
        }
      }
      let ang = (Math.atan2(-uy, ux) * 180) / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang <= -90) ang += 180;
      out.push({ line: k, p0, p1, angle: ang, halfH: maxAcr + 2, inkFrom: Math.max(0, from), inkTo: Math.min(Lg, to) });
    }
  });
  return out;
}

/** The label, turned so its chord is horizontal and the text upright, ready for
 * a text reader: cropped to the label's own ink (not the gap, whose ends hold
 * the line's stubs - read as minus signs), enlarged so the text is `textHeight`
 * px tall, made black on white at the midpoint between ink and paper, and given
 * a white margin. Measured on the research dev set: a reader handed the gap's
 * soft, small crop lost decimal points and read stubs as "-". */
export function slotCrop(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, s: LabelSlot, textHeight = 48, margin = 12, inkCut: number | null = 0.75): { data: Uint8ClampedArray; width: number; height: number } {
  const u: Pt = (() => {
    const L = Math.hypot(s.p1[0] - s.p0[0], s.p1[1] - s.p0[1]);
    return [(s.p1[0] - s.p0[0]) / L, (s.p1[1] - s.p0[1]) / L];
  })();
  const midAlong = (s.inkFrom + s.inkTo) / 2;
  const c: Pt = [s.p0[0] + u[0] * midAlong, s.p0[1] + u[1] * midAlong];
  const hw = Math.max(2, (s.inkTo - s.inkFrom) / 2 + 1.5);
  const hh = s.halfH + 1;
  const rad = (-s.angle * Math.PI) / 180;
  const d: Pt = [Math.cos(rad), Math.sin(rad)]; // along the text, image coordinates
  const n: Pt = [-d[1], d[0]]; // down the text
  const scale = Math.max(2, textHeight / (2 * hh));
  const W = Math.max(1, Math.round(2 * hw * scale)), H = Math.max(1, Math.round(2 * hh * scale));
  const grey = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 255;
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
    const fx = x - x0, fy = y - y0;
    const g = (xx: number, yy: number): number => {
      const i = (yy * w + xx) * 4;
      return 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
    };
    return (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
  };
  const vals = new Float64Array(W * H);
  let lo = 255, hi = 0;
  for (let oy = 0; oy < H; oy++) {
    for (let ox = 0; ox < W; ox++) {
      const uu = (ox + 0.5) / scale - hw, vv = (oy + 0.5) / scale - hh;
      const g = grey(c[0] + uu * d[0] + vv * n[0], c[1] + uu * d[1] + vv * n[1]);
      vals[oy * W + ox] = g;
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
  }
  const cut = inkCut === null ? 0 : lo + inkCut * (hi - lo);
  const OW = W + 2 * margin, OH = H + 2 * margin;
  const out = new Uint8ClampedArray(OW * OH * 4).fill(255);
  for (let oy = 0; oy < H; oy++) {
    for (let ox = 0; ox < W; ox++) {
      const g = vals[oy * W + ox]!;
      // a cut near the PAPER keeps the faint decimal point; null only stretches the contrast
      const v = hi - lo < 30 ? 255 : inkCut === null ? (255 * (g - lo)) / (hi - lo) : g < cut ? 0 : 255;
      const i = ((oy + margin) * OW + ox + margin) * 4;
      out[i] = out[i + 1] = out[i + 2] = v;
    }
  }
  return { data: out, width: OW, height: OH };
}

/** Chosen on the research dev set with tesseract.js (READS-dev.md in plottracer-ref): below
 * 0.8 most reads were wrong; above it most were right, though not all - a read is
 * OFFERED, never asserted. */
export const MIN_CONFIDENCE = 0.8;

export interface SlotRead {
  /** What the reader made of it, tidied. */
  text: string;
  /** 0..1, or null when the reader gives none. */
  confidence: number | null;
  value: number | null;
  /** Why the read was refused, or null when it was accepted. */
  refused: string | null;
}

/** Apply the reading rules to every slot's raw read. */
export function readSlots(raw: readonly { text: string; confidence: number | null }[], minConfidence = MIN_CONFIDENCE): SlotRead[] {
  const pat = /^-?\d+(\.\d+)?$/;
  const tidy = raw.map((r) => (r.text ?? '').trim().replace(/\s+/g, '').replace(/[\u2212\u2013]/g, '-'));
  const pre: (string | null)[] = raw.map((r, i) => {
    if (r.confidence !== null && r.confidence < minConfidence) return `the reader was unsure (${Math.round(r.confidence * 100)}%)`;
    if (/^-?0\d/.test(tidy[i]!)) return 'the decimal point was lost';
    return null;
  });
  const decs: number[] = [];
  tidy.forEach((t, i) => {
    if (!pre[i] && pat.test(t)) decs.push(t.includes('.') ? t.split('.')[1]!.length : 0);
  });
  // ⚑ The figure's format is the MOST decimals among confident reads, not the
  // commonest: a reader loses a decimal point ("1.0" read as "10") but rarely
  // invents one. Measured on the reference figures: with the commonest format,
  // lost-point reads outvoted the right ones and every read came out wrong.
  // ⚑⚑ BUT ONE READ IS NOT A FORMAT (audit C7): it takes TWO confident reads
  // with that many decimals before a read with fewer is refused - one odd
  // "4.0" among 10, 20, 30 must not veto all three - and only a read of two or
  // more digits can have lost a point, so %g-style labels (0, 0.5, 1, 1.5) and
  // single digits stand.
  const maxDec = decs.length ? Math.max(...decs) : 0;
  const dec: number | null = maxDec > 0 && decs.filter((d) => d === maxDec).length >= 2 ? maxDec : null;
  return tidy.map((t, i) => {
    const base = { text: t, confidence: raw[i]!.confidence };
    if (pre[i]) return { ...base, value: null, refused: pre[i]! };
    if (!pat.test(t)) return { ...base, value: null, refused: t ? 'it is not a number' : 'nothing could be read' };
    const d = t.includes('.') ? t.split('.')[1]!.length : 0;
    const digits = t.replace(/[^0-9]/g, '').length;
    if (dec !== null && d < dec && digits >= 2) return { ...base, value: null, refused: `${d} decimals where this figure's labels have ${dec} - the decimal point may have been lost` };
    return { ...base, value: Number(t), refused: null };
  });
}

export interface LineLabelLevel {
  value: number | null;
  /** Two labels on one line that disagree (L4): never resolved silently. */
  conflict: number[] | null;
}

/** Each line's level from the accepted reads in its slots. */
export function levelsFromReads(lineCount: number, slots: readonly LabelSlot[], reads: readonly SlotRead[]): LineLabelLevel[] {
  const out: LineLabelLevel[] = [];
  for (let k = 0; k < lineCount; k++) {
    const vals = [...new Set(slots.map((s, i) => (s.line === k ? reads[i]!.value : null)).filter((v): v is number => v !== null))];
    out.push(vals.length === 1 ? { value: vals[0]!, conflict: null } : { value: null, conflict: vals.length > 1 ? vals.sort((a, b) => a - b) : null });
  }
  return out;
}
