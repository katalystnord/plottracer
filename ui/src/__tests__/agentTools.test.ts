import { describe, expect, it } from 'vitest';
import { SEEING_TOOLS, describeState, planView, type AgentStateInput } from '../agent/agentTools.js';

// The agent's two ways of SEEING (v2.7, docs/v2.7-mcp-cases.md, M4-M5). The
// window gathers the facts; these pure halves decide what the agent is told.

const base: AgentStateInput = {
  figure: { fileName: 'contour.png', width: 800, height: 600 },
  graphType: 'Contour',
  calibrated: true,
  step: null,
  tip: 'Pick a line on the canvas, or press Find lines.',
  series: [
    { index: 0, name: 'Line 1', colour: [31, 119, 180], pointCount: 120, level: { value: 0.5, source: 'typed' }, selected: true },
    { index: 1, name: 'Line 2', colour: [255, 127, 14], pointCount: 0, level: null, selected: false },
  ],
  places: [{ kind: 'bridge', at: [412, 230], text: 'A gap was bridged here.' }],
};

describe('what the agent sees (M4, M5)', () => {
  it('M5: get_state names the figure, the graph type and that it is calibrated', () => {
    const text = describeState(base);
    expect(text).toContain('contour.png');
    expect(text).toContain('800 × 600');
    expect(text).toMatch(/Graph type: Contour/);
    expect(text).toMatch(/Calibration: done/);
  });

  it('M5: get_state gives the prompt on screen, in the same words', () => {
    expect(describeState(base)).toContain('"Pick a line on the canvas, or press Find lines."');
  });

  it('M5 / M9a: every series is listed by id, name, colour, point count and level', () => {
    const text = describeState(base);
    expect(text).toContain('[1] "Line 1" - 120 points, level 0.5 (typed), colour #1f77b4, selected on screen');
    expect(text).toContain('[2] "Line 2" - 0 points, no level, colour #ff7f0e');
  });

  it('M5: get_state lists the places to check, with where they are', () => {
    expect(describeState(base)).toContain('bridge at (412, 230): A gap was bridged here.');
  });

  it('M7: an uncalibrated figure says the user calibrates, and on which step the walk is', () => {
    const text = describeState({
      ...base,
      calibrated: false,
      step: { index: 1, count: 4, label: 'X axis, second point' },
      series: [],
      places: [],
    });
    expect(text).toMatch(/Calibration: not done/);
    expect(text).toMatch(/step 2 of 4: "X axis, second point"/);
    expect(text).toMatch(/ask the user to pick its graph type and calibrate it in PlotTracer/i);
  });

  it('with no figure open, get_state says so', () => {
    expect(describeState({ ...base, figure: null, series: [], places: [] })).toMatch(/No figure is open/);
  });

  it('M4: view_figure shows the whole figure when no region is asked for, at no more than its own size', () => {
    expect(planView({ imageWidth: 800, imageHeight: 600 })).toMatchObject({ x: 0, y: 0, width: 800, height: 600, scale: 1, outWidth: 800, outHeight: 600 });
  });

  it('M4: a large figure is scaled down to fit, and the answer says by how much', () => {
    const p = planView({ imageWidth: 3200, imageHeight: 1600 }) as { scale: number };
    expect(p).toMatchObject({ width: 3200, height: 1600, outWidth: 1568, outHeight: 784 });
    expect(p.scale).toBeCloseTo(0.49, 2);
  });

  it('M4: a region is shown at the zoom asked for', () => {
    expect(planView({ imageWidth: 800, imageHeight: 600, region: { x: 400, y: 200, width: 50, height: 40 }, zoom: 8 }))
      .toMatchObject({ x: 400, y: 200, width: 50, height: 40, scale: 8, outWidth: 400, outHeight: 320 });
  });

  it('M4: a region running off the figure is cut to the figure', () => {
    expect(planView({ imageWidth: 800, imageHeight: 600, region: { x: 780, y: -10, width: 50, height: 40 } }))
      .toMatchObject({ x: 780, y: 0, width: 20, height: 30 });
  });

  it('M4: a zoom too large for the picture is reduced, and the reason given', () => {
    const p = planView({ imageWidth: 800, imageHeight: 600, region: { x: 0, y: 0, width: 400, height: 300 }, zoom: 10 }) as { scale: number; note?: string };
    expect(p.scale).toBeCloseTo(3.92, 2);
    expect(p.note).toMatch(/reduced/);
  });

  it('M4: a region wholly outside the figure is refused', () => {
    expect(planView({ imageWidth: 800, imageHeight: 600, region: { x: 900, y: 0, width: 50, height: 40 } })).toMatchObject({
      error: expect.stringMatching(/outside the figure/),
    });
  });

  it('the looking tools are the ones that exist, each described', () => {
    expect(SEEING_TOOLS.map((t) => t.name)).toEqual(['get_state', 'view_figure']);
    for (const t of SEEING_TOOLS) {
      expect(t.description.length).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe('object');
    }
  });
});
