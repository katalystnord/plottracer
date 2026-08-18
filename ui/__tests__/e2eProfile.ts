/**
 * THE THROWAWAY ELECTRON PROFILE A RUN GETS, AND THE SWEEP THAT REAPS OLD ONES.
 *
 * ⚑⚑ WHY A PROFILE AT ALL. The e2e suite had none, so for its whole life it ran
 * against the developer's REAL PlotTracer user-data directory: the run WROTE
 * into his installed app's storage, and anything the app persists survived from
 * one run to the next - a shared mutable fixture nobody declared. The sidebar
 * test found it the expensive way. It asserts the panel opens at its DEFAULT
 * width, then drags the handle to ~563px, which v2.2 made PERSISTENT. It passed
 * once, stored the width it had just dragged to, and failed on every run after
 * with no code change in between. **A green board that turns red by itself is
 * state outliving the run, not flakiness.**
 *
 * ⚑ `mkdtemp` rather than one fixed path, so two overlapping runs (a subset
 * while a full board is going - routine here) cannot share a profile and
 * corrupt each other.
 *
 * ⚑⚑ SWEPT AT START, NOT AT EXIT. The first cleanup ran in a
 * `process.on('exit')` hook and leaked NINE profiles at 2 MB each in one
 * evening, because that hook does not reliably run under vitest's worker pool.
 * The start of a run is the one moment a process can actually control.
 *
 * ⚑⚑ AND THEN THE REPLACEMENT LEAKED TOO, WHICH IS WHY THIS IS A MODULE.
 * (v2.2 audit pass 5, 2026-08-17, under "a fix can BE the defect".) The sweep
 * read its clock as `fs.statSync(os.tmpdir()).mtimeMs` - **the mtime of /tmp,
 * not the time.** That is only ever "now" by coincidence: /tmp's mtime moves
 * when a top-level entry is added or removed, so on a busy desktop it tracks
 * the clock and the six-hour rule appears to work, while on a quiet machine -
 * a fresh CI container, a box where the app has not run in days - it is
 * whenever the last profile was made. Measured on a simulated idle tmp:
 * profiles ten hours old, **reaped by the code as written: 0. With a real
 * clock: 2.** The same shape a third time - state that outlives the run,
 * unnoticed because nothing ever fails because of it - and SELF-MASKING on the
 * one machine anybody would test it on.
 *
 * ▶ So the sweep is a pure function taking its clock and its directory as
 * arguments. That is the whole reason it moved out of the e2e file: a module-
 * scope side effect reading the wall clock has no seam to test at, and this
 * block has now been wrong twice in a way no test could have caught.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const E2E_PROFILE_PREFIX = 'plottracer-e2e-profile-';

/** Older than this and no live run can still own it. */
export const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Delete this suite's abandoned profiles from `dir`, returning what was reaped.
 *
 * @param now milliseconds since the epoch - passed in, never read from the
 * filesystem. The bug this signature exists to prevent is described above.
 */
export function sweepStaleProfiles(
  dir: string,
  now: number,
  maxAgeMs: number = SIX_HOURS_MS
): string[] {
  const reaped: string[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return reaped; // No temp dir to sweep is not a reason to fail the suite.
  }
  for (const entry of entries) {
    if (!entry.startsWith(E2E_PROFILE_PREFIX)) continue;
    const stale = path.join(dir, entry);
    try {
      if (now - fs.statSync(stale).mtimeMs > maxAgeMs) {
        fs.rmSync(stale, { recursive: true, force: true });
        reaped.push(entry);
      }
    } catch {
      // A profile that vanished under us, or one another run owns.
    }
  }
  return reaped;
}

/** Sweep the abandoned profiles, then hand this run a fresh one of its own. */
export function freshProfile(): string {
  sweepStaleProfiles(os.tmpdir(), Date.now());
  return fs.mkdtempSync(path.join(os.tmpdir(), E2E_PROFILE_PREFIX));
}
