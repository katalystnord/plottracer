/**
 * B1 + B2 — ⚑⚑ THE WHISKER'S END *IS* THE CAP. THERE IS NO SECOND OBJECT.
 *
 * David's design, 2026-08-16: *"The 'balls' on the error bar are not working
 * well from a UI experience. They are moved independently from the bars when
 * moving them, and it just does not look so good. Instead… we remove the
 * 'balls' and we make the end of the handles a bit bigger instead, and the end
 * of the handles IS where the balls currently are. Let's keep the end of the
 * handles black, and the line that goes to them a colour."*
 *
 * ⚑⚑ IT IS A FIX, NOT A PREFERENCE, and the mechanism is confirmed in the
 * source: the whisker is a `<Line>` built from the MODEL with
 * `listening={false}`, so it moves on RELEASE; the ball is a draggable marker,
 * which Konva moves LIVE. One representation is frozen while the other tracks
 * the cursor, and they visibly separate. **Collapsing them into one object makes
 * the drift inexpressible** rather than fixed-and-refixable — the strongest kind
 * of fix, and the shape this project keeps getting bitten by (CLAUDE.md pattern
 * 4: the picture lies while the model is correct).
 *
 * ⚠️ B4 made this urgent rather than optional. A cap used to be a pixel of its
 * OWN series, so its dot was only drawn when you activated that series. Now it
 * is a pixel of the datum's series — so every error bar draws a numbered data
 * dot on top of its own cap tick, all the time.
 *
 * ⚑ NO NEW SHAPE VOCABULARY IS NEEDED, and that was worth checking before
 * inventing one: round = a data dot and the calibration reticle, square = an
 * `aid` you are meant to drag by eye. A cap is neither — and
 * `computeWhiskerGlyph` has always drawn a perpendicular TICK at the cap, which
 * is also what matplotlib's `capsize` draws. The figure's own convention was
 * already in the code.
 */
import { describe, it, expect } from 'vitest';
import { computeWhiskerGlyph } from '../errorBarGlyph.js';
import { buildCanvasMarkers, dataPointMarkerId } from '../canvasOverlays.js';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';
import type { CanvasMarkerInput } from '../canvasOverlays.js';

/** x 0..10 over px 100..300; y 0..10 over py 300..100. */
function session() {
  const s = new CalibrationSession(XY_AXES_CONFIG);
  for (const [px, py, v] of [
    [100, 300, '0'],
    [300, 300, '10'],
    [100, 300, '0'],
    [100, 100, '10'],
  ] as Array<[number, number, string]>) {
    s.handleCalibrationClick(px, py);
    s.confirmCalibrationValues([v]);
  }
  s.runCalibration();
  s.setDatasetColor(0, [200, 100, 50]);
  s.addDataPoint(200, 200);
  expect(
    s.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 200, y: 200 },
      capPixel: { x: 200, y: 160 },
      baseName: 'SD',
    })
  ).toBeNull();
  return s;
}

describe('the whisker is one object with two parts', () => {
  it('names its parts, so a renderer cannot colour them by position', () => {
    // It used to return `[bar, tick]` and the caller indexed in. B2 gives the
    // two parts DIFFERENT colours, so "segment 1" being the tick stopped being a
    // detail and became a contract — and the degenerate case returns a
    // one-element array, which would have made `segs[1]` the tick sometimes and
    // undefined other times.
    const w = computeWhiskerGlyph({ x: 100, y: 100 }, { x: 100, y: 40 });
    expect(w.bar).toEqual({ from: { x: 100, y: 100 }, to: { x: 100, y: 40 } });
    expect(w.cap.from.y).toBeCloseTo(40);
    expect(w.cap.to.y).toBeCloseTo(40);
    expect((w.cap.from.x + w.cap.to.x) / 2).toBeCloseTo(100);
  });

  it('⚑ a cap sitting ON its datum still has a visible cap and an empty bar', () => {
    // Zero error is a claim of perfect certainty — more dangerous here than a
    // wrong number — so it must never render as nothing at all.
    const w = computeWhiskerGlyph({ x: 100, y: 100 }, { x: 100, y: 100 });
    expect(Math.hypot(w.cap.to.x - w.cap.from.x, w.cap.to.y - w.cap.from.y)).toBeGreaterThan(0);
    expect(w.bar.from).toEqual(w.bar.to);
  });
});

describe('a whisker carries what the renderer needs to draw and bind it', () => {
  it("⚑ the BAR takes the series' colour — the cap is black, always", () => {
    // Two colours on one glyph, and the reason is legibility against the ink:
    // the bar says WHICH series this uncertainty belongs to, the black end says
    // WHERE the reading is. A single-colour whisker made the cap the same weight
    // as the line to it.
    const whiskers = session().getErrorWhiskers();
    expect(whiskers).toHaveLength(2); // the drag plus its mirror
    for (const w of whiskers) expect(w.color).toEqual([200, 100, 50]);
  });

  it('⚑⚑ it names the marker its cap is, so the drawing can follow a live drag', () => {
    // The binding that makes the drift inexpressible. During a drag Konva moves
    // the marker and nothing else; with the whisker able to say WHICH marker its
    // cap is, the renderer redraws the bar and the tick from that live position
    // instead of from a model that updates on release.
    const s = session();
    const whiskers = s.getErrorWhiskers();
    const capPixels = s.getCapPixelRoles(0).flatMap((c, i) => (c ? [i] : []));
    expect(capPixels).toHaveLength(2);
    expect(whiskers.map((w) => w.capMarkerId).sort()).toEqual(capPixels.map(dataPointMarkerId).sort());
  });

  it('⚑ a cap of an INACTIVE series names no marker — it has none to name', () => {
    const s = session();
    s.addDataset('Series 2');
    s.setActiveDataset(1);
    expect(s.getErrorWhiskers().every((w) => w.capMarkerId === undefined)).toBe(true);
  });
});

describe('the cap marker', () => {
  function base(over: Partial<CanvasMarkerInput> = {}): CanvasMarkerInput {
    return {
      steps: [],
      placedPoints: {},
      pendingPixel: null,
      pendingPixelColor: '#pending',
      dataPoints: [
        { px: 10, py: 10 },
        { px: 10, py: 4 },
      ],
      dataPointRoles: [],
      capRoles: [null, { role: 'upper', line: null }],
      allDatasetsData: [],
      datasetInfos: [{ active: true, color: [1, 2, 3] }],
      fallbackColor: '#fallback',
      axesKind: 'xy',
      isCalibrated: true,
      labelAway: undefined,
      ringClosingIndex: null,
      mode: 'place-point',
      activeHandleKey: null,
      activePointIndex: null,
      selectedPointIndices: [],
      activeDatasetIndex: 0,
      errorTargetIndex: 0,
      ...over,
    };
  }

  it('⚑⚑ is declared a CAP, so the renderer draws no dot of its own', () => {
    // The whole of B1 in one field. The datum keeps its dot; the cap's only
    // drawn form is the whisker's tick, and this marker exists to be GRABBED.
    const markers = buildCanvasMarkers(base()).filter((m) => m.id.startsWith('point-'));
    expect(markers[0]!.kind).toBeUndefined();
    expect(markers[1]!.kind).toBe('cap');
  });

  it('⚑⚑ it carries the line its drag is confined to, so the gesture cannot lean', () => {
    // ⚠️ SEEN ON THE BUILT APP, once the whisker started following the drag
    // live: the bar leaned diagonally under the cursor and snapped vertical on
    // release. The MODEL was right the whole time — `updateDataPointPixel` runs
    // every cap through `errorCapDragLine` + `constrainCap` — but a constrained
    // gesture that is not bound to its constraint ON SCREEN teaches the user
    // that a diagonal error bar is something they might get. Pattern 4, and the
    // same `dragBoundFunc` projection the colour key's handle already uses.
    //
    // ⚑ It must come from `errorCapDragLine`, not from the drawn bar's current
    // direction: a check computed differently from the thing it checks is not a
    // check.
    const s = session();
    const caps = s.getCapPixelRoles(0).flatMap((c) => (c ? [c] : []));
    expect(caps).toHaveLength(2);
    for (const cap of caps) {
      expect(cap.line, 'an XY axes can say which way its value runs').not.toBeNull();
      // The datum, and straight up the screen on this un-rotated calibration.
      expect(cap.line!.origin).toEqual({ x: 200, y: 200 });
      expect(Math.abs(cap.line!.direction.x)).toBeCloseTo(0, 6);
      expect(Math.abs(cap.line!.direction.y)).toBeCloseTo(1, 6);
    }
  });

  it('⚑ a marker for an unconstrained cap carries no line at all', () => {
    // Absent, not a fabricated vertical: polar, ternary, map and ccr cannot say
    // which way their value runs, and a free cap is the documented default
    // there. A drawn constraint they do not have would be a claim, not an aid.
    const markers = buildCanvasMarkers(base()).filter((m) => m.id.startsWith('point-'));
    expect(markers[1]!.kind).toBe('cap');
    expect(markers[1]!.dragLine).toBeUndefined();
  });

  it('⚑ its id is the one the whisker names', () => {
    const markers = buildCanvasMarkers(base()).filter((m) => m.id.startsWith('point-'));
    expect(markers[1]!.id).toBe(dataPointMarkerId(1));
  });
});
