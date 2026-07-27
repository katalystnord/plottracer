import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTar, entryText } from '../tarRead.js';
import { isTarArchive, isZipContainer } from '../projectContainer.js';

/**
 * Checkpoint 74 — the tar reader that lets us open a real WPD project.
 *
 * The archive under test is built by the **system `tar`**, not hand-crafted to
 * match this reader. A fixture written by the same understanding it verifies
 * proves nothing; the whole risk here is misreading the format.
 *
 * It is shaped exactly like WPD's own output (`services/saveResume.js:78-85`):
 * `<project>/info.json` + `<project>/wpd.json` + image files — and `wpd.json`
 * is a genuine upstream fixture (`engine/__tests__/fixtures/wpd/wpd4.json`).
 */
describe('tarRead (checkpoint 74)', () => {
  let tarBytes: Uint8Array;
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plottracer-tar-'));
    const proj = path.join(dir, 'myproject');
    fs.mkdirSync(proj);
    const repoRoot = path.resolve(__dirname, '../..');
    fs.copyFileSync(path.join(repoRoot, 'engine/__tests__/fixtures/wpd/wpd4.json'), path.join(proj, 'wpd.json'));
    fs.writeFileSync(path.join(proj, 'info.json'), '{"version":[4,0],"json":"wpd.json","images":["figure.png"]}');
    fs.copyFileSync(path.join(repoRoot, 'samples/errorbar-tensile-cure.png'), path.join(proj, 'figure.png'));
    execFileSync('tar', ['-cf', 'wpd-project.tar', 'myproject/'], { cwd: dir });
    tarBytes = new Uint8Array(fs.readFileSync(path.join(dir, 'wpd-project.tar')));
  });

  it('reads every entry a real system-written tar contains', () => {
    const names = readTar(tarBytes).map((e) => e.name).sort();
    expect(names).toEqual(['myproject/', 'myproject/figure.png', 'myproject/info.json', 'myproject/wpd.json']);
  });

  it('distinguishes the directory from the files', () => {
    const entries = readTar(tarBytes);
    expect(entries.find((e) => e.name === 'myproject/')!.type).toBe('directory');
    expect(entries.find((e) => e.name === 'myproject/wpd.json')!.type).toBe('file');
  });

  it('recovers wpd.json byte-for-byte — it must still parse as WPD JSON', () => {
    const entry = readTar(tarBytes).find((e) => e.name === 'myproject/wpd.json')!;
    const parsed = JSON.parse(entryText(entry));
    // The real test: the recovered text is a working WPD project.
    expect(parsed.version).toEqual([4, 0]);
    expect(parsed.axesColl.map((a: { type: string }) => a.type)).toContain('XYAxes');
    expect(parsed.datasetColl.length).toBeGreaterThan(0);
  });

  it('recovers a BINARY file exactly — PNG magic and byte length intact', () => {
    // Binary is where an off-by-one in the 512-byte padding would show up.
    const entry = readTar(tarBytes).find((e) => e.name === 'myproject/figure.png')!;
    const original = fs.readFileSync(path.join(dir, 'myproject', 'figure.png'));
    expect(entry.data.length).toBe(original.length);
    expect(Array.from(entry.data.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(Buffer.from(entry.data).equals(original)).toBe(true);
  });

  it('reads info.json, which names the json and the images', () => {
    const entry = readTar(tarBytes).find((e) => e.name === 'myproject/info.json')!;
    expect(JSON.parse(entryText(entry))).toEqual({ version: [4, 0], json: 'wpd.json', images: ['figure.png'] });
  });

  it('stops at the end-of-archive marker rather than reading padding as entries', () => {
    expect(readTar(tarBytes)).toHaveLength(4);
  });

  it('throws on a truncated archive instead of returning half a project', () => {
    // Silently returning partial data would surface later as mysteriously
    // missing points -- the exact silent-wrong-output failure to avoid, and
    // this is the one path where we read someone else's bytes.
    expect(() => readTar(tarBytes.subarray(0, 1024))).toThrow(/archive ends first/);
  });

  it('returns nothing for an empty archive rather than throwing', () => {
    expect(readTar(new Uint8Array(1024))).toEqual([]);
  });
});

/**
 * Regression: names containing spaces.
 *
 * The first reader stopped a name at 0x20 — correct for tar's octal numeric
 * fields, wrong for names, where a space is ordinary. "myproject" hid it;
 * "my paper fig3" truncated to "my" and the archive read as corrupt. Real
 * project folders have spaces, so this is the realistic case, not an edge one.
 */
describe('tarRead — names with spaces', () => {
  it('reads a path containing spaces without truncating at the space', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plottracer-space-'));
    fs.mkdirSync(path.join(dir, 'my paper fig3'));
    fs.writeFileSync(path.join(dir, 'my paper fig3', 'wpd.json'), '{"version":[4,0]}');
    execFileSync('tar', ['-cf', 's.tar', 'my paper fig3/'], { cwd: dir });
    const entries = readTar(new Uint8Array(fs.readFileSync(path.join(dir, 's.tar'))));
    expect(entries.map((e) => e.name).sort()).toEqual(['my paper fig3/', 'my paper fig3/wpd.json']);
    expect(entryText(entries.find((e) => e.name.endsWith('wpd.json'))!)).toBe('{"version":[4,0]}');
  });
});

/**
 * The container sniff that lets ONE "Open Project" read every format we support
 * (v1.4).
 *
 * ⚑ A foreign digitizer's archive used to arrive through a dialog, an IPC channel,
 * a file filter and a menu item of its own, every one of them naming a single tool.
 * That is the first-class status tenet 5 rules out — and, as David put it, a
 * functional link IN advertises a functional link OUT that cannot exist: a third of
 * what we now record (spider spokes and their per-axis scales, point roles, box
 * tuples) has nowhere to go in that format. One door, and the FILE says what it is.
 */
describe('isTarArchive — the container sniff behind one Open Project', () => {
  /** A REAL tar, written by tar(1), so the magic under test is the genuine one. */
  function realTar(): Uint8Array {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-tar-sniff-'));
    fs.mkdirSync(path.join(dir, 'proj'));
    fs.writeFileSync(path.join(dir, 'proj', 'info.json'), '{}');
    execFileSync('tar', ['-cf', 'p.tar', 'proj/'], { cwd: dir });
    return new Uint8Array(fs.readFileSync(path.join(dir, 'p.tar')));
  }

  it('recognises a tar by its ustar magic, not by any file name', () => {
    expect(isTarArchive(realTar())).toBe(true);
  });

  it('does not mistake our own zip project for one', () => {
    // The two live in the same dialog now, so telling them apart is load-bearing.
    const zip = new Uint8Array(300);
    zip.set([0x50, 0x4b, 0x03, 0x04], 0);
    expect(isTarArchive(zip)).toBe(false);
    expect(isZipContainer(zip)).toBe(true);
    expect(isZipContainer(realTar())).toBe(false);
  });

  it('does not mistake a legacy JSON project for one', () => {
    const json = new TextEncoder().encode(JSON.stringify({ plotTracerProject: 1 }).padEnd(400, ' '));
    expect(isTarArchive(json)).toBe(false);
  });

  it('refuses anything too short to carry the magic, without throwing', () => {
    expect(isTarArchive(new Uint8Array(0))).toBe(false);
    expect(isTarArchive(new Uint8Array(261))).toBe(false);
  });
});
