/**
 * Find lines told the other series' inks (Auto-extract all series) reads each pixel against every ink, and the paper
 * under them is the same for all: it depends on the figure, not the ink. Estimated once per ink, four series cost
 * 4.2 s on xy-multiseries-modulus against 1.3 s read alone (measured 2026-11-03).
 */
import { describe, expect, it, vi } from 'vitest';
import * as raster from '../findLines/raster.js';
import { readPng } from '../../engine/__tests__/helpers/readPng.js';
import { findLines } from '../findLines/lines.js';

vi.mock('../findLines/raster.js', async (orig) => {
  const m = await orig<typeof import('../findLines/raster.js')>();
  return { ...m, greyClosing: vi.fn(m.greyClosing), greyOpening: vi.fn(m.greyOpening) };
});

const img = readPng('samples/xy-multiseries-modulus.png');
const box = { x0: 86.3, y0: 38.9, x1: 885.7, y1: 637.4 };
const masks = [{ x0: 772.9, y0: 46.8, x1: 876.9, y1: 131.6 }];
const INKS: [number, number, number][] = [[31, 78, 121], [192, 57, 43], [39, 174, 96], [142, 68, 173]];

describe('Find lines estimates the paper once, however many inks it is told', () => {
  it('given Blend A and the three other blends\' inks, the paper under the lines is estimated once, not once per ink', () => {
    vi.mocked(raster.greyClosing).mockClear();
    vi.mocked(raster.greyOpening).mockClear();
    findLines(img.data, img.width, img.height, INKS[0]!, box, { contour: false, masks, otherInks: INKS.slice(1) });
    // one estimate is three planes, one per colour channel
    expect(vi.mocked(raster.greyClosing).mock.calls.length + vi.mocked(raster.greyOpening).mock.calls.length).toBe(3);
  });

  it('and each blend still comes back as one line from 20 to 100', () => {
    for (const ink of INKS) {
      const r = findLines(img.data, img.width, img.height, ink, box, { contour: false, masks, otherInks: INKS.filter((o) => o !== ink) });
      expect(r.lines).toHaveLength(1);
      const xs = r.lines[0]!.points.map((p) => p[0]);
      expect(Math.min(...xs)).toBeLessThan(236);
      expect(Math.max(...xs)).toBeGreaterThan(807);
    }
  });
});
