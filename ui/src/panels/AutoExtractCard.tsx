import { theme, glassSurface } from '../theme.js';
import { EyedropperIcon } from '../icons.js';
import { autoExtractModesFor, type ToolMode } from '../../../engine/toolMode.js';
import type { AxesTypeConfig, CalibratedAxes } from '../../../engine/axesTypeConfigs.js';

/** The colour-match preview overlay's paint colour (checkpoint 121): a bright,
 * semi-transparent magenta that reads clearly over the black/blue/red-on-white of
 * typical scientific figures and isn't easily mistaken for a series colour. */
export const COLOR_TRACE_PREVIEW_RGBA: readonly [number, number, number, number] = [255, 0, 200, 150];

export interface AutoExtractCardProps {
  mode: ToolMode;
  config: Pick<AxesTypeConfig<CalibratedAxes>, 'autoExtractKind'>;
  /** What one captured shape is called on this type - "bar", "bin", "box". */
  tupleNoun: string;
  onSetMechanism: (mode: ToolMode) => void;

  segmentFillThreshold: number;
  onSegmentFillThresholdChange: (value: number) => void;
  segmentFillError: string | null;

  colorTraceColor: string;
  onColorTraceColorChange: (hex: string) => void;
  colorTraceTolerance: number;
  onColorTraceToleranceChange: (value: number) => void;
  colorTraceShape: 'curve' | 'scatter';
  onColorTraceShapeChange: (shape: 'curve' | 'scatter') => void;
  colorTraceMinBlob: number;
  onColorTraceMinBlobChange: (value: number) => void;
  colorTraceRegion: { x: number; y: number; width: number; height: number } | null;
  onClearRegion: () => void;
  colorTraceInfo: string | null;
  /** The live colour-match preview, or null when nothing is loaded. */
  colorTraceMask: { count: number; pct: number } | null;
  onTrace: () => void;
  /**
   * The active series already holds readings, and they came from a DIFFERENT
   * colour than the one about to be traced.
   *
   * ⚑⚑ TRACING A SECOND COLOUR INTO ONE SERIES IS THE COMMONEST WAY TO RUIN A
   * GROUPED BAR CHART. Every category ends up holding two readings, the table
   * can only show one of each, and the panel explains it AFTERWARDS - once the
   * damage is done and five categories are doubled. David, having done exactly
   * that and undone it by hand: *"new colour should automatically suggest a new
   * series."* The offer belongs at the gesture.
   */
  newColourForThisSeries: boolean;
  /** Take the offer: add a series and trace into it, in one gesture. */
  onTraceIntoNewSeries: () => void;

  /**
   * The sentence for shapes the last bar trace HELD BACK, or '' when it held
   * none back - see `swatchHoldBackOffer`.
   *
   * ⚑⚑ THE CARD IS WHERE A REFUSAL HAS TO BE UNDOABLE. The shapes are kept out
   * of the record because they do not reach the baseline and are much smaller
   * than the bars that do, which is what a legend swatch looks like - but that
   * is a measurement, not a verdict, and only the person looking at the figure
   * can take the last step. So the sentence and the control that reverses it
   * sit together, and the held-back shapes are outlined ON the figure.
   */
  heldBackOffer: { sentence: string; action: string } | null;
  /** Take them back: file the held-back shapes as ordinary bars. */
  onAddHeldBackBars: () => void;

  onArmEyedropper: (target: 'trace') => void;
}

/**
 * The Auto-extract umbrella card (v0.8, David) - one wand tool fronting the
 * three tracing mechanisms. The selector switches MODE (each keeps its own
 * canvas behaviour) and shows that mechanism's controls, which used to live in
 * three places (sidebar / top-bar panel / tips).
 *
 * ⚑ The card is click-THROUGH (`pointerEvents: 'none'`) and only its actual
 * controls re-enable pointer events. It floats over the figure, and Guide
 * points / Flood-fill work by clicking the curve UNDER it - without this, a
 * click in the card's footprint silently did nothing, which is the recurring
 * "I clicked and nothing happened" failure this project keeps rediscovering.
 */
export function AutoExtractCard(props: AutoExtractCardProps) {
  const {
    mode,
    config,
    tupleNoun,
    onSetMechanism,
    segmentFillThreshold,
    onSegmentFillThresholdChange,
    segmentFillError,
    colorTraceColor,
    onColorTraceColorChange,
    colorTraceTolerance,
    onColorTraceToleranceChange,
    colorTraceShape,
    onColorTraceShapeChange,
    colorTraceMinBlob,
    onColorTraceMinBlobChange,
    colorTraceRegion,
    onClearRegion,
    colorTraceInfo,
    colorTraceMask,
    onTrace,
  newColourForThisSeries,
  onTraceIntoNewSeries,
  heldBackOffer,
  onAddHeldBackBars,
    onArmEyedropper,
  } = props;
  return (
    <div
      data-testid="auto-extract-card"
      style={{
        // The card floats over the figure but must NOT swallow canvas
        // clicks meant to place points UNDER it (Guide points / Flood-fill
        // work by clicking the curve; the region marquee drags on the
        // image). So the container is click-THROUGH and only its actual
        // controls (below) re-enable pointer events. Fixes "I clicked to
        // place a point and nothing happened" in the card's footprint.
        pointerEvents: 'none',
        // Frosted glass: floats over the immutable figure (glassSurface).
        ...glassSurface,
        border: `1px solid ${theme.color.border.regular}`,
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(103, 104, 132, 0.22)',
        padding: '8px 10px',
        width: 288,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        fontSize: theme.font.size.regular,
      }}
    >
      <strong style={{ fontSize: theme.font.size.regular }}>Auto-extract</strong>
      {/* Mechanism selector: pick the one that fits how the curve is
          drawn (not the graph type -- the app can't tell solid from
          dashed). */}
      <div style={{ display: 'flex', gap: 4 }}>
        {([
          { m: 'segment-fill' as ToolMode, id: 'flood', label: 'Flood-fill', hint: 'solid line' },
          { m: 'color-trace' as ToolMode, id: 'colour', label: 'By colour', hint: 'dashed / coloured' },
          { m: 'interpolate' as ToolMode, id: 'guide', label: 'Guide points', hint: 'by eye' },
        ])
          // ⚑ A spider or a bar gets ONE mechanism (autoExtractModesFor). The
          // other two are curve tools that produce ordinary points, and neither
          // a spider's axis slots nor a bar's two-corner slots have anywhere to
          // file one: they would have run and recorded nothing, which reads as
          // a broken button rather than as a tool that does not apply here.
          .filter(({ m }) => autoExtractModesFor(config.autoExtractKind).includes(m))
          .map(({ m, id, label }) => (
          <button
            key={id}
            type="button"
            data-testid={`auto-extract-${id}`}
            aria-pressed={mode === m}
            onClick={() => onSetMechanism(m)}
            style={{
              pointerEvents: 'auto', // container is click-through; controls opt back in
              flex: 1,
              fontSize: theme.font.size.small,
              padding: '4px 2px',
              borderRadius: theme.border.radius.regular,
              cursor: 'pointer',
              border: `1px solid ${mode === m ? theme.color.primary.main : theme.color.border.regular}`,
              background: mode === m ? theme.color.primary.main : theme.color.background.primary,
              color: mode === m ? '#fff' : theme.color.text.primary,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'segment-fill' && (
        <div data-testid="segment-fill-controls" style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 6, color: theme.color.text.secondary }}>
          <span>Click a solid, unbroken curve to flood-fill along it.</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Colour distance threshold:
            <input
              type="number"
              data-testid="segment-fill-threshold"
              min={1}
              max={255}
              value={segmentFillThreshold}
              onChange={(e) => onSegmentFillThresholdChange(Math.max(1, Math.min(255, Number(e.target.value) || 1)))}
              style={{ width: 60 }}
            />
          </label>
          {segmentFillError && (
            <span data-testid="segment-fill-error" style={{ color: theme.color.error }}>{segmentFillError}</span>
          )}
        </div>
      )}

      {mode === 'color-trace' && (
        <div style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 6, color: theme.color.text.secondary }}>
          <span>
            {config.autoExtractKind === 'along-axes' ? (
              <>
                Walks each calibrated axis outward and records the value where the
                series&rsquo; colour crosses it - one reading per axis. A ray the colour
                crosses more than once is left EMPTY for you to place, and named below.
                The highlighted pixels show what the trace reads.
              </>
            ) : config.autoExtractKind === 'bounding-box' ? (
              <>
                Finds every {tupleNoun} of that colour and records its own bounding box -
                measured directly, never a midpoint. {tupleNoun.charAt(0).toUpperCase()}
                {tupleNoun.slice(1)}s of the identical colour touching with no gap between
                them are read as one merged {tupleNoun}. The highlighted pixels show what
                the trace reads.
              </>
            ) : (
              <>
                Selects every pixel of a series&rsquo; colour - a dashed or marker-only line
                extracts in one pass. Pick the colour, choose curve or scattered points, then Trace.
                The highlighted pixels show what the trace reads.
              </>
            )}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Colour:</span>
            <span
              data-testid="color-trace-swatch"
              style={{ width: 22, height: 22, borderRadius: 4, border: `1px solid ${theme.color.border.regular}`, background: colorTraceColor, flex: '0 0 auto' }}
            />
            <input
              type="text"
              data-testid="color-trace-color"
              value={colorTraceColor}
              onChange={(e) => onColorTraceColorChange(e.target.value)}
              spellCheck={false}
              style={{ width: 84 }}
            />
            <button
              type="button"
              data-testid="color-trace-eyedropper"
              onClick={() => onArmEyedropper('trace')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <EyedropperIcon />
              Pick from image
            </button>
          </div>
          {/* No shape to choose on a spider or a bar: the rays decide where a
              spider reads, and a bar's shape is always its bounding box -- neither
              has a curve-vs-scatter choice to make. */}
          <div style={{ display: config.autoExtractKind === 'curve' || config.autoExtractKind == null ? 'flex' : 'none', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Shape:</span>
            <select
              data-testid="color-trace-shape"
              value={colorTraceShape}
              onChange={(e) => onColorTraceShapeChange(e.target.value as 'curve' | 'scatter')}
            >
              <option value="curve">Curve (line)</option>
              <option value="scatter">Scattered points</option>
            </select>
          </div>
          {/* Min blob size applies to any reduction that runs blob detection --
              Scattered points (curve kind) and bounding-box detection (Bar,
              Histogram) both do, so this shows for either rather than living
              nested only under the (here, hidden) Shape selector. */}
          {((config.autoExtractKind ?? 'curve') === 'curve' && colorTraceShape === 'scatter') ||
          config.autoExtractKind === 'bounding-box' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>Min {config.autoExtractKind === 'bounding-box' ? tupleNoun : 'marker'} &empty;:</span>
              <input
                type="number"
                data-testid="color-trace-min-blob"
                min={0}
                max={200}
                value={colorTraceMinBlob}
                onChange={(e) => onColorTraceMinBlobChange(Math.max(0, Math.min(200, Number(e.target.value) || 0)))}
                style={{ width: 52 }}
              />
              <span>px</span>
            </div>
          ) : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Tolerance:</span>
            <input
              type="number"
              data-testid="color-trace-tolerance"
              min={1}
              max={255}
              value={colorTraceTolerance}
              onChange={(e) => onColorTraceToleranceChange(Math.max(1, Math.min(255, Number(e.target.value) || 1)))}
              style={{ width: 60 }}
            />
            <button
              type="button"
              data-testid="color-trace-run"
              onClick={onTrace}
              style={{
                background: theme.color.primary.main,
                color: '#fff',
                border: `1px solid ${theme.color.primary.main}`,
                borderRadius: theme.border.radius.regular,
                padding: '3px 16px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Trace
            </button>
          </div>
          {/* ⚑⚑ OFFERED, NEVER IMPOSED. The user may genuinely mean to add a
              second colour to one series - two shades of the same treatment, a
              re-trace after a tolerance nudge that shifted the pick. So this
              suggests and does not refuse: `Trace` still does exactly what it
              says, one button along.
              ⚑ And taking the offer is ONE gesture, not "add a series, find
              the tool again, trace" - a suggestion is only worth making if
              acting on it costs less than the mistake it avoids. */}
          {newColourForThisSeries && (
            <div
              data-testid="new-colour-series-offer"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                fontSize: theme.font.size.small, color: theme.color.text.legend,
              }}
            >
              <span>This series was traced from a different colour.</span>
              <button
                type="button"
                data-testid="trace-into-new-series"
                onClick={onTraceIntoNewSeries}
                title="Add a series and trace this colour into it"
              >
                Trace into a new series
              </button>
            </div>
          )}
          {/* ⚑⚑ A REFUSAL WITH ITS OWN UNDO. The shapes are not in the record;
              this says so and takes them back in one click. Drawn the same way
              as the new-colour offer above, because it is the same kind of
              thing - the app noticed something at the gesture and is offering,
              not deciding. */}
          {heldBackOffer && (
            <div
              data-testid="swatch-hold-back-offer"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                fontSize: theme.font.size.small, color: theme.color.text.legend,
              }}
            >
              <span>{heldBackOffer.sentence}</span>
              <button
                type="button"
                data-testid="add-held-back-bars"
                onClick={onAddHeldBackBars}
                title="Record them as bars after all"
              >
                {heldBackOffer.action}
              </button>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* B1 - restrict the trace to a rectangle drawn DIRECTLY on the
                image (v1.2). No arm-first toggle: the hint tells the user
                the gesture exists (so it's discoverable, not tribal), and
                the ✕ clears it back to the whole image. */}
            {colorTraceRegion ? (
              <button
                type="button"
                data-testid="color-trace-region-clear"
                onClick={() => onClearRegion()}
                title="Clear the region - trace the whole image again"
              >
                Region {Math.round(colorTraceRegion.width)}×{Math.round(colorTraceRegion.height)} px ✕
              </button>
            ) : (
              <span
                data-testid="color-trace-region-hint"
                style={{ fontSize: theme.font.size.small, color: theme.color.text.legend }}
                title="Limit the trace to a box you draw (e.g. the plot area), so a same-coloured legend swatch outside it is ignored"
              >
                Drag a box on the image to restrict the trace
              </span>
            )}
          </div>
          {colorTraceMask && (
            <span data-testid="color-trace-preview" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 2, background: `rgb(${COLOR_TRACE_PREVIEW_RGBA[0]}, ${COLOR_TRACE_PREVIEW_RGBA[1]}, ${COLOR_TRACE_PREVIEW_RGBA[2]})`, flex: '0 0 auto' }} />
              {colorTraceMask.count === 0
                ? 'No pixels match - repick the colour or raise the tolerance.'
                : `${colorTraceMask.count.toLocaleString()} px highlighted (${colorTraceMask.pct.toFixed(1)}% of the image)${colorTraceMask.pct > 25 ? ' - a lot; if it grabbed the grid/axes, lower the tolerance or run Grid Removal first.' : '.'}`}
            </span>
          )}
          {colorTraceInfo && (
            <span data-testid="color-trace-info">{colorTraceInfo}</span>
          )}
        </div>
      )}

      {mode === 'interpolate' && (
        <div style={{ color: theme.color.text.secondary }}>
          Click a few guide points along one curve; the curve fills in between them. Q/W step between anchors, arrow keys nudge the selected one.
        </div>
      )}
    </div>  );
}
