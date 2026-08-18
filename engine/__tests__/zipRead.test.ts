import { describe, it, expect } from 'vitest';
import { zipSync, strToU8, strFromU8 } from 'fflate';
import { unzipBounded, unzipEntry, ZipTooLargeError, MAX_TOTAL_UNCOMPRESSED } from '../zipRead.js';
import { deserializeProjectZip, isMultiFigureContainer } from '../projectContainer.js';
import { isStarryProject } from '../starryImport.js';

/**
 * ⚑ The archives this app opens are HANDED TO IT - a project file emailed to a
 * user, or a foreign digitiser's file someone downloaded. `unzipSync` inflates
 * every entry with no ceiling, so a small archive declaring gigabytes freezes or
 * kills the app with nothing on screen. These pin the refusal, and - just as
 * importantly - pin that an ordinary project still opens.
 */

/**
 * A tiny archive whose single entry DECLARES a huge uncompressed size.
 *
 * ⚑ This is what a zip bomb actually is, and building it by patching the size
 * fields rather than by compressing half a gigabyte of zeros matters twice
 * over: it is the honest shape of the attack (a few kB claiming gigabytes), and
 * it keeps the test fast - the first version of this helper really did allocate
 * 512 MB and cost the suite 13 seconds to assert a refusal that never inflates
 * anything.
 *
 * The size lives in two places fflate reads: the local file header (offset 22)
 * and the central directory entry (offset 24). Patch both.
 */
function bomb(declaredBytes: number): Uint8Array {
  const out = zipSync({ 'project.json': new Uint8Array(64) });
  const put = (at: number, v: number) => {
    out[at] = v & 0xff;
    out[at + 1] = (v >>> 8) & 0xff;
    out[at + 2] = (v >>> 16) & 0xff;
    out[at + 3] = (v >>> 24) & 0xff;
  };
  for (let i = 0; i + 3 < out.length; i++) {
    if (out[i] === 0x50 && out[i + 1] === 0x4b) {
      if (out[i + 2] === 0x03 && out[i + 3] === 0x04) put(i + 22, declaredBytes);
      if (out[i + 2] === 0x01 && out[i + 3] === 0x02) put(i + 24, declaredBytes);
    }
  }
  return out;
}

/**
 * Corrupt the compressed payload of the archive's SECOND entry, leaving the
 * first one intact. Used to prove which entries a reader actually touches.
 */
function corruptSecondEntry(zip: Uint8Array): Uint8Array {
  const out = zip.slice();
  const headers: number[] = [];
  for (let i = 0; i + 3 < out.length; i++) {
    if (out[i] === 0x50 && out[i + 1] === 0x4b && out[i + 2] === 0x03 && out[i + 3] === 0x04) headers.push(i);
  }
  expect(headers.length).toBeGreaterThanOrEqual(2);
  const at = headers[1]!;
  // Local header is 30 bytes + name + extra; jump well past it into the data.
  const nameLen = out[at + 26]! | (out[at + 27]! << 8);
  const extraLen = out[at + 28]! | (out[at + 29]! << 8);
  const dataStart = at + 30 + nameLen + extraLen;
  for (let i = dataStart; i < Math.min(dataStart + 16, out.length); i++) out[i] = out[i]! ^ 0xff;
  return out;
}

describe('unzipBounded', () => {
  it('opens an ordinary archive untouched', () => {
    const files = unzipBounded(zipSync({ 'project.json': strToU8('{"a":1}'), 'image.png': new Uint8Array(64) }));
    expect(strFromU8(files['project.json']!)).toBe('{"a":1}');
    expect(files['image.png']).toHaveLength(64);
  });

  it('refuses an archive that declares more than the budget', () => {
    const b = bomb(4 * 1024 * 1024);
    // Guard the premise: the FILE is tiny. If this ever grew large the test
    // would still pass while having stopped testing what it names.
    expect(b.byteLength).toBeLessThan(4096);
    expect(() => unzipBounded(b, 1024)).toThrow(ZipTooLargeError);
  });

  it('refuses BEFORE inflating - the declared size is what is checked', () => {
    // 3 GB declared. Any implementation that inflated first would exhaust
    // memory rather than return; that it throws promptly is the whole point.
    expect(() => unzipBounded(bomb(3 * 1024 * 1024 * 1024))).toThrow(ZipTooLargeError);
  });

  it('budgets the archive as a WHOLE, not entry by entry', () => {
    // Four entries, each individually under the cap, together over it. A
    // per-entry limit would wave this through.
    const many = zipSync({
      a: new Uint8Array(300_000),
      b: new Uint8Array(300_000),
      c: new Uint8Array(300_000),
      d: new Uint8Array(300_000),
    });
    expect(() => unzipBounded(many, 1_000_000)).toThrow(ZipTooLargeError);
    expect(Object.keys(unzipBounded(many, 2_000_000))).toHaveLength(4);
  });

  it('has a default budget large enough for a real project with a bundled PDF', () => {
    // The guard must not be the reason a legitimate project fails to open.
    expect(MAX_TOTAL_UNCOMPRESSED).toBeGreaterThanOrEqual(256 * 1024 * 1024);
  });
});

describe('unzipEntry', () => {
  it('returns just the entry asked for', () => {
    const bytes = zipSync({ 'project.json': strToU8('{"x":1}'), 'image.png': new Uint8Array(1024) });
    expect(strFromU8(unzipEntry(bytes, 'project.json')!)).toBe('{"x":1}');
  });

  it('is undefined when the archive has no such entry', () => {
    expect(unzipEntry(zipSync({ 'other.txt': strToU8('hi') }), 'project.json')).toBeUndefined();
  });

  it('does not inflate the rest of the archive to read one small manifest', () => {
    // project.json is small; the sibling entry is enormous. Reading the manifest
    // must not depend on -- or pay for -- the big one.
    const bytes = zipSync({ 'project.json': strToU8('{"ok":true}'), 'huge.bin': new Uint8Array(8 * 1024 * 1024) });
    expect(strFromU8(unzipEntry(bytes, 'project.json')!)).toBe('{"ok":true}');
  });

  it('refuses a manifest that is itself absurdly large', () => {
    const bytes = zipSync({ 'project.json': new Uint8Array(4 * 1024 * 1024) });
    expect(unzipEntry(bytes, 'project.json', 1024)).toBeUndefined();
  });
});

describe('the open paths are bounded, not just the helper', () => {
  it('deserializeProjectZip refuses a bomb with a readable message', () => {
    const result = deserializeProjectZip(bomb(MAX_TOTAL_UNCOMPRESSED + 1024));
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/archive/i);
  });

  /**
   * ⚑ THIS TEST HAD TO BE REWRITTEN BECAUSE THE FIRST VERSION WAS VACUOUS. It
   * fed the sniffers a bomb and asserted they returned `false` without
   * throwing - which was ALREADY TRUE before the fix, because both sniffers
   * catch everything and answer `false`. It would have passed against the
   * defect it was written to pin.
   *
   * A test can only prove the sniffers stopped reading the whole archive if
   * whole-archive reading would give a DIFFERENT answer. So: corrupt a sibling
   * entry's compressed data. Inflating everything throws and the sniffer
   * answers "not mine"; reading only `project.json` succeeds and it answers
   * correctly. One bit decides it, deterministically, with no timing.
   */
  it('the SNIFFERS read only project.json - proven by a corrupt sibling entry', () => {
    const starry = zipSync({
      'project.json': strToU8(JSON.stringify({ axisSets: [{ id: 1 }] })),
      'image.png': new Uint8Array(4096).fill(7),
    });
    const corrupted = corruptSecondEntry(starry);

    // Guard the premise: whole-archive inflation really must fail on this input,
    // or the test proves nothing about which path is taken.
    expect(() => unzipBounded(corrupted)).toThrow();

    // ...yet the sniffer still recognises the file, because it never touches
    // the broken entry.
    expect(isStarryProject(corrupted)).toBe(true);

    const multi = corruptSecondEntry(
      zipSync({
        'project.json': strToU8(JSON.stringify({ plotTracerProject: 1, figures: [{ image: { path: 'a' } }] })),
        'image.png': new Uint8Array(4096).fill(9),
      })
    );
    expect(() => unzipBounded(multi)).toThrow();
    expect(isMultiFigureContainer(multi)).toBe(true);
  });

  it('a bomb still cannot hang the sniffers', () => {
    const b = bomb(MAX_TOTAL_UNCOMPRESSED + 1024);
    expect(isMultiFigureContainer(b)).toBe(false);
    expect(isStarryProject(b)).toBe(false);
  });
});
