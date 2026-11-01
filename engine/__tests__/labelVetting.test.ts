/**
 * Vetting and correcting tick mark / label pairs before calibrating (David, 2026-10-17;
 * docs/v2.7-figure-type.md and plottracer-ref research/v2.7-figdet/FINDINGS.md).
 *
 * David: if at least two other pairs have HIGH confidence, a pair that disagrees with
 * them can be judged incorrect. First check the tick mark's placement; then reread the
 * value; if the value is wrong but the mark is in the right place, reassign the value;
 * if none of these is possible, set the pair aside. Two pairs per axis are enough.
 *
 * The figures here are drawn by hand (one X axis, six tick marks every 50 px, labels
 * 0 … 50 below them), so each case changes exactly one thing.
 */
import { describe, expect, it } from 'vitest';
import { readAxesFromLabels, type AxisFromLabels } from '../labelCalibration.js';
import type { PlacedDrawing, PlacedShape } from '../../algorithms/findLines/fromDrawing.js';
import type { PlacedText } from '../drawingPlacement.js';

const K = 4; // picture px per point
const SIZE = 16; // label height, px
const AXIS_Y = 400;

function mark(x: number): PlacedShape {
  return { subs: [[[x, AXIS_Y], [x, AXIS_Y + 14]]], stroked: true, filled: false, stroke: [0, 0, 0], fill: [0, 0, 0], lineWidth: 1, dash: null };
}
function label(str: string, x: number, more: Partial<PlacedText> = {}): PlacedText {
  const w = 8 * str.length;
  return { str, box: { x0: x - w / 2, y0: AXIS_Y + 18, x1: x + w / 2, y1: AXIS_Y + 18 + SIZE }, size: SIZE, ...more };
}
const XS = [100, 150, 200, 250, 300, 350];
function readX(labels: PlacedText[], marks: number[] = XS): AxisFromLabels {
  const drawing: PlacedDrawing = { shapes: marks.map(mark), text: labels.map((l) => l.box), pxPerPt: K };
  return readAxesFromLabels(drawing, labels, { width: 500, height: 500 }).x;
}
const sure = { confidence: 99 };
const unsure = { confidence: 40 };

describe('vetting tick mark / label pairs: a disagreeing pair is checked, reread, corrected or set aside', () => {
  it('a misread label at a well-placed tick mark gets the value its high-confidence neighbours give it, and says so', () => {
    const x = readX([label('0', 100, sure), label('10', 150, sure), label('20', 200, sure),
      label('80', 250, unsure), label('40', 300, sure), label('50', 350, sure)]);
    expect(x.ok).toBe(true);
    expect(x.pairs.map((p) => p.value)).toEqual([0, 10, 20, 30, 40, 50]);
    const fixed = x.pairs.find((p) => p.value === 30)!;
    expect(fixed.vetted).toEqual({ read: '80', how: 'reassigned' });
  });

  it('a misread label whose other read fits takes that read', () => {
    const x = readX([label('0', 100, sure), label('10', 150, sure), label('20', 200, sure),
      label('8', 250, { confidence: 40, alternatives: ['30'] }), label('40', 300, sure), label('50', 350, sure)]);
    expect(x.ok).toBe(true);
    expect(x.pairs.map((p) => p.value)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(x.pairs.find((p) => p.value === 30)!.vetted).toEqual({ read: '8', how: 'reread' });
  });

  it('a pair whose tick mark is off the axis\'s spacing is set aside, said, and the axis is still offered', () => {
    const x = readX([label('0', 100, sure), label('10', 150, sure), label('20', 200, sure), label('27', 225, unsure),
      label('30', 250, sure), label('40', 300, sure), label('50', 350, sure)], [...XS, 225]);
    expect(x.ok).toBe(true);
    expect(x.pairs.map((p) => p.value)).toEqual([0, 10, 20, 30, 40, 50]);
    const aside = x.unused.find((u) => u.label === '27');
    expect(aside?.reason).toBe('it does not fit the other labels, and its tick mark is off their spacing');
  });

  it('without two high-confidence pairs that agree, an axis that does not fit is refused as before', () => {
    const x = readX([label('0', 100, sure), label('10', 150, unsure), label('20', 200, unsure),
      label('80', 250, unsure), label('40', 300, unsure), label('50', 350, unsure)]);
    expect(x.ok).toBe(false);
    if (!x.ok) expect(x.reason).toBe('the labels do not fit one linear or one log scale');
  });

  it('an axis whose pairs all fit is read exactly as before, whatever their confidence', () => {
    const x = readX([label('0', 100, unsure), label('10', 150, unsure), label('20', 200, unsure),
      label('30', 250, unsure), label('40', 300, unsure), label('50', 350, unsure)]);
    expect(x.ok).toBe(true);
    expect(x.pairs.map((p) => p.value)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(x.pairs.every((p) => p.vetted === undefined)).toBe(true);
  });
});
