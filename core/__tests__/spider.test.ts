import { describe, expect, it } from 'vitest';
import { SpiderAxes } from '../axes/spider.js';
import { Calibration } from '../calibration.js';

/**
 * SpiderAxes - v1.4. Original work, no upstream counterpart to compare against, so
 * these tests are written against the GEOMETRY rather than against a reference
 * implementation's output.
 *
 * The figure used throughout: origin at (100,100), three spokes of length 100px at
 * 12 o'clock, 4 o'clock and 8 o'clock - deliberately UNEQUALLY spaced in one test,
 * because equal angles are exactly what the only prior art (ChartSense, CHI 2017)
 * assumes and this model does not.
 *
 * Note the pixel convention: y grows DOWNWARD, so "up the page" is -y.
 */

/** Origin + one known point per spoke. `spokes` = [px, py, knownValue, centreValue, name]. */
function calibrateSpider(
  spokes: Array<[number, number, string, string, string]>,
  isLog = false,
  origin: [number, number] = [100, 100]
): { ok: boolean; axes: SpiderAxes } {
  const cal = new Calibration(3);
  cal.addPoint(origin[0], origin[1], '0', '0', '');
  for (const [px, py, known, centre, name] of spokes) {
    cal.addPoint(px, py, known, centre, name);
  }
  const axes = new SpiderAxes();
  return { ok: axes.calibrate(cal, isLog), axes };
}

/** The standard three-spoke figure: N at 100px, and two others 120 degrees round. */
function threeSpokes(): SpiderAxes {
  const { ok, axes } = calibrateSpider([
    [100, 0, '100', '0', 'Strength'],
    [186.6025403784439, 150, '10', '0', 'Weight'],
    [13.39745962155616, 150, '5', '0', 'Cost'],
  ]);
  expect(ok).toBe(true);
  return axes;
}

describe('SpiderAxes.calibrate', () => {
  it('accepts a variable number of spokes - the figure decides, not the class', () => {
    // Every other axes type has a FIXED point count baked in (XY 4, Bar 2, Polar 3,
    // Ternary 3, CCR 5). A spider has as many axes as the chart drew.
    for (const n of [1, 3, 5, 12]) {
      const spokes: Array<[number, number, string, string, string]> = [];
      for (let i = 0; i < n; i++) {
        const angle = (2 * Math.PI * i) / n;
        spokes.push([100 + 100 * Math.sin(angle), 100 - 100 * Math.cos(angle), '10', '0', `A${i}`]);
      }
      const { ok, axes } = calibrateSpider(spokes);
      expect(ok).toBe(true);
      expect(axes.getSpokeCount()).toBe(n);
    }
  });

  it('refuses an origin with no spokes - that is not a scale', () => {
    const cal = new Calibration(3);
    cal.addPoint(100, 100, '0', '0', '');
    const axes = new SpiderAxes();
    expect(axes.calibrate(cal, false)).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('refuses a spoke point placed ON the origin - no direction, no length', () => {
    const { ok } = calibrateSpider([[100, 100, '10', '0', 'A']]);
    expect(ok).toBe(false);
  });

  it('refuses a centre equal to the known value - every pixel would read the same', () => {
    // The spider analogue of Polar's RadialDistinctGuard: two points at the same
    // value give a zero scale, and an unguarded class would report success and then
    // hand back a constant for the whole figure.
    const { ok } = calibrateSpider([[100, 0, '50', '50', 'A']]);
    expect(ok).toBe(false);
  });

  it('refuses non-numeric and date values rather than reporting success', () => {
    // Same class of finding as BarAxes checkpoint 81: a date PARSES to a number
    // (its serial), so a bare typeof check would record a julian day count.
    expect(calibrateSpider([[100, 0, 'abc', '0', 'A']]).ok).toBe(false);
    expect(calibrateSpider([[100, 0, '1,000', '0', 'A']]).ok).toBe(false);
    expect(calibrateSpider([[100, 0, '5 kg', '0', 'A']]).ok).toBe(false);
    expect(calibrateSpider([[100, 0, '2024/01/01', '0', 'A']]).ok).toBe(false);
    expect(calibrateSpider([[100, 0, '10', 'abc', 'A']]).ok).toBe(false);
  });

  it('refuses a non-positive value on a LOG spoke, centre included', () => {
    // ⚑ The 0-preselected centre is exactly what makes this reachable: a log radial
    // axis cannot have 0 at the middle. The faithful WPD polar port did
    // Math.log(0) -> -Infinity and still reported success.
    expect(calibrateSpider([[100, 0, '100', '0', 'A']], true).ok).toBe(false);
    expect(calibrateSpider([[100, 0, '0', '1', 'A']], true).ok).toBe(false);
    expect(calibrateSpider([[100, 0, '100', '-1', 'A']], true).ok).toBe(false);
    expect(calibrateSpider([[100, 0, '100', '1', 'A']], true).ok).toBe(true);
  });

  it('stores the centre value PER SPOKE, so a per-axis override needs no migration', () => {
    // The UI asks once; the FILE keeps one copy per axis. This is the storage rule
    // that keeps a workflow simplification out of the record.
    const { axes } = calibrateSpider([
      [100, 0, '100', '20', 'A'],
      [200, 100, '5', '20', 'B'],
    ]);
    expect(axes.getSpokes().map((s) => s.centreValue)).toEqual([20, 20]);
  });

  it('gives every spoke its OWN scale - unequal ranges work by construction', () => {
    // ChartSense assumes all axes share one scale and excludes 2.58% of its own
    // corpus for failing that. Placing a known point on each axis gives per-axis
    // ranges for free.
    const axes = threeSpokes();
    // Halfway out along each spoke reads half of that spoke's own range.
    expect(axes.projectOnSpoke(0, 100, 50)!.value).toBeCloseTo(50, 10);
    expect(axes.projectOnSpoke(1, 143.3012701892219, 125)!.value).toBeCloseTo(5, 10);
    expect(axes.projectOnSpoke(2, 56.69872981077808, 125)!.value).toBeCloseTo(2.5, 10);
  });

  it('handles UNEQUAL angles between adjacent spokes', () => {
    // The other ChartSense assumption (another 2.58% of their corpus). Nothing here
    // infers a spoke's direction by rotating a neighbour - each is measured.
    const { ok, axes } = calibrateSpider([
      [100, 0, '10', '0', 'A'],
      [200, 100, '10', '0', 'B'],
      [100, 130, '10', '0', 'C'], // only 60 degrees on from B, not 120
    ]);
    expect(ok).toBe(true);
    expect(axes.projectOnSpoke(2, 100, 115)!.value).toBeCloseTo(5, 10);
  });

  it('leaves an unnamed spoke unnamed, and falls back positionally for display', () => {
    // A name is transcription, not measurement - so an absent one is not invented.
    const { axes } = calibrateSpider([[100, 0, '10', '0', '']]);
    expect(axes.getSpokes()[0]!.name).toBe('');
    expect(axes.getSpokeLabel(0)).toBe('Axis 1');
  });
});

describe('SpiderAxes.projectOnSpoke', () => {
  it('reads the value at the origin and at the known point', () => {
    const axes = threeSpokes();
    expect(axes.projectOnSpoke(0, 100, 100)!.value).toBeCloseTo(0, 10);
    expect(axes.projectOnSpoke(0, 100, 0)!.value).toBeCloseTo(100, 10);
  });

  it('reports the PERPENDICULAR distance from the ray, so a wrong-spoke click can be warned about', () => {
    // ⚑ The whole point of not silently snapping to the nearest ray. A click 30px to
    // the side of spoke 0 still yields a value - projected - but says how far off it
    // was, which is what the capture workflow warns on.
    const axes = threeSpokes();
    const projection = axes.projectOnSpoke(0, 130, 50)!;
    expect(projection.value).toBeCloseTo(50, 10);
    expect(projection.offRayPx).toBeCloseTo(30, 10);
  });

  it('reports zero off-ray distance for a click exactly on the ray', () => {
    const axes = threeSpokes();
    expect(axes.projectOnSpoke(1, 143.3012701892219, 125)!.offRayPx).toBeCloseTo(0, 10);
  });

  it('reports a NEGATIVE along-distance behind the origin, rather than folding it', () => {
    // A click on the opposite side of the centre is a real mistake worth surfacing,
    // not an absolute value to be quietly accepted as a small positive reading.
    const axes = threeSpokes();
    const projection = axes.projectOnSpoke(0, 100, 150)!;
    expect(projection.alongPx).toBeCloseTo(-50, 10);
    expect(projection.value).toBeCloseTo(-50, 10);
  });

  it('projects against the spoke it was ASKED about, not the nearest one', () => {
    // Capture knows which axis the cursor is on. If this used nearest-ray it would
    // record a mis-clicked point against a different axis with nothing on screen wrong.
    const axes = threeSpokes();
    // A pixel sitting right on spoke 1, but asked about as spoke 0.
    const asAsked = axes.projectOnSpoke(0, 186.6025403784439, 150)!;
    expect(asAsked.index).toBe(0);
    expect(asAsked.offRayPx).toBeGreaterThan(50);
  });

  it('returns null for a spoke index the calibration does not have', () => {
    const axes = threeSpokes();
    expect(axes.projectOnSpoke(3, 100, 50)).toBeNull();
    expect(axes.projectOnSpoke(-1, 100, 50)).toBeNull();
  });

  it('reads a LOG spoke geometrically, not linearly', () => {
    // Centre 1, known point 100 at 100px: the midpoint is 10, not 50.5.
    const { axes } = calibrateSpider([[100, 0, '100', '1', 'A']], true);
    expect(axes.projectOnSpoke(0, 100, 50)!.value).toBeCloseTo(10, 10);
    expect(axes.projectOnSpoke(0, 100, 100)!.value).toBeCloseTo(1, 10);
    expect(axes.projectOnSpoke(0, 100, 0)!.value).toBeCloseTo(100, 10);
  });

  it('honours a non-zero shared centre - an axis truncated at 20', () => {
    const { axes } = calibrateSpider([[100, 0, '100', '20', 'A']]);
    expect(axes.projectOnSpoke(0, 100, 100)!.value).toBeCloseTo(20, 10);
    expect(axes.projectOnSpoke(0, 100, 50)!.value).toBeCloseTo(60, 10);
  });
});

describe('SpiderAxes.nearestSpoke and pixelToData', () => {
  it('picks the spoke a pixel actually lies on', () => {
    const axes = threeSpokes();
    expect(axes.nearestSpoke(100, 40)!.index).toBe(0);
    expect(axes.nearestSpoke(160, 135)!.index).toBe(1);
    expect(axes.nearestSpoke(40, 135)!.index).toBe(2);
  });

  it('pixelToData reads one value, off the nearest spoke - the live-readout contract', () => {
    const axes = threeSpokes();
    expect(axes.pixelToData(100, 50)).toHaveLength(1);
    expect(axes.pixelToData(100, 50)[0]).toBeCloseTo(50, 10);
  });

  it('names the axis in the live string, so the readout says WHICH spoke', () => {
    const axes = threeSpokes();
    expect(axes.pixelToLiveString(100, 50)).toContain('Strength');
  });

  it('reads NaN rather than throwing when it was never calibrated', () => {
    const axes = new SpiderAxes();
    expect(axes.pixelToData(10, 10)[0]).toBeNaN();
    expect(axes.pixelToLiveString(10, 10)).toBe('');
  });
});

describe('nearestSpoke on an EVEN axis count - the collinear-opposites trap', () => {
  /** Six equally spaced spokes, so axis i and axis i+3 are exactly opposite. */
  function sixSpokes(): SpiderAxes {
    const spokes: Array<[number, number, string, string, string]> = [];
    for (let i = 0; i < 6; i++) {
      const angle = (2 * Math.PI * i) / 6;
      spokes.push([100 + 100 * Math.sin(angle), 100 - 100 * Math.cos(angle), '100', '0', `A${i}`]);
    }
    const { ok, axes } = calibrateSpider(spokes);
    expect(ok).toBe(true);
    return axes;
  }

  it('⚑ picks the ray a point is ON, not its exact opposite', () => {
    // Found by driving the six-axis sample: the app said a click was "0 px off the
    // Cost index axis and nearer Water-vapour barrier" - impossible, and produced
    // by measuring to the infinite LINE, on which an opposite spoke is identical.
    // Every unit fixture had three spokes, which has no opposite pairs.
    const axes = sixSpokes();
    for (let i = 0; i < 6; i++) {
      const angle = (2 * Math.PI * i) / 6;
      const px = 100 + 60 * Math.sin(angle);
      const py = 100 - 60 * Math.cos(angle);
      expect(axes.nearestSpoke(px, py)!.index).toBe(i);
    }
  });

  it('reports zero off-ray distance for the spoke it picks', () => {
    // The self-contradiction the screenshot showed: a nonzero "nearer" verdict
    // alongside a zero distance. If the pick is right, the distance agrees with it.
    const axes = sixSpokes();
    const angle = (2 * Math.PI * 5) / 6;
    const nearest = axes.nearestSpoke(100 + 60 * Math.sin(angle), 100 - 60 * Math.cos(angle))!;
    expect(nearest.index).toBe(5);
    expect(nearest.offRayPx).toBeCloseTo(0, 9);
  });

  it('treats a point BEHIND the centre as belonging to the ray it faces', () => {
    // A spoke runs one way. Something behind the origin is not "on" it at a
    // negative distance; the spoke pointing at it is the nearer one.
    const axes = sixSpokes();
    // Straight down from the centre = the opposite of axis 0, which is axis 3.
    expect(axes.nearestSpoke(100, 160)!.index).toBe(3);
    expect(axes.nearestSpoke(100, 160)!.alongPx).toBeGreaterThan(0);
  });

  it('falls back to the centre distance when every ray points away', () => {
    // At the origin itself nothing is "nearer" by perpendicular offset - all are
    // zero - so the answer must at least be a real spoke rather than undefined.
    const axes = sixSpokes();
    expect(axes.nearestSpoke(100, 100)).not.toBeNull();
  });
});

describe('SpiderAxes.dataToPixel', () => {
  it('is a REAL inverse (as BarAxes now also has, since v2.0)', () => {
    // Polar/Ternary/Map/CCR still ship WPD's unimplemented dataToPixel, and
    // export precision has to degrade around them. A spoke is an invertible
    // 1-D scale, so nothing needs to degrade here.
    const axes = threeSpokes();
    const pixel = axes.dataToPixel(0, 50);
    expect(pixel.x).toBeCloseTo(100, 10);
    expect(pixel.y).toBeCloseTo(50, 10);
  });

  it('round-trips every spoke, including a log one', () => {
    const axes = threeSpokes();
    for (let i = 0; i < axes.getSpokeCount(); i++) {
      for (const value of [1, 2.5, 7]) {
        const pixel = axes.dataToPixel(i, value);
        expect(axes.projectOnSpoke(i, pixel.x, pixel.y)!.value).toBeCloseTo(value, 8);
      }
    }
    const { axes: logAxes } = calibrateSpider([[100, 0, '1000', '1', 'A']], true);
    const pixel = logAxes.dataToPixel(0, 37);
    expect(logAxes.projectOnSpoke(0, pixel.x, pixel.y)!.value).toBeCloseTo(37, 8);
  });

  it('answers NaN - never {0,0} - where there is no pixel', () => {
    // ⚑ {0,0} is BOTH a real image coordinate and the sentinel every stubbed
    // dataToPixel returns, so answering it here would be indistinguishable from
    // "this type cannot invert" and would draw a point in the corner of the image.
    const { axes } = calibrateSpider([[100, 0, '100', '1', 'A']], true);
    for (const pixel of [axes.dataToPixel(0, 0), axes.dataToPixel(0, -5), threeSpokes().dataToPixel(9, 1), new SpiderAxes().dataToPixel(0, 1)]) {
      expect(pixel.x).toBeNaN();
      expect(pixel.y).toBeNaN();
    }
  });
});
