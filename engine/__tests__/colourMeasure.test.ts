import { describe, expect, it } from 'vitest';
import { colourMeasureReading } from '../colourMeasure.js';
import { resolveMeasureClick } from '../measureCapture.js';
import { measurementsSection } from '../csvExport.js';
import type { ColorScale } from '../../algorithms/colorScale.js';
import { sampleColorBar, type ColorBarStrip } from '../../algorithms/colorBar.js';

/**
 * THEME C: THE COLOUR MEASUREMENT TOOL - AN INSTRUMENT, NOT A HEATMAP FEATURE.
 *
 * ⚑⚑ DAVID CORRECTED THE SCOPE, 2026-08-16: *"I do not think that we should tie
 * a general measurement tool to a specific graph. This should be something that
 * is independent, a reliable second opinion on pure colour measurements, that is
 * useful in ALL types of graphs."* So the reading is a COLOUR on every type, and
 * a VALUE additionally wherever a colour key has been calibrated - which is the
 * ruler's own rule one dimension over (pixels until a scale exists, units after).
 *
 * ⚑ THE ROW FORM IS SETTLED (David: *"Works! Thank you!"*), and it is the
 * Measurements panel's own idiom rather than a new one:
 *
 *     🔬 ▉ #440154 · 12.57      a colour key is calibrated
 *     🔬 ▉ #c0392b              none is, so there is no value to show
 *
 * ⚠️ Both bracket forms were proposed and REJECTED: `[ ]` already means *a value
 * a person supplied* (theme A4), and `( )` is accounting notation for a negative
 * number - which a diverging key genuinely produces, and the panel has a Copy
 * all button, so "display only" is not a containment argument.
 */

/**
 * A real black-to-white key, sampled the way the app samples one.
 *
 * ⚑ BUILT THROUGH `sampleColorBar`, never hand-written: the strip type's own
 * note says the ONLY way to obtain one is that function, because it is where
 * the refusals live. A hand-rolled strip would be a second entrance to a model
 * that deliberately has one.
 */
const KEY_W = 201;
const KEY_H = 21;
const KEY_Y = 10;

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

/** A key whose colour rises and falls - the ordinary diverging case, where one
 * colour genuinely answers to two values. */
function divergingStrip(): ColorBarStrip {
  const data = new Uint8ClampedArray(KEY_W * KEY_H * 4);
  for (let y = 0; y < KEY_H; y++)
    for (let x = 0; x < KEY_W; x++) {
      const v = Math.round((Math.abs(x - (KEY_W - 1) / 2) / ((KEY_W - 1) / 2)) * 255);
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

const scaleOf = (strip: ColorBarStrip): ColorScale => ({
  strip,
  ticks: [
    { point: { x: 0, y: KEY_Y }, value: 0 },
    { point: { x: KEY_W - 1, y: KEY_Y }, value: 100 },
  ],
  log: false,
});

const RAMP = scaleOf(greyStrip());
/** The colour this key prints at position `t`, read back OFF the strip rather
 * than recomputed - the lesson `colorScale.test.ts` records about its own
 * first draft. */
const rampColourAt = (t: number) => {
  const s = RAMP.strip.samples;
  return s[Math.round(t * (s.length - 1))]!.rgb as [number, number, number];
};

describe('what the colour tool reports', () => {
  it('the COLOUR, always - that is the measurement it always has', () => {
    const reading = colourMeasureReading([192, 57, 43], null);
    expect(reading.rgb).toEqual([192, 57, 43]);
  });

  it('⚑ no calibrated colour axis means no value, and nothing is claimed', () => {
    // ⚑ `calibrated` is what separates "there is no axis to read against" from
    // "there is one and this colour is not on it". They look the same in the
    // value and must not look the same on screen.
    const reading = colourMeasureReading([192, 57, 43], null);
    expect(reading.calibrated).toBe(false);
    expect(reading.value).toBeNull();
  });

  it('⚑⚑ a colour ON the calibrated range reports its VALUE', () => {
    const mid = rampColourAt(0.5);
    const reading = colourMeasureReading(mid, RAMP);
    expect(reading.calibrated).toBe(true);
    expect(reading.value).toBeCloseTo(50, 0);
  });

  it('⚑⚑ a colour that is NOT on the range reports no value, and says the axis exists', () => {
    // Pure red is nowhere on a black-to-white key. It used to come back as 33.5.
    const reading = colourMeasureReading([255, 0, 0], RAMP);
    expect(reading.calibrated).toBe(true);
    expect(reading.value).toBeNull();
    // The SAMPLE still stands - taking it is the tool's whole job.
    expect(reading.rgb).toEqual([255, 0, 0]);
  });

  it('⚑ a colour the range holds in TWO places has no single value either', () => {
    const diverging = scaleOf(divergingStrip());
    const reading = colourMeasureReading([128, 128, 128], diverging);
    expect(reading.calibrated).toBe(true);
    expect(reading.value).toBeNull();
    expect(reading.rgb).toEqual([128, 128, 128]);
  });

  it('⚑ a key that cannot be read at all counts as no axis, not as out of range', () => {
    const unusable: ColorScale = {
      strip: RAMP.strip,
      ticks: [
        { point: { x: 0, y: KEY_Y }, value: 7 },
        { point: { x: KEY_W - 1, y: KEY_Y }, value: 7 },
      ],
      log: false,
    };
    const reading = colourMeasureReading([128, 128, 128], unusable);
    expect(reading.calibrated).toBe(false);
    expect(reading.value).toBeNull();
  });
});

describe('C - the click that takes it', () => {
  const at = (x: number, y: number) => ({ x, y });

  it('⚑ one click IS the measurement - there is no second point to wait for', () => {
    const result = resolveMeasureClick({
      point: at(10, 20),
      pending: [],
      settingScale: false,
      tool: 'colour',
      slopeReady: false,
      toData: null,
    });
    expect(result).toEqual({ kind: 'record', tool: 'colour', points: [at(10, 20)], labelAt: at(10, 20) });
  });

  it('set-scale still outranks it, like every other tool', () => {
    const result = resolveMeasureClick({
      point: at(10, 20),
      pending: [],
      settingScale: true,
      tool: 'colour',
      slopeReady: false,
      toData: null,
    });
    expect(result.kind).toBe('collect');
  });
});

describe('C - a colour measurement leaves the app', () => {
  it('a file with no colour measurement is exactly what it was', () => {
    // Presence is the signal, the rule this section already follows for every
    // other optional column: nothing here changes for the eleven types that
    // never touch the instrument.
    const section = measurementsSection([{ tool: 'distance', value: 12.5, unit: 'mm' }]);
    expect(section.header).toEqual(['tool', 'value', 'unit']);
    expect(section.rows[0]).toEqual(['distance', 12.5, 'mm']);
  });

  it('⚑ the COLOUR travels, because it is what was measured', () => {
    const section = measurementsSection([
      { tool: 'colour', value: 12.57, unit: '', colour: '#440154' },
    ]);
    expect(section.header).toEqual(['tool', 'value', 'unit', 'colour']);
    expect(section.rows[0]).toEqual(['colour', 12.57, '', '#440154']);
  });

  it('⚑⚑ and it travels ALONE where the figure has no key to read it against', () => {
    // The honest cell is blank, never 0: a colour with no calibrated key has no
    // value, and a zero would be a number nobody measured.
    const section = measurementsSection([{ tool: 'colour', value: null, unit: '', colour: '#c0392b' }]);
    expect(section.rows[0]).toEqual(['colour', '', '', '#c0392b']);
  });
});
