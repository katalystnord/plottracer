/**
 * Base64 <-> bytes, ONCE.
 *
 * ⚑⚑ THERE WERE FOUR COPIES OF THESE TWO FUNCTIONS (v2.3 re-audit, F37) -
 * `projectContainer.ts`, `digImport.ts` and `starryImport.ts`, character for
 * character, chunk size and all. Each was locally reasonable: an import filter
 * that pulled in the zip container to borrow one converter would be a much worse
 * dependency than a five-line copy.
 *
 * ⚑ Which is exactly why the answer is a LEAF module rather than a shared
 * import from the heaviest of the three. Nothing here imports anything, so any
 * file may take it without acquiring a dependency it did not want, and the
 * reason the copies existed disappears rather than being argued with.
 *
 * ⚑ THE CHUNKING IS THE PART WORTH HAVING IN ONE PLACE. `String.fromCharCode
 * (...bytes)` on a whole image blows the argument limit and throws - a failure
 * that appears only on a LARGE figure, which is to say on a real one. Every copy
 * happened to get it right; a fifth might not have.
 */

/** 32K at a time: `String.fromCharCode` takes its bytes as ARGUMENTS, and a
 *  spread of a megabyte-long array overflows the call stack. */
const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
