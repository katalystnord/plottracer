import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG, BAR_AXES_CONFIG } from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';
import { getErrorRelation } from '../errorRelation.js';

/** The same 4-point setup the rest of engine/'s tests use: a pixel maps to data
 * as x = (px-100)/30, y = (250-py)/15. */
function calibrateStandardXY(session: CalibrationSession<XYAxes>) {
  const steps: Array<[number, number, string]> = [
    [100, 250, '0'],
    [400, 250, '10'],
    [100, 250, '0'],
    [100, 100, '10'],
  ];
  for (const [px, py, value] of steps) {
    expect(session.handleCalibrationClick(px, py)).toBe('awaiting-value');
    expect(session.confirmCalibrationValues([value])).toBe(true);
  }
  expect(session.runCalibration()).toBe(true);
}

function names(session: CalibrationSession<never>) {
  return session.getDatasetInfos().map((i) => i.name);
}

describe('captureErrorCap — the drag gesture', () => {
  function calibratedWithAPoint() {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.renameDataset(0, 'Sample A');
    session.addDataPoint(200, 200); // data (3.333, 3.333)
    return session;
  }

  it('places the dragged cap AND its mirror, in two related series', () => {
    const session = calibratedWithAPoint();
    expect(
      session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: 200, y: 200 },
        capPixel: { x: 200, y: 170 }, // dragged UP 30px
        baseName: 'SD',
      })
    ).toBeNull();

    expect(names(session as never)).toEqual(['Sample A', 'SD upper', 'SD lower']);

    const upper = session.getDatasets()[1]!;
    const lower = session.getDatasets()[2]!;
    expect(getErrorRelation(upper)).toEqual({ role: 'upper', of: 'Sample A' });
    expect(getErrorRelation(lower)).toEqual({ role: 'lower', of: 'Sample A' });

    // The dragged cap is exactly where the user released. The mirror is
    // reflected across the datum -- a starting position, nothing more.
    expect(upper.getAllPixels()).toEqual([{ x: 200, y: 170, metadata: undefined }]);
    expect(lower.getAllPixels()).toEqual([{ x: 200, y: 230, metadata: undefined }]);
  });

  it('leaves the DATA series active, not the error-cap series it creates', () => {
    // The trap this fixes: addDataset makes each new series (SD upper / SD lower)
    // active as a side effect, so after adding an error cap the active series was
    // silently the error-cap series -- and the next Place-Point click landed there
    // instead of on the data series, with nothing on screen saying so.
    const session = calibratedWithAPoint(); // 'Sample A' is index 0, and active
    session.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 200, y: 200 },
      capPixel: { x: 200, y: 170 },
      baseName: 'SD',
    });
    // Active is restored to the target data series, not left on 'SD lower'.
    expect(session.getActiveDatasetIndex()).toBe(0);
    expect(session.getDatasetInfos().find((i) => i.active)?.name).toBe('Sample A');

    // Proof of the point: a following click adds a DATA point to 'Sample A',
    // not another cap to the error series.
    session.addDataPoint(260, 190);
    expect(session.getDatasets()[0]!.getAllPixels()).toHaveLength(2); // Sample A grew
    expect(session.getDatasets()[2]!.getAllPixels()).toHaveLength(1); // SD lower unchanged
  });

  it('works on a BAR chart — the case a data-space mirror would have refused', () => {
    // BarAxes.dataToPixel is a stub returning {x:0,y:0} (core/axes/bar.ts:93).
    // An earlier draft mirrored in data space and would have had to disable the
    // tool here -- or, worse, stored the mirrored cap at the image corner.
    // Pixel geometry needs nothing from the axes, so bar error capture works.
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    const steps: Array<[number, number, string[]]> = [
      [100, 250, ['0']],
      [100, 100, ['10']],
    ];
    for (const [px, py, values] of steps) {
      expect(session.handleCalibrationClick(px, py)).toBe('awaiting-value');
      expect(session.confirmCalibrationValues(values)).toBe(true);
    }
    expect(session.runCalibration()).toBe(true);
    session.renameDataset(0, 'Bar A');
    session.addDataPoint(150, 180);

    expect(
      session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: 150, y: 180 },
        capPixel: { x: 150, y: 150 },
        baseName: 'SD',
      })
    ).toBeNull();
    expect(names(session as never)).toEqual(['Bar A', 'SD upper', 'SD lower']);
    expect(session.getDatasets()[2]!.getAllPixels()).toEqual([{ x: 150, y: 210, metadata: undefined }]);
  });

  it('a horizontal drag records left/right instead', () => {
    const session = calibratedWithAPoint();
    expect(
      session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: 200, y: 200 },
        capPixel: { x: 230, y: 200 },
        baseName: 'CI',
      })
    ).toBeNull();
    expect(names(session as never)).toEqual(['Sample A', 'CI right', 'CI left']);
    expect(session.getDatasets()[2]!.getAllPixels()).toEqual([{ x: 170, y: 200, metadata: undefined }]);
  });

  it('reuses the same pair of series across several bars', () => {
    const session = calibratedWithAPoint();
    session.addDataPoint(300, 150);
    for (const [d, c] of [
      [{ x: 200, y: 200 }, { x: 200, y: 170 }],
      [{ x: 300, y: 150 }, { x: 300, y: 130 }],
    ] as const) {
      expect(
        session.captureErrorCap({ targetIndex: 0, datumPixel: d, capPixel: c, baseName: 'SD' })
      ).toBeNull();
    }
    // Two bars, still exactly three series -- not four.
    expect(names(session as never)).toEqual(['Sample A', 'SD upper', 'SD lower']);
    expect(session.getDatasets()[1]!.getCount()).toBe(2);
    expect(session.getDatasets()[2]!.getCount()).toBe(2);
  });

  it('a moved cap stays moved — nothing re-symmetrizes the pair', () => {
    // The core of the model (David, 2026-07-16): the mirror is a starting
    // position, not a constraint. An asymmetric bar is just a bar whose cap you
    // moved, so capturing a SECOND bar must not disturb the first.
    const session = calibratedWithAPoint();
    session.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 200, y: 200 },
      capPixel: { x: 200, y: 170 },
      baseName: 'SD',
    });
    const lower = session.getDatasets()[2]!;
    lower.setPixelAt(0, 200, 245); // user drags the lower cap far down

    session.addDataPoint(300, 150);
    session.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 300, y: 150 },
      capPixel: { x: 300, y: 130 },
      baseName: 'SD',
    });
    expect(lower.getAllPixels()[0]).toMatchObject({ x: 200, y: 245 });
  });

  it('refuses a zero-length drag rather than placing a degenerate bar', () => {
    const session = calibratedWithAPoint();
    expect(
      session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: 200, y: 200 },
        capPixel: { x: 200, y: 200 },
        baseName: 'SD',
      })
    ).toMatch(/drag from a data point/i);
    expect(names(session as never)).toEqual(['Sample A']);
  });

  it('refuses an unnamed error series — the name is the only meaning we record', () => {
    const session = calibratedWithAPoint();
    expect(
      session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: 200, y: 200 },
        capPixel: { x: 200, y: 170 },
        baseName: '   ',
      })
    ).toMatch(/name/i);
    expect(names(session as never)).toEqual(['Sample A']);
  });

  it('refuses before calibration, like addDataPoint', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    expect(
      session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: 200, y: 200 },
        capPixel: { x: 200, y: 170 },
        baseName: 'SD',
      })
    ).toMatch(/calibrate/i);
  });

  it('refuses to hijack an existing series that is not error for this target', () => {
    const session = calibratedWithAPoint();
    session.addDataset('SD upper'); // an ordinary series that happens to be named that
    const refusal = session.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 200, y: 200 },
      capPixel: { x: 200, y: 170 },
      baseName: 'SD',
    });
    // Bookkeeping integrity, not a constraint on where points may go: silently
    // adopting the user's own series would put caps into data they placed for
    // something else.
    expect(refusal).toBeTruthy();
  });

  it('a rename of the target follows through to the relation (checkpoint 77 cascade)', () => {
    const session = calibratedWithAPoint();
    session.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 200, y: 200 },
      capPixel: { x: 200, y: 170 },
      baseName: 'SD',
    });
    expect(session.renameDataset(0, 'Renamed')).toBeNull();
    expect(getErrorRelation(session.getDatasets()[1]!)).toEqual({ role: 'upper', of: 'Renamed' });
  });
});

describe('nearestDatumPixel — snapping the drag start', () => {
  it('snaps to a real point of the target series', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.addDataPoint(200, 200);
    session.addDataPoint(300, 150);
    expect(session.nearestDatumPixel(0, { x: 204, y: 197 }, 12)).toEqual({
      index: 0,
      point: { x: 200, y: 200 },
    });
  });

  it('returns null when the press is nowhere near a point', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.addDataPoint(200, 200);
    expect(session.nearestDatumPixel(0, { x: 400, y: 400 }, 12)).toBeNull();
  });
});

describe('deleting points/caps keeps error bars whole (cascade + pair, 2026-07-22)', () => {
  // Two data points, each with an SD error bar (upper cap dragged up, lower
  // mirrored). getDatasets(): [0] Sample A, [1] SD upper, [2] SD lower.
  function twoPointsWithErrorBars() {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.renameDataset(0, 'Sample A');
    session.addDataPoint(200, 200); // datum 0
    session.addDataPoint(300, 150); // datum 1
    session.captureErrorCap({ targetIndex: 0, datumPixel: { x: 200, y: 200 }, capPixel: { x: 200, y: 170 }, baseName: 'SD' });
    session.captureErrorCap({ targetIndex: 0, datumPixel: { x: 300, y: 150 }, capPixel: { x: 300, y: 120 }, baseName: 'SD' });
    return session;
  }

  it('cascade: deleting a data point takes its error bar (both caps), leaving the other point whole', () => {
    const session = twoPointsWithErrorBars();
    expect(session.getDatasets()[0]!.getAllPixels()).toHaveLength(2);
    expect(session.getDatasets()[1]!.getAllPixels()).toHaveLength(2);
    expect(session.getDatasets()[2]!.getAllPixels()).toHaveLength(2);

    session.setActiveDataset(0);
    session.removeDataPoints([0]); // delete datum 0

    expect(session.getDatasets()[0]!.getAllPixels()).toHaveLength(1); // one datum left
    expect(session.getDatasets()[1]!.getAllPixels()).toHaveLength(1); // its upper cap gone
    expect(session.getDatasets()[2]!.getAllPixels()).toHaveLength(1); // its lower cap gone
    expect(session.getDatasets()[0]!.getPixel(0)).toMatchObject({ x: 300, y: 150 }); // datum 1 survived
  });

  it('pair: deleting a cap in an SD series removes the matched pair, leaving the data point', () => {
    const session = twoPointsWithErrorBars();
    session.setActiveDataset(1); // SD upper active
    session.removeDataPoints([0]); // erase the first upper cap

    expect(session.getDatasets()[0]!.getAllPixels()).toHaveLength(2); // data points untouched
    expect(session.getDatasets()[1]!.getAllPixels()).toHaveLength(1); // that upper cap gone
    expect(session.getDatasets()[2]!.getAllPixels()).toHaveLength(1); // its lower sibling gone too
  });
});
