/**
 * What a contour line's inline label SAID (v2.6, S5): the evidence for its
 * level, kept with the line - in the series' own metadata, which the project
 * file already saves and restores - and never exported as a data point.
 *
 * ⚑ A read is OFFERED, not asserted. Measured on the research figures with the
 * reader the app ships (tesseract.js): too many reads were wrong to write them
 * into the Level field unasked, and a wrong level looks exactly like a right
 * one. So the panel shows what the label reads, and one press uses it.
 */
import type { Dataset } from '../core/dataset.js';

export interface LabelRead {
  /** What the reader made of the label, tidied. */
  text: string;
  /** The number it reads as, or null when the read was refused. */
  value: number | null;
  /** Why it was refused (N2), or null. */
  refused: string | null;
  /** Where the label sits, image pixels. */
  at: [number, number];
}

const KEY = 'contourLabelRead';

export function getLabelRead(dataset: Dataset): LabelRead | null {
  const raw = dataset.getMetadata()[KEY];
  if (raw == null || typeof raw !== 'object') return null;
  const { text, value, refused, at } = raw as Record<string, unknown>;
  if (typeof text !== 'string') return null;
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) return null;
  if (refused !== null && typeof refused !== 'string') return null;
  if (!Array.isArray(at) || at.length !== 2 || !at.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return { text, value: value as number | null, refused: refused as string | null, at: [at[0] as number, at[1] as number] };
}

export function setLabelRead(dataset: Dataset, read: LabelRead | null): void {
  const meta = { ...dataset.getMetadata() };
  if (read) meta[KEY] = { text: read.text, value: read.value, refused: read.refused, at: [read.at[0], read.at[1]] };
  else delete meta[KEY];
  dataset.setMetadata(meta);
}
