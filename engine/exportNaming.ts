import type { TableFormat } from './tableFormats.js';

/**
 * What an exported file is CALLED, and which filter the save dialog offers.
 *
 * ⚑ The default filename is derived from the source image (`figure.png` →
 * `figure.csv`) rather than hardcoded, because a hardcoded `data.csv` collides
 * on every export when someone batches a folder - the second figure silently
 * overwrites the first, or the user has to rename by hand thirty times. That
 * makes path parsing part of the product, and path parsing is exactly where
 * edge cases live: a Windows path, a dotfile, a name that is nothing but an
 * extension, a name that is only spaces.
 */

/** Formats that render to text and therefore carry a dialog filter of their own. */
export type NamedExportFormat = 'json' | TableFormat;

export const EXPORT_FILTER_NAMES: Record<NamedExportFormat, string> = {
  json: 'JSON',
  csv: 'CSV',
  tsv: 'TSV',
  latex: 'LaTeX',
  matlab: 'MATLAB',
  python: 'Python',
  r: 'R',
};

/**
 * The stem an export defaults to: the source image's own name, stripped of its
 * directory and extension.
 *
 * Falls back to `data` when there is no usable name - including when stripping
 * leaves nothing behind (`.gitignore`, `   .png`), which is the case a plain
 * `replace` chain silently turns into an empty filename.
 */
export function exportBaseName(imageName: string | null | undefined, sourceName?: string | null): string {
  const raw = imageName || sourceName || null;
  if (!raw) return 'data';
  // Both separators, since a project may have been saved on another platform.
  const base = raw
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .trim();
  return base || 'data';
}
