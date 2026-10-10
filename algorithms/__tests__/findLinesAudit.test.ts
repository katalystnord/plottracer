/**
 * v2.6 audit, algorithm findings (reports/v2.6-audit-findings.md), each proved
 * by the reviewer and kept here as a test of the same name.
 */
import { describe, it, expect } from 'vitest';
import { uncross, unspiral, type FoundLine } from '../findLines/lines.js';
import { sampleInkRgb } from '../samplePixel.js';
import { readSlots } from '../findLines/labels.js';
import { keyValueAt, keyResolution } from '../findLines/lineKey.js';
import type { Pt } from '../findLines/geom.js';

const read = (text: string, confidence = 0.95) => ({ text, confidence });

describe('audit B4: a closed contour crossed at a bridge stays ONE line', () => {
  it('B4 uncross opens the loop at the wrong bridge instead of cutting it in two', () => {
    const sq: Pt[] = [];
    for (let x = 0; x <= 40; x++) sq.push([x, 0]);
    for (let y = 1; y <= 40; y++) sq.push([40, y]);
    for (let x = 39; x >= 0; x--) sq.push([x, 40]);
    for (let y = 39; y >= 0; y--) sq.push([0, y]);
    const roles = sq.map((_, i) => (i >= 15 && i <= 25 ? 'bridged' : 'measured') as FoundLine['roles'][number]);
    const loop: FoundLine = { points: sq, roles, closed: true, gaps: [] };
    const crossing: FoundLine = { points: [[20.5, -5], [20.5, 5]], roles: ['measured', 'measured'], closed: false, gaps: [] };
    const out = uncross([loop, crossing]);
    expect(out.filter((L) => L !== crossing).length).toBe(1);
  });
});

describe('audit B5: a loop unspiral closes is closed by a BRIDGE, marked so', () => {
  it('B5 the closing stretch is bridged points and a recorded gap, never a straight measured step', () => {
    const arc = (cx: number, from: number, to: number): Pt[] => {
      const p: Pt[] = [];
      for (let a = from; a <= to; a += 2) p.push([cx + 60 * Math.cos((a * Math.PI) / 180), 100 + 60 * Math.sin((a * Math.PI) / 180)]);
      return p;
    };
    const loopPart = arc(100, 20, 360); // nearly closed, ~25 px gap
    const tail = arc(300, 0, 700).map(([x, y]) => [x, y] as Pt);
    const bridge: Pt[] = [[205, 100], [230, 100]];
    const pts = [...loopPart, ...bridge, ...tail];
    const roles = pts.map((_, i) => (i >= loopPart.length && i < loopPart.length + bridge.length ? 'bridged' : 'measured') as FoundLine['roles'][number]);
    const out = unspiral([{ points: pts, roles, closed: false, gaps: [] }], 90);
    const closed = out.find((L) => L.closed);
    if (!closed) return; // nothing was closed: nothing invented
    const n = closed.points.length;
    for (let i = 1; i < n; i++) {
      const d = Math.hypot(closed.points[i]![0] - closed.points[i - 1]![0], closed.points[i]![1] - closed.points[i - 1]![1]);
      if (d > 3) expect(closed.roles[i], 'a long step is a bridge, not measured').toBe('bridged');
    }
    expect(closed.gaps.length).toBeGreaterThan(0);
  });
});

describe('audit B6: the Find lines pipette takes the line, not the paper or a neighbour', () => {
  const img = (w: number, h: number, paint: (x: number, y: number) => [number, number, number] | null) => {
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = paint(x, y);
      if (c) data.set([...c, 255], (y * w + x) * 4);
    }
    return { data, width: w, height: h };
  };
  it('B6 a click in the middle of a 6 px red line gives red, not white', () => {
    const im = img(40, 40, (x) => (x >= 17 && x <= 22 ? [220, 30, 30] : null));
    expect(sampleInkRgb(im, 19, 20)).toEqual([220, 30, 30]);
  });
  it('B6 a click on a blue line 2 px from a black frame gives blue, not the frame', () => {
    const im = img(40, 40, (x) => (x === 10 ? [0, 0, 0] : x === 12 ? [30, 60, 200] : null));
    expect(sampleInkRgb(im, 12, 20)).toEqual([30, 60, 200]);
  });
});

describe('audit C7: one odd read cannot veto the right ones', () => {
  it('C7 10, 20, 30 and one read of 4.0: the whole numbers are not refused', () => {
    const rs = readSlots([read('10'), read('20'), read('30'), read('4.0', 0.85)]);
    expect(rs.slice(0, 3).map((r) => r.value)).toEqual([10, 20, 30]);
  });
  it('C7 %g-style labels (0, 0.5, 1, 1.5) are all read', () => {
    expect(readSlots([read('0'), read('0.5'), read('1'), read('1.5')]).map((r) => r.value)).toEqual([0, 0.5, 1, 1.5]);
  });
  it('C7 a lost decimal point among labels that all have one is still refused', () => {
    const rs = readSlots([read('0.2'), read('0.4'), read('30'), read('0.6')]);
    expect(rs[2]!.value).toBeNull();
  });
});

describe('audit B8: a level read off a colour key keeps the key\'s own resolution', () => {
  it('B8 on a key from 10000 to 10010, a line between ticks is not rounded to 10000', () => {
    const ta = { t: 0, value: 10000 }, tb = { t: 1, value: 10010 };
    const v = keyValueAt(0.343, ta, tb, false)!;
    const res = keyResolution(600, ta, tb, false, 0.343);
    const rounded = Math.round(v / res) * res;
    expect(Math.abs(rounded - 10003.43)).toBeLessThan(0.02);
    expect(res).toBeLessThanOrEqual(0.02);
  });
});
