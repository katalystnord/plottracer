/**
 * Automatic graph extraction (beta): which card shows at each step (docs/v2.7-figure-type.md,
 * "Phase 1"; every case below is David's, 2026-10-16/18). The screen-level walk is in the e2e
 * suite; these are the decisions, unit-tested here because they live here.
 */
import { describe, expect, it } from 'vitest';
import { autoExtractionView, nextAutoFlow, type AutoFlow } from '../autoExtraction.js';

const start: AutoFlow = { path: 'unchosen' };
const view = (f: AutoFlow, captured = true) => autoExtractionView(f, captured);

describe('the choice between automatic and manual extraction', () => {
  it('case 1: a figure just captured shows the choice card in the calibration card\'s place', () => {
    const v = view(start);
    expect(v.choiceCard).toBe(true);
    expect(v.calibrationCard).toBe(false);
  });

  it('before a figure is captured there is no choice card (today\'s "Capture figure first")', () => {
    expect(view(start, false).choiceCard).toBe(false);
  });

  it('case 2: manual guided extraction shows today\'s calibration card with the hint line', () => {
    const v = view(nextAutoFlow(start, { kind: 'manual' }));
    expect(v.choiceCard).toBe(false);
    expect(v.calibrationCard).toBe(true);
    expect(v.manualHint).toBe('Start by selecting the appropriate graph type.');
  });
});

describe('step 1: the graph type', () => {
  const step1 = nextAutoFlow(start, { kind: 'automatic' });

  it('case 3: automatic opens the full Graph type card and the step guide card, with no Previous or Next', () => {
    const v = view(step1);
    expect(v.graphTypeCardOpen).toBe(true);
    expect(v.stepGuide).toEqual({ instruction: 'Please select graph type.', leave: 'Leave automatic extraction' });
    expect(v.previousNext).toBe(false);
    expect(v.choiceCard).toBe(false);
  });

  it('case 5: a type with no automatic extraction yet closes the Graph type card and shows the apology card; the step guide card is gone', () => {
    const v = view(nextAutoFlow(step1, { kind: 'type', type: 'pie' }));
    expect(v.graphTypeCardOpen).toBe(false);
    expect(v.apology).toEqual({
      text: 'Apologies, but we have not yet implemented an automatic extraction for this graph type.',
      back: 'Back to graph type selection',
      manual: 'Continue with manual guided extraction',
    });
    expect(v.stepGuide).toBeNull();
  });

  it('case 6: back to graph type selection opens the Graph type card again, with the step guide card', () => {
    const apology = nextAutoFlow(step1, { kind: 'type', type: 'pie' });
    const v = view(nextAutoFlow(apology, { kind: 'back-to-types' }));
    expect(v.graphTypeCardOpen).toBe(true);
    expect(v.stepGuide).not.toBeNull();
    expect(v.apology).toBeNull();
  });

  it('case 7: continue with manual guided extraction shows today\'s calibration card', () => {
    const apology = nextAutoFlow(step1, { kind: 'type', type: 'pie' });
    const v = view(nextAutoFlow(apology, { kind: 'manual' }));
    expect(v.calibrationCard).toBe(true);
    expect(v.apology).toBeNull();
  });

  it('case 8: leave automatic extraction at the graph type step shows the manual guided path', () => {
    const v = view(nextAutoFlow(step1, { kind: 'leave' }));
    expect(v.calibrationCard).toBe(true);
    expect(v.stepGuide).toBeNull();
    expect(v.graphTypeCardOpen).toBe(false);
  });

  it('XY, Bar and Histogram have an automatic workflow; the others do not (David, 2026-10-18)', () => {
    for (const t of ['xy', 'bar', 'histogram']) expect(view(nextAutoFlow(step1, { kind: 'type', type: t })).axesCard).toBe(true);
    for (const t of ['pie', 'heatmap', 'boxplot', 'map', 'polar', 'ternary', 'spider', 'contour']) {
      expect(view(nextAutoFlow(step1, { kind: 'type', type: t })).apology).not.toBeNull();
    }
  });
});

describe('the axes card', () => {
  const axes = nextAutoFlow(nextAutoFlow(start, { kind: 'automatic' }), { kind: 'type', type: 'xy' });

  it('case 9: XY clicked shows the axes card with Previous and Next, and no step guide or Graph type card', () => {
    const v = view(axes);
    expect(v.axesCard).toBe(true);
    expect(v.previousNext).toBe(true);
    expect(v.graphTypeCardOpen).toBe(false);
    expect(v.leave).toBe('Leave automatic extraction mode');
  });

  it('case 11: Previous on the axes card goes back to the graph type step', () => {
    const v = view(nextAutoFlow(axes, { kind: 'previous' }));
    expect(v.graphTypeCardOpen).toBe(true);
    expect(v.axesCard).toBe(false);
  });

  it('case 12: leave automatic extraction mode on the axes card shows the manual guided path', () => {
    const v = view(nextAutoFlow(axes, { kind: 'leave' }));
    expect(v.calibrationCard).toBe(true);
    expect(v.axesCard).toBe(false);
  });
});
