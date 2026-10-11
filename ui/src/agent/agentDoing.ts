/**
 * What an agent may DO in PlotTracer (v2.7 phase 2, docs/v2.7-mcp-cases.md
 * M6-M13). Each tool goes through the same model a click goes through - the
 * session, and the Workspace's own handlers for the things only it holds (Find
 * lines, the mask, the export) - so an agent meets the same guards and refusals
 * a person does.
 *
 * ⚑ M9a: every tool that reads or changes points names its series. There is no
 * "active series" an agent could be on by accident; the series it acts on is
 * made the selected one on screen, so the person sees which line it works on.
 *
 * ⚑ M11: one call that changes the figure is ONE entry on the shared Undo
 * history, and a call that changes nothing records none.
 */
import type { CalibrationSession, CalibratedAxes } from '../../../engine/calibrationSession.js';
import { describeSeries, NOT_CALIBRATED, planView, SEEING_TOOLS, type AgentSeries, type AgentStateInput, type AgentTool, type ViewPlan } from './agentTools.js';

type Session = CalibrationSession<CalibratedAxes>;

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export const USER_CHANGED = 'The user has changed the figure since your last step; call get_state.';

/** Everything the window lends the agent's tools. Workspace implements it; the
 * tests implement it over a real session. */
export interface AgentDoingHost {
  getState: () => AgentStateInput;
  renderRegion: (plan: Extract<ViewPlan, { scale: number }> & { marks?: boolean }) => string | null;
  session: () => Session;
  /** Place a data point exactly as a click on the canvas would, in the active
   * series, without recording an undo entry (the step does that once). */
  placeLikeClick: (x: number, y: number) => void;
  /** Record the step just made as ONE undo entry, remembered as the agent's. */
  commitStep: (label: string) => void;
  /** The agent's own undo (M11). */
  undoAgentStep: () => { undone: string } | 'user-changed' | 'none';
  /** Show these points as the selection on screen, in this series. */
  showSelection: (series: number, points: readonly number[]) => void;
  /** M7: the screen says an agent is waiting for the calibration. */
  waitingForCalibration: () => void;
  /** Wait until the screen shows the latest change, so a picture is current. */
  afterRender: () => Promise<void>;
  findLines: (colour: string) => Promise<{ text: string; error?: boolean }>;
  /** The ink colour under a figure pixel, as Find lines' own pipette reads it. */
  inkAt: (x: number, y: number) => string | null;
  maskArea: (rect: { x: number; y: number; width: number; height: number }) => string | null;
  /** The export text; 'active' is the active series alone, 'all' every series. */
  exportText: (format: AgentExportFormat, scope: 'active' | 'all') => { content: string } | { error: string };
  /** Writes into the chosen folder, if saving is allowed (checked by the main process). */
  saveFile: (name: string, content: string) => Promise<{ path: string } | { error: string }>;
  settings: () => { decimalComma: boolean; fullPrecision: boolean };
}

export const AGENT_EXPORT_FORMATS = ['csv', 'tsv', 'json'] as const;
export type AgentExportFormat = (typeof AGENT_EXPORT_FORMATS)[number];

// ── the tools ────────────────────────────────────────────────────────────────

const SERIES_PROP = {
  description: 'The series to work on: its number from get_state (counted from 1, as on screen), or its exact name. Required - there is no current series.',
  oneOf: [{ type: 'integer', minimum: 1 }, { type: 'string' }],
};
const POINT_XY = {
  type: 'object',
  properties: { x: { type: 'number' }, y: { type: 'number' } },
  required: ['x', 'y'],
  additionalProperties: false,
};
const REGION = {
  type: 'object',
  description: 'A rectangle in figure pixels.',
  properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
  required: ['x', 'y', 'width', 'height'],
  additionalProperties: false,
};
const INDICES = { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Point numbers, as list_points gives them (counted from 1, as on screen).' };

export const DOING_TOOLS: readonly AgentTool[] = [
  {
    name: 'list_folder',
    description: 'The figures in the folder the user chose for agents in Settings (images, PDF, TIFF). Only these can be opened.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'open_figure',
    description: 'Open a figure from the folder the user chose for agents (a name from list_folder); for a PDF or a multi-page TIFF, the page to open (1 when left out). It replaces what is open, so it is refused while the user has unsaved work. The user then picks the graph type and calibrates it; until they have, the tools that change data are refused.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'A file name from list_folder.' }, page: { type: 'integer', minimum: 1 } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'add_series',
    description: 'Add a new, empty series, as + Add beside the series list does, and name it (as the user typing the name). One series per curve or data set in the figure.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
  },
  {
    name: 'rename_series',
    description: 'Rename a series, as the user typing in its name box. A name another series has is refused.',
    inputSchema: { type: 'object', properties: { series: SERIES_PROP, name: { type: 'string' } }, required: ['series', 'name'], additionalProperties: false },
  },
  {
    name: 'remove_series',
    description: 'Remove one or more whole series and their points, as Delete beside the series name does. One call is one step, so pass every series that goes together (for example the stray pieces Find lines found on another line). The ids after a removed series shift.',
    inputSchema: {
      type: 'object',
      properties: { series: { description: 'A series number or name, or a list of them.', oneOf: [SERIES_PROP.oneOf[0], SERIES_PROP.oneOf[1], { type: 'array', items: { oneOf: SERIES_PROP.oneOf }, minItems: 1 }] } },
      required: ['series'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_points',
    description: 'The points of one series: each point\'s number, its figure pixel (x right, y down from the top-left corner), its values on the calibrated axes, and what PlotTracer measured about it (bridged across a gap, shared by touching lines, interpolated). Point numbers change when points are added or removed; list again after a change.',
    inputSchema: { type: 'object', properties: { series: SERIES_PROP, from: { type: 'integer', minimum: 1 }, count: { type: 'integer', minimum: 1 } }, required: ['series'], additionalProperties: false },
  },
  {
    name: 'place_points',
    description: 'Place points in a series, each recorded exactly as the user clicking that figure pixel. One call is one step on the Undo history, so pass all the points that belong together. Returns the values each point got and a close-up picture with the new points ringed - look at it to check they sit on the line.',
    inputSchema: { type: 'object', properties: { series: SERIES_PROP, points: { type: 'array', items: POINT_XY, minItems: 1 } }, required: ['series', 'points'], additionalProperties: false },
  },
  {
    name: 'move_point',
    description: 'Move one point of a series to another figure pixel, as dragging it would. Returns its new values and a close-up picture.',
    inputSchema: { type: 'object', properties: { series: SERIES_PROP, point: { type: 'integer', minimum: 1 }, to: POINT_XY }, required: ['series', 'point', 'to'], additionalProperties: false },
  },
  {
    name: 'select_points',
    description: 'Select points of a series on screen, by number or by a rectangle, so the user sees which ones you mean. Changes no data.',
    inputSchema: { type: 'object', properties: { series: SERIES_PROP, points: INDICES, region: REGION }, required: ['series'], additionalProperties: false },
  },
  {
    name: 'delete_points',
    description: 'Delete points of a series, by number or every point of that series inside a rectangle. A found line with a stretch cut out of its middle becomes two lines, as on screen.',
    inputSchema: { type: 'object', properties: { series: SERIES_PROP, points: INDICES, region: REGION }, required: ['series'], additionalProperties: false },
  },
  {
    name: 'cut_line',
    description: 'Cut a line in two at one of its points (a closed line opens there). The second part becomes a new series.',
    inputSchema: { type: 'object', properties: { series: SERIES_PROP, point: { type: 'integer', minimum: 1 } }, required: ['series', 'point'], additionalProperties: false },
  },
  {
    name: 'join_lines',
    description: 'Join another line onto this one at their nearest ends; the gap between them is bridged and marked bridged. The other series is removed, so ids after it shift.',
    inputSchema: { type: 'object', properties: { series: SERIES_PROP, other: SERIES_PROP }, required: ['series', 'other'], additionalProperties: false },
  },
  {
    name: 'move_to_line',
    description: 'Move points of one line to another line, each slotted in where it sits along it.',
    inputSchema: { type: 'object', properties: { series: SERIES_PROP, points: INDICES, to: SERIES_PROP }, required: ['series', 'points', 'to'], additionalProperties: false },
  },
  {
    name: 'set_level',
    description: 'Contour plots only: set the level a contour line stands for, as the user typing it into the line\'s Level box. Pass null to clear it.',
    inputSchema: { type: 'object', properties: { series: SERIES_PROP, level: { type: ['number', 'null'] } }, required: ['series', 'level'], additionalProperties: false },
  },
  {
    name: 'use_label_read',
    description: 'Contour plots: take the level Find lines read off a line\'s printed label, as the Use button beside the line\'s Level does. It is recorded as read from the label (measured), not as typed. get_state shows which lines have a read on offer.',
    inputSchema: { type: 'object', properties: { series: { description: 'A series number or name, or a list of them.', oneOf: [SERIES_PROP.oneOf[0], SERIES_PROP.oneOf[1], { type: 'array', items: { oneOf: SERIES_PROP.oneOf }, minItems: 1 }] } }, required: ['series'], additionalProperties: false },
  },
  {
    name: 'find_lines',
    description: 'XY and contour plots: find every line of one colour inside the plot box, as Auto-extract ▸ Find lines does. Give the colour as #rrggbb, or a figure pixel ON a line to take the colour from. A second run replaces the lines the last one found (not ones the user worked on). Returns what the card says: lines found, gaps bridged, places to check.',
    inputSchema: {
      type: 'object',
      properties: { colour: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, at: POINT_XY },
      additionalProperties: false,
    },
  },
  {
    name: 'mask_area',
    description: 'Mark a rectangle as holding no data (a legend, a printed label), as Image ▸ Mask an area does: it is painted out and Find lines bridges a line across it.',
    inputSchema: { type: 'object', properties: { region: REGION }, required: ['region'], additionalProperties: false },
  },
  {
    name: 'export',
    description: 'The extracted data, handed back as text in the same shape PlotTracer writes to a file (csv, tsv or json), shaped by the user\'s choices (decimal comma, full precision). Every series unless you name one. With save_as, it is also written into the folder chosen in Settings, if the user lets agents save.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { enum: [...AGENT_EXPORT_FORMATS] },
        series: { description: 'One series to export (its number or name); every series when left out.', oneOf: SERIES_PROP.oneOf },
        save_as: { type: 'string', description: 'A file name inside the chosen folder.' },
      },
      required: ['format'],
      additionalProperties: false,
    },
  },
  {
    name: 'undo',
    description: 'Take back your own latest step. Refused if the user has changed the figure since, so you never undo their work.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

/** Every tool an agent can find, in the order tools/list gives them. */
export const AGENT_TOOLS: readonly AgentTool[] = [...SEEING_TOOLS, ...DOING_TOOLS];

/** The tools that add or change data, refused before the figure is calibrated (M7). */
export const NEEDS_CALIBRATION: ReadonlySet<string> = new Set([
  'add_series', 'rename_series', 'remove_series', 'place_points', 'move_point', 'select_points', 'delete_points', 'cut_line', 'join_lines', 'move_to_line',
  'set_level', 'use_label_read', 'find_lines', 'mask_area', 'export',
]);

// ── M9a: which series ────────────────────────────────────────────────────────

export function seriesList(series: readonly AgentSeries[]): string {
  if (!series.length) return 'There are no series.';
  return `The series are:\n${series.map((s) => `  ${describeSeries(s)}`).join('\n')}`;
}

export function resolveSeries(arg: unknown, series: readonly AgentSeries[], what = 'series'): { index: number } | { error: string } {
  if (arg === undefined || arg === null || arg === '') {
    return { error: `Name the ${what}: pass its number from get_state. ${seriesList(series)}` };
  }
  if (typeof arg === 'number') {
    // the agent counts from 1, as the screen does
    if (Number.isInteger(arg) && series.some((s) => s.index === arg - 1)) return { index: arg - 1 };
    return { error: `There is no series ${arg}. ${seriesList(series)}` };
  }
  if (typeof arg === 'string') {
    const want = arg.trim();
    const hits = series.filter((s) => s.name.trim() === want);
    if (hits.length === 1) return { index: hits[0]!.index };
    if (hits.length > 1) {
      return { error: `${hits.length} series are called "${want}", so the name does not say which. Pass its number. ${seriesList(series)}` };
    }
    return { error: `No series is called "${want}". ${seriesList(series)}` };
  }
  return { error: `${what} has to be a series number or a series name. ${seriesList(series)}` };
}

// ── helpers ──────────────────────────────────────────────────────────────────

const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] });
const refuse = (t: string): ToolResult => ({ isError: true, content: [{ type: 'text', text: t }] });

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function readXY(v: unknown): { x: number; y: number } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const x = num(o.x), y = num(o.y);
  return x === undefined || y === undefined ? null : { x, y };
}

function readRegion(v: unknown): { x: number; y: number; width: number; height: number } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const [x, y, width, height] = [num(o.x), num(o.y), num(o.width), num(o.height)];
  if (x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/** Point numbers as the agent gives them (from 1, as on screen) → indices. */
function readIndices(v: unknown): number[] | null {
  if (!Array.isArray(v) || !v.every((i) => typeof i === 'number' && Number.isInteger(i) && i >= 1)) return null;
  return [...new Set((v as number[]).map((i) => i - 1))];
}

/** One point number (from 1) → its index, or undefined. */
function readPoint(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v - 1 : undefined;
}

/** How the agent sees a series and a point: counted from 1, as on screen. */
const sid = (index: number) => `[${index + 1}]`;
const pno = (index: number) => index + 1;

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toPrecision(6)));

function valuesText(data: readonly (number | undefined)[] | null): string {
  if (!data) return 'no values';
  return `(${data.map((d) => (d === undefined || !Number.isFinite(d) ? '?' : fmt(d))).join(', ')})`;
}

interface PointView { x: number; y: number; data: (number | undefined)[] | null; role: string | null }

function pointsOf(session: Session, index: number): PointView[] {
  const ds = session.getDatasets()[index];
  if (!ds) return [];
  const axes = session.getAxes();
  const roles = session.getDataPointRolesFor(index);
  return ds.getAllPixels().map((p, k) => {
    const r = p.metadata?.['role'];
    const lineRole = r === 'bridged' || r === 'shared' ? r : null;
    return {
      x: p.x,
      y: p.y,
      data: axes ? (axes.pixelToData(p.x, p.y) as (number | undefined)[]) : null,
      role: lineRole ?? roles[k] ?? null,
    };
  });
}

function seriesNow(host: AgentDoingHost, index: number): AgentSeries | undefined {
  return host.getState().series.find((s) => s.index === index);
}

function named(host: AgentDoingHost, index: number): string {
  const s = seriesNow(host, index);
  return s ? `series ${sid(s.index)} "${s.name}" (now ${s.pointCount} ${s.pointCount === 1 ? 'point' : 'points'})` : `series ${sid(index)}`;
}

/** A close-up around these figure pixels, at a zoom that makes a point's
 * placement checkable (M9). */
export function closeUpPlan(points: readonly { x: number; y: number }[], imageWidth: number, imageHeight: number) {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const margin = 30;
  let x0 = Math.min(...xs) - margin, x1 = Math.max(...xs) + margin;
  let y0 = Math.min(...ys) - margin, y1 = Math.max(...ys) + margin;
  const minSide = 80;
  if (x1 - x0 < minSide) { const c = (x0 + x1) / 2; x0 = c - minSide / 2; x1 = c + minSide / 2; }
  if (y1 - y0 < minSide) { const c = (y0 + y1) / 2; y0 = c - minSide / 2; y1 = c + minSide / 2; }
  const side = Math.max(x1 - x0, y1 - y0);
  const zoom = Math.max(1, Math.min(4, 640 / side));
  return planView({ imageWidth, imageHeight, region: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, zoom });
}

async function withCloseUp(host: AgentDoingHost, words: string, points: readonly { x: number; y: number }[]): Promise<ToolResult> {
  const fig = host.getState().figure;
  if (!fig || !points.length) return text(words);
  await host.afterRender();
  const plan = closeUpPlan(points, fig.width, fig.height);
  if ('error' in plan) return text(words);
  const url = host.renderRegion(plan);
  if (!url) return text(words);
  return {
    content: [
      { type: 'text', text: words },
      { type: 'image', data: url.slice(url.indexOf(',') + 1), mimeType: 'image/png' },
      { type: 'text', text: `Close-up: figure pixels x ${plan.x} to ${plan.x + plan.width}, y ${plan.y} to ${plan.y + plan.height}, at zoom ${+plan.scale.toFixed(3)}. The points this step touched are ringed as selected.` },
    ],
  };
}

function inFigure(host: AgentDoingHost, p: { x: number; y: number }): boolean {
  const fig = host.getState().figure;
  return !!fig && p.x >= 0 && p.y >= 0 && p.x <= fig.width && p.y <= fig.height;
}

/** After a step that adds or removes series, ids may have shifted: say so with
 * the whole list, so the agent never acts on a stale id. */
function idsChanged(host: AgentDoingHost, before: number): string {
  const after = host.getState().series;
  return after.length === before ? '' : `\nThe series ids have changed. ${seriesList(after)}`;
}

// ── the dispatcher ───────────────────────────────────────────────────────────

/** Answer one of the doing tools, or null when `name` is not one of them. */
export async function doAgentTool(name: string, rawArgs: unknown, host: AgentDoingHost): Promise<ToolResult | null> {
  if (!DOING_TOOLS.some((t) => t.name === name)) return null;
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
  const state = host.getState();
  if (name === 'undo') {
    const r = host.undoAgentStep();
    if (r === 'user-changed') return refuse(USER_CHANGED);
    if (r === 'none') return refuse('You have no step left to undo.');
    return text(`Undid your last step: ${r.undone}.`);
  }
  if (!state.figure) return refuse('No figure is open in PlotTracer. Ask the user to open one.');
  if (NEEDS_CALIBRATION.has(name) && !state.calibrated) {
    host.waitingForCalibration();
    return refuse(NOT_CALIBRATED);
  }
  const session = host.session();
  const which = (key = 'series', what = 'series') => resolveSeries(args[key], state.series, what);

  switch (name) {
    case 'add_series': {
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      if (!name) return refuse('name has to be the series\' name.');
      const before = session.getActiveDatasetIndex();
      const index = session.addDataset();
      const refusal = session.renameDataset(index, name);
      if (refusal) {
        session.removeDataset(index);
        session.setActiveDataset(before);
        return refuse(`${refusal} ${seriesList(host.getState().series)}`);
      }
      host.commitStep(`Added series "${name}"`);
      return text(`Added ${named(host, index)}. It is the selected series on screen. ${seriesList(host.getState().series)}`);
    }

    case 'rename_series': {
      const s = which();
      if ('error' in s) return refuse(s.error);
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      if (!name) return refuse('name has to be the new name.');
      const old = seriesNow(host, s.index)!.name;
      if (old.trim() === name) return text(`${named(host, s.index)} already has that name.`);
      const refusal = session.renameDataset(s.index, name);
      if (refusal) return refuse(refusal);
      session.setActiveDataset(s.index);
      host.commitStep(`Renamed "${old}" to "${name}"`);
      return text(`Renamed "${old}" to ${named(host, s.index)}.`);
    }

    case 'remove_series': {
      const asked = Array.isArray(args.series) ? args.series : [args.series];
      const picked: number[] = [];
      for (const one of asked) {
        const r = resolveSeries(one, state.series);
        if ('error' in r) return refuse(`${r.error}\nNothing was removed.`);
        if (!picked.includes(r.index)) picked.push(r.index);
      }
      const names = picked.map((i) => `"${seriesNow(host, i)!.name}"`);
      const keep = session.getDatasets()[session.getActiveDatasetIndex()];
      // highest first, so the indices still to remove stay where they are
      for (const i of [...picked].sort((x, y) => y - x)) session.removeDataset(i);
      const ai = keep ? session.getDatasets().indexOf(keep) : -1;
      host.showSelection(ai >= 0 ? ai : session.getActiveDatasetIndex(), []);
      host.commitStep(`Removed ${names.join(', ')}`);
      return text(`Removed ${names.join(', ')}.\nThe series ids have changed. ${seriesList(host.getState().series)}`);
    }

    case 'list_points': {
      const s = which();
      if ('error' in s) return refuse(s.error);
      const pts = pointsOf(session, s.index);
      const from = (readPoint(args.from) ?? 0);
      const count = num(args.count) ?? 200;
      const shown = pts.slice(from, from + count);
      const lines = shown.map((p, k) => `  ${pno(from + k)}: pixel (${fmt(p.x)}, ${fmt(p.y)}) → ${valuesText(p.data)}${p.role ? `, ${p.role}` : ''}`);
      const more = from + shown.length < pts.length ? `\n(${pts.length - from - shown.length} more; pass from: ${pno(from + shown.length)} to see them.)` : '';
      return text(`${describeSeries(seriesNow(host, s.index)!)}\n${lines.join('\n') || '  (no points)'}${more}`);
    }

    case 'place_points': {
      const s = which();
      if ('error' in s) return refuse(s.error);
      if (!Array.isArray(args.points) || !args.points.length) return refuse('points has to be a list of {x, y} figure pixels, at least one.');
      const pts = args.points.map(readXY);
      const bad = pts.findIndex((p) => !p || !inFigure(host, p));
      if (bad >= 0) {
        const fig = state.figure;
        return refuse(`Point ${bad} is not a figure pixel: each point needs x and y as numbers inside the figure, which is ${fig.width} × ${fig.height}. Nothing was placed.`);
      }
      session.setActiveDataset(s.index);
      const before = session.getDatasets()[s.index]!.getCount();
      for (const p of pts as { x: number; y: number }[]) host.placeLikeClick(p.x, p.y);
      const after = session.getDatasets()[s.index]!.getCount();
      if (after === before) {
        return refuse(`PlotTracer did not take these points. The screen says: "${state.tip ?? ''}". Call get_state.`);
      }
      // the new points, found by their pixels (a point placed into a line is
      // slotted where it belongs, so it is not always last)
      const all = pointsOf(session, s.index);
      const placedAt: number[] = [];
      for (const p of pts as { x: number; y: number }[]) {
        const k = all.findIndex((q, i) => !placedAt.includes(i) && q.x === p.x && q.y === p.y);
        if (k >= 0) placedAt.push(k);
      }
      host.commitStep(`Placed ${after - before} ${after - before === 1 ? 'point' : 'points'} in "${seriesNow(host, s.index)?.name ?? ''}"`);
      host.showSelection(s.index, placedAt);
      const took = after - before;
      const rows = placedAt.map((k) => `  ${pno(k)}: pixel (${fmt(all[k]!.x)}, ${fmt(all[k]!.y)}) → ${valuesText(all[k]!.data)}`);
      const shifted = placedAt.length < took ? `\n${took - placedAt.length} point(s) were moved onto the axis they belong to, as a click would be; list_points shows where.` : '';
      return withCloseUp(
        host,
        `Placed ${took} ${took === 1 ? 'point' : 'points'} in ${named(host, s.index)}, recorded as clicks:\n${rows.join('\n')}${shifted}`,
        placedAt.map((k) => all[k]!)
      );
    }

    case 'move_point': {
      const s = which();
      if ('error' in s) return refuse(s.error);
      const k = readPoint(args.point);
      const to = readXY(args.to);
      const pts = pointsOf(session, s.index);
      if (k === undefined || k >= pts.length) return refuse(`${describeSeries(seriesNow(host, s.index)!)} has no point ${String(args.point)}; its points are numbered 1 to ${pts.length}.`);
      if (!to || !inFigure(host, to)) return refuse('to has to be a figure pixel {x, y} inside the figure.');
      session.setActiveDataset(s.index);
      const was = pts[k]!;
      session.updateDataPointPixel(k, to.x, to.y);
      const now = pointsOf(session, s.index)[k]!;
      if (now.x === was.x && now.y === was.y) {
        return refuse(was.role === 'interpolated'
          ? `Point ${pno(k)} is interpolated between guide points, so it cannot be moved; move a guide point instead.`
          : `Point ${pno(k)} did not move.`);
      }
      host.commitStep(`Moved point ${pno(k)} of "${seriesNow(host, s.index)?.name ?? ''}"`);
      host.showSelection(s.index, [k]);
      const snapped = now.x !== to.x || now.y !== to.y ? ` It was kept on the axis it belongs to, as a drag would be, at pixel (${fmt(now.x)}, ${fmt(now.y)}).` : '';
      return withCloseUp(host, `Moved point ${pno(k)} of ${named(host, s.index)} from (${fmt(was.x)}, ${fmt(was.y)}) to (${fmt(now.x)}, ${fmt(now.y)}) → ${valuesText(now.data)}.${snapped}`, [now]);
    }

    case 'select_points': {
      const s = which();
      if ('error' in s) return refuse(s.error);
      const pts = pointsOf(session, s.index);
      const picked = pickPoints(args, pts);
      if ('error' in picked) return refuse(picked.error);
      host.showSelection(s.index, picked.indices);
      return text(`Selected ${picked.indices.length} of the ${pts.length} points of ${named(host, s.index)} on screen: ${summariseIndices(picked.indices.map(pno))}.`);
    }

    case 'delete_points': {
      const s = which();
      if ('error' in s) return refuse(s.error);
      const pts = pointsOf(session, s.index);
      const picked = pickPoints(args, pts);
      if ('error' in picked) return refuse(picked.error);
      if (!picked.indices.length) return refuse(`No point of ${named(host, s.index)} is there, so nothing was deleted.`);
      const seriesBefore = state.series.length;
      const name0 = named(host, s.index);
      session.setActiveDataset(s.index);
      if (session.getLinePoints(s.index)) session.removeLinePoints(picked.indices.map((point) => ({ index: s.index, point })));
      else session.removeDataPoints(picked.indices);
      host.commitStep(`Deleted ${picked.indices.length} ${picked.indices.length === 1 ? 'point' : 'points'} from "${state.series.find((x) => x.index === s.index)?.name ?? ''}"`);
      return text(`Deleted ${picked.indices.length} ${picked.indices.length === 1 ? 'point' : 'points'} from ${name0.replace(/ \(now .*\)$/, '')}.${idsChanged(host, seriesBefore)}`);
    }

    case 'cut_line': {
      const s = which();
      if ('error' in s) return refuse(s.error);
      const k = readPoint(args.point);
      const n = session.getLinePoints(s.index)?.length ?? 0;
      if (k === undefined || k >= n) return refuse(`${describeSeries(seriesNow(host, s.index)!)} has no point ${String(args.point)} to cut at.`);
      const seriesBefore = state.series.length;
      const refusal = session.cutLineAt(s.index, k);
      if (refusal) return refuse(refusal);
      session.setActiveDataset(s.index);
      host.commitStep(`Cut "${seriesNow(host, s.index)?.name ?? ''}" at point ${pno(k)}`);
      return text(`Cut ${named(host, s.index)} at point ${pno(k)}.${idsChanged(host, seriesBefore)}`);
    }

    case 'join_lines': {
      const s = which();
      if ('error' in s) return refuse(s.error);
      const o = which('other', 'other line');
      if ('error' in o) return refuse(o.error);
      const keepName = seriesNow(host, s.index)!.name;
      const otherName = seriesNow(host, o.index)!.name;
      const refusal = session.joinLines(s.index, o.index);
      if (refusal) return refuse(refusal);
      host.commitStep(`Joined "${otherName}" onto "${keepName}"`);
      return text(`Joined "${otherName}" onto "${keepName}"; the gap between them is marked bridged.\nThe series ids have changed. ${seriesList(host.getState().series)}`);
    }

    case 'move_to_line': {
      const s = which();
      if ('error' in s) return refuse(s.error);
      const t = which('to', 'line to move to');
      if ('error' in t) return refuse(t.error);
      const idx = readIndices(args.points);
      if (!idx || !idx.length) return refuse('points has to be a list of point numbers from list_points.');
      const moved = session.movePointsToLine(s.index, idx, t.index);
      if (!moved) return refuse('Nothing moved: both have to be lines (not guide-point curves or slotted series), different ones, and the points have to exist.');
      session.setActiveDataset(t.index);
      host.commitStep(`Moved ${moved} ${moved === 1 ? 'point' : 'points'} from "${seriesNow(host, s.index)?.name ?? ''}" to "${seriesNow(host, t.index)?.name ?? ''}"`);
      return text(`Moved ${moved} ${moved === 1 ? 'point' : 'points'} from ${named(host, s.index)} to ${named(host, t.index)}.`);
    }

    case 'set_level': {
      const s = which();
      if ('error' in s) return refuse(s.error);
      if (session.getConfig().id !== 'contour') return refuse(`A ${state.graphType} figure has no levels; set_level is for contour plots.`);
      const level = args.level === null ? null : num(args.level);
      if (level === undefined) return refuse('level has to be a number, or null to clear it.');
      const before = session.getContourLevel(s.index);
      const refusal = session.setContourLevel(s.index, level, 'typed');
      if (refusal) return refuse(refusal);
      const after = session.getContourLevel(s.index);
      if (before?.value === after?.value && before?.source === after?.source) return text(`${named(host, s.index)} already has that level.`);
      session.setActiveDataset(s.index);
      host.commitStep(level === null ? `Cleared the level of "${seriesNow(host, s.index)?.name ?? ''}"` : `Set the level of "${seriesNow(host, s.index)?.name ?? ''}" to ${fmt(level)}`);
      return text(level === null ? `Cleared the level of ${named(host, s.index)}.` : `Set the level of ${named(host, s.index)} to ${fmt(level)}, recorded as typed.`);
    }

    case 'use_label_read': {
      if (session.getConfig().id !== 'contour') return refuse(`A ${state.graphType} figure has no levels; use_label_read is for contour plots.`);
      const asked = Array.isArray(args.series) ? args.series : [args.series];
      const picked: number[] = [];
      for (const one of asked) {
        const r = resolveSeries(one, state.series);
        if ('error' in r) return refuse(`${r.error}\nNo level was taken.`);
        const lr = session.getLabelRead(r.index);
        if (!lr || lr.value === null) {
          return refuse(`${describeSeries(seriesNow(host, r.index)!)} has no label read on offer${lr?.refused ? ` (${lr.refused})` : ''}; set_level types a level instead. No level was taken.`);
        }
        if (!picked.includes(r.index)) picked.push(r.index);
      }
      const changed = picked.filter((i) => {
        const lv = session.getContourLevel(i);
        return !(lv && lv.source === 'label' && lv.value === session.getLabelRead(i)!.value);
      });
      if (!changed.length) return text('Those lines already have their label reads as levels.');
      for (const i of changed) session.setContourLevel(i, session.getLabelRead(i)!.value, 'label');
      session.setActiveDataset(changed[changed.length - 1]!);
      host.commitStep(`Took the label levels of ${changed.map((i) => `"${seriesNow(host, i)?.name ?? ''}"`).join(', ')}`);
      return text(`Took the label read as the level of ${changed.map((i) => `${sid(i)} "${seriesNow(host, i)!.name}" = ${fmt(session.getContourLevel(i)!.value)}`).join(', ')}, recorded as read from the label.`);
    }

    case 'find_lines': {
      let colour = typeof args.colour === 'string' ? args.colour : null;
      if (colour !== null && !/^#[0-9a-fA-F]{6}$/.test(colour)) return refuse('colour has to be #rrggbb.');
      const at = args.at !== undefined ? readXY(args.at) : null;
      if (args.at !== undefined && (!at || !inFigure(host, at))) return refuse('at has to be a figure pixel {x, y} inside the figure.');
      if (colour === null && at) colour = host.inkAt(at.x, at.y);
      if (colour === null) return refuse('Give the lines\' colour as #rrggbb, or at: a figure pixel on a line to take it from.');
      const r = await host.findLines(colour.toLowerCase());
      return r.error ? refuse(r.text) : text(`${r.text}\nColour ${colour.toLowerCase()}. ${seriesList(host.getState().series)}`);
    }

    case 'mask_area': {
      const r = readRegion(args.region);
      if (!r) return refuse('region needs x, y, width and height in figure pixels, with width and height above 0.');
      const refusal = host.maskArea(r);
      if (refusal) return refuse(refusal);
      return text(`Masked x ${fmt(r.x)} to ${fmt(r.x + r.width)}, y ${fmt(r.y)} to ${fmt(r.y + r.height)}: painted out, and Find lines will bridge a line across it.`);
    }

    case 'export': {
      const format = args.format;
      if (typeof format !== 'string' || !(AGENT_EXPORT_FORMATS as readonly string[]).includes(format)) {
        return refuse(`format has to be one of ${AGENT_EXPORT_FORMATS.join(', ')}.`);
      }
      let scope: 'active' | 'all' = 'all';
      let which1 = `every series (${state.series.map((x) => `"${x.name}"`).join(', ')})`;
      if (args.series !== undefined) {
        const r = resolveSeries(args.series, state.series);
        if ('error' in r) return refuse(r.error);
        session.setActiveDataset(r.index);
        host.showSelection(r.index, []);
        scope = 'active';
        which1 = `series ${sid(r.index)} "${seriesNow(host, r.index)!.name}" alone`;
      }
      const out = host.exportText(format as AgentExportFormat, scope);
      if ('error' in out) return refuse(out.error);
      const st = host.settings();
      const shaped = `The record of ${which1}. Shaped by the user's choices in PlotTracer (the Export menu and Settings): ${st.fullPrecision ? 'full precision' : 'rounded to the figure\'s own resolution'}${format === 'json' ? '' : st.decimalComma ? ', decimal comma' : ', decimal point'}.`;
      let saved = '';
      if (args.save_as !== undefined) {
        if (typeof args.save_as !== 'string' || !args.save_as.trim()) return refuse('save_as has to be a file name.');
        const r = await host.saveFile(args.save_as, out.content);
        if ('error' in r) return { content: [{ type: 'text', text: `${r.error} The data is below.\n${shaped}` }, { type: 'text', text: out.content }], isError: true };
        saved = ` Saved to ${r.path}.`;
      }
      return { content: [{ type: 'text', text: `${shaped}${saved}` }, { type: 'text', text: out.content }] };
    }
  }
  return null;
}

function pickPoints(args: Record<string, unknown>, pts: readonly PointView[]): { indices: number[] } | { error: string } {
  if (args.points !== undefined && args.region !== undefined) return { error: 'Give points or region, not both.' };
  if (args.points !== undefined) {
    const idx = readIndices(args.points);
    if (!idx) return { error: 'points has to be a list of point numbers from list_points.' };
    const missing = idx.filter((i) => i >= pts.length);
    if (missing.length) return { error: `There is no point ${missing.map(pno).join(', ')}; this series' points are numbered 1 to ${pts.length}.` };
    return { indices: idx.sort((a, b) => a - b) };
  }
  if (args.region !== undefined) {
    const r = readRegion(args.region);
    if (!r) return { error: 'region needs x, y, width and height in figure pixels, with width and height above 0.' };
    const indices: number[] = [];
    pts.forEach((p, k) => {
      if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) indices.push(k);
    });
    return { indices };
  }
  return { error: 'Give points (numbers from list_points) or region (a rectangle in figure pixels).' };
}

function summariseIndices(idx: readonly number[]): string {
  if (!idx.length) return 'none';
  const runs: string[] = [];
  let a = idx[0]!, b = a;
  for (const i of idx.slice(1)) {
    if (i === b + 1) b = i;
    else { runs.push(a === b ? `${a}` : `${a}-${b}`); a = b = i; }
  }
  runs.push(a === b ? `${a}` : `${a}-${b}`);
  return runs.join(', ');
}

// ── M11: the agent's own undo ────────────────────────────────────────────────

/**
 * The agent's steps, by the history snapshot each one committed. Its undo may
 * take back its latest step only while that snapshot is still the history's
 * present: anything the user did since moved the present on, and then the
 * agent is told so rather than undoing the user's work.
 */
export class AgentStepLog<T> {
  private steps: { snapshot: T; label: string }[] = [];

  record(snapshot: T, label: string): void {
    this.steps.push({ snapshot, label });
  }

  /** What the agent's undo may do, given the history's present. */
  check(present: T): { label: string } | 'user-changed' | 'none' {
    const top = this.steps[this.steps.length - 1];
    if (!top) return 'none';
    return top.snapshot === present ? { label: top.label } : 'user-changed';
  }

  /** The latest step was undone. */
  pop(): void {
    this.steps.pop();
  }

  clear(): void {
    this.steps = [];
  }

  size(): number {
    return this.steps.length;
  }
}
