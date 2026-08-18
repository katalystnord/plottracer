import { describe, expect, it } from 'vitest';
import { readTar, entryText } from '../tarRead.js';

/**
 * The tar reader's HEADER handling and its refusals.
 *
 * ⚑ WHY THIS FILE EXISTS. `tarRead.ts` scored 68% with 28 surviving mutants,
 * clustered in the header fields: the USTAR long-path split, the typeflag
 * classification, and the size/padding arithmetic that decides where the NEXT
 * header begins.
 *
 * The padding is the sharp one. Data is padded up to a 512-byte boundary, so
 * an off-by-one in `ceil(size / BLOCK)` does not corrupt the entry being read
 * - it lands the reader in the middle of the next file and every entry after
 * it is garbage or silently absent. This is the import path for someone
 * else's project, which is why the file's own comment says it throws rather
 * than returning a partial result.
 */

const BLOCK = 512;

/** Write an ASCII string into `buf` at `offset`, NUL-padded. */
function put(buf: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) buf[offset + i] = text.charCodeAt(i);
}

interface Entry {
  name: string;
  data?: string;
  typeflag?: string;
  prefix?: string;
  /** Override the declared size, to forge a malformed archive. */
  sizeOverride?: number;
}

/** Build a tar archive from entries, the way the format specifies. */
function makeTar(entries: Entry[], { endMarker = true } = {}): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const e of entries) {
    const data = new TextEncoder().encode(e.data ?? '');
    const header = new Uint8Array(BLOCK);
    put(header, 0, e.name);
    const size = e.sizeOverride ?? data.length;
    // Size is an octal string, NUL-terminated, in a 12-byte field.
    put(header, 124, size.toString(8).padStart(11, '0'));
    header[156] = (e.typeflag ?? '0').charCodeAt(0);
    put(header, 257, 'ustar');
    if (e.prefix) put(header, 345, e.prefix);
    blocks.push(header);
    if (data.length > 0) {
      const padded = new Uint8Array(Math.ceil(data.length / BLOCK) * BLOCK);
      padded.set(data);
      blocks.push(padded);
    }
  }
  if (endMarker) blocks.push(new Uint8Array(BLOCK), new Uint8Array(BLOCK));
  const total = blocks.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const b of blocks) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

describe('reading entries in sequence', () => {
  it('reads a single file with its contents', () => {
    const entries = readTar(makeTar([{ name: 'info.json', data: '{"a":1}' }]));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('info.json');
    expect(entries[0]!.type).toBe('file');
    expect(entryText(entries[0]!)).toBe('{"a":1}');
  });

  it('⚑ finds the SECOND entry, which only works if the padding is right', () => {
    // A 7-byte file still occupies a whole 512-byte block. Miscount it and
    // the reader lands mid-file and every later entry is lost or garbage.
    const entries = readTar(
      makeTar([
        { name: 'info.json', data: '{"a":1}' },
        { name: 'wpd.json', data: '{"b":2}' },
      ])
    );
    expect(entries.map((e) => e.name)).toEqual(['info.json', 'wpd.json']);
    expect(entryText(entries[1]!)).toBe('{"b":2}');
  });

  it('handles a file that fills a block EXACTLY, with no extra padding', () => {
    // The boundary the ceil() must not round past: 512 bytes is one block,
    // not two.
    const exact = 'x'.repeat(BLOCK);
    const entries = readTar(makeTar([{ name: 'a.bin', data: exact }, { name: 'b.txt', data: 'ok' }]));
    expect(entries.map((e) => e.name)).toEqual(['a.bin', 'b.txt']);
    expect(entryText(entries[0]!)).toHaveLength(BLOCK);
    expect(entryText(entries[1]!)).toBe('ok');
  });

  it('handles a file spanning several blocks', () => {
    const big = 'y'.repeat(BLOCK * 2 + 3);
    const entries = readTar(makeTar([{ name: 'big.bin', data: big }, { name: 'after.txt', data: 'z' }]));
    expect(entryText(entries[0]!)).toHaveLength(big.length);
    expect(entries[1]!.name).toBe('after.txt');
  });

  it('reads an EMPTY file, which occupies no data block at all', () => {
    const entries = readTar(makeTar([{ name: 'empty' }, { name: 'next.txt', data: 'v' }]));
    expect(entries.map((e) => e.name)).toEqual(['empty', 'next.txt']);
    expect(entryText(entries[0]!)).toBe('');
  });

  it('stops at the zero block rather than reading the padding as entries', () => {
    const entries = readTar(makeTar([{ name: 'one.txt', data: 'a' }]));
    expect(entries).toHaveLength(1);
  });

  it('stops cleanly at the end of the buffer when there is no end marker', () => {
    const entries = readTar(makeTar([{ name: 'one.txt', data: 'a' }], { endMarker: false }));
    expect(entries).toHaveLength(1);
  });

  it('returns nothing for an empty buffer', () => {
    expect(readTar(new Uint8Array(0))).toEqual([]);
  });
});

describe('entry types', () => {
  it('treats typeflag "0" and NUL alike as a regular file', () => {
    // Both appear in the wild for a plain file.
    expect(readTar(makeTar([{ name: 'a.txt', data: 'x', typeflag: '0' }]))[0]!.type).toBe('file');
    expect(readTar(makeTar([{ name: 'b.txt', data: 'x', typeflag: '\0' }]))[0]!.type).toBe('file');
  });

  it('reads a directory entry, and gives it no data', () => {
    const entries = readTar(makeTar([{ name: 'dir/', typeflag: '5' }]));
    expect(entries[0]!.type).toBe('directory');
    expect(entries[0]!.data).toHaveLength(0);
  });

  it('⚑ treats a trailing slash as a directory even without the typeflag', () => {
    const entries = readTar(makeTar([{ name: 'dir/', typeflag: '0' }]));
    expect(entries[0]!.type).toBe('directory');
  });

  it('⚑ REFUSES a type it does not handle, naming it', () => {
    // A symlink ('2') in someone else's archive is not a plain file. Reading
    // it as one would put the link TARGET where the data should be, and the
    // failure would surface much later as unreadable content.
    expect(() => readTar(makeTar([{ name: 'link', typeflag: '2' }]))).toThrow(/link/);
    expect(() => readTar(makeTar([{ name: 'link', typeflag: '2' }]))).toThrow(/type '2'/);
  });
});

describe('the USTAR long-path split', () => {
  it('⚑ joins prefix and name with a slash', () => {
    // A path over 100 characters is split across two header fields. Ignoring
    // the prefix silently renames the file, so a lookup by name finds nothing
    // and the import reports the archive as missing a part it actually has.
    const entries = readTar(makeTar([{ name: 'wpd.json', prefix: 'project/data', data: '{}' }]));
    expect(entries[0]!.name).toBe('project/data/wpd.json');
  });

  it('uses the name alone when there is no prefix', () => {
    expect(readTar(makeTar([{ name: 'wpd.json', data: '{}' }]))[0]!.name).toBe('wpd.json');
  });

  it('classifies a prefixed directory by its joined name', () => {
    const entries = readTar(makeTar([{ name: 'sub/', prefix: 'project', typeflag: '0' }]));
    expect(entries[0]!.name).toBe('project/sub/');
    expect(entries[0]!.type).toBe('directory');
  });
});

describe('malformed archives are refused, not half-read', () => {
  it('⚑ throws when an entry claims more bytes than the archive holds', () => {
    // The file's own contract: a half-read project surfaces later as
    // mysteriously missing data, so this is the place to be strict.
    const bad = makeTar([{ name: 'big.bin', data: 'x', sizeOverride: 999999 }]);
    expect(() => readTar(bad)).toThrow(/big\.bin/);
    expect(() => readTar(bad)).toThrow(/archive ends first/i);
  });

  it('throws on a header with an empty name', () => {
    // Not the same as the end marker: the size field is set, so the block is
    // not all zeros.
    const buf = new Uint8Array(BLOCK * 2);
    put(buf, 124, '00000000010');
    buf[156] = '0'.charCodeAt(0);
    expect(() => readTar(buf)).toThrow(/empty name/i);
  });

  it('reads a size field padded with spaces as well as NULs', () => {
    // Numeric fields are both NUL- and space-padded in the wild; trimming
    // only one leaves parseInt reading a number that is not there.
    const tar = makeTar([{ name: 'a.txt', data: 'hello' }]);
    for (let i = 0; i < 12; i++) tar[124 + i] = 0;
    put(tar, 124, '     5 ');
    const entries = readTar(tar);
    expect(entryText(entries[0]!)).toBe('hello');
  });

  it('treats an unreadable size field as zero rather than as NaN bytes', () => {
    const tar = makeTar([{ name: 'a.txt', data: 'hello' }]);
    for (let i = 0; i < 12; i++) tar[124 + i] = 0;
    put(tar, 124, 'zzzz');
    const entries = readTar(tar);
    expect(entries[0]!.data).toHaveLength(0);
  });
});
