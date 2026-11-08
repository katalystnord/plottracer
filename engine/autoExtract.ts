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

/**
 * A line or scatter chart with no legend marked (v2.7; docs/v2.7-workflow-walk.md, "Auto-extract on a line or scatter
 * chart with no legend"; David, 2026-11-08: "yes, for lines and scatter both"): the series are the inks in the data
 * area, each an entry with no name, given to the same plan a legend's entries go to, the most ink first. The search is
 * 3 px inside the data area, clear of its frame.
 *
 * - An ink is a colour within SAME_INK of the commonest colour of its pixels. A colour lying on the way from the paper
 *   to a stronger ink (within SAME_INK of that segment) is that ink's anti-aliased edge, and no series (measured: the
 *   stress-strain blue's edge tints were 9 of the 10 commonest colours after it).
 * - A series spreads across the data area: its ink spans at least a fifth of the data area's width or height. Ink in
 *   one small part is a legend's text inside the plot, or an annotation (the four-blend figure's legend text: 194 px).
 * - An ink with one long piece (a fifth of the data area's larger side) is a line, markers on it or not; one in small
 *   pieces about as tall as wide, at least 4 px across, is markers; anything else (dashes, dots) a line.
 */
export function entriesFromInks(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  dataArea: { x: number; y: number; width: number; height: number }
): LegendEntry[] {
  const paper = paperColour(data, width, height);
  const x0 = Math.max(0, Math.round(dataArea.x) + 3), y0 = Math.max(0, Math.round(dataArea.y) + 3);
  const x1 = Math.min(width - 1, Math.round(dataArea.x + dataArea.width) - 3), y1 = Math.min(height - 1, Math.round(dataArea.y + dataArea.height) - 3);
  if (x1 <= x0 || y1 <= y0) return [];
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
  const rgbAt = (x: number, y: number): RGB => {
    const i = (y * width + x) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!];
  };
  // the commonest colours, 5 bits a channel, of everything clearly not paper
  const count = new Map<number, number>();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = rgbAt(x, y);
      if (dist(c, paper) <= 60) continue;
      const key = ((c[0] >> 3) << 10) | ((c[1] >> 3) << 5) | (c[2] >> 3);
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  const centre = (k: number): RGB => [((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4];
  const inks: { colour: RGB; n: number }[] = [];
  for (const [k, n] of [...count].sort((a, b) => b[1] - a[1])) {
    const c = centre(k);
    const same = inks.find((q) => dist(q.colour, c) < SAME_INK);
    if (same) same.n += n;
    else inks.push({ colour: c, n });
  }
  // an edge tint lies on the way from the paper to a stronger ink
  const towards = (c: RGB, ink: RGB): number => {
    const d = [ink[0] - paper[0], ink[1] - paper[1], ink[2] - paper[2]];
    const len2 = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2;
    const t = Math.max(0, Math.min(1, ((c[0] - paper[0]) * d[0]! + (c[1] - paper[1]) * d[1]! + (c[2] - paper[2]) * d[2]!) / len2));
    return dist(c, [paper[0] + t * d[0]!, paper[1] + t * d[1]!, paper[2] + t * d[2]!]);
  };
  const strong = inks.filter((c) => !inks.some((k) => k !== c && dist(k.colour, paper) > dist(c.colour, paper) + 30 && towards(c.colour, k.colour) < SAME_INK));
  const out: { entry: LegendEntry; n: number }[] = [];
  const longSide = Math.max(w, h);
  const seen = new Uint8Array(w * h);
  for (const ink of strong) {
    // its pixels, as pieces (8-connected)
    const mine = new Uint8Array(w * h);
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (dist(rgbAt(x, y), ink.colour) >= SAME_INK) continue;
        mine[(y - y0) * w + (x - x0)] = 1;
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
    }
    if (bx1 < bx0 || (bx1 - bx0 < w / 5 && by1 - by0 < h / 5)) continue;
    seen.fill(0);
    const pieces: { across: number; tall: number }[] = [];
    const stack: number[] = [];
    for (let p = 0; p < w * h; p++) {
      if (!mine[p] || seen[p]) continue;
      let px0 = Infinity, py0 = Infinity, px1 = -Infinity, py1 = -Infinity, size = 0;
      stack.push(p);
      seen[p] = 1;
      while (stack.length) {
        const q = stack.pop()!;
        const qx = q % w, qy = (q - qx) / w;
        size++;
        if (qx < px0) px0 = qx;
        if (qx > px1) px1 = qx;
        if (qy < py0) py0 = qy;
        if (qy > py1) py1 = qy;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = qx + dx, ny = qy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const r = ny * w + nx;
            if (mine[r] && !seen[r]) {
              seen[r] = 1;
              stack.push(r);
            }
          }
        }
      }
      if (size >= 4) pieces.push({ across: px1 - px0 + 1, tall: py1 - py0 + 1 });
    }
    if (!pieces.length) continue;
    const longest = Math.max(...pieces.map((q) => Math.max(q.across, q.tall)));
    const sizes = pieces.map((q) => Math.max(q.across, q.tall)).sort((a, b) => a - b);
    const median = pieces.slice().sort((a, b) => Math.max(a.across, a.tall) - Math.max(b.across, b.tall))[Math.floor(pieces.length / 2)]!;
    const compact = Math.min(median.across, median.tall) / Math.max(median.across, median.tall) >= 0.5;
    const sample: 'line' | 'marker' = longest >= longSide / 5 ? 'line' : compact && sizes[Math.floor(sizes.length / 2)]! >= 4 ? 'marker' : 'line';
    const box = { x0: bx0, y0: by0, x1: bx1, y1: by1 };
    out.push({ entry: { name: '', colour: ink.colour, sample, textBox: box, sampleBox: null }, n: ink.n });
  }
  return out.sort((a, b) => b.n - a.n).map((e) => e.entry);
}
