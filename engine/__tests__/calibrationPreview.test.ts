import { describe, expect, it } from 'vitest';
import { calibrationPreview } from '../calibrationPreview.js';
import {
  CalibrationSession,
  XY_AXES_CONFIG,
  HISTOGRAM_AXES_CONFIG,
  TERNARY_AXES_CONFIG,
  CIRCULAR_CHART_RECORDER_AXES_CONFIG,
  POLAR_AXES_CONFIG,
} from '../calibrationSession.js';

/**
 * Checkpoint 84 — the calibration's own geometry, drawn.
 *
 * Until now we drew the handles and nothing between them, so a mis-clicked
 * handle gave a wrong-but-plausible chart with nothing on screen wrong.
 */
const cfg = (axesKind: 'xy' | 'bar' | 'polar' | 'ternary' | 'map' | 'ccr', keys: string[]) => ({
  axesKind,
  steps: keys.map((key, i) => ({ key, color: `#00000${i}` })),
});

describe('calibrationPreview — what the user implied', () => {
  it('joins X1->X2 and Y1->Y2 on an XY chart', () => {
    const p = calibrationPreview(cfg('xy', ['x1', 'x2', 'y1', 'y2']), {
      x1: { px: 100, py: 300 },
      x2: { px: 400, py: 300 },
      y1: { px: 100, py: 300 },
      y2: { px: 100, py: 50 },
    });
    expect(p.segments).toEqual([
      { from: { x: 100, y: 300 }, to: { x: 400, y: 300 }, color: '#000000' },
      { from: { x: 100, y: 300 }, to: { x: 100, y: 50 }, color: '#000002' },
    ]);
    expect(p.circles).toEqual([]);
  });

  it('is PROGRESSIVE — each pair draws as soon as its own points exist', () => {
    // WPD gates on getCount()===4: nothing appears until the last click. Each
    // pair here is independent, so you see the X axis you implied before you
    // have started on Y.
    const p = calibrationPreview(cfg('xy', ['x1', 'x2', 'y1', 'y2']), {
      x1: { px: 100, py: 300 },
      x2: { px: 400, py: 300 },
    });
    expect(p.segments).toHaveLength(1);
  });

  it('draws nothing from a lone point', () => {
    expect(calibrationPreview(cfg('xy', ['x1', 'x2', 'y1', 'y2']), { x1: { px: 1, py: 2 } }).segments).toEqual([]);
  });

  it('colours a line by its OWN axis, matching that handle\'s reticle', () => {
    // WPD hardcodes red/green. Ours reads the step's colour, so the line belongs
    // to its handles rather than reading as a third thing.
    const p = calibrationPreview(cfg('xy', ['x1', 'x2', 'y1', 'y2']), {
      x1: { px: 0, py: 0 },
      x2: { px: 1, py: 0 },
      y1: { px: 0, py: 0 },
      y2: { px: 0, py: 1 },
    });
    expect(p.segments[0]!.color).toBe('#000000'); // x1's colour
    expect(p.segments[1]!.color).toBe('#000002'); // y1's colour
  });

  it('closes the ternary triangle', () => {
    const p = calibrationPreview(cfg('ternary', ['a', 'b', 'c']), {
      a: { px: 0, py: 0 },
      b: { px: 10, py: 0 },
      c: { px: 5, py: 9 },
    });
    expect(p.segments.map((s) => [s.from, s.to])).toEqual([
      [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      [{ x: 10, y: 0 }, { x: 5, y: 9 }],
      [{ x: 5, y: 9 }, { x: 0, y: 0 }], // closed
    ]);
  });

  it('fits BOTH CCR circles from the 5 clicks — the case nobody can eyeball', () => {
    // Points on a unit circle about (100,100): the pen arc through 3 of them and
    // the chart circle through 3 more, sharing t0r2 exactly as WPD does.
    const on = (deg: number, r: number) => ({
      px: 100 + r * Math.cos((deg * Math.PI) / 180),
      py: 100 + r * Math.sin((deg * Math.PI) / 180),
    });
    const p = calibrationPreview(cfg('ccr', ['t0r0', 't0r1', 't0r2', 't1r2', 't2r2']), {
      t0r0: on(0, 50),
      t0r1: on(90, 50),
      t0r2: on(180, 50),
      t1r2: on(270, 50),
      t2r2: on(45, 50),
    });
    expect(p.circles).toHaveLength(2);
    for (const c of p.circles) {
      expect(c.cx).toBeCloseTo(100, 6);
      expect(c.cy).toBeCloseTo(100, 6);
      expect(c.r).toBeCloseTo(50, 6);
    }
  });

  it('SKIPS a degenerate CCR fit rather than drawing garbage', () => {
    // Three collinear points have no circumcircle; the fit blows up. Drawing it
    // would have the user check their calibration against OUR bug.
    const p = calibrationPreview(cfg('ccr', ['t0r0', 't0r1', 't0r2', 't1r2', 't2r2']), {
      t0r0: { px: 0, py: 0 },
      t0r1: { px: 10, py: 0 },
      t0r2: { px: 20, py: 0 },
    });
    expect(p.circles).toEqual([]);
  });

  it('previews Polar and Map, which upstream leaves blind', () => {
    const polar = calibrationPreview(cfg('polar', ['origin', 'p1', 'p2']), {
      origin: { px: 100, py: 100 },
      p1: { px: 200, py: 100 },
    });
    expect(polar.segments).toHaveLength(1); // the radius vector, progressive
    const map = calibrationPreview(cfg('map', ['p1', 'p2']), {
      p1: { px: 0, py: 0 },
      p2: { px: 50, py: 0 },
    });
    expect(map.segments).toHaveLength(1); // the scale bar
  });
});

describe('getCalibrationPreview — live off the real session', () => {
  function place(session: CalibrationSession<never>, pts: Array<[number, number, string[]]>) {
    for (const [px, py, values] of pts) {
      expect(session.handleCalibrationClick(px, py)).toBe('awaiting-value');
      expect(session.confirmCalibrationValues(values)).toBe(true);
    }
  }

  it('appears as you place, before Calibrate is ever pressed', () => {
    const s = new CalibrationSession(XY_AXES_CONFIG);
    expect(s.getCalibrationPreview().segments).toEqual([]);
    place(s as never, [
      [100, 300, ['0']],
      [400, 300, ['10']],
    ]);
    // The X axis is visible with two clicks in and no calibration run.
    expect(s.getCalibrationPreview().segments).toHaveLength(1);
  });

  it('follows a dragged handle — it is live, not a snapshot', () => {
    const s = new CalibrationSession(XY_AXES_CONFIG);
    place(s as never, [
      [100, 300, ['0']],
      [400, 300, ['10']],
    ]);
    s.updateCalibPointPixel('x2', 500, 280);
    expect(s.getCalibrationPreview().segments[0]!.to).toEqual({ x: 500, y: 280 });
  });

  it('Histogram gets it for free — gated on axesKind, not config.id', () => {
    // Checkpoint 73's rule. Histogram declares axesKind 'xy', so it needs no
    // entry of its own and cannot be forgotten.
    const s = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
    place(s as never, [
      [100, 300, ['0']],
      [400, 300, ['10']],
    ]);
    expect(s.getCalibrationPreview().segments).toHaveLength(1);
  });

  it('every axes type has SOME preview declared', () => {
    // Guards the "two of seven left blind" outcome: if a new axes type lands
    // with no preview, this fails.
    for (const config of [
      XY_AXES_CONFIG,
      TERNARY_AXES_CONFIG,
      POLAR_AXES_CONFIG,
      CIRCULAR_CHART_RECORDER_AXES_CONFIG,
    ]) {
      const s = new CalibrationSession(config as never);
      const p = s.getCalibrationPreview();
      // Nothing placed yet -> nothing drawn, but the call must be safe on all.
      expect(p.segments).toEqual([]);
      expect(p.circles).toEqual([]);
    }
  });
});
