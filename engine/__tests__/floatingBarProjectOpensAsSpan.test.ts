import { describe, expect, it } from 'vitest';
import { BAR_AXES_CONFIG, SPAN_AXES_CONFIG, CalibrationSession } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { serializeProject, deserializeProject } from '../projectFile.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * ⚑⚑ AN ALL-FLOATING BAR PROJECT OPENS AS A SPAN CHART, AND SAYS SO (v2.5).
 *
 * David's call, and I flagged the cost when it was made: this reads the type off
 * the PIXELS' arrangement rather than off what the file declares. He chose it
 * anyway - which is why the notice is not decoration. It is the part that keeps
 * an inference from passing itself off as a fact.
 *
 * ⚑ The cases are named for what the SCREEN shows on opening, not for the
 * function (gate 2), and each one is a case that was named when this was
 * decided.
 */

/** Value axis 0 at py 500, 10 at py 100, two categories. */
function barProject(options: Record<string, string>, bars: [number, number, number][]) {
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  for (const [k, v] of Object.entries(options)) s.setOption(k, v);
  s.handleCalibrationClick(300, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(300, 100);
  s.confirmCalibrationValues(['10']);
  walkCategoryAxis(s, { count: 2 });
  expect(s.runCalibration()).toBe(true);
  for (const [x, y1, y2] of bars) {
    s.addDataPoint(x, y1);
    s.addDataPoint(x, y2);
  }
  const file = serializeProject(s, 'data:image/png;base64,AA==', 'figure.png');
  if ('error' in file) throw new Error(file.error);
  const back = deserializeProject(file);
  if ('error' in back) throw new Error(back.error);
  return back;
}

/** Floats between 2.5 and 7.5 - touches nothing. */
const FLOATING: [number, number, number] = [150, 400, 200];
const ALSO_FLOATING: [number, number, number] = [350, 380, 180];
/** Sits on the baseline at py 500. */
const SEATED: [number, number, number] = [350, 500, 300];

describe('opening a project whose bars all float', () => {
  it('opens it as a Span chart', () => {
    expect(barProject({}, [FLOATING, ALSO_FLOATING]).configId).toBe('span');
  });

  it('⚑⚑ and SAYS SO, because the recognition is ours and not the file’s', () => {
    const notice = barProject({}, [FLOATING, ALSO_FLOATING]).notice ?? '';
    expect(notice).toContain('Span chart');
    expect(notice).toMatch(/floats clear of the baseline/);
    // ⚑ It reassures about the RECORD, which is the true and reassuring half:
    // a span stores the same two corners, so nothing was converted or lost.
    expect(notice).toMatch(/Nothing in the record changed/);
  });

  it('⚑ the two ends read back as Min and Max, which is what the relabel is FOR', () => {
    const opened = barProject({}, [FLOATING, ALSO_FLOATING]);
    const s = new CalibrationSession(SPAN_AXES_CONFIG);
    s.loadCalibrated(opened.axes as never, opened.datasets, opened.categoryAxis);
    const first = s.getTupleRows()[0]!;
    expect(first.interval).toEqual({ min: 2.5, max: 7.5 });
  });
});

describe('what must NOT be relabelled', () => {
  it('⚑⚑ one seated bar and it is still a bar chart - a mixed figure is not a span', () => {
    const opened = barProject({}, [FLOATING, SEATED]);
    expect(opened.configId).toBe('bar');
    expect(opened.notice).toBeUndefined();
  });

  it('⚑ a STACKED figure, whose segments miss the baseline by construction', () => {
    // ⚠️ This is the case that makes the exclusion load-bearing rather than
    // tidy: without it EVERY stacked bar chart would be relabelled on open.
    const opened = barProject({ isStacked: 'true' }, [FLOATING, ALSO_FLOATING]);
    expect(opened.configId).toBe('bar');
  });

  it('a figure with nothing captured yet - there is no arrangement to read', () => {
    expect(barProject({}, []).configId).toBe('bar');
  });

  it('a project that already says Span chart, which needs no help', () => {
    const s = new CalibrationSession(SPAN_AXES_CONFIG);
    s.handleCalibrationClick(300, 500);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(300, 100);
    s.confirmCalibrationValues(['10']);
    walkCategoryAxis(s, { count: 2 });
    expect(s.runCalibration()).toBe(true);
    s.addDataPoint(150, 400);
    s.addDataPoint(150, 200);
    const file = serializeProject(s, 'data:image/png;base64,AA==', 'figure.png');
    if ('error' in file) throw new Error(file.error);
    const back = deserializeProject(file);
    if ('error' in back) throw new Error(back.error);
    expect(back.configId).toBe('span');
    expect(back.notice).toBeUndefined();
  });

  it('an ordinary bar chart opens as a Bar chart and says nothing at all', () => {
    const opened = barProject({}, [SEATED]);
    expect(opened.configId).toBe('bar');
    expect(opened.notice).toBeUndefined();
  });
});
