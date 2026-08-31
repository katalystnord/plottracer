import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { CalibrationSession, BAR_AXES_CONFIG } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';
import { readPng } from './helpers/readPng.js';
import { categoryTickDetectionMessage } from '../categoryTickOverlay.js';

/**
 * ⚑⚑ FINDING THE TICK MARKS THE FIGURE ITSELF DRAWS, on the category axis the
 * walk already marked (v2.4).
 *
 * David, driving the built app: *"The ticks were not auto detected properly...
 * I have to move them by hand. Was there a button for that?"* There was not, and
 * nothing detected anything: `algorithms/axisTicks.ts` was committed as
 * groundwork in `cecd0df` and had ZERO callers. The ticks on screen are
 * GENERATED evenly from the two clicked ends and the declared count, so on a
 * figure whose categories are not evenly spaced, dragging each one was the only
 * way to make them match the ink.
 *
 * ⚑ WHAT THIS LAYER ADDS, and it is deliberately thin: the pure detector never
 * sees an axis, a convention or a category count. The session knows all three,
 * so it is the only place that can say whether what was found FITS - and that
 * question is the whole reason detection can be OFFERED rather than applied.
 *
 * ⛔ OFFERED, NEVER ASSERTED. Detection reports what it saw; nothing moves until
 * the caller applies it. That is the v2.2 grid lesson in its plainest form - an
 * evenly divided guess drawn as confidently as a measurement made the tool look
 * wrong on every unequal figure - and it is why applying is a separate call.
 */

interface Anchor {
  px: number;
  py: number;
  value?: number;
}

/** The category axis of a bundled figure, exactly as its truth file records it:
 *  the outer edge of the first and last band, and the declared count. */
function categoryAxisOf(name: string): { from: Anchor; to: Anchor; count: number } {
  const truth = JSON.parse(readFileSync(`samples/${name}.truth.json`, 'utf8')) as {
    calibration: { anchors: Record<string, Anchor> };
  };
  const c1 = truth.calibration.anchors['c1']!;
  const c2 = truth.calibration.anchors['c2']!;
  return { from: c1, to: c2, count: c2.value! };
}

/** A bar session calibrated on a real figure, the way the walk leaves it. */
function sessionOn(name: string) {
  const axis = categoryAxisOf(name);
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  s.handleCalibrationClick(100, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(100, 100);
  s.confirmCalibrationValues(['30']);
  walkCategoryAxis(s, {
    from: { x: axis.from.px, y: axis.from.py },
    to: { x: axis.to.px, y: axis.to.py },
    count: axis.count,
  });
  expect(s.runCalibration()).toBe(true);
  return s;
}

describe('the ticks a figure draws, offered on the axis the user marked', () => {
  it('says nothing when there is no category axis to scan', () => {
    // ⚑ Not an error and not an empty list: with no axis there is no question,
    // and the control that calls this is not offered in that state either.
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    expect(s.detectCategoryTicks(readPng('samples/bar-tensile-strength.png'))).toBeNull();
  });

  it('⚑⚑ finds one mark per category on a real figure, where the figure drew them', () => {
    const s = sessionOn('bar-tensile-strength');
    const found = s.detectCategoryTicks(readPng('samples/bar-tensile-strength.png'))!;
    expect(found).not.toBeNull();
    // Six categories, `Centres`, so six marks are what fits.
    expect(found.expected).toBe(6);
    expect(found.positions).toHaveLength(6);
    expect(found.fits).toBe(true);
    // ⚑ AND THEY ARE WHERE THE BANDS ARE. The figure prints its ticks at the
    // category centres, so each detected position must land on the centre the
    // declared count implies - within a pixel, expressed as a fraction of the
    // axis. This is the assertion that would fail if the scan drifted, found the
    // gridlines, or came back in the wrong order.
    const span = Math.hypot(
      s.getCategoryAxis().getAxisEdges()![1].x - s.getCategoryAxis().getAxisEdges()![0].x,
      s.getCategoryAxis().getAxisEdges()![1].y - s.getCategoryAxis().getAxisEdges()![0].y
    );
    found.positions.forEach((p, i) => {
      expect(Math.abs(p - (i + 0.5) / 6) * span).toBeLessThan(1.5);
    });
  });

  it('reports how even they are, and never refuses on it', () => {
    // ⛔ Evenness is EVIDENCE, not a gate. A log axis's minor ticks are uneven on
    // purpose, so a caller that refused on evenness would refuse exactly the
    // figures where the marks matter most.
    const s = sessionOn('bar-tensile-strength');
    const found = s.detectCategoryTicks(readPng('samples/bar-tensile-strength.png'))!;
    expect(found.evenness).not.toBeNull();
    expect(found.evenness!).toBeLessThan(0.05);
  });

  it('applies what was found, and the ticks then sit on the ink', () => {
    const s = sessionOn('bar-tensile-strength');
    const found = s.detectCategoryTicks(readPng('samples/bar-tensile-strength.png'))!;
    expect(s.applyDetectedCategoryTicks(found.positions)).toBe(true);
    expect([...s.getCategoryAxis().getTickParams()]).toEqual(found.positions);
    // ⚑⚑ MARKED AS THE USER'S OWN, exactly as a dragged tick is. Changing the
    // tick convention regenerates evenly and discards them, and the card warns
    // before it does - which it can only do if these count as adjustments.
    expect(s.getCategoryAxis().hasAdjustments()).toBe(true);
  });

  it('⛔ refuses a set that does not fit the axis, and changes nothing', () => {
    // ⚠️ THE CASE THAT WOULD CORRUPT THE MAPPING. `restoreTickParams` REPAIRS a
    // wrong-length list by regenerating - which is right for a loaded file and
    // wrong here: a detection the user asked for must not silently throw away
    // the ticks they had already dragged. So the fit is checked BEFORE the
    // model is touched.
    const s = sessionOn('bar-tensile-strength');
    const before = [...s.getCategoryAxis().getTickParams()];
    expect(s.applyDetectedCategoryTicks([0.2, 0.5])).toBe(false);
    expect([...s.getCategoryAxis().getTickParams()]).toEqual(before);
  });
});

describe('what the card says after looking for the marks', () => {
  it('names the count it moved', () => {
    expect(categoryTickDetectionMessage(6, 6, true)).toBe(
      'Moved 6 ticks onto the marks the figure draws.'
    );
    expect(categoryTickDetectionMessage(1, 1, true)).toContain('1 tick onto the mark');
  });

  it('⛔ refuses with the REQUIREMENT, not just the count', () => {
    const m = categoryTickDetectionMessage(5, 6, false);
    expect(m).toContain('Found 5 marks');
    expect(m).toContain('needs 6');
    expect(m).toContain('Nothing was moved');
    // The two places a user can actually act: the declared count, and which
    // convention the figure uses.
    expect(m).toContain('number of categories');
    expect(m).toContain('boundaries');
  });

  it('says plainly when the figure draws none, and what to do instead', () => {
    const m = categoryTickDetectionMessage(0, 6, false);
    expect(m).toContain('No tick marks');
    expect(m).toContain('drag');
  });
});
