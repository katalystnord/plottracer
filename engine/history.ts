/**
 * A generic undo/redo history stack (checkpoint 38, see CLAUDE.md).
 * Framework-agnostic vanilla TS with no DOM/React dependency -- the same
 * "engine" module philosophy as canvasView.ts, so the stack logic is unit-
 * tested directly rather than only through the React wiring.
 *
 * Snapshot-based, not command-based: for this app's modest data model
 * (hundreds of points) the whole session state is cheap to capture, and
 * core/plotData.ts's serialize/deserialize already round-trips it
 * losslessly -- so a snapshot/restore stack is far less code and far less
 * bug surface than writing an inverse operation for every one of the
 * session's ~15 mutators. This class is deliberately ignorant of *what* a
 * snapshot is (`T`); the session owns capture/restore (see
 * calibrationSession.ts's SessionSnapshot).
 *
 * Classic past/present/future model. `present` is always the last committed
 * state. A new mutation calls commit(newSnapshot), which pushes the old
 * present onto `past` and clears `future` (a new action invalidates any
 * redo branch). undo()/redo() move `present` between the stacks and return
 * the snapshot the caller should restore to (or null at a stack end).
 */
export class History<T> {
  private past: T[] = [];
  private present: T;
  private future: T[] = [];

  /**
   * @param initial  the starting state (e.g. a fresh, empty session's snapshot)
   * @param maxDepth cap on retained undo steps; the oldest is dropped past this.
   *                 100 is generous for hand digitizing -- deep enough to never
   *                 feel lossy in practice, bounded so a very long session can't
   *                 grow the stack without limit.
   */
  constructor(initial: T, private readonly maxDepth = 100) {
    this.present = initial;
  }

  /** Record a new committed state. The previous present becomes undoable and
   * the redo branch is discarded. */
  commit(next: T): void {
    this.past.push(this.present);
    if (this.past.length > this.maxDepth) this.past.shift();
    this.present = next;
    this.future = [];
  }

  /** Step back one state, returning the snapshot to restore to, or null if
   * there's nothing to undo. */
  undo(): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.present);
    this.present = prev;
    return this.present;
  }

  /** Step forward one previously-undone state, or null if there's nothing to
   * redo. */
  redo(): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.present);
    this.present = next;
    return this.present;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** The current committed state, without moving the stacks. */
  getPresent(): T {
    return this.present;
  }

  /** Discard all history and restart from `initial` -- used when the whole
   * document is replaced (new axes type chosen, project opened), where
   * carrying the old document's undo steps across would be nonsensical. */
  reset(initial: T): void {
    this.past = [];
    this.present = initial;
    this.future = [];
  }
}
