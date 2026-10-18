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
    expect(v.choiceCard).not.toBeNull();
    expect(v.calibrationCard).toBe(false);
  });

  it('the choice card (David, 2026-10-18): "Graph extraction workflow", the automatic button plain and the manual one primary, each with its explanation', () => {
    expect(view(start).choiceCard).toEqual({
      title: 'Graph extraction workflow',
      automatic: {
        label: 'Try automatic graph extraction (beta)',
        primary: false,
        explanation: 'Experimental: PlotTracer suggests the graph type and reads the axes for you to check and accept. Not every graph type is supported yet.',
      },
      manual: {
        label: 'Go to manual guided extraction',
        primary: true,
        explanation: 'You choose the graph type and click the calibration points yourself. Works for every graph type.',
      },
    });
  });

  it('before a figure is captured there is no choice card (today\'s "Capture figure first")', () => {
    expect(view(start, false).choiceCard).toBeNull();
  });

  it('case 2: manual guided extraction shows today\'s calibration card with the hint line', () => {
    const v = view(nextAutoFlow(start, { kind: 'manual' }));
    expect(v.choiceCard).toBeNull();
    expect(v.calibrationCard).toBe(true);
    expect(v.manualHint).toBe('Start by selecting the appropriate graph type.');
  });
});

describe('step 1: the graph type', () => {
  const step1 = nextAutoFlow(start, { kind: 'automatic' });

  it('case 3: automatic opens the full Graph type card and the step guide card, with no Previous or Next', () => {
    const v = view(step1);
    expect(v.graphTypeCardOpen).toBe(true);
    expect(v.stepGuide).toEqual({ instruction: 'Please select graph type.', leave: 'Leave automated mode' });
    expect(v.axesCard).toBeNull();
    expect(v.choiceCard).toBeNull();
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
    for (const t of ['xy', 'bar', 'histogram']) expect(view(nextAutoFlow(step1, { kind: 'type', type: t })).axesCard).not.toBeNull();
    for (const t of ['pie', 'heatmap', 'boxplot', 'map', 'polar', 'ternary', 'spider', 'contour']) {
      expect(view(nextAutoFlow(step1, { kind: 'type', type: t })).apology).not.toBeNull();
    }
  });
});

describe('the axes card', () => {
  const axes = nextAutoFlow(nextAutoFlow(start, { kind: 'automatic' }), { kind: 'type', type: 'xy' });

  it('case 9 (revised, David 2026-10-18): XY clicked shows the calibration card at its axis points stage: [< Previous] [Leave automated mode] in a row, Read and Accept graph axis points each explained, and no Next', () => {
    const v = view(axes);
    expect(v.axesCard).toEqual({
      stage: 'points',
      leave: 'Leave automated mode',
      read: { label: 'Read graph axis', explanation: 'Finds the tick marks and labels on both axes and suggests the calibration.' },
      accept: {
        label: 'Accept graph axis points',
        explanation: 'Accepts the axis points and moves on to the tick marks. Select an axis point first to adjust it.',
      },
    });
    expect(v.graphTypeCardOpen).toBe(false);
  });

  it('the calibration card holds two acceptances (David): accepting the axis points shows its tick marks stage, with no Read', () => {
    const ticks = nextAutoFlow(axes, { kind: 'accepted-points' });
    const v = view(ticks);
    expect(v.axesCard).toEqual({
      stage: 'ticks',
      leave: 'Leave automated mode',
      read: null,
      accept: {
        label: 'Accept tick marks',
        explanation: 'Check the tick marks found on both axes, then accept them to complete the calibration.',
      },
    });
  });

  it('accepting the tick marks completes the calibration; while the legend step is not built, the walk hands over to the manual path', () => {
    const v = view(nextAutoFlow(nextAutoFlow(axes, { kind: 'accepted-points' }), { kind: 'accepted-ticks' }));
    expect(v.calibrationCard).toBe(true);
    expect(v.axesCard).toBeNull();
  });

  it('accepting the tick marks does nothing before the axis points are accepted', () => {
    expect(nextAutoFlow(axes, { kind: 'accepted-ticks' })).toEqual(axes);
  });

  it('Previous at the tick marks stage goes back to the axis points stage', () => {
    expect(nextAutoFlow(nextAutoFlow(axes, { kind: 'accepted-points' }), { kind: 'previous' })).toEqual(axes);
  });

  it('case 11: Previous on the axes card goes back to the graph type step', () => {
    const v = view(nextAutoFlow(axes, { kind: 'previous' }));
    expect(v.graphTypeCardOpen).toBe(true);
    expect(v.axesCard).toBeNull();
  });

  it('case 12: leave automatic extraction mode on the axes card shows the manual guided path', () => {
    const v = view(nextAutoFlow(axes, { kind: 'leave' }));
    expect(v.calibrationCard).toBe(true);
    expect(v.axesCard).toBeNull();
  });
});
