/**
 * Levels as a FIELD, not one label at a time (C4 interpolation, L4 and N2/N3
 * refusals).
 *
 * Contour lines never cross, so walking straight out from a line, the lines met
 * come in order. A TRANSECT from line u lists the lines met on each side.
 *
 *  step     the level step, from read labels of neighbouring lines
 *  even?    if two read levels are not a whole number of steps apart, the levels
 *           are UNEVEN (N3): nothing is interpolated, and the screen says so
 *  check    a read that disagrees with every read neighbour, or that the field
 *           around it contradicts, is REFUSED with its reason - never changed
 *  between  an unlabelled line with labelled lines either side, at depths d1 and
 *           d2, gets la + (lb - la) * d1 / (d1 + d2) when three transects agree
 *           and the spacing is one step per line crossed
 */
import type { Pt } from './geom.js';

export interface LevelInput {
  points: readonly Pt[];
  /** The level read from the line's label, or null. */
  read: number | null;
}

export interface LevelOutcome {
  value: number | null;
  source: 'label' | 'interpolated' | null;
  /** A read that was refused, and why. */
  refused: { read: number; why: string } | null;
}

export interface LevelField {
  levels: LevelOutcome[];
  step: number | null;
  /** Set when the read levels are uneven, saying which two. */
  uneven: string | null;
}

function raster(lines: readonly LevelInput[], w: number, h: number): Int32Array {
  const img = new Int32Array(w * h);
  lines.forEach((L, k) => {
    const p = L.points;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1]!, b = p[i]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
      for (let s = 0; s <= n; s++) {
        const x = Math.round(a[0] + ((b[0] - a[0]) * s) / n), y = Math.round(a[1] + ((b[1] - a[1]) * s) / n);
        if (x >= 0 && y >= 0 && x < w && y < h) img[y * w + x] = k + 1;
      }
    }
  });
  // thicken by one pixel so a ray cannot slip through a diagonal
  const out = new Int32Array(img);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (img[y * w + x]) continue;
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) m = Math.max(m, img[yy * w + xx]!);
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

function transects(lines: readonly LevelInput[], w: number, h: number, every = 12, reach = 400, depth = 4): number[][][][] {
  const img = raster(lines, w, h);
  return lines.map((L, k) => {
    const p = L.points;
    const out: number[][][] = [];
    if (p.length < 6) return out;
    for (let i = 3; i < p.length - 3; i += Math.max(1, every)) {
      const a = p[Math.min(i + 3, p.length - 1)]!, b = p[Math.max(i - 3, 0)]!;
      const tx = a[0] - b[0], ty = a[1] - b[1];
      const n = Math.hypot(tx, ty);
      if (n === 0) continue;
      const nx = -ty / n, ny = tx / n;
      const sides: number[][] = [];
      for (const sgn of [1, -1]) {
        const seq: number[] = [];
        let last = k + 1;
        for (let r = 2.0; r < reach; r += 0.7) {
          const x = Math.round(p[i]![0] + sgn * r * nx), y = Math.round(p[i]![1] + sgn * r * ny);
          if (x < 0 || y < 0 || x >= w || y >= h) break;
          const v = img[y * w + x]!;
          if (v && v !== last) {
            if (v - 1 === k) break; // back to itself (a loop)
            seq.push(v - 1);
            last = v;
            if (seq.length >= depth) break;
          }
        }
        sides.push(seq);
      }
      out.push(sides);
    }
    return out;
  });
}

const r9 = (x: number): number => Math.round(x * 1e9) / 1e9;

function mode(vals: number[]): { best: number; count: number } {
  const cnt = new Map<number, number>();
  for (const v of vals) cnt.set(v, (cnt.get(v) ?? 0) + 1);
  let best = vals[0]!, count = 0;
  for (const [v, c] of [...cnt.entries()].sort((a, b) => a[0] - b[0])) if (c > count) {
    best = v;
    count = c;
  }
  return { best, count };
}

export function inferLevels(lines: readonly LevelInput[], w: number, h: number, minTransects = 3): LevelField {
  const tr = transects(lines, w, h);
  const out: LevelOutcome[] = lines.map((L) => ({ value: L.read, source: L.read === null ? null : 'label', refused: null }));
  let lev = new Map<number, number>();
  const refresh = (): void => {
    lev = new Map();
    out.forEach((o, k) => {
      if (o.value !== null) lev.set(k, o.value);
    });
  };
  refresh();
  // --- step: the commonest difference between read FIRST neighbours
  const diffs: number[] = [];
  for (const [k, v] of lev) {
    for (const sides of tr[k]!) for (const seq of sides) {
      if (seq.length && lev.has(seq[0]!)) {
        const d = Math.abs(lev.get(seq[0]!)! - v);
        if (d > 1e-9) diffs.push(r9(d));
      }
    }
  }
  let step: number | null = diffs.length ? mode(diffs).best : null;
  let uneven: string | null = null;
  // UNEVEN when neighbouring read lines do not mostly differ by one step: 1, 2, 5,
  // 20 are all whole steps of 1 apart, but neighbours 3 and 15 steps apart say the
  // levels are values, not a grid (C5, N3). One misread among many leaves the
  // step's majority intact.
  if (step && mode(diffs).count < 0.5 * diffs.length) {
    const other = [...new Set(diffs)].filter((d) => Math.abs(d - step!) > 1e-9).sort((a, b) => a - b);
    uneven = `neighbouring levels differ by ${step} in some places and ${other.join(', ')} in others`;
    step = null;
  }
  if (step) {
    const vals = [...new Set(lev.values())].sort((a, b) => a - b);
    outer: for (const a of vals) for (const b of vals) {
      const n = (b - a) / step;
      if (Math.abs(n - Math.round(n)) > 0.01) {
        uneven = `the read levels ${a} and ${b} are not a whole number of steps of ${step} apart`;
        step = null;
        break outer;
      }
    }
  }
  const refuse = (k: number, why: string): void => {
    out[k] = { value: null, source: null, refused: { read: lev.get(k)!, why } };
  };
  if (step) {
    const s = step;
    for (const k of [...lev.keys()]) {
      let agree = 0, disagree = 0;
      const seen = new Set<number>();
      for (const sides of tr[k]!) for (const seq of sides) {
        if (seq.length && lev.has(seq[0]!) && !seen.has(seq[0]!)) {
          seen.add(seq[0]!);
          const d = Math.abs(lev.get(seq[0]!)! - lev.get(k)!);
          if (d < 1e-6 || Math.abs(d - s) < 1e-6 * Math.max(1, s)) agree++;
          else disagree++;
        }
      }
      if (disagree >= 2 && agree === 0) refuse(k, 'it disagrees with every read neighbour');
    }
    refresh();
    // a READ the field around it contradicts
    const fieldRefusals: [number, string][] = [];
    for (const k of [...lev.keys()]) {
      const ests: number[] = [];
      for (const [plus, minus] of tr[k]!) {
        const a = plus!.map((j, d) => [d + 1, j] as const).find(([, j]) => lev.has(j) && j !== k);
        const b = minus!.map((j, d) => [d + 1, j] as const).find(([, j]) => lev.has(j) && j !== k);
        if (!a || !b) continue;
        const la = lev.get(a[1])!, lb = lev.get(b[1])!;
        if (Math.abs(la - lb) < 1e-12) continue;
        const ns = Math.abs(lb - la) / s;
        if (Math.abs(ns - Math.round(ns)) > 0.01 || Math.round(ns) !== a[0] + b[0]) continue;
        ests.push(r9(la + ((lb - la) * a[0]) / (a[0] + b[0])));
      }
      if (ests.length >= 3) {
        const { best, count } = mode(ests);
        if (count >= 0.7 * ests.length && Math.abs(best - lev.get(k)!) > 1e-6 * Math.max(1, Math.abs(best))) fieldRefusals.push([k, `the lines around it say ${best}`]);
      }
    }
    for (const [k, why] of fieldRefusals) refuse(k, why);
    refresh();
  }
  // --- between labelled lines, and beyond the last one - only with a KNOWN step
  if (step) {
    const s = step;
    lines.forEach((_, k) => {
      if (lev.has(k)) return;
      const ests: number[] = [];
      for (const [plus, minus] of tr[k]!) {
        const a = plus!.map((j, d) => [d + 1, j] as const).find(([, j]) => lev.has(j));
        const b = minus!.map((j, d) => [d + 1, j] as const).find(([, j]) => lev.has(j));
        if (!a || !b) continue;
        const la = lev.get(a[1])!, lb = lev.get(b[1])!;
        if (Math.abs(la - lb) < 1e-12) continue;
        const ns = Math.abs(lb - la) / s;
        if (Math.abs(ns - Math.round(ns)) > 0.01 || Math.round(ns) !== a[0] + b[0]) continue;
        ests.push(r9(la + ((lb - la) * a[0]) / (a[0] + b[0])));
      }
      if (!ests.length) {
        // ⚑ BEYOND means beyond: only where the OTHER side of the line has no
        // labelled line at all. A line between 10 and 1000 whose spacing refused
        // interpolation above is not "past" 1 and 10 - carrying their step on
        // gave it 19 (found by L2's own test).
        for (const sides of tr[k]!) for (let si = 0; si < sides.length; si++) {
          const seq = sides[si]!;
          const other = sides[1 - si] ?? [];
          if (other.some((j) => lev.has(j))) continue;
          const lab = seq.map((j, d) => [d + 1, j] as const).filter(([, j]) => lev.has(j));
          if (lab.length < 2) continue;
          const [d1, j1] = lab[0]!, [d2, j2] = lab[1]!;
          const la = lev.get(j1)!, lc = lev.get(j2)!;
          const per = (lc - la) / (d2 - d1);
          if (Math.abs(Math.abs(per) - s) > 1e-6 * Math.max(1, s) || Math.abs(per) < 1e-12) continue;
          ests.push(r9(la - per * d1));
        }
      }
      if (ests.length >= minTransects) {
        const { best, count } = mode(ests);
        if (count >= 0.7 * ests.length) out[k] = { value: best, source: 'interpolated', refused: out[k]!.refused };
      }
    });
  }
  return { levels: out, step, uneven };
}

/**
 * L2 (v2.6): interpolation in the LEVEL AXIS'S OWN SCALE. On a log level axis
 * equal steps are equal in log10, so one unlabelled line between 1 and 100 is
 * 10, not 50.5. Levels of 0 or below cannot sit on a log axis and are refused
 * before anything is inferred.
 */
export function inferLevelsInScale(lines: readonly LevelInput[], w: number, h: number, log: boolean, minTransects = 3): LevelField | { error: string } {
  if (!log) return inferLevels(lines, w, h, minTransects);
  const bad = lines.map((l) => l.read).filter((v): v is number => v !== null && v <= 0);
  if (bad.length) return { error: `a log level axis cannot hold ${bad[0]} - only levels above 0` };
  const f = inferLevels(lines.map((l) => ({ points: l.points, read: l.read === null ? null : Math.log10(l.read) })), w, h, minTransects);
  // back to the axis's own values, rounded so 10^2 reads 100 and not 99.99999999999997
  const back = (v: number): number => Number(Math.pow(10, v).toPrecision(12));
  return {
    step: f.step === null ? null : f.step,
    // the message is about the levels the user sees, not their log10 (audit D3)
    uneven: f.uneven ? `the levels ${[...new Set(lines.map((l) => l.read).filter((v): v is number => v !== null))].sort((x, y) => x - y).join(', ')} are not equal steps on a log scale` : null,
    levels: f.levels.map((o, k) => ({
      value: o.value === null ? null : o.source === 'label' ? lines[k]!.read : back(o.value),
      source: o.source,
      refused: o.refused ? { read: lines[k]!.read ?? back(o.refused.read), why: o.refused.why } : null,
    })),
  };
}
