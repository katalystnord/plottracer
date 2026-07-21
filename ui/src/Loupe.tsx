import { useEffect, useRef } from 'react';
import { positionLoupe, type AvoidRect } from '../../engine/loupePosition.js';
import type { ViewState } from '../../engine/canvasView.js';
import { theme } from './theme.js';

/**
 * Floating cursor-following zoom loupe (CLAUDE.md "Product #1 — rebuild
 * design"): a rounded, Photoshop/Figma-style magnified detail view that
 * follows the cursor during calibration/point-placement, offset so it
 * doesn't cover the pixel about to be clicked, edge-of-screen clamped.
 * Positioning math lives in engine/loupePosition.ts; this component is
 * just the DOM/canvas rendering of it.
 *
 * **It shows your own points as well as the image (checkpoint 83), and until
 * then it could not.** This component took `image` and nothing else — one
 * `drawImage` of the raw raster — so the app's flagship precision tool was
 * structurally unable to answer the single question it exists to answer:
 * *did the point I just placed land ON the curve?* You could magnify the curve
 * or look at your dot, never both. That is a tenet-1 defect (it is the
 * instrument for getting reliable data out) and a tenet-7 one, not polish.
 *
 * It also silently half-defeated checkpoint 58, which fixed the loupe freezing
 * during a marker drag by feeding the dragged marker's live position into the
 * hover state — while the loupe still could not draw the marker. That fix only
 * pays off now.
 *
 * WPD has done this since forever (`graphicsWidget.js:566-579`), but the hard
 * way: its data layer isn't separable, so it alpha-composites two contexts
 * pixel-by-pixel. Ours is a Konva layer with its own canvas, so this is one
 * `drawImage` from a canvas that already exists — no re-render, no `toCanvas()`.
 * The reference tool showed us the idea; our architecture made it cheaper.
 */

const SIZE = 140;
const MAGNIFICATION = 4;

interface LoupeProps {
  image: HTMLImageElement;
  view: ViewState;
  /** Cursor position in container-local screen space. */
  cursor: { x: number; y: number };
  containerWidth: number;
  containerHeight: number;
  /**
   * The Konva overlay's live canvas — data points, calibration reticles,
   * glyphs, curve fit — composited over the magnified image (checkpoint 83).
   *
   * Passed as the canvas rather than the Konva layer so this component stays
   * ignorant of Konva, and takes the *live* element rather than a snapshot so
   * there is nothing to keep in sync: it is whatever the overlay currently
   * shows, by construction.
   */
  getOverlayCanvas?: () => HTMLCanvasElement | null;
  /** Bumped when the overlay's contents change, so the loupe recomposites even
   * if the cursor is holding still (e.g. a point is deleted under it). */
  overlayVersion?: unknown;
  /** The open tool card / rail rectangle (container-local) the loupe hops clear
   * of, so it never hides behind or draws over the card in use (David: "overlay
   * + dodge"). Null when nothing is open worth avoiding. */
  avoid?: AvoidRect | null;
}

export function Loupe({
  image,
  view,
  cursor,
  containerWidth,
  containerHeight,
  getOverlayCanvas,
  overlayVersion,
  avoid,
}: LoupeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Image-pixel coordinates under the cursor, then a source crop
    // centered on it sized so it fills SIZE x SIZE at MAGNIFICATION *
    // the current view scale.
    const imageX = (cursor.x - view.offsetX) / view.scale;
    const imageY = (cursor.y - view.offsetY) / view.scale;
    const cropSize = SIZE / (view.scale * MAGNIFICATION);
    const srcX = imageX - cropSize / 2;
    const srcY = imageY - cropSize / 2;

    // Letterbox for the (rare) case where the cropped region extends past
    // the image's own edges -- matches the app's light idle-canvas fill
    // (checkpoint 31, see CLAUDE.md) rather than the old solid-black
    // backdrop, which read as a stark "hole" against the new light chrome.
    ctx.fillStyle = theme.color.background.canvas;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(image, srcX, srcY, cropSize, cropSize, 0, 0, SIZE, SIZE);

    // Your own points, on top of the image (checkpoint 83) -- the whole reason
    // the loupe is worth having.
    //
    // The two sources live in DIFFERENT spaces, which is the only subtle part:
    // the image is cropped in IMAGE pixels, while the Konva overlay is already
    // view-transformed into SCREEN space and rendered at the device pixel ratio.
    // So the same region is (image -> screen) via the view, then scaled by the
    // canvas's own pixelRatio. Getting this wrong would offset the points from
    // the curve inside the loupe -- i.e. it would LIE about the thing it exists
    // to show, which is worse than showing nothing.
    // Resolved HERE, inside the effect, not at render: a ref is attached AFTER
    // render, so reading `ref.current` while rendering hands the loupe a null on
    // the very pass it is mounted -- which is exactly what the first draft did,
    // and the overlay never arrived. Verified by probing the live canvases: the
    // Konva layer had 2497 opaque pixels of marker while the loupe had none.
    const overlayCanvas = getOverlayCanvas?.() ?? null;
    if (overlayCanvas) {
      const ratio = overlayCanvas.width / Math.max(1, overlayCanvas.clientWidth || overlayCanvas.width);
      const sx = (srcX * view.scale + view.offsetX) * ratio;
      const sy = (srcY * view.scale + view.offsetY) * ratio;
      const sSize = cropSize * view.scale * ratio;
      // Smoothing ON for the overlay only: the image is magnified pixel-art and
      // must stay hard-edged (Engauge assessment item 3), but a 1px reticle
      // blown up 4x with smoothing off turns into a jagged staircase that is
      // harder to aim with, not easier.
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(overlayCanvas, sx, sy, sSize, sSize, 0, 0, SIZE, SIZE);
      ctx.imageSmoothingEnabled = false;
    }

    // Target reticle marking the exact cursor position (center of the loupe):
    // a center circle plus a crosshair whose arms stop short of the middle, so
    // the precise pixel about to be clicked stays visible inside the ring
    // rather than being covered by ink. Drawn twice -- a light halo underlay
    // then a dark line on top -- so it reads on both light chart paper and dark
    // plotted content (an improvement over the old single thin dark line, which
    // vanished against dark curves). Bigger than before, per request.
    const c = SIZE / 2;
    const R = 12; // center ring radius
    const ARM = 24; // crosshair reach from center
    const GAP = R + 3; // keep arms clear of the ring / target pixel
    const drawReticle = (color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(c - ARM, c);
      ctx.lineTo(c - GAP, c);
      ctx.moveTo(c + GAP, c);
      ctx.lineTo(c + ARM, c);
      ctx.moveTo(c, c - ARM);
      ctx.lineTo(c, c - GAP);
      ctx.moveTo(c, c + GAP);
      ctx.lineTo(c, c + ARM);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c, c, R, 0, Math.PI * 2);
      ctx.stroke();
    };
    drawReticle('rgba(255,255,255,0.9)', 3);
    drawReticle(theme.color.overlay.stroke, 1.5);
  }, [image, view, cursor, getOverlayCanvas, overlayVersion]);

  const { left, top } = positionLoupe(
    cursor.x,
    cursor.y,
    SIZE,
    SIZE,
    containerWidth,
    containerHeight,
    undefined,
    avoid
  );

  return (
    <div
      data-testid="zoom-loupe"
      style={{
        position: 'absolute',
        left,
        top,
        width: SIZE,
        height: SIZE,
        borderRadius: '50%',
        overflow: 'hidden',
        border: `2px solid ${theme.color.background.primary}`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        pointerEvents: 'none',
      }}
    >
      <canvas ref={canvasRef} width={SIZE} height={SIZE} style={{ display: 'block' }} />
    </div>
  );
}
