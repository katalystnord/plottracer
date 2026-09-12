import { describe, expect, it } from 'vitest';
import { TernaryAxes } from '../axes/ternary.js';
import { Calibration } from '../calibration.js';

/**
 * ⚑⚑ THE CORNERS CARRY THE FIGURE'S OWN WORDS, AND THE CLICK ORDER DECIDES
 * NOTHING ELSE.
 *
 * A ternary diagram's corners cannot be named in general - "A" means nothing
 * against a figure whose corners read Sand, Silt and Clay. So the walk collects
 * a name with each corner, exactly as a spider spoke does, and slot `i` is
 * whatever corner was clicked `i`-th.
 *
 * ⚑⚑ MEASURED: every one of the six click orders reads correctly, and the
 * handedness makes no difference because the determinant's sign cancels. There
 * is therefore nothing for an orientation setting to correct - the `Orientation:
 * Normal / Reverse` control (inherited with the ternary port) did exactly what
 * clicking the corners one place round already does, permuting a correct answer
 * into a different correct answer with nothing on screen to say which was
 * wanted. It is gone, and the names are what tell the components apart.
 */
describe('a ternary corner is identified by its name, not by an orientation setting', () => {
  const C1: [number, number] = [100, 300];
  const C2: [number, number] = [500, 300];
  const C3: [number, number] = [300, 54];
  const POINT: [number, number] = [230, 235];

  function calibratedWith(order: Array<[number, number]>, names: string[]): TernaryAxes {
    const cal = new Calibration(3);
    order.forEach(([x, y], i) => cal.addPoint(x, y, '', '', names[i]));
    const ax = new TernaryAxes();
    expect(ax.calibrate(cal, true)).toBe(true);
    return ax;
  }

  it('⚑ the corner names become the axes labels, in the order they were clicked', () => {
    const ax = calibratedWith([C1, C2, C3], ['Sand', 'Silt', 'Clay']);
    expect(ax.getAxesLabels()).toEqual(['Sand', 'Silt', 'Clay']);
  });

  it('⚑ an unnamed corner falls back to A, B, C rather than to a blank column', () => {
    const ax = calibratedWith([C1, C2, C3], ['', '', '']);
    expect(ax.getAxesLabels()).toEqual(['A', 'B', 'C']);
  });

  it('⚑⚑ the reading follows the NAME, whichever order the corners were clicked', () => {
    // The same physical point, captured by two users who started at different
    // corners. Each component must come back attached to the same word.
    const first = calibratedWith([C1, C2, C3], ['Sand', 'Silt', 'Clay']);
    const second = calibratedWith([C3, C1, C2], ['Clay', 'Sand', 'Silt']);

    const readBy = (ax: TernaryAxes): Record<string, number> => {
      const labels = ax.getAxesLabels();
      const values = ax.pixelToData(POINT[0], POINT[1]);
      return Object.fromEntries(labels.map((l, i) => [l, Math.round((values[i] ?? 0) * 10) / 10]));
    };

    expect(readBy(second)).toEqual(readBy(first));
  });
});
