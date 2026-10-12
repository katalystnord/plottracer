/**
 * What an agent is told (v2.7, docs/v2.7-mcp-cases.md). The window gathers the
 * facts (useAgentBridge); the pure functions here decide the words and the
 * picture, so they can be tested without one.
 *
 * ⚑ The agent is Parallel Universe David's machine cousin: it can use only what
 * a tool description or a tool result tells it. So the descriptions say what
 * the agent may NOT do as plainly as what it may, and every result names the
 * series it is about (M9a).
 */

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
}

/** The tools that only LOOK (M4, M5). The doing tools are in agentDoing.ts. */
export const SEEING_TOOLS: readonly AgentTool[] = [
  {
    name: 'get_state',
    description:
      'Where the work in PlotTracer stands: the open figure, its graph type, whether the user has calibrated it (and if not, which calibration step is on screen), the prompt shown to the user, every series with its id, name, colour, point count and level, and the places to check. Call this first, and again whenever a tool tells you the figure has changed.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'view_figure',
    description:
      'A picture of the figure as PlotTracer shows it, with its marks (calibration, points, lines, places to check). Without a region it shows the whole figure; with a region (in the figure\'s own pixels, x to the right and y downward from the top-left corner) it shows just that part, at the zoom you ask for. Looking never moves the user\'s view.',
    inputSchema: {
      type: 'object',
      properties: {
        region: {
          type: 'object',
          description: 'The part of the figure to show, in figure pixels.',
          properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
          required: ['x', 'y', 'width', 'height'],
        },
        zoom: { type: 'number', description: 'Picture pixels per figure pixel, e.g. 4 to see a small region closely. Reduced if the picture would be too large. The marks are magnified with the figure, so at a high zoom they cover the ink; pass marks: false to see the figure alone.' },
        marks: { type: 'boolean', description: 'false shows the figure without PlotTracer\'s marks, as the eye button in the top bar does. Shown when left out.' },
      },
      additionalProperties: false,
    },
  },
];

// ── get_state ────────────────────────────────────────────────────────────────

export interface AgentSeries {
  /** Position in the series list, from 0. The agent sees and names it from 1,
   * the way the screen counts ("Series 1"), so the two never disagree. */
  index: number;
  name: string;
  colour: [number, number, number];
  pointCount: number;
  level: { value: number; source: string } | null;
  selected: boolean;
  /** What the series holds when its record is not points (bars, bins, a
   * heatmap's cells) - said in place of the point count. */
  record?: string | null;
  /** What Find lines read off the line's printed label, offered beside its Level. */
  labelRead?: { text: string; value: number | null; refused: string | null } | null;
}

export interface AgentStateInput {
  figure: { fileName: string | null; width: number; height: number; page?: { page: number; count: number } } | null;
  graphType: string;
  calibrated: boolean;
  /** The calibration walk's current step, while it is not done. */
  step: { index: number; count: number; label: string } | null;
  /** The sentence in the bottom tips bar - the same words the user reads. */
  tip: string | null;
  series: readonly AgentSeries[];
  places: readonly { kind: string; at: readonly [number, number]; text: string }[];
  /** M14 (R9): how the agent is working - in rounds or automatic, and whether it waits. */
  working?: string | null;
  /** The calibration points the user has placed, in walk order, with what they
   * typed for each - so an agent can catch a typo such as 1.2 for 12. */
  calibration?: readonly AgentCalibPoint[];
}

export interface AgentCalibPoint {
  label: string;
  px: number;
  py: number;
  values: readonly { label: string; value: string }[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;
function describeCalibPoints(points: readonly AgentCalibPoint[]): string {
  return points
    .map((p) => `${p.label} at pixel (${r1(p.px)}, ${r1(p.py)})${p.values.map((v) => `, ${v.label} = ${v.value}`).join('')}`)
    .join('; ');
}

export const NOT_CALIBRATED =
  'This figure is not calibrated yet. Ask the user to pick its graph type and calibrate it in PlotTracer, then call get_state.';

const hex = ([r, g, b]: readonly [number, number, number]) =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

export function describeSeries(s: AgentSeries): string {
  const level = s.level ? `level ${s.level.value} (${s.level.source})` : 'no level';
  const lr = s.labelRead;
  const offered = !lr
    ? ''
    : lr.value !== null && !(s.level?.source === 'label' && s.level.value === lr.value)
      ? `, its label reads "${lr.text}" = ${lr.value} (offered; use_label_read takes it)`
      : lr.value === null
        ? `, its label ${lr.text ? `read as "${lr.text}"` : 'could not be read'} was not used${lr.refused ? ` - ${lr.refused}` : ''}`
        : '';
  const holds = s.record ?? `${s.pointCount} ${s.pointCount === 1 ? 'point' : 'points'}`;
  return `[${s.index + 1}] "${s.name}" - ${holds}, ${level}${offered}, colour ${hex(s.colour)}${s.selected ? ', selected on screen' : ''}`;
}

export function describeState(st: AgentStateInput): string {
  if (!st.figure) {
    return 'No figure is open in PlotTracer. Open one with open_figure (list_folder shows what you may open), or ask the user to open one.';
  }
  const lines: string[] = [];
  const page = st.figure.page ? `, page ${st.figure.page.page} of ${st.figure.page.count}` : '';
  lines.push(`Figure: ${st.figure.fileName ?? 'unnamed'}${page}, ${st.figure.width} × ${st.figure.height} pixels.`);
  lines.push(`Graph type: ${st.graphType}.`);
  const placed = st.calibration ?? [];
  if (st.calibrated) {
    lines.push(`Calibration: done (by the user).${placed.length ? ` The points they placed: ${describeCalibPoints(placed)}.` : ''}`);
  } else {
    const step = st.step ? ` The walk is on step ${st.step.index + 1} of ${st.step.count}: "${st.step.label}".` : '';
    const sofar = placed.length ? ` Placed so far: ${describeCalibPoints(placed)}.` : '';
    lines.push(`Calibration: not done.${step}${sofar} ${NOT_CALIBRATED}`);
  }
  if (st.working) lines.push(st.working);
  if (st.tip) lines.push(`On screen now: "${st.tip}"`);
  lines.push(`Series (${st.series.length}):`);
  for (const s of st.series) lines.push(`  ${describeSeries(s)}`);
  if (st.places.length) {
    lines.push(`Places to check (${st.places.length}):`);
    for (const p of st.places) lines.push(`  - ${p.kind} at (${Math.round(p.at[0])}, ${Math.round(p.at[1])}): ${p.text}`);
  }
  return lines.join('\n');
}

// ── view_figure ──────────────────────────────────────────────────────────────

/** The longest side a picture may have - what a vision model takes in without
 * shrinking it again, so a zoom the agent asked for is the zoom it sees. */
export const MAX_PICTURE_SIDE = 1568;

export type ViewPlan =
  | { x: number; y: number; width: number; height: number; scale: number; outWidth: number; outHeight: number; note?: string }
  | { error: string };

export function planView(opts: {
  imageWidth: number;
  imageHeight: number;
  region?: { x: number; y: number; width: number; height: number };
  zoom?: number;
}): ViewPlan {
  const { imageWidth: W, imageHeight: H } = opts;
  const r = opts.region ?? { x: 0, y: 0, width: W, height: H };
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(W, Math.ceil(r.x + r.width));
  const y1 = Math.min(H, Math.ceil(r.y + r.height));
  if (!(x1 > x0 && y1 > y0)) {
    return { error: `That region is outside the figure, which is ${W} × ${H} pixels.` };
  }
  const width = x1 - x0;
  const height = y1 - y0;
  const fit = MAX_PICTURE_SIDE / Math.max(width, height);
  const asked = opts.zoom !== undefined && Number.isFinite(opts.zoom) && opts.zoom > 0 ? opts.zoom : Math.min(1, fit);
  const scale = Math.min(asked, fit);
  const note =
    opts.zoom !== undefined && scale < opts.zoom
      ? `The zoom was reduced from ${opts.zoom} to ${+scale.toFixed(2)} to keep the picture within ${MAX_PICTURE_SIDE} pixels; ask for a smaller region to see it closer.`
      : undefined;
  return {
    x: x0,
    y: y0,
    width,
    height,
    scale,
    outWidth: Math.round(width * scale),
    outHeight: Math.round(height * scale),
    ...(note ? { note } : {}),
  };
}
