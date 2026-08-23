/**
 * The data panel's width, remembered between sessions.
 *
 * ⚑⚑ WHY IT IS PERSISTED AND NOT JUST WIDENED. David, 2026-08-16: *"I'm
 * wondering if we should make the data out card a little wider by default to
 * accommodate the wider datasets that we have for many figures now?"* The rail
 * was already resizable - and reset to 320 on every launch, so widening it was
 * work the user redid every single time. Raising the default alone would have
 * left that intact one size along.
 *
 * ⚑ THE DEFAULT CANNOT WIN ON ITS OWN, which is the argument for remembering.
 * A 5-column heatmap matrix needs about 530 px to read without scrolling; a
 * 20-column one will never fit at any sane default, which is what the matrix's
 * own "more columns to the right" notice exists for. So the default is a
 * COMPROMISE - wide enough for the common table, narrow enough not to eat the
 * canvas on a laptop - and the user's own choice is what actually settles it.
 *
 * ⚑ Same storage as the challenge board (`ui/src/challengeScores.ts`), which
 * Electron keeps under the app profile across restarts, and the same tolerance:
 * a missing, corrupt or out-of-range value falls back rather than throwing, and
 * a private-mode write that fails just means this session does not persist.
 */

const KEY = 'plottracer.panel.width';

/** The narrowest and widest the rail may be dragged - the clamp the drag handle
 * already applied, kept here so the stored value cannot smuggle a width past it
 * (a hand-edited entry is another entrance to the same model). */
export const MIN_PANEL_WIDTH = 260;
export const MAX_PANEL_WIDTH = 760;

/**
 * ⚑ 420, not 320 and not 530. Wide enough that an ordinary table stops wrapping
 * its headers onto three lines, and short of the width a 5-column matrix wants -
 * because that width is most of the canvas on a 1366-wide laptop, and the canvas
 * is where the figure is. Anyone who wants the matrix whole drags it once, and
 * it stays.
 */
export const DEFAULT_PANEL_WIDTH = 420;

/**
 * ⚑⚑ THE HALF THAT WAS LEFT OUT: A DEFAULT PER GRAPH TYPE. The compromise above
 * is a compromise because one number was being asked to serve a two-column
 * spreadsheet and a matrix. It does not have to. David, 2026-08-21: *"We have
 * already talked about making the default size a bit bigger for some types of
 * graphs. Lets do that."*
 *
 * ⚑ MEASURED, not picked. **530** is this file's own figure for a 5-column
 * heatmap matrix read without scrolling. **480** is for the two panels that grow
 * a COLUMN PER SERIES - bar and spider - because multi-series is the ordinary
 * case rather than the exception there: counted across the 887-chart ICPR/PMC
 * corpus, 65% of vertical bar charts and 47% of horizontal ones carry more than
 * one series. Everything else keeps 420, which is what it was chosen for.
 *
 * ⚑ A DEFAULT ONLY, and it never argues with the user. `readPanelWidth` prefers
 * a stored width whenever there is one, so this decides the FIRST view of a type
 * and nothing after it. Widening the rail under someone who has already dragged
 * it would be the app overruling a gesture, which is worse than a narrow panel.
 */
const PANEL_WIDTH_BY_PANEL: Record<string, number> = {
  heatmap: 530,
  bar: 480,
  spider: 480,
};

/** The width a type opens at when the user has never chosen one. */
export function defaultPanelWidthFor(outputPanel: string | undefined): number {
  const wanted = outputPanel === undefined ? undefined : PANEL_WIDTH_BY_PANEL[outputPanel];
  // Clamped like every other entrance: a table added here with a silly number
  // must not reach the rail by a route the drag handle does not police.
  return clampPanelWidth(wanted ?? DEFAULT_PANEL_WIDTH);
}

/**
 * The width the user chose, or NULL if they never have.
 *
 * ⚑⚑ NULL IS THE POINT, and it is why this exists beside `readPanelWidth`. "The
 * user picked 420" and "nobody has picked anything" are different facts, and a
 * function that answers both with the number 420 cannot tell a caller which one
 * it is holding. The rail needs to know, because an unchosen width may follow
 * the graph type and a chosen one may not.
 *
 * ⚑ A corrupt or unreadable entry reads as UNCHOSEN rather than throwing, the
 * same tolerance the rest of this file applies: the worst case is that the user
 * gets a sensible default instead of their own width.
 */
export function readStoredPanelWidth(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? clampPanelWidth(n) : null;
  } catch {
    return null;
  }
}

export function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_PANEL_WIDTH;
  return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, Math.round(width)));
}

/** The remembered width, or the default. Tolerant of missing/corrupt data. */
export function readPanelWidth(outputPanel?: string): number {
  const fallback = defaultPanelWidthFor(outputPanel);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? clampPanelWidth(n) : fallback;
  } catch {
    return fallback;
  }
}

/** Remember a width the user chose. Clamped on the way in, so what is stored is
 * always a width the app would accept. */
export function writePanelWidth(width: number): void {
  try {
    localStorage.setItem(KEY, String(clampPanelWidth(width)));
  } catch {
    /* private mode / quota - this session's choice just does not persist */
  }
}
