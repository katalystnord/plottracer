/**
 * Trace Challenge — local high-score table (v1.2 game). Persisted in the renderer's
 * localStorage, which Electron keeps under the app profile across restarts. Lower
 * adjusted time is better, so the board sorts ascending (fastest first).
 */
export interface HighScore {
  name: string;
  /** ISO date (YYYY-MM-DD) the run was recorded. */
  date: string;
  /** Adjusted time in seconds (raw + penalties); lower is better. */
  adjustedSeconds: number;
}

const KEY = 'plottracer.challenge.highscores';
export const MAX_HIGH_SCORES = 10;

/** Read the saved table (sorted fastest-first). Tolerant of missing/corrupt data. */
export function readHighScores(): HighScore[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((h): h is HighScore => h && typeof h.name === 'string' && typeof h.adjustedSeconds === 'number')
      .sort((a, b) => a.adjustedSeconds - b.adjustedSeconds)
      .slice(0, MAX_HIGH_SCORES);
  } catch {
    return [];
  }
}

/** Would an adjusted time make the board (a top-N time, or the board isn't full)? */
export function qualifies(adjustedSeconds: number, board: readonly HighScore[] = readHighScores()): boolean {
  if (board.length < MAX_HIGH_SCORES) return true;
  return adjustedSeconds < board[board.length - 1]!.adjustedSeconds;
}

/** Insert a run, re-sort, trim to the top N, persist, and return the new board. */
export function insertHighScore(name: string, adjustedSeconds: number): HighScore[] {
  const date = new Date().toISOString().slice(0, 10);
  const next = [...readHighScores(), { name: name.trim() || 'Anonymous', date, adjustedSeconds }]
    .sort((a, b) => a.adjustedSeconds - b.adjustedSeconds)
    .slice(0, MAX_HIGH_SCORES);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — the run just doesn't persist */
  }
  return next;
}
