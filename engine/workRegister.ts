/**
 * The register of work behind the status bar's ring. David, 2026-10-20: "this could and should hook into every
 * tool or operation that we have that is working. To show progress." And 2026-10-30: the ring sits in the lower
 * right corner all the time, with no text beside it, and runs only while a long-running operation does.
 *
 * Anything that takes time says it started (out of how many, when it knows), reports how far it is, and says it
 * ended; `track` does all three for a promise. The ring runs once work has gone on for SHOW_AFTER_MS, filling to the
 * share done when a total is known and turning when not.
 *
 * Why a busy PERIOD and not each piece of work: Find lines reads its labels one after another, each a separate
 * read, so judging each read on its own would stop and restart the ring between every label. Work that starts
 * within IDLE_AFTER_MS of the last one ending belongs to the same period. Framework-free, with the clock and the
 * timer handed in, so the timing is tested (workRegister.test.ts).
 */

/** How long work runs before the ring runs. Shorter work never moves it: a blink on every quick trace is noise. */
export const SHOW_AFTER_MS = 250;
/** How long nothing must run before the ring stops; reads that follow one another keep it going. */
export const IDLE_AFTER_MS = 150;

/** What the ring shows while it runs: how far, when a total is known. */
export interface WorkView {
  done: number | null;
  total: number | null;
}

/** One piece of work, as its owner holds it. */
export interface WorkHandle {
  /** How far it is, out of the total given to `start`. */
  progress(done: number): void;
  /** It ended, by success or failure; a second call does nothing. */
  end(): void;
}

interface Work {
  done: number | null;
  total: number | null;
}

export class WorkRegister {
  private readonly running: Work[] = [];
  private readonly listeners = new Set<() => void>();
  /** When the current busy period began, or null when idle. */
  private busySince: number | null = null;
  /** When the last piece of work ended with nothing else running, or null while something runs. */
  private idleSince: number | null = null;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly setTimer: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms); }
  ) {}

  start(total?: number): WorkHandle {
    this.settle();
    const t = this.now();
    if (this.busySince === null) this.busySince = t;
    this.idleSince = null;
    const w: Work = { done: total === undefined ? null : 0, total: total ?? null };
    this.running.push(w);
    // the ring starts when the quarter second has passed, without anyone having to ask
    const wait = SHOW_AFTER_MS - (t - this.busySince);
    if (wait > 0) this.setTimer(() => this.emit(), wait);
    else this.emit();
    let ended = false;
    return {
      progress: (done) => {
        if (ended) return;
        w.done = done;
        this.emit();
      },
      end: () => {
        if (ended) return;
        ended = true;
        const i = this.running.indexOf(w);
        if (i >= 0) this.running.splice(i, 1);
        if (!this.running.length) {
          this.idleSince = this.now();
          this.setTimer(() => this.emit(), IDLE_AFTER_MS);
        }
        this.emit();
      },
    };
  }

  /** Runs the ring for as long as the promise is unsettled, and hands the promise back unchanged. */
  track<T>(p: Promise<T>): Promise<T> {
    const w = this.start();
    p.then(() => w.end(), () => w.end());
    return p;
  }

  /** What the ring shows: null when it stands still. */
  view(): WorkView | null {
    this.settle();
    if (this.busySince === null) return null;
    // between two reads the ring keeps running only if it already ran before the gap
    const busyFor = (this.idleSince ?? this.now()) - this.busySince;
    if (busyFor < SHOW_AFTER_MS) return null;
    for (let i = this.running.length - 1; i >= 0; i--) {
      const w = this.running[i]!;
      if (w.total !== null) return { done: w.done, total: w.total };
    }
    return { done: null, total: null };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Ends the busy period once nothing has run for IDLE_AFTER_MS. */
  private settle(): void {
    if (this.idleSince !== null && this.now() - this.idleSince >= IDLE_AFTER_MS) {
      this.busySince = null;
      this.idleSince = null;
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
