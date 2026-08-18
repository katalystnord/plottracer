import { describe, expect, it } from 'vitest';
import { isPdfBytes, isTiffBytes, pagedDocumentFormat } from '../pdfDetect.js';

/**
 * Paged-document detection by CONTENT.
 *
 * ⚑ WHY THIS FILE GREW. `pdfDetect.ts` scored 52.24% - the worst in
 * `engine/` - while already having a test for every function. Nothing was
 * uncovered; 32 mutants were simply not NOTICED, because a signature check is
 * a chain of independent byte comparisons and a test that passes one whole
 * correct header and one whole wrong one exercises the chain without
 * distinguishing its links. Drop any single comparison and both cases still
 * give the same answer.
 *
 * That matters because this is the FIRST thing that happens to a dropped
 * file. Too permissive, and an ordinary PNG is handed to pdf.js; too strict,
 * and a scanned TIFF page goes to `<img>`, which cannot decode it - a blank
 * canvas with nothing on screen to explain it.
 *
 * The rule it serves is the one `isZipContainer` serves: **the file says what
 * it is**, not its name. A PDF saved as `figure.png` still opens.
 */

/** Bytes beginning with the given signature, padded out to `length`. */
function starting(signature: number[], length = 16): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < signature.length && i < length; i++) bytes[i] = signature[i]!;
  return bytes;
}

const PDF = [0x25, 0x50, 0x44, 0x46]; // % P D F
const TIFF_LE = [0x49, 0x49, 0x2a, 0x00]; // I I * \0
const TIFF_BE = [0x4d, 0x4d, 0x00, 0x2a]; // M M \0 *
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('the PDF signature', () => {
  it('recognises a real "%PDF-1.7" header', () => {
    expect(isPdfBytes(new TextEncoder().encode('%PDF-1.7\n%âãÏÓ'))).toBe(true);
  });

  for (let i = 0; i < 4; i++) {
    it(`refuses a header whose byte ${i} is wrong`, () => {
      // Each comparison is its own mutant. Dropping the check on byte 1, say,
      // would accept anything beginning "%?DF", and no later stage re-checks.
      const bytes = starting(PDF);
      bytes[i] = 0xff;
      expect(isPdfBytes(bytes)).toBe(false);
    });
  }

  it('⚑ requires a FIFTH byte, since "%PDF" alone is not a document', () => {
    // The guard is `>= 5`, not `>= 4`: a real header always continues with a
    // version. The looser guard would accept a four-byte file, which then
    // fails deep inside pdf.js rather than here where it can be explained.
    expect(isPdfBytes(new Uint8Array(PDF))).toBe(false);
    expect(isPdfBytes(starting(PDF, 5))).toBe(true);
  });

  it('refuses an empty file, plain text and a PNG', () => {
    expect(isPdfBytes(new Uint8Array(0))).toBe(false);
    expect(isPdfBytes(new TextEncoder().encode('hello'))).toBe(false);
    expect(isPdfBytes(starting(PNG))).toBe(false);
  });

  it('⚑ reads the signature at the START, so a PDF quoted inside a file is not one', () => {
    const bytes = starting(PNG);
    for (const [i, b] of PDF.entries()) bytes[8 + i] = b;
    expect(isPdfBytes(bytes)).toBe(false);
  });
});

describe('the TIFF signature, in both byte orders', () => {
  it('recognises little-endian "II*\\0" and big-endian "MM\\0*"', () => {
    expect(isTiffBytes(starting(TIFF_LE))).toBe(true);
    expect(isTiffBytes(starting(TIFF_BE))).toBe(true);
  });

  for (let i = 0; i < 4; i++) {
    it(`refuses a little-endian header whose byte ${i} is wrong`, () => {
      const bytes = starting(TIFF_LE);
      bytes[i] = 0xff;
      expect(isTiffBytes(bytes)).toBe(false);
    });

    it(`refuses a big-endian header whose byte ${i} is wrong`, () => {
      const bytes = starting(TIFF_BE);
      bytes[i] = 0xff;
      expect(isTiffBytes(bytes)).toBe(false);
    });
  }

  it('⚑ does not accept the two orders MIXED, which is not a TIFF', () => {
    // Two `&&`-chains joined by one `||`. Flattened into "any of these bytes
    // matches", both "II\0*" and "MM*\0" would pass - and UTIF can read
    // neither.
    expect(isTiffBytes(starting([0x49, 0x49, 0x00, 0x2a]))).toBe(false);
    expect(isTiffBytes(starting([0x4d, 0x4d, 0x2a, 0x00]))).toBe(false);
  });

  it('refuses a file shorter than the signature', () => {
    expect(isTiffBytes(new Uint8Array(TIFF_LE.slice(0, 3)))).toBe(false);
    expect(isTiffBytes(new Uint8Array(0))).toBe(false);
  });

  it('accepts a header exactly four bytes long, which is the whole signature', () => {
    expect(isTiffBytes(new Uint8Array(TIFF_LE))).toBe(true);
  });

  it('refuses a PDF and a PNG', () => {
    expect(isTiffBytes(new TextEncoder().encode('%PDF-1.4'))).toBe(false);
    expect(isTiffBytes(starting(PNG))).toBe(false);
  });
});

describe('the single dispatch point', () => {
  it('routes a PDF to the PDF renderer and a TIFF to the TIFF one', () => {
    expect(pagedDocumentFormat(new TextEncoder().encode('%PDF-1.7'))).toBe('pdf');
    expect(pagedDocumentFormat(starting(TIFF_LE))).toBe('tiff');
    expect(pagedDocumentFormat(starting(TIFF_BE))).toBe('tiff');
  });

  it('⚑ returns null for a plain raster, which is what sends it to <img>', () => {
    // null is not "unknown" here - it is the positive decision that the
    // browser can decode this directly. A wrong null shows a blank canvas
    // with nothing on screen to explain it.
    expect(pagedDocumentFormat(starting(PNG))).toBeNull();
    expect(pagedDocumentFormat(starting([0xff, 0xd8, 0xff, 0xe0]))).toBeNull(); // JPEG
    expect(pagedDocumentFormat(new Uint8Array(0))).toBeNull();
  });
});
