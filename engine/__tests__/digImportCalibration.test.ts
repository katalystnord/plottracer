import { describe, expect, it } from 'vitest';
import { readEngaugeProject, importEngaugeFigure } from '../digImport.js';

/**
 * The Engauge reader's CALIBRATION RECONSTRUCTION - finding the "L" in a set
 * of axis points, and refusing arrangements that cannot fix a scale.
 *
 * ⚑ WHY THIS FILE EXISTS. `digImport.ts` carries 169 surviving mutants, the
 * largest pool left, and they cluster in `buildXYCalibration` (lines 452–497)
 * - the function that turns another tool's axis points into our Calibration.
 * The existing suite reads the ORDINARY three-point L; nothing exercised the
 * four-sides mode, the degenerate arrangements, or the search that pairs the
 * points up.
 *
 * Every defect here is a silent wrong number, which is the worst kind (tenet
 * 1): the file imports, the figure appears, and every value is read off a
 * scale that means something else. The refusals matter as much as the
 * successes - the function returns null so the caller can say it cannot read
 * the file, rather than importing a calibration that is quietly wrong.
 */

const enc = (s: string) => new TextEncoder().encode(s);

interface Pt { sx: number; sy: number; gx: number; gy: number; xOnly?: boolean }

/** A `.dig` document with exactly the axis points given. */
function digWith(axisPoints: Pt[], opts: { scaleX?: string; scaleY?: string } = {}): Uint8Array {
  const { scaleX = 'Linear', scaleY = 'Linear' } = opts;
  const axisXml = axisPoints
    .map(
      (p) =>
        `<Point IsAxisPoint="True" IsXOnly="${p.xOnly ? 'True' : 'False'}">` +
        `<PositionScreen X="${p.sx}" Y="${p.sy}"/><PositionGraph X="${p.gx}" Y="${p.gy}"/></Point>`
    )
    .join('');
  const body =
    `<Coords Type="0" TypeString="Cartesian" ScaleXThetaString="${scaleX}" ScaleYRadiusString="${scaleY}" ` +
    `UnitsThetaString="Degrees (DDD.DDDDD)"/>` +
    `<Curve CurveName="Axes"><CurvePoints>${axisXml}</CurvePoints></Curve>` +
    `<CurvesGraphs><Curve CurveName="Curve1"><CurvePoints>` +
    `<Point><PositionScreen X="350" Y="300"/></Point>` +
    `</CurvePoints></Curve></CurvesGraphs>`;
  return enc(
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE engauge>\n` +
      `<Document VersionNumber="11.0"><CoordSystem>${body}</CoordSystem></Document>`
  );
}

function importOf(axisPoints: Pt[], opts: { scaleX?: string; scaleY?: string } = {}) {
  const project = readEngaugeProject(digWith(axisPoints, opts));
  if ('error' in project) throw new Error(`fixture unreadable: ${project.error}`);
  return importEngaugeFigure(project);
}

/** Read the one curve point back through the imported calibration. */
function readPoint(axisPoints: Pt[], opts: { scaleX?: string; scaleY?: string } = {}): number[] {
  const fig = importOf(axisPoints, opts);
  if ('error' in fig) throw new Error(fig.error);
  const px = fig.datasets[0]!.getPixel(0);
  return (fig.axes as unknown as { pixelToData(a: number, b: number): number[] }).pixelToData(px.x, px.y);
}

/** The ordinary L: (0,0) and (10,0) fix X; (0,0) and (0,1) fix Y. */
const L: Pt[] = [
  { sx: 100, sy: 500, gx: 0, gy: 0 },
  { sx: 600, sy: 500, gx: 10, gy: 0 },
  { sx: 100, sy: 100, gx: 0, gy: 1 },
];

describe('the three-point L', () => {
  it('reads a point back on the scale the file describes', () => {
    // 350px is halfway across 100..600 -> x = 5; 300px is halfway up
    // 500..100 -> y = 0.5.
    const [x, y] = readPoint(L);
    expect(x).toBeCloseTo(5, 6);
    expect(y).toBeCloseTo(0.5, 6);
  });

  it('⚑ finds the pairs whatever ORDER the file lists them in', () => {
    // The search is a double loop over all points; a file is under no
    // obligation to list the corner first. Reversed, the same figure must
    // read the same numbers.
    const [x, y] = readPoint([...L].reverse());
    expect(x).toBeCloseTo(5, 6);
    expect(y).toBeCloseTo(0.5, 6);
  });

  it('pairs on the GRAPH coordinates, not the screen ones', () => {
    // A rotated/skewed figure has axis points that share neither screen x nor
    // screen y, but still share graph values. Pairing on screen would find
    // nothing here.
    const skewed: Pt[] = [
      { sx: 100, sy: 500, gx: 0, gy: 0 },
      { sx: 600, sy: 480, gx: 10, gy: 0 },
      { sx: 120, sy: 100, gx: 0, gy: 1 },
    ];
    const fig = importOf(skewed);
    expect('error' in fig).toBe(false);
  });
});

describe('the four-sides mode, where the file separates the pairs itself', () => {
  const fourSides: Pt[] = [
    { sx: 100, sy: 500, gx: 0, gy: 0, xOnly: true },
    { sx: 600, sy: 500, gx: 10, gy: 0, xOnly: true },
    { sx: 100, sy: 500, gx: 0, gy: 0 },
    { sx: 100, sy: 100, gx: 0, gy: 1 },
  ];

  it('⚑ takes IsXOnly as the pairing, needing no L to be found', () => {
    // Engauge's four-sides mode marks the X pair explicitly. These points
    // need no reconstruction, and using the L search on them would be
    // guessing at something the file already states.
    const [x, y] = readPoint(fourSides);
    expect(x).toBeCloseTo(5, 6);
    expect(y).toBeCloseTo(0.5, 6);
  });

  it('needs FOUR points before it trusts the marking', () => {
    // Two marked points and nothing else cannot fix both scales; the reader
    // must fall through to the L search rather than build half a calibration.
    const twoOnly: Pt[] = [
      { sx: 100, sy: 500, gx: 0, gy: 0, xOnly: true },
      { sx: 600, sy: 500, gx: 10, gy: 0, xOnly: true },
    ];
    expect('error' in importOf(twoOnly)).toBe(true);
  });

  it('falls back to the L search when only ONE point is marked', () => {
    const oneMarked: Pt[] = [
      { sx: 100, sy: 500, gx: 0, gy: 0, xOnly: true },
      { sx: 600, sy: 500, gx: 10, gy: 0 },
      { sx: 100, sy: 100, gx: 0, gy: 1 },
    ];
    const [x] = readPoint(oneMarked);
    expect(x).toBeCloseTo(5, 6);
  });
});

describe('arrangements it must REFUSE rather than import wrongly', () => {
  it('⚑ refuses COLLINEAR axis points, which fix no second direction', () => {
    // Three points along one line: the two difference vectors are parallel,
    // so there is no invertible transform. Imported anyway, every value would
    // be null or NaN with the figure looking fine.
    const collinear: Pt[] = [
      { sx: 100, sy: 500, gx: 0, gy: 0 },
      { sx: 300, sy: 500, gx: 5, gy: 0 },
      { sx: 600, sy: 500, gx: 10, gy: 0 },
    ];
    expect('error' in importOf(collinear)).toBe(true);
  });

  it('refuses two points, which cannot fix two scales', () => {
    expect('error' in importOf(L.slice(0, 2))).toBe(true);
  });

  it('refuses a document with no axis points at all', () => {
    expect('error' in importOf([])).toBe(true);
  });

  it('⚑ refuses points that share a graph Y but never a graph X', () => {
    // An X pair with no Y pair: half a calibration. The Y scale would have to
    // be invented.
    const noYPair: Pt[] = [
      { sx: 100, sy: 500, gx: 0, gy: 0 },
      { sx: 600, sy: 500, gx: 10, gy: 0 },
      { sx: 350, sy: 300, gx: 5, gy: 0 },
    ];
    expect('error' in importOf(noYPair)).toBe(true);
  });

  it('refuses a pair that shares BOTH coordinates - the same point twice', () => {
    const duplicate: Pt[] = [
      { sx: 100, sy: 500, gx: 0, gy: 0 },
      { sx: 600, sy: 500, gx: 0, gy: 0 },
      { sx: 100, sy: 100, gx: 0, gy: 1 },
    ];
    expect('error' in importOf(duplicate)).toBe(true);
  });
});

describe('more axis points than the four that are needed', () => {
  it('⚑ SAYS how many it found and that four were used', () => {
    // Silence here would look like the extra points had been taken into
    // account. Engauge lets a user place many; we use the four that fix the
    // scales and report it.
    const many: Pt[] = [
      ...L,
      { sx: 600, sy: 100, gx: 10, gy: 1 },
      { sx: 350, sy: 300, gx: 5, gy: 0.5 },
    ];
    const fig = importOf(many);
    if ('error' in fig) throw new Error(fig.error);
    expect(fig.notes.join(' ')).toMatch(/5 axis points/i);
    expect(fig.notes.join(' ')).toMatch(/four/i);
  });

  it('says nothing when exactly the needed points are present', () => {
    const fig = importOf(L);
    if ('error' in fig) throw new Error(fig.error);
    expect(fig.notes.join(' ')).not.toMatch(/axis points/i);
  });

  it('still reads the right numbers with the extra points present', () => {
    const many: Pt[] = [...L, { sx: 600, sy: 100, gx: 10, gy: 1 }];
    const [x, y] = readPoint(many);
    expect(x).toBeCloseTo(5, 6);
    expect(y).toBeCloseTo(0.5, 6);
  });
});

describe('log scales come through the reconstruction', () => {
  it('reads a decade correctly rather than linearly', () => {
    const logY: Pt[] = [
      { sx: 100, sy: 500, gx: 0, gy: 1 },
      { sx: 600, sy: 500, gx: 10, gy: 1 },
      { sx: 100, sy: 100, gx: 0, gy: 1000 },
    ];
    // 300px is halfway up three decades -> 10^1.5.
    const [, y] = readPoint(logY, { scaleY: 'Log' });
    expect(y).toBeCloseTo(Math.pow(10, 1.5), 3);
  });

  it('⚑ refuses a log axis whose reconstructed endpoints reach zero', () => {
    // The same refusal the model gained on 2026-07-31: log(0) is -Infinity,
    // and the importer checks calibrate()'s answer, so it must surface here.
    const logThroughZero: Pt[] = [
      { sx: 100, sy: 500, gx: 0, gy: 0 },
      { sx: 600, sy: 500, gx: 10, gy: 0 },
      { sx: 100, sy: 100, gx: 0, gy: 1000 },
    ];
    const fig = importOf(logThroughZero, { scaleY: 'Log' });
    expect('error' in fig).toBe(true);
  });
});

/**
 * ⚑ AN IMPORTED POLAR FIGURE MUST READ, not merely open.
 *
 * The 2026-07-31 audit found that no test anywhere asserted a VALUE read back
 * from an imported polar `.dig` - only the notes, the unit conversion and the
 * refusals. The fixture behind those tests was doubly degenerate (both radial
 * points at the same declared radius AND the same pixel distance from the
 * centre), so `dist20 - dist10` and `r2 - r1` were both zero and every reading
 * was NaN. Everything stayed green, because nothing looked.
 *
 * This is the missing assertion. It is the project's own rule restated: a test
 * that checks the SHAPE of an import proves the file parsed, not that the
 * numbers are right.
 */
describe('an imported polar figure reads real values', () => {
  function polarDig(thetaDeg: number): Uint8Array {
    // Centre (100,100); 100px out is r=10, 200px out is r=20.
    const pts = [
      { sx: 100, sy: 100, gx: 0, gy: 0 },
      { sx: 200, sy: 100, gx: thetaDeg, gy: 10 },
      { sx: 300, sy: 100, gx: thetaDeg * 2, gy: 20 },
    ];
    const axisXml = pts
      .map(
        (p) =>
          `<Point IsAxisPoint="True" IsXOnly="False">` +
          `<PositionScreen X="${p.sx}" Y="${p.sy}"/><PositionGraph X="${p.gx}" Y="${p.gy}"/></Point>`
      )
      .join('');
    const body =
      `<Coords Type="0" TypeString="Polar" ScaleXThetaString="Linear" ScaleYRadiusString="Linear" ` +
      `UnitsThetaString="Degrees (DDD.DDDDD)"/>` +
      `<Curve CurveName="Axes"><CurvePoints>${axisXml}</CurvePoints></Curve>` +
      `<CurvesGraphs><Curve CurveName="Curve1"><CurvePoints>` +
      // 150px east of the centre - halfway between the two calibration radii.
      `<Point><PositionScreen X="250" Y="100"/></Point>` +
      `</CurvePoints></Curve></CurvesGraphs>`;
    return enc(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE engauge>\n` +
        `<Document VersionNumber="11.0"><CoordSystem>${body}</CoordSystem></Document>`
    );
  }

  it('⚑ reads the RADIUS off the two calibration radii, not as a constant', () => {
    // 150px out, between r=10 at 100px and r=20 at 200px, is r=15. A
    // degenerate calibration returns the same number everywhere instead.
    const project = readEngaugeProject(polarDig(0));
    if ('error' in project) throw new Error(project.error);
    const fig = importEngaugeFigure(project);
    if ('error' in fig) throw new Error(fig.error);
    const px = fig.datasets[0]!.getPixel(0);
    const [r] = (fig.axes as unknown as { pixelToData(a: number, b: number): number[] }).pixelToData(px.x, px.y);
    expect(r).toBeCloseTo(15, 6);
  });

  it('refuses a polar file whose two radial points declare the SAME radius', () => {
    // Our model derives the radial scale from the difference; with none there
    // is no scale, and opening it would read one constant everywhere.
    const flat = polarDig(45)
      .reduce((s, b) => s + String.fromCharCode(b), '')
      .replace('X="300" Y="100"/><PositionGraph X="90" Y="20"', 'X="300" Y="100"/><PositionGraph X="90" Y="10"');
    const project = readEngaugeProject(enc(flat));
    if ('error' in project) throw new Error(project.error);
    expect('error' in importEngaugeFigure(project)).toBe(true);
  });
});
