/**
 * A contour line's LEVEL - the one value a contour series carries that an XY
 * series does not (v2.6, agreed with David 2026-10-07).
 *
 * **Why a number on the series, not its name.** Every library that draws
 * contours from lines takes the level as a number beside the vertices: R's
 * `contourLines()` returns `{level, x, y}` per line, ggplot2 colours a path by
 * it, matplotlib's `ContourSet(ax, levels, allsegs)` groups lines under it. A
 * level written into the series NAME has to be parsed back out by whoever reads
 * the file, so the name stays free text and the level lives here.
 *
 * **Stored the way the error relation is** (`engine/errorRelation.ts`): one key
 * in the series' own metadata, which `core/plotData.ts` already serializes and
 * restores generically. So no format is invented, and both doors - typing a
 * level and opening a file - go through `getContourLevel`, which is where the
 * validity rule lives.
 *
 * **`source`** says where the level came from: typed, read from the line's own
 * label (and accepted), read off the colour key, or interpolated between
 * other lines. An interpolated level is a reading like any other and stays
 * editable; the source is what lets the screen show it the way interpolated
 * points are shown.
 */
import type { Dataset } from '../core/dataset.js';
import { InputParser } from '../core/inputParser.js';

/** typed by the user, read from the line's own label (and accepted), read off
 * the figure's colour key by the line's colour, or interpolated from the levels
 * around it. */
export type ContourLevelSource = 'typed' | 'label' | 'key' | 'interpolated';

export interface ContourLevel {
  value: number;
  source: ContourLevelSource;
}

const CONTOUR_LEVEL_METADATA_KEY = 'contourLevel';

/** The level `dataset` carries, or null - also null for anything a file holds
 * that is not a finite number with a known source. */
export function getContourLevel(dataset: Dataset): ContourLevel | null {
  const raw = dataset.getMetadata()[CONTOUR_LEVEL_METADATA_KEY];
  if (raw == null || typeof raw !== 'object') return null;
  const { value, source } = raw as Record<string, unknown>;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (source !== 'typed' && source !== 'label' && source !== 'key' && source !== 'interpolated') return null;
  return { value, source };
}

/** Set (or, with null, clear) the level. Refuses anything but a finite number,
 * and says so - the refusal is the caller's message to show. */
export function setContourLevel(dataset: Dataset, level: ContourLevel | null): string | null {
  if (level && !Number.isFinite(level.value)) return 'A contour level must be a number.';
  const meta = { ...dataset.getMetadata() };
  if (level) meta[CONTOUR_LEVEL_METADATA_KEY] = { value: level.value, source: level.source };
  else delete meta[CONTOUR_LEVEL_METADATA_KEY];
  dataset.setMetadata(meta);
  return null;
}

/**
 * A level as the user TYPED it: parsed the way every value in the app is
 * (`core/inputParser.ts` - the WHOLE string must be a number, so "1,000" and
 * "5 kJ" are refused rather than read as 1 and 5), so the level field cannot
 * read a number differently from the calibration fields beside it.
 * Blank clears. Returns the level, null for "clear", or the refusal to show.
 */
export function parseContourLevel(text: string): { value: number } | null | { error: string } {
  const t = text.trim();
  if (t === '') return null;
  const ip = new InputParser();
  const v = ip.parse(t);
  if (!ip.isValid || ip.isDate || typeof v !== 'number' || !Number.isFinite(v)) {
    return { error: `"${t}" is not a number - the level was not changed.` };
  }
  return { value: v };
}
