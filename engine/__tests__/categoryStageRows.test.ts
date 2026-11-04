import { describe, it, expect } from 'vitest';
import { namesRow } from '../categoryStageRows.js';

// docs/v2.7-workflow-walk.md, "The Categories stage laid out in rows"
describe('the Categories stage: the Names row', () => {
  it('given names offered by Automatic axis detection, the row offers them and nothing else writes names there', () => {
    expect(namesRow({ offered: 6, readingArmed: false })).toEqual({ kind: 'offer', text: '6 read from the labels' });
  });

  it('given one name offered, the row says so in the singular', () => {
    expect(namesRow({ offered: 1, readingArmed: false })).toEqual({ kind: 'offer', text: '1 read from the labels' });
  });

  it('given no offer (a hand calibration, or after Use them or Cancel), the row holds Read labels from the figure', () => {
    expect(namesRow({ offered: 0, readingArmed: false })).toEqual({ kind: 'read', label: 'Read labels from the figure' });
    expect(namesRow({ offered: null, readingArmed: false })).toEqual({ kind: 'read', label: 'Read labels from the figure' });
  });

  it('given the reader armed, the button says what the next drag is', () => {
    expect(namesRow({ offered: null, readingArmed: true })).toEqual({ kind: 'read', label: 'Drag a box round the labels...' });
  });
});
