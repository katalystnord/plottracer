import type { CanvasMarker } from './canvasOverlays.js';
import type { NotDataRegion } from '../core/plotData.js';

/**
 * The corner grips of the legend and the masked areas (v2.7; David 2026-10-31, docs/v2.7-workflow-walk.md): every
 * rectangle keeps corners that can be moved while the Legend card is open, as the calibration handles can only
 * while the calibration card is. Square `aid` grips, the category ticks' kind: something set by eye, not a
 * precise reference.
 */

export type RegionCorner = 'tl' | 'tr' | 'br' | 'bl';
const CORNERS: readonly RegionCorner[] = ['tl', 'tr', 'br', 'bl'];
const ID = /^region:(\d+):(tl|tr|br|bl)$/;

export function regionCornerMarkers(
  regions: readonly NotDataRegion[],
  colours: { mask: string; legend: string }
): CanvasMarker[] {
  return regions.flatMap((r, index) =>
    CORNERS.map((corner) => ({
      id: `region:${index}:${corner}`,
      x: corner === 'tl' || corner === 'bl' ? r.x : r.x + r.width,
      y: corner === 'tl' || corner === 'tr' ? r.y : r.y + r.height,
      label: '',
      color: r.kind === 'legend' ? colours.legend : colours.mask,
      draggable: true,
      kind: 'aid' as const,
      radius: 4,
    }))
  );
}

/** Which rectangle and corner a grip's marker id names, or null when the id is not a grip's. */
export function regionCornerFromId(id: string): { index: number; corner: RegionCorner } | null {
  const m = ID.exec(id);
  return m ? { index: Number(m[1]), corner: m[2] as RegionCorner } : null;
}
