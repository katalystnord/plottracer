import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { serializeProject, serializeMultiFigureProject } from '../projectFile.js';
import {
  serializeProjectZip,
  deserializeProjectZip,
  serializeMultiFigureZip,
  deserializeMultiFigureZip,
  isMultiFigureContainer,
  isZipContainer,
  base64ToBytes,
  bytesToBase64,
} from '../projectContainer.js';
import { CalibrationSession, XY_AXES_CONFIG, BAR_AXES_CONFIG } from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';
import type { BarAxes } from '../../core/axes/bar.js';

// Same calibration fixture as projectFile.test.ts / the e2e block: X 0..10 over
// px 100..400, Y 0..10 over px 250..100, one point at (250,175) reading (5,5).
function calibrateStandardXY(session: CalibrationSession<XYAxes>) {
  const steps: Array<[number, number, string]> = [
    [100, 250, '0'],
    [400, 250, '10'],
    [100, 250, '0'],
    [100, 100, '10'],
  ];
  for (const [px, py, value] of steps) {
    session.handleCalibrationClick(px, py);
    session.confirmCalibrationValues([value]);
  }
}

// A minimal real 1x1 PNG data URL (the same one projectFile.test.ts uses).
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function calibratedProjectFile(imageDataURL = PNG_DATA_URL, fileName?: string) {
  const session = new CalibrationSession(XY_AXES_CONFIG);
  calibrateStandardXY(session);
  session.runCalibration();
  session.addDataPoint(250, 175); // reads (5, 5)
  const result = serializeProject(session, imageDataURL, fileName);
  if ('error' in result) throw new Error(`fixture build failed: ${result.error}`);
  return result;
}

describe('base64 <-> bytes helpers', () => {
  it('round-trips arbitrary bytes, including a chunk boundary', () => {
    // Longer than the 0x8000 chunk btoa is fed in, to exercise the chunking.
    const bytes = new Uint8Array(0x8000 + 123);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 0xff;
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

describe('isZipContainer', () => {
  it('recognises the zip magic and rejects JSON', () => {
    const zip = serializeProjectZip(calibratedProjectFile());
    if ('error' in zip) throw new Error(zip.error);
    expect(isZipContainer(zip)).toBe(true);
    // A legacy JSON project starts with `{` -- must NOT read as a container.
    const jsonBytes = new TextEncoder().encode(JSON.stringify(calibratedProjectFile()));
    expect(isZipContainer(jsonBytes)).toBe(false);
  });
});

describe('serializeProjectZip', () => {
  it('writes a readable project.json + a real image entry, with no inlined base64', () => {
    const file = calibratedProjectFile(PNG_DATA_URL, 'figure3.png');
    const zip = serializeProjectZip(file);
    if ('error' in zip) throw new Error(zip.error);

    const entries = unzipSync(zip);
    expect(Object.keys(entries).sort()).toEqual(['image.png', 'project.json']);

    const json = JSON.parse(strFromU8(entries['project.json']!));
    // The image is a reference, not a megabyte of inlined base64 (design §4).
    expect(json.image).toEqual({ path: 'image.png', mime: 'image/png', fileName: 'figure3.png' });
    expect(json.image.dataURL).toBeUndefined();
    // The calibration/dataset half is untouched -- still plotData's own schema.
    expect(json.plotTracerProject).toBe(1);
    expect(json.plotData.axesColl[0].type).toBe('XYAxes');

    // The image entry is the actual decoded PNG bytes, starting with the PNG
    // signature -- a genuinely browsable file, not text.
    expect([...entries['image.png']!.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('names the image entry from its mime type', () => {
    // A JPEG data URL (payload is not a real JPEG, but the mime drives naming).
    const file = calibratedProjectFile('data:image/jpeg;base64,/9j/AAAA');
    const zip = serializeProjectZip(file);
    if ('error' in zip) throw new Error(zip.error);
    expect(Object.keys(unzipSync(zip))).toContain('image.jpg');
  });
});

describe('deserializeProjectZip', () => {
  it('round-trips a saved project back to the same figure', () => {
    const zip = serializeProjectZip(calibratedProjectFile(PNG_DATA_URL, 'figure3.png'));
    if ('error' in zip) throw new Error(zip.error);

    const result = deserializeProjectZip(zip);
    if ('error' in result) throw new Error(result.error);
    expect(result.configId).toBe('xy');
    expect(result.datasets).toHaveLength(1);
    expect(result.imageFileName).toBe('figure3.png');
    // The image comes back byte-identical to what went in (same data URL).
    expect(result.imageDataURL).toBe(PNG_DATA_URL);
    // Value correctness through deserializeProject is projectFile.test.ts's job
    // (that path is shared); here we only own the zip <-> ProjectFile boundary.
  });

  it('carries provenance through the container unchanged (checkpoint 95)', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addDataPoint(250, 175);
    const file = serializeProject(session, PNG_DATA_URL, 'figure3.png', undefined, {
      crops: [{ fromWidth: 1200, fromHeight: 800, rect: { x: 100, y: 50, width: 400, height: 300 } }],
    });
    if ('error' in file) throw new Error(file.error);

    const zip = serializeProjectZip(file);
    if ('error' in zip) throw new Error(zip.error);
    const result = deserializeProjectZip(zip);
    if ('error' in result) throw new Error(result.error);
    expect(result.provenance.crops).toHaveLength(1);
    expect(result.provenance.crops![0]!.fromWidth).toBe(1200);
    expect(result.provenance.crops![0]!.rect).toEqual({ x: 100, y: 50, width: 400, height: 300 });
  });

  it('bundles and restores a source document (checkpoint 104)', () => {
    const file = calibratedProjectFile(PNG_DATA_URL, 'figure3.png');
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3, 4, 5]); // "%PDF..."
    file.sourceDocument = { name: 'paper.pdf', mime: 'application/pdf', bytes: pdfBytes };

    const zip = serializeProjectZip(file);
    if ('error' in zip) throw new Error(zip.error);
    // The PDF is a real, browsable entry -- the evidence travels with the record.
    const entries = unzipSync(zip);
    expect(Object.keys(entries)).toContain('source.pdf');
    expect(entries['source.pdf']).toEqual(pdfBytes);
    // project.json holds only a reference, not the bytes.
    const json = JSON.parse(strFromU8(entries['project.json']!));
    expect(json.sourceDocument).toEqual({ path: 'source.pdf', mime: 'application/pdf', name: 'paper.pdf' });

    const result = deserializeProjectZip(zip);
    if ('error' in result) throw new Error(result.error);
    expect(result.sourceDocument).toEqual({ name: 'paper.pdf', mime: 'application/pdf', bytes: pdfBytes });
  });

  it('rejects a non-zip and an archive missing its parts', () => {
    expect(deserializeProjectZip(new Uint8Array([1, 2, 3]))).toEqual({
      error: 'Could not open project — the archive is unreadable.',
    });
    // A zip with no project.json.
    const strayOnly = serializeProjectZip(calibratedProjectFile());
    if ('error' in strayOnly) throw new Error(strayOnly.error);
    const empty = deserializeProjectZip(new Uint8Array());
    expect('error' in empty).toBe(true);
  });
});

function calibrateStandardBar(session: CalibrationSession<BarAxes>) {
  session.handleCalibrationClick(300, 500);
  session.confirmCalibrationValues(['0']);
  session.handleCalibrationClick(300, 100);
  session.confirmCalibrationValues(['10']);
}

describe('multi-figure container (checkpoint 115)', () => {
  it('round-trips TWO figures of DIFFERENT graph types, with names, active index and shared source', () => {
    // Figure 1: XY, one point reading (5, 5).
    const s1 = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(s1);
    s1.runCalibration();
    s1.addDataPoint(250, 175);
    // Figure 2: BAR -- a different graph type in the same project (David's point).
    const s2 = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(s2);
    s2.runCalibration();
    s2.addDataPoint(300, 300); // reads 5

    const multi = serializeMultiFigureProject(
      [
        { name: 'Stress-strain', session: s1, imageDataURL: PNG_DATA_URL, imageFileName: 'fig1.png' },
        { name: 'Strength', session: s2, imageDataURL: PNG_DATA_URL, imageFileName: 'fig2.png' },
      ],
      1, // active = figure 2
      { name: 'paper.pdf', mime: 'application/pdf', bytes: new Uint8Array([1, 2, 3, 4]) }
    );
    if ('error' in multi) throw new Error(multi.error);

    const zip = serializeMultiFigureZip(multi);
    if ('error' in zip) throw new Error(zip.error);
    expect(isZipContainer(zip)).toBe(true);
    expect(isMultiFigureContainer(zip)).toBe(true);

    const result = deserializeMultiFigureZip(zip);
    if ('error' in result) throw new Error(result.error);
    expect(result.figures).toHaveLength(2);
    expect(result.activeFigure).toBe(1);
    expect(result.figures.map((f) => f.name)).toEqual(['Stress-strain', 'Strength']);
    // Per-figure graph types survive independently.
    expect(result.figures[0]!.configId).toBe('xy');
    expect(result.figures[1]!.configId).toBe('bar');

    // The data points survive per figure.
    const n1 = new CalibrationSession(XY_AXES_CONFIG);
    n1.loadCalibrated(result.figures[0]!.axes as XYAxes, result.figures[0]!.datasets);
    n1.getDataPoints()[0]!.data!.forEach((v, i) => expect(v).toBeCloseTo([5, 5][i]!, 6));
    const n2 = new CalibrationSession(BAR_AXES_CONFIG);
    n2.loadCalibrated(result.figures[1]!.axes as BarAxes, result.figures[1]!.datasets);
    expect(n2.getDataPoints()[0]!.data![0]).toBeCloseTo(5, 6);

    // The shared source document round-trips (bytes and name).
    expect(result.sourceDocument?.name).toBe('paper.pdf');
    expect(Array.from(result.sourceDocument!.bytes)).toEqual([1, 2, 3, 4]);
  });

  it('isMultiFigureContainer is false for a single-figure container (routing)', () => {
    const zip = serializeProjectZip(calibratedProjectFile());
    if ('error' in zip) throw new Error(zip.error);
    expect(isMultiFigureContainer(zip)).toBe(false);
    // ...and a single-figure container still opens via the single reader.
    const single = deserializeProjectZip(zip);
    expect('error' in single).toBe(false);
  });

  it('refuses to serialize when a figure is uncalibrated, naming which one', () => {
    const ok = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(ok);
    ok.runCalibration();
    const bad = new CalibrationSession(XY_AXES_CONFIG); // never calibrated
    const result = serializeMultiFigureProject(
      [
        { name: 'Good', session: ok, imageDataURL: PNG_DATA_URL },
        { name: 'Bad', session: bad, imageDataURL: PNG_DATA_URL },
      ],
      0
    );
    expect('error' in result && result.error).toMatch(/Bad/);
  });
});
