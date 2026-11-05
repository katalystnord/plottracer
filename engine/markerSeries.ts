/**
 * Which markers make each legend entry's series, where the entries share one ink (v2.7; docs/v2.7-workflow-walk.md,
 * "Series told apart by their markers"). The sibling of engine/styleSeries.ts, for scatters.
 *
 * Each entry's legend marker is measured (algorithms/markerShape.ts) and every marker in the plot goes to the entry it
 * is most like. Markers drawn over each other are taken apart first (algorithms/markerFit.ts), each entry's template
 * being its own commonest marker in the plot, as a legend may draw its markers at another size. Where a marker is
 * nearly as like a second entry's legend marker as its own, it still goes to its own, and the plan says how many such
 * an entry has: measured on real figures, a marker of a kind no entry names cannot be told from one that is named,
 * but doubt can (David, 2026-11-05).
 */
import type { RGB, FilterRegion } from '../algorithms/colorFilter.js';
import { inkTest, paperColour } from '../algorithms/lineStyle.js';
import { detectBlobs, markerCentres, type Blob } from '../algorithms/blobDetect.js';
import { markerShape, markerDistance, SAME_MARKER, type MarkerShape } from '../algorithms/markerShape.js';
import { compactBlob, ONE_MARKER, splitBlob, templateOf, typicalMarker, type MarkerTemplate } from '../algorithms/markerFit.js';
import type { Point2D } from '../algorithms/segmentFill.js';

type Box = { x0: number; y0: number; x1: number; y1: number };

export interface MarkerSeriesPlan {
  /** False when fewer than two entries' legend markers can be told apart: then nothing is given to any entry (the read
   * is by colour alone, as before), and `unmeasured` and `sameMarkerAs` say why. */
  told: boolean;
  /** Per entry, its points (image px), in order along x. */
  perEntry: Point2D[][];
  /** Per entry with doubtful markers: how many, the entry they are most often nearly as like, and the most doubtful. */
  doubtful: { entry: number; count: number; like: number; at: Point2D }[];
  /** Entries no marker went to (an entry sharing another's marker is not one: `sameMarkerAs` says it). */
  empty: number[];
  /** Entries whose legend marker could not be measured. */
  unmeasured: number[];
  /** Entries whose legend marker cannot be told from an earlier entry's: what has it is the earlier entry's. */
  sameMarkerAs: { entry: number; as: number }[];
}

export interface MarkerSeriesInput {
  /** The figure as readers see it (masked areas, the legend among them, blanked). */
  data: Uint8ClampedArray | Uint8Array;
  /** The figure as it is, where the legend's markers are measured. */
  legendData: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  /** The entries' ink. ⚑ Read as the line styles are (algorithms/lineStyle.ts, inkTest): every pixel at least a third
   * of the way from the paper to it, so a thin open marker's anti-aliased sides are its own (at Colour trace's
   * tolerance an open triangle kept only its base). */
  target: RGB;
  region?: FilterRegion;
  minDiameter: number;
  /** Each entry's legend sample, or null where there is none. */
  samples: readonly (Box | null)[];
}

/** A marker whose second nearest legend marker is less than twice as far as its nearest is doubtful (measured on 9
 * real figures: it marks all 54 given to the wrong entry, and 74 of the 219 given to the right one). */
const DOUBT = 0.5;

/** With templates from the legend's markers, a blob is taken apart when its markers explain this much of its ink:
 * less than Colour trace asks with no legend, where a speck could be the template (measured on the generated dense
 * scatter: 151 of 176 markers read at 0.9, 166 at 0.8, and no more below). */
const EXPLAINED = 0.8;
/** Up to this many times the largest template, a blob no template covers is still markers. */
const FEW_MARKERS = 4;

/** The legend marker in a sample's box: the largest piece of the ink there. */
function sampleMarker(mask: Uint8Array, w: number, h: number, box: Box): MarkerShape | null {
  const x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0));
  const x1 = Math.min(w - 1, Math.ceil(box.x1)), y1 = Math.min(h - 1, Math.ceil(box.y1));
  const seen = new Uint8Array(w * h);
  let best: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const s = y * w + x;
      if (!mask[s] || seen[s]) continue;
      const piece: number[] = [];
      const stack = [s];
      seen[s] = 1;
      while (stack.length) {
        const p = stack.pop()!;
        piece.push(p);
        const px = p % w, py = (p - px) / w;
        for (let ny = Math.max(y0, py - 1); ny <= Math.min(y1, py + 1); ny++)
          for (let nx = Math.max(x0, px - 1); nx <= Math.min(x1, px + 1); nx++) {
            const q = ny * w + nx;
            if (mask[q] && !seen[q]) {
              seen[q] = 1;
              stack.push(q);
            }
          }
      }
      if (piece.length > best.length) best = piece;
    }
  }
  return markerShape(best, w);
}

/** Each entry's markers; `told` false when fewer than two entries' legend markers can be told apart. */
export function readMarkerSeries(input: MarkerSeriesInput): MarkerSeriesPlan {
  const { width: w, height: h, target } = input;
  const paper = paperColour(input.legendData, w, h);
  const maskOf = (data: Uint8ClampedArray | Uint8Array, r: { x0: number; y0: number; x1: number; y1: number }): Uint8Array => {
    const ink = inkTest(data, w, h, target, paper);
    const m = new Uint8Array(w * h);
    for (let y = Math.max(0, r.y0); y <= Math.min(h - 1, r.y1); y++) for (let x = Math.max(0, r.x0); x <= Math.min(w - 1, r.x1); x++) if (ink(x, y)) m[y * w + x] = 1;
    return m;
  };
  const legendMask = maskOf(input.legendData, { x0: 0, y0: 0, x1: w - 1, y1: h - 1 });
  const shapes = input.samples.map((b) => (b ? sampleMarker(legendMask, w, h, b) : null));
  const unmeasured = shapes.map((s, e) => (s ? -1 : e)).filter((e) => e >= 0);
  const sameMarkerAs: MarkerSeriesPlan['sameMarkerAs'] = [];
  const distinct = shapes.map((sh, e) => {
    if (!sh) return null;
    const as = shapes.findIndex((o, k) => k < e && o !== null && !sameMarkerAs.some((x) => x.entry === k) && markerDistance(o, sh) < SAME_MARKER);
    if (as < 0) return sh;
    sameMarkerAs.push({ entry: e, as });
    return null;
  });
  if (distinct.filter((s) => s !== null).length < 2) {
    return { told: false, perEntry: input.samples.map(() => []), doubtful: [], empty: [], unmeasured, sameMarkerAs };
  }

  const R = input.region;
  const mask = maskOf(input.data, R ? { x0: Math.ceil(R.x), y0: Math.ceil(R.y), x1: Math.floor(R.x + R.width), y1: Math.floor(R.y + R.height) } : { x0: 0, y0: 0, x1: w - 1, y1: h - 1 });
  const blobs = detectBlobs(mask, w, h, { minDiameter: input.minDiameter, trackMembership: true });
  // each blob's nearest legend marker, and how near the second is
  const nearest = (sh: MarkerShape | null): { e: number; ratio: number; second: number } => {
    if (!sh) return { e: -1, ratio: 1, second: -1 };
    const d = distinct.map((s) => (s ? markerDistance(sh, s) : Infinity));
    const order = d.map((_, k) => k).sort((a, b) => d[a]! - d[b]!);
    const [a, b] = order;
    return { e: a!, ratio: d[b!]! === Infinity ? 0 : d[a!]! / Math.max(1e-9, d[b!]!), second: b! };
  };
  const near = blobs.map((b) => nearest(markerShape([...b.members!], w)));
  // each entry's template: its own commonest marker in the plot, of the blobs surely like its legend marker and shaped
  // like one marker (an open marker too: the legend's marker keeps text out, so the fill is not asked)
  const templates: (MarkerTemplate | null)[] = distinct.map(() => null);
  const templateArea: number[] = distinct.map(() => 0);
  distinct.forEach((_, e) => {
    const t = typicalMarker(blobs.filter((b, i) => near[i]!.e === e && near[i]!.ratio <= DOUBT), (b) => compactBlob(b, false), 1);
    if (!t) return;
    templates[e] = templateOf([...t.members!], w);
    templateArea[e] = t.area;
  });
  const used = templates.map((t, e) => (t ? e : -1)).filter((e) => e >= 0);
  const maxTemplateArea = Math.max(0, ...templateArea);
  const fitWith = used.map((e) => templates[e]!);
  // the entry whose template, centred at a point, covers the blob's ink best; none where no template lies mostly on
  // ink (the plot's frame, a line: their centre is not on a marker)
  const coverBest = (b: Blob, p: Point2D): number => {
    const inBlob = new Set(b.members!);
    let best = -1, bs = -Infinity;
    for (const e of used) {
      let on = 0, off = 0;
      const offs = templates[e]!.offsets;
      for (const [dx, dy] of offs) {
        if (inBlob.has((Math.floor(p.y) + dy) * w + Math.floor(p.x) + dx)) on++;
        else off++;
      }
      if (off > 0.4 * offs.length) continue;
      if (on - 3 * off > bs) { bs = on - 3 * off; best = e; }
    }
    return best;
  };

  const perEntry: Point2D[][] = input.samples.map(() => []);
  const doubts: { entry: number; like: number; ratio: number; at: Point2D }[] = [];
  blobs.forEach((b, i) => {
    const n = near[i]!;
    if (n.e < 0) return;
    // markers drawn over each other: each fitted marker is its template's entry. ⚑ Tried on every blob, not only those
    // clearly bigger than one marker (as Colour trace with no legend does): two open markers drawn over each other
    // are often less than 1.6 of one. A lone marker leaves too little for a second to fit, so it is not split.
    const split = fitWith.length ? splitBlob([...b.members!], w, fitWith, EXPLAINED) : null;
    if (split) {
      for (const q of split) perEntry[used[q.template]!]!.push({ x: q.x, y: q.y });
      return;
    }
    // one marker: the entry it is most like
    if (!templates[n.e] || b.area <= ONE_MARKER * templateArea[n.e]!) {
      for (const p of markerCentres(b, w, { minDiameter: input.minDiameter })) {
        perEntry[n.e]!.push(p);
        if (n.ratio > DOUBT) doubts.push({ entry: n.e, like: n.second, ratio: n.ratio, at: p });
      }
      return;
    }
    // a marker with something attached (an error bar): its body, given to the entry whose marker covers it best
    for (const p of markerCentres(b, w, { minDiameter: input.minDiameter })) {
      const e = coverBest(b, p);
      if (e >= 0) perEntry[e]!.push(p);
      // no entry's marker covers it, but it is the size of a few markers (two of a kind no entry names, drawn over each
      // other): the entry it is most like, and doubtful. Larger (the plot's frame, a line) it is no marker.
      else if (b.area <= FEW_MARKERS * maxTemplateArea) {
        perEntry[n.e]!.push(p);
        doubts.push({ entry: n.e, like: n.second, ratio: Math.max(n.ratio, DOUBT + 1e-9), at: p });
      }
    }
  });
  for (const pts of perEntry) pts.sort((a, b) => a.x - b.x || a.y - b.y);

  const doubtful: MarkerSeriesPlan['doubtful'] = [];
  for (let e = 0; e < perEntry.length; e++) {
    const mine = doubts.filter((d) => d.entry === e);
    if (!mine.length) continue;
    const likes = new Map<number, number>();
    for (const d of mine) likes.set(d.like, (likes.get(d.like) ?? 0) + 1);
    const like = [...likes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
    const most = mine.reduce((a, d) => (d.ratio > a.ratio ? d : a));
    doubtful.push({ entry: e, count: mine.length, like, at: most.at });
  }
  const empty = perEntry.map((p, e) => (p.length || sameMarkerAs.some((x) => x.entry === e) ? -1 : e)).filter((e) => e >= 0);
  return { told: true, perEntry, doubtful, empty, unmeasured, sameMarkerAs };
}

/**
 * On a figure drawn in a PDF, each point at its marker's centre in the drawing (as Colour trace reads one ink alone),
 * the entry still the one the pixels said: each drawn marker goes to the entry of the nearest point read. The code
 * review of 666ea46..7d5c927 (2026-11-05): one ink shared, the points were the pixels' alone.
 */
export function onDrawnMarkers(perEntry: readonly (readonly Point2D[])[], drawn: readonly (readonly [number, number])[]): Point2D[][] {
  const read = perEntry.flatMap((pts, e) => pts.map((p) => ({ p, e })));
  if (!read.length || !drawn.length) return perEntry.map((pts) => [...pts]);
  const out: Point2D[][] = perEntry.map(() => []);
  for (const [x, y] of drawn) {
    let best = read[0]!, bd = Infinity;
    for (const r of read) {
      const d = Math.hypot(r.p.x - x, r.p.y - y);
      if (d < bd) { bd = d; best = r; }
    }
    out[best.e]!.push({ x, y });
  }
  for (const pts of out) pts.sort((a, b) => a.x - b.x || a.y - b.y);
  return out;
}

/** What `fileMarkerSeries` needs of the session. */
export interface MarkerSeriesSession {
  getDatasetInfos(): { index: number; name: string; pointCount: number }[];
  getActiveDatasetIndex(): number;
  setActiveDataset(index: number): void;
  clearPoints(): void;
  addDataset(): number;
  renameDataset(index: number, name: string): string | null;
  setDatasetColor(index: number, rgb: RGB): void;
  addSegmentFillPoints(points: readonly Point2D[]): number;
  giveBackName(index: number, opts?: { relationsStay?: boolean }): void;
}

/**
 * Each entry's markers into its series: the first entry's into `into` (its step's own, already emptied and named), each
 * other's into the series of its name, emptied, or a new one. Read again, an entry's series is replaced as a whole:
 * one given nothing this time keeps no points from the time before, and gives its name back, as a line given to no
 * entry does (the code review of 666ea46..7d5c927, 2026-11-05: on a second press the others' series kept their old
 * points, and an entry given nothing kept an empty series of its name). `perEntry` null: the markers could not be
 * told apart, so the others' series are emptied and the first entry's is left to read by colour.
 * Returns, per entry, its points and a refusal of its name.
 */
export function fileMarkerSeries(
  s: MarkerSeriesSession,
  { into, names, colour, perEntry }: { into: number; names: readonly string[]; colour: RGB; perEntry: readonly (readonly Point2D[])[] | null }
): { points: number; refused: string | null; at: number }[] {
  const byName = (name: string) => s.getDatasetInfos().find((d) => d.index !== into && d.name.trim() === name)?.index ?? null;
  const empty = (i: number) => {
    s.setActiveDataset(i);
    if ((s.getDatasetInfos()[i]?.pointCount ?? 0) > 0) s.clearPoints();
  };
  const own = names.map((name, gi) => (gi === 0 ? into : byName(name)));
  for (const i of own.slice(1)) if (i !== null) empty(i);
  const out = names.map((): { points: number; refused: string | null; at: number } => ({ points: 0, refused: null, at: -1 }));
  names.forEach((name, gi) => {
    const pts = perEntry?.[gi] ?? [];
    let at: number | null = own[gi] ?? null;
    if (!pts.length) {
      // the first entry's series is read by colour when nothing could be told apart
      if (at !== null && (gi > 0 || perEntry)) s.giveBackName(at, { relationsStay: true });
      return;
    }
    if (at === null) at = s.addDataset();
    s.setActiveDataset(at);
    const refused = gi > 0 ? s.renameDataset(at, name) : null;
    s.setDatasetColor(at, colour);
    s.addSegmentFillPoints(pts);
    out[gi] = { points: pts.length, refused, at };
  });
  s.setActiveDataset(into);
  return out;
}

