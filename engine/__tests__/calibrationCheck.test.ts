import { describe, expect, it } from 'vitest';
import { Calibration } from '../../core/calibration.js';
import { XYAxes } from '../../core/axes/xy.js';
import { BarAxes } from '../../core/axes/bar.js';
import { calibrationCheckBox } from '../calibrationCheck.js';

// X: 0 at px 100, 10 at px 500. Y: 0 at py 500, 10 at py 100. So the calibrated
// axis box has data corners (0,0),(0,10),(10,10),(10,0) mapping to the pixels
// (100,500),(100,100),(500,100),(500,500).
function calibratedXY(): XYAxes {
  const cal = new Calibration(2);
  cal.addPoint(100, 500, '0', '0');
  cal.addPoint(500, 500, '10', '0');
  cal.addPoint(100, 500, '0', '0');
  cal.addPoint(100, 100, '0', '10');
  const axes = new XYAxes();
  axes.calibrate(cal, false, false, true);
  return axes;
}

describe('calibrationCheckBox', () => {
  it('maps the 4 calibrated data corners back to their pixel positions', () => {
    const box = calibrationCheckBox(calibratedXY());
    expect(box).not.toBeNull();
    expect(box).toHaveLength(4);
    // Order: (x1,y3),(x1,y4),(x2,y4),(x2,y3).
    const round = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });
    expect(box!.map(round)).toEqual([
      { x: 100, y: 500 },
      { x: 100, y: 100 },
      { x: 500, y: 100 },
      { x: 500, y: 500 },
    ]);
  });

  it('returns null for a non-XY axes class (no rectangular extent)', () => {
    // BarAxes has no getBounds and a stub dataToPixel -- not checkable.
    expect(calibrationCheckBox(new BarAxes())).toBeNull();
  });

  it('returns null for null / a plain object', () => {
    expect(calibrationCheckBox(null)).toBeNull();
    expect(calibrationCheckBox({})).toBeNull();
  });
});
