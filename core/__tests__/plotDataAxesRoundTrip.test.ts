import { describe, expect, it } from 'vitest';
import { PlotData, type AnyAxes } from '../plotData.js';
import { Dataset } from '../dataset.js';
import { Calibration } from '../calibration.js';
import { XYAxes } from '../axes/xy.js';
import { BarAxes } from '../axes/bar.js';
import { PolarAxes } from '../axes/polar.js';
import { TernaryAxes } from '../axes/ternary.js';
import { MapAxes } from '../axes/map.js';
import { ImageAxes } from '../axes/image.js';
import { CircularChartRecorderAxes } from '../axes/circularChartRecorder.js';
import { SpiderAxes } from '../axes/spider.js';
import { PieAxes } from '../axes/pie.js';

/**
 * Every axes type through a full save-and-reopen — **the settings, not just
 * the points.**
 *
 * ⚑ WHY THIS FILE EXISTS. `core/plotData.ts`'s `_deserializeVersion4` is the
 * READ side of our own format, and the 2026-07-31 mutation run left ~150
 * survivors concentrated in it: the per-type reconstruction branches. Each
 * axes type writes its own settings (log flags, orientation, units, rotation
 * period…) and reads them back, and almost none of those readbacks were
 * pinned by anything.
 *
 * ⚑ THE FAILURE THIS GUARDS AGAINST IS SILENT AND TOTAL. If a log flag is
 * dropped on read, the file still opens, every point is still there, the
 * calibration still "succeeds" — and every value is wrong by orders of
 * magnitude. This exact class already bit this project once: TernaryAxes used
 * to serialize its orientation as a FUNCTION REFERENCE, which
 * `JSON.stringify` silently drops, so a Normal ternary reopened as Reverse
 * and permuted every (a,b,c) datum. That divergence is documented in
 * plotData.ts's own serialize; this file is what would have caught it.
 *
 * So each case below round-trips through REAL JSON (`JSON.parse(JSON
 * .stringify(...))`, not the in-memory object) — because the JSON step is
 * where that bug lived, and an in-memory round trip would have sailed past
 * it — and asserts the reopened axes reports back the same settings AND
 * reads the same value at the same pixel.
 */

/** Save through actual JSON, reopen, and hand back the reconstructed axes.
 * The caller names the type it expects; a wrong guess fails at the assertion,
 * not silently. */
function reopen<T>(build: (plot: PlotData) => void): { axes: T; plot: PlotData } {
  const source = new PlotData();
  build(source);
  const onDisk = JSON.parse(JSON.stringify(source.serialize()));
  const target = new PlotData();
  expect(target.deserialize(onDisk), 'the file we just wrote must be readable').not.toBe(false);
  expect(target.getAxesCount()).toBe(1);
  return { axes: target.getAxesColl()[0] as T, plot: target };
}

function xyCalibration(): Calibration {
  const cal = new Calibration(2);
  cal.addPoint(100, 250, '1', '0');
  cal.addPoint(400, 250, '1000', '0');
  cal.addPoint(100, 250, '0', '1');
  cal.addPoint(100, 100, '0', '1000');
  return cal;
}

describe('XY axes survive a save and reopen', () => {
  it('keeps BOTH log flags independently, and reads the same value back', () => {
    // ⚑ Independently is the point: a reader that wired isLogY from isLogX
    // would pass any test using the same value for both.
    const { axes } = reopen<XYAxes>((plot) => {
      const a = new XYAxes();
      a.name = 'XY';
      expect(a.calibrate(xyCalibration(), true, false, false)).toBe(true);
      plot.addAxes(a);
    });
    expect(axes.isLogX()).toBe(true);
    expect(axes.isLogY()).toBe(false);
    // 250px is halfway along a decade-spanning log x -- 10^1.5, not 500.
    expect(axes.pixelToData(250, 250)[0]).toBeCloseTo(Math.pow(10, 1.5), 6);
  });

  it('keeps a linear axes linear, and its rotation-correction choice', () => {
    const { axes } = reopen<XYAxes>((plot) => {
      const a = new XYAxes();
      a.name = 'XY';
      expect(a.calibrate(xyCalibration(), false, false, true)).toBe(true);
      plot.addAxes(a);
    });
    expect(axes.isLogX()).toBe(false);
    expect(axes.isLogY()).toBe(false);
    expect(axes.noRotation()).toBe(true);
  });

  it('keeps the OTHER log flag when only Y is logarithmic', () => {
    const { axes } = reopen<XYAxes>((plot) => {
      const a = new XYAxes();
      a.name = 'XY';
      expect(a.calibrate(xyCalibration(), false, true, false)).toBe(true);
      plot.addAxes(a);
    });
    expect(axes.isLogX()).toBe(false);
    expect(axes.isLogY()).toBe(true);
  });
});

describe('Bar axes survive a save and reopen', () => {
  function barAxes(isLog: boolean, isRotated: boolean) {
    return reopen<BarAxes>((plot) => {
      const cal = new Calibration(2);
      cal.addPoint(300, 500, '0', isLog ? '1' : '0');
      cal.addPoint(300, 100, '0', isLog ? '1000' : '10');
      const a = new BarAxes();
      a.name = 'Bar';
      expect(a.calibrate(cal, isLog, isRotated)).toBe(true);
      plot.addAxes(a);
    }).axes;
  }

  it('keeps the log flag and reads a log value back correctly', () => {
    const axes = barAxes(true, false);
    expect(axes.isLog()).toBe(true);
    expect(axes.pixelToData(300, 300)[0]).toBeCloseTo(Math.pow(10, 1.5), 4);
  });

  it('keeps the horizontal-bars flag, which decides which way values are read', () => {
    expect(barAxes(false, true).isRotated()).toBe(true);
    expect(barAxes(false, false).isRotated()).toBe(false);
  });
});

describe('Polar axes survive a save and reopen', () => {
  function polarAxes(isDegrees: boolean, isClockwise: boolean, isLogR: boolean) {
    return reopen<PolarAxes>((plot) => {
      const cal = new Calibration(2);
      cal.addPoint(100, 100, '0', '0');
      cal.addPoint(200, 100, isLogR ? '10' : '10', '0');
      cal.addPoint(300, 100, isLogR ? '100' : '20', '0');
      const a = new PolarAxes();
      a.name = 'Polar';
      expect(a.calibrate(cal, isDegrees, isClockwise, isLogR)).toBe(true);
      plot.addAxes(a);
    }).axes;
  }

  it('keeps all THREE flags independently', () => {
    // Three booleans is where a reader most easily crosses wires; each is
    // asserted against a fixture where the others differ.
    const a = polarAxes(true, false, false);
    expect(a.isThetaDegrees()).toBe(true);
    expect(a.isThetaClockwise()).toBe(false);
    expect(a.isRadialLog()).toBe(false);

    const b = polarAxes(false, true, true);
    expect(b.isThetaDegrees()).toBe(false);
    expect(b.isThetaClockwise()).toBe(true);
    expect(b.isRadialLog()).toBe(true);
  });

  it('reads the same angle back after reopening — degrees stay degrees', () => {
    // North is 90 degrees anticlockwise from east; if the degrees flag were
    // dropped the same pixel reads 1.5708 and nothing else complains.
    expect(polarAxes(true, false, false).pixelToData(100, 0)[1]).toBeCloseTo(90, 6);
    expect(polarAxes(false, false, false).pixelToData(100, 0)[1]).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('Ternary axes survive a save and reopen', () => {
  function ternaryAxes(range100: boolean, isNormal: boolean) {
    return reopen<TernaryAxes>((plot) => {
      const cal = new Calibration(3);
      cal.addPoint(0, 200, '', '');
      cal.addPoint(200, 200, '', '');
      const a = new TernaryAxes();
      a.name = 'Ternary';
      expect(a.calibrate(cal, range100, isNormal)).toBe(true);
      plot.addAxes(a);
    }).axes;
  }

  it('⚑ keeps the ORIENTATION — the flag that once reopened as a dropped function reference', () => {
    // The documented regression: serializing the METHOD instead of calling it
    // meant JSON.stringify dropped the key, Boolean(undefined) read false, and
    // a Normal ternary silently reopened Reverse — permuting every datum. The
    // round trip below goes through real JSON precisely so that failure mode
    // is reachable here.
    expect(ternaryAxes(false, true).isNormalOrientation()).toBe(true);
    expect(ternaryAxes(false, false).isNormalOrientation()).toBe(false);
  });

  it('keeps the 0-100 range flag, and the components still sum to the range', () => {
    expect(ternaryAxes(true, true).isRange100()).toBe(true);
    expect(ternaryAxes(false, true).isRange100()).toBe(false);

    const asPercent = ternaryAxes(true, true).pixelToData(100, 150);
    expect(asPercent[0]! + asPercent[1]! + asPercent[2]!).toBeCloseTo(100, 6);
    const asFraction = ternaryAxes(false, true).pixelToData(100, 150);
    expect(asFraction[0]! + asFraction[1]! + asFraction[2]!).toBeCloseTo(1, 6);
  });

  it('reads the SAME point differently under the two orientations, after reopening', () => {
    // Proves the flag is not merely stored but actually reaches the maths.
    const normal = ternaryAxes(false, true).pixelToData(50, 150);
    const reversed = ternaryAxes(false, false).pixelToData(50, 150);
    expect(reversed[0]).toBeCloseTo(normal[2]!, 9);
    expect(reversed[1]).toBeCloseTo(normal[0]!, 9);
  });
});

describe('Map axes survive a save and reopen', () => {
  it('keeps the scale length, its units, the origin corner and the image height', () => {
    // Four values, none of them booleans, and all four feed the reading: a
    // dropped unit string alone makes every exported distance unlabelled.
    const { axes } = reopen<MapAxes>((plot) => {
      const cal = new Calibration(2);
      cal.addPoint(10, 10, '', '');
      cal.addPoint(10, 20, '', '');
      const a = new MapAxes();
      a.name = 'Map';
      expect(a.calibrate(cal, '100', 'km', 'bottom-left', 500)).toBe(true);
      plot.addAxes(a);
    });
    expect(axes.getScaleLength()).toBe(100);
    expect(axes.getUnits()).toBe('km');
    expect(axes.getOriginLocation()).toBe('bottom-left');
    expect(axes.getImageHeight()).toBe(500);
    // 10px is one scale-length; the reopened axes must still say so.
    expect(axes.pixelToDataDistance(10)).toBeCloseTo(100, 9);
  });

  it('keeps a top-left origin distinct from a bottom-left one', () => {
    const { axes } = reopen<MapAxes>((plot) => {
      const cal = new Calibration(2);
      cal.addPoint(10, 10, '', '');
      cal.addPoint(10, 20, '', '');
      const a = new MapAxes();
      a.name = 'Map';
      expect(a.calibrate(cal, '100', 'm', 'top-left', 500)).toBe(true);
      plot.addAxes(a);
    });
    expect(axes.getOriginLocation()).toBe('top-left');
  });
});

describe('Circular Chart Recorder axes survive a save and reopen', () => {
  function ccr(rotationTime: 'week' | 'day', direction: 'clockwise' | 'anticlockwise') {
    return reopen<CircularChartRecorderAxes>((plot) => {
      const cal = new Calibration(2);
      cal.addPoint(200, 150, '2024/01/01 00:00', '0');
      cal.addPoint(150, 100, '', '');
      cal.addPoint(100, 150, '', '100');
      cal.addPoint(0, 250, '', '');
      cal.addPoint(0, 50, '', '');
      const a = new CircularChartRecorderAxes();
      a.name = 'CCR';
      expect(a.calibrate(cal, '2024/01/01 00:00', rotationTime, direction)).toBe(true);
      plot.addAxes(a);
    }).axes;
  }

  it('keeps the rotation period and direction, both of which rescale every time reading', () => {
    const weekly = ccr('week', 'anticlockwise');
    expect(weekly.getRotationTime()).toBe('week');
    expect(weekly.getRotationDirection()).toBe('anticlockwise');

    const daily = ccr('day', 'clockwise');
    expect(daily.getRotationTime()).toBe('day');
    expect(daily.getRotationDirection()).toBe('clockwise');
  });

  it('keeps the start time, and reads the same instant back at the same pixel', () => {
    const axes = ccr('week', 'anticlockwise');
    expect(axes.getStartTime()).not.toBeNull();
    // A quarter turn is a quarter of the week, exactly as before the save --
    // which only holds if the period, direction AND start time all survived.
    const quarterWeekMs = (7 * 24 * 3600 * 1000) / 4;
    expect(axes.pixelToData(0, 250)[0]! - axes.tStart!).toBeCloseTo(quarterWeekMs, 3);
  });
});

describe('Spider axes survive a save and reopen', () => {
  it('⚑ keeps every SPOKE — its name, its own centre value, and the count', () => {
    // A spider's spokes live entirely in the calibration points, with the axis
    // NAME in the third slot (dz). plotData deliberately builds a 3-dimension
    // Calibration for this type; at 2 the names are dropped on the floor and
    // every spoke reloads unnamed while its numbers still read correctly --
    // exactly the silent kind of loss this whole file is about.
    const { axes } = reopen<SpiderAxes>((plot) => {
      const cal = new Calibration(3);
      cal.addPoint(200, 200, '', '0'); // shared origin
      cal.addPoint(200, 100, '10', '0', 'Strength');
      cal.addPoint(300, 200, '20', '0', 'Stiffness');
      cal.addPoint(200, 300, '30', '0', 'Cost');
      const a = new SpiderAxes();
      a.name = 'Spider';
      expect(a.calibrate(cal, false)).toBe(true);
      plot.addAxes(a);
    });
    expect(axes.getSpokeCount()).toBe(3);
    expect(axes.getSpokes().map((s) => s.name)).toEqual(['Strength', 'Stiffness', 'Cost']);
    expect(axes.getSpokes().map((s) => s.knownValue)).toEqual([10, 20, 30]);
    expect(axes.getSpokes().every((s) => s.centreValue === 0)).toBe(true);
    expect(axes.isLog()).toBe(false);
  });

  it('keeps a log spider logarithmic', () => {
    const { axes } = reopen<SpiderAxes>((plot) => {
      const cal = new Calibration(3);
      cal.addPoint(200, 200, '', '1');
      cal.addPoint(200, 100, '100', '1', 'A');
      cal.addPoint(300, 200, '100', '1', 'B');
      cal.addPoint(200, 300, '100', '1', 'C');
      const a = new SpiderAxes();
      a.name = 'Spider';
      expect(a.calibrate(cal, true)).toBe(true);
      plot.addAxes(a);
    });
    expect(axes.isLog()).toBe(true);
  });
});

describe('Pie axes survive a save and reopen', () => {
  /**
   * ⚑ A PIE'S TOTAL AND SWEEP RIDE ON THE METADATA, AND ONLY THE ENGINE PUTS
   * THEM THERE. `PieAxes.calibrate()` stores them as plain FIELDS, which
   * serialize never looks at; what reaches the file is
   * `PIE_AXES_CONFIG.buildAxes`'s `setMetadata({pieTotal, pieSweep,
   * pieTilted})` in engine/calibrationSession.ts. So the fixture below sets
   * that metadata exactly as the app does — a pie built through `core/` alone
   * genuinely does NOT round-trip its total, which the last case pins
   * deliberately rather than leaving as folklore.
   */
  function pieOnDisk(meta: Record<string, string>, points: [number, number][] = [[300, 100], [400, 200], [300, 300], [200, 200]], tilted = false) {
    return reopen<PieAxes>((plot) => {
      const cal = new Calibration(2);
      for (const [x, y] of points) cal.addPoint(x, y, '', '');
      const a = new PieAxes();
      a.name = 'Pie';
      expect(a.calibrate(cal, parseFloat(meta['pieTotal'] ?? '100'), parseFloat(meta['pieSweep'] ?? '360'), tilted)).toBe(true);
      a.setMetadata({ ...a.getMetadata(), ...meta });
      plot.addAxes(a);
    }).axes;
  }

  it('⚑ keeps the total and the sweep, which live ONLY in the axes metadata', () => {
    // If the metadata guard or the metadata readback breaks, these are gone
    // and every slice's share silently rescales against the wrong whole.
    const axes = pieOnDisk({ pieTotal: '250', pieSweep: '360', pieTilted: 'false' });
    expect(axes.getDefaultTotal()).toBe(250);
    expect(axes.getSweep()).toBeCloseTo(2 * Math.PI, 9); // 360 degrees, in radians
  });

  it('keeps a HALF pie half, rather than reopening as a whole circle', () => {
    // The sweep is what a sector's share is measured against; a dropped sweep
    // halves every reading on a half pie with nothing on screen wrong.
    const axes = pieOnDisk({ pieTotal: '100', pieSweep: '180', pieTilted: 'false' });
    expect(axes.getSweep()).toBeCloseTo(Math.PI, 9);
  });

  it('⚑ keeps a TILTED pie tilted — reopening it as a circle would change every value', () => {
    // Its own comment states the stakes: a tilted pie re-read flat turns a 7%
    // slice into 13.4% while the readings still sum to 100, so nothing looks
    // wrong. Five points minimum, because an ellipse has five degrees of
    // freedom.
    const ellipse: [number, number][] = [[300, 200], [400, 230], [300, 260], [200, 230], [380, 215]];
    const axes = pieOnDisk({ pieTotal: '100', pieSweep: '360', pieTilted: 'true' }, ellipse, true);
    expect(axes.getMetadata()['pieTilted']).toBe('true');
  });

  it('reopens at the documented DEFAULTS when the metadata carries no total or sweep', () => {
    // Honest pinning of the fallback (`?? '100'` / `?? '360'` in plotData's
    // reader): a file without these keys is read as percentages of a whole
    // circle. Worth having explicit, because it is also what a pie built
    // outside the engine layer silently gets.
    const axes = pieOnDisk({});
    expect(axes.getDefaultTotal()).toBe(100);
    expect(axes.getSweep()).toBeCloseTo(2 * Math.PI, 9);
  });

  it('keeps a variable-length outline at its own length, not truncated to three', () => {
    // The reader builds the outline labels from the FILE's own point count;
    // its own comment promises a six-point outline reopens with six.
    const { axes } = reopen<PieAxes>((plot) => {
      const cal = new Calibration(2);
      for (const [x, y] of [[300, 100], [400, 150], [400, 250], [300, 300], [200, 250], [200, 150]]) {
        cal.addPoint(x!, y!, '', '');
      }
      const a = new PieAxes();
      a.name = 'Pie';
      expect(a.calibrate(cal, 100, 360, false)).toBe(true);
      plot.addAxes(a);
    });
    expect(axes.calibration!.getCount()).toBe(6);
  });
});

describe('Image axes survive a save and reopen', () => {
  it('reopens as an ImageAxes with no calibration expected of it', () => {
    // The one type with nothing to calibrate; the reader must not try to
    // build a Calibration for it.
    const { axes } = reopen<ImageAxes>((plot) => {
      const a = new ImageAxes();
      a.name = 'Image';
      plot.addAxes(a);
    });
    expect(axes).toBeInstanceOf(ImageAxes);
    expect(axes.name).toBe('Image');
  });
});

describe('the reopened project keeps its own relationships', () => {
  it('rebinds each dataset to the axes it was captured under, by name', () => {
    // The file stores the binding as a NAME; if the reader fails to resolve
    // it, points reopen unbound and read no values at all.
    const source = new PlotData();
    const a = new XYAxes();
    a.name = 'XY';
    expect(a.calibrate(xyCalibration(), false, false, false)).toBe(true);
    source.addAxes(a);
    const ds = new Dataset(2);
    ds.name = 'Series 1';
    ds.addPixel(250, 175);
    source.addDataset(ds);
    source.setAxesForDataset(ds, a);

    const target = new PlotData();
    expect(target.deserialize(JSON.parse(JSON.stringify(source.serialize())))).not.toBe(false);
    const reopenedDs = target.getDatasets()[0]!;
    const boundAxes = target.getAxesForDataset(reopenedDs);
    expect(boundAxes).not.toBeNull();
    expect(boundAxes!.name).toBe('XY');
    expect(reopenedDs.getCount()).toBe(1);
  });
});

/**
 * ⚑⚑ THE FIELDS THAT WERE SILENTLY LOST — v2.0 pre-launch audit, round 2.
 *
 * This file was written for exactly this failure class, and its Bar block
 * pinned `isLog` and `isRotated` — the two fields that PREDATE v2.0 — and
 * stopped. The two v2.0 added, `hasBaseline` and `baselineValue`, were written
 * by nothing and read by nothing, so a saved Bar project reopened against
 * BarAxes's defaults and the ONE number the whole bar model exists to produce
 * silently changed. A floating bar recorded as 5 came back as 7.5.
 *
 * The lesson is about the test, not only the code: a round-trip test that
 * enumerates the fields it knows about will keep passing for every field added
 * afterwards. These assert the SETTINGS a reader depends on, per class.
 */
describe('every Bar setting survives the round trip, not just the pre-v2.0 ones', () => {
  function roundTripBar(hasBaseline: boolean, baselineValue: number): BarAxes {
    const cal = new Calibration(2);
    cal.addPoint(300, 500, '0', '0');
    cal.addPoint(300, 100, '0', '10');
    const axes = new BarAxes();
    expect(axes.calibrate(cal, false, false)).toBe(true);
    axes.setBaseline(hasBaseline, baselineValue);

    const out = new PlotData();
    out.addAxes(axes as unknown as AnyAxes);
    const back = new PlotData();
    expect(back.deserialize(JSON.parse(JSON.stringify(out.serialize())))).not.toBe(false);
    return back.getAxesColl()[0] as unknown as BarAxes;
  }

  it('⚑ carries hasBaseline=false — the FLOATING bar the two-corner drag exists for', () => {
    // Lost, this reopens as a baseline-anchored bar and every value changes.
    expect(roundTripBar(false, 0).hasDeclaredBaseline()).toBe(false);
  });

  it('carries hasBaseline=true', () => {
    expect(roundTripBar(true, 0).hasDeclaredBaseline()).toBe(true);
  });

  it('⚑ carries a NON-ZERO baseline value', () => {
    // A bar chart whose axis starts at 20 is ordinary; reopening it against a
    // baseline of 0 shifts every reading by 20.
    expect(roundTripBar(true, 20).getBaselineValue()).toBeCloseTo(20, 9);
  });

  it('carries a negative baseline', () => {
    expect(roundTripBar(true, -5).getBaselineValue()).toBeCloseTo(-5, 9);
  });

  it('reads a file that predates these fields as the defaults it was always read with', () => {
    // Backward tolerance: an older file simply has no such keys.
    const out = new PlotData();
    const cal = new Calibration(2);
    cal.addPoint(300, 500, '0', '0');
    cal.addPoint(300, 100, '0', '10');
    const axes = new BarAxes();
    axes.calibrate(cal, false, false);
    out.addAxes(axes as unknown as AnyAxes);
    const raw = JSON.parse(JSON.stringify(out.serialize())) as {
      axesColl: Array<Record<string, unknown>>;
    };
    delete raw.axesColl[0]!.hasBaseline;
    delete raw.axesColl[0]!.baselineValue;
    const back = new PlotData();
    back.deserialize(raw as never);
    const restored = back.getAxesColl()[0] as unknown as BarAxes;
    expect(restored.hasDeclaredBaseline()).toBe(true);
    expect(restored.getBaselineValue()).toBe(0);
  });
});
