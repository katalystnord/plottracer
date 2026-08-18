import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PieAxes } from '../axes/pie.js';
import { Calibration } from '../calibration.js';

/**
 * The bundled pie examples, read against their OWN committed ground truth.
 *
 * ⚑ THIS IS THE INSTRUMENT, and the reason it exists is the spider: fifteen green
 * e2e once passed over a trace that read a run's MIDPOINT, because every one of them
 * invented its own geometry and then agreed with itself. A test that makes up its
 * numbers proves self-consistency, not truth.
 *
 * What makes this one different is that the two sides were computed INDEPENDENTLY -
 * `samples/generators/gen_samples.py` laid the figures out and wrote down where it
 * put every boundary; `core/axes/pie.ts` reads those pixels back with completely
 * separate arithmetic in a different language. Agreement between them is evidence.
 */

const SAMPLES = path.resolve(__dirname, '../../samples');

interface Anchor { px: number; py: number }
interface SliceTruth {
  index: number;
  exploded: boolean;
  apex: Anchor;
  startEdge: Anchor;
  endEdge: Anchor;
}
interface PieTruth {
  tilted?: boolean;
  total: number;
  sweep: number;
  explodedCategory?: string;
  calibration: { anchors: { centre: Anchor; rim: Anchor; outline: Anchor[] }; slices: SliceTruth[] };
  series: { points: { category: string; value: number }[] }[];
}

function loadTruth(name: string): PieTruth {
  return JSON.parse(fs.readFileSync(path.join(SAMPLES, `${name}.truth.json`), 'utf8')) as PieTruth;
}

/** Calibrate exactly as the app does - from OUTLINE points only, with the centre and
 * radius fitted through them. Nothing here clicks a centre, because on a donut there
 * is none to click. */
function axesFor(truth: PieTruth, tilted = truth.tilted ?? false): PieAxes {
  const cal = new Calibration(2);
  for (const p of truth.calibration.anchors.outline) cal.addPoint(p.px, p.py, '', '');
  const axes = new PieAxes();
  expect(axes.calibrate(cal, truth.total, truth.sweep, tilted)).toBe(true);
  return axes;
}

/** The truth records pixels as {px,py}; the model's apex argument is {x,y}. Converted
 * in one place rather than at each call -- getting this wrong reads `undefined` and
 * every value comes back NaN (which is exactly what happened first time, and is the
 * kind of slip vitest cannot see because it does not typecheck). */
function apexOf(a: Anchor): { x: number; y: number } {
  return { x: a.px, y: a.py };
}

/** Read every slice back, each about ITS OWN apex - which is the shared centre for
 * an ordinary slice and the slice's own tip for an exploded one. */
function readValues(truth: PieTruth): number[] {
  const axes = axesFor(truth);
  return truth.calibration.slices.map((s) =>
    axes.sectorValue(
      axes.angleAt(s.startEdge.px, s.startEdge.py, apexOf(s.apex)),
      axes.angleAt(s.endEdge.px, s.endEdge.py, apexOf(s.apex)),
      truth.total
    )
  );
}

describe.each([
  ['pie-filler-composition', 'a perfectly circular pie'],
  ['pie-exploded-market-share', 'a pie with one slice pulled out'],
  ['donut-donut-flavours', 'a donut, in real units with the total in the hole'],
  ['pie-tilted-market-segments', 'a TILTED pie - a 3D chart\'s top face'],
])('%s - %s', (name) => {
  it('reads every slice back to the value it was drawn from', () => {
    const truth = loadTruth(name);
    const expected = truth.series[0]!.points.map((p) => p.value);
    const got = readValues(truth);
    expect(got).toHaveLength(expected.length);
    got.forEach((v, i) => {
      // ⚑ RELATIVE, not absolute: these figures differ by four orders of magnitude
      // (percentages vs 2500 kSEK), so one absolute tolerance cannot serve both.
      // 1e-4 is far tighter than any measurement and still leaves headroom over the
      // real floor, which is the TRUTH's own rounding -- it stores pixels to two
      // decimals, and the model reproduces it to about 3e-5. Anything worse than this
      // is arithmetic, not aim: these are exact anchors, not a human's clicks.
      const rel = Math.abs(v - expected[i]!) / Math.abs(expected[i]!);
      expect(rel, `slice ${i} (${truth.series[0]!.points[i]!.category}): ${v} vs ${expected[i]}`).toBeLessThan(1e-4);
    });
  });

  it('accounts for the whole figure', () => {
    // Not a check on the app's closure -- it is a check that the EXAMPLE draws a
    // complete pie, so a slice quietly missing from the truth would show up here.
    const truth = loadTruth(name);
    const sum = readValues(truth).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - truth.total) / truth.total).toBeLessThan(1e-4);
  });
});

describe('the exploded slice is why the apex matters', () => {
  it('misreads badly when measured against the shared centre instead', () => {
    // ⚑ The whole reason `angleAt` takes an apex. A pulled-out slice is TRANSLATED,
    // so its edges no longer point at the pie's centre; measuring them from there is
    // wrong by roughly (d/r)·sin(half-angle) per edge, and the two edges err in
    // OPPOSITE directions so the errors add. This asserts the failure is LARGE --
    // if someone ever "simplifies" angleAt to always use the centre, the sample tests
    // above would fail, and this says by how much and why.
    const truth = loadTruth('pie-exploded-market-share');
    const axes = axesFor(truth);
    const slice = truth.calibration.slices.find((s) => s.exploded)!;
    const truthful = truth.series[0]!.points[slice.index]!.value;

    const naive = axes.sectorValue(
      axes.angleAt(slice.startEdge.px, slice.startEdge.py),
      axes.angleAt(slice.endEdge.px, slice.endEdge.py),
      truth.total
    );
    expect(truthful).toBeCloseTo(27, 6);
    // Several points of share, on a figure where every number is a percentage.
    expect(Math.abs(naive - truthful)).toBeGreaterThan(2);
  });

  it('leaves the UNEXPLODED slices unaffected either way', () => {
    // The apex only matters where the slice actually moved -- eight of the nine other
    // slices across these figures share the centre, which is why this is a per-slice
    // exception rather than a mode the figure is in.
    const truth = loadTruth('pie-exploded-market-share');
    const axes = axesFor(truth);
    for (const s of truth.calibration.slices.filter((x) => !x.exploded)) {
      const withApex = axes.sectorValue(
        axes.angleAt(s.startEdge.px, s.startEdge.py, apexOf(s.apex)),
        axes.angleAt(s.endEdge.px, s.endEdge.py, apexOf(s.apex)),
        truth.total
      );
      const withCentre = axes.sectorValue(
        axes.angleAt(s.startEdge.px, s.startEdge.py),
        axes.angleAt(s.endEdge.px, s.endEdge.py),
        truth.total
      );
      expect(withApex).toBeCloseTo(withCentre, 9);
    }
  });
});

describe('the fitted centre', () => {
  it('lands on the real centre without ever being clicked', () => {
    // ⚑ The point of outline-first. The generator knows where it put the centre; the
    // app never sees that number and reconstructs it from four rim points alone.
    for (const name of ['pie-filler-composition', 'pie-exploded-market-share', 'donut-donut-flavours']) {
      const truth = loadTruth(name);
      const axes = axesFor(truth);
      const fitted = axes.getCentre();
      const real = truth.calibration.anchors.centre;
      expect(Math.hypot(fitted.x - real.px, fitted.y - real.py), `${name} centre`).toBeLessThan(0.05);
      // ...and the radius with it, which is what the boundary clicks are measured at.
      const realRadius = Math.hypot(real.px - truth.calibration.anchors.rim.px, real.py - truth.calibration.anchors.rim.py);
      expect(Math.abs(axes.getRadius() - realRadius), `${name} radius`).toBeLessThan(0.05);
    }
  });

  it('reports a residual of essentially zero for a true circle', () => {
    // A property of the FIGURE, not of the fit: a rim that will not sit on a circle
    // is telling you the pie is tilted. These are drawn as circles, so it is ~0.
    const axes = axesFor(loadTruth('pie-filler-composition'));
    expect(axes.getFitResidual()).toBeLessThan(0.05);
  });
});

describe('the donut', () => {
  it('is read by the same calibration despite its inner radius', () => {
    // ⚑ The angle is scale-invariant, which is exactly what lets ONE calibration read
    // every ring of a donut regardless of circumference -- and why the record is the
    // angle and not the arc length.
    const truth = loadTruth('donut-donut-flavours');
    expect(truth.total).toBe(2500);
    const values = readValues(truth);
    expect(Math.abs(values[0]! - 820) / 820).toBeLessThan(1e-4); // Glazed, and rightly so
  });

  it('needs a total that is NOT the prefilled 100', () => {
    // The figure prints 2500 in its hole. Left at the default, every reading would be
    // a percentage of a number the figure never claimed.
    const truth = loadTruth('donut-donut-flavours');
    const axes = axesFor(truth);
    const s = truth.calibration.slices[0]!;
    const asPercent = axes.sectorValue(
      axes.angleAt(s.startEdge.px, s.startEdge.py, apexOf(s.apex)),
      axes.angleAt(s.endEdge.px, s.endEdge.py, apexOf(s.apex)),
      100
    );
    expect(asPercent).toBeCloseTo(32.8, 3); // 820 / 2500
  });
});

describe('the tilted pie is why the affine inverse matters', () => {
  it('recovers the true values from a squashed, rotated figure', () => {
    // ⚑ The figure is a circle under an affine map - squashed to 55% and rotated 18°.
    // The fitted ellipse's semi-axes ARE the images of two orthogonal circle radii, so
    // reading the angle in that basis inverts the projection implicitly. No
    // un-rotating, no un-squashing, no second code path.
    const truth = loadTruth('pie-tilted-market-segments');
    expect(truth.tilted).toBe(true);
    const got = readValues(truth);
    truth.series[0]!.points.forEach((p, i) => {
      expect(Math.abs(got[i]! - p.value) / p.value, `${p.category}`).toBeLessThan(1e-4);
    });
  });

  it('is BADLY wrong when read as a flat circle - and still sums to 100', () => {
    // ⚑ The whole danger of this chart type. Every slice is wrong, no slice looks
    // wrong, and the total reassures you. This is the number that moved the ellipse
    // into v1.6 rather than leaving it as a nicety for photographed figures.
    const truth = loadTruth('pie-tilted-market-segments');
    const flat = axesFor(truth, false); // deliberately NOT inverting the projection
    const naive = truth.calibration.slices.map((s) =>
      flat.sectorValue(
        flat.angleAt(s.startEdge.px, s.startEdge.py, apexOf(s.apex)),
        flat.angleAt(s.endEdge.px, s.endEdge.py, apexOf(s.apex)),
        truth.total
      )
    );
    const truthful = truth.series[0]!.points.map((p) => p.value);
    const worst = Math.max(...naive.map((v, i) => Math.abs(v - truthful[i]!)));
    expect(worst).toBeGreaterThan(3); // percentage points, on a figure of percentages
    // ...and the reassuring part: it still adds up.
    expect(naive.reduce((a, b) => a + b, 0)).toBeCloseTo(truth.total, 6);
  });
});

/**
 * ⚑⚑ A TILTED PIE READS ITS OWN TOTAL AND SWEEP - v2.0 audit, round 2.
 *
 * `PieAxes.calibrate`'s tilted branch returned true BEFORE the two lines that
 * assign `defaultTotal` and `sweep`, so a tilted or 3D pie kept the field
 * initialisers (100 and 2π) and every sector was scaled by 100/total - a
 * tilted half-pie halved every value. `derivedTupleValue` reads exactly those
 * two fields, so this was wrong at CAPTURE time, not only across a round trip,
 * and the slices still summed to the (wrong) total so nothing on screen looked
 * wrong. ~12% of real pie figures in the corpus are 3D.
 */
describe('a tilted pie keeps the total and sweep it was given', () => {
  /** Six points on an ellipse - enough for the five-parameter tilted fit. */
  function tiltedPie(total: number, sweepDeg: number): PieAxes {
    const cal = new Calibration(2);
    for (const [x, y] of [
      [450, 300],
      [300, 400],
      [150, 300],
      [300, 200],
      [406, 371],
      [194, 229],
    ] as Array<[number, number]>) {
      cal.addPoint(x, y, '0', '0');
    }
    const axes = new PieAxes();
    expect(axes.calibrate(cal, total, sweepDeg, true)).toBe(true);
    return axes;
  }

  it('⚑ keeps a donut’s printed TOTAL rather than falling back to 100', () => {
    // The documented primary use: "type the total printed in a donut's hole".
    expect(tiltedPie(184, 360).getDefaultTotal()).toBe(184);
  });

  it('⚑ keeps a HALF pie’s sweep rather than assuming a full circle', () => {
    // Assumed 360, every value in a half pie or a gauge is halved.
    expect(tiltedPie(100, 180).getSweep()).toBeCloseTo(Math.PI, 9);
  });

  it('agrees with the FLAT path, which is the contract the tilted one broke', () => {
    const cal = new Calibration(2);
    for (const [x, y] of [
      [450, 300],
      [300, 450],
      [150, 300],
      [300, 150],
    ] as Array<[number, number]>) {
      cal.addPoint(x, y, '0', '0');
    }
    const flat = new PieAxes();
    expect(flat.calibrate(cal, 184, 180, false)).toBe(true);
    expect(tiltedPie(184, 180).getDefaultTotal()).toBe(flat.getDefaultTotal());
    expect(tiltedPie(184, 180).getSweep()).toBeCloseTo(flat.getSweep(), 9);
  });

  it('still refuses a tilted calibration with too few points to fit an ellipse', () => {
    // The guard must not have been traded away for the assignment.
    const cal = new Calibration(2);
    for (const [x, y] of [[450, 300], [300, 450], [150, 300]] as Array<[number, number]>) {
      cal.addPoint(x, y, '0', '0');
    }
    expect(new PieAxes().calibrate(cal, 184, 180, true)).toBe(false);
  });
});
