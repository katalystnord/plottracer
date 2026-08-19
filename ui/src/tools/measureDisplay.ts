import { measurementValue, measurementPixelValue, slopeDeltas } from '../../../core/measurementValues.js';
import { colourMeasureReading } from '../../../engine/colourMeasure.js';
import { fmtNum, rgbToHex } from '../format.js';
import type { ColorScale } from '../../../algorithms/colorScale.js';
import type { MeasureToolId } from '../MeasureCard.js';
import type { MeasureOverlay } from '../ImageCanvas.js';

/**
 * THE MEASURE TOOL'S OWN MODULE (v2.3, theme G).
 *
 * ⚑⚑ THE TOOL MOVES; THE COLLECTION DOES NOT. Measurements are DOCUMENT state -
 * they are written into the project file, stashed per figure, restored on load
 * and captured in every undo snapshot (50 references in `Workspace.tsx`, most of
 * them from save/load/history). A tool module that owned them would drag the
 * document lifecycle in with it. So what lives here is what belongs to the
 * INSTRUMENT: how a recorded measurement READS, given the references available.
 *
 * ⚑ Discovered by measuring before moving, which is this theme's own repeated
 * lesson - the first size table was wrong on every entry, and the headline
 * "~800 lines" counted comments.
 */

/** A px->real-world-unit scale (Set-scale), independent of the chart axes. */
export interface MeasureScaleState {
  unitPerPx: number;
  unit: string;
}

/** A recorded measurement plus the geometry to draw it. */
export interface RecordedMeasurement {
  id: string;
  tool: MeasureToolId;
  overlay: MeasureOverlay;
  /**
   * The colour this measurement read, for the Colour instrument only.
   *
   * ⚑⚑ THE ONE THING HERE THAT IS STORED RATHER THAN DERIVED, and deliberately.
   * Everything else on this record is pixels, because a value frozen at capture
   * is what made Set-scale one-way once. A COLOUR is not a derived value - it is
   * the reading itself, at full fidelity, and re-sampling it at render would
   * mean a later Grid removal or image enhancement silently rewrote a
   * measurement taken before it. We RECORD what the instrument saw.
   * ⚑ Its VALUE stays derived, through the colour key, so a re-calibrated key
   * re-reads every colour measurement exactly as Set-scale re-reads every
   * distance.
   */
  rgb?: readonly [number, number, number];
}

/**
 * A measurement's display form, DERIVED (checkpoint 82).
 *
 * **`value`/`note` used to be stored on the record**, and that was the defect:
 * `fmtNum` is `toPrecision(4)`, so the rounded string was the only copy of the
 * number - the raw double never reached the record, the project file or the
 * CSV, and a slope of 1.23456789 was destroyed at capture. Worse, being frozen
 * at capture is what made Set-scale one-way: a distance measured before a scale
 * existed kept its "12.5 px" text forever.
 *
 * Now the record is the pixels (`overlay.points`) plus the tool, and everything
 * else is computed here from `core/measurementValues.ts`. One source of truth,
 * so screen, card and export cannot drift; and a later Set-scale or
 * re-calibration re-derives every measurement for free, exactly as
 * re-calibrating an axis re-derives every data point.
 */
export function measureDisplay(
  m: RecordedMeasurement,
  ctx: {
    scale?: MeasureScaleState | null;
    axes?: { pixelToData(px: number, py: number): number[] } | null;
    /** The calibrated colour key, where the figure has one. */
    colourScale?: ColorScale | null;
  }
): { value: string; note?: string; swatch?: readonly [number, number, number] } {
  // ⚑⚑ COLOUR FIRST, because it is not a geometry and the functions below
  // compute numbers out of geometry. The type checker said so before this
  // branch existed, which is the split working as intended.
  if (m.tool === 'colour') {
    if (!m.rgb) return { value: '-' };
    const reading = colourMeasureReading(m.rgb, ctx.colourScale ?? null);
    return {
      value: rgbToHex(m.rgb),
      swatch: m.rgb,
      // ⚑ The panel's own `·` idiom, which is why this rides as the NOTE: the
      // eyedropper row and the ruler row then read as one list rather than two
      // conventions (`684.5 px · set a scale for real units`).
      // ⚠️ AMBIGUITY IS NOT A NUMBER. A colour a diverging key answers twice
      // gets the fact instead of one of the two answers - a second opinion that
      // guesses is worse than none, because it is trusted exactly where the
      // first opinion was unsure.
      note: reading.ambiguous
        ? 'the key gives this colour more than one value'
        : reading.value !== null
          ? fmtNum(reading.value)
          : undefined,
    };
  }
  const raw = measurementValue(m.tool, m.overlay.points, ctx);
  if (!raw) return { value: '-' };
  const n = raw.values[0]!;
  if (m.tool === 'slope') {
    const d = slopeDeltas(m.overlay.points, ctx.axes);
    return {
      value: Number.isFinite(n) ? `slope ${fmtNum(n)}` : 'slope ∞ (vertical)',
      note: d ? `Δy ${fmtNum(d.dy)} · Δx ${fmtNum(d.dx)}` : undefined,
    };
  }
  const value = raw.unit ? `${fmtNum(n)} ${raw.unit}`.replace(' °', '°') : fmtNum(n);
  if (m.tool === 'angle') return { value };
  // Distance/Area: show the pixel magnitude alongside when a scale is in play,
  // and prompt for one when it isn't -- the same two notes as before, now
  // derived rather than frozen.
  const px = measurementPixelValue(m.tool, m.overlay.points);
  return {
    value,
    note: ctx.scale
      ? `${fmtNum(px ?? 0)} px${m.tool === 'area' ? '²' : ''}`
      : 'set a scale for real units',
  };
}
