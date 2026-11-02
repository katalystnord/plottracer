/**
 * Find lines told the other series' inks (Auto-extract all series, v2.7: the legend names every series and the colour
 * beside it). Measured on xy-multiseries-modulus, four coloured lines with markers: without the other inks, dark blue
 * Blend A's anti-aliased edges were read as faint green and purple, and green came back as ten lines.
 */
import { describe, expect, it } from 'vitest';
import { readPng } from '../../engine/__tests__/helpers/readPng.js';
import { findLines } from '../findLines/lines.js';

const img = readPng('samples/xy-multiseries-modulus.png');
// the frame, and the legend masked, as the app gives them
const box = { x0: 86.3, y0: 38.9, x1: 885.7, y1: 637.4 };
const masks = [{ x0: 772.9, y0: 46.8, x1: 876.9, y1: 131.6 }];
const INKS: Record<string, [number, number, number]> = {
  'Blend A': [31, 78, 121],
  'Blend B': [192, 57, 43],
  'Blend C': [39, 174, 96],
  'Blend D': [142, 68, 173],
};

describe('Find lines with the other series inks known', () => {
  for (const [name, ink] of Object.entries(INKS)) {
    it(`given the legend's four colours, ${name} is one line from its first point to its last`, () => {
      const others = Object.values(INKS).filter((o) => o !== ink);
      const r = findLines(img.data, img.width, img.height, ink, box, { contour: false, masks, otherInks: others });
      expect(r.lines).toHaveLength(1);
      const xs = r.lines[0]!.points.map((p) => p[0]);
      // the first and last markers sit at x = 20 and 100: pixels 232 and 811
      expect(Math.min(...xs)).toBeLessThan(236);
      expect(Math.max(...xs)).toBeGreaterThan(807);
    });
  }
});
