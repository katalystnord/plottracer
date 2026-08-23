import { Popover } from '@mui/material';
import { theme } from '../theme.js';
import { SidebarSection, SidebarHeading } from '../layout.js';
import { EyedropperIcon } from '../icons.js';
import { rgbToHex } from '../format.js';
import { SERIES_COLOR_PALETTE, type DatasetInfo } from '../../../engine/calibrationSession.js';

export interface SeriesPanelProps {
  infos: readonly DatasetInfo[];
  activeInfo: DatasetInfo | undefined;
  activeIndex: number;
  /** This graph type is Bar, which is the only one offering stack groups. */
  /** This type's series can be grouped into stacks -- `supportsStackGroups` on
   * the config. Named for the CAPABILITY, not the type: it used to be `isBar`,
   * which asked WHICH TYPE for something that is a question about what the type
   * can do. */
  supportsStackGroups: boolean;
  /** The in-flight rename, or null when the field shows the stored name. */
  nameDraft: string | null;
  /** Why the draft name is refused - shown under the field. */
  nameNotice: string | null;
  colorAnchor: HTMLElement | null;
  onColorAnchorChange: (anchor: HTMLElement | null) => void;
  stackGroupOf: (index: number) => string | null;
  onSetStackGroup: (index: number, group: string | null) => void;
  onAdd: () => void;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
  onRenameDraft: (index: number, name: string) => void;
  onCommitRename: (index: number, name: string) => void;
  /** Takes a "#rrggbb" string - the swatches and the hex field both speak hex. */
  onSetColor: (index: number, hex: string) => void;
  /** Adding a series needs axes to place points against. */
  canAddSeries: boolean;
  /** The eyedropper needs something to sample. */
  canvasHasImage: boolean;
  onCommitPendingEdit: () => void;
  onArmEyedropper: (target: 'series') => void;
}

/**
 * The Series panel - which series you are working on, its colour and name.
 *
 * ⚑ The colour swatches are OUR OWN palette rather than the native
 * `<input type="color">` dialog, which CRASHES this Electron build on Linux.
 * The hex field beside them is the escape hatch for anything not in the eight.
 */
export function SeriesPanel(props: SeriesPanelProps) {
  const {
    infos,
    activeInfo,
    activeIndex,
    supportsStackGroups,
    nameDraft,
    nameNotice,
    colorAnchor,
    onColorAnchorChange,
    stackGroupOf,
    onSetStackGroup,
    onAdd,
    onSelect,
    onRemove,
    onRenameDraft,
    onCommitRename,
    onSetColor,
    canAddSeries,
    canvasHasImage,
    onCommitPendingEdit,
    onArmEyedropper,
  } = props;
  return (
    <SidebarSection>
      <SidebarHeading>Series</SidebarHeading>
      {/* A dropdown to pick the active series (scales to many series, unlike
          the old chip row), with the active series' own controls beside it:
          recolor, rename, delete. New points/actions apply to the active
          series; the spreadsheet below shows every series at once. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <select
          data-testid="series-select"
          value={activeIndex}
          onChange={(e) => onSelect(Number(e.target.value))}
          style={{
            flex: '1 1 120px',
            minWidth: 120,
            height: 30,
            fontSize: theme.font.size.regular,
            fontFamily: theme.font.family,
            color: theme.color.text.primary,
            background: theme.color.background.primary,
            border: `1px solid ${theme.color.border.regular}`,
            borderRadius: theme.border.radius.regular,
            padding: '0 6px',
          }}
        >
          {infos.map((info) => (
            <option key={info.index} value={info.index} data-testid={`series-option-${info.index}`}>
              {info.name} ({info.pointCount})
            </option>
          ))}
        </select>
        <button type="button" data-testid="add-series" onClick={onAdd} disabled={!canAddSeries} title="Add a new series">
          + Add
        </button>
      </div>
      {activeInfo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Series-colour picker (checkpoint 91). A single swatch button
              showing the current colour -- the compact one-square footprint
              the old native <input type="color"> had, so the NAME field keeps
              its width -- opening a Popover with the full crash-free control:
              palette swatches, the image eyedropper, and a hex field. (Ckpts
              89/90 built those controls native-dialog-free; ckpt 91 just stops
              them crowding out the name.) */}
          <button
            type="button"
            data-testid="series-color-button"
            title="Series colour"
            onClick={(e) => onColorAnchorChange(e.currentTarget)}
            style={{
              width: 22,
              height: 22,
              flex: '0 0 auto',
              padding: 0,
              borderRadius: 4,
              background: rgbToHex(activeInfo.color),
              cursor: 'pointer',
              border: `1px solid rgba(0,0,0,0.25)`,
            }}
          />
          <Popover
            open={Boolean(colorAnchor)}
            anchorEl={colorAnchor}
            onClose={() => onColorAnchorChange(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          >
            <div data-testid="series-color-menu" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, width: 176 }}>
              <div data-testid="series-swatches" style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 3 }}>
                {SERIES_COLOR_PALETTE.map((rgb) => {
                  const hex = rgbToHex(rgb);
                  const selected = rgbToHex(activeInfo.color).toLowerCase() === hex.toLowerCase();
                  return (
                    <button
                      key={hex}
                      type="button"
                      data-testid={`series-swatch-${hex.slice(1)}`}
                      title={hex}
                      onClick={() => onSetColor(activeIndex, hex)}
                      style={{
                        width: 18,
                        height: 18,
                        padding: 0,
                        borderRadius: 3,
                        background: hex,
                        cursor: 'pointer',
                        border: selected ? `2px solid ${theme.color.text.primary}` : '1px solid rgba(0,0,0,0.2)',
                      }}
                    />
                  );
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  // Uncontrolled + keyed so a swatch click or a series switch
                  // remounts it with the new colour; only a full #rrggbb applies,
                  // so typing one out works without the native picker.
                  key={`${activeIndex}-${rgbToHex(activeInfo.color)}`}
                  type="text"
                  data-testid="series-color"
                  title="Series colour (hex, e.g. #1f77b4)"
                  defaultValue={rgbToHex(activeInfo.color)}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    if (/^#[0-9a-fA-F]{6}$/.test(v)) onSetColor(activeIndex, v);
                  }}
                  onBlur={onCommitPendingEdit}
                  style={{ width: 84, fontSize: theme.font.size.small, fontFamily: 'monospace' }}
                />
                {/* Eyedropper: take the colour the FIGURE draws this series in
                    (checkpoint 90) -- the safe on-canvas sampler, never the OS
                    screen-picker that crashed. Closes the popover so the canvas
                    click that follows lands on the image, not the backdrop. */}
                <button
                  type="button"
                  data-testid="series-eyedropper"
                  title={canvasHasImage ? 'Take this series’ colour from the image' : 'Open an image first'}
                  disabled={!canvasHasImage}
                  onClick={() => {
                    onColorAnchorChange(null);
                    onArmEyedropper('series');
                  }}
                  style={{
                    width: 26,
                    height: 26,
                    flex: '0 0 auto',
                    cursor: canvasHasImage ? 'pointer' : 'default',
                    opacity: canvasHasImage ? 1 : 0.4,
                    border: `1px solid ${theme.color.border.regular}`,
                    borderRadius: 4,
                    background: theme.color.background.primary,
                    color: theme.color.text.primary,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {/* The same pipette as the two Auto-extract pickers (David,
                      2026-07-27). It wore a ⌖ reticle, which is what Place Point
                      means on the rail -- so the one glyph said "aim a point" in
                      one place and "sample a colour" in another. */}
                  <EyedropperIcon />
                </button>
              </div>
              <span style={{ fontSize: theme.font.size.small, color: theme.color.text.legend, lineHeight: 1.3 }}>
                Swatch or hex for a distinct colour; the pipette takes it from the figure.
              </span>
            </div>
          </Popover>
          <input
            data-testid="series-name"
            title="Rename series"
            value={nameDraft ?? activeInfo.name}
            onChange={(e) => onRenameDraft(activeIndex, e.target.value)}
            onBlur={(e) => onCommitRename(activeIndex, e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur(); // commit, same as looking away
            }}
            aria-invalid={nameDraft !== null && nameNotice !== null}
            style={{ flex: '1 1 auto', minWidth: 80 }}
          />
          {infos.length > 1 && (
            <button
              type="button"
              data-testid="series-remove"
              title="Delete this series"
              onClick={() => onRemove(activeIndex)}
            >
              Delete
            </button>
          )}
        </div>
      )}
      {/* Stacked bars (v2.0, Phase 5): the only UI a stack needs is naming
          which group a series belongs to -- capture itself is the same
          drag-box every other bar uses (BAR_AXES_CONFIG), one segment per
          series. Same group name on two or more series = one visual stack;
          blank = not stacked. Bar-only: a stack is specifically an ordered
          sequence of bar segments, and no other graph type has that shape. */}
      {activeInfo && supportsStackGroups && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          {/* ⚑ MIRRORS THE NAME FIELD ABOVE IT (2026-08-23). Two text inputs sit
              one under the other and both name something about the series - and
              this one was 90px wide at the small font size while the other was
              full width at the regular one, so they read as different KINDS of
              control. David: *"I think we should make the stack group box and
              font bigger."* Same size, same weight, same right edge: the user can
              see they are the same kind of thing without being told. */}
          <label htmlFor="series-stack-group" style={{ fontSize: theme.font.size.regular, color: theme.color.text.legend }}>
            Stack group:
          </label>
          <input
            id="series-stack-group"
            data-testid="series-stack-group"
            title="Group this series with others into one stacked bar -- same name, same stack. Blank = not stacked."
            placeholder="none"
            value={stackGroupOf(activeIndex) ?? ''}
            onChange={(e) => onSetStackGroup(activeIndex, e.target.value.trim() || null)}
            onBlur={onCommitPendingEdit}
            style={{ flex: '1 1 auto', minWidth: 80 }}
          />
        </div>
      )}
      {nameNotice && (
        <p data-testid="series-name-error" style={{ margin: '4px 0 0', color: theme.color.error, fontSize: 12 }}>
          {nameNotice}
        </p>
      )}
    </SidebarSection>  );
}
