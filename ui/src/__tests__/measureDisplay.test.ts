import { describe, expect, it } from 'vitest';
import { measureDisplay, type RecordedMeasurement } from '../tools/measureDisplay.js';
import { sampleColorBar, type ColorBarStrip } from '../../../algorithms/colorBar.js';
import type { ColorScale } from '../../../algorithms/colorScale.js';

/**
 * WHAT A RECORDED MEASUREMENT READS AS.
 *
 * ⚑⚑ THE FILE THEME G BOUGHT AND NEVER SPENT. The extraction's own rule was
 * *"judge each target by what a test can now ask"* - and nothing asked, so 120
 * lines of pure function shipped with no test of any name behind them. The
 * first thing asking turned up: the ruler names its missing reference and the
 * Colour instrument did not name its own.
 */

const KEY_W = 201;
const KEY_H = 21;
const KEY_Y = 10;

/** A real black-to-white key, built through `sampleColorBar` because that is
 * the only entrance to a strip - a hand-rolled one is a second one. */
function greyStrip(): ColorBarStrip {
  const data = new Uint8ClampedArray(KEY_W * KEY_H * 4);
  for (let y = 0; y < KEY_H; y++)
    for (let x = 0; x < KEY_W; x++) {
      const v = Math.round((x / (KEY_W - 1)) * 255);
      const i = (y * KEY_W + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  const result = sampleColorBar(data, KEY_W, KEY_H, { x: 0, y: KEY_Y }, { x: KEY_W - 1, y: KEY_Y });
  expect(result.reason).toBeNull();
  return result.strip!;
}

const RAMP: ColorScale = {
  strip: greyStrip(),
  ticks: [
    { point: { x: 0, y: KEY_Y }, value: 0 },
    { point: { x: KEY_W - 1, y: KEY_Y }, value: 100 },
  ],
  log: false,
};
const rampColourAt = (t: number): [number, number, number] => {
  const s = RAMP.strip.samples;
  return s[Math.round(t * (s.length - 1))]!.rgb as [number, number, number];
};

const colourAt = (rgb: readonly [number, number, number]): RecordedMeasurement => ({
  id: 'm',
  tool: 'colour',
  overlay: { id: 'm', points: [{ x: 1, y: 1 }], closed: false, label: '', labelAt: { x: 1, y: 1 } },
  rgb,
});
const ruler: RecordedMeasurement = {
  id: 'r',
  tool: 'distance',
  overlay: {
    id: 'r',
    points: [
      { x: 0, y: 0 },
      { x: 3, y: 4 },
    ],
    closed: false,
    label: '',
    labelAt: { x: 0, y: 0 },
  },
};

describe('the Colour instrument reads its own reference, like the ruler does', () => {
  it('the ruler names its missing reference rather than leaving the gap to be noticed', () => {
    expect(measureDisplay(ruler, { scale: null }).note).toBe('set a scale for real units');
  });

  it('a colour with no key calibrated is the colour, and only that', () => {
    const d = measureDisplay(colourAt([192, 57, 43]), { colourScale: null });
    expect(d.value).toBe('#c0392b');
    expect(d.swatch).toEqual([192, 57, 43]);
    expect(d.note).toBeUndefined();
  });

  it('a colour ON the key carries its value after the panel’s middle dot', () => {
    const d = measureDisplay(colourAt(rampColourAt(0.5)), { colourScale: RAMP });
    expect(d.note).toMatch(/^-?[\d.]+$/);
    expect(Number(d.note)).toBeCloseTo(50, 0);
  });

  it('⚑⚑ a colour OUTSIDE the key says so, instead of printing a number for it', () => {
    // The defect this file was written for: pure red on a black-to-white ramp
    // read as `33.5`, under a panel line saying "Read against the colour key".
    // David: *"if it is outside of the key, then just report that."*
    const d = measureDisplay(colourAt([255, 0, 0]), { colourScale: RAMP });
    expect(d.value).toBe('#ff0000'); // the SAMPLE is never in doubt
    expect(d.swatch).toEqual([255, 0, 0]);
    expect(d.note).toBe('outside the colour key');
  });

  it('a measurement with no colour recorded reads as a dash, not as black', () => {
    const bare: RecordedMeasurement = { ...colourAt([0, 0, 0]) };
    delete (bare as { rgb?: unknown }).rgb;
    expect(measureDisplay(bare, { colourScale: RAMP })).toEqual({ value: '-' });
  });
});
