/**
 * Tests for the Engauge `.dig` reader.
 *
 * ⚑ EVERY FIXTURE IN THIS FILE IS OURS, authored from the format's structure.
 * Engauge is GPL-2.0 and its test corpus is GPL-2.0 data, so none of it is
 * copied into this tree - see engine/digImport.ts's clean-room header and
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

  // ⚑ EITHER marker is enough, and that is the point of the rule: real .dig
  // files in the wild carry both, but the DOCTYPE is dropped by anything that
  // rewrites the XML, and older documents predate the attribute. Requiring both
  // would refuse files we can read perfectly well - and since this function
  // decides which importer the Open dialog hands the bytes to, a refusal here
  // surfaces as "no filter recognises this file".
  it('recognises a document that carries only the DOCTYPE', () => {
    expect(isEngaugeDocument(enc('<!DOCTYPE engauge>\n<Document>'))).toBe(true);
  });

  it('recognises a document that carries only the version attribute', () => {
    expect(isEngaugeDocument(enc('<?xml version="1.0"?>\n<Document VersionNumber="11.0">'))).toBe(true);
  });

  it('reads the version attribute wherever it sits among the others', () => {
    expect(isEngaugeDocument(enc('<Document Foo="1" VersionNumber="11.0">'))).toBe(true);
  });

  it('tolerates the whitespace an XML writer may put in the DOCTYPE', () => {
    expect(isEngaugeDocument(enc('<!DOCTYPE   engauge>\n<Document>'))).toBe(true);
  });

  it('looks only at the head of the file, so a marker buried deep does not count', () => {
    // A cheap sniff over the first KB, not a scan of a multi-megabyte project.
    expect(isEngaugeDocument(enc(`${' '.repeat(2000)}<!DOCTYPE engauge>`))).toBe(false);
  });
});

/**
 * The reader's smallest decisions, which are the ones that can quietly invent a
 * number. `numAttr` returns null for an absent or unparseable attribute so the
 * caller DROPS the point - because `Number(null)` is 0, and a 0 here is a
 * coordinate the file never carried, sitting on the axis, indistinguishable from
 * a real measurement (tenets 9 + 10).
 */
describe('a point the file did not fully record', () => {
  /** A document with hand-written curve/axis point XML, for the malformed cases
   * the fixture builder cannot express. */
  function rawDig(axisXml: string, curveXml: string): Uint8Array {
    return enc(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE engauge>\n` +
        `<Document VersionNumber="11.0"><CoordSystem>` +
        `<Coords TypeString="Cartesian" ScaleXThetaString="Linear" ScaleYRadiusString="Linear" UnitsThetaString="Degrees (DDD.DDDDD)"/>` +
        `<Curve CurveName="Axes"><CurvePoints>${axisXml}</CurvePoints></Curve>` +
        `<CurvesGraphs><Curve CurveName="Curve1"><CurvePoints>${curveXml}</CurvePoints></Curve></CurvesGraphs>` +
        `</CoordSystem></Document>`
    );
  }
  const axisPt = (sx: number, sy: number, gx: number, gy: number) =>
    `<Point IsAxisPoint="True" IsXOnly="False"><PositionScreen X="${sx}" Y="${sy}"/><PositionGraph X="${gx}" Y="${gy}"/></Point>`;
  const GOOD_AXES = axisPt(100, 500, 0, 0) + axisPt(600, 500, 10, 0) + axisPt(100, 100, 0, 1);

  it('drops a curve point missing a coordinate, rather than reading it as zero', () => {
    const r = readEngaugeProject(
      rawDig(
        GOOD_AXES,
        `<Point><PositionScreen X="100"/></Point><Point><PositionScreen X="200" Y="300"/></Point>`
      )
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.curves[0]!.points).toEqual([{ x: 200, y: 300 }]);
  });

  it('drops a curve point whose coordinate is not a number', () => {
    const r = readEngaugeProject(
      rawDig(
        GOOD_AXES,
        `<Point><PositionScreen X="nan" Y="12"/></Point><Point><PositionScreen X="200" Y="300"/></Point>`
      )
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.curves[0]!.points).toEqual([{ x: 200, y: 300 }]);
  });

  it('drops an axis point missing the value the user typed', () => {
    // An axis point with no graph Y would calibrate the figure against a 0
    // nobody entered - the worst place in the file for an invented number.
    const short = axisPt(100, 500, 0, 0) + axisPt(600, 500, 10, 0) + `<Point IsAxisPoint="True"><PositionScreen X="100" Y="100"/><PositionGraph X="0"/></Point>`;
    const r = readEngaugeProject(rawDig(short, `<Point><PositionScreen X="1" Y="2"/></Point>`));
    if ('error' in r) throw new Error(r.error);
    expect(r.axisPoints).toHaveLength(2);
  });

  it('keeps a curve with no readable point at all, as an empty one', () => {
    const r = readEngaugeProject(rawDig(GOOD_AXES, `<Point><PositionScreen Y="5"/></Point>`));
    if ('error' in r) throw new Error(r.error);
    expect(r.curves).toHaveLength(1);
    expect(r.curves[0]!.points).toEqual([]);
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

/**
 * What the reader does with a document that is not the tidy one the fixture
 * builder writes: a missing attribute, a missing element, a type it does not
 * know. ⚑ EVERY REFUSAL AND EVERY DEFAULT in `readEngaugeProject` had NO
 * coverage at all - 18 mutants' worth - so nothing checked that an absent
 * attribute takes its documented default rather than becoming an empty string,
 * and nothing checked that a file we cannot read is REFUSED BY NAME rather than
 * opened as a figure whose numbers would be quietly wrong.
 */
describe('readEngaugeProject on documents that are not the tidy case', () => {
  const AXES_XML =
    `<Curve CurveName="Axes"><CurvePoints>` +
    `<Point IsAxisPoint="True" IsXOnly="False"><PositionScreen X="100" Y="500"/><PositionGraph X="0" Y="0"/></Point>` +
    `<Point IsAxisPoint="True" IsXOnly="False"><PositionScreen X="600" Y="500"/><PositionGraph X="10" Y="0"/></Point>` +
    `<Point IsAxisPoint="True" IsXOnly="False"><PositionScreen X="100" Y="100"/><PositionGraph X="0" Y="1"/></Point>` +
    `</CurvePoints></Curve>`;
  /** A document assembled from parts, so any one of them can be left out. */
  const doc = (o: { coords?: string; axes?: string; graphs?: string; docAttrs?: string; image?: string } = {}) =>
    enc(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE engauge>\n` +
        `<Document ${o.docAttrs ?? 'VersionNumber="11.0"'}>${o.image ?? ''}<CoordSystem>` +
        (o.coords ??
          `<Coords TypeString="Cartesian" ScaleXThetaString="Linear" ScaleYRadiusString="Linear" UnitsThetaString="Degrees (DDD.DDDDD)"/>`) +
        (o.axes ?? AXES_XML) +
        (o.graphs ?? `<CurvesGraphs><Curve CurveName="C1"><CurvePoints><Point><PositionScreen X="1" Y="2"/></Point></CurvePoints></Curve></CurvesGraphs>`) +
        `</CoordSystem></Document>`
    );
  const read = (bytes: Uint8Array) => readEngaugeProject(bytes);
  const errorOf = (bytes: Uint8Array): string => {
    const r = read(bytes);
    if (!('error' in r)) throw new Error('expected a refusal, got a project');
    return r.error;
  };
  const projectOf = (bytes: Uint8Array) => {
    const r = read(bytes);
    if ('error' in r) throw new Error(r.error);
    return r;
  };
  const errorOfImport = (project: Exclude<ReturnType<typeof readEngaugeProject>, { error: string }>): string => {
    const imported = importEngaugeFigure(project);
    if (!('error' in imported)) throw new Error('expected a refusal, got a figure');
    return imported.error;
  };

  it('refuses XML it cannot parse, saying so, rather than throwing', () => {
    expect(errorOf(enc('<!DOCTYPE engauge>\n<Document'))).toContain('Could not read this Engauge project');
  });

  it('refuses a document with no Document element, naming what is missing', () => {
    expect(errorOf(enc('<!DOCTYPE engauge>\n<Something VersionNumber="1"/>'))).toContain('Document element');
  });

  it('refuses a document with no coordinate system', () => {
    expect(errorOf(enc('<!DOCTYPE engauge>\n<Document VersionNumber="11.0"><Image/></Document>'))).toContain(
      'no coordinate system'
    );
  });

  it('refuses a coordinate type it does not know, naming the type', () => {
    expect(errorOf(doc({ coords: '<Coords TypeString="LogPolar"/>' }))).toContain('LogPolar');
  });

  it('reports the version as unknown rather than blank when the file omits it', () => {
    expect(projectOf(doc({ docAttrs: 'Foo="1"' })).version).toBe('unknown');
  });

  it('treats a document with no stated type as Cartesian, the format’s own default', () => {
    expect(projectOf(doc({ coords: '<Coords/>' })).coordsType).toBe('Cartesian');
  });

  it('treats an unstated scale as Linear, never as log', () => {
    const p = projectOf(doc({ coords: '<Coords TypeString="Cartesian"/>' }));
    expect(p.isLogX).toBe(false);
    expect(p.isLogY).toBe(false);
  });

  it('reads a log X scale, which is a different attribute from the Y one', () => {
    const p = projectOf(
      doc({ coords: '<Coords TypeString="Cartesian" ScaleXThetaString="Log" ScaleYRadiusString="Linear"/>' })
    );
    expect(p.isLogX).toBe(true);
    expect(p.isLogY).toBe(false);
  });

  it('treats an unstated theta unit as degrees, which is what Engauge writes by default', () => {
    const p = projectOf(doc({ coords: '<Coords TypeString="Polar"/>' }));
    expect(p.thetaInDegrees).toBe(true);
    expect(p.thetaNote).toBeUndefined();
  });

  it('ignores the theta unit entirely on a Cartesian document', () => {
    // A Cartesian figure has no angles, so a unit we could not represent in a
    // polar figure must not refuse this one.
    const p = projectOf(doc({ coords: '<Coords TypeString="Cartesian" UnitsThetaString="Turns"/>' }));
    expect(p.coordsType).toBe('Cartesian');
    expect(p.thetaNote).toBeUndefined();
  });

  it('treats an axis point with no IsXOnly as an ordinary one', () => {
    const p = projectOf(
      doc({
        axes:
          `<Curve CurveName="Axes"><CurvePoints>` +
          `<Point><PositionScreen X="100" Y="500"/><PositionGraph X="0" Y="0"/></Point>` +
          `</CurvePoints></Curve>`,
      })
    );
    expect(p.axisPoints[0]!.isXOnly).toBe(false);
  });

  it('names an unnamed curve "Curve" rather than leaving it blank', () => {
    // A blank name would render as an unlabelled series in the rail - the
    // fabricated-vs-missing name question, answered the other way: the file
    // really did not say, so a neutral word beats an empty one.
    const p = projectOf(
      doc({
        graphs: `<CurvesGraphs><Curve><CurvePoints><Point><PositionScreen X="1" Y="2"/></Point></CurvePoints></Curve></CurvesGraphs>`,
      })
    );
    expect(p.curves[0]!.name).toBe('Curve');
  });

  it('finds the Axes curve BY NAME, not by position among its siblings', () => {
    const p = projectOf(
      doc({
        axes:
          `<Curve CurveName="Decoration"><CurvePoints>` +
          `<Point><PositionScreen X="7" Y="7"/><PositionGraph X="7" Y="7"/></Point>` +
          `</CurvePoints></Curve>` +
          AXES_XML,
      })
    );
    // The decoration curve's single point must not have been read as an axis.
    expect(p.axisPoints).toHaveLength(3);
    expect(p.axisPoints.map((a) => a.screen.x)).toEqual([100, 600, 100]);
  });

  it('reads no axis points at all when the document has no Axes curve', () => {
    const p = projectOf(doc({ axes: '' }));
    expect(p.axisPoints).toEqual([]);
    // ...and the import refuses rather than opening an uncalibrated figure.
    expect(errorOfImport(p)).toContain('never calibrated');
  });

  it('drops an axis point missing ANY of its four numbers', () => {
    // Each coordinate is checked separately, because a point missing only its
    // screen X is exactly as unusable as one missing everything - and dropping
    // it is the only honest answer (there is nothing to infer it from).
    const partial = [
      `<Point><PositionScreen Y="500"/><PositionGraph X="0" Y="0"/></Point>`,
      `<Point><PositionScreen X="100"/><PositionGraph X="0" Y="0"/></Point>`,
      `<Point><PositionScreen X="100" Y="500"/><PositionGraph Y="0"/></Point>`,
      `<Point><PositionScreen X="100" Y="500"/><PositionGraph X="0"/></Point>`,
    ];
    for (const p of partial) {
      const project = projectOf(doc({ axes: `<Curve CurveName="Axes"><CurvePoints>${p}${AXES_XML.slice(AXES_XML.indexOf('<Point'), AXES_XML.lastIndexOf('</CurvePoints>'))}</CurvePoints></Curve>` }));
      expect(project.axisPoints, `should have dropped: ${p}`).toHaveLength(3);
    }
  });

  it('reads the image without a size when the file gives no dimensions', () => {
    const p = projectOf(doc({ image: `<Image><![CDATA[${imagePayload()}]]></Image>` }));
    expect(p.imageSize).toBeNull();
    expect(p.imageDataURL).toContain('data:image/png;base64,');
  });

  it('reports no image for an empty or whitespace payload', () => {
    expect(projectOf(doc({ image: '<Image Width="1" Height="1"><![CDATA[]]></Image>' })).imageDataURL).toBeNull();
    expect(projectOf(doc({ image: '<Image Width="1" Height="1"/>' })).imageDataURL).toBeNull();
  });

  it('survives a corrupt image payload, keeping the calibration and points', () => {
    const p = projectOf(doc({ image: '<Image Width="1" Height="1"><![CDATA[!!!not base64!!!]]></Image>' }));
    expect(p.imageDataURL).toBeNull();
    expect(p.axisPoints).toHaveLength(3);
  });

  it('decodes a base64 payload that the writer wrapped across lines', () => {
    // Engauge's own writer wraps the CDATA, so this is the ordinary case rather
    // than an edge one: the whitespace has to come out before decoding.
    const wrapped = imagePayload().replace(/(.{8})/g, '$1\n  ');
    expect(projectOf(doc({ image: `<Image Width="1" Height="1"><![CDATA[${wrapped}]]></Image>` })).imageDataURL).toContain(
      'data:image/png;base64,'
    );
  });

  it('reads a document containing a byte that is not valid UTF-8', () => {
    // Decoding is deliberately non-fatal: one bad byte in a curve name must not
    // cost the reader the whole project.
    const good = doc();
    const bytes = new Uint8Array(good.length + 1);
    const cut = good.length - 20;
    bytes.set(good.subarray(0, cut), 0);
    bytes[cut] = 0xff; // not a legal UTF-8 lead byte
    bytes.set(good.subarray(cut), cut + 1);
    const r = read(bytes);
    expect('error' in r).toBe(false);
  });
});

/**
 * The image payload, and the two SCAN WINDOWS the reader deliberately keeps
 * short. Both exist so a corrupt or hostile file cannot make us walk megabytes,
 * and both are decisions a passing test should be able to state.
 */
describe('the embedded image', () => {
  function digWithPayload(bytes: number[]): Uint8Array {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return enc(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE engauge>\n` +
        `<Document VersionNumber="11.0">` +
        `<Image Width="640" Height="480"><![CDATA[${btoa(bin)}]]></Image>` +
        `<CoordSystem>` +
        `<Coords TypeString="Cartesian" ScaleXThetaString="Linear" ScaleYRadiusString="Linear" UnitsThetaString="Degrees (DDD.DDDDD)"/>` +
        `<Curve CurveName="Axes"><CurvePoints>` +
        `<Point IsAxisPoint="True" IsXOnly="False"><PositionScreen X="100" Y="500"/><PositionGraph X="0" Y="0"/></Point>` +
        `<Point IsAxisPoint="True" IsXOnly="False"><PositionScreen X="600" Y="500"/><PositionGraph X="10" Y="0"/></Point>` +
        `<Point IsAxisPoint="True" IsXOnly="False"><PositionScreen X="100" Y="100"/><PositionGraph X="0" Y="1"/></Point>` +
        `</CurvePoints></Curve><CurvesGraphs/></CoordSystem></Document>`
    );
  }
  const FRAME = [0x00, 0x00, 0x00, 0x01];
  const mimeOf = (bytes: number[]): string | null => {
    const r = readEngaugeProject(digWithPayload(bytes));
    if ('error' in r) throw new Error(r.error);
    return r.imageDataURL === null ? null : r.imageDataURL.slice(5, r.imageDataURL.indexOf(';'));
  };

  // ⚑ The payload's OWN BYTES decide what it is - the file never says. Only PNG
  // was covered before, so nothing checked that a .dig carrying a photographic
  // figure (JPEG is the common case for a scanned paper) is labelled correctly.
  // A data URL whose declared type is wrong renders as a broken image.
  it('names each format from its own magic number', () => {
    expect(mimeOf([...FRAME, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])).toBe('image/png');
    expect(mimeOf([...FRAME, 0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])).toBe('image/jpeg');
    expect(mimeOf([...FRAME, 0x47, 0x49, 0x46, 0x38, 0x39, 0x61])).toBe('image/gif');
    expect(mimeOf([...FRAME, 0x42, 0x4d, 0x36, 0x00, 0x00, 0x00])).toBe('image/bmp');
  });

  it('reports no image at all when the payload holds no format it knows', () => {
    expect(mimeOf([...FRAME, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06])).toBeNull();
  });

  it('searches only the first bytes for the magic, not the whole payload', () => {
    // The framing header is a word or so; a magic number 200 bytes in means the
    // payload is not what we think it is, and hunting for it through megabytes
    // of a corrupt file is exactly what the short window prevents.
    const buried = [...Array(200).fill(0x01), 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a];
    expect(mimeOf(buried)).toBeNull();
  });

  it('still imports the figure when the image cannot be read, and says so', () => {
    const r = readEngaugeProject(digWithPayload([...FRAME, 0x01, 0x02, 0x03, 0x04]));
    if ('error' in r) throw new Error(r.error);
    const imported = importEngaugeFigure(r);
    if ('error' in imported) throw new Error(imported.error);
    expect(imported.notes.join(' ')).toContain('image could not be read');
    expect(imported.axes).toBeDefined();
  });
});

describe('the old binary format is identified by its HEAD', () => {
  it('does not refuse an XML document because a NUL appears deep inside it', () => {
    // The pre-6.3 format is a Qt stream that begins with a version word, so the
    // evidence is in the first bytes. Scanning the whole file instead would turn
    // any XML that happens to carry a NUL into a wrongly-named refusal - telling
    // the user to re-save a file that was never in the old format.
    const doc =
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE engauge>\n<Document VersionNumber="11.0">` +
      `<Notes>${'x'.repeat(600)}</Notes><Notes>\u0000</Notes>` +
      `<CoordSystem><Coords TypeString="Cartesian" ScaleXThetaString="Linear" ScaleYRadiusString="Linear" UnitsThetaString="Degrees (DDD.DDDDD)"/>` +
      `<Curve CurveName="Axes"><CurvePoints>` +
      `<Point IsAxisPoint="True" IsXOnly="False"><PositionScreen X="100" Y="500"/><PositionGraph X="0" Y="0"/></Point>` +
      `<Point IsAxisPoint="True" IsXOnly="False"><PositionScreen X="600" Y="500"/><PositionGraph X="10" Y="0"/></Point>` +
      `<Point IsAxisPoint="True" IsXOnly="False"><PositionScreen X="100" Y="100"/><PositionGraph X="0" Y="1"/></Point>` +
      `</CurvePoints></Curve><CurvesGraphs/></CoordSystem></Document>`;
    const bytes = enc(doc);
    expect(bytes.indexOf(0)).toBeGreaterThan(512);
    const r = readEngaugeProject(bytes);
    if ('error' in r) throw new Error(r.error);
    expect(r.axisPoints).toHaveLength(3);
  });
});

describe('importEngaugeFigure - calibration', () => {
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
    // shares neither coordinate - the general case. The imported VALUES must be
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

  /**
   * ⚑⚑ THE FIXTURE ABOVE CANNOT SEE HALF OF THE ARITHMETIC IT EXERCISES.
   * Its map is axis-aligned (sx depends only on x, sy only on y), so the
   * recovered matrix is DIAGONAL and its off-diagonal terms are exactly zero -
   * which means a sign flip, or a multiply turned into a divide, on either of
   * them changes nothing at all. The affine reconstruction is the one piece of
   * real arithmetic in this module, and half of it was being asserted against a
   * figure that could not disagree.
   *
   * A ROTATED figure fixes that, and it is the honest case rather than a
   * contrived one: a scanned page is never perfectly square, and Engauge lets
   * the three axis points sit anywhere. Here the axes are turned by the 3-4-5
   * rotation (cos 0.8, sin 0.6) with 50 px per x and 400 px per y:
   *
   *     sx = 100 + 0.8·(50x) − 0.6·(−400y)
   *     sy = 500 + 0.6·(50x) + 0.8·(−400y)
   *
   * every entry of the matrix is non-zero, so every term has to be right.
   */
  it('reads a ROTATED figure back exactly, where every matrix entry matters', () => {
    const bytes = makeDig({
      axisPoints: [
        { sx: 200, sy: 450, gx: 1, gy: 0.25 },
        { sx: 500, sy: 550, gx: 7, gy: 0.5 },
        { sx: 440, sy: 380, gx: 4, gy: 0.75 },
      ],
      curves: [{ name: 'C', pts: [[420, 490], [204, 528]] }],
    });
    // Two points, because an offset error is invisible at one of them.
    const [x0, y0] = dataAt(bytes, 0, 0);
    expect(x0).toBeCloseTo(5, 6);
    expect(y0).toBeCloseTo(0.5, 6);
    const [x1, y1] = dataAt(bytes, 0, 1);
    expect(x1).toBeCloseTo(2, 6);
    expect(y1).toBeCloseTo(0.1, 6);
  });

  it('finds the L when the shared axis value is not zero', () => {
    // ⚑ Every other fixture puts the corner at graph (0,0), where "these two
    // share a Y" and "these two sum to zero" are the same statement. A shared
    // value of 5 tells them apart.
    const bytes = makeDig({
      axisPoints: [
        { sx: 100, sy: 500, gx: 3, gy: 5 },
        { sx: 600, sy: 500, gx: 13, gy: 5 },
        { sx: 100, sy: 100, gx: 3, gy: 9 },
      ],
      curves: [{ name: 'C', pts: [[350, 300]] }],
    });
    const [x, y] = dataAt(bytes, 0, 0);
    expect(x).toBeCloseTo(8, 6);
    expect(y).toBeCloseTo(7, 6);
    // The L was found, so no restatement note is needed.
    const parsed = readEngaugeProject(bytes);
    if ('error' in parsed) throw new Error(parsed.error);
    const imported = importEngaugeFigure(parsed);
    if ('error' in imported) throw new Error(imported.error);
    expect(imported.notes.join(' ')).not.toMatch(/rebuilt|reference points/i);
  });

  it('says how many axis points it used only when it left some out', () => {
    const fourSided = [
      { sx: 100, sy: 500, gx: 0, gy: 0, xOnly: true },
      { sx: 600, sy: 500, gx: 10, gy: 0, xOnly: true },
      { sx: 100, sy: 500, gx: 0, gy: 0 },
      { sx: 100, sy: 100, gx: 0, gy: 1 },
    ];
    const noteFor = (axisPoints: NonNullable<DigOpts['axisPoints']>) => {
      const parsed = readEngaugeProject(makeDig({ axisPoints }));
      if ('error' in parsed) throw new Error(parsed.error);
      const imported = importEngaugeFigure(parsed);
      if ('error' in imported) throw new Error(imported.error);
      return imported.notes.join(' ');
    };
    // Exactly four are all used, so there is nothing to report.
    expect(noteFor(fourSided)).not.toContain('axis points');
    // A fifth is left out, and the user is told.
    expect(noteFor([...fourSided, { sx: 300, sy: 300, gx: 5, gy: 0.5 }])).toContain('5 axis points');
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

describe('importEngaugeFigure - refusals and honesty', () => {
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

describe('importEngaugeFigure - polar', () => {
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
      // Centre, then two radial points at DIFFERENT radii -- 100px out at
      // r=10 and 200px out at r=20, so 100px is 10 radial units.
      //
      // ⚑ This fixture used to put both points at r=10 AND at the same pixel
      // distance from the centre, which is doubly degenerate: our PolarAxes
      // derives the radial scale from (r2-r1) over (dist20-dist10), so both
      // were zero and every reading came back NaN. It went unnoticed because
      // no test asserted a polar VALUE from an imported .dig -- only the
      // notes and the refusals. Corrected 2026-07-31 when
      // everyAxesTypeRefuses.test.ts made PolarAxes refuse r1 === r2.
      axisPoints: [
        { sx: 100, sy: 100, gx: 0, gy: 0 },
        { sx: 200, sy: 100, gx: theta, gy: 10 },
        { sx: 300, sy: 100, gx: theta * 2, gy: 20 },
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
