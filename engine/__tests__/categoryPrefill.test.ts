import { describe, expect, it } from 'vitest';
import { BAR_AXES_CONFIG, CATEGORICAL_LINE_CONFIG, CalibrationSession } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';

/**
 * Category-name PREFILL - the convenience that must never invent a name.
 *
 * ⚑ WHY THIS FILE EXISTS. `prefillCategoryLabel` and its v2.0 tuple sibling
 * carry ~30 mutants no test notices, and they are the single most
 * tenet-9-sensitive piece of convenience in the app: a prefilled name goes
 * into the Category column of every export, **indistinguishable from one the
 * user transcribed**.
 *
 * ⚑ IT HAS FABRICATED WRONG NAMES BEFORE, and the v1.3 gate caught it. The
 * pairing used to be by ROW INDEX - i.e. click order - so the two most
 * ordinary grouped-bar situations lied: a series with no Hemp bar (Flax, then
 * Jute) got row 1 prefilled "Hemp", and clicking the rightmost bar first did
 * the same. The fix made the pairing a MEASUREMENT: the donor is whichever
 * named bar sits nearest along the CATEGORY axis. These cases pin that fix,
 * and the fail-safe that goes with it.
 *
 * The rule, in one line: **a blank cell the user fills in is honest; a wrong
 * name that looks typed is not.**
 */

/** A calibrated Bar session. P1=0 @ (300,500), P2=10 @ (300,100). */
function calibratedBar(rotated = false): CalibrationSession<BarAxes> {
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  if (rotated) s.setOption('isRotated', 'true');
  s.handleCalibrationClick(300, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(300, 100);
  s.confirmCalibrationValues(['10']);
  expect(s.runCalibration()).toBe(true);
  return s;
}

/** Capture one bar as a drag-box at category coordinate `x`, and name it. */
function namedBarAt(s: CalibrationSession<BarAxes>, x: number, name: string): void {
  s.addDataPoint(x, 500);
  s.addDataPoint(x, 300);
  const t = s.getDataset().getTupleCount() - 1;
  s.setTupleLabel(t, name);
}

describe('prefill donates from the NEAREST bar along the category axis', () => {
  it('⚑ names a new series bar after the bar it sits under, not after its click ORDER', () => {
    // The v1.3 defect in one case: series 2 is captured RIGHT-TO-LEFT. Row
    // index would give the first click "Flax"; position gives it "Jute",
    // which is the bar it is actually under.
    const s = calibratedBar();
    namedBarAt(s, 150, 'Flax');
    namedBarAt(s, 250, 'Hemp');
    namedBarAt(s, 350, 'Jute');

    s.addDataset('Series 2');
    s.addDataPoint(352, 500); // the RIGHTMOST bar, clicked first
    s.addDataPoint(352, 400);

    expect(s.getTupleLabel(0)).toBe('Jute');
  });

  it('⚑ SKIPS a category cleanly: a series with no Hemp bar does not get Hemp', () => {
    // The other half of the v1.3 defect, and the one that made it dangerous:
    // the wrong name looked transcribed in the export.
    const s = calibratedBar();
    namedBarAt(s, 150, 'Flax');
    namedBarAt(s, 250, 'Hemp');
    namedBarAt(s, 350, 'Jute');

    s.addDataset('Series 2');
    s.addDataPoint(152, 500); // Flax
    s.addDataPoint(152, 420);
    s.addDataPoint(352, 500); // Jute -- Hemp deliberately skipped
    s.addDataPoint(352, 380);

    expect(s.getTupleLabel(0)).toBe('Flax');
    expect(s.getTupleLabel(1)).toBe('Jute');
    // Nothing anywhere in this series claims to be Hemp.
    const labels = [0, 1].map((t) => s.getTupleLabel(t));
    expect(labels).not.toContain('Hemp');
  });

  it('follows the category axis onto Y once the chart is rotated', () => {
    // `categoryCoordOf` picks x or y off the live axes; reading the wrong one
    // makes every donor the same distance away and the prefill arbitrary.
    const s = calibratedBar(true);
    expect((s.getAxes() as BarAxes).isRotated()).toBe(true);

    s.addDataPoint(500, 150);
    s.addDataPoint(300, 150);
    s.setTupleLabel(0, 'Top');
    s.addDataPoint(500, 350);
    s.addDataPoint(300, 350);
    s.setTupleLabel(1, 'Bottom');

    s.addDataset('Series 2');
    s.addDataPoint(500, 348); // nearest the BOTTOM band, in y
    s.addDataPoint(380, 348);
    expect(s.getTupleLabel(0)).toBe('Bottom');
  });

  it('handles grouped sub-bars, which are offset from their donor but still nearest it', () => {
    // The case the feature exists for: side-by-side bars within one category.
    const s = calibratedBar();
    namedBarAt(s, 100, 'Flax');
    namedBarAt(s, 300, 'Hemp');

    s.addDataset('Series 2');
    s.addDataPoint(120, 500); // offset from Flax, but far nearer it than Hemp
    s.addDataPoint(120, 400);
    expect(s.getTupleLabel(0)).toBe('Flax');
  });
});

describe('prefill fails SAFE rather than guessing', () => {
  it('⚑ writes NOTHING when the nearest donor name is already claimed in this series', () => {
    // A category appears at most once per series, so a second claim means the
    // pairing is ambiguous. The guard mutated and survived; without it the
    // same name lands on two bars and one of them is certainly wrong.
    const s = calibratedBar();
    namedBarAt(s, 150, 'Flax');
    namedBarAt(s, 400, 'Jute');

    s.addDataset('Series 2');
    s.addDataPoint(152, 500); // takes Flax
    s.addDataPoint(152, 400);
    expect(s.getTupleLabel(0)).toBe('Flax');

    s.addDataPoint(158, 500); // ALSO nearest Flax -- ambiguous
    s.addDataPoint(158, 300);
    expect(s.getTupleLabel(1)).toBe(''); // blank, not a duplicate
  });

  it('writes nothing when there is no other series to donate from', () => {
    const s = calibratedBar();
    s.addDataPoint(150, 500);
    s.addDataPoint(150, 300);
    expect(s.getTupleLabel(0)).toBe('');
  });

  it('writes nothing when the other series has no NAMED bars', () => {
    // An unnamed donor is not a donor; the loop skips blank labels, and that
    // skip mutated and survived.
    const s = calibratedBar();
    s.addDataPoint(150, 500); // captured but never named
    s.addDataPoint(150, 300);

    s.addDataset('Series 2');
    s.addDataPoint(152, 500);
    s.addDataPoint(152, 400);
    expect(s.getTupleLabel(0)).toBe('');
  });

  it('never donates from the series being captured INTO', () => {
    // `if (other.dataset === dataset) continue` -- without it a series
    // prefills from itself and every bar after the first inherits its
    // neighbour's name.
    const s = calibratedBar();
    namedBarAt(s, 150, 'Flax');
    // A second bar in the SAME series, close to the first.
    s.addDataPoint(160, 500);
    s.addDataPoint(160, 300);
    expect(s.getTupleLabel(1)).toBe('');
  });
});

describe('prefill is Bar-family only', () => {
  it('does not run for a Box Plot, which has its own per-tuple name field', () => {
    const s = calibratedBar();
    namedBarAt(s, 150, 'Flax');

    const box = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    box.handleCalibrationClick(300, 500);
    box.confirmCalibrationValues(['0']);
    box.handleCalibrationClick(300, 100);
    box.confirmCalibrationValues(['10']);
    expect(box.runCalibration()).toBe(true);
    box.applyBoxPlotGroups();
    box.addDataPoint(152, 500);
    // A 5-slot box is not the 2-slot interval shape prefill is gated to.
    expect(box.getTupleLabel(0)).toBe('');
  });

  it('the categorical Line type carries per-POINT names, and prefills by position too', () => {
    // Same rule, the pre-v2.0 per-point path (prefillCategoryLabel rather
    // than its tuple sibling), which the bar model left in place for this
    // type -- so it needs its own case.
    const s = new CalibrationSession<BarAxes>(CATEGORICAL_LINE_CONFIG);
    s.handleCalibrationClick(300, 500);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(300, 100);
    s.confirmCalibrationValues(['10']);
    expect(s.runCalibration()).toBe(true);

    s.addDataPoint(150, 400);
    s.setPointLabel(0, 'Flax');
    s.addDataPoint(350, 350);
    s.setPointLabel(1, 'Jute');

    s.addDataset('Series 2');
    s.addDataPoint(348, 300); // nearest Jute in x
    expect(s.getPointLabels(1)[0]).toBe('Jute');
  });
});
