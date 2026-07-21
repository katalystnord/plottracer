/**
 * Framework-agnostic canvas view-transform math: fit-to-container, cursor-
 * centered zoom, pan, screen<->image coordinate conversion, and click-vs-
 * drag disambiguation. Pulled out of ui/src/ImageCanvas.tsx (checkpoint 2
 * of the engine/ui spike, see CLAUDE.md) so it's plain, tested TypeScript
 * with no DOM/React dependency — the "framework-agnostic vanilla TS engine
 * module for canvas/interaction" from CLAUDE.md's Product #1 design, not
 * just a promise.
 */

export interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface ViewLimits {
  minScale: number;
  maxScale: number;
}

export const DEFAULT_VIEW_LIMITS: ViewLimits = { minScale: 0.05, maxScale: 20 };
export const CLICK_DRAG_THRESHOLD_PX = 4;

/** Scale an image to fit inside a container, centered, without upscaling past 1:1. */
export function fitToContainer(
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number
): ViewState {
  const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight, 1);
  return {
    scale,
    offsetX: (containerWidth - imageWidth * scale) / 2,
    offsetY: (containerHeight - imageHeight * scale) / 2,
  };
}

/** Scale the view by a multiplicative factor, keeping the point under
 * (centerX, centerY) fixed -- the recentering math wheel-zoom, menu-driven
 * Zoom In/Out, and "Actual Size" all need, factored out so a menu action
 * without a mouse position (checkpoint 32, see CLAUDE.md) can reuse it
 * instead of only being reachable via a synthetic wheel delta. */
export function zoomByFactor(
  view: ViewState,
  centerX: number,
  centerY: number,
  factor: number,
  limits: ViewLimits = DEFAULT_VIEW_LIMITS
): ViewState {
  const newScale = Math.min(limits.maxScale, Math.max(limits.minScale, view.scale * factor));
  const imageX = (centerX - view.offsetX) / view.scale;
  const imageY = (centerY - view.offsetY) / view.scale;
  return {
    scale: newScale,
    offsetX: centerX - imageX * newScale,
    offsetY: centerY - imageY * newScale,
  };
}

/** Map a zoom scale to a 0..100 slider position on a *logarithmic* axis.
 * The scale range spans a ~400x ratio (0.05..20 by default), so a linear
 * slider would be unusable -- almost all of its travel would sit above
 * 100%. On a log axis the midpoint lands on the geometric mean of the
 * limits, which for the default 0.05..20 range is exactly scale 1 (100%) --
 * a natural, discoverable center. Mirrors the log mapping in Ketcher's own
 * `TopToolbar/ZoomSlider.tsx` (its `ScaleTransformer`), adapted to this
 * app's own scale limits. Pure so the mapping is unit-tested here rather
 * than only exercised through the React slider. */
export function scaleToSlider(scale: number, limits: ViewLimits = DEFAULT_VIEW_LIMITS): number {
  const clamped = Math.min(limits.maxScale, Math.max(limits.minScale, scale));
  const t = Math.log(clamped / limits.minScale) / Math.log(limits.maxScale / limits.minScale);
  return t * 100;
}

/** Inverse of scaleToSlider: map a 0..100 slider position back to a zoom scale. */
export function sliderToScale(sliderValue: number, limits: ViewLimits = DEFAULT_VIEW_LIMITS): number {
  const t = Math.min(100, Math.max(0, sliderValue)) / 100;
  return limits.minScale * Math.pow(limits.maxScale / limits.minScale, t);
}

/** Zoom the view by a wheel delta, keeping the point under (screenX, screenY) fixed. */
export function zoomAt(
  view: ViewState,
  screenX: number,
  screenY: number,
  wheelDeltaY: number,
  limits: ViewLimits = DEFAULT_VIEW_LIMITS
): ViewState {
  return zoomByFactor(view, screenX, screenY, Math.exp(-wheelDeltaY * 0.001), limits);
}

/** Pan the view by a screen-space delta. */
export function panBy(view: ViewState, dx: number, dy: number): ViewState {
  return { ...view, offsetX: view.offsetX + dx, offsetY: view.offsetY + dy };
}

export function screenToImage(view: ViewState, screenX: number, screenY: number): { x: number; y: number } {
  return { x: (screenX - view.offsetX) / view.scale, y: (screenY - view.offsetY) / view.scale };
}

export function imageToScreen(view: ViewState, imageX: number, imageY: number): { x: number; y: number } {
  return { x: imageX * view.scale + view.offsetX, y: imageY * view.scale + view.offsetY };
}

/** True if a mouse-down-then-up pair should be treated as a click rather than a drag-pan. */
export function isClick(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  threshold: number = CLICK_DRAG_THRESHOLD_PX
): boolean {
  return Math.hypot(endX - startX, endY - startY) <= threshold;
}
