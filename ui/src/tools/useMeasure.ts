import { useCallback, useMemo, useRef, useState } from 'react';
import { resolveMeasureClick, scaleFromDraft, snapToNearestPoint } from '../../../engine/measureCapture.js';
import { samplePixelRgb } from '../../../algorithms/samplePixel.js';
import type { ColorScale } from '../../../algorithms/colorScale.js';
import { buildColorScale } from '../../../engine/heatmapRun.js';
import type { CalibrationSession, CalibratedAxes } from '../../../engine/calibrationSession.js';
import { fmtNum } from '../format.js';
import { measureDisplay, type MeasureScaleState, type RecordedMeasurement } from './measureDisplay.js';
import type { MeasureRef, MeasureToolId, Measurement, SetScaleDraft } from '../MeasureCard.js';
import type { MeasureOverlay } from '../ImageCanvas.js';

/**
 * THE MEASURE TOOL'S STATE MACHINE (v2.3, theme G).
 *
 * ⚑⚑ THE TOOL LIVES HERE; THE COLLECTION DOES NOT. Measurements are DOCUMENT
 * state - the project file carries them, every figure record stashes them, every
 * undo snapshot captures them - so they stay with the document and arrive here
 * through the host. What moved is what belongs to the INSTRUMENT: which tool is
 * armed, the points placed so far, the set-scale draft, the refusal on screen,
 * and the handlers that move between those states.
 *
 * ⚑⚑ THE HOST IS ALL GETTERS, AND THAT IS THE WHOLE SAFETY ARGUMENT. The
 * alternative - passing values - captures them in every `useCallback` closure,
 * and a stale one here means the snap threshold uses yesterday's zoom or a click
 * routes against the previous axes. That failure is INVISIBLE to the test suite
 * and shows up only under someone's hands, which is the worst thing to add
 * before a stable release. Reading through a function means nothing is captured:
 * every call sees what the component sees now. `useTraceChallenge` established
 * this shape (F1); this file follows it rather than inventing a second one.
 *
 * ⚑ Workspace destructures the return into the SAME local names it used before,
 * so not one call site or JSX reference had to change - the move is provably
 * behaviour-preserving at every point of use.
 */
export interface MeasureHost {
  /** The live calibration session - read for the points a click can snap to. */
  session: () => CalibrationSession<CalibratedAxes>;
  /** The calibrated axes, or null. A slope needs them; nothing else does. */
  axes: () => CalibratedAxes | null;
  /** Which axes CLASS this is - `xy` is what makes a slope measurable. */
  axesKind: () => string;
  /** Current zoom, so the snap radius feels the same at every magnification. */
  canvasScale: () => number;
  /** The image's native pixels, for the Colour instrument's own reading. */
  imageData: () => { data: Uint8ClampedArray; width: number; height: number } | null | undefined;
  /** The document's measurement collection, and how to replace it. */
  measurements: () => RecordedMeasurement[];
  applyMeasurements: (next: RecordedMeasurement[]) => void;
  /** The px->unit reference, and how to set it. Document state as well: it is
   * saved with the figure and re-read by every measurement. */
  measureScale: () => MeasureScaleState | null;
  applyMeasureScale: (next: MeasureScaleState | null) => void;
  /** The placed calibration handles and the log-value option, for building the
   * colour key. ⚑ The KEY itself is built in here rather than passed in: it is
   * the Colour instrument's own reference, it is gated on that tool being armed,
   * and building it outside would have made the tool's state and its reference
   * declare each other. */
  keyInputs: () => { placed: Parameters<typeof buildColorScale>[0]; isLog: boolean };
  /** A version counter that changes whenever the calibration does. */
  calibrationVersion: () => number;
  /** A counter that changes whenever a new picture has been decoded. ⚑ The key
   * is SAMPLED OUT OF THE IMAGE, so the image is one of its inputs - and the
   * only one that moves without the calibration moving with it. */
  imageEpoch: () => number;
  /** Push an undo entry. */
  commit: () => void;
}

export function useMeasure(host: MeasureHost) {
  const [measureTool, setMeasureTool] = useState<MeasureToolId | null>('slope');
  const [pendingMeasure, setPendingMeasure] = useState<{ x: number; y: number }[]>([]);
  const pendingMeasureRef = useRef<{ x: number; y: number }[]>([]);
  const setPending = useCallback((pts: { x: number; y: number }[]) => {
    pendingMeasureRef.current = pts;
    setPendingMeasure(pts);
  }, []);
  const [measureError, setMeasureError] = useState<string | null>(null);
  const measureIdRef = useRef(0);
  const [settingScale, setSettingScale] = useState(false);
  const [scaleDraftPx, setScaleDraftPx] = useState<number | null>(null);
  const [scaleValueInput, setScaleValueInput] = useState('');
  const [scaleUnitInput, setScaleUnitInput] = useState('mm');
  const [activeMeasure, setActiveMeasure] = useState<{ id: string; vertex: number } | null>(null);

  /**
   * The calibrated colour key, for the Colour instrument to read against.
   *
   * ⚑ BUILT ONLY WHEN SOMETHING NEEDS IT: `buildColorScale` re-samples the key
   * out of the image, which is a full-canvas readback, so a figure with no
   * colour measurement never pays for one.
   * ⚑ ARMED COUNTS, not just recorded. Gating on existing measurements alone
   * made the tips line deny the key until the first click had already been
   * taken - the answer to "will this give me a value?" arriving one gesture
   * after the question.
   */
  const measurementsNow = host.measurements();
  // ⚑ Hoisted out of the dependency list: a call expression cannot be a dep, and
  // the version is what says the calibration moved - which is when the key must
  // be re-sampled.
  const calibrationVersion = host.calibrationVersion();
  // ⚑⚑ THE IMAGE IS AN INPUT AND IT USED NOT TO BE NAMED. `host.imageData()` is
  // read inside the memo but a call expression cannot be a dep, so a figure
  // switch - which swaps the picture asynchronously, long after the calibration
  // version has already changed - left this holding a key sampled from the
  // PREVIOUS figure, and every Colour reading on the new one was taken against
  // it. Silent by construction: a colour reads as a number either way.
  const imageEpoch = host.imageEpoch();
  const colourScale = useMemo<ColorScale | null>(() => {
    if (measureTool !== 'colour' && !measurementsNow.some((m) => m.tool === 'colour')) return null;
    const img = host.imageData();
    if (!img) return null;
    const { placed, isLog } = host.keyInputs();
    const { scale } = buildColorScale(placed, { data: img.data, width: img.width, height: img.height }, isLog);
    return scale ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurementsNow, measureTool, calibrationVersion, imageEpoch]);

  // Route a measure-mode canvas click. Set-scale intercepts first (arming a
  // px->unit reference); then the active tool. Slope reports Δy/Δx in the chart's
  // data units (via pixelToData, log-correct if axes are ever set to log); Distance
  // reports a real length via the Set-scale reference (or pixels if none is set).
  const handleMeasureClick = useCallback(
    (px: number, py: number) => {
      const axes = host.axes();
      const snapped = snapToNearestPoint(px, py, host.session().getDataPoints(), host.canvasScale());
      const result = resolveMeasureClick({
        point: snapped,
        pending: pendingMeasureRef.current,
        settingScale,
        tool: measureTool,
        slopeReady: !!axes && host.axesKind() === 'xy',
        toData: axes ? (x, y) => axes.pixelToData(x, y) : null,
      });
      switch (result.kind) {
        case 'refuse':
          setMeasureError(result.message);
          return;
        case 'collect':
          if (!settingScale) setMeasureError(null);
          setPending(result.points);
          return;
        case 'scale-draft':
          setPending(result.points);
          setScaleDraftPx(result.distancePx);
          return;
        case 'record': {
          setMeasureError(null);
          const id = `meas-${(measureIdRef.current += 1)}`;
          // ⚑ Sampled HERE, at the click, from the same native-resolution pixels
          // the other eyedroppers read - `px/py` are image coordinates, so they
          // index straight into `getImageData()`. A colour read later would be a
          // colour from a later image.
          let rgb: readonly [number, number, number] | undefined;
          if (result.tool === 'colour') {
            const img = host.imageData();
            const p = result.points[0]!;
            if (img) rgb = samplePixelRgb(img, p.x, p.y);
          }
          // `label` is a placeholder: the canvas label is DERIVED at render (see
          // the measureOverlays memo), so a later re-calibration updates it.
          // ⚑ fmtNum already returns '∞' for a non-finite number, so the old
          // `finite ? fmtNum(slope) : '∞'` ternary was a second copy of that rule.
          const overlay: MeasureOverlay = {
            id,
            points: result.points,
            label: result.slope !== undefined ? fmtNum(result.slope) : '',
            labelAt: result.labelAt,
          };
          host.applyMeasurements([{ id, tool: result.tool, overlay, ...(rgb ? { rgb } : {}) }, ...host.measurements()]);
          setPending([]);
          host.commit();
          return;
        }
      }
    },
    [host, measureTool, settingScale, setPending]
  );

  const selectMeasureTool = useCallback(
    (t: MeasureToolId) => {
      setMeasureTool(t);
      setPending([]); // abandon a half-placed measurement when switching tools
      setMeasureError(null);
      setSettingScale(false); // and any in-progress Set-scale
      setScaleDraftPx(null);
    },
    [setPending]
  );

  // Close the in-progress Area polygon (via the card's Finish button or Enter):
  // shoelace pixel area, scaled to unit² if a Set-scale exists, recorded as one
  // undoable action.
  const finishArea = useCallback(() => {
    const pts = pendingMeasureRef.current;
    if (pts.length < 3) {
      setMeasureError('Place at least 3 points to close an area.');
      return;
    }
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p.x;
      cy += p.y;
    }
    // The AREA is derived (core/measurementValues.ts) -- only the centroid is
    // still computed here, because that is geometry (where the label hangs),
    // not a value.
    const id = `meas-${(measureIdRef.current += 1)}`;
    const overlay: MeasureOverlay = {
      id,
      points: pts,
      closed: true,
      label: '',
      labelAt: { x: cx / pts.length, y: cy / pts.length },
    };
    host.applyMeasurements([{ id, tool: 'area', overlay }, ...host.measurements()]);
    setPending([]);
    setMeasureError(null);
    host.commit();
  }, [host, setPending]);

  /** Every measurement's DERIVED display form (checkpoint 82) - the single
   * source the card, the clipboard and the canvas labels all read. Recomputed
   * when the scale or the calibration changes, which is what makes Set-scale
   * retroactive instead of one-way. */
  const measurements = measurementsNow;
  const measureScale = host.measureScale();
  const axes = host.axes();
  const measurementViews = useMemo(
    () =>
      measurements.map((m) => ({
        id: m.id,
        tool: m.tool,
        ...measureDisplay(m, { scale: measureScale, axes, colourScale }),
      })),
    [measurements, measureScale, axes, colourScale]
  );

  const copyMeasurement = useCallback((m: Measurement) => {
    void navigator.clipboard?.writeText(m.note ? `${m.value} (${m.note})` : m.value).catch(() => {});
  }, []);

  const deleteMeasurement = useCallback(
    (id: string) => {
      host.applyMeasurements(host.measurements().filter((x) => x.id !== id));
      host.commit();
    },
    [host]
  );

  const copyAllMeasurements = useCallback(() => {
    const text = measurementViews.map((m) => (m.note ? `${m.value} (${m.note})` : m.value)).join('\n');
    void navigator.clipboard?.writeText(text).catch(() => {});
  }, [measurementViews]);

  // Set-scale flow: arm two clicks (startSetScale), then confirm turns their pixel
  // separation + the typed known distance into a px->unit ratio.
  const startSetScale = useCallback(() => {
    setSettingScale(true);
    setScaleDraftPx(null);
    setPending([]);
    setMeasureError(null);
  }, [setPending]);

  const cancelSetScale = useCallback(() => {
    setSettingScale(false);
    setScaleDraftPx(null);
    setPending([]);
  }, [setPending]);

  const confirmSetScale = useCallback(() => {
    // ⚑ The DECISION lives in `engine/measureCapture.ts`, where a millisecond
    // test can reach it - this handler only carries the answer to the screen.
    const result = scaleFromDraft(scaleDraftPx, scaleValueInput, scaleUnitInput);
    if ('error' in result) {
      setMeasureError(result.error);
      return;
    }
    host.applyMeasureScale(result.scale);
    setSettingScale(false);
    setScaleDraftPx(null);
    setPending([]);
    setMeasureError(null);
    host.commit();
  }, [host, scaleValueInput, scaleUnitInput, scaleDraftPx, setPending]);

  const measureReference: MeasureRef =
    measureTool === 'slope'
      ? axes && host.axesKind() === 'xy'
        ? { kind: 'chart' }
        // ⚑ The two pixels-only cases are DIFFERENT cases (F32): a slope reads
        // the chart's own axes, so setting a px->unit scale cannot help it.
        : { kind: 'no-xy-axes' }
      : measureTool === 'distance' || measureTool === 'area'
        ? measureScale
          ? { kind: 'scale', perPx: `1 px = ${fmtNum(measureScale.unitPerPx)} ${measureScale.unit}` }
          // ...and a length reads the scale, so calibrating the axes cannot help IT.
          : { kind: 'no-scale' }
        : measureTool === 'colour'
          // ⚑⚑ A COLOUR IS NOT MEASURED IN DEGREES. This branch was the ANGLE
          // fallback and it caught every tool that was not one of the three
          // named above - so the new instrument inherited "Measured in degrees",
          // which is the shape of defect a fallback branch always has: it is
          // right until someone adds a case, and then it is confidently wrong.
          // The reference for a colour is the KEY, or the absence of one.
          ? colourScale
            ? { kind: 'colour-key' }
            : { kind: 'colour-only' }
          : { kind: 'degrees' }; // angle

  const setScaleDraft: SetScaleDraft | null =
    settingScale && scaleDraftPx != null
      ? {
          px: scaleDraftPx,
          value: scaleValueInput,
          unit: scaleUnitInput,
          onValueChange: setScaleValueInput,
          onUnitChange: setScaleUnitInput,
          onConfirm: confirmSetScale,
          onCancel: cancelSetScale,
        }
      : null;

  return {
    measureTool,
    setMeasureTool,
    pendingMeasure,
    pendingMeasureRef,
    setPending,
    measureError,
    setMeasureError,
    measureIdRef,
    settingScale,
    setSettingScale,
    scaleDraftPx,
    setScaleDraftPx,
    scaleValueInput,
    setScaleValueInput,
    scaleUnitInput,
    setScaleUnitInput,
    activeMeasure,
    setActiveMeasure,
    handleMeasureClick,
    selectMeasureTool,
    finishArea,
    measurementViews,
    copyMeasurement,
    deleteMeasurement,
    copyAllMeasurements,
    startSetScale,
    cancelSetScale,
    confirmSetScale,
    measureReference,
    setScaleDraft,
    colourScale,
  };
}
