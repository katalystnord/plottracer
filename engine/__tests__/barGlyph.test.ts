import { describe, expect, it } from 'vitest';
import { computeBarGlyph } from '../barGlyph.js';
import { BAR_AXES_CONFIG, CalibrationSession } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * ⚑⚑ THE BAR'S MARK STANDS ON THE FIGURE'S COMMON ORIGIN (v2.5).
 *
 * David chose it when the value model changed: *"they all NEED (for bars) to
 * come to the same common axis."* If the number is measured from the origin, the
 * picture has to show that, or the data is right while the picture lies - the
 * pairing this project calls its worst.
 *
 * ⚑ It is also the only thing on screen that can distinguish a bar clicked
 * short of the axis from one drawn to it, now that the near corner no longer
 * decides the number. A staple whose foot floats clear of the figure's own bar
 * tells the user, without a sentence, that they may want a Span chart.
 */

/** Value axis: 0 at py 500, 10 at py 100. */
function calibratedBar(options: Record<string, string> = {}) {
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  for (const [k, v] of Object.entries(options)) s.setOption(k, v);
  s.handleCalibrationClick(300, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(300, 100);
  s.confirmCalibrationValues(['10']);
  walkCategoryAxis(s, { count: 2 });
  expect(s.runCalibration()).toBe(true);
  return s;
}

describe('the geometry', () => {
  it('spans the FAR corners and drops a leg from each to the origin', () => {
    const glyph = computeBarGlyph({ x: 100, y: 300 }, { x: 160, y: 480 }, 500, false);
    // The span sits at the far end (y=300), not at either clicked y in turn.
    expect(glyph[0]).toEqual({ from: { x: 100, y: 300 }, to: { x: 160, y: 300 } });
    expect(glyph[1]!.to.y).toBe(500);
    expect(glyph[2]!.to.y).toBe(500);
  });

  it('⚑ reads the far end from the ORIGIN, so a bar drawn downwards is not upside down', () => {
    // Origin at py 300, bar hanging to py 480: the far end is 480.
    const glyph = computeBarGlyph({ x: 100, y: 302 }, { x: 160, y: 480 }, 300, false);
    expect(glyph[0]!.from.y).toBe(480);
    expect(glyph[1]!.to.y).toBe(300);
  });

  it('⚑ lies on its side when the categories run down the page', () => {
    const glyph = computeBarGlyph({ x: 400, y: 100 }, { x: 202, y: 160 }, 200, true);
    expect(glyph[0]).toEqual({ from: { x: 400, y: 100 }, to: { x: 400, y: 160 } });
    expect(glyph[1]!.to.x).toBe(200);
  });

  it('draws nothing when there is no origin to stand on', () => {
    expect(computeBarGlyph({ x: 1, y: 2 }, { x: 3, y: 4 }, NaN, false)).toEqual([]);
  });
});

describe('when the session offers it', () => {
  it('⚑⚑ a captured bar gets a mark at all - it used to be two loose dots', () => {
    const s = calibratedBar();
    s.addDataPoint(150, 480);
    s.addDataPoint(210, 300);
    const [glyph] = s.getTupleGlyphs();
    expect(glyph).toHaveLength(3);
    // Both legs reach the declared origin's pixel.
    expect(glyph!.filter((seg) => seg.to.y === 500)).toHaveLength(2);
  });

  it('⚑⚑ but NOT on a stacked figure, where a segment sits on the one below it', () => {
    // ⚠️ A leg dropped to the origin would be a straight lie there: a stacked
    // segment's value is its own height, measured from neither the origin nor
    // anything the user declared.
    const s = calibratedBar({ isStacked: 'true' });
    s.addDataPoint(150, 400);
    s.addDataPoint(210, 300);
    expect(s.getTupleGlyphs()).toEqual([]);
  });

  it('a half-dragged bar draws nothing, the rule every glyph follows', () => {
    const s = calibratedBar();
    s.addDataPoint(150, 480);
    expect(s.getTupleGlyphs()).toEqual([]);
  });
});
