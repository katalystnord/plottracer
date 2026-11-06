import type { AxesTypeConfig, CalibratedAxes } from './axesTypeConfigs.js';
import type { LegendEntry } from './legendRead.js';
import { DETECTED_BAR_SCORE } from '../algorithms/detectedBars.js';
import { paperColour } from '../algorithms/lineStyle.js';
import { findLinesKind, autoExtractModesFor } from './toolMode.js';

/**
 * [Auto-extract all series] on the Data extraction card (v2.7; David 2026-10-31: "Reads every series the legend
 * names, each with the tool that suits it"). It is no tool of its own: each series the legend names is read by one
 * of the card's existing tools, on the colour beside its name, into a series of that name. This module decides, per
 * legend entry, which tool and which series; the Workspace runs the tools.
 *
 * Brought back from the retired Series extraction card (9a4d107, 8a864e3), which made the same choices row by row.
 */

type RGB = [number, number, number];

/** Find lines; Colour trace's Scattered points; Colour trace as the type reads its shapes (bars, a spider's polygon,
 * a curve where Find lines does not read). */
export type AutoExtractTool = 'lines' | 'points' | 'shapes';

export type AutoExtractStep =
  | {
      entry: number;
      name: string;
      colour: RGB;
      tool: AutoExtractTool;
      /** The series it is read into: an existing one by its index (emptied first), or a new one. */
      into: number | 'new';
      /** Other entries in the same ink, read by this step and told apart by their line style or marker (v2.7). */
      shares?: number[];
    }
  /** An entry read by another entry's step, which shares its ink (`shares`). */
  | { entry: number; name: string; readWith: number }
  | { entry: number; name: string; skip: string };

/** The tools Auto-extract can use on a graph type; none means the button is greyed in its place. */
export function autoExtractTools(config: Pick<AxesTypeConfig<CalibratedAxes>, 'autoExtractKind' | 'id'>): AutoExtractTool[] {
  if (config.id === 'heatmap') return [];
  const kind = config.autoExtractKind ?? 'curve';
  if (kind === 'none') return [];
  if (kind !== 'curve') return autoExtractModesFor(kind, config.id).includes('color-trace') ? ['shapes'] : [];
  // where Find lines does not read (polar, ternary, map, CCR), a line is Colour trace's curve reading
  return findLinesKind(config.id) ? ['lines', 'points'] : ['shapes', 'points'];
}

/** The tool for one series: a line in the legend is read as a line, a marker as points; with no sample known (a
 * picture's legend), the type's first. */
function toolFor(tools: readonly AutoExtractTool[], sample: LegendEntry['sample']): AutoExtractTool {
  const want: AutoExtractTool | null = sample === 'line' ? 'lines' : sample === 'marker' ? 'points' : null;
  return want && tools.includes(want) ? want : tools[0]!;
}

/** Closer than this in RGB, two inks are one colour to a colour reader (8a864e3). */
const SAME_INK = 40;

export function planAutoExtract(
  config: Pick<AxesTypeConfig<CalibratedAxes>, 'autoExtractKind' | 'id'>,
  entries: readonly LegendEntry[],
  series: readonly { index: number; name: string; pointCount: number; color?: readonly number[] }[]
): AutoExtractStep[] {
  const tools = autoExtractTools(config);
  if (!tools.length) return [];
  const names = entries.map((e) => e.name.trim());
  const claimed = new Set<number>();
  const readBy: { colour: RGB; name: string; entry: number; tool: AutoExtractTool }[] = [];
  // ⚑ an entry with no name (a bar colour where no legend is marked, or a legend text not read) is called after the
  // series it goes into, else the next "Series N" no series and no entry already has (the code review of 2026-11-06:
  // "Series ${count + 1}" could be a series already there, and its data was replaced)
  const taken = new Set([...series.map((s) => s.name.trim()), ...names.filter(Boolean)]);
  const nextFree = (): string => {
    let k = 1;
    while (taken.has(`Series ${k}`)) k++;
    taken.add(`Series ${k}`);
    return `Series ${k}`;
  };
  const sameInk = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!) < SAME_INK;
  const steps = entries.map((e, i): AutoExtractStep => {
    let name = names[i]!;
    if (!e.colour) {
      if (!name) name = nextFree();
      return { entry: i, name, skip: `No colour was found beside “${name}” in the legend, so it was not read. Pick its colour from the figure with Find lines or Colour trace.` };
    }
    // ⚑ A COLOUR IS NEVER READ TWICE (8a864e3): two entries in one ink would each read both series, and the data
    // would come back twice. Which is which is the user's to say.
    const c = e.colour;
    const first = readBy.find((q) => Math.hypot(q.colour[0] - c[0], q.colour[1] - c[1], q.colour[2] - c[2]) < SAME_INK);
    // ⚑ BUT LINES IN ONE INK ARE TOLD APART BY THEIR STYLE, AND MARKERS BY THEIR SHAPE (v2.7; docs/
    // v2.7-workflow-walk.md, "Series told apart by their line style", "... by their markers"): the first entry's step
    // reads the ink once, for all of them. A line and a marker in one ink are read by different tools, which would
    // each read the other's ink too, so that stays as before.
    const tool = toolFor(tools, e.sample);
    if (first && first.tool === tool && (tool === 'lines' || tool === 'points')) return { entry: i, name: name || nextFree(), readWith: first.entry };
    if (first) {
      if (!name) name = nextFree();
      return { entry: i, name, skip: `Same colour as ${first.name}, so colour cannot tell them apart: its data was all read into ${first.name}. Move each to its own series in the series list.` };
    }
    // the series of that name (read again, it is replaced); an entry with no name, the series of its colour (read
    // again, it is replaced, never a second copy); else an empty series no entry names; else a new one
    const byName = name ? series.find((s) => !claimed.has(s.index) && s.name.trim() === name) : undefined;
    const byColour = !name ? series.find((s) => !claimed.has(s.index) && s.pointCount > 0 && s.color && sameInk(s.color, c)) : undefined;
    const empty = series.find((s) => !claimed.has(s.index) && s.pointCount === 0 && !names.includes(s.name.trim()));
    const intoSeries = byName ?? byColour ?? empty;
    const into = intoSeries?.index ?? 'new';
    if (into !== 'new') claimed.add(into);
    if (!name) name = intoSeries ? intoSeries.name.trim() : nextFree();
    readBy.push({ colour: c, name, entry: i, tool });
    return { entry: i, name, colour: c, tool, into };
  });
  // the step that reads an ink says which other entries it reads for
  for (const st of steps) {
    if (!('readWith' in st)) continue;
    const reader = steps[st.readWith]!;
    if ('tool' in reader) reader.shares = [...(reader.shares ?? []), st.entry];
  }
  return steps;
}

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One series' line in the Auto-extract report (David, 2026-11-02): its name and what was read, a count of nothing
 * left out. ⚑ No places: a problem is said once, in Places to check (David, 2026-11-04). */
export function autoExtractLine(name: string, read: { points: number; lines?: number; gaps?: number }): string {
  const parts = [
    ...(read.lines !== undefined ? [counted(read.lines, 'line', 'lines')] : []),
    counted(read.points, 'point', 'points'),
    ...(read.gaps ? [`${counted(read.gaps, 'gap', 'gaps')} bridged`] : []),
  ];
  return `${name}: ${parts.join(', ')}`;
}

/** A series that could not be read: a few words, the reason being one entry in Places to check (David, 2026-11-04). */
export function autoExtractNotRead(name: string): string {
  return `${name}: not read, see Places to check`;
}

/** Said once under every series' line: where the places to check are, when there are some, and the undo. */
export function autoExtractFooter(anyPlaces: boolean): string {
  return `${anyPlaces ? 'Places to check are listed on the right. ' : ''}Undo takes the whole read back.`;
}

/**
 * A bar chart's series where no legend is marked (v2.7; docs/v2.7-workflow-walk.md, "Auto-extract on a bar chart with
 * no legend"): one entry per bar colour the detector's sure bars show, in the order the bars stand, each with no name.
 * They go to `planAutoExtract` as a legend's entries do, which names each after the series it goes into (the series
 * of its colour when read again, else an empty one), else the next free "Series N".
 * Only the bars the bar read itself would take: sure (DETECTED_BAR_SCORE), and their centre in the data area. The
 * colour is measured inside each box, on the image as the readers see it (masked areas blanked): the commonest colour
 * of its middle half (a hatch or an outline leaves the fill the commonest); a box whose middle is the paper, or a
 * masked area, is no bar of a colour.
 */
export function entriesFromBars(
  bars: readonly { x0: number; y0: number; x1: number; y1: number; score?: number }[],
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  dataArea: { x: number; y: number; width: number; height: number } | null
): LegendEntry[] {
  const paper = paperColour(data, width, height);
  const near = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!) < SAME_INK;
  const fillOf = (b: { x0: number; y0: number; x1: number; y1: number }): [number, number, number] | null => {
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    const x0 = Math.max(0, Math.round(b.x0 + w / 4)), x1 = Math.min(width, Math.round(b.x1 - w / 4));
    const y0 = Math.max(0, Math.round(b.y0 + h / 4)), y1 = Math.min(height, Math.round(b.y1 - h / 4));
    const count = new Map<number, number>();
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        const key = ((data[i]! >> 3) << 10) | ((data[i + 1]! >> 3) << 5) | (data[i + 2]! >> 3);
        count.set(key, (count.get(key) ?? 0) + 1);
      }
    }
    let best = -1, n = 0;
    for (const [k, c] of count) if (c > n) { n = c; best = k; }
    if (best < 0) return null;
    const rgb: [number, number, number] = [((best >> 10) & 31) * 8 + 4, ((best >> 5) & 31) * 8 + 4, (best & 31) * 8 + 4];
    // the paper is no bar's colour, and a masked area is blanked in the paper around it (engine/imageEdit.ts)
    return near(rgb, paper) ? null : rgb;
  };
  const inArea = (b: { x0: number; y0: number; x1: number; y1: number }) => {
    if (!dataArea) return true;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    return cx >= dataArea.x && cx <= dataArea.x + dataArea.width && cy >= dataArea.y && cy <= dataArea.y + dataArea.height;
  };
  const colours: { colour: [number, number, number]; box: { x0: number; y0: number; x1: number; y1: number } }[] = [];
  const sure = bars.filter((b) => (b.score ?? 1) >= DETECTED_BAR_SCORE && inArea(b));
  for (const b of [...sure].sort((p, q) => p.x0 - q.x0 || p.y0 - q.y0)) {
    const c = fillOf(b);
    if (!c || colours.some((q) => near(q.colour, c))) continue;
    colours.push({ colour: c, box: b });
  }
  return colours.map(({ colour, box }) => ({ name: '', colour, sample: 'swatch' as const, textBox: box, sampleBox: null }));
}
