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

export function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_PANEL_WIDTH;
  return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, Math.round(width)));
}

/** The remembered width, or the default. Tolerant of missing/corrupt data. */
export function readPanelWidth(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return DEFAULT_PANEL_WIDTH;
    const n = Number(raw);
    return Number.isFinite(n) ? clampPanelWidth(n) : DEFAULT_PANEL_WIDTH;
  } catch {
    return DEFAULT_PANEL_WIDTH;
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
