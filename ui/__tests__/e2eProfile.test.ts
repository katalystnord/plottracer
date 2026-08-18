import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sweepStaleProfiles, freshProfile, E2E_PROFILE_PREFIX, SIX_HOURS_MS } from './e2eProfile.js';

/**
 * ⚑⚑ THE CASE, as an outcome: *given profiles older than six hours, the sweep
 * removes them - whatever else has or has not touched the directory.*
 *
 * It did not. The sweep read its clock as `fs.statSync(os.tmpdir()).mtimeMs`,
 * which is the mtime of /tmp rather than the time, so the six-hour rule was
 * measured against an arbitrary reference. On the developer's own machine /tmp
 * is busy enough that its mtime tracks the clock and the bug is invisible; on a
 * quiet one it is whenever the last profile was made, and nothing is ever
 * reaped. The first test below is that machine.
 */

let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-test-'));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** A profile in the sandbox, aged `hours` into the past. */
function aged(name: string, hours: number): string {
  const dir = path.join(sandbox, name);
  fs.mkdirSync(dir);
  const when = Date.now() - hours * 60 * 60 * 1000;
  fs.utimesSync(dir, when / 1000, when / 1000);
  return dir;
}

describe('⚑⚑ the abandoned-profile sweep', () => {
  it('reaps a profile older than six hours on an IDLE directory - the case that failed', () => {
    // ⚑ THE REGRESSION. The directory's own mtime is set to the same moment the
    // profiles were made, which is exactly what an idle /tmp looks like: nothing
    // but this suite has touched it. Reading the clock from the directory made
    // every profile look zero hours old, so the sweep reaped nothing, forever.
    aged(`${E2E_PROFILE_PREFIX}aaa`, 10);
    aged(`${E2E_PROFILE_PREFIX}bbb`, 10);
    const tenHoursAgo = Date.now() - 10 * 60 * 60 * 1000;
    fs.utimesSync(sandbox, tenHoursAgo / 1000, tenHoursAgo / 1000);

    expect(sweepStaleProfiles(sandbox, Date.now()).sort()).toEqual([
      `${E2E_PROFILE_PREFIX}aaa`,
      `${E2E_PROFILE_PREFIX}bbb`,
    ]);
    expect(fs.readdirSync(sandbox)).toEqual([]);
  });

  it('leaves a LIVE run\'s profile alone - no live run is six hours old', () => {
    aged(`${E2E_PROFILE_PREFIX}live`, 0);
    expect(sweepStaleProfiles(sandbox, Date.now())).toEqual([]);
    expect(fs.readdirSync(sandbox)).toEqual([`${E2E_PROFILE_PREFIX}live`]);
  });

  it('leaves a profile just UNDER the age alone, and takes the one just over', () => {
    // The boundary, so an off-by-one in the comparison cannot pass.
    aged(`${E2E_PROFILE_PREFIX}young`, 5.9);
    aged(`${E2E_PROFILE_PREFIX}old`, 6.1);
    expect(sweepStaleProfiles(sandbox, Date.now())).toEqual([`${E2E_PROFILE_PREFIX}old`]);
  });

  it('touches nothing that is not ours, however old', () => {
    // ⚑ A sweep that runs in a SHARED directory must be narrow. /tmp belongs to
    // everything on the machine, and the prefix is the whole of our claim to a
    // directory we are about to delete recursively.
    aged('someone-elses-tmpdir', 100);
    aged(`not-${E2E_PROFILE_PREFIX}ours`, 100);
    expect(sweepStaleProfiles(sandbox, Date.now())).toEqual([]);
    expect(fs.readdirSync(sandbox).length).toBe(2);
  });

  it('a missing directory is not a reason to fail the suite', () => {
    expect(sweepStaleProfiles(path.join(sandbox, 'nope'), Date.now())).toEqual([]);
  });

  it('is not vacuous - the clock is an ARGUMENT, so a wrong clock is expressible', () => {
    // ⚑ This is the test that would have caught the original: hand the sweep the
    // clock the old code used (the directory's own mtime, on an idle directory)
    // and it reaps nothing, while the real clock reaps both. If the signature
    // ever goes back to reading the time itself, this stops compiling - which is
    // the point of the seam.
    aged(`${E2E_PROFILE_PREFIX}aaa`, 10);
    const tenHoursAgo = Date.now() - 10 * 60 * 60 * 1000;
    fs.utimesSync(sandbox, tenHoursAgo / 1000, tenHoursAgo / 1000);

    const dirMtimeAsClock = fs.statSync(sandbox).mtimeMs;
    expect(sweepStaleProfiles(sandbox, dirMtimeAsClock)).toEqual([]);
    expect(sweepStaleProfiles(sandbox, Date.now())).toEqual([`${E2E_PROFILE_PREFIX}aaa`]);
  });

  it('SIX_HOURS_MS is six hours, since the whole rule rests on it', () => {
    expect(SIX_HOURS_MS).toBe(21_600_000);
  });
});

describe('freshProfile', () => {
  it('hands this run a directory of its own, which no other run can share', () => {
    const a = freshProfile();
    const b = freshProfile();
    try {
      expect(a).not.toBe(b);
      expect(fs.existsSync(a)).toBe(true);
      expect(fs.existsSync(b)).toBe(true);
      expect(path.basename(a).startsWith(E2E_PROFILE_PREFIX)).toBe(true);
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });
});
