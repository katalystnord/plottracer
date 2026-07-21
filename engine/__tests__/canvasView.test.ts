import { describe, expect, it } from 'vitest';
import {
  fitToContainer,
  zoomAt,
  zoomByFactor,
  panBy,
  screenToImage,
  imageToScreen,
  isClick,
  scaleToSlider,
  sliderToScale,
  DEFAULT_VIEW_LIMITS,
} from '../canvasView.js';

describe('fitToContainer', () => {
  it('scales down and centers an image larger than the container', () => {
    const view = fitToContainer(1000, 500, 500, 500);
    expect(view.scale).toBeCloseTo(0.5, 10);
    expect(view.offsetX).toBeCloseTo(0, 10);
    expect(view.offsetY).toBeCloseTo(125, 10);
  });

  it('never upscales past 1:1 for an image smaller than the container', () => {
    const view = fitToContainer(100, 100, 500, 500);
    expect(view.scale).toBe(1);
    expect(view.offsetX).toBeCloseTo(200, 10);
    expect(view.offsetY).toBeCloseTo(200, 10);
  });
});

describe('screenToImage / imageToScreen', () => {
  it('round-trip under an arbitrary view', () => {
    const view = { scale: 2, offsetX: 30, offsetY: -10 };
    const image = screenToImage(view, 130, 90);
    expect(image).toEqual({ x: 50, y: 50 });
    const screen = imageToScreen(view, image.x, image.y);
    expect(screen.x).toBeCloseTo(130, 10);
    expect(screen.y).toBeCloseTo(90, 10);
  });
});

describe('zoomAt', () => {
  it('keeps the point under the cursor fixed in screen space', () => {
    const view = { scale: 1, offsetX: 0, offsetY: 0 };
    const before = screenToImage(view, 200, 150);
    const zoomed = zoomAt(view, 200, 150, -400);
    const after = screenToImage(zoomed, 200, 150);
    expect(zoomed.scale).toBeGreaterThan(1);
    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.y).toBeCloseTo(before.y, 8);
  });

  it('zooms in for negative deltaY and out for positive deltaY', () => {
    const view = { scale: 1, offsetX: 0, offsetY: 0 };
    expect(zoomAt(view, 0, 0, -100).scale).toBeGreaterThan(1);
    expect(zoomAt(view, 0, 0, 100).scale).toBeLessThan(1);
  });

  it('clamps to the provided scale limits', () => {
    const view = { scale: DEFAULT_VIEW_LIMITS.minScale, offsetX: 0, offsetY: 0 };
    expect(zoomAt(view, 0, 0, 100000).scale).toBe(DEFAULT_VIEW_LIMITS.minScale);
    const maxed = { scale: DEFAULT_VIEW_LIMITS.maxScale, offsetX: 0, offsetY: 0 };
    expect(zoomAt(maxed, 0, 0, -100000).scale).toBe(DEFAULT_VIEW_LIMITS.maxScale);
  });
});

describe('zoomByFactor', () => {
  it('keeps the point under (centerX, centerY) fixed in screen space', () => {
    const view = { scale: 1, offsetX: 0, offsetY: 0 };
    const before = screenToImage(view, 200, 150);
    const zoomed = zoomByFactor(view, 200, 150, 2);
    const after = screenToImage(zoomed, 200, 150);
    expect(zoomed.scale).toBeCloseTo(2, 10);
    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.y).toBeCloseTo(before.y, 8);
  });

  it('reaches exactly scale 1 when the factor undoes the current scale -- the "Actual Size" case', () => {
    const view = { scale: 2.5, offsetX: 40, offsetY: -20 };
    const result = zoomByFactor(view, 300, 200, 1 / view.scale);
    expect(result.scale).toBeCloseTo(1, 10);
  });

  it('clamps to the provided scale limits, same as zoomAt', () => {
    const view = { scale: DEFAULT_VIEW_LIMITS.maxScale, offsetX: 0, offsetY: 0 };
    expect(zoomByFactor(view, 0, 0, 100).scale).toBe(DEFAULT_VIEW_LIMITS.maxScale);
    const minned = { scale: DEFAULT_VIEW_LIMITS.minScale, offsetX: 0, offsetY: 0 };
    expect(zoomByFactor(minned, 0, 0, 0.0001).scale).toBe(DEFAULT_VIEW_LIMITS.minScale);
  });

  it('zoomAt is expressible as zoomByFactor with the equivalent wheel-derived factor', () => {
    const view = { scale: 1, offsetX: 5, offsetY: -5 };
    const viaWheel = zoomAt(view, 120, 80, -250);
    const viaFactor = zoomByFactor(view, 120, 80, Math.exp(250 * 0.001));
    expect(viaFactor).toEqual(viaWheel);
  });
});

describe('panBy', () => {
  it('shifts offsets by exactly the given delta, leaving scale untouched', () => {
    const view = { scale: 3, offsetX: 10, offsetY: 20 };
    expect(panBy(view, 5, -7)).toEqual({ scale: 3, offsetX: 15, offsetY: 13 });
  });
});

describe('scaleToSlider / sliderToScale (checkpoint 37)', () => {
  it('maps the two scale limits to the slider endpoints', () => {
    expect(scaleToSlider(DEFAULT_VIEW_LIMITS.minScale)).toBeCloseTo(0, 10);
    expect(scaleToSlider(DEFAULT_VIEW_LIMITS.maxScale)).toBeCloseTo(100, 10);
    expect(sliderToScale(0)).toBeCloseTo(DEFAULT_VIEW_LIMITS.minScale, 10);
    expect(sliderToScale(100)).toBeCloseTo(DEFAULT_VIEW_LIMITS.maxScale, 10);
  });

  it('puts the geometric-mean scale (exactly 1.0 for the default 0.05..20 range) at the midpoint', () => {
    // 0.05 * 400^0.5 = 0.05 * 20 = 1.0 -- so 100% sits dead-center, the
    // whole point of using a log axis here.
    expect(scaleToSlider(1)).toBeCloseTo(50, 10);
    expect(sliderToScale(50)).toBeCloseTo(1, 10);
  });

  it('round-trips scale -> slider -> scale across the range', () => {
    for (const scale of [0.05, 0.2, 0.5, 1, 2, 7.5, 20]) {
      expect(sliderToScale(scaleToSlider(scale))).toBeCloseTo(scale, 8);
    }
  });

  it('clamps out-of-range scales to the slider endpoints rather than extrapolating', () => {
    expect(scaleToSlider(0.001)).toBe(0);
    expect(scaleToSlider(1000)).toBe(100);
  });

  it('clamps out-of-range slider positions to the scale limits', () => {
    expect(sliderToScale(-10)).toBeCloseTo(DEFAULT_VIEW_LIMITS.minScale, 10);
    expect(sliderToScale(250)).toBeCloseTo(DEFAULT_VIEW_LIMITS.maxScale, 10);
  });

  it('honors custom limits', () => {
    const limits = { minScale: 0.5, maxScale: 8 };
    expect(scaleToSlider(0.5, limits)).toBeCloseTo(0, 10);
    expect(scaleToSlider(8, limits)).toBeCloseTo(100, 10);
    expect(sliderToScale(50, limits)).toBeCloseTo(2, 10); // 0.5 * 16^0.5 = 2
  });
});

describe('isClick', () => {
  it('treats zero movement as a click', () => {
    expect(isClick(10, 10, 10, 10)).toBe(true);
  });

  it('treats movement within the threshold as a click', () => {
    expect(isClick(10, 10, 12, 12)).toBe(true);
  });

  it('treats movement beyond the threshold as a drag, not a click', () => {
    expect(isClick(10, 10, 50, 50)).toBe(false);
  });
});
