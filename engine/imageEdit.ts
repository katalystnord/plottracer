/**
 * Pure image-editing pixel operations (checkpoint 62) -- rotate 90° and flip,
 * used by ui/'s Image-editing fold-out card. Each op returns the transformed
 * RGBA buffer plus its new dimensions AND a `mapPoint` function that carries any
 * point in the OLD image's pixel space (a calibration handle, a data point, a
 * measurement vertex) to its position in the NEW image -- so the whole document
 * stays aligned when the image is rotated/flipped, not just the raster.
 *
 * All four ops are isometries (they preserve pixel distances and areas), so a
 * Set-scale ratio and distance/area measurements stay valid across them; only
 * the geometry needs re-placing, which mapPoint handles.
 */

export type ImageEditOp = 'rotate-cw' | 'rotate-ccw' | 'flip-h' | 'flip-v';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Clamp a (possibly out-of-bounds, possibly zero-size) crop rectangle to the
 * image, returning null if nothing usable remains -- so a stray click or an
 * off-image drag can't produce an empty or overflowing crop. */
export function clampCropRect(rect: CropRect, w: number, h: number): CropRect | null {
  const x0 = Math.max(0, Math.min(w, Math.round(Math.min(rect.x, rect.x + rect.width))));
  const y0 = Math.max(0, Math.min(h, Math.round(Math.min(rect.y, rect.y + rect.height))));
  const x1 = Math.max(0, Math.min(w, Math.round(Math.max(rect.x, rect.x + rect.width))));
  const y1 = Math.max(0, Math.min(h, Math.round(Math.max(rect.y, rect.y + rect.height))));
  const width = x1 - x0;
  const height = y1 - y0;
  if (width < 1 || height < 1) return null;
  return { x: x0, y: y0, width, height };
}

/** Crop the image to a clamped rectangle (checkpoint 63). Points shift by the
 * crop origin; a point outside the kept region maps to a negative coordinate
 * (it simply renders off-canvas), same "keep the data, let the geometry fall
 * where it may" stance as rotate/flip. */
export function cropImage(src: Uint8ClampedArray, w: number, h: number, rect: CropRect): ImageEditResult | null {
  const c = clampCropRect(rect, w, h);
  if (!c) return null;
  const dst = new Uint8ClampedArray(c.width * c.height * 4);
  for (let ry = 0; ry < c.height; ry++) {
    for (let rx = 0; rx < c.width; rx++) {
      const s = ((c.y + ry) * w + (c.x + rx)) * 4;
      const d = (ry * c.width + rx) * 4;
      dst[d] = src[s]!;
      dst[d + 1] = src[s + 1]!;
      dst[d + 2] = src[s + 2]!;
      dst[d + 3] = src[s + 3]!;
    }
  }
  return { data: dst, width: c.width, height: c.height, mapPoint: (px, py) => ({ x: px - c.x, y: py - c.y }) };
}

export interface ImageEditResult {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Old-image pixel -> new-image pixel. */
  mapPoint: (px: number, py: number) => { x: number; y: number };
}

/**
 * Rotate the image by an arbitrary angle (checkpoint 64 -- the fine-angle
 * deskew, distinct from the 90° `rotate-cw`/`rotate-ccw` ops). `deg` is
 * positive = clockwise on screen (image y grows downward). The canvas grows to
 * the rotated bounding box so no content is clipped; new corners that fall
 * outside the original raster are transparent. Sampled bilinearly so a small
 * deskew stays legible rather than aliasing. `mapPoint` is the exact affine
 * rotation about the image centre (not the pixel-sampled path), so calibration
 * handles / data points / measurement vertices rotate WITH the raster and keep
 * their geometric relationship -- a calibrated value is unchanged by a deskew,
 * same isometry guarantee as the 90° ops.
 */
export function rotateImageByAngle(src: Uint8ClampedArray, w: number, h: number, deg: number): ImageEditResult {
  const phi = (deg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const nw = Math.max(1, Math.ceil(Math.abs(w * cos) + Math.abs(h * sin)));
  const nh = Math.max(1, Math.ceil(Math.abs(w * sin) + Math.abs(h * cos)));
  const cx = w / 2;
  const cy = h / 2;
  const ncx = nw / 2;
  const ncy = nh / 2;
  const dst = new Uint8ClampedArray(nw * nh * 4);

  for (let Y = 0; Y < nh; Y++) {
    for (let X = 0; X < nw; X++) {
      // Inverse map (dest -> source): rotate by -phi about the new centre.
      const ux = X + 0.5 - ncx;
      const uy = Y + 0.5 - ncy;
      const sx = ux * cos + uy * sin + cx - 0.5;
      const sy = -ux * sin + uy * cos + cy - 0.5;
      const d = (Y * nw + X) * 4;
      if (sx < 0 || sx > w - 1 || sy < 0 || sy > h - 1) {
        dst[d] = dst[d + 1] = dst[d + 2] = dst[d + 3] = 0;
        continue;
      }
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(w - 1, x0 + 1);
      const y1 = Math.min(h - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let c = 0; c < 4; c++) {
        const p00 = src[(y0 * w + x0) * 4 + c]!;
        const p10 = src[(y0 * w + x1) * 4 + c]!;
        const p01 = src[(y1 * w + x0) * 4 + c]!;
        const p11 = src[(y1 * w + x1) * 4 + c]!;
        const top = p00 + (p10 - p00) * fx;
        const bot = p01 + (p11 - p01) * fx;
        dst[d + c] = top + (bot - top) * fy;
      }
    }
  }

  const mapPoint = (px: number, py: number): { x: number; y: number } => {
    const dx = px - cx;
    const dy = py - cy;
    return { x: dx * cos - dy * sin + ncx, y: dx * sin + dy * cos + ncy };
  };

  return { data: dst, width: nw, height: nh, mapPoint };
}

/**
 * The rotation (degrees, clockwise-positive) that makes the vector p1->p2
 * horizontal and pointing right -- used by "Auto-straighten" to level a scan
 * off the two calibration points that are meant to lie on the horizontal axis.
 * Returns 0 for a degenerate (zero-length) pair.
 */
export function straightenAngleFromPoints(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  const vx = p2.x - p1.x;
  const vy = p2.y - p1.y;
  if (vx === 0 && vy === 0) return 0;
  return (Math.atan2(-vy, vx) * 180) / Math.PI;
}

export function applyImageEditOp(op: ImageEditOp, src: Uint8ClampedArray, w: number, h: number): ImageEditResult {
  const rotate = op === 'rotate-cw' || op === 'rotate-ccw';
  const nw = rotate ? h : w;
  const nh = rotate ? w : h;
  const dst = new Uint8ClampedArray(nw * nh * 4);

  const dest = (x: number, y: number): { nx: number; ny: number } => {
    switch (op) {
      case 'rotate-cw':
        return { nx: h - 1 - y, ny: x };
      case 'rotate-ccw':
        return { nx: y, ny: w - 1 - x };
      case 'flip-h':
        return { nx: w - 1 - x, ny: y };
      case 'flip-v':
        return { nx: x, ny: h - 1 - y };
    }
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { nx, ny } = dest(x, y);
      const s = (y * w + x) * 4;
      const d = (ny * nw + nx) * 4;
      dst[d] = src[s]!;
      dst[d + 1] = src[s + 1]!;
      dst[d + 2] = src[s + 2]!;
      dst[d + 3] = src[s + 3]!;
    }
  }

  const mapPoint = (px: number, py: number): { x: number; y: number } => {
    const { nx, ny } = dest(px, py);
    return { x: nx, y: ny };
  };

  return { data: dst, width: nw, height: nh, mapPoint };
}
