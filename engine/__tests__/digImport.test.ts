/**
 * Tests for the Engauge `.dig` reader.
 *
 * ⚑ EVERY FIXTURE IN THIS FILE IS OURS, authored from the format's structure.
 * Engauge is GPL-2.0 and its test corpus is GPL-2.0 data, so none of it is
 * copied into this tree — see engine/digImport.ts's clean-room header and
 * __tests__/fixtures/PROVENANCE.md.
 */
import { describe, it, expect } from 'vitest';
import { isEngaugeDocument, readEngaugeProject, importEngaugeFigure } from '../digImport.js';

const enc = (s: string) => new TextEncoder().encode(s);

/** A 1x1 PNG, wrapped the way a .dig wraps its image: a short framing header
 * before the image's own magic number. */
function imagePayload(): string {
  const png = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89,
  ];
  const framed = [0x00, 0x00, 0x00, 0x01, ...png];
  let bin = '';
  for (const b of framed) bin += String.fromCharCode(b);
  return btoa(bin);
}

interface DigOpts {
  type?: string;
  scaleX?: string;
  scaleY?: string;
  axisPoints?: { sx: number; sy: number; gx: number; gy: number; xOnly?: boolean }[];
  curves?: { name: string; pts: [number, number][] }[];
  withImage?: boolean;
  version?: string;
  flat?: boolean;
  errorReport?: boolean;
  thetaUnits?: string;
  /** How many sibling <CoordSystem> elements the document holds. */
  systems?: number;
}

/** Build a `.dig` document from the format's structure. */
function makeDig(o: DigOpts = {}): Uint8Array {
  const {
    type = 'Cartesian',
    scaleX = 'Linear',
    scaleY = 'Linear',
    // The default is the ordinary "L": (0,0) and (10,0) fix X, (0,0) and (0,1) fix Y.
    axisPoints = [
      { sx: 100, sy: 500, gx: 0, gy: 0 },
      { sx: 600, sy: 500, gx: 10, gy: 0 },
      { sx: 100, sy: 100, gx: 0, gy: 1 },
    ],
    curves = [{ name: 'Curve1', pts: [[100, 100] as [number, number], [600, 500] as [number, number]] }],
    withImage = true,
    version = '11.0',
    flat = false,
    errorReport = false,
    thetaUnits = 'Degrees (DDD.DDDDD)',
    systems = 1,
  } = o;

  const axisXml = axisPoints
    .map(
      (p) =>
        `<Point IsAxisPoint="True" IsXOnly="${p.xOnly ? 'True' : 'False'}">` +
        `<PositionScreen X="${p.sx}" Y="${p.sy}"/><PositionGraph X="${p.gx}" Y="${p.gy}"/></Point>`
    )
    .join('');
  const curvesXml = curves
    .map(
      (c) =>
        `<Curve CurveName="${c.name}"><CurvePoints>` +
        c.pts.map(([x, y]) => `<Point><PositionScreen X="${x}" Y="${y}"/></Point>`).join('') +
        `</CurvePoints></Curve>`
    )
    .join('');
  const image = withImage ? `<Image Width="640" Height="480"><![CDATA[${imagePayload()}]]></Image>` : '';
  const coords =
    `<Coords Type="0" TypeString="${type}" ScaleXThetaString="${scaleX}" ScaleYRadiusString="${scaleY}" ` +
    `UnitsThetaString="${thetaUnits}"/>`;
  const body =
    coords + `<Curve CurveName="Axes"><CurvePoints>${axisXml}</CurvePoints></Curve>` +
    `<CurvesGraphs>${curvesXml}</CurvesGraphs>`;
  // `flat` reproduces the Engauge 6.3 shape, where there is no CoordSystem wrapper.
  // Real files hold repeated <CoordSystem> SIBLINGS under <Document> -- there is
  // no <CoordSystems> wrapper in the format (verified against all 47 .dig files
  // in Engauge's own test corpus, five of which carry five systems each).
  const inner = flat
    ? body
    : Array.from({ length: systems }, () => `<CoordSystem>${body}</CoordSystem>`).join('');
  const doc = `<Document VersionNumber="${version}">${image}${inner}</Document>`;
  const root = errorReport ? `<ErrorReport><Application VersionNumber="${version}"/>${doc}</ErrorReport>` : doc;
  return enc(`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE engauge>\n${root}`);
}

/** Read a curve point back through the imported calibration. */
function dataAt(bytes: Uint8Array, curve: number, index: number): number[] {
  const parsed = readEngaugeProject(bytes);
  if ('error' in parsed) throw new Error(parsed.error);
  const imported = importEngaugeFigure(parsed);
  if ('error' in imported) throw new Error(imported.error);
  const px = imported.datasets[curve]!.getPixel(index);
  return (imported.axes as { pixelToData(x: number, y: number): number[] }).pixelToData(px.x, px.y);
}

describe('isEngaugeDocument', () => {
  it('recognises an Engauge XML document by its content', () => {
    expect(isEngaugeDocument(makeDig())).toBe(true);
  });

  it('does not claim files that are not Engauge documents', () => {
    expect(isEngaugeDocument(enc('{"plotTracerProject":1}'))).toBe(false);
    expect(isEngaugeDocument(enc('<?xml version="1.0"?><svg></svg>'))).toBe(false);
    expect(isEngaugeDocument(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
  });
});

describe('readEngaugeProject', () => {
  it('refuses the pre-6.3 binary format by name instead of failing as bad XML', () => {
    // The Qt serialization is full of NUL bytes; XML never is.
    const binary = new Uint8Array([0x00, 0x00, 0x40, 0x05, 0x00, 0x2e, 0x00, 0x32]);
    const r = readEngaugeProject(binary);
    expect('error' in r && r.error).toMatch(/binary format/i);
    expect('error' in r && r.error).toMatch(/6\.3/);
  });

  it('reads the coordinate system, axis points and curves', () => {
    const r = readEngaugeProject(makeDig());
    if ('error' in r) throw new Error(r.error);
    expect(r.coordsType).toBe('Cartesian');
    expect(r.version).toBe('11.0');
    expect(r.axisPoints).toHaveLength(3);
    expect(r.curves).toHaveLength(1);
    expect(r.curves[0]!.name).toBe('Curve1');
    expect(r.curves[0]!.points).toEqual([{ x: 100, y: 100 }, { x: 600, y: 500 }]);
  });

  it('extracts the image, skipping the framing header before the PNG magic', () => {
    const r = readEngaugeProject(makeDig());
    if ('error' in r) throw new Error(r.error);
    expect(r.imageDataURL).toMatch(/^data:image\/png;base64,/);
    // The payload must begin at the PNG magic, not at the framing bytes.
    const b64 = r.imageDataURL!.split(',')[1]!;
    expect(atob(b64).slice(0, 4)).toBe('\x89PNG');
    expect(r.imageSize).toEqual({ width: 640, height: 480 });
  });

  it('reads a document wrapped in an ErrorReport', () => {
    const r = readEngaugeProject(makeDig({ errorReport: true }));
    if ('error' in r) throw new Error(r.error);
    expect(r.axisPoints).toHaveLength(3);
    expect(r.curves).toHaveLength(1);
  });

  it('reads the flat Engauge 6.3 layout that has no CoordSystem wrapper', () => {
    const r = readEngaugeProject(makeDig({ flat: true, version: '6.3' }));
    if ('error' in r) throw new Error(r.error);
    expect(r.coordsType).toBe('Cartesian');
    expect(r.axisPoints).toHaveLength(3);
  });

  it('notes log scales rather than silently treating them as linear', () => {
    const r = readEngaugeProject(makeDig({ scaleY: 'Log' }));
    if ('error' in r) throw new Error(r.error);
    expect(r.isLogY).toBe(true);
    expect(r.isLogX).toBe(false);
  });
});

describe('importEngaugeFigure — calibration', () => {
  it('reads a point that sits on an axis point back as that axis point', () => {
    // The third axis point is pixel (100,100) = graph (0,1); Curve1's first
    // point is on that same pixel, so it must import as exactly (0, 1).
    const [x, y] = dataAt(makeDig(), 0, 0);
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(1, 10);
  });

  it('reads the far corner back as the values that fix the scales', () => {
    const [x, y] = dataAt(makeDig(), 0, 1); // pixel (600,500)
    expect(x).toBeCloseTo(10, 10);
    expect(y).toBeCloseTo(0, 10);
  });

  it('⚑ does NOT read whole-number axis values as dates', () => {
    // REGRESSION. Calibration parses its values as text, and InputParser tries a
    // DATE first: a bare number 0..23 parses as an hour-of-day, so passing
    // numbers turned axis values 0, 1 and 10 into 2026 timestamps and produced
    // coordinates around 1.78e12. Verified failing before the fix.
    const [x, y] = dataAt(makeDig(), 0, 1);
    expect(Math.abs(x!)).toBeLessThan(1e6);
    expect(Math.abs(y!)).toBeLessThan(1e6);
  });

  it('handles a four-sided document, where the file marks the X pair itself', () => {
    const bytes = makeDig({
      axisPoints: [
        { sx: 100, sy: 500, gx: 0, gy: 0, xOnly: true },
        { sx: 600, sy: 500, gx: 10, gy: 0, xOnly: true },
        { sx: 350, sy: 500, gx: 0, gy: 0 },
        { sx: 350, sy: 100, gx: 0, gy: 1 },
      ],
      curves: [{ name: 'C', pts: [[600, 100]] }],
    });
    const [x, y] = dataAt(bytes, 0, 0);
    expect(x).toBeCloseTo(10, 8);
    expect(y).toBeCloseTo(1, 8);
  });

  it('rebuilds an equivalent calibration when the three points do not form an L', () => {
    // Same affine map as the default fixture, but stated with a third point that
    // shares neither coordinate — the general case. The imported VALUES must be
    // identical, because three correspondences determine the map uniquely.
    // No two points share a graph X or a graph Y, so there is no "L" to find.
    // All three lie on the same map as the default fixture: sx = 100 + 50x,
    // sy = 500 - 400y.
    const bytes = makeDig({
      axisPoints: [
        { sx: 150, sy: 400, gx: 1, gy: 0.25 },
        { sx: 450, sy: 300, gx: 7, gy: 0.5 },
        { sx: 300, sy: 200, gx: 4, gy: 0.75 },
      ],
      curves: [{ name: 'C', pts: [[350, 300]] }],
    });
    const [x, y] = dataAt(bytes, 0, 0);
    expect(x).toBeCloseTo(5, 8);
    expect(y).toBeCloseTo(0.5, 8);

    const parsed = readEngaugeProject(bytes);
    if ('error' in parsed) throw new Error(parsed.error);
    const imported = importEngaugeFigure(parsed);
    if ('error' in imported) throw new Error(imported.error);
    // The user is told the calibration was restated, not left to discover it.
    expect(imported.notes.join(' ')).toMatch(/rebuilt|reference points/i);
  });

  it('reads a log axis on the decade it was calibrated with', () => {
    const bytes = makeDig({
      scaleY: 'Log',
      axisPoints: [
        { sx: 100, sy: 500, gx: 0, gy: 1 },
        { sx: 600, sy: 500, gx: 10, gy: 1 },
        { sx: 100, sy: 100, gx: 0, gy: 100 },
      ],
      // Halfway up the pixel range is one decade up on a log axis: 10.
      curves: [{ name: 'C', pts: [[100, 300]] }],
    });
    const [, y] = dataAt(bytes, 0, 0);
    expect(y).toBeCloseTo(10, 6);
  });
});

describe('importEngaugeFigure — refusals and honesty', () => {
  it('refuses a project that was never calibrated', () => {
    const parsed = readEngaugeProject(makeDig({ axisPoints: [] }));
    if ('error' in parsed) throw new Error(parsed.error);
    const r = importEngaugeFigure(parsed);
    expect('error' in r && r.error).toMatch(/no axis points|never calibrated/i);
  });

  it('refuses a half-calibrated project rather than inventing the missing scale', () => {
    const parsed = readEngaugeProject(
      makeDig({ axisPoints: [{ sx: 100, sy: 500, gx: 0, gy: 0 }, { sx: 600, sy: 500, gx: 10, gy: 0 }] })
    );
    if ('error' in parsed) throw new Error(parsed.error);
    const r = importEngaugeFigure(parsed);
    expect('error' in r && r.error).toMatch(/do not fix an X and a Y/i);
  });

  it('keeps every named curve, including one with no points', () => {
    const parsed = readEngaugeProject(
      makeDig({ curves: [{ name: 'Full', pts: [[200, 200]] }, { name: 'Empty', pts: [] }] })
    );
    if ('error' in parsed) throw new Error(parsed.error);
    const r = importEngaugeFigure(parsed);
    if ('error' in r) throw new Error(r.error);
    expect(r.datasets.map((d) => d.name)).toEqual(['Full', 'Empty']);
    expect(r.datasets[1]!.getCount()).toBe(0);
  });

  it('says so when the image could not be read instead of opening a blank figure silently', () => {
    const parsed = readEngaugeProject(makeDig({ withImage: false }));
    if ('error' in parsed) throw new Error(parsed.error);
    const r = importEngaugeFigure(parsed);
    if ('error' in r) throw new Error(r.error);
    expect(r.imageDataURL).toBeNull();
    expect(r.notes.join(' ')).toMatch(/image could not be read/i);
  });
});

describe('importEngaugeFigure — polar', () => {
  it('imports a polar document, finding the centre by its zero radius', () => {
    // theta in graph X, radius in graph Y. Centre at (400,400), 50px per unit
    // of radius: r=10 lies 500px away, r=5 lies 250px away. The two radial
    // points must differ in radius or there is no radial scale to recover.
    const bytes = makeDig({
      type: 'Polar',
      axisPoints: [
        { sx: 400, sy: 400, gx: 0, gy: 0 },
        { sx: 900, sy: 400, gx: 0, gy: 10 },
        { sx: 400, sy: 650, gx: -90, gy: 5 },
      ],
      curves: [{ name: 'P', pts: [[900, 400]] }],
    });
    const parsed = readEngaugeProject(bytes);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.coordsType).toBe('Polar');
    const r = importEngaugeFigure(parsed);
    if ('error' in r) throw new Error(r.error);
    expect(r.configId).toBe('polar');
    const px = r.datasets[0]!.getPixel(0);
    const [radius] = (r.axes as { pixelToData(x: number, y: number): number[] }).pixelToData(px.x, px.y);
    expect(radius).toBeCloseTo(10, 6);
  });

  it('refuses a polar document with no centre point', () => {
    const parsed = readEngaugeProject(
      makeDig({
        type: 'Polar',
        axisPoints: [
          { sx: 900, sy: 400, gx: 0, gy: 10 },
          { sx: 400, sy: 900, gx: -90, gy: 5 },
        ],
      })
    );
    if ('error' in parsed) throw new Error(parsed.error);
    const r = importEngaugeFigure(parsed);
    expect('error' in r && r.error).toMatch(/centre point/i);
  });
});

describe('a document holding several coordinate systems (v1.5 gate blocker)', () => {
  // ⚑ The disclosure was keyed on a `<CoordSystems>` WRAPPER ELEMENT that does not
  // exist in the format -- it appears in Engauge's C++ only as a typedef, and in
  // none of the 47 real .dig files. So `extraCoordSystems` was permanently 0 and a
  // multi-system document was reduced to its first, silently. Measured on the real
  // corpus: version7.1_1.dig holds [68,43,35,30,17] points across five systems and
  // imported 65 of them with `notes: []`.
  it('counts the sibling systems it did not open', () => {
    const parsed = readEngaugeProject(makeDig({ systems: 3 }));
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.extraCoordSystems).toBe(2);
  });

  it('SAYS SO on import rather than dropping the rest quietly', () => {
    const parsed = readEngaugeProject(makeDig({ systems: 3 }));
    if ('error' in parsed) throw new Error(parsed.error);
    const imported = importEngaugeFigure(parsed);
    if ('error' in imported) throw new Error(imported.error);
    expect(imported.notes.join(' ')).toMatch(/3 coordinate systems/);
    expect(imported.notes.join(' ')).toMatch(/not imported/);
  });

  it('says nothing at all about an ordinary single-system document', () => {
    const parsed = readEngaugeProject(makeDig());
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.extraCoordSystems).toBe(0);
    const imported = importEngaugeFigure(parsed);
    if ('error' in imported) throw new Error(imported.error);
    expect(imported.notes.join(' ')).not.toMatch(/coordinate system/);
  });
});

describe('polar theta units (v1.5 gate blocker)', () => {
  // ⚑ The unit test was `.startsWith('Degrees')`, so the four Degrees variants and
  // Radians were right and GRADIANS and TURNS silently took the radians branch: a
  // point whose true theta is 0/360 exported as 49.21 (gradians) or 5.62 (turns).
  // Engauge writes exactly one of Degrees…/Gradians/Radians/Turns, verbatim.
  const polar = (thetaUnits: string, theta: number) =>
    makeDig({
      type: 'Polar',
      thetaUnits,
      // Centre, then TWO points at a known radius -- what a polar calibration
      // needs -- with theta in the file's own units.
      axisPoints: [
        { sx: 100, sy: 100, gx: 0, gy: 0 },
        { sx: 200, sy: 100, gx: theta, gy: 10 },
        { sx: 100, sy: 200, gx: theta * 2, gy: 10 },
      ],
      curves: [{ name: 'Curve1', pts: [[200, 100] as [number, number]] }],
    });

  // 45° is 50 gradians is 0.125 turns is π/4 radians -- the same angle four ways,
  // so all four must place the calibration point identically.
  const cases: [string, number][] = [
    ['Degrees (DDD.DDDDD)', 45],
    ['Gradians', 50],
    ['Turns', 0.125],
    ['Radians', Math.PI / 4],
  ];

  it('reads the same angle whichever way the file spells its unit', () => {
    // Degrees and radians keep the file's OWN unit (our polar axes read both);
    // gradians and turns have no native form, so they arrive as degrees. What
    // must hold either way is the ANGLE, not the number -- so compare in degrees.
    for (const [units, theta] of cases) {
      const parsed = readEngaugeProject(polar(units, theta));
      if ('error' in parsed) throw new Error(parsed.error);
      const x = parsed.axisPoints[1]!.graph.x;
      const degrees = parsed.thetaInDegrees ? x : (x * 180) / Math.PI;
      expect(degrees, `${units} should be 45 degrees`).toBeCloseTo(45, 6);
    }
  });

  it('says so when it had to change the unit, and stays quiet when it did not', () => {
    const converted = importEngaugeFigure(
      (() => { const p = readEngaugeProject(polar('Gradians', 50)); if ('error' in p) throw new Error(p.error); return p; })()
    );
    if ('error' in converted) throw new Error(converted.error);
    expect(converted.notes.join(' ')).toMatch(/gradians/i);

    const native = importEngaugeFigure(
      (() => { const p = readEngaugeProject(polar('Degrees (DDD.DDDDD)', 45)); if ('error' in p) throw new Error(p.error); return p; })()
    );
    if ('error' in native) throw new Error(native.error);
    expect(native.notes.join(' ')).not.toMatch(/degrees/i);
  });

  it('refuses a theta unit it does not know, naming it, rather than guessing', () => {
    const parsed = readEngaugeProject(polar('Furlongs', 45));
    expect('error' in parsed && parsed.error).toMatch(/Furlongs/);
  });
});
