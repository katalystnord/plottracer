import { describe, expect, it } from 'vitest';
import { ALL_AXES_TYPE_CONFIGS } from '../axesTypeConfigs.js';
import { dataAreaApplies } from '../dataArea.js';

/**
 * The tick-mark step, its settled half (David, 2026-11-01, docs/v2.7-workflow-walk.md, "The data area, apart from the
 * calibration"): "First you do a click drag for the data area. And then set the tick marks for value calibration",
 * with "at least two tick marks for any value chart". So on every graph type that is XY in some form, each value
 * axis's calibration step asks for a LABELLED TICK MARK and the number printed there, not for "the pixel position of
 * a known value". The heatmap's corner walk is left as it is: where its points go is an open question.
 */
const VALUE_STEPS = ['x1', 'x2', 'y1', 'y2', 'p1', 'p2', 'v1', 'v2'];
const xyFamily = ALL_AXES_TYPE_CONFIGS.filter((c) => dataAreaApplies(c) && c.id !== 'heatmap');

describe('every value axis is calibrated on labelled tick marks', () => {
  for (const config of xyFamily) {
    it(`${config.label}: each value step asks for a labelled tick mark and the number printed there`, () => {
      const steps = config.fixedSteps.filter((st) => VALUE_STEPS.includes(st.key) && st.valueFields.length > 0);
      expect(steps.length, 'two per value axis').toBeGreaterThanOrEqual(2);
      for (const st of steps) {
        expect(st.prompt, `${config.label} ${st.label}`).toMatch(/labelled tick mark/);
        expect(st.prompt, `${config.label} ${st.label}`).not.toMatch(/pixel position|known value|known X|known Y|known bar/);
      }
    });
  }

  it('the second tick on an axis asks for a different number than the first', () => {
    for (const config of xyFamily) {
      for (const key of ['x2', 'y2', 'p2', 'v2']) {
        const st = config.fixedSteps.find((s) => s.key === key);
        if (st) expect(st.prompt, `${config.label} ${st.label}`).toMatch(/second labelled tick mark.*different number/);
      }
    }
  });
});
