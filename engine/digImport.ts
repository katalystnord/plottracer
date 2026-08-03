/**
 * Read an Engauge Digitizer project (`.dig`).
 *
 * ⚑⚑ CLEAN-ROOM. Engauge Digitizer is GPL-2.0, which is NOT compatible with our
 * AGPL-3.0. Everything below was written from the FILE FORMAT — the structure of
 * real `.dig` documents, read as data — and never from Engauge's C++. CLAUDE.md
 * states the rule ("clean-room reimplementations ... written from the algorithm
 * description, never ported from its GPL-2.0 C++"); this module is the same rule
 * applied to a file format. Reading a format is always fine; taking code is what
 * the licence governs.
 *
 * ⚑ For the same reason the committed fixtures in `__tests__/fixtures/dig/` are
 * OURS, authored from the format — Engauge's own test corpus is GPL-2.0 data and
 * does not belong in this tree. That corpus was used as a local verification
 * pass only (see PROVENANCE.md).
 *
 * WHY THIS EXISTS (David, 2026-07-28): reading many formats positions PlotTracer
 * downstream of the whole field — data flows in and stops here. That makes the
 * one-way rule a strategy rather than a limitation, so nothing in this module
 * has, or may grow, a matching writer.
 *
 * WHAT THE FORMAT LOOKS LIKE
 * --------------------------
 * A `.dig` is UTF-8 XML:
 *
 *   <!DOCTYPE engauge>
 *   <Document VersionNumber="11.0">
 *     <Image Width="634" Height="423"><![CDATA[ <base64> ]]></Image>
 *     <CoordSystem>
 *       <Coords TypeString="Cartesian" ScaleXThetaString="Linear"
 *               ScaleYRadiusString="Linear" UnitsThetaString="Degrees (...)"/>
 *       <Curve CurveName="Axes">
 *         <CurvePoints>
 *           <Point IsAxisPoint="True" IsXOnly="False">
 *             <PositionScreen X="38" Y="385"/>   <!-- pixels -->
 *             <PositionGraph  X="0"  Y="0"/>     <!-- what the user typed -->
 *           </Point>  ... (3, or 4 in "four sides" mode)
 *         </CurvePoints>
 *       </Curve>
 *       <CurvesGraphs>
 *         <Curve CurveName="CurveTop">
 *           <CurvePoints>
 *             <Point><PositionScreen X="38" Y="27"/></Point> ...
 *           </CurvePoints>
 *         </Curve> ...
 *       </CurvesGraphs>
 *     </CoordSystem>
 *   </Document>
 *
 * Two facts about real `.dig` files that shape everything here:
 *
 *  1. **Only version 6.3 and later are XML.** Earlier documents are a Qt binary
 *     serialization, a genuinely different format. We refuse those by name
 *     rather than failing with an XML parse error, per the project's standing
 *     rule that an unsupported file is told what it is.
 *  2. **Curve points carry ONLY a screen position.** Engauge recomputes graph
 *     coordinates from the calibration on load, exactly as we do — so importing
 *     is a matter of carrying the pixels and rebuilding the axes, and no value
 *     in the file is re-derived or second-guessed here (tenet 9).
 *
 * The XML is parsed with fast-xml-parser (MIT) rather than by hand, for the same
 * reason engine/projectContainer.ts chose fflate over a hand-rolled zip: these
 * are someone else's bytes, and entity/CDATA handling is precisely what a
 * hand-rolled parser gets subtly and silently wrong.
 */

import { XMLParser } from 'fast-xml-parser';
import { Calibration } from '../core/calibration.js';
import { Dataset } from '../core/dataset.js';
import { XYAxes } from '../core/axes/xy.js';
import { PolarAxes } from '../core/axes/polar.js';
import type { AnyAxes } from '../core/plotData.js';

export type DigResult<T> = T | { error: string };

/** One axis (calibration) point as the file records it. */
export interface DigAxisPoint {
  screen: { x: number; y: number };
  /** What the user typed. For polar documents X is theta and Y is radius. */
  graph: { x: number; y: number };
  /** "Four sides" mode marks the two points that fix only the X scale. */
  isXOnly: boolean;
}

/** One traced curve: a name and its pixels, in file order. */
export interface DigCurve {
  name: string;
  points: { x: number; y: number }[];
}

/** A parsed `.dig`, before it becomes our axes and datasets. */
export interface DigProject {
  /** Engauge's own document version, e.g. "11.0" — reported, never branched on
   * for anything but the binary refusal above. */
  version: string;
  coordsType: 'Cartesian' | 'Polar';
  isLogX: boolean;
  isLogY: boolean;
  /** Polar only: whether theta was typed in degrees rather than radians. */
  thetaInDegrees: boolean;
  /** Set when a theta unit we cannot represent (gradians, turns) was converted
   * to degrees, so the import can say so rather than changing units in silence. */
  thetaNote?: string;
  imageDataURL: string | null;
  imageSize: { width: number; height: number } | null;
  axisPoints: DigAxisPoint[];
  curves: DigCurve[];
  /** How many further coordinate systems the document held beyond the one read.
   * Reported so a multi-system document cannot be silently reduced to its first. */
  extraCoordSystems: number;
}

/**
 * Does this look like an Engauge XML document?
 *
 * Sniffs the CONTENT, never the extension — the same discipline the rest of the
 * open path documents, since users rename files. A `.dig` is XML whose doctype
 * or root element names Engauge, which is specific enough that no other XML we
 * read could be mistaken for one.
 *
 * Deliberately narrow: it recognises the DOCUMENT, not whether we can open what
 * is inside. Deciding that is readEngaugeProject's job, and it is that function
 * which must say plainly what it cannot read.
 */
export function isEngaugeDocument(bytes: Uint8Array): boolean {
  // The marker is well inside the first KB in every real document; decoding the
  // whole file just to sniff it would be wasteful on a multi-megabyte project.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 1024));
  return /<!DOCTYPE\s+engauge/i.test(head) || /<Document\s[^>]*VersionNumber=/.test(head);
}

/**
 * Is this the pre-6.3 Qt binary serialization?
 *
 * Those files are not XML at all, so without this check they would surface as a
 * parse error that tells the user nothing. Detected as "claims to be a Engauge
 * document but does not start with an XML prolog or element".
 */
function looksBinary(bytes: Uint8Array): boolean {
  for (let i = 0; i < Math.min(bytes.length, 512); i++) {
    const b = bytes[i]!;
    // NUL bytes never occur in the XML documents; they are all over the Qt
    // stream, which begins with a version word and length-prefixed strings.
    if (b === 0x00) return true;
  }
  return false;
}

/** Image magic numbers, so the payload's own bytes decide what it is. */
const IMAGE_MAGIC: { mime: string; magic: number[] }[] = [
  { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/bmp', magic: [0x42, 0x4d] },
];

/**
 * Find where the real image starts inside the decoded `<Image>` payload.
 *
 * The payload is a Qt-serialized image, so the encoded bytes carry a short
 * framing header before the image's own magic number (a 4-byte word in every
 * document examined). Rather than hardcode that width — which would break the
 * moment a version framed it differently — we locate the image by ITS OWN magic
 * and ignore whatever precedes it. Searching a short prefix keeps a corrupt
 * payload from scanning megabytes.
 */
function findImageStart(bytes: Uint8Array): { offset: number; mime: string } | null {
  const limit = Math.min(bytes.length, 64);
  for (let off = 0; off < limit; off++) {
    for (const { mime, magic } of IMAGE_MAGIC) {
      let hit = true;
      for (let k = 0; k < magic.length; k++) {
        if (bytes[off + k] !== magic[k]) { hit = false; break; }
      }
      if (hit) return { offset: off, mime };
    }
  }
  return null;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Attribute reader — fast-xml-parser gives attributes an `@` prefix. */
function attr(node: unknown, name: string): string | null {
  if (typeof node !== 'object' || node === null) return null;
  const v = (node as Record<string, unknown>)['@' + name];
  return v == null ? null : String(v);
}

/** A required numeric attribute. Returns null when absent or unparseable, so
 * the caller refuses rather than importing a NaN coordinate. */
function numAttr(node: unknown, name: string): number | null {
  const raw = attr(node, name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Coerce fast-xml-parser's "one child collapses to an object" into an array. */
function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function readPoints(curveNode: unknown): { x: number; y: number }[] {
  const cp = (curveNode as Record<string, unknown>)?.['CurvePoints'];
  const pts = asArray((cp as Record<string, unknown>)?.['Point'] as unknown[]);
  const out: { x: number; y: number }[] = [];
  for (const p of pts) {
    const screen = (p as Record<string, unknown>)['PositionScreen'];
    const x = numAttr(screen, 'X');
    const y = numAttr(screen, 'Y');
    // A point with no readable screen position is dropped rather than guessed
    // at: there is no honest value to invent for it (tenets 9 + 10).
    if (x === null || y === null) continue;
    out.push({ x, y });
  }
  return out;
}

/**
 * Parse a `.dig` into its parts. Refuses — with a reason naming what it found —
 * rather than returning a half-read project.
 */
export function readEngaugeProject(bytes: Uint8Array): DigResult<DigProject> {
  if (looksBinary(bytes)) {
    return {
      error:
        'This is an Engauge Digitizer project saved in the old binary format (before Engauge 6.3), which PlotTracer cannot read. Re-save it with a current version of Engauge to get an XML .dig file.',
    };
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    // Keep every attribute a string and convert deliberately below. Automatic
    // coercion would turn a curve named "1" into a number and an axis value of
    // "0800" into 800.
    parseAttributeValue: false,
    parseTagValue: false,
    cdataPropName: '#cdata',
    trimValues: true,
  });

  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(text) as Record<string, unknown>;
  } catch (e) {
    return { error: `Could not read this Engauge project — ${e instanceof Error ? e.message : String(e)}` };
  }

  // The Document is normally the root, but Engauge also writes it wrapped in an
  // <ErrorReport> (a crash report carries the whole project inside it). Those
  // hold a complete, readable project, so we unwrap rather than refuse.
  const root =
    (doc['Document'] as Record<string, unknown> | undefined) ??
    ((doc['ErrorReport'] as Record<string, unknown> | undefined)?.['Document'] as
      | Record<string, unknown>
      | undefined);
  if (!root) return { error: "This file isn't an Engauge Digitizer project (no Document element)." };

  const version = attr(root, 'VersionNumber') ?? 'unknown';

  // --- the image -----------------------------------------------------------
  let imageDataURL: string | null = null;
  let imageSize: { width: number; height: number } | null = null;
  const imageNode = root['Image'];
  if (imageNode) {
    const w = numAttr(imageNode, 'Width');
    const h = numAttr(imageNode, 'Height');
    if (w !== null && h !== null) imageSize = { width: w, height: h };
    const payload = (imageNode as Record<string, unknown>)['#cdata'];
    if (typeof payload === 'string' && payload.trim().length > 0) {
      try {
        const raw = base64ToBytes(payload.replace(/\s+/g, ''));
        const found = findImageStart(raw);
        if (found) {
          imageDataURL = `data:${found.mime};base64,${bytesToBase64(raw.subarray(found.offset))}`;
        }
      } catch {
        // A corrupt image payload is not fatal — the calibration and the traced
        // points are still worth importing, and the caller reports the miss.
        imageDataURL = null;
      }
    }
  }

  // --- the coordinate system ----------------------------------------------
  // Two shapes across the format's life, both still in the wild:
  //   • <Document><CoordSystem>…  — one or MORE, as repeated siblings
  //   • <Document><Coords/>…      — Engauge 6.3, flat, no wrapper
  // The second is why the fallback is the Document itself.
  //
  // ⚑ There is NO <CoordSystems> wrapper element. This code used to look for one
  // and count the extra systems inside it, so the count was permanently 0 and a
  // multi-system document was silently reduced to its first -- measured on
  // Engauge's own corpus, version7.1_1.dig holds [68,43,35,30,17] points across
  // five systems and imported only the 68. Verified against all 47 .dig files
  // there (and Engauge writes CoordSystem, singular, as repeated siblings).
  const systems = asArray(root['CoordSystem'] as unknown) as Record<string, unknown>[];
  const coordSystem = systems[0] ?? (root['Coords'] ? root : undefined);
  if (!coordSystem) return { error: 'This Engauge project has no coordinate system to read.' };
  // A document holding several coordinate systems is several figures; we open
  // the first and SAY SO rather than dropping the rest silently.
  const extraSystems = Math.max(0, systems.length - 1);

  const coords = coordSystem['Coords'];
  const typeString = attr(coords, 'TypeString') ?? 'Cartesian';
  if (typeString !== 'Cartesian' && typeString !== 'Polar') {
    return { error: `This Engauge project uses ${typeString} coordinates, which PlotTracer cannot read yet.` };
  }
  const isLogX = (attr(coords, 'ScaleXThetaString') ?? 'Linear') === 'Log';
  const isLogY = (attr(coords, 'ScaleYRadiusString') ?? 'Linear') === 'Log';
  // Engauge writes exactly one of "Degrees (…)" (four variants), "Gradians",
  // "Radians" or "Turns", verbatim and never localised.
  //
  // ⚑ This used to be `.startsWith('Degrees')`, so GRADIANS and TURNS fell into
  // the radians branch: a point whose true theta is 0/360 exported as 49.21 or
  // 5.62 -- a wrong angle in a wrong unit, with nothing said. Degrees and radians
  // are kept in the file's OWN unit because our polar axes read both natively;
  // gradians and turns have no native form here, so they are converted to degrees
  // and the import says that it did so.
  const thetaUnits = attr(coords, 'UnitsThetaString') ?? 'Degrees (DDD.DDDDD)';
  let thetaInDegrees = true;
  let thetaToDegrees = 1;
  let thetaNote: string | undefined;
  if (typeString === 'Polar') {
    if (thetaUnits.startsWith('Degrees')) thetaInDegrees = true;
    else if (thetaUnits === 'Radians') thetaInDegrees = false;
    else if (thetaUnits === 'Gradians' || thetaUnits === 'Turns') {
      thetaToDegrees = thetaUnits === 'Gradians' ? 0.9 : 360;
      thetaNote = `This project's angles were recorded in ${thetaUnits.toLowerCase()}; they were read as the same angles in degrees.`;
    } else {
      return {
        error: `This Engauge project records angles in ${thetaUnits}, which PlotTracer cannot read yet.`,
      };
    }
  }

  // --- the axis (calibration) points ---------------------------------------
  // The axes live in a Curve named "Axes" beside the data curves.
  const axesCurve = asArray(coordSystem['Curve'] as unknown).find(
    (c) => attr(c, 'CurveName') === 'Axes'
  );
  const axisPoints: DigAxisPoint[] = [];
  if (axesCurve) {
    const cp = (axesCurve as Record<string, unknown>)['CurvePoints'];
    for (const p of asArray((cp as Record<string, unknown>)?.['Point'] as unknown[])) {
      const screen = (p as Record<string, unknown>)['PositionScreen'];
      const graph = (p as Record<string, unknown>)['PositionGraph'];
      const sx = numAttr(screen, 'X');
      const sy = numAttr(screen, 'Y');
      const gx = numAttr(graph, 'X');
      const gy = numAttr(graph, 'Y');
      if (sx === null || sy === null || gx === null || gy === null) continue;
      axisPoints.push({
        screen: { x: sx, y: sy },
        // For a polar document X IS theta, so an unrepresentable unit is
        // converted here -- the one place the file's numbers become ours.
        graph: { x: gx * thetaToDegrees, y: gy },
        isXOnly: (attr(p, 'IsXOnly') ?? 'False') === 'True',
      });
    }
  }

  // --- the traced curves ----------------------------------------------------
  const graphs = coordSystem['CurvesGraphs'] as Record<string, unknown> | undefined;
  const curves: DigCurve[] = [];
  for (const c of asArray(graphs?.['Curve'] as unknown)) {
    curves.push({
      name: attr(c, 'CurveName') ?? 'Curve',
      points: readPoints(c),
    });
  }

  return {
    version,
    coordsType: typeString,
    isLogX,
    isLogY,
    thetaInDegrees,
    // No note is the ABSENCE of a note. `if (project.thetaNote)` downstream
    // reads a missing key identically, so nothing changes but the claim.
    ...(thetaNote === undefined ? {} : { thetaNote }),
    imageDataURL,
    imageSize,
    axisPoints,
    curves,
    extraCoordSystems: extraSystems,
  };
}

/** A `.dig` turned into our own model, ready to open. */
export interface ImportedDigFigure {
  configId: string;
  axes: AnyAxes;
  datasets: Dataset[];
  imageDataURL: string | null;
  /** Things the file held that we could not carry, in plain words. Shown to the
   * user rather than swallowed — an import that quietly drops half a project is
   * the failure this codebase has killed repeatedly. */
  notes: string[];
}

/**
 * Build our four-point XY calibration from Engauge's axis points.
 *
 * ⚑ THE ONE PIECE OF REAL ARITHMETIC HERE, so it is worth stating exactly what
 * it does and does not do.
 *
 * Engauge fixes a Cartesian system with THREE points, each carrying a screen
 * position and the graph coordinates the user typed. Our XYAxes takes FOUR: two
 * that fix the X scale and two that fix the Y scale. Both describe the same
 * affine map from pixels to data, so this is a change of REPRESENTATION, not a
 * re-modelling — nothing is estimated, fitted or assumed (tenets 9 + 10).
 *
 * In the ordinary case the three points form an "L": two share a graph Y (they
 * fix X) and two share a graph X (they fix Y), with one corner point in both
 * roles. We then hand our axes THE USER'S OWN TYPED NUMBERS, with the corner
 * appearing in both pairs. Because our axes builds its transform from the two
 * pixel difference vectors, reusing the corner is exact:
 *
 *     A·(P_corner − P_xmate) = (gx_corner − gx_mate, 0)
 *     A·(P_corner − P_ymate) = (0, gy_corner − gy_mate)
 *
 * which is precisely the system our XYAxes solves. Four-sided documents already
 * give the two pairs explicitly (IsXOnly marks the X pair), so they need no
 * reconstruction at all.
 *
 * Returns null when the points cannot fix a system — collinear, degenerate, or
 * an arrangement that is not an L — so the caller refuses instead of importing a
 * calibration that silently means something else.
 */
function buildXYCalibration(
  pts: DigAxisPoint[],
  isLogX: boolean,
  isLogY: boolean
): { calib: Calibration; note: string | null } | null {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

  let xPair: DigAxisPoint[] | null = null;
  let yPair: DigAxisPoint[] | null = null;
  let note: string | null = null;

  const xOnly = pts.filter((p) => p.isXOnly);
  if (xOnly.length === 2 && pts.length >= 4) {
    // "Four sides" mode: the file already separates the two pairs.
    xPair = xOnly;
    yPair = pts.filter((p) => !p.isXOnly).slice(0, 2);
  } else if (pts.length >= 3) {
    // Find the L: a pair sharing a graph Y fixes X, a pair sharing a graph X
    // fixes Y. The corner is the point in both.
    for (let i = 0; i < pts.length && !xPair; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        if (near(pts[i]!.graph.y, pts[j]!.graph.y) && !near(pts[i]!.graph.x, pts[j]!.graph.x)) {
          xPair = [pts[i]!, pts[j]!];
          break;
        }
      }
    }
    for (let i = 0; i < pts.length && !yPair; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        if (near(pts[i]!.graph.x, pts[j]!.graph.x) && !near(pts[i]!.graph.y, pts[j]!.graph.y)) {
          yPair = [pts[i]!, pts[j]!];
          break;
        }
      }
    }
  }

  if (xPair && yPair && yPair.length >= 2) {
    // Reject a degenerate arrangement: the two pixel difference vectors must be
    // independent or there is no invertible transform to build.
    const dx1 = xPair[0]!.screen.x - xPair[1]!.screen.x;
    const dy1 = xPair[0]!.screen.y - xPair[1]!.screen.y;
    const dx2 = yPair[0]!.screen.x - yPair[1]!.screen.x;
    const dy2 = yPair[0]!.screen.y - yPair[1]!.screen.y;
    if (Math.abs(dx1 * dy2 - dx2 * dy1) >= 1e-9) {
      const calib = new Calibration(2);
      calib.addPoint(xPair[0]!.screen.x, xPair[0]!.screen.y, numText(xPair[0]!.graph.x), '0');
      calib.addPoint(xPair[1]!.screen.x, xPair[1]!.screen.y, numText(xPair[1]!.graph.x), '0');
      calib.addPoint(yPair[0]!.screen.x, yPair[0]!.screen.y, '0', numText(yPair[0]!.graph.y));
      calib.addPoint(yPair[1]!.screen.x, yPair[1]!.screen.y, '0', numText(yPair[1]!.graph.y));
      if (pts.length > 4) note = `The file held ${pts.length} axis points; the four that fix the scales were used.`;
      return { calib, note };
    }
  }

  // No "L" — Engauge lets the three points sit anywhere, so fall back to the
  // general case: solve the affine map the three correspondences define, then
  // express it as the four points our axes wants. Still exact (three
  // correspondences determine an affine map uniquely), but the calibration will
  // read back in round numbers of our choosing rather than the ones typed into
  // Engauge, so the caller says so.
  return buildXYFromAffine(pts, isLogX, isLogY);
}

/** Format a number for Calibration, which parses its values as TEXT.
 *
 * ⚑ NOT cosmetic — this is load-bearing. `InputParser.parse` tries a DATE first,
 * and a bare JavaScript number in 0..23 parses as an hour-of-day: `parse(0)`
 * returns a 2026 timestamp while `parse('0')` returns 0. Passing numbers here
 * therefore turned ordinary axis values like 0, 1 and 10 into dates and silently
 * produced calibrations off by ~1.8e12. Everything that feeds Calibration must
 * pass strings, exactly as the interactive path does. */
function numText(n: number): string {
  return String(n);
}

/** 2x2 inverse, or null when singular. */
function inv2(m: [number, number, number, number]): [number, number, number, number] | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
}

/**
 * The general three-point case: recover the affine map, then re-express it as
 * the two axis-aligned point pairs our XYAxes consumes.
 *
 * Our axes builds its transform from the two pixel difference vectors and the
 * anchor values, so handing it the pre-images of
 *   (x0,y0) (x1,y0)   — differing only in X
 *   (x0,y0) (x0,y1)   — differing only in Y
 * reproduces the identical map. Values are chosen inside the figure's own range
 * so the calibration still reads sensibly to a human.
 */
function buildXYFromAffine(
  pts: DigAxisPoint[],
  isLogX: boolean,
  isLogY: boolean
): { calib: Calibration; note: string | null } | null {
  if (pts.length < 3) return null;
  const [p1, p2, p3] = [pts[0]!, pts[1]!, pts[2]!];

  // Work in the space the scale is linear in: a log axis is affine in log10.
  const fx = (v: number) => (isLogX ? Math.log10(v) : v);
  const fy = (v: number) => (isLogY ? Math.log10(v) : v);
  const gx = [fx(p1.graph.x), fx(p2.graph.x), fx(p3.graph.x)];
  const gy = [fy(p1.graph.y), fy(p2.graph.y), fy(p3.graph.y)];
  if (![...gx, ...gy].every((v) => Number.isFinite(v))) return null; // log of <= 0

  // A·(sᵢ − s₃) = (gᵢ − g₃)  for i = 1,2   →   A = N·M⁻¹
  const M: [number, number, number, number] = [
    p1.screen.x - p3.screen.x, p2.screen.x - p3.screen.x,
    p1.screen.y - p3.screen.y, p2.screen.y - p3.screen.y,
  ];
  const N: [number, number, number, number] = [
    gx[0]! - gx[2]!, gx[1]! - gx[2]!,
    gy[0]! - gy[2]!, gy[1]! - gy[2]!,
  ];
  const Minv = inv2(M);
  if (!Minv) return null; // the three points are collinear on screen
  const A: [number, number, number, number] = [
    N[0] * Minv[0] + N[1] * Minv[2], N[0] * Minv[1] + N[1] * Minv[3],
    N[2] * Minv[0] + N[3] * Minv[2], N[2] * Minv[1] + N[3] * Minv[3],
  ];
  const Ainv = inv2(A);
  if (!Ainv) return null; // the axes are degenerate — no invertible mapping
  const C = [gx[2]! - (A[0] * p3.screen.x + A[1] * p3.screen.y), gy[2]! - (A[2] * p3.screen.x + A[3] * p3.screen.y)];

  // Pick two distinct values per axis, spanning what the file actually used.
  const span = (vals: number[]): [number, number] => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return hi - lo > 1e-12 ? [lo, hi] : [lo, lo + 1];
  };
  const [x0, x1] = span(gx);
  const [y0, y1] = span(gy);

  // Pre-image of a graph point under the recovered map.
  const pre = (X: number, Y: number) => ({
    x: Ainv[0] * (X - C[0]!) + Ainv[1] * (Y - C[1]!),
    y: Ainv[2] * (X - C[0]!) + Ainv[3] * (Y - C[1]!),
  });
  const P1 = pre(x0, y0);
  const P2 = pre(x1, y0);
  const P3 = pre(x0, y0);
  const P4 = pre(x0, y1);

  // Back to natural units — our axes re-applies the log itself.
  const ux = (v: number) => (isLogX ? Math.pow(10, v) : v);
  const uy = (v: number) => (isLogY ? Math.pow(10, v) : v);

  const calib = new Calibration(2);
  calib.addPoint(P1.x, P1.y, numText(ux(x0)), '0');
  calib.addPoint(P2.x, P2.y, numText(ux(x1)), '0');
  calib.addPoint(P3.x, P3.y, '0', numText(uy(y0)));
  calib.addPoint(P4.x, P4.y, '0', numText(uy(y1)));
  return {
    calib,
    note:
      "This project's three axis points were not placed on the axes themselves, so the calibration was rebuilt as an equivalent pair of X and Y reference points. The data values are unchanged.",
  };
}

/**
 * Build our polar calibration from Engauge's axis points.
 *
 * Engauge stores polar axis points with theta in the graph X slot and radius in
 * graph Y. Our PolarAxes wants the origin first, then two points carrying the
 * radial scale. The origin is the point whose radius is zero — identified from
 * the file, not assumed to be first.
 */
function buildPolarCalibration(pts: DigAxisPoint[]): Calibration | null {
  const origin = pts.find((p) => Math.abs(p.graph.y) < 1e-12);
  const radial = pts.filter((p) => p !== origin && Math.abs(p.graph.y) > 1e-12);
  if (!origin || radial.length < 2) return null;
  // Strings, not numbers — see numText for why that distinction is load-bearing.
  const calib = new Calibration(2);
  calib.addPoint(origin.screen.x, origin.screen.y, '0', '0');
  calib.addPoint(radial[0]!.screen.x, radial[0]!.screen.y, numText(radial[0]!.graph.y), numText(radial[0]!.graph.x));
  calib.addPoint(radial[1]!.screen.x, radial[1]!.screen.y, numText(radial[1]!.graph.y), numText(radial[1]!.graph.x));
  return calib;
}

/**
 * Turn a parsed `.dig` into our axes and datasets.
 *
 * Refuses rather than guessing: an uncalibrated document, or one whose axis
 * points cannot fix a system, returns an error the UI can show instead of
 * opening a figure whose numbers would be quietly wrong.
 */
export function importEngaugeFigure(project: DigProject): DigResult<ImportedDigFigure> {
  const notes: string[] = [];
  if (project.extraCoordSystems > 0) {
    notes.push(
      `This project held ${project.extraCoordSystems + 1} coordinate systems; the first was opened and the rest were not imported.`
    );
  }
  if (project.thetaNote) notes.push(project.thetaNote);
  if (!project.imageDataURL) {
    notes.push("This project's image could not be read, so the figure opens without it.");
  }

  let axes: AnyAxes;
  let configId: string;

  if (project.coordsType === 'Polar') {
    const calib = buildPolarCalibration(project.axisPoints);
    if (!calib) {
      return {
        error:
          "This Engauge project's polar axes are incomplete — PlotTracer needs the centre point and two points at a known radius.",
      };
    }
    const polar = new PolarAxes();
    // Engauge measures theta counterclockwise; is_clockwise stays false.
    if (!polar.calibrate(calib, project.thetaInDegrees, false, project.isLogY)) {
      return { error: "This Engauge project's polar axes could not be calibrated." };
    }
    axes = polar as AnyAxes;
    configId = 'polar';
  } else {
    const built = buildXYCalibration(project.axisPoints, project.isLogX, project.isLogY);
    if (!built) {
      return {
        error:
          project.axisPoints.length === 0
            ? 'This Engauge project has no axis points, so it was never calibrated.'
            : `This Engauge project's ${project.axisPoints.length} axis points do not fix an X and a Y scale, so PlotTracer cannot calibrate it.`,
      };
    }
    if (built.note) notes.push(built.note);
    const xy = new XYAxes();
    if (!xy.calibrate(built.calib, project.isLogX, project.isLogY, false)) {
      return {
        error:
          project.isLogX || project.isLogY
            ? "This Engauge project's log axes could not be calibrated — a log scale needs axis values greater than zero."
            : "This Engauge project's axes could not be calibrated.",
      };
    }
    axes = xy as AnyAxes;
    configId = 'xy';
  }

  const datasets: Dataset[] = [];
  for (const curve of project.curves) {
    const ds = new Dataset();
    ds.name = curve.name;
    for (const p of curve.points) ds.addPixel(p.x, p.y);
    datasets.push(ds);
  }
  // An empty curve is kept, not dropped: the user named it in Engauge, and a
  // silently missing series is worse than an empty one.
  if (datasets.length === 0) {
    const ds = new Dataset();
    ds.name = 'Data';
    datasets.push(ds);
  }

  return { configId, axes, datasets, imageDataURL: project.imageDataURL, notes };
}
