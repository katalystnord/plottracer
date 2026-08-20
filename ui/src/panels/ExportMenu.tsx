import { Popover } from '@mui/material';
import { theme } from '../theme.js';
import { TopBarButton, KeyTip } from '../layout.js';
import { ExportIcon, ChevronDownIcon } from '../icons.js';
import { keyTipLabel } from '../useKeyTips.js';
import { exportOmissionNote, formatLimitationNote, type ExportContent } from '../../../engine/exportCapability.js';
import type { TableFormat } from '../../../engine/tableFormats.js';

/** Every format the menu offers, and whether it can go to the clipboard.
 *  Excel and OpenDocument are binary workbooks, so they have no copy action. */
const FORMATS = [
  { fmt: 'csv', label: 'CSV (.csv)', copyable: true },
  { fmt: 'tsv', label: 'TSV (.tsv)', copyable: true },
  { fmt: 'json', label: 'JSON (.json)', copyable: true },
  { fmt: 'ods', label: 'OpenDocument (.ods)', copyable: false },
  { fmt: 'xlsx', label: 'Excel (.xlsx)', copyable: false },
  { fmt: 'latex', label: 'LaTeX table (.tex)', copyable: true },
  { fmt: 'matlab', label: 'MATLAB (.m)', copyable: true },
  { fmt: 'python', label: 'Python (.py)', copyable: true },
  { fmt: 'r', label: 'R (.R)', copyable: true },
] as const;

// Small inline glyphs for the per-row "copy to clipboard" affordance (v1.1 #4)
// -- the overlapping-cards copy mark, swapped for a tick on success. Kept local
// (like MeasureCard's own copy glyph) rather than routed through icons.tsx.
const CopyGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
    <rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M3 11 V3.5 A1.5 1.5 0 0 1 4.5 2 H11" />
  </svg>
);
const CheckGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8.5 L6.5 12 L13 4" />
  </svg>
);

/**
 * The Export menu - every output artifact, data or figure.
 *
 * ⚑ The omission note is stated BEFORE the user picks a format, not discovered
 * afterwards (David, 2026-07-28), and every claim in it is verified against the
 * writers in engine/exportCapability.ts. Announcing a loss that does not happen
 * would be the same defect as hiding one that does - which is why roles,
 * categories, measurements and fits are NOT listed: they are carried.
 */

export type ExportMenuFormat = 'json' | 'xlsx' | 'ods' | TableFormat;

export interface ExportMenuProps {
  /** Anything to export: a calibrated chart, or just an image for the PNG. */
  enabled: boolean;
  keyTips: boolean;
  anchor: HTMLElement | null;
  onAnchorChange: (anchor: HTMLElement | null) => void;
  copiedFmt: ExportMenuFormat | null;
  onCopiedFmtChange: (fmt: ExportMenuFormat | null) => void;
  fullPrecision: boolean;
  onFullPrecisionChange: (on: boolean) => void;
  /** What this project actually holds, for the omission note. */
  content: ExportContent;
  onExport: (fmt: ExportMenuFormat, target?: 'file' | 'clipboard') => void;
  onSaveImage: () => void;
}

export function ExportMenu({
  enabled,
  keyTips,
  anchor,
  onAnchorChange,
  copiedFmt,
  onCopiedFmtChange,
  fullPrecision,
  onFullPrecisionChange,
  content,
  onExport,
  onSaveImage,
}: ExportMenuProps) {
  return (
    <>
      <TopBarButton
        type="button"
        data-testid="export-csv"
        title="Export the extracted data (CSV/TSV/JSON) or a PNG snapshot of the figure"
        onClick={(e) => { onCopiedFmtChange(null); onAnchorChange(e.currentTarget); }}
        // Enabled once there is anything to export: a calibrated chart for
        // the data formats, or just a loaded image for the PNG snapshot
        // (checkpoint 93 -- which needs no calibration, so a cropped or
        // straightened image can be saved before any axes are placed).
        disabled={!enabled}
      >
        <ExportIcon /> Export <ChevronDownIcon />
        {/* ⚑ Badged here AND on the CSV row inside, which is not two homes for one
            fact: the trigger says "there is a keyboard route to exporting", the row
            says "and it gives you this format". Unlike the zoom control -- where
            Ctrl+0 does one of four things in the menu and naming it on the trigger
            would be arbitrary -- every item here IS an export, so Ctrl+Shift+S is
            the fast path through this menu rather than a different action wearing
            its badge. Leaving the trigger bare cost the one accelerator people
            actually reach for its only visible home. */}
        {keyTips && <KeyTip>{keyTipLabel('S', true)}</KeyTip>}
      </TopBarButton>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => onAnchorChange(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <div data-testid="export-menu" style={{ display: 'flex', flexDirection: 'column', padding: 4, minWidth: 150 }}>
          {/* Precision opt-in (v1.0): default rounds each value to the figure's
              own resolution; ticked, emits every computed digit. Toggling must
              not close the popover or trigger an export, so it's a plain label
              above the format list. */}
          <label
            data-testid="export-full-precision"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', fontSize: theme.font.size.small, color: theme.color.text.secondary, cursor: 'pointer' }}
            title="Off: round each value to the figure's own resolution (~half a pixel). On: export every computed digit."
          >
            <input
              type="checkbox"
              checked={fullPrecision}
              onChange={(e) => onFullPrecisionChange(e.target.checked)}
            />
            Full precision
          </label>
          <div style={{ height: 1, background: theme.color.border.regular, margin: '2px 0' }} />
          {/* Each text format saves to a file on the label; the trailing
              copy button (v1.1 #4) puts the SAME rendered text on the
              clipboard. Excel is a binary workbook, so it has no clipboard
              action (copyable: false). */}
          {/* ⚑ What an export does NOT carry, said BEFORE the user picks a
              format rather than discovered afterwards (David, 2026-07-28).
              Every claim is verified against the writers in
              engine/exportCapability.ts -- announcing a loss that does not
              happen would be the same defect as hiding one that does, which
              is why roles, categories, measurements and fits are NOT listed:
              they are carried. It ends by naming what does keep them, so the
              warning has a door out. */}
          <p
            data-testid="export-omission-note"
            style={{
              margin: '2px 6px 6px',
              color: theme.color.text.secondary,
              fontSize: theme.font.size.small,
              maxWidth: 260,
            }}
          >
            {exportOmissionNote(content)}
          </p>
          {FORMATS.map(({ fmt, label, copyable }) => (
            <div key={fmt} style={{ display: 'flex', alignItems: 'stretch', gap: 2 }}>
              <TopBarButton
                type="button"
                data-testid={`export-format-${fmt}`}
                // What THIS format does to THIS project, when there is
                // anything true to say -- empty otherwise, because padding
                // every format with a generic caveat teaches the user to
                // ignore the line.
                title={formatLimitationNote(fmt, content) || undefined}
                onClick={() => onExport(fmt)}
                style={{ justifyContent: 'flex-start', flex: 1 }}
              >
                {label}
                {/* The accelerator sits beside the action it performs, not on the
                    menu that contains it. Only CSV has one. */}
                {fmt === 'csv' && keyTips && <KeyTip>{keyTipLabel('S', true)}</KeyTip>}
              </TopBarButton>
              {copyable && (
                <TopBarButton
                  type="button"
                  data-testid={`export-copy-${fmt}`}
                  title={copiedFmt === fmt ? 'Copied to clipboard' : `Copy ${label.replace(/ \(.*\)$/, '')} to the clipboard`}
                  onClick={() => onExport(fmt, 'clipboard')}
                  style={{ flex: '0 0 auto', padding: '0 8px', color: copiedFmt === fmt ? theme.color.primary.main : undefined }}
                >
                  {copiedFmt === fmt ? <CheckGlyph /> : <CopyGlyph />}
                </TopBarButton>
              )}
            </div>
          ))}
          {/* PNG snapshot (checkpoint 93): the image with the digitization
              drawn on it, not the extracted data. Sits with the data formats
              because "Export" is where the user looks to save any output
              artifact, but its own handler (needs only an image, not axes).

              ⚑ SEPARATED from them deliberately (v1.5 audit): the note above
              says "these formats ... do not carry the figure image", and this
              button carries exactly that and nothing else. With no boundary
              it read as one more data format the note covered, so the two
              contradicted each other on one screen. The rule gets a visible
              edge, and the heading says which side this is. */}
          <div
            data-testid="export-figure-heading"
            style={{
              // ⚑ `.regular`. The bare token is an OBJECT, and interpolating it
              // gives `1px solid [object Object]`, which the engine drops whole:
              // the rule this element exists for was never drawn. Every other
              // border in the app already reads through a leaf.
              borderTop: `1px solid ${theme.color.border.regular}`,
              margin: '6px 0 2px',
              paddingTop: 6,
              fontSize: 11,
              color: theme.color.text.secondary,
            }}
          >
            The figure itself, not the numbers
          </div>
          <TopBarButton type="button" data-testid="export-format-png" onClick={onSaveImage} style={{ justifyContent: 'flex-start' }}>
            PNG image (.png)
          </TopBarButton>
        </div>
      </Popover>    </>
  );
}
