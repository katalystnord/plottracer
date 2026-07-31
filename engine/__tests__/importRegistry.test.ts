/**
 * Tests for the import registry and the StarryDigitizer reader.
 *
 * The fixtures are built here from each format's structure — no third-party
 * project files are copied into this tree.
 */
import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import {
  identifyProject,
  unsupportedFileMessage,
  importDialogExtensions,
  IMPORT_FORMATS,
} from '../importRegistry.js';
import { isStarryProject, importStarryProject } from '../starryImport.js';

const enc = (s: string) => new TextEncoder().encode(s);

/** A 1x1 PNG — enough for the image entry to be real bytes. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

interface StarryOpts {
  axisSets?: unknown[];
  activeAxisSetId?: number;
  datasets?: unknown[];
  withImage?: boolean;
}

function starryAxisSet(id: number, name: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name,
    // sx = 100 + 50x, sy = 500 - 400y
    x1: { name: 'x1', value: 0, coord: { xPx: 100, yPx: 500 } },
    x2: { name: 'x2', value: 10, coord: { xPx: 600, yPx: 500 } },
    y1: { name: 'y1', value: 0, coord: { xPx: 100, yPx: 500 } },
    y2: { name: 'y2', value: 1, coord: { xPx: 100, yPx: 100 } },
    xIsLogScale: false,
    yIsLogScale: false,
    considerGraphTilt: true,
    ...over,
  };
}

/** Build a StarryDigitizer project archive from the format's structure. */
function makeStarry(o: StarryOpts = {}): Uint8Array {
  const {
    axisSets = [starryAxisSet(1, 'Axis Set 1')],
    activeAxisSetId = 1,
    datasets = [{ id: 1, name: 'Dataset 1', axisSetId: 1, points: [{ id: 1, xPx: 350, yPx: 300 }] }],
    withImage = true,
  } = o;
  const json = {
    version: '1.11.2',
    timestamp: '2026-07-28T00:00:00.000Z',
    axisSets,
    activeAxisSetId,
    datasets,
    activeDatasetId: 1,
    canvasHandler: { scale: 1, manualMode: 'add' },
  };
  const entries: Record<string, Uint8Array> = { 'project.json': strToU8(JSON.stringify(json)) };
  if (withImage) entries['image.png'] = PNG;
  return zipSync(entries);
}

/**
 * One of OUR project archives: the same container shape and the same entry
 * names StarryDigitizer uses, which is the whole point of the collision test.
 * Built here rather than through the real writer because the only thing that
 * separates the two formats is the marker key — `plotTracerProject`, whose
 * presence in real files is asserted by projectFile's own tests.
 */
function makeOurs(): Uint8Array {
  const json = {
    plotTracerProject: 1,
    plotData: { version: [4, 2], axesColl: [], datasetColl: [] },
    image: { path: 'image.png', mime: 'image/png' },
  };
  return zipSync({ 'project.json': strToU8(JSON.stringify(json)), 'image.png': PNG });
}

describe('identifyProject', () => {
  it('claims our own project archive as ours', () => {
    expect(identifyProject(makeOurs())?.id).toBe('plottracer');
  });

  it('claims a legacy bare-JSON project as ours', () => {
    expect(identifyProject(enc('  {"plotTracerProject":1}'))?.id).toBe('plottracer');
  });

  it('⚑ tells a StarryDigitizer archive from OURS, though both are zips holding project.json', () => {
    // REGRESSION for the collision the registry exists to handle: identical
    // container shape, identical entry names. Only a key inside project.json
    // separates them, so a magic-bytes-only sniff got this wrong and reported
    // "Project archive is missing its image reference".
    expect(identifyProject(makeStarry())?.id).toBe('starry');
    expect(identifyProject(makeOurs())?.id).toBe('plottracer');
  });

  it('claims a .tar archive as the format that ships in one', () => {
    // A minimal ustar header: the magic sits at offset 257, where the format
    // puts it, not in the filename.
    const tar = new Uint8Array(1024);
    tar.set(enc('ustar'), 257);
    expect(identifyProject(tar)?.id).toBe('wpd');
  });

  it('claims an Engauge document by its content', () => {
    const dig = enc('<?xml version="1.0"?>\n<!DOCTYPE engauge>\n<Document VersionNumber="11.0"></Document>');
    expect(identifyProject(dig)?.id).toBe('engauge');
  });

  it('returns null for a file no format claims', () => {
    expect(identifyProject(enc('just some text'))).toBeNull();
    expect(identifyProject(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull(); // a JPEG
  });

  it('does not decide anything from the filename — only the bytes', () => {
    // A zip whose project.json is StarryDigitizer's stays StarryDigitizer's
    // however it might be named on disk; there is no name to pass in at all.
    expect(identifyProject(makeStarry())?.id).toBe('starry');
  });
});

describe('unsupportedFileMessage', () => {
  it('names every format that DOES work rather than failing generically', () => {
    const msg = unsupportedFileMessage();
    for (const f of IMPORT_FORMATS) expect(msg).toContain(f.displayName);
  });
});

describe('importDialogExtensions', () => {
  it('offers every format’s extensions without duplicates', () => {
    const exts = importDialogExtensions();
    expect(new Set(exts).size).toBe(exts.length);
    expect(exts).toEqual(expect.arrayContaining(['zip', 'json', 'tar', 'dig']));
  });
});

describe('isStarryProject', () => {
  it('recognises their archive and declines ours', () => {
    expect(isStarryProject(makeStarry())).toBe(true);
    expect(isStarryProject(makeOurs())).toBe(false);
  });

  it('declines anything that is not a readable zip instead of throwing', () => {
    expect(isStarryProject(enc('not a zip'))).toBe(false);
    expect(isStarryProject(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(false);
  });
});

describe('importStarryProject', () => {
  it('reads the four calibration points back as the values they carry', () => {
    const r = importStarryProject(makeStarry());
    if ('error' in r) throw new Error(r.error);
    const px = r.datasets[0]!.getPixel(0); // pixel (350,300)
    const [x, y] = (r.axes as { pixelToData(a: number, b: number): number[] }).pixelToData(px.x, px.y);
    expect(x).toBeCloseTo(5, 8);
    expect(y).toBeCloseTo(0.5, 8);
    expect(r.configId).toBe('xy');
  });

  it('⚑ does not read whole-number axis values as dates', () => {
    // Same trap as the Engauge reader: Calibration parses its values as text and
    // InputParser tries a DATE first, so a bare number 0..23 becomes an
    // hour-of-day timestamp. Values here are 0, 10, 0 and 1 — all in the trap.
    const r = importStarryProject(makeStarry());
    if ('error' in r) throw new Error(r.error);
    const px = r.datasets[0]!.getPixel(0);
    const [x, y] = (r.axes as { pixelToData(a: number, b: number): number[] }).pixelToData(px.x, px.y);
    expect(Math.abs(x!)).toBeLessThan(1e6);
    expect(Math.abs(y!)).toBeLessThan(1e6);
  });

  it('carries the image and the series name', () => {
    const r = importStarryProject(makeStarry());
    if ('error' in r) throw new Error(r.error);
    expect(r.imageDataURL).toMatch(/^data:image\/png;base64,/);
    expect(r.datasets[0]!.name).toBe('Dataset 1');
  });

  it('opens the ACTIVE axis set and says the others were left behind', () => {
    const bytes = makeStarry({
      axisSets: [starryAxisSet(1, 'First'), starryAxisSet(2, 'Second')],
      activeAxisSetId: 2,
      datasets: [
        { id: 1, name: 'On first', axisSetId: 1, points: [{ id: 1, xPx: 350, yPx: 300 }] },
        { id: 2, name: 'On second', axisSetId: 2, points: [{ id: 2, xPx: 350, yPx: 300 }] },
      ],
    });
    const r = importStarryProject(bytes);
    if ('error' in r) throw new Error(r.error);
    // Only the active set's datasets come across — points belonging to another
    // calibration must not be placed against this one.
    expect(r.datasets.map((d) => d.name)).toEqual(['On second']);
    expect(r.notes.join(' ')).toMatch(/2 axis sets/i);
    expect(r.notes.join(' ')).toMatch(/Second/);
  });

  it('refuses a project whose axes are incomplete', () => {
    const broken = starryAxisSet(1, 'Broken') as Record<string, unknown>;
    delete broken['y2'];
    const r = importStarryProject(makeStarry({ axisSets: [broken] }));
    expect('error' in r && r.error).toMatch(/incomplete|four calibration points/i);
  });

  it('refuses a project with no axes at all', () => {
    const r = importStarryProject(makeStarry({ axisSets: [] }));
    expect('error' in r && r.error).toMatch(/no calibrated axes/i);
  });

  it('says so when the image is missing rather than opening a blank figure silently', () => {
    const r = importStarryProject(makeStarry({ withImage: false }));
    if ('error' in r) throw new Error(r.error);
    expect(r.imageDataURL).toBeNull();
    expect(r.notes.join(' ')).toMatch(/image could not be read/i);
  });

  it('reads a log axis on the decade it was calibrated with', () => {
    const logSet = starryAxisSet(1, 'Log', {
      y1: { name: 'y1', value: 1, coord: { xPx: 100, yPx: 500 } },
      y2: { name: 'y2', value: 100, coord: { xPx: 100, yPx: 100 } },
      yIsLogScale: true,
    });
    const r = importStarryProject(
      makeStarry({
        axisSets: [logSet],
        datasets: [{ id: 1, name: 'D', axisSetId: 1, points: [{ id: 1, xPx: 100, yPx: 300 }] }],
      })
    );
    if ('error' in r) throw new Error(r.error);
    const px = r.datasets[0]!.getPixel(0);
    const [, y] = (r.axes as { pixelToData(a: number, b: number): number[] }).pixelToData(px.x, px.y);
    expect(y).toBeCloseTo(10, 6);
  });
});

describe('StarryDigitizer: an absent considerGraphTilt (v1.5 gate)', () => {
  // ⚑ `considerGraphTilt` was read as `=== false`, so an ABSENT key meant "apply
  // rotation correction" -- the opposite of StarryDigitizer's own default, which
  // is `considerGraphTilt = false` (their src/domain/models/axisSet/axisSet.ts:20,
  // MIT, read for the FORMAT only). Absent must therefore mean NO correction.
  //
  // Every other Starry fixture here is axis-aligned, where the flag provably
  // cannot change a single value -- which is why inverting it left them all green.
  // These use a TILTED calibration, where it does.
  const tilted = (over: Record<string, unknown>) => ({
    id: 1,
    name: 'Tilted',
    // The y axis leans: y2 is offset in x as well, so the two axes are not
    // perpendicular and the correction has something to do.
    x1: { name: 'x1', value: 0, coord: { xPx: 100, yPx: 500 } },
    x2: { name: 'x2', value: 10, coord: { xPx: 600, yPx: 480 } },
    y1: { name: 'y1', value: 0, coord: { xPx: 100, yPx: 500 } },
    y2: { name: 'y2', value: 1, coord: { xPx: 140, yPx: 100 } },
    xIsLogScale: false,
    yIsLogScale: false,
    ...over,
  });

  const readAt = (axisSet: Record<string, unknown>) => {
    const r = importStarryProject(makeStarry({ axisSets: [axisSet] }));
    if ('error' in r) throw new Error(r.error);
    const px = r.datasets[0]!.getPixel(0);
    return (r.axes as { pixelToData(x: number, y: number): number[] }).pixelToData(px.x, px.y);
  };

  it('reads an absent flag exactly as an explicit false, which is their default', () => {
    const absent = readAt(tilted({}));
    const explicitFalse = readAt(tilted({ considerGraphTilt: false }));
    expect(absent[0]).toBeCloseTo(explicitFalse[0]!, 9);
    expect(absent[1]).toBeCloseTo(explicitFalse[1]!, 9);
  });

  it('and NOT as an explicit true — on a tilted figure the two really differ', () => {
    // Guards the test above from passing vacuously: if correction made no
    // difference here, the first assertion would prove nothing.
    const absent = readAt(tilted({}));
    const explicitTrue = readAt(tilted({ considerGraphTilt: true }));
    expect(Math.abs(absent[1]! - explicitTrue[1]!)).toBeGreaterThan(1e-6);
  });
});

/**
 * The StarryDigitizer reader's PER-FIELD guards.
 *
 * ⚑ WHY THIS BLOCK EXISTS. `starryImport.ts` scored 55.94% with 61 mutants
 * unnoticed, clustered in exactly the places the tests above step over: the
 * four-way calibration-point check, the per-coordinate type and finiteness
 * guards, dataset selection by axis set, and the image lookup.
 *
 * A foreign file is the one input we do not control the shape of. Tenet 6
 * puts all interoperability at the FILE level, which means this reader is
 * where another tool's model is translated into ours — and the translation
 * must refuse loudly rather than produce a figure whose numbers are quietly
 * wrong. Each guard below is the difference between those two outcomes.
 */
describe('StarryDigitizer: refusing an axis point it cannot read', () => {
  const withAxis = (over: Record<string, unknown>) =>
    importStarryProject(makeStarry({ axisSets: [starryAxisSet(1, 'A', over) as unknown] }));

  for (const which of ['x1', 'x2', 'y1', 'y2']) {
    it(`refuses when ${which} is missing entirely`, () => {
      // All FOUR are checked. Any one dropped from the condition lets a
      // calibration through with a garbage point, and the scale is then wrong
      // for every value in the file.
      const r = withAxis({ [which]: undefined });
      expect('error' in r && r.error).toMatch(/incomplete/i);
    });

    it(`refuses when ${which} has no coordinate`, () => {
      const r = withAxis({ [which]: { name: which, value: 5 } });
      expect('error' in r && r.error).toMatch(/incomplete/i);
    });
  }

  it('⚑ refuses a coordinate that is present but not a NUMBER', () => {
    // Their file is JSON, so a string "100" is what a hand-edited or
    // differently-versioned file plausibly holds. Coerced it would calibrate;
    // refused it says so.
    expect(
      'error' in withAxis({ x1: { name: 'x1', value: 0, coord: { xPx: '100', yPx: 500 } } })
    ).toBe(true);
    expect(
      'error' in withAxis({ x1: { name: 'x1', value: 0, coord: { xPx: 100, yPx: null } } })
    ).toBe(true);
  });

  it('refuses an axis VALUE that is not a number', () => {
    expect('error' in withAxis({ y2: { name: 'y2', value: '1', coord: { xPx: 100, yPx: 100 } } })).toBe(true);
  });

  it('⚑ refuses NaN and Infinity, which ARE numbers and would calibrate', () => {
    // `typeof` alone passes both. NaN would make every derived value NaN;
    // Infinity would make the scale zero. Neither is visible as an error
    // anywhere downstream.
    expect('error' in withAxis({ x2: { name: 'x2', value: Infinity, coord: { xPx: 600, yPx: 500 } } })).toBe(true);
    expect('error' in withAxis({ x2: { name: 'x2', value: 10, coord: { xPx: NaN, yPx: 500 } } })).toBe(true);
  });

  it('names the LOG scale specifically when a log calibration is what failed', () => {
    // Two different refusals share one code path; the log one has to name the
    // requirement, because "greater than zero" is the whole fix.
    const bad = starryAxisSet(1, 'Log', {
      y1: { name: 'y1', value: 0, coord: { xPx: 100, yPx: 500 } },
      y2: { name: 'y2', value: 100, coord: { xPx: 100, yPx: 100 } },
      yIsLogScale: true,
    });
    const r = importStarryProject(makeStarry({ axisSets: [bad as unknown] }));
    expect('error' in r && r.error).toMatch(/log/i);
    expect('error' in r && r.error).toMatch(/greater than zero/i);
  });
});

describe('StarryDigitizer: which datasets come across', () => {
  const twoSets = [starryAxisSet(1, 'First'), starryAxisSet(2, 'Second')];

  it('⚑ takes only the datasets bound to the axis set it opened', () => {
    // Carrying the others would place their points against a calibration that
    // is not theirs — the same numbers, silently read off the wrong scale.
    const r = importStarryProject(
      makeStarry({
        axisSets: twoSets,
        activeAxisSetId: 2,
        datasets: [
          { id: 1, name: 'On first', axisSetId: 1, points: [{ id: 1, xPx: 350, yPx: 300 }] },
          { id: 2, name: 'On second', axisSetId: 2, points: [{ id: 2, xPx: 350, yPx: 300 }] },
        ],
      })
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.datasets.map((d) => d.name)).toEqual(['On second']);
  });

  it('⚑ falls back to UNBOUND datasets only when none is bound to this set', () => {
    // Older files of theirs carry no axisSetId at all. The fallback must not
    // fire when bound datasets exist, or an unbound leftover joins them.
    const unbound = { id: 3, name: 'Unbound', points: [{ id: 3, xPx: 350, yPx: 300 }] };
    const withBound = importStarryProject(
      makeStarry({
        axisSets: twoSets,
        activeAxisSetId: 1,
        datasets: [{ id: 1, name: 'Bound', axisSetId: 1, points: [{ id: 1, xPx: 350, yPx: 300 }] }, unbound],
      })
    );
    if ('error' in withBound) throw new Error(withBound.error);
    expect(withBound.datasets.map((d) => d.name)).toEqual(['Bound']);

    const withoutBound = importStarryProject(
      makeStarry({ axisSets: twoSets, activeAxisSetId: 2, datasets: [unbound] })
    );
    if ('error' in withoutBound) throw new Error(withoutBound.error);
    expect(withoutBound.datasets.map((d) => d.name)).toEqual(['Unbound']);
  });

  it('always opens with at least one series, even when the file carries none', () => {
    const r = importStarryProject(makeStarry({ datasets: [] }));
    if ('error' in r) throw new Error(r.error);
    expect(r.datasets).toHaveLength(1);
    expect(r.datasets[0]!.name).toBe('Data');
    expect(r.datasets[0]!.getCount()).toBe(0);
  });

  it('gives a series with a blank or missing name a usable one', () => {
    const r = importStarryProject(
      makeStarry({
        datasets: [
          { id: 1, name: '', axisSetId: 1, points: [] },
          { id: 2, name: 7, axisSetId: 1, points: [] },
        ],
      })
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.datasets.map((d) => d.name)).toEqual(['Data', 'Data']);
  });

  it('⚑ SKIPS a point whose pixels it cannot read, rather than placing it at 0,0', () => {
    // A dropped point is a visible gap the user can fill; a point silently
    // parked at the origin is a wrong datum that looks placed.
    const r = importStarryProject(
      makeStarry({
        datasets: [
          {
            id: 1,
            name: 'D',
            axisSetId: 1,
            points: [
              { id: 1, xPx: 350, yPx: 300 },
              { id: 2, xPx: '350', yPx: 300 },
              { id: 3, xPx: NaN, yPx: 300 },
              { id: 4, xPx: 350 },
              { id: 5, xPx: 400, yPx: 320 },
            ],
          },
        ],
      })
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.datasets[0]!.getCount()).toBe(2);
    expect(r.datasets[0]!.getPixel(1)).toMatchObject({ x: 400, y: 320 });
  });

  it('handles a series with no points array at all', () => {
    const r = importStarryProject(makeStarry({ datasets: [{ id: 1, name: 'D', axisSetId: 1 }] }));
    if ('error' in r) throw new Error(r.error);
    expect(r.datasets[0]!.getCount()).toBe(0);
  });
});

describe('StarryDigitizer: finding the image', () => {
  function starryWithImage(entryName: string, bytes: Uint8Array = PNG): Uint8Array {
    const inner = unzipSync(makeStarry({ withImage: false }));
    return zipSync({ ...inner, [entryName]: bytes });
  }

  it('accepts the entry names their own reader accepts, with the right mime', () => {
    // Their writer emits image.png; their reader also takes jpg/jpeg, so we
    // take exactly the set they do — no more, so an unexpected entry is
    // reported rather than guessed at.
    for (const [name, mime] of [
      ['image.png', 'image/png'],
      ['image.jpg', 'image/jpeg'],
      ['image.jpeg', 'image/jpeg'],
    ] as const) {
      const r = importStarryProject(starryWithImage(name));
      if ('error' in r) throw new Error(r.error);
      expect(r.imageDataURL?.startsWith(`data:${mime};base64,`)).toBe(true);
    }
  });

  it('⚑ treats a zero-length entry as no image, and says so', () => {
    // An empty entry would otherwise become "data:image/png;base64," — a data
    // URL that resolves to nothing, giving a blank canvas with no note.
    const r = importStarryProject(starryWithImage('image.png', new Uint8Array(0)));
    if ('error' in r) throw new Error(r.error);
    expect(r.imageDataURL).toBeNull();
    expect(r.notes.join(' ')).toMatch(/image could not be read/i);
  });

  it('does not accept an entry under some other name', () => {
    const r = importStarryProject(starryWithImage('figure.png'));
    if ('error' in r) throw new Error(r.error);
    expect(r.imageDataURL).toBeNull();
  });

  it('⚑ encodes an image larger than one btoa chunk without losing bytes', () => {
    // The chunking exists because spreading a multi-megabyte array into
    // String.fromCharCode overflows the call stack. An off-by-one in the
    // stride corrupts the picture rather than throwing.
    const big = new Uint8Array(0x8000 + 777);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 0xff;
    const r = importStarryProject(starryWithImage('image.png', big));
    if ('error' in r) throw new Error(r.error);
    const b64 = r.imageDataURL!.split(',')[1]!;
    const decoded = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(big);
  });
});
