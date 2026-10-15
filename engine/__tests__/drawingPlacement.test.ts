/**
 * v2.7 V19 (docs/v2.7-vector-cases.md): "Given a vector figure that is
 * cropped, rotated, flipped or deskewed after capture, everything read from the
 * drawing lands on the same place in the picture as before the edit."
 *
 * ⚑ THE RECORD IS THE INSTRUMENT. Each test draws one dot, runs the app's own
 * pixel operations on it (the ones the Image card calls), and asks whether the
 * edits AS RECORDED - nothing but what a project file holds - carry the dot's
 * old position onto the dot's new ink. A record that cannot do that cannot
 * place a line read from the drawing either.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyImageEditOp, cropImage, rotateImageByAngle, type ImageEditResult } from '../imageEdit.js';
import { pageToImage, placeThroughEdits, type ImageEdit } from '../drawingPlacement.js';
import { serializeProject, deserializeProject, type Provenance } from '../projectFile.js';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';

const W = 80, H = 50;
/** A white picture with one black 3x3 dot whose centre is (37.5, 21.5). */
function picture(): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 20; y <= 22; y++) for (let x = 36; x <= 38; x++) {
    const i = (y * W + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 0;
  }
  return { data, width: W, height: H };
}
const DOT = { x: 37.5, y: 21.5 };

/** A calibrated XY session, so the project can be saved at all. */
function calibrated() {
  const session = new CalibrationSession(XY_AXES_CONFIG);
  for (const [px, py, v] of [[100, 250, '0'], [400, 250, '10'], [100, 250, '0'], [100, 100, '10']] as const) {
    session.handleCalibrationClick(px, py);
    session.confirmCalibrationValues([v]);
  }
  session.runCalibration();
  return session;
}

/** The ink's centre, weighted by darkness, in continuous pixel coordinates. */
function inkCentre(img: { data: Uint8ClampedArray; width: number; height: number }): { x: number; y: number } {
  let sx = 0, sy = 0, sw = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 4;
    if (img.data[i + 3]! < 128) continue; // transparent corners of a deskew
    const w = 255 - img.data[i]!;
    if (w < 8) continue;
    sx += w * (x + 0.5); sy += w * (y + 0.5); sw += w;
  }
  return { x: sx / sw, y: sy / sw };
}

type Step = { edit: ImageEdit; run: (img: { data: Uint8ClampedArray; width: number; height: number }) => ImageEditResult };
const crop = (rect: { x: number; y: number; width: number; height: number }) => (w: number, h: number): Step => ({
  edit: { kind: 'crop', fromWidth: w, fromHeight: h, rect },
  run: (img) => cropImage(img.data, img.width, img.height, rect)!,
});
const op = (kind: 'rotate-cw' | 'rotate-ccw' | 'flip-h' | 'flip-v') => (w: number, h: number): Step => ({
  edit: { kind, fromWidth: w, fromHeight: h },
  run: (img) => applyImageEditOp(kind, img.data, img.width, img.height),
});
const deskew = (deg: number) => (w: number, h: number): Step => ({
  edit: { kind: 'rotate', deg, fromWidth: w, fromHeight: h },
  run: (img) => rotateImageByAngle(img.data, img.width, img.height, deg),
});

/** Run the edits for real and return the picture plus the record they leave. */
function edit(steps: ((w: number, h: number) => Step)[]) {
  let img = picture();
  const edits: ImageEdit[] = [];
  for (const make of steps) {
    const s = make(img.width, img.height);
    const r = s.run(img);
    edits.push(s.edit);
    img = { data: r.data, width: r.width, height: r.height };
  }
  return { img, edits };
}

function expectOnInk(steps: ((w: number, h: number) => Step)[], tol = 0.5) {
  const { img, edits } = edit(steps);
  const at = placeThroughEdits(edits, DOT);
  const ink = inkCentre(img);
  expect(Math.hypot(at.x - ink.x, at.y - ink.y)).toBeLessThan(tol);
}

describe('V19: what is read from the drawing lands on the same ink after an image edit', () => {
  it('after a crop', () => expectOnInk([crop({ x: 10, y: 5, width: 50, height: 40 })]));
  it('after a rotate clockwise', () => expectOnInk([op('rotate-cw')]));
  it('after a rotate anticlockwise', () => expectOnInk([op('rotate-ccw')]));
  it('after a flip left to right', () => expectOnInk([op('flip-h')]));
  it('after a flip upside down', () => expectOnInk([op('flip-v')]));
  it('after a deskew', () => expectOnInk([deskew(7)], 0.75));
  it('after several edits, in the order they were made', () =>
    expectOnInk([crop({ x: 4, y: 2, width: 70, height: 44 }), op('rotate-cw'), deskew(-3), op('flip-h'), crop({ x: 3, y: 6, width: 40, height: 60 })], 0.75));

  it('the edits survive saving and reopening the project', () => {
    const { img, edits } = edit([crop({ x: 10, y: 5, width: 50, height: 40 }), op('rotate-ccw'), deskew(4)]);
    const session = calibrated();
    const written = serializeProject(session, 'data:image/png;base64,AAAA', undefined, undefined, { edits });
    if ('error' in written) throw new Error(written.error);
    const back = deserializeProject(JSON.parse(JSON.stringify(written)));
    if ('error' in back) throw new Error(back.error);
    const at = placeThroughEdits(back.provenance.edits ?? [], DOT);
    const ink = inkCentre(img);
    expect(Math.hypot(at.x - ink.x, at.y - ink.y)).toBeLessThan(0.75);
  });

  it('a crop is still cited as a crop', () => {
    // The status bar's "cropped from W×H" reads the crops; a crop recorded as an
    // edit must still say so after a reopen.
    const { edits } = edit([crop({ x: 10, y: 5, width: 50, height: 40 })]);
    const session = calibrated();
    const written = serializeProject(session, 'data:image/png;base64,AAAA', undefined, undefined, { edits });
    if ('error' in written) throw new Error(written.error);
    const back = deserializeProject(JSON.parse(JSON.stringify(written)));
    if ('error' in back) throw new Error(back.error);
    expect(back.provenance.edits?.filter((e) => e.kind === 'crop')).toHaveLength(1);
  });
});

describe('V19: a point of the PDF page lands where pdf.js drew it', () => {
  type VP = { width: number; height: number; transform: number[]; convertToViewportPoint(x: number, y: number): number[] };
  let viewport: VP;
  let pageTransform: [number, number, number, number, number, number];
  const pts: [number, number][] = [[0, 0], [100, 200], [400, 700]];
  beforeAll(async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const bytes = new Uint8Array(readFileSync(join(__dirname, '../../samples/multipage-figures.pdf')));
    const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    viewport = page.getViewport({ scale: 3.7 }) as unknown as VP;
    pageTransform = viewport.transform as [number, number, number, number, number, number];
  });

  it('on the page as rendered', () => {
    const prov: Provenance = { source: { name: 'multipage-figures.pdf', page: 1, pageTransform } };
    for (const p of pts) {
      const [x, y] = viewport.convertToViewportPoint(p[0], p[1]) as [number, number];
      const at = pageToImage(prov, p);
      expect(at).not.toBeNull();
      expect(Math.hypot(at!.x - x, at!.y - y)).toBeLessThan(1e-6);
    }
  });

  it('after the figure is captured (a crop of the page)', () => {
    const rect = { x: 200, y: 300, width: 1200, height: 900 };
    const prov: Provenance = {
      source: { name: 'multipage-figures.pdf', page: 1, pageTransform },
      edits: [{ kind: 'crop', fromWidth: Math.ceil(viewport.width), fromHeight: Math.ceil(viewport.height), rect }],
    };
    for (const p of pts) {
      const [x, y] = viewport.convertToViewportPoint(p[0], p[1]) as [number, number];
      const at = pageToImage(prov, p);
      expect(Math.hypot(at!.x - (x - 200), at!.y - (y - 300))).toBeLessThan(1e-6);
    }
  });

  it('is not offered for a picture that did not come from a PDF', () => {
    expect(pageToImage({}, [10, 10])).toBeNull();
  });
});
