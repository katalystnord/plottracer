import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { serializeProject } from '../projectFile.js';
import {
  serializeProjectZip,
  deserializeProjectZip,
  deserializeMultiFigureZip,
  isMultiFigureContainer,
  isZipContainer,
  isTarArchive,
} from '../projectContainer.js';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';

/**
 * The FORMAT SNIFFERS and the container's refusals.
 *
 * ⚑ WHY THIS FILE EXISTS. `projectContainer.ts` scored 57.77% with 50 of its
 * mutants uncovered outright. The existing suite round-trips a project
 * successfully - which is the happy path - and leaves untested the three
 * things that decide what happens when the file is NOT what was expected:
 *
 *  - `isZipContainer` / `isTarArchive` (21 mutants between them). These are
 *    the whole of "one Open Project reads every format", and the reason it
 *    works is that the FILE says what it is rather than its extension. Every
 *    magic byte is load-bearing: a sniffer that checks three bytes of four
 *    routes some other zip-like file into the project reader, which then
 *    fails with the wrong words.
 *  - `mimeToExt` (24 mutants, one per case, none named by any test). The
 *    entry name is what makes a saved project browsable in any zip tool,
 *    which is the stated reason the container format exists at all.
 *  - the multi-figure reader's four refusals, none of which had a test.
 *
 * The rule this file serves is the project's own: **guards belong in the
 * model, and the model has more than one entrance.** A container is the
 * second entrance, and a malformed one must be refused with words that name
 * what is wrong - never accepted into a half-built session.
 */

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
/** The PNG's payload, reusable as any mime's bytes - the sniffing under test
 *  is about the DECLARED mime, not about decoding the picture. */
const PNG_B64 = PNG_DATA_URL.split(',')[1]!;

function calibratedProjectFile(imageDataURL = PNG_DATA_URL) {
  const session = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
  for (const [px, py, value] of [
    [100, 250, '0'],
    [400, 250, '10'],
    [100, 250, '0'],
    [100, 100, '10'],
  ] as Array<[number, number, string]>) {
    session.handleCalibrationClick(px, py);
    session.confirmCalibrationValues([value]);
  }
  session.runCalibration();
  session.addDataPoint(250, 175);
  const result = serializeProject(session, imageDataURL);
  if ('error' in result) throw new Error(`fixture build failed: ${result.error}`);
  return result;
}

function zipBytes(file = calibratedProjectFile()): Uint8Array {
  const zip = serializeProjectZip(file);
  if ('error' in zip) throw new Error(zip.error);
  return zip;
}

describe('the zip sniffer reads the magic, byte by byte', () => {
  const magic = [0x50, 0x4b, 0x03, 0x04];

  it('accepts the real thing', () => {
    expect(isZipContainer(zipBytes())).toBe(true);
    expect(isZipContainer(new Uint8Array([...magic, 0, 0, 0]))).toBe(true);
  });

  for (let i = 0; i < 4; i++) {
    it(`⚑ refuses a file whose byte ${i} of the magic is wrong`, () => {
      // Each byte its own case: a sniffer that stops after three still accepts
      // "PK\x03\x06" (a zip END-of-archive record) as a project, and the
      // reader then reports "no project.json" for a file that was never one.
      const bytes = new Uint8Array([...magic, 0, 0, 0]);
      bytes[i] = 0xff;
      expect(isZipContainer(bytes)).toBe(false);
    });
  }

  it('refuses a file too short to hold the magic, rather than reading past the end', () => {
    expect(isZipContainer(new Uint8Array([0x50, 0x4b, 0x03]))).toBe(false);
    expect(isZipContainer(new Uint8Array([]))).toBe(false);
  });

  it('refuses a legacy JSON project, which is the case the sniffer exists for', () => {
    const json = new TextEncoder().encode('{"version":1}');
    expect(isZipContainer(json)).toBe(false);
  });
});

describe('the tar sniffer reads ustar at its POSIX offset', () => {
  /** A buffer with `ustar` written at offset 257, where the format puts it. */
  function tarLike(length = 262): Uint8Array {
    const bytes = new Uint8Array(length);
    const magic = [0x75, 0x73, 0x74, 0x61, 0x72]; // u s t a r
    for (let i = 0; i < magic.length && 257 + i < length; i++) bytes[257 + i] = magic[i]!;
    return bytes;
  }

  it('accepts a POSIX/GNU tar header', () => {
    expect(isTarArchive(tarLike())).toBe(true);
    expect(isTarArchive(tarLike(1024))).toBe(true);
  });

  for (let i = 0; i < 5; i++) {
    it(`refuses a header whose ustar byte ${i} is wrong`, () => {
      const bytes = tarLike();
      bytes[257 + i] = 0x00;
      expect(isTarArchive(bytes)).toBe(false);
    });
  }

  it('⚑ refuses a buffer one byte too short to hold the magic', () => {
    // 262 bytes is the minimum that contains offsets 257..261. At 261 the last
    // byte read is `undefined`, which compares false anyway - but the length
    // guard is what keeps that from being an accident.
    expect(isTarArchive(tarLike(261))).toBe(false);
    expect(isTarArchive(new Uint8Array(0))).toBe(false);
  });

  it('⚑ does NOT read ustar at offset 0, so a file merely CONTAINING it is not a tar', () => {
    // The offset is the whole point: the magic is at 257 in a real header, and
    // a sniffer that scans for it anywhere would claim any text file
    // mentioning "ustar".
    const bytes = new Uint8Array(300);
    for (const [i, b] of [0x75, 0x73, 0x74, 0x61, 0x72].entries()) bytes[i] = b;
    expect(isTarArchive(bytes)).toBe(false);
  });

  it('does not confuse a zip for a tar, or the reverse', () => {
    expect(isTarArchive(zipBytes())).toBe(false);
    expect(isZipContainer(tarLike())).toBe(false);
  });
});

describe('the image entry is named from its declared mime', () => {
  // The extension is what makes the archive browsable in any zip tool, which
  // is why the container format is a zip rather than one opaque blob.
  const cases: Array<[string, string]> = [
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/gif', 'gif'],
    ['image/bmp', 'bmp'],
    ['image/webp', 'webp'],
    ['image/tiff', 'tiff'],
    ['image/svg+xml', 'svg'],
    ['application/pdf', 'pdf'],
  ];

  for (const [mime, ext] of cases) {
    it(`names a ${mime} image "image.${ext}"`, () => {
      const zip = zipBytes(calibratedProjectFile(`data:${mime};base64,${PNG_B64}`));
      expect(Object.keys(unzipSync(zip))).toContain(`image.${ext}`);
    });
  }

  it('⚑ falls back to .bin for a mime it does not know, and still round-trips', () => {
    // The stated contract: an unknown type is not a failure, because the mime
    // itself is stored in project.json and re-forms the exact same data URL.
    const url = `data:image/x-future-format;base64,${PNG_B64}`;
    const zip = zipBytes(calibratedProjectFile(url));
    expect(Object.keys(unzipSync(zip))).toContain('image.bin');

    const back = deserializeProjectZip(zip);
    if ('error' in back) throw new Error(back.error);
    expect(back.imageDataURL).toBe(url);
  });

  it('stores no inlined base64 in project.json, whatever the mime', () => {
    const zip = zipBytes(calibratedProjectFile(`data:image/webp;base64,${PNG_B64}`));
    const json = new TextDecoder().decode(unzipSync(zip)['project.json']!);
    expect(json).not.toContain('base64');
    expect(JSON.parse(json).image).toEqual({ path: 'image.webp', mime: 'image/webp' });
  });
});

/** A hand-built container, so each malformed shape can be posted directly. */
function containerOf(projectJson: unknown, extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({ 'project.json': strToU8(JSON.stringify(projectJson)), ...extra });
}

describe('a malformed single-figure container is refused, in words that name the fault', () => {
  it('says which part is missing when there is no project.json', () => {
    const bytes = zipSync({ 'image.png': strToU8('x') });
    expect(deserializeProjectZip(bytes)).toEqual({ error: expect.stringContaining('project.json') });
  });

  it('says the JSON is invalid rather than throwing', () => {
    const bytes = zipSync({ 'project.json': strToU8('{not json') });
    const r = deserializeProjectZip(bytes);
    expect('error' in r && r.error).toMatch(/not valid JSON/i);
  });

  it('refuses an image reference with no path, and one with no mime', () => {
    expect(deserializeProjectZip(containerOf({ image: { mime: 'image/png' } }))).toEqual({
      error: expect.stringContaining('image reference'),
    });
    expect(deserializeProjectZip(containerOf({ image: { path: 'image.png' } }))).toEqual({
      error: expect.stringContaining('image reference'),
    });
    expect(deserializeProjectZip(containerOf({}))).toEqual({
      error: expect.stringContaining('image reference'),
    });
  });

  it('⚑ NAMES the missing entry when the reference points at nothing', () => {
    // The path is in the message on purpose: a hand-edited or partially
    // extracted archive is exactly when a user needs to know which file to
    // put back.
    const r = deserializeProjectZip(containerOf({ image: { path: 'figures/9/image.png', mime: 'image/png' } }));
    expect('error' in r && r.error).toContain('figures/9/image.png');
  });

  it('refuses unreadable bytes as an archive, not as a crash', () => {
    const r = deserializeProjectZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff]));
    expect('error' in r && r.error).toMatch(/unreadable/i);
  });
});

describe('a bundled source document is restored, and a broken reference is dropped', () => {
  function withSource(srcRef: unknown, entries: Record<string, Uint8Array> = {}): ReturnType<typeof deserializeProjectZip> {
    const good = unzipSync(zipBytes());
    const json = JSON.parse(new TextDecoder().decode(good['project.json']!));
    json.sourceDocument = srcRef;
    return deserializeProjectZip(
      zipSync({ ...good, 'project.json': strToU8(JSON.stringify(json)), ...entries })
    );
  }

  it('restores the bytes and the name when the entry is really there', () => {
    const r = withSource({ path: 'source.pdf', mime: 'application/pdf', name: 'paper.pdf' }, {
      'source.pdf': strToU8('PDF-BYTES'),
    });
    if ('error' in r) throw new Error(r.error);
    expect(r.sourceDocument).toEqual({
      mime: 'application/pdf',
      bytes: strToU8('PDF-BYTES'),
      name: 'paper.pdf',
    });
  });

  it('omits the name rather than writing an empty one', () => {
    const r = withSource({ path: 'source.pdf', mime: 'application/pdf' }, { 'source.pdf': strToU8('X') });
    if ('error' in r) throw new Error(r.error);
    expect(r.sourceDocument).not.toHaveProperty('name');
  });

  it('⚑ opens the project anyway when the source entry is MISSING', () => {
    // A source document is a convenience, not the record. Failing the whole
    // open because a bundled PDF went missing would lose the traced data over
    // something the user can re-attach.
    const r = withSource({ path: 'source.pdf', mime: 'application/pdf' });
    if ('error' in r) throw new Error(r.error);
    expect(r.sourceDocument).toBeUndefined();
    expect(r.datasets[0]!.getCount()).toBe(1);
  });

  it('drops a reference with no path or a non-string mime, without failing the open', () => {
    for (const ref of [{ mime: 'application/pdf' }, { path: 'source.pdf', mime: 7 }]) {
      const r = withSource(ref, { 'source.pdf': strToU8('X') });
      if ('error' in r) throw new Error(r.error);
      expect(r.sourceDocument).toBeUndefined();
    }
  });
});

describe('a malformed multi-figure container is refused too', () => {
  it('says so when project.json has no figures array', () => {
    const r = deserializeMultiFigureZip(containerOf({ version: 1 }));
    expect('error' in r && r.error).toMatch(/multi-figure/i);
  });

  it('⚑ refuses a `figures` that is an object rather than an array', () => {
    // `Array.isArray`, not a truthiness check: an object would pass the latter
    // and then iterate zero figures, opening an empty project instead of
    // saying the file is wrong.
    const r = deserializeMultiFigureZip(containerOf({ figures: { 0: {} } }));
    expect('error' in r && r.error).toMatch(/multi-figure/i);
  });

  it('names the fault when a figure has no usable image reference', () => {
    const r = deserializeMultiFigureZip(containerOf({ figures: [{ image: { mime: 'image/png' } }] }));
    expect('error' in r && r.error).toMatch(/image reference/i);
  });

  it('names the missing entry when a figure points at one that is not there', () => {
    const r = deserializeMultiFigureZip(
      containerOf({ figures: [{ image: { path: 'figures/0/image.png', mime: 'image/png' } }] })
    );
    expect('error' in r && r.error).toContain('figures/0/image.png');
  });

  it('reports no project.json and invalid JSON separately here as well', () => {
    expect('error' in deserializeMultiFigureZip(zipSync({ 'a.png': strToU8('x') }))).toBe(true);
    const bad = deserializeMultiFigureZip(zipSync({ 'project.json': strToU8('{oops') }));
    expect('error' in bad && bad.error).toMatch(/not valid JSON/i);
  });
});

describe('routing between the single and multi readers', () => {
  it('treats an unreadable archive as single, so the real error comes from the reader', () => {
    // The stated contract: this peek never decides an error, only a route.
    expect(isMultiFigureContainer(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff]))).toBe(false);
  });

  it('treats an archive with no project.json as single', () => {
    expect(isMultiFigureContainer(zipSync({ 'image.png': strToU8('x') }))).toBe(false);
  });

  it('treats unparseable project.json as single', () => {
    expect(isMultiFigureContainer(zipSync({ 'project.json': strToU8('{oops') }))).toBe(false);
  });

  it('routes a real single-figure container to the single reader', () => {
    expect(isMultiFigureContainer(zipBytes())).toBe(false);
  });
});
