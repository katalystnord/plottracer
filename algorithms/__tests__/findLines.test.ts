/**
 * Find lines - the agreed cases (docs/v2.6-curves-cases.md, F/S/N), each a test
 * of the same name, measured against PIXEL TRUTH: every line's vertices as the
 * generator drew them, before any label cut them.
 *
 * Figures: the bundled contour example (samples/), and two same-colour curve
 * figures from the research sets (plottracer-ref, research/v2.6-separation),
 * copied in with their truth.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { readPng } from '../../engine/__tests__/helpers/readPng.js';
import { findLines, type FindLinesResult } from '../findLines/lines.js';
import type { Pt } from '../findLines/geom.js';

const ROOT = join(__dirname, '..', '..');
const FIX = join(__dirname, 'fixtures', 'findLines');
const TOL = 2.5;

function densify(p: readonly Pt[]): Pt[] {
  const out: Pt[] = p.length ? [p[0]!] : [];
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!, b = p[i]!;
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
const near = (p: Pt, set: readonly Pt[]): boolean => set.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= TOL);
const share = (a: readonly Pt[], b: readonly Pt[]): number => a.filter((p) => near(p, b)).length / a.length;

interface Fig {
  res: FindLinesResult;
  truth: { level?: number; closed?: boolean; points: Pt[] }[];
  box: { x0: number; y0: number; x1: number; y1: number };
}

/** The bundled contour example, its truth turned into pixels through its own anchors. */
function bundled(): Fig {
  const base = join(ROOT, 'samples', 'contour-potential-energy');
  const t = JSON.parse(readFileSync(base + '.truth.json', 'utf8'));
  const a = t.calibration.anchors;
  const sx = (a.x2.px - a.x1.px) / (a.x2.value - a.x1.value);
  const sy = (a.y2.py - a.y1.py) / (a.y2.value - a.y1.value);
  const truth = t.series.map((s: { level: number; closed: boolean; points: { x: number; y: number }[] }) => ({
    level: s.level,
    closed: s.closed,
    points: s.points.map((p) => [a.x1.px + (p.x - a.x1.value) * sx, a.y1.py + (p.y - a.y1.value) * sy] as Pt),
  }));
  const box = { x0: a.x1.px, y0: a.y2.py, x1: a.x2.px, y1: a.y1.py };
  const img = readPng(base + '.png');
  return { res: findLines(img.data, img.width, img.height, [0x22, 0x22, 0x22], box, { contour: true }), truth, box };
}

function research(name: string): Fig {
  const t = JSON.parse(readFileSync(join(FIX, name + '.truth.json'), 'utf8'));
  const [x0, y0, x1, y1] = t.box;
  const c = t.colour === 'black' ? '#000000' : (t.colour as string);
  const img = readPng(join(FIX, name + '.png'));
  const rgb: [number, number, number] = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const res = findLines(img.data, img.width, img.height, rgb, { x0, y0, x1, y1 }, { contour: String(t.kind).startsWith('contour') });
  return { res, truth: t.lines, box: { x0, y0, x1, y1 } };
}

/** For each truth line: the output line that covers >= 90% of it, if one does. */
function wholeLines(f: Fig): (number | null)[] {
  return f.truth.map((T) => {
    const td = densify(T.points);
    const i = f.res.lines.findIndex((L) => share(td, densify(L.points)) >= 0.9);
    return i >= 0 ? i : null;
  });
}

describe('Find lines on the bundled contour example (same-colour contours, labelled)', () => {
  let f: Fig;
  beforeAll(() => {
    f = bundled();
  });

  it('F1 one press finds every line, each as its own line', () => {
    const whole = wholeLines(f);
    expect(whole.every((i) => i !== null)).toBe(true);
    expect(new Set(whole).size).toBe(f.truth.length);
    expect(f.res.lines.length).toBe(f.truth.length);
  });

  it('F2 never two lines in one', () => {
    expect(f.res.lines.length).toBe(f.truth.length);
    const truthD = f.truth.map((T) => densify(T.points));
    for (const L of f.res.lines) {
      const d = densify(L.points);
      const best = Math.max(...truthD.map((T) => share(d, T)));
      expect(best).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('F3 never the frame: no point outside the plot box', () => {
    expect(f.res.lines.length).toBe(f.truth.length);
    for (const L of f.res.lines) {
      for (const [x, y] of L.points) {
        expect(x).toBeGreaterThan(f.box.x0);
        expect(x).toBeLessThan(f.box.x1);
        expect(y).toBeGreaterThan(f.box.y0);
        expect(y).toBeLessThan(f.box.y1);
      }
    }
  });

  it('F4 a line cut by its own label is ONE line, the gap filled with bridged points', () => {
    expect(f.res.lines.length).toBe(f.truth.length);
    // every line on this figure carries an inline label, so every line has a bridged stretch
    for (const L of f.res.lines) expect(L.roles.includes('bridged')).toBe(true);
    expect(f.res.lines.every((L) => L.gaps.length >= 1)).toBe(true);
  });

  it('F7 label text is not data, and it is not hidden', () => {
    // reported: there is label ink, and it sits IN a label gap - beside bridged points
    expect(f.res.labelInk.length).toBeGreaterThan(0);
    const bridged = f.res.lines.flatMap((L) => L.points.filter((_, i) => L.roles[i] === 'bridged'));
    for (const ink of f.res.labelInk) {
      const c: Pt = [ink.reduce((s, p) => s + p[0], 0) / ink.length, ink.reduce((s, p) => s + p[1], 0) / ink.length];
      expect(bridged.some((b) => Math.hypot(b[0] - c[0], b[1] - c[1]) < 15)).toBe(true);
    }
    // not data: no point of a line is a point of the label ink
    const inkKeys = new Set(f.res.labelInk.flat().map((p) => `${p[0]},${p[1]}`));
    for (const L of f.res.lines) for (const p of L.points) expect(inkKeys.has(`${p[0]},${p[1]}`)).toBe(false);
  });

  it('F8 a loop is recorded closed, measured from the ink; an open line is not', () => {
    const whole = wholeLines(f);
    f.truth.forEach((T, ti) => expect(f.res.lines[whole[ti]!]!.closed).toBe(!!T.closed));
  });

  it('S1 each line is ordered along itself, so it is continuous', () => {
    expect(f.res.lines.length).toBe(f.truth.length);
    for (const L of f.res.lines) {
      for (let i = 1; i < L.points.length; i++) {
        const step = Math.hypot(L.points[i]![0] - L.points[i - 1]![0], L.points[i]![1] - L.points[i - 1]![1]);
        expect(step).toBeLessThan(3);
      }
    }
  });

  it('S2 a bridged point says so; a measured point lies on the ink', () => {
    expect(f.res.lines.length).toBe(f.truth.length);
    const truthD = f.truth.map((T) => densify(T.points));
    for (const L of f.res.lines) {
      expect(L.roles.length).toBe(L.points.length);
      const measured = L.points.filter((_, i) => L.roles[i] === 'measured');
      const T = truthD.find((t) => share(densify(L.points), t) >= 0.9)!;
      expect(share(measured, T)).toBeGreaterThanOrEqual(0.99);
    }
  });

  it('S4 a closed line ends on its first point', () => {
    expect(f.res.lines.length).toBe(f.truth.length);
    expect(f.res.lines.some((x) => x.closed)).toBe(true);
    for (const L of f.res.lines.filter((x) => x.closed)) {
      expect(L.points[L.points.length - 1]).toEqual(L.points[0]);
    }
  });
});

describe('Find lines on same-colour curves', () => {
  it('F1/F2 curves that cross are each found whole, and none switches curves at the crossing', () => {
    const f = research('k-cross-0');
    const whole = wholeLines(f);
    expect(whole.every((i) => i !== null)).toBe(true);
    const truthD = f.truth.map((T) => densify(T.points));
    for (const L of f.res.lines.filter((x) => x.points.length >= 10)) {
      expect(Math.max(...truthD.map((T) => share(densify(L.points), T)))).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('N5 a stretch two curves run along together belongs to BOTH, its points marked shared', () => {
    const f = research('k-runalong-3');
    const whole = wholeLines(f);
    expect(whole.every((i) => i !== null)).toBe(true);
    const a = f.res.lines[whole[0]!]!, b = f.res.lines[whole[1]!]!;
    expect(a.roles.includes('shared')).toBe(true);
    expect(b.roles.includes('shared')).toBe(true);
  });
});
