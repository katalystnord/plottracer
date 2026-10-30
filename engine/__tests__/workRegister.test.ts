// The register of work the status bar's ring shows (David, 2026-10-30: the ring sits in the lower right corner all
// the time, with no text beside it, and runs only while a long-running operation does). Cases named for what the
// corner shows.
import { describe, expect, it } from 'vitest';
import { WorkRegister, IDLE_AFTER_MS, SHOW_AFTER_MS } from '../workRegister.js';

/** A clock and timers the test moves by hand. */
function fakeTime() {
  let now = 0;
  const timers: { at: number; fn: () => void }[] = [];
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => { timers.push({ at: now + ms, fn }); },
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > until) break;
        timers.shift();
        now = t.at;
        t.fn();
      }
      now = until;
    },
  };
}

describe('the ring in the lower right corner', () => {
  it('stands still when nothing is running', () => {
    const t = fakeTime(); const r = new WorkRegister(t.now, t.setTimer);
    expect(r.view()).toBeNull();
  });

  it('stays still for work that ends within a quarter second (no flicker for quick things)', () => {
    const t = fakeTime(); const r = new WorkRegister(t.now, t.setTimer);
    const seen: unknown[] = []; r.subscribe(() => seen.push(r.view()));
    const w = r.start();
    t.advance(SHOW_AFTER_MS - 50); w.end(); t.advance(1000);
    expect(seen.filter(Boolean)).toEqual([]);
    expect(r.view()).toBeNull();
  });

  it('turns for work still running after a quarter second (no total known)', () => {
    const t = fakeTime(); const r = new WorkRegister(t.now, t.setTimer);
    r.start();
    t.advance(SHOW_AFTER_MS - 50);
    expect(r.view()).toBeNull();
    t.advance(100);
    expect(r.view()).toEqual({ done: null, total: null });
  });

  it('fills to the share done for work that reports progress: 3 of 9', () => {
    const t = fakeTime(); const r = new WorkRegister(t.now, t.setTimer);
    const w = r.start(9);
    t.advance(SHOW_AFTER_MS + 50); w.progress(3);
    expect(r.view()).toEqual({ done: 3, total: 9 });
  });

  it('keeps running through one read after another, without stopping between them', () => {
    const t = fakeTime(); const r = new WorkRegister(t.now, t.setTimer);
    const seen: (object | null)[] = []; r.subscribe(() => seen.push(r.view()));
    for (let i = 0; i < 5; i++) {
      const w = r.start(); t.advance(120); w.end(); t.advance(10);
    }
    // five reads of 120 ms each, back to back: one long operation, so the ring runs and never stops in between
    const firstRun = seen.findIndex(Boolean);
    expect(firstRun).toBeGreaterThanOrEqual(0);
    expect(seen.slice(firstRun).every(Boolean)).toBe(true);
    t.advance(IDLE_AFTER_MS + 10);
    expect(r.view()).toBeNull();
  });

  it('stops once nothing has run for a moment, and says so without anyone asking', () => {
    const t = fakeTime(); const r = new WorkRegister(t.now, t.setTimer);
    const seen: (object | null)[] = []; r.subscribe(() => seen.push(r.view()));
    const w = r.start();
    t.advance(SHOW_AFTER_MS + 50);
    expect(seen.some(Boolean)).toBe(true);
    w.end();
    t.advance(IDLE_AFTER_MS + 10);
    expect(seen[seen.length - 1]).toBeNull();
  });

  it('shows the latest work that knows its total, over one that does not', () => {
    const t = fakeTime(); const r = new WorkRegister(t.now, t.setTimer);
    const a = r.start(); const b = r.start(4);
    t.advance(SHOW_AFTER_MS + 50); b.progress(1);
    expect(r.view()).toEqual({ done: 1, total: 4 });
    b.end();
    expect(r.view()).toEqual({ done: null, total: null });
    a.end();
  });

  it('a tracked promise runs the ring until it settles, whether it succeeds or fails', async () => {
    const t = fakeTime(); const r = new WorkRegister(t.now, t.setTimer);
    let fail!: (e: Error) => void;
    const p = r.track(new Promise<number>((_, rej) => { fail = rej; }));
    t.advance(SHOW_AFTER_MS + 50);
    expect(r.view()).not.toBeNull();
    fail(new Error('no'));
    await expect(p).rejects.toThrow('no');
    t.advance(IDLE_AFTER_MS + 10);
    expect(r.view()).toBeNull();
  });

  it('ending a piece of work twice is harmless (a finally after a catch)', () => {
    const t = fakeTime(); const r = new WorkRegister(t.now, t.setTimer);
    const a = r.start(); const b = r.start();
    t.advance(SHOW_AFTER_MS + 50); a.end(); a.end();
    expect(r.view()).not.toBeNull(); // b is still running
    b.end(); t.advance(IDLE_AFTER_MS + 10);
    expect(r.view()).toBeNull();
  });
});
