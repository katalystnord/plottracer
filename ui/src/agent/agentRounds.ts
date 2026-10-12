/**
 * Rounds of steps the person approves (v2.7 M14, docs/v2.7-mcp-cases.md
 * R1-R11). David: *"It can be more than one step, but say perhaps 5 steps, and
 * then give the user a chance to approve, before it goes on."*
 *
 * ⚑ The gate stands in front of every STEP - a tool call that changes the
 * figure - and nothing else (R7): an agent that is waiting can still look.
 * Each step is applied and visible as it happens; the round only decides when
 * the agent may take the next one.
 */

export type AgentMode = 'rounds' | 'automatic';

/** How long a held call waits before answering that the agent should call
 * again (R8) - well inside the main process's own bound on a call. */
export const HOLD_LIMIT_MS = 60000;
export const STILL_WAITING = 'Waiting for the user; call again to keep waiting.';

/** The tools that change the figure, and so count as steps (R7). Opening a
 * figure starts a new document rather than changing this one, and an undo
 * takes a step back rather than taking one. */
const STEPS: ReadonlySet<string> = new Set([
  'add_series', 'rename_series', 'remove_series', 'place_points', 'place_guide_points', 'move_point', 'delete_points', 'cut_line',
  'join_lines', 'move_to_line', 'set_level', 'use_label_read', 'find_lines', 'mask_area',
]);
export const isStep = (name: string): boolean => STEPS.has(name);

export type Gate = { go: true } | { go: false; message: string };

export interface RoundsView {
  mode: AgentMode;
  size: number;
  /** The steps taken this round, by their labels, oldest first. */
  steps: readonly string[];
  /** A step is held until the person answers. */
  waiting: boolean;
  paused: boolean;
}

const undoneText = (n: number) => `The user undid your last ${n} ${n === 1 ? 'step' : 'steps'}. Call get_state to see the figure as it is now.`;

export class AgentRounds {
  private mode: AgentMode;
  private size: number;
  private steps: string[] = [];
  private paused = false;
  private held: { resolve: (g: Gate) => void; cancel: () => void } | null = null;
  private notice: string | null = null;
  private listeners = new Set<() => void>();
  private readonly setTimer: (ms: number, fn: () => void) => () => void;

  constructor(o: { size: number; mode: AgentMode; setTimer?: (ms: number, fn: () => void) => () => void }) {
    this.mode = o.mode;
    this.size = Math.max(1, Math.floor(o.size) || 1);
    this.setTimer = o.setTimer ?? ((ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  private mustHold(): boolean {
    return this.paused || (this.mode === 'rounds' && this.steps.length >= this.size);
  }

  /** Wait, if the round is full or the person paused, until they answer - or
   * until the bound, when the agent is told to call again (R8). */
  beforeStep(): Promise<Gate> {
    if (!this.mustHold()) return Promise.resolve({ go: true });
    // one held step at a time; an earlier one still waiting is told to call again
    this.release({ go: false, message: STILL_WAITING });
    return new Promise<Gate>((resolve) => {
      const cancel = this.setTimer(HOLD_LIMIT_MS, () => {
        if (this.held?.resolve === resolve) {
          this.held = null;
          resolve({ go: false, message: STILL_WAITING });
          this.changed();
        }
      });
      this.held = { resolve, cancel };
      this.changed();
    });
  }

  private release(g: Gate): boolean {
    const h = this.held;
    if (!h) return false;
    this.held = null;
    h.cancel();
    h.resolve(g);
    return true;
  }

  /** A step was applied. In automatic mode nothing is kept: there is no round. */
  afterStep(label: string): void {
    if (this.mode === 'rounds') this.steps.push(label);
    this.changed();
  }

  /** The agent's own undo took back its latest step, which leaves the round. */
  stepUndone(): void {
    if (this.steps.length) this.steps.pop();
    if (!this.mustHold()) this.release({ go: true });
    this.changed();
  }

  /** R3. */
  approve(): void {
    this.steps = [];
    if (!this.paused) this.release({ go: true });
    this.changed();
  }

  /** R4: the round is over and its steps are the caller's to take back. Returns
   * how many there were. The held step does not run. */
  undoRound(): number {
    const n = this.steps.length;
    this.steps = [];
    if (n > 0 && !this.release({ go: false, message: undoneText(n) })) this.notice = undoneText(n);
    this.changed();
    return n;
  }

  /** What the agent has to hear on its next call, once. */
  takeNotice(): string | null {
    const n = this.notice;
    this.notice = null;
    return n;
  }

  /** R5. */
  continueAutomatically(): void {
    this.mode = 'automatic';
    this.steps = [];
    if (!this.paused) this.release({ go: true });
    this.changed();
  }

  /** R6. */
  pause(): void {
    this.paused = true;
    this.changed();
  }

  resume(): void {
    this.paused = false;
    if (!this.mustHold()) this.release({ go: true });
    this.changed();
  }

  /** R10: the strip's mode switch. Switching starts a fresh round. */
  setMode(mode: AgentMode): void {
    this.mode = mode;
    this.steps = [];
    if (!this.mustHold()) this.release({ go: true });
    this.changed();
  }

  view(): RoundsView {
    // a full round waits for the person whether or not a call is held right now
    // - a held call that timed out leaves the round on screen (R8)
    const full = this.mode === 'rounds' && this.steps.length >= this.size;
    return { mode: this.mode, size: this.size, steps: [...this.steps], waiting: full || this.held !== null, paused: this.paused };
  }

  /** R9: for get_state. */
  describe(): string {
    const n = this.steps.length;
    const base =
      this.mode === 'automatic'
        ? 'Working mode: automatic, chosen by the user; your steps are not held for approval.'
        : `Working mode: in rounds of ${this.size} ${this.size === 1 ? 'step' : 'steps'}, chosen by the user; ${n} ${n === 1 ? 'step' : 'steps'} taken this round. After ${this.size} the user approves before you go on.`;
    if (this.paused) return `${base} Paused by the user: your next step waits until they resume.`;
    if (this.held || (this.mode === 'rounds' && n >= this.size)) return `${base} Your next step is waiting for the user to approve this round.`;
    return base;
  }
}
