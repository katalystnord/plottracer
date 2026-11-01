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

  // guard (a), David 2026-10-17 ("yes, try it"): corrections only when the pairs that agree outnumber
  // the pairs that disagree. Measured: two confident pairs once "corrected" three others (8, 9, 10 -> -2, -1, 0).
  it('when the pairs that disagree are as many as those that agree, nothing is corrected and the axis is refused as before', () => {
    const x = readX([label('0', 100, sure), label('10', 150, sure), label('70', 200, unsure),
      label('80', 250, unsure), label('90', 300, unsure), label('50', 350, unsure)]);
    expect(x.ok).toBe(false);
    if (!x.ok) expect(x.reason).toBe('the labels do not fit one linear or one log scale');
  });

  // guard (b): a pair a pixel off whose mark is on the spacing and whose value is already the one its
  // neighbours give it agrees; it is neither corrected nor counted against the majority.
  it('a tick mark a pixel off its place, with the value its neighbours give it, is kept as read', () => {
    const x = readX([label('0', 100, sure), label('10', 150, sure), label('20', 200, sure),
      label('30', 251.5, unsure), label('40', 300, sure), label('50', 350, sure)], [100, 150, 200, 251.5, 300, 350]);
    expect(x.ok).toBe(true);
    expect(x.pairs.map((p) => p.value)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(x.pairs.every((p) => p.vetted === undefined)).toBe(true);
  });

  // Measured 2026-10-17: a mark several pixels from its place was counted as "in place" when
  // the allowance was a fraction of a label step, so a broken or uneven axis was offered with every
  // pair kept as read. By David's step 1 such a mark is not in the right place: set aside, said.
  it('a tick mark several pixels from its place is not in the right place: its pair is set aside, not kept as read', () => {
    const x = readX([label('0', 100, sure), label('10', 150, sure), label('20', 200, sure),
      label('30', 256, sure), label('40', 300, sure), label('50', 350, sure)], [100, 150, 200, 256, 300, 350]);
    expect(x.ok).toBe(true);
    expect(x.pairs.map((p) => p.value)).toEqual([0, 10, 20, 40, 50]);
    expect(x.unused.find((u) => u.label === '30')?.reason).toBe('it does not fit the other labels, and its tick mark is off their spacing');
  });

  // Measured 2026-10-17 (PMC5855060): "10,000" and "20,000" on the other axis switched the figure to
  // decimal commas, because the sign class [+-−] was a RANGE from "+" to "−" that holds every
  // digit; "1,000" became 1.0 and the vetting then made 500 into 0.5 to agree.
  it('thousands separators are read as thousands: "10,000" elsewhere does not make "1,000" mean 1', () => {
    const x = readX([label('0', 100, sure), label('500', 150, sure), label('1,000', 200, sure),
      label('1,500', 250, sure), label('2,000', 300, sure), label('2,500', 350, sure),
      { str: '10,000', box: { x0: 10, y0: 10, x1: 60, y1: 26 }, size: SIZE, confidence: 99 }]);
    expect(x.ok).toBe(true);
    expect(x.pairs.map((p) => p.value)).toEqual([0, 500, 1000, 1500, 2000, 2500]);
  });

  // David, 2026-10-17: a tick label with three decimals ("1.000") is highly uncommon; on a figure
  // whose other labels are whole numbers or thousands, the dot is a thousands separator.
  it('"1.000" beside whole numbers is one thousand: 0, 500, 1.000, 1.500, 2.000, 2.500', () => {
    const x = readX([label('0', 100, sure), label('500', 150, sure), label('1.000', 200, sure),
      label('1.500', 250, sure), label('2.000', 300, sure), label('2.500', 350, sure)]);
    expect(x.ok).toBe(true);
    expect(x.pairs.map((p) => p.value)).toEqual([0, 500, 1000, 1500, 2000, 2500]);
  });

  it('"1.000" beside real decimals is one: 0.990, 0.995, 1.000, 1.005, 1.010, 1.015', () => {
    const x = readX([label('0.990', 100, sure), label('0.995', 150, sure), label('1.000', 200, sure),
      label('1.005', 250, sure), label('1.010', 300, sure), label('1.015', 350, sure)]);
    expect(x.ok).toBe(true);
    expect(x.pairs.map((p) => p.value)).toEqual([0.99, 0.995, 1, 1.005, 1.01, 1.015]);
  });

  // Measured 2026-10-17 (PMC6249732): 2.242 … 2.256 was read as 2242 … 2256. David: "what would the
  // steps be on that graph?" Thousands step in round amounts; groups like 242 are decimals.
  it('three decimals that are not round thousands stay decimals: 2.242, 2.244 … 2.252', () => {
    const x = readX(['2.242', '2.244', '2.246', '2.248', '2.250', '2.252'].map((s, i) => label(s, XS[i]!, sure)));
    expect(x.ok).toBe(true);
    expect(x.pairs.map((p) => p.value)).toEqual([2.242, 2.244, 2.246, 2.248, 2.25, 2.252]);
  });

  it('several dot groups are thousands: 0, 1.000.000 … 5.000.000', () => {
    const x = readX(['0', '1.000.000', '2.000.000', '3.000.000', '4.000.000', '5.000.000'].map((s, i) => label(s, XS[i]!, sure)));
    expect(x.ok).toBe(true);
    expect(x.pairs.map((p) => p.value)).toEqual([0, 1e6, 2e6, 3e6, 4e6, 5e6]);
  });

  it('on a figure with decimal commas, a dot is a thousands separator: 1.000,5 is 1000.5', () => {
    const x = readX(['0', '500,5', '1.000,5', '1.500,5', '2.000,5', '2.500,5'].map((s, i) => label(s, XS[i]!, sure)));
    expect(x.ok).toBe(true);
    expect(x.pairs.map((p) => p.value)).toEqual([0, 500.5, 1000.5, 1500.5, 2000.5, 2500.5]);
  });

  it('an axis whose pairs all fit is read exactly as before, whatever their confidence', () => {
    const x = readX([label('0', 100, unsure), label('10', 150, unsure), label('20', 200, unsure),
      label('30', 250, unsure), label('40', 300, unsure), label('50', 350, unsure)]);
    expect(x.ok).toBe(true);
    expect(x.pairs.map((p) => p.value)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(x.pairs.every((p) => p.vetted === undefined)).toBe(true);
  });
});
