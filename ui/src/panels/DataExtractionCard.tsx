import { useState } from 'react';
import { Menu, MenuItem } from '@mui/material';
import { theme, glassSurface } from '../theme.js';
import { WarningLine } from './WarningLine.js';
import { EyedropperIcon } from '../icons.js';
import { rgbToHex } from '../format.js';
import { findLinesKind, type ToolMode } from '../../../engine/toolMode.js';
import type { AxesTypeConfig, CalibratedAxes } from '../../../engine/axesTypeConfigs.js';
import type { DatasetInfo } from '../../../engine/calibrationSession.js';

/** The colour-match preview overlay's paint colour (checkpoint 121): a bright,
 * semi-transparent magenta that reads clearly over the black/blue/red-on-white of
 * typical scientific figures and isn't easily mistaken for a series colour. */
export const COLOR_TRACE_PREVIEW_RGBA: readonly [number, number, number, number] = [255, 0, 200, 150];

export interface DataExtractionCardProps {
  mode: ToolMode;
  config: Pick<AxesTypeConfig<CalibratedAxes>, 'autoExtractKind' | 'autoExtractRefusal' | 'id'>;
  /** The card's tools that apply to this graph type (`dataExtractionToolsFor`); the others are greyed in place. */
  applies: readonly ToolMode[];
  /**
   * The series every tool records into (David, 2026-11-02): a dropdown, renamed on the spot, with [+ Add] beside it.
   * The right panel keeps its own dropdown to pick and show the active series; adding is making something to
   * extract into, so it is here, and removing is choosing what goes out, so it stays there.
   */
  series: {
    infos: readonly DatasetInfo[];
    activeIndex: number;
    /** The in-flight rename, or null when the field shows the stored name. */
    nameDraft: string | null;
    onSelect: (index: number) => void;
    onAdd: () => void;
    canAdd: boolean;
    onRenameDraft: (index: number, name: string) => void;
    onCommitRename: (index: number, name: string) => void;
  };
  /** What one captured shape is called on this type - "bar", "bin", "box". */
  tupleNoun: string;
  onPickTool: (mode: ToolMode) => void;

  segmentFillThreshold: number;
  onSegmentFillThresholdChange: (value: number) => void;
  segmentFillError: string | null;

  colorTraceColor: string;
  onColorTraceColorChange: (hex: string) => void;
  /**
   * The figure where the colour was picked, as an image, or null when the colour was typed (David, 2026-11-02). It
   * shows what is there - hatching, a dash, a marker - and claims nothing: the tools read the colour only.
   */
  colourCrop: string | null;
  colorTraceTolerance: number;
  onColorTraceToleranceChange: (value: number) => void;
  colorTraceShape: 'curve' | 'scatter';
  onColorTraceShapeChange: (shape: 'curve' | 'scatter') => void;
  colorTraceMinBlob: number;
  onColorTraceMinBlobChange: (value: number) => void;
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

  onArmEyedropper: (target: 'trace' | 'find-one') => void;

  /**
   * [Auto-extract all series] (v2.7; David 2026-10-31): every series the legend names, each read by the card's tool
   * that suits it. `applies` false greys it in its place, as a tool that does not apply.
   */
  autoExtract: { applies: boolean; busy: boolean; said: readonly string[] | null; onRun: () => void };

  /**
   * Find lines (v2.6) - present only on the types it applies to (`findLinesKind`). Reads the same colour as Colour
   * trace: one colour is active on the card (David, 2026-11-02).
   */
  findLines?: {
    kind: 'curves' | 'contours';
    /** What it is doing right now ("Reading labels 3 of 9"), or null when idle. */
    busy: string | null;
    /** What the last press did (F9: the press has an ending), or null. */
    summary: string | null;
    onFind: () => void;
    /** How many lines the last press found that are still there - a new press replaces them. */
    replaces: number;
    /** Contours: fill unset levels from the ones set (C4). */
    onFillLevels?: () => void;
    /** Contours with a calibrated colour key: read every line's level off it (L3). */
    onReadKey?: () => void;
    fillNotice: string | null;
    /** Settings ▸ Read contour labels (S8) - when off, the card says so instead of promising to read them. */
    readsLabels: boolean;
  };
}

/**
 * The Data extraction card, rail 4 (v2.7; David 2026-10-31 and 2026-11-02, docs/v2.7-workflow-walk.md). Top to
 * bottom: [Auto-extract all series]; the series the tools below record into and the tools that find one series each;
 * tracing by hand; Split a line; then, for the picked tool, the colour it reads, its settings and what it said - all
 * in one place at the bottom. The top half chooses the series and the tool; the bottom half is how the picked tool
 * reads and what it found. Lines between the groups keep it legible. It opens with nothing picked ("Let the user
 * pick, even if it is only one"), and a tool that does not apply to the graph type is greyed in its place. As narrow
 * as it can be: extra height is better than width. Each tool is explained by the tips bar when picked, not here.
 *
 * ⚑ The card is click-THROUGH (`pointerEvents: 'none'`) and only its actual
 * controls re-enable pointer events. It floats over the figure, and Guide
 * points / Flood-fill work by clicking the curve UNDER it - without this, a
 * click in the card's footprint silently did nothing, which is the recurring
 * "I clicked and nothing happened" failure this project keeps rediscovering.
 */
/** Each tool's name in the card, in `DATA_EXTRACTION_TOOLS`' order. */
export const DATA_EXTRACTION_LABELS: Readonly<Partial<Record<ToolMode, string>>> = {
  'find-lines': 'Find lines',
  'color-trace': 'Colour trace',
  'segment-fill': 'Fill a region',
  interpolate: 'Follow guide points',
  'place-point': 'Place points',
  cut: 'Split a line',
};

/** Why a greyed tool does not apply here, said on hover as a greyed rail tool says it. */
function notHereReason(m: ToolMode, config: DataExtractionCardProps['config']): string {
  if (config.id === 'heatmap') return 'A heatmap is read from its grid: Read cells, at the end of the calibration card.';
  if ((m === 'find-lines' || m === 'cut') && findLinesKind(config.id) === null) return 'Only where lines are the record (XY, Contour).';
  return config.autoExtractRefusal ?? 'Not for this graph type.';
}

const small = { fontSize: theme.font.size.small, color: theme.color.text.secondary } as const;

export function DataExtractionCard(props: DataExtractionCardProps) {
  const {
    mode,
    config,
    applies,
    series,
    tupleNoun,
    onPickTool,
    segmentFillThreshold,
    onSegmentFillThresholdChange,
    segmentFillError,
    colorTraceColor,
    onColorTraceColorChange,
    colourCrop,
    colorTraceTolerance,
    onColorTraceToleranceChange,
    colorTraceShape,
    onColorTraceShapeChange,
    colorTraceMinBlob,
    onColorTraceMinBlobChange,
    colorTraceInfo,
    colorTraceMask,
    onTrace,
    newColourForThisSeries,
    onTraceIntoNewSeries,
    heldBackOffer,
    onAddHeldBackBars,
    onArmEyedropper,
    autoExtract,
    findLines,
  } = props;
  const [seriesMenu, setSeriesMenu] = useState<HTMLElement | null>(null);
  const active = series.infos[series.activeIndex];
  // a line between the card's groups, to keep it legible (David, 2026-11-02)
  const divider = <div role="separator" data-testid="extract-divider" style={{ height: 1, background: theme.color.border.regular, margin: '2px 0' }} />;
  const heading = (text: string) => <span style={small}>{text}</span>;
  const grid = (children: React.ReactNode) => <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>{children}</div>;
  // Lines are Find lines' (David, 2026-11-02): on a type it reads, Colour trace reads markers, one point each, and has
  // no shape to choose. Elsewhere (polar, ternary, map, CCR) its curve reading is the only automatic line reader.
  const pointsOnly = findLinesKind(config.id) !== null;
  const readsColour = (mode === 'find-lines' && !!findLines) || mode === 'color-trace';

  // One of the card's tools. A greyed one keeps its place and says why on hover; the wrapper carries the title
  // because a disabled button gets no pointer events (the rail does the same).
  const toolButton = (m: ToolMode) => {
    const on = mode === m;
    const usable = applies.includes(m);
    return (
      <span title={usable ? undefined : notHereReason(m, config)} style={{ pointerEvents: 'auto', display: 'flex' }}>
        <button
          type="button"
          data-testid={`extract-tool-${m}`}
          aria-pressed={on}
          disabled={!usable}
          onClick={() => onPickTool(m)}
          style={{
            flex: 1,
            fontSize: theme.font.size.small,
            padding: '4px 2px',
            borderRadius: theme.border.radius.regular,
            cursor: usable ? 'pointer' : 'default',
            border: `1px solid ${on ? theme.color.primary.main : theme.color.border.regular}`,
            background: on ? theme.color.primary.main : theme.color.background.primary,
            color: on ? '#fff' : theme.color.text.primary,
            opacity: usable ? 1 : 0.45,
          }}
        >
          {DATA_EXTRACTION_LABELS[m]}
        </button>
      </span>
    );
  };
  const runButton = (testId: string, label: string, onClick: () => void, disabled: boolean, title: string) => (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: theme.color.primary.main,
        color: '#fff',
        border: `1px solid ${theme.color.primary.main}`,
        borderRadius: theme.border.radius.regular,
        padding: '3px 16px',
        fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  );

  // What the picked tool said, in one place at the bottom of the card (David, 2026-11-02).
  const said: React.ReactNode[] = [];
  if (mode === 'find-lines' && findLines) {
    if (findLines.busy) said.push(<span key="b" data-testid="find-lines-busy">{findLines.busy}</span>);
    if (findLines.summary) said.push(<span key="s" data-testid="find-lines-summary">{findLines.summary}</span>);
    if (findLines.fillNotice) said.push(<WarningLine key="f" id="find-lines-fill-notice" text={findLines.fillNotice} />);
  }
  if (mode === 'color-trace') {
    if (colorTraceMask) {
      said.push(
        <span key="p" data-testid="color-trace-preview" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: `rgb(${COLOR_TRACE_PREVIEW_RGBA[0]}, ${COLOR_TRACE_PREVIEW_RGBA[1]}, ${COLOR_TRACE_PREVIEW_RGBA[2]})`, flex: '0 0 auto' }} />
          {colorTraceMask.count === 0
            ? 'No pixels match - repick the colour or raise the tolerance.'
            : `${colorTraceMask.count.toLocaleString()} px highlighted (${colorTraceMask.pct.toFixed(1)}% of the image)${colorTraceMask.pct > 25 ? ' - a lot; if it grabbed the grid/axes, lower the tolerance or run Grid Removal first.' : '.'}`}
        </span>
      );
    }
    if (colorTraceInfo) said.push(<span key="i" data-testid="color-trace-info">{colorTraceInfo}</span>);
  }
  if (mode === 'segment-fill' && segmentFillError) said.push(<WarningLine key="e" id="segment-fill-error" text={segmentFillError} />);

  return (
    <div
      data-testid="data-extraction-card"
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
        width: 232,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        fontSize: theme.font.size.regular,
      }}
    >
      <strong style={{ fontSize: theme.font.size.regular }}>Data extraction</strong>

      {grid(
        <span title={autoExtract.applies ? undefined : 'No tool on this card reads a series of this graph type by its colour.'} style={{ pointerEvents: 'auto', display: 'flex' }}>
          <button
            type="button"
            data-testid="auto-extract-all"
            onClick={autoExtract.onRun}
            disabled={!autoExtract.applies || autoExtract.busy}
            style={{ flex: 1, fontSize: theme.font.size.small, padding: '4px 2px', opacity: autoExtract.applies ? 1 : 0.45 }}
          >
            {autoExtract.busy ? 'Reading the series…' : 'Auto-extract all series'}
          </button>
        </span>
      )}
      <span style={small}>Reads every series the legend names, each with the tool that suits it.</span>
      {autoExtract.said && (
        <div data-testid="auto-extract-said" style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 3, ...small }}>
          {autoExtract.said.map((t, i) => (
            <span key={i} data-testid={`auto-extract-said-${i}`}>{t}</span>
          ))}
        </div>
      )}

      {divider}
      {heading('Find individual series')}
      <span data-testid="extract-series" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={small}>Series:</span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            border: `1px solid ${theme.color.border.regular}`,
            borderRadius: theme.border.radius.regular,
            background: theme.color.background.primary,
            paddingLeft: 4,
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 2, background: active ? rgbToHex(active.color) : 'transparent', flex: '0 0 auto' }} />
          <input
            data-testid="extract-series-name"
            title="Rename the series"
            value={series.nameDraft ?? active?.name ?? ''}
            onChange={(e) => series.onRenameDraft(series.activeIndex, e.target.value)}
            onBlur={(e) => series.onCommitRename(series.activeIndex, e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: theme.font.size.small, padding: '3px 4px' }}
          />
          <button
            type="button"
            data-testid="extract-series-open"
            title="Pick another series"
            onClick={(e) => setSeriesMenu(e.currentTarget)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 4px', fontSize: 10 }}
          >
            ▾
          </button>
        </span>
        <button type="button" data-testid="add-series" onClick={series.onAdd} disabled={!series.canAdd} title="Add a new series" style={{ fontSize: theme.font.size.small }}>
          + Add
        </button>
      </span>
      <Menu anchorEl={seriesMenu} open={seriesMenu !== null} onClose={() => setSeriesMenu(null)}>
        {series.infos.map((info) => (
          <MenuItem
            key={info.index}
            data-testid={`extract-series-option-${info.index}`}
            selected={info.index === series.activeIndex}
            onClick={() => {
              series.onSelect(info.index);
              setSeriesMenu(null);
            }}
            style={{ fontSize: theme.font.size.small, gap: 6 }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 2, background: rgbToHex(info.color) }} />
            {info.name}
          </MenuItem>
        ))}
      </Menu>
      {grid(
        <>
          {toolButton('find-lines')}
          {toolButton('color-trace')}
          {toolButton('segment-fill')}
          {toolButton('interpolate')}
        </>
      )}

      {divider}
      {heading('Trace by hand')}
      {grid(toolButton('place-point'))}

      {divider}
      {grid(toolButton('cut'))}

      {(readsColour || mode === 'segment-fill' || said.length > 0 || newColourForThisSeries || heldBackOffer) && divider}

      {readsColour && (
        <div data-testid="extract-colour" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={small}>Colour:</span>
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
            style={{ width: 70 }}
          />
          {colourCrop && (
            <img
              data-testid="color-crop"
              src={colourCrop}
              alt="Where the colour was picked"
              title="The figure where the colour was picked"
              style={{ width: 22, height: 22, borderRadius: 4, border: `1px solid ${theme.color.border.regular}`, imageRendering: 'pixelated', flex: '0 0 auto' }}
            />
          )}
          <button
            type="button"
            data-testid="color-trace-eyedropper"
            onClick={() => onArmEyedropper('trace')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: theme.font.size.small }}
          >
            <EyedropperIcon />
            Pick from image
          </button>
        </div>
      )}

      {mode === 'find-lines' && findLines && (
        <div data-testid="find-lines-controls" style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 6, ...small }}>
          {findLines.kind === 'contours' && !findLines.readsLabels && (
            <span data-testid="find-lines-labels-off">Label reading is off (Settings).</span>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {runButton(
              'find-lines-run',
              'Find lines',
              findLines.onFind,
              findLines.busy !== null,
              findLines.replaces ? `Find the lines again - replaces the ${findLines.replaces} found last time (a line you renamed is kept)` : 'Find every line of this colour'
            )}
            <button
              type="button"
              data-testid="find-lines-one"
              onClick={() => onArmEyedropper('find-one')}
              disabled={findLines.busy !== null}
              title="Click one line on the figure: only that line is found and added, its colour taken from where you click. The lines already found stay."
            >
              Find this line
            </button>
          </div>
          {findLines.kind === 'contours' && findLines.onFillLevels && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>
                Set the levels you can see (type them, or use what a label reads), then fill in the rest - in equal steps between the lines you set.
              </span>
              {findLines.onReadKey && (
                <button type="button" data-testid="find-lines-read-key" onClick={findLines.onReadKey} style={{ alignSelf: 'flex-start' }} title="Give every line the level its colour has on the figure's colour key">
                  Read levels from the colour key
                </button>
              )}
              <button type="button" data-testid="find-lines-fill-levels" onClick={findLines.onFillLevels} style={{ alignSelf: 'flex-start' }}>
                Fill in the other levels
              </button>
            </div>
          )}
        </div>
      )}

      {mode === 'segment-fill' && (
        <div data-testid="segment-fill-controls" style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 6, ...small }}>
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
        </div>
      )}

      {mode === 'color-trace' && (
        <div data-testid="color-trace-controls" style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 6, ...small }}>
          {/* No shape to choose where Find lines reads the lines, on a spider or on a bar: the rays decide where a
              spider reads, and a bar's shape is always its bounding box. */}
          {!pointsOnly && (config.autoExtractKind === 'curve' || config.autoExtractKind == null) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
          )}
          {/* Min blob size applies to any reduction that runs blob detection: markers (curve kind) and bounding-box
              detection (Bar, Histogram). */}
          {((config.autoExtractKind ?? 'curve') === 'curve' && (pointsOnly || colorTraceShape === 'scatter')) || config.autoExtractKind === 'bounding-box' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>Min {config.autoExtractKind === 'bounding-box' ? tupleNoun : 'marker'} &empty;:</span>
              <input
                type="number"
                data-testid="color-trace-min-blob"
                min={0}
                max={200}
                value={colorTraceMinBlob}
                onChange={(e) => onColorTraceMinBlobChange(Math.max(0, Math.min(200, Number(e.target.value) || 0)))}
                style={{ width: 56 }}
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
              style={{ width: 56 }}
            />
            {runButton('color-trace-run', 'Trace', onTrace, false, 'Trace this colour into the series')}
          </div>
        </div>
      )}

      {/* ⚑⚑ OFFERED, NEVER IMPOSED. The user may genuinely mean to add a second colour to one series, so this
          suggests and does not refuse; taking the offer is ONE gesture. */}
      {mode === 'color-trace' && newColourForThisSeries && (
        <div data-testid="new-colour-series-offer" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: theme.font.size.small, color: theme.color.text.legend }}>
          <span>This series was traced from a different colour.</span>
          <button type="button" data-testid="trace-into-new-series" onClick={onTraceIntoNewSeries} title="Add a series and trace this colour into it">
            Trace into a new series
          </button>
        </div>
      )}
      {/* ⚑⚑ A REFUSAL WITH ITS OWN UNDO: the held-back shapes are not in the record; this says so and takes them
          back in one click, drawn the same way as the new-colour offer because it is the same kind of thing. */}
      {mode === 'color-trace' && heldBackOffer && (
        <div data-testid="swatch-hold-back-offer" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: theme.font.size.small, color: theme.color.text.legend }}>
          <span>{heldBackOffer.sentence}</span>
          <button type="button" data-testid="add-held-back-bars" onClick={onAddHeldBackBars} title="Record them as bars after all">
            {heldBackOffer.action}
          </button>
        </div>
      )}

      {said.length > 0 && (
        <div data-testid="extract-said" style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 4, ...small }}>
          {said}
        </div>
      )}
    </div>
  );
}
