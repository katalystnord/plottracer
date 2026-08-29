/**
 * B1 - TYPING A VALUE ON A BAR-KIND CHART (v2.4).
 *
 * ⚑⚑ WHY IT IS OCR'S PRECONDITION, not its scheduling neighbour. OCR's value to
 * a bar chart is reading the number PRINTED ABOVE THE BAR and offering it - and
 * there was nowhere for that proposal to land, because the typed-value path IS
 * this. Build OCR first and you build this anyway; build it alone and the
 * landing place may be built twice. David, 2026-08-21: *"Do you not think that
 * we should defer this to v2.4 together with the OCR?"*
 *
 * ⚑⚑ AND IT IS THE SAME RULE THE REST OF THE APP ALREADY OBEYS: an edit MOVES
 * THE DATUM, it does not overwrite a number. We are never the only instrument
 * looking at a figure - a person can read a printed label our sampler never
 * sees - so their reading is stored through the same transform as ours, and what
 * the record keeps is WHICH INSTRUMENT took it.
 *
 * ⚠️ THE NAIVE FIX IS WRONG, and the old reason for refusing was also wrong.
 * `BarAxes.dataToPixel` is not a stub (real since v2.0) - but it inverts ONTO
 * THE CALIBRATION LINE, so feeding a typed value straight in would teleport a
 * bar's corner sideways onto the value axis and throw away its category position
 * and its width. The edit has to step ALONG the value direction FROM the point's
 * existing pixel, which is what these cases pin down.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, BAR_AXES_CONFIG } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/** Value 0..30 over py 500..100 (so 1 value unit = 13.333 px, upward). */
function barSession() {
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  expect(s.handleCalibrationClick(100, 500)).toBe('awaiting-value');
  expect(s.confirmCalibrationValues(['0'])).toBe(true);
  expect(s.handleCalibrationClick(100, 100)).toBe('awaiting-value');
  expect(s.confirmCalibrationValues(['30'])).toBe(true);
  walkCategoryAxis(s);
  expect(s.runCalibration()).toBe(true);
  return s;
}

describe('a bar-kind datum takes a typed value', () => {
  it('⚑⚑ moves along the value axis and KEEPS its category position', () => {
    // The whole of the naive-fix warning above, as an observable outcome: the
    // point sits at x=300, nowhere near the calibration line at x=100, and it
    // must still be at x=300 afterwards.
    const s = barSession();
    const ds = s.getDatasets()[0]!;
    const i = ds.addPixel(300, 400); // reads 7.5
    expect(s.getDataPoints()[i]!.data![0]).toBeCloseTo(7.5, 6);

    expect(s.setDataPointValue(i, 0, 15)).toBe(true);
    const moved = ds.getPixel(i)!;
    expect(moved.x, 'the category coordinate is not the value axis and must not move').toBeCloseTo(300, 6);
    expect(moved.y, '15 of 0..30 over py 500..100').toBeCloseTo(300, 6);
    expect(s.getDataPoints()[i]!.data![0]).toBeCloseTo(15, 6);
  });

  it('records the reading as the USER’s, so the table can bracket it', () => {
    const s = barSession();
    const ds = s.getDatasets()[0]!;
    const i = ds.addPixel(300, 400);
    expect(s.getSuppliedDimsFor(0)[i]).toEqual([]);
    s.setDataPointValue(i, 0, 15);
    expect(s.getSuppliedDimsFor(0)[i], 'a typed value is a reading taken with a better instrument').toEqual([0]);
  });

  it('and a later DRAG retires that mark, because a move re-measures', () => {
    const s = barSession();
    const ds = s.getDatasets()[0]!;
    const i = ds.addPixel(300, 400);
    s.setDataPointValue(i, 0, 15);
    s.updateDataPointPixel(i, 300, 200);
    expect(s.getSuppliedDimsFor(0)[i]).toEqual([]);
  });

  it('follows the chart’s own value direction on a ROTATED bar chart', () => {
    // Categories run down and the value across, so the same edit moves x and
    // must leave y alone. The direction is a fact about the chart, not a screen
    // convention - the same thing capFreeDirection established for caps.
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    expect(s.handleCalibrationClick(100, 500)).toBe('awaiting-value');
    expect(s.confirmCalibrationValues(['0'])).toBe(true);
    expect(s.handleCalibrationClick(500, 500)).toBe('awaiting-value');
    expect(s.confirmCalibrationValues(['30'])).toBe(true);
    // ⚑ The categories run DOWN on a rotated chart, so the category axis is
    // vertical. A horizontal one here is parallel to the value axis and the
    // model refuses the calibration outright - which is the fixture describing
    // a chart that cannot exist.
    walkCategoryAxis(s, { from: { x: 100, y: 100 }, to: { x: 100, y: 500 } });
    expect(s.runCalibration()).toBe(true);
    const ds = s.getDatasets()[0]!;
    const i = ds.addPixel(200, 300); // value 7.5, category coordinate y=300
    expect(s.setDataPointValue(i, 0, 15)).toBe(true);
    const moved = ds.getPixel(i)!;
    expect(moved.x).toBeCloseTo(300, 6);
    expect(moved.y, 'the category coordinate is y here').toBeCloseTo(300, 6);
  });

  it('refuses a value the axes cannot invert, rather than inventing a pixel', () => {
    const s = barSession();
    const ds = s.getDatasets()[0]!;
    const i = ds.addPixel(300, 400);
    const before = { ...ds.getPixel(i)! };
    expect(s.setDataPointValue(i, 0, Number.NaN)).toBe(false);
    expect(ds.getPixel(i)!.x).toBe(before.x);
    expect(ds.getPixel(i)!.y).toBe(before.y);
  });

  it('has one data dimension, so there is no dim 1 to write', () => {
    // Bar is 1.5D: a category coordinate and ONE value. A caller asking for
    // dim 1 is asking for an axis this chart does not have.
    const s = barSession();
    const ds = s.getDatasets()[0]!;
    const i = ds.addPixel(300, 400);
    expect(s.setDataPointValue(i, 1, 15)).toBe(false);
  });
});
