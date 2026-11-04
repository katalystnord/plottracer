import type { AxesTypeConfig, CalibratedAxes } from './axesTypeConfigs.js';
import type { LegendEntry } from './legendRead.js';
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
      /** Other entries in the same ink, read by this step and told apart by their line style (v2.7). */
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
  series: readonly { index: number; name: string; pointCount: number }[]
): AutoExtractStep[] {
  const tools = autoExtractTools(config);
  if (!tools.length) return [];
  const names = entries.map((e) => e.name.trim());
  const claimed = new Set<number>();
  const readBy: { colour: RGB; name: string; entry: number; tool: AutoExtractTool }[] = [];
  let unnamed = 0;
  const steps = entries.map((e, i): AutoExtractStep => {
    const name = names[i] || `Series ${series.length + ++unnamed}`;
    if (!e.colour) {
      return { entry: i, name, skip: `No colour was found beside “${name}” in the legend, so it was not read. Pick its colour from the figure with Find lines or Colour trace.` };
    }
    // ⚑ A COLOUR IS NEVER READ TWICE (8a864e3): two entries in one ink would each read both series, and the data
    // would come back twice. Which is which is the user's to say.
    const c = e.colour;
    const first = readBy.find((q) => Math.hypot(q.colour[0] - c[0], q.colour[1] - c[1], q.colour[2] - c[2]) < SAME_INK);
    // ⚑ BUT LINES IN ONE INK ARE TOLD APART BY THEIR STYLE (v2.7; docs/v2.7-workflow-walk.md, "Series told apart by
    // their line style"): the first entry's step reads the ink once, for all of them.
    const tool = toolFor(tools, e.sample);
    if (first && first.tool === 'lines' && tool === 'lines') return { entry: i, name, readWith: first.entry };
    if (first) {
      return { entry: i, name, skip: `Same colour as ${first.name}, so colour cannot tell them apart: its data was all read into ${first.name}. Move each to its own series in the series list.` };
    }
    readBy.push({ colour: c, name, entry: i, tool });
    // the series of that name (read again, it is replaced); else an empty series no entry names; else a new one
    const byName = series.find((s) => !claimed.has(s.index) && s.name.trim() === name);
    const empty = series.find((s) => !claimed.has(s.index) && s.pointCount === 0 && !names.includes(s.name.trim()));
    const into = byName?.index ?? empty?.index ?? 'new';
    if (into !== 'new') claimed.add(into);
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
