/**
 * A LINE'S STYLE, MEASURED (v2.7; docs/v2.7-workflow-walk.md, "Series told apart by their line style").
 *
 * Where a figure's series share one ink, the line style is what tells them apart, and the legend says which style is
 * which series. The generators define a style as an on/off sequence along the line, scaled by its width (matplotlib's
 * `(offset, (on, off, ...))`, R's and ggplot2's hex strings "44", "13", "1343"), so that is what is measured here, the
 * same way on a legend sample and on a found line: walk the path a pixel at a time and note where the ink is.
 *
 * Measured the same way on both, because a found line's own record would not do: its centreline stops about half a
 * width short of each dash's end, so its dashes measure shorter than the legend's.
 *
 * What is compared is what survives drawing:
 *   - solid or broken;
 *   - one kind of mark or two (a dash-dot draws a long and a short one);
 *   - the PERIOD, one mark and one gap (or, with two kinds, a whole cycle), which anti-aliasing and the ink's
 *     rendered thickness do not change;
 *   - the DUTY, the share of the period that is ink (ggplot2's "22" and "13" have the same period and differ only here).
 */
export type RGB = readonly [number, number, number];
type Pt = readonly [number, number];

export interface LineStyle {
  /** Ink all along: no gap inside the path. */
  solid: boolean;
  /** The marks come in two lengths (a dash and a dot). Null when too few were seen to say. */
  twoKinds: boolean | null;
  /** One mark and one gap, or a whole cycle when there are two kinds, px. Null when solid or too few were seen. */
  period: number | null;
  /** The share of the period that is ink, 0-1. Null when solid or too few were seen. */
  duty: number | null;
  /** How many whole marks the measurement rests on. */
  marks: number;
}

/** Ink of `ink` against `paper` at a pixel: at least half-way from the paper to the ink, and on that mix. Exact to the
 * pixel: a tolerance ALONG a path would close a dashed line's gaps (matplotlib's '--' at 100 dpi leaves about 3 px), so
 * the tolerance is across it, in `runsAlong`. */
export function inkTest(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, ink: RGB, paper: RGB): (x: number, y: number) => boolean {
  const d = [ink[0] - paper[0], ink[1] - paper[1], ink[2] - paper[2]] as const;
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
  const at = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = (y * w + x) * 4;
    const v = [rgba[i]! - paper[0], rgba[i + 1]! - paper[1], rgba[i + 2]! - paper[2]];
    const a = (v[0]! * d[0] + v[1]! * d[1] + v[2]! * d[2]) / dd;
    if (a < 0.35) return false;
    const r = Math.hypot(v[0]! - a * d[0], v[1]! - a * d[1], v[2]! - a * d[2]);
    return r < 60;
  };
  return (x, y) => at(Math.round(x), Math.round(y));
}

/** The paper a figure is drawn on: its commonest colour (in steps of 8). */
export function paperColour(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): RGB {
  const hist = new Map<number, number>();
  for (let i = 0; i < w * h; i += 3) {
    const k = ((rgba[i * 4]! >> 3) << 10) | ((rgba[i * 4 + 1]! >> 3) << 5) | (rgba[i * 4 + 2]! >> 3);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  let top = 0, best = -1;
  for (const [k, n] of hist) if (n > best) { best = n; top = k; }
  return [((top >> 10) & 31) * 8 + 4, ((top >> 5) & 31) * 8 + 4, (top & 31) * 8 + 4];
}

/** The ink and gap runs along a path, in px of arc length, the first and last left out (they are cut by the path's
 * ends). */
export function runsAlong(path: readonly Pt[], ink: (x: number, y: number) => boolean): { on: number[]; off: number[]; startsOn: boolean; allOn: number[]; length: number } {
  const samples: boolean[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(L));
    // across the path, a pixel either side: a path is a centreline, and ink one pixel off it is still the line
    const nx = L > 0 ? -(b[1] - a[1]) / L : 0, ny = L > 0 ? (b[0] - a[0]) / L : 1;
    for (let s = 0; s < n; s++) {
      const x = a[0] + ((b[0] - a[0]) * s) / n, y = a[1] + ((b[1] - a[1]) * s) / n;
      samples.push(ink(x, y) || ink(x + nx, y + ny) || ink(x - nx, y - ny));
    }
  }
  const runs: { on: boolean; n: number }[] = [];
  for (const v of samples) {
    const last = runs[runs.length - 1];
    if (last && last.on === v) last.n++;
    else runs.push({ on: v, n: 1 });
  }
  const inner = runs.slice(1, -1);
  return {
    on: inner.filter((r) => r.on).map((r) => r.n),
    off: inner.filter((r) => !r.on).map((r) => r.n),
    startsOn: inner[0]?.on ?? true,
    // every ink run, the cut ones at the ends too, and the whole length: what "mostly unbroken" is judged on
    allOn: runs.filter((r) => r.on).map((r) => r.n),
    length: samples.length,
  };
}

const median = (v: readonly number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** The style of a path's runs. A gap of one pixel is anti-aliasing, not a gap. */
export function styleOfRuns(runs: { on: number[]; off: number[]; allOn?: number[]; length?: number }): LineStyle {
  const off = runs.off.filter((g) => g > 1);
  const total = runs.on.reduce((s, v) => s + v, 0) + runs.off.reduce((s, v) => s + v, 0);
  if (!off.length || off.reduce((s, v) => s + v, 0) < 0.03 * total) return { solid: true, twoKinds: false, period: null, duty: null, marks: runs.on.length };
  const on = runs.on;
  // MOSTLY UNBROKEN IS SOLID. A solid line that took a wrong turn at a crossing and followed a dotted one for a
  // stretch has a dozen dots and one 650 px run (crossing-mpl4, Series A): the style is where most of its length is.
  // Runs far longer than the line's typical mark (over 40 px and six times it) covering most of it make it solid.
  const all = runs.allOn ?? on;
  const typical = median(on.length ? on : all);
  const long = all.filter((r) => r > Math.max(40, 6 * typical)).reduce((s2, r) => s2 + r, 0);
  if (long >= 0.6 * (runs.length ?? total)) return { solid: true, twoKinds: false, period: null, duty: null, marks: on.length };
  if (on.length < 2) return { solid: false, twoKinds: null, period: null, duty: null, marks: on.length };
  const sorted = [...on].sort((a, b) => a - b);
  // two kinds: the marks split into a short and a long group, each at least a quarter of them, the long ones over
  // twice the short ones
  let twoKinds = false;
  let shortM = median(on), longM = shortM;
  // two marks are enough to SEE two kinds (a legend sample often shows one dash and one dot), not to rule them out
  if (on.length === 2) {
    const [a, b] = sorted as [number, number];
    if (b / Math.max(1, a) > 2 && b - a >= 3) {
      const g = median(off);
      return { solid: false, twoKinds: true, period: a + b + 2 * g, duty: (a + b) / (a + b + 2 * g), marks: 2 };
    }
  }
  if (on.length >= 3) {
    let bestGap = 0;
    for (let k = 1; k < sorted.length; k++) {
      const lo = sorted.slice(0, k), hi = sorted.slice(k);
      if (lo.length < on.length / 4 || hi.length < on.length / 4) continue;
      const r = median(hi) / Math.max(1, median(lo));
      // and longer by 3 px at least: a dot drawn 1 px long beside one drawn 3 px long is one kind, rasterised twice
      if (r > 2 && median(hi) - median(lo) >= 3 && r > bestGap) {
        bestGap = r;
        shortM = median(lo);
        longM = median(hi);
      }
    }
    twoKinds = bestGap > 0;
  }
  const g = median(off);
  const period = twoKinds ? shortM + longM + 2 * g : median(on) + g;
  const duty = twoKinds ? (shortM + longM) / period : median(on) / period;
  return { solid: false, twoKinds: on.length >= 3 ? twoKinds : null, period, duty, marks: on.length };
}

/** A path's style, from the ink along it. */
export function styleAlong(path: readonly Pt[], ink: (x: number, y: number) => boolean): LineStyle {
  return styleOfRuns(runsAlong(path, ink));
}

/**
 * A legend sample's style: along the row of the sample box that carries the most ink, the full width of the box.
 * Null when the box holds no ink at all.
 */
export function styleOfSample(box: { x0: number; y0: number; x1: number; y1: number }, ink: (x: number, y: number) => boolean): LineStyle | null {
  let bestY = -1, best = 0;
  for (let y = Math.floor(box.y0); y <= Math.ceil(box.y1); y++) {
    let n = 0;
    for (let x = Math.floor(box.x0); x <= Math.ceil(box.x1); x++) if (ink(x, y)) n++;
    if (n > best) {
      best = n;
      bestY = y;
    }
  }
  if (bestY < 0) return null;
  // the sample's own ends are not cut by anything, so the path runs a pixel past them on paper either side
  return styleAlong([[Math.floor(box.x0) - 2, bestY], [Math.ceil(box.x1) + 2, bestY]], ink);
}

/**
 * How unlike two styles are: 0 the same, larger the more unlike. A feature either side could not measure does not
 * count; a solid line against a broken one is as unlike as styles get.
 */
export function styleDistance(a: LineStyle, b: LineStyle): number {
  if (a.solid !== b.solid) return 10;
  if (a.solid) return 0;
  let d = 0;
  if (a.twoKinds !== null && b.twoKinds !== null && a.twoKinds !== b.twoKinds) d += 3;
  if (a.period !== null && b.period !== null) d += Math.abs(Math.log(a.period / b.period)) / Math.log(1.25);
  if (a.duty !== null && b.duty !== null) d += Math.abs(a.duty - b.duty) / 0.12;
  return d;
}

/** How many marks a line needs before its own style is trusted as a reference for others. */
const WELL_MEASURED = 8;
/** Lines this alike are one style. Kept tight: 1.5 merged ggplot2's dashed and dot-dash at 0.8 pt, which measure
 * close on so thin a line. A style measured twice into two groups (a dotted curve at period 8 and a piece of it at
 * 7) is put back together after the pairing, by the group left over going to the entry it is clearly nearest. */
const SAME_STYLE = 1.0;
/** The furthest a legend sample may be from the style it is given: samples are short, so this is loose. */
const ENTRY_REACH = 4.0;
/** A short line goes to a style only if it is this near it and nearer than to any other by `SAME_STYLE`. */
const SHORT_REACH = 2.5;

/**
 * Which legend entry each line is, or null where that cannot be said with confidence.
 *
 * ⚑ THE LINES ARE COMPARED WITH THE LINES FIRST. A legend sample is short (matplotlib draws it two font sizes long:
 * a cycle or two of pattern), while a found line carries dozens of marks, so the lines measure their styles far
 * better than the samples do. The well-measured lines are grouped by style; the GROUPS are then paired with the
 * entries, choosing the pairing with the least total difference over all of them, so a sample that sits between two
 * styles is settled by the others; and a short piece goes to the group whose style it shares, never to a sample.
 * A group no entry is near, and a piece near no group, stay unassigned: a place to check.
 */
export function assignStyles(lines: readonly LineStyle[], entries: readonly (LineStyle | null)[]): (number | null)[] {
  const out: (number | null)[] = lines.map(() => null);
  // 1. group the well-measured lines (solid lines are well-measured by being long and unbroken)
  const firm = lines.map((s, i) => [s, i] as const).filter(([s]) => s.solid || s.marks >= WELL_MEASURED);
  const groups: { rep: LineStyle; members: number[] }[] = [];
  for (const [s, i] of [...firm].sort((a, b) => b[0].marks - a[0].marks)) {
    const g = groups.find((q) => styleDistance(q.rep, s) < SAME_STYLE);
    if (g) g.members.push(i);
    else groups.push({ rep: s, members: [i] });
  }
  // 2. pair groups with entries: the least total difference, a group or an entry left over costing ENTRY_REACH
  const E = entries.length, G = groups.length;
  // an entry whose sample could not be measured takes no group: nothing says a line is its
  const cost = (g: number, e: number): number => {
    const ent = entries[e];
    return ent ? styleDistance(groups[g]!.rep, ent) : Infinity;
  };
  let best: { total: number; pick: (number | null)[] } = { total: Infinity, pick: [] };
  const pick: (number | null)[] = Array(G).fill(null);
  const used = new Array<boolean>(E).fill(false);
  const search = (g: number, total: number): void => {
    if (total >= best.total) return;
    if (g === G) {
      // an entry left with no line is no cost: the figure may not draw it inside the plot
      best = { total, pick: [...pick] };
      return;
    }
    for (let e = 0; e < E; e++) {
      if (used[e]) continue;
      const c = cost(g, e);
      if (c > ENTRY_REACH) continue;
      used[e] = true;
      pick[g] = e;
      search(g + 1, total + c);
      used[e] = false;
      pick[g] = null;
    }
    pick[g] = null;
    search(g + 1, total + ENTRY_REACH);
  };
  if (G <= 9 && E <= 9) search(0, 0);
  else {
    // too many to try every pairing: the nearest pairs first, each group and entry once
    const pairs = groups.flatMap((_, g) => entries.map((__, e) => ({ g, e, c: cost(g, e) }))).filter((p) => p.c <= ENTRY_REACH).sort((a, b) => a.c - b.c);
    const taken = new Array<boolean>(E).fill(false);
    best = { total: 0, pick: Array(G).fill(null) };
    for (const { g, e } of pairs) {
      if (best.pick[g] !== null || taken[e]) continue;
      best.pick[g] = e;
      taken[e] = true;
    }
  }
  // a group the pairing left over is a style measured twice when it is clearly nearest one entry: it is that entry's
  // too (the dotted curve of the release figure came back as a long line at period 8 and a piece at period 7)
  const pickOf = best.pick.map((e, gi) => {
    if (e !== null && e !== undefined) return e;
    const d = entries.map((ent) => (ent ? styleDistance(groups[gi]!.rep, ent) : Infinity));
    const order = [...d.keys()].sort((a, b) => d[a]! - d[b]!);
    const first = order[0];
    if (first === undefined || d[first]! > ENTRY_REACH) return null;
    if (order.length > 1 && d[order[1]!]! - d[first]! < SAME_STYLE) return null;
    return first;
  });
  groups.forEach((g, gi) => {
    const e = pickOf[gi];
    if (e !== null && e !== undefined) for (const i of g.members) out[i] = e;
  });
  // 3. the short pieces, to the group whose style they share
  lines.forEach((s, i) => {
    if (s.solid || s.marks >= WELL_MEASURED) return;
    const d = groups.map((g) => styleDistance(s, g.rep));
    const order = [...d.keys()].sort((a, b) => d[a]! - d[b]!);
    const first = order[0];
    if (first === undefined || d[first]! > SHORT_REACH) return;
    if (order.length > 1 && d[order[1]!]! - d[first]! < SAME_STYLE) return;
    const e = pickOf[first];
    if (e !== null && e !== undefined) out[i] = e;
  });
  return out;
}

/** Can the entries be told apart by style at all? Pairs closer than `margin` cannot. */
export function stylesDistinct(entries: readonly LineStyle[], margin = SAME_STYLE): boolean {
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) if (styleDistance(entries[i]!, entries[j]!) < margin) return false;
  return true;
}
