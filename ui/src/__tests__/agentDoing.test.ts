import { describe, expect, it } from 'vitest';
import { CalibrationSession, type CalibratedAxes } from '../../../engine/calibrationSession.js';
import { CONTOUR_AXES_CONFIG, XY_AXES_CONFIG } from '../../../engine/axesTypeConfigs.js';
import { History } from '../../../engine/history.js';
import type { LinePoint } from '../../../engine/lineEdits.js';
import { NOT_CALIBRATED, type AgentStateInput } from '../agent/agentTools.js';
import {
  AGENT_TOOLS,
  AgentStepLog,
  NEEDS_CALIBRATION,
  USER_CHANGED,
  doAgentTool,
  resolveSeries,
  type AgentDoingHost,
  type ToolResult,
} from '../agent/agentDoing.js';

// What an agent may DO (v2.7 phase 2, docs/v2.7-mcp-cases.md M6-M13), driven
// through the tool dispatcher over a REAL session, so a place or a cut is the
// model's own, not a stand-in's.

type Session = CalibrationSession<CalibratedAxes>;

function calibrate(config: unknown): Session {
  const s = new CalibrationSession<CalibratedAxes>(config as never);
  for (const [px, py, v] of [[100, 250, '0'], [400, 250, '10'], [100, 250, '0'], [100, 100, '10']] as const) {
    s.handleCalibrationClick(px, py);
    s.confirmCalibrationValues([v]);
  }
  expect(s.runCalibration()).toBe(true);
  return s;
}

const line = (pts: [number, number][]): LinePoint[] => pts.map(([x, y]) => ({ x, y, role: null }));

/** A host over a real session, its undo history kept the way Workspace keeps it. */
function host(session: Session, opts: { calibrated?: boolean } = {}) {
  const history = new History<string>(JSON.stringify(session.captureState()));
  const log = new AgentStepLog<string>();
  const seen = { commits: 0, waiting: 0, selection: null as null | { series: number; points: readonly number[] }, rendered: 0, scope: '' };
  const userEdit = () => {
    history.commit(JSON.stringify(session.captureState()) + '#user');
  };
  const h: AgentDoingHost = {
    getState: (): AgentStateInput => ({
      figure: { fileName: 'fig.png', width: 500, height: 300 },
      graphType: session.getConfig().label,
      calibrated: opts.calibrated ?? session.getAxes() !== null,
      step: null,
      tip: 'Click a point.',
      series: session.getDatasetInfos().map((d) => ({
        index: d.index, name: d.name, colour: d.color, pointCount: d.pointCount, level: session.getContourLevel(d.index), selected: d.active,
      })),
      places: [],
    }),
    renderRegion: () => { seen.rendered++; return 'data:image/png;base64,AAAA'; },
    session: () => session,
    placeLikeClick: (x, y) => { session.addDataPoint(x, y); },
    commitStep: (label) => {
      const snap = JSON.stringify(session.captureState()) + `#${seen.commits}`;
      history.commit(snap);
      log.record(snap, label);
      seen.commits++;
    },
    undoAgentStep: () => {
      const c = log.check(history.getPresent());
      if (c === 'none' || c === 'user-changed') return c;
      const snap = history.undo();
      if (snap) session.restoreState(JSON.parse(snap.replace(/#.*$/, '')));
      log.pop();
      return { undone: c.label };
    },
    showSelection: (series, points) => { seen.selection = { series, points }; },
    waitingForCalibration: () => { seen.waiting++; },
    afterRender: async () => undefined,
    findLines: async (colour) => ({ text: `found lines of ${colour}` }),
    inkAt: () => '#112233',
    maskArea: () => null,
    exportText: (format, scope) => { seen.scope = scope; return { content: format === 'json' ? '{}' : 'x,y\n1,2' }; },
    saveFile: async () => ({ error: 'Saving is off in Settings.' }),
    settings: () => ({ decimalComma: false, fullPrecision: false }),
  };
  return { h, seen, history, userEdit };
}

const textOf = (r: ToolResult | null) => (r?.content ?? []).filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n');

describe('M9a: the right series, always named', () => {
  const two = () => {
    const s = calibrate(XY_AXES_CONFIG);
    s.addFoundLines([line([[120, 200], [160, 200], [200, 200]]), line([[120, 150], [160, 150], [200, 150]])]);
    return s;
  };

  it('M9a: a point tool without a series is refused, and the refusal lists every series by id, name, colour and count', async () => {
    const { h } = host(two());
    const r = await doAgentTool('place_points', { points: [{ x: 300, y: 200 }] }, h);
    expect(r?.isError).toBe(true);
    expect(textOf(r)).toMatch(/Name the series/);
    expect(textOf(r)).toMatch(/\[1\] "Line 1" - 3 points, no level, colour #[0-9a-f]{6}/);
    expect(textOf(r)).toMatch(/\[2\] "Line 2" - 3 points/);
  });

  it('M9a: an unknown series id is refused, with the list', async () => {
    const { h } = host(two());
    const r = await doAgentTool('place_points', { series: 7, points: [{ x: 300, y: 200 }] }, h);
    expect(r?.isError).toBe(true);
    expect(textOf(r)).toMatch(/There is no series 7/);
    expect(textOf(r)).toMatch(/\[2\] "Line 2"/);
  });

  it('M9a: a name two series share is refused as ambiguous', () => {
    const series = [
      { index: 0, name: 'Data', colour: [0, 0, 0] as [number, number, number], pointCount: 1, level: null, selected: true },
      { index: 1, name: 'Data', colour: [9, 9, 9] as [number, number, number], pointCount: 2, level: null, selected: false },
    ];
    expect(resolveSeries('Data', series)).toMatchObject({ error: expect.stringMatching(/2 series are called "Data"/) });
  });

  it('M9a: a series may be named by its exact name when only one has it', () => {
    const { h } = host(two());
    expect(resolveSeries('Line 2', h.getState().series)).toEqual({ index: 1 });
    expect(resolveSeries(2, h.getState().series)).toEqual({ index: 1 });
  });

  it('M9a: every result names the series it acted on, and that series becomes the selected one on screen', async () => {
    const s = two();
    const { h, seen } = host(s);
    const r = await doAgentTool('place_points', { series: 2, points: [{ x: 300, y: 150 }] }, h);
    expect(r?.isError).toBeFalsy();
    expect(textOf(r)).toMatch(/series \[2\] "Line 2" \(now 4 points\)/);
    expect(s.getActiveDatasetIndex()).toBe(1);
    expect(seen.selection?.series).toBe(1);
  });

  it('M9a: after a step that adds or removes series, the result lists the new ids', async () => {
    const { h } = host(two());
    const r = await doAgentTool('cut_line', { series: 1, point: 2 }, h);
    expect(r?.isError).toBeFalsy();
    expect(textOf(r)).toMatch(/The series ids have changed/);
    expect(textOf(r)).toMatch(/\[3\]/);
  });

  it('M9a: series and points are counted from 1, as the screen counts them', async () => {
    const s = two();
    const { h } = host(s);
    const t = textOf(await doAgentTool('list_points', { series: 1 }, h));
    expect(t).toMatch(/^\[1\] "Line 1"/);
    expect(t).toMatch(/\n {2}1: pixel \(120, 200\)/);
    expect(textOf(await doAgentTool('list_points', { series: 0 }, h))).toMatch(/There is no series 0/);
  });

  it('M9a: add_series makes a named, empty series and selects it; rename_series renames one', async () => {
    const s = calibrate(XY_AXES_CONFIG);
    const { h, seen } = host(s);
    const r = await doAgentTool('add_series', { name: 'Blend B' }, h);
    expect(textOf(r)).toMatch(/Added series \[2\] "Blend B" \(now 0 points\)/);
    expect(s.getActiveDatasetIndex()).toBe(1);
    expect(textOf(await doAgentTool('rename_series', { series: 1, name: 'Blend A' }, h))).toMatch(/Renamed "Series 1" to series \[1\] "Blend A"/);
    const taken = await doAgentTool('add_series', { name: 'Blend A' }, h);
    expect(taken?.isError).toBe(true);
    expect(s.getDatasetInfos()).toHaveLength(2);
    expect(seen.commits).toBe(2);
  });

  it('M9: remove_series takes away several series in one step and lists the new ids', async () => {
    const s = calibrate(XY_AXES_CONFIG);
    s.addFoundLines([line([[120, 200], [160, 200]]), line([[120, 150], [160, 150]]), line([[120, 100], [160, 100]])]);
    const { h, seen } = host(s);
    const r = await doAgentTool('remove_series', { series: [2, 'Line 3'] }, h);
    expect(textOf(r)).toMatch(/Removed "Line 2", "Line 3"/);
    expect(textOf(r)).toMatch(/\[1\] "Line 1"/);
    expect(s.getDatasetInfos().map((d) => d.name)).toEqual(['Line 1']);
    expect(seen.commits).toBe(1);
    const bad = await doAgentTool('remove_series', { series: [1, 9] }, h);
    expect(textOf(bad)).toMatch(/Nothing was removed/);
    expect(s.getDatasetInfos()).toHaveLength(1);
  });

  it('M9a: every tool that reads or changes points requires its series', () => {
    for (const name of ['rename_series', 'remove_series', 'list_points', 'place_points', 'move_point', 'select_points', 'delete_points', 'cut_line', 'join_lines', 'move_to_line', 'set_level']) {
      const tool = AGENT_TOOLS.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.inputSchema.required, name).toContain('series');
    }
  });
});

describe('M7: the person calibrates', () => {
  it('M7: on an uncalibrated figure every tool that adds or changes data is refused with the calibrate message, and the screen is told an agent waits', async () => {
    const s = new CalibrationSession<CalibratedAxes>(XY_AXES_CONFIG as never);
    const { h, seen } = host(s, { calibrated: false });
    for (const name of NEEDS_CALIBRATION) {
      const r = await doAgentTool(name, { series: 1, points: [{ x: 1, y: 1 }], format: 'csv', region: { x: 0, y: 0, width: 5, height: 5 } }, h);
      expect(r?.isError, name).toBe(true);
      expect(textOf(r), name).toBe(NOT_CALIBRATED);
    }
    expect(seen.waiting).toBe(NEEDS_CALIBRATION.size);
  });

  it('M7 / Q5: no tool can calibrate, recalibrate or pick the graph type', () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    expect(names.some((n) => /calibrat|graph_type|axes/i.test(n))).toBe(false);
  });
});

describe('M9: the agent places, selects and moves points', () => {
  it('M9: place_points records each point as a click would - in the series, at the pixel, with its values', async () => {
    const s = calibrate(XY_AXES_CONFIG);
    const { h } = host(s);
    const r = await doAgentTool('place_points', { series: 1, points: [{ x: 250, y: 175 }, { x: 400, y: 100 }] }, h);
    expect(r?.isError).toBeFalsy();
    const pts = s.getDatasets()[0]!.getAllPixels();
    expect(pts.map((p) => [p.x, p.y])).toEqual([[250, 175], [400, 100]]);
    expect(textOf(r)).toMatch(/\(5, 5\)/);
    expect(textOf(r)).toMatch(/\(10, 10\)/);
    expect(textOf(r)).toMatch(/recorded as clicks/);
  });

  it('M9: every place or move returns a close-up picture with the new points ringed', async () => {
    const s = calibrate(XY_AXES_CONFIG);
    const { h, seen } = host(s);
    const r = await doAgentTool('place_points', { series: 1, points: [{ x: 250, y: 175 }] }, h);
    expect(r?.content.some((c) => c.type === 'image')).toBe(true);
    expect(seen.selection).toEqual({ series: 0, points: [0] });
    const m = await doAgentTool('move_point', { series: 1, point: 1, to: { x: 260, y: 175 } }, h);
    expect(m?.content.some((c) => c.type === 'image')).toBe(true);
    expect(s.getDatasets()[0]!.getPixel(0).x).toBe(260);
    expect(seen.rendered).toBe(2);
  });

  it('M9: a point outside the figure is refused and nothing is placed', async () => {
    const s = calibrate(XY_AXES_CONFIG);
    const { h, seen } = host(s);
    const r = await doAgentTool('place_points', { series: 1, points: [{ x: 250, y: 175 }, { x: 900, y: 10 }] }, h);
    expect(r?.isError).toBe(true);
    expect(textOf(r)).toMatch(/Point 1 is not a figure pixel/);
    expect(s.getDatasets()[0]!.getCount()).toBe(0);
    expect(seen.commits).toBe(0);
  });

  it('M9: select_points shows the selection on screen and changes no data', async () => {
    const s = calibrate(XY_AXES_CONFIG);
    s.addFoundLines([line([[120, 200], [160, 200], [200, 200], [240, 200]])]);
    const { h, seen } = host(s);
    const r = await doAgentTool('select_points', { series: 1, region: { x: 150, y: 190, width: 60, height: 20 } }, h);
    expect(textOf(r)).toMatch(/Selected 2 of the 4 points/);
    expect(seen.selection).toEqual({ series: 0, points: [1, 2] });
    expect(seen.commits).toBe(0);
  });

  it('M9: the corrections work through the model - delete in a rectangle, cut, join, move to another line', async () => {
    const s = calibrate(XY_AXES_CONFIG);
    s.addFoundLines([line([[120, 200], [160, 200], [200, 200], [240, 200]]), line([[260, 200], [300, 200]]), line([[120, 150], [160, 150]])]);
    const { h } = host(s);
    expect((await doAgentTool('join_lines', { series: 1, other: 2 }, h))?.isError).toBeFalsy();
    expect(s.getDatasetInfos()).toHaveLength(2);
    expect((await doAgentTool('move_to_line', { series: 2, points: [1], to: 1 }, h))?.isError).toBeFalsy();
    expect(s.getDatasetInfos()[1]!.pointCount).toBe(1);
    const del = await doAgentTool('delete_points', { series: 1, region: { x: 150, y: 190, width: 60, height: 20 } }, h);
    expect(textOf(del)).toMatch(/Deleted 2 points/);
  });

  it('M9: list_points gives each point its number, pixel, values and what was measured about it', async () => {
    const s = calibrate(XY_AXES_CONFIG);
    s.addFoundLines([[{ x: 100, y: 250, role: null }, { x: 250, y: 175, role: 'bridged' }]]);
    const { h } = host(s);
    const t = textOf(await doAgentTool('list_points', { series: 1 }, h));
    expect(t).toMatch(/1: pixel \(100, 250\) → \(0, 0\)/);
    expect(t).toMatch(/2: pixel \(250, 175\) → \(5, 5\), bridged/);
  });
});

describe('M11: one step, one Undo entry; the agent never undoes the user', () => {
  it('M11: one tool call is one undo entry, however many points it places', async () => {
    const s = calibrate(XY_AXES_CONFIG);
    const { h, seen } = host(s);
    await doAgentTool('place_points', { series: 1, points: [{ x: 200, y: 200 }, { x: 250, y: 175 }, { x: 300, y: 150 }] }, h);
    expect(seen.commits).toBe(1);
  });

  it('M11: the agent\'s undo takes back its own latest step while it is still the newest', async () => {
    const s = calibrate(XY_AXES_CONFIG);
    const { h } = host(s);
    await doAgentTool('place_points', { series: 1, points: [{ x: 200, y: 200 }, { x: 250, y: 175 }] }, h);
    const r = await doAgentTool('undo', {}, h);
    expect(textOf(r)).toMatch(/Undid your last step: place_points on series \[1\]/);
    expect(s.getDatasets()[0]!.getCount()).toBe(0);
  });

  it('M11: the agent\'s undo is refused once the user has changed the figure since', async () => {
    const s = calibrate(XY_AXES_CONFIG);
    const { h, userEdit } = host(s);
    await doAgentTool('place_points', { series: 1, points: [{ x: 200, y: 200 }] }, h);
    userEdit();
    const r = await doAgentTool('undo', {}, h);
    expect(r?.isError).toBe(true);
    expect(textOf(r)).toBe(USER_CHANGED);
    expect(s.getDatasets()[0]!.getCount()).toBe(1);
  });

  it('M11: a call that changes nothing records no step', async () => {
    const s = calibrate(CONTOUR_AXES_CONFIG);
    s.addFoundLines([line([[120, 200], [160, 200]])]);
    const { h, seen } = host(s);
    await doAgentTool('set_level', { series: 1, level: 3 }, h);
    await doAgentTool('set_level', { series: 1, level: 3 }, h);
    expect(seen.commits).toBe(1);
  });
});

describe('M13 / M10 / M8', () => {
  it('M13: a level the agent supplies is recorded exactly as a typed one', async () => {
    const s = calibrate(CONTOUR_AXES_CONFIG);
    s.addFoundLines([line([[120, 200], [160, 200]])]);
    const { h } = host(s);
    const r = await doAgentTool('set_level', { series: 1, level: 0.5 }, h);
    expect(textOf(r)).toMatch(/recorded as typed/);
    expect(s.getContourLevel(0)).toMatchObject({ value: 0.5, source: 'typed' });
  });

  it('M13: set_level on a type with no levels is refused', async () => {
    const s = calibrate(XY_AXES_CONFIG);
    const { h } = host(s);
    const r = await doAgentTool('set_level', { series: 1, level: 1 }, h);
    expect(textOf(r)).toMatch(/has no levels/);
  });

  it('M10: export hands the record back as data and says which Settings shaped it', async () => {
    const s = calibrate(XY_AXES_CONFIG);
    const { h } = host(s);
    const r = await doAgentTool('export', { format: 'csv' }, h);
    expect(r?.isError).toBeFalsy();
    expect(textOf(r)).toMatch(/Shaped by the user's choices in PlotTracer \(the Export menu and Settings\): rounded to the figure's own resolution, decimal point/);
    expect(textOf(r)).toContain('x,y\n1,2');
  });

  it('M10: export gives every series unless one is named, and says which it holds', async () => {
    const s = calibrate(XY_AXES_CONFIG);
    s.addDataset('Blend B');
    const { h, seen } = host(s);
    expect(textOf(await doAgentTool('export', { format: 'csv' }, h))).toMatch(/The record of every series \("Series 1", "Blend B"\)/);
    expect(seen.scope).toBe('all');
    expect(textOf(await doAgentTool('export', { format: 'csv', series: 'Series 1' }, h))).toMatch(/The record of series \[1\] "Series 1" alone/);
    expect(seen.scope).toBe('active');
    expect(s.getActiveDatasetIndex()).toBe(0);
  });

  it('M10: saving with may-save off is refused, and the data still comes back', async () => {
    const s = calibrate(XY_AXES_CONFIG);
    const { h } = host(s);
    const r = await doAgentTool('export', { format: 'csv', save_as: 'out.csv' }, h);
    expect(r?.isError).toBe(true);
    expect(textOf(r)).toMatch(/Saving is off in Settings/);
    expect(textOf(r)).toContain('x,y\n1,2');
  });

  it('M8: find_lines takes the colour from a pixel on a line when no colour is given', async () => {
    const s = calibrate(XY_AXES_CONFIG);
    const { h } = host(s);
    const r = await doAgentTool('find_lines', { at: { x: 200, y: 200 } }, h);
    expect(textOf(r)).toMatch(/found lines of #112233/);
  });
});
