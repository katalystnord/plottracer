import { describe, it, expect } from 'vitest';
import { routeCanvasClick, ADDS_POINT_ON_CLICK, type CanvasClickInput } from '../canvasClickRoute.js';
import type { ToolMode } from '../toolMode.js';

const ALL_MODES: readonly ToolMode[] = [
  'pan',
  'calibrate',
  'place-point',
  'select',
  'eraser',
  'segment-fill',
  'color-trace',
  'measure',
  'image-edit',
  'error-bars',
  'interpolate',
];

const at = (over: Partial<CanvasClickInput> = {}) =>
  routeCanvasClick({ eyedropper: null, mode: 'place-point', figureCaptured: true, ...over });

describe('⚑ the no-add guard — the property this module exists for', () => {
  it('turns a bare click into a data point in Place Point and NOWHERE else', () => {
    // The v0.8 defect: a rail-wired mode with no branch of its own fell through
    // to addDataPoint and fabricated a raw point in the active series. It is
    // invisible until export, so it corrupts the record rather than the screen
    // (tenets 1 and 9). One assertion over every mode, so a mode added later
    // cannot quietly inherit the fallthrough.
    for (const mode of ALL_MODES) {
      const adds = at({ mode }).kind === 'add-point';
      expect(adds, mode).toBe(ADDS_POINT_ON_CLICK.includes(mode));
    }
  });

  it('adds nothing while the eyedropper is armed, whatever the tool', () => {
    for (const mode of ALL_MODES) {
      expect(at({ mode, eyedropper: 'series' }).kind, mode).toBe('sample-colour');
    }
  });

  it('⚑ gates capture at CALIBRATE only — the one door into the record', () => {
    // Checked, because the obvious stronger claim ("nothing adds before
    // capture") is FALSE here and should stay false: `place-point` with
    // figureCaptured=false still routes to add-point.
    //
    // That is not a hole. Reaching Place Point needs axes; axes need a
    // calibration; calibrating needs a capture — and `resetDocument` clears the
    // capture flag, swaps in a FRESH (uncalibrated) session and forces
    // mode:'calibrate' in one step, so the two can never come apart. A second
    // gate here would be a refusal that cannot fire, which is this project's
    // most-repeated defect shape, so its absence is deliberate.
    expect(at({ mode: 'calibrate', figureCaptured: false }).kind).toBe('capture-first');
    expect(at({ mode: 'place-point', figureCaptured: false }).kind).toBe('add-point');
  });
});

describe('the eyedropper outranks every tool', () => {
  it('routes to the target that armed it', () => {
    expect(at({ eyedropper: 'grid' })).toEqual({ kind: 'sample-colour', target: 'grid' });
    expect(at({ eyedropper: 'series' })).toEqual({ kind: 'sample-colour', target: 'series' });
    expect(at({ eyedropper: 'trace' })).toEqual({ kind: 'sample-colour', target: 'trace' });
  });

  it('beats even the calibrate refusal', () => {
    expect(at({ eyedropper: 'grid', mode: 'calibrate', figureCaptured: false }).kind).toBe('sample-colour');
  });
});

describe('the modes that deliberately do nothing', () => {
  it('ignores a click in Pan, Error bars, By colour, Eraser and Edit image', () => {
    for (const mode of ['pan', 'error-bars', 'color-trace', 'eraser', 'image-edit'] as const) {
      expect(at({ mode }), mode).toEqual({ kind: 'ignore' });
    }
  });

  it('⚑ ignores By colour specifically — clicking the curve is the NATURAL gesture there', () => {
    // The sibling Flood-fill mechanism DOES trace by clicking the curve, so the
    // user has every reason to try it. That is what made the fallthrough so
    // easy to hit.
    expect(at({ mode: 'color-trace' }).kind).toBe('ignore');
    expect(at({ mode: 'segment-fill' }).kind).toBe('segment-fill');
  });

  it('clears rather than places in Select', () => {
    expect(at({ mode: 'select' })).toEqual({ kind: 'clear-selection' });
  });
});

describe('calibrate refuses until the figure is captured', () => {
  it('names the button to press, and what capturing means', () => {
    const route = at({ mode: 'calibrate', figureCaptured: false });
    expect(route.kind).toBe('capture-first');
    // A refusal that does not say what to do is a tenet-7 defect.
    if (route.kind !== 'capture-first') throw new Error('unreachable');
    expect(route.message).toContain('Capture the figure first');
    expect(route.message).toContain('What you see is what you capture');
  });

  it('lets the click through once the figure is frozen', () => {
    expect(at({ mode: 'calibrate', figureCaptured: true })).toEqual({ kind: 'calibrate' });
  });

  it('⚑ gates ONLY calibrate on capture — the other tools have their own reasons', () => {
    // Place Point is unreachable before calibration anyway, so a second capture
    // gate here would be a refusal that can never fire.
    expect(at({ mode: 'measure', figureCaptured: false })).toEqual({ kind: 'measure' });
    expect(at({ mode: 'segment-fill', figureCaptured: false })).toEqual({ kind: 'segment-fill' });
  });
});

describe('the tools that route to their own handler', () => {
  it('hands Measure, Flood-fill and Interpolate straight on', () => {
    expect(at({ mode: 'measure' })).toEqual({ kind: 'measure' });
    expect(at({ mode: 'segment-fill' })).toEqual({ kind: 'segment-fill' });
    expect(at({ mode: 'interpolate' })).toEqual({ kind: 'interpolate' });
  });

  it('never routes two modes to the same non-ignore handler', () => {
    // Each named route belongs to exactly one mode; a duplicate would mean a
    // tool silently doing another tool's job.
    const named = ALL_MODES.map((mode) => at({ mode }).kind).filter((k) => k !== 'ignore');
    expect(new Set(named).size).toBe(named.length);
  });
});
