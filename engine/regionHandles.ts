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
const DATA_AREA_ID = /^data-area:(tl|tr|br|bl)$/;

type Rect = { x: number; y: number; width: number; height: number };
const grips = (r: Rect, idOf: (corner: RegionCorner) => string, color: string): CanvasMarker[] =>
  CORNERS.map((corner) => ({
    id: idOf(corner),
    x: corner === 'tl' || corner === 'bl' ? r.x : r.x + r.width,
    y: corner === 'tl' || corner === 'tr' ? r.y : r.y + r.height,
    label: '',
    color,
    draggable: true,
    kind: 'aid' as const,
    radius: 4,
  }));

export function regionCornerMarkers(
  regions: readonly NotDataRegion[],
  colours: { mask: string; legend: string }
): CanvasMarker[] {
  return regions.flatMap((r, index) => grips(r, (corner) => `region:${index}:${corner}`, r.kind === 'legend' ? colours.legend : colours.mask));
}

/** Which rectangle and corner a grip's marker id names, or null when the id is not a grip's. */
export function regionCornerFromId(id: string): { index: number; corner: RegionCorner } | null {
  const m = ID.exec(id);
  return m ? { index: Number(m[1]), corner: m[2] as RegionCorner } : null;
}

/** The data area's four grips (v2.7, engine/dataArea.ts): the same square grips as the legend's, in a colour of its
 * own, movable while the calibration card is open. `clickThrough` while the walk places points: a click on a grip is
 * a click on the figure there (see `CanvasMarker.clickThrough`). */
export function dataAreaCornerMarkers(area: Rect, color: string, clickThrough = false): CanvasMarker[] {
  return grips(area, (corner) => `data-area:${corner}`, color).map((g) => (clickThrough ? { ...g, clickThrough } : g));
}

/** Which corner of the data area a grip's marker id names, or null when the id is not one of its grips. */
export function dataAreaCornerFromId(id: string): RegionCorner | null {
  const m = DATA_AREA_ID.exec(id);
  return m ? (m[1] as RegionCorner) : null;
}
