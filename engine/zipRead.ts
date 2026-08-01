/**
 * Bounded ZIP reading — the one door every archive we open goes through.
 *
 * ⚑ WHY THIS EXISTS. `unzipSync` inflates EVERY entry into memory with no
 * ceiling, and the archives we open are handed to us: a project file emailed to
 * a user, or a foreign digitiser's project someone downloaded. A "zip bomb" — a
 * few tens of kilobytes declaring gigabytes of output — therefore freezes or
 * kills the app with nothing on screen to say why. The app is offline and local,
 * so nothing worse than that is at stake, which is exactly why the fix should be
 * the smallest one that works rather than a security apparatus (tenet 10).
 *
 * ⚑ WHY A DECLARED-SIZE BUDGET IS A REAL BOUND, not a check an attacker simply
 * lies past. fflate sizes each entry's output buffer from the size recorded in
 * the archive, so that number IS the allocation. Declare a small size and lie,
 * and inflation overruns the buffer and throws; declare the real, huge size and
 * the filter below refuses it before a byte is inflated. Either way the memory
 * is never committed.
 *
 * ⚑ AND THE SNIFFERS ONLY WANT ONE ENTRY. `isStarryProject` and
 * `isMultiFigureContainer` run on EVERY zip a user tries to open, purely to read
 * `project.json` — so they were inflating an entire archive to look at one small
 * file. `unzipEntry` reads just the one, which closes the most exposed path and
 * is faster on every legitimate open too.
 */

import { unzipSync } from 'fflate';

/**
 * Total uncompressed bytes we will inflate from one archive.
 *
 * Generous on purpose: a project legitimately holds a figure image plus,
 * optionally, the whole source PDF it was cut from, and refusing a real project
 * would be a far worse defect than the one this guards against. A 42 kB bomb
 * declares several gigabytes, so the two are nowhere near each other.
 */
export const MAX_TOTAL_UNCOMPRESSED = 512 * 1024 * 1024;

export class ZipTooLargeError extends Error {
  constructor() {
    super('Could not open project — the archive expands to far more data than a project should contain.');
    this.name = 'ZipTooLargeError';
  }
}

/**
 * Inflate a whole archive, refusing one that declares more than the budget.
 *
 * Throws `ZipTooLargeError` rather than returning a result type, because every
 * caller already sits inside a try/catch that turns an unreadable archive into a
 * user-facing message — and a bomb IS an unreadable archive, just an expensively
 * unreadable one.
 */
export function unzipBounded(
  bytes: Uint8Array,
  maxTotal: number = MAX_TOTAL_UNCOMPRESSED
): Record<string, Uint8Array> {
  let budget = maxTotal;
  let refused = false;
  const files = unzipSync(bytes, {
    filter(file) {
      // originalSize is the archive's own declaration, read from the entry
      // header before anything is inflated -- see the header note on why that
      // makes this a bound and not a formality.
      budget -= file.originalSize ?? 0;
      if (budget < 0) {
        refused = true;
        return false;
      }
      return true;
    },
  });
  if (refused) throw new ZipTooLargeError();
  return files;
}

/**
 * Inflate exactly ONE named entry. Returns undefined when the archive has no
 * such entry — which is a normal answer for a sniffer, not an error.
 *
 * The size cap here is deliberately much smaller than the whole-archive budget:
 * every caller uses this for a small JSON manifest, so a `project.json`
 * declaring hundreds of megabytes is not a project we want to inflate to find
 * out it is not ours.
 */
export function unzipEntry(
  bytes: Uint8Array,
  entryName: string,
  maxSize = 32 * 1024 * 1024
): Uint8Array | undefined {
  const files = unzipSync(bytes, {
    filter: (file) => file.name === entryName && (file.originalSize ?? 0) <= maxSize,
  });
  return files[entryName];
}
