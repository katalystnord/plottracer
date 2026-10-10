/**
 * L3 (v2.6): a coloured contour plot's colour key calibrates the level axis -
 * each line's level is where its own colour sits on the key. Measured on a
 * figure drawn like matplotlib draws one: `ax.contour(..., cmap='viridis')` and
 * `fig.colorbar(cs)`, whose key is a white bar crossed by one stroke per level.
 * Key corners and tick positions taken from an identical re-render of the
 * generator (plottracer-ref research/v2.6-curves/contour/gen_contours.py).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { readPng } from '../../engine/__tests__/helpers/readPng.js';
import { readLineKey, keyPosition, keyPositionOfColour, keyValueAt, lineInkColour } from '../findLines/lineKey.js';

const FIX = join(__dirname, 'fixtures', 'findLines', 'contour-coloured-key');
const t = JSON.parse(readFileSync(FIX + '.truth.json', 'utf8'));
const img = readPng(FIX + '.png');
const a = t.calibration.anchors;
const toPx = (x: number, y: number) => ({
  x: a.x1.px + (x - a.x1.value) * ((a.x2.px - a.x1.px) / (a.x2.value - a.x1.value)),
  y: a.y1.py + (y - a.y1.value) * ((a.y2.py - a.y1.py) / (a.y2.value - a.y1.value)),
});
const CORNER_A: [number, number] = [761, 39.5];
const CORNER_B: [number, number] = [790.8, 636.7];
const TICK_14: [number, number] = [775.9, 636.72];
const TICK_34: [number, number] = [775.9, 93.64];

describe('L3 the colour key gives each line its level', () => {
  it('L3 every line\'s level is read off the key, to within a tenth of a step', () => {
    const key = readLineKey(img.data, img.width, img.height, CORNER_A, CORNER_B)!;
    expect(key).not.toBeNull();
    const ta = { t: keyPosition(key, TICK_14), value: 14 }, tb = { t: keyPosition(key, TICK_34), value: 34 };
    let checked = 0;
    for (const L of t.lines as { level: number; points: [number, number][] }[]) {
      if (L.points.length < 20) continue;
      const pts = L.points.map(([x, y]) => toPx(x, y));
      const ink = lineInkColour(img.data, img.width, img.height, pts)!;
      const pos = keyPositionOfColour(key, ink);
      expect(pos, `level ${L.level} found on the key`).not.toBeNull();
      expect(Math.abs(keyValueAt(pos!, ta, tb, false)! - L.level), `level ${L.level}`).toBeLessThan(0.2);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('L3 a colour that is not on the key gets no level', () => {
    const key = readLineKey(img.data, img.width, img.height, CORNER_A, CORNER_B)!;
    expect(keyPositionOfColour(key, [220, 30, 30])).toBeNull();
  });

  it('L3 on a log level axis the same position reads in log steps', () => {
    expect(keyValueAt(0.5, { t: 0, value: 1 }, { t: 1, value: 100 }, true)).toBeCloseTo(10, 9);
    expect(keyValueAt(0.5, { t: 0, value: 1 }, { t: 1, value: 100 }, false)).toBeCloseTo(50.5, 9);
  });
});

describe('F11 on a plot whose levels each have their own colour', () => {
  it('F11 one picked colour finds that level\'s lines, and no other level\'s', async () => {
    const { findLines } = await import('../findLines/lines.js');
    const box = { x0: a.x1.px, y0: a.y2.py, x1: a.x2.px, y1: a.y1.py };
    const res = findLines(img.data, img.width, img.height, [0x25, 0x85, 0x8e], box, { contour: true, coloursAreLevels: true });
    const near = (p: { x: number; y: number }, set: { x: number; y: number }[]) => set.some((q) => Math.hypot(p.x - q.x, p.y - q.y) <= 2.5);
    const byLevel = new Map<number, { x: number; y: number }[]>();
    for (const L of t.lines as { level: number; points: [number, number][] }[]) {
      const pts = L.points.map(([x, y]) => toPx(x, y));
      byLevel.set(L.level, [...(byLevel.get(L.level) ?? []), ...pts]);
    }
    const long = res.lines.filter((L) => L.points.length >= 20);
    // every line of the level, and nothing else (audit B9: > 0 passed with one missing)
    const n24 = (t.lines as { level: number; points: unknown[] }[]).filter((l) => l.level === 24 && l.points.length >= 20).length;
    expect(long.length).toBe(n24);
    const all = res.lines.flatMap((L) => L.points.map(([x, y]) => ({ x, y })));
    const cover = byLevel.get(24)!.filter((p) => near(p, all)).length / byLevel.get(24)!.length;
    expect(cover).toBeGreaterThan(0.95);
    for (const L of long) {
      const pts = L.points.map(([x, y]) => ({ x, y })).filter((_, i) => L.roles[i] === 'measured');
      const on24 = pts.filter((p) => near(p, byLevel.get(24)!)).length / pts.length;
      expect(on24, 'a found line is the picked level\'s').toBeGreaterThan(0.9);
    }
  });
});
