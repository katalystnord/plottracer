import { describe, it, expect } from 'vitest';
import { sampleInkRgb } from '../samplePixel.js';

/** White paper with a 3-px anti-aliased black line down x = 10: edges grey, core black. */
function figure() {
  const w = 21, h = 21;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    for (const [x, v] of [[9, 179], [10, 0], [11, 179]] as const) {
      const o = (y * w + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = v;
    }
  }
  return { data, width: w, height: h };
}

describe('the Find lines pipette takes the ink, not the edge', () => {
  it('a click on the pale edge of a thin black line picks the line\'s black core', () => {
    expect(sampleInkRgb(figure(), 9, 10)).toEqual([0, 0, 0]);
  });
  it('a click a pixel or two off the line still finds it', () => {
    expect(sampleInkRgb(figure(), 12, 10)).toEqual([0, 0, 0]);
  });
});
