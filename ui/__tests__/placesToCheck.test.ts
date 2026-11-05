/**
 * Places added to the list (Find lines, Auto-extract) each get an id no place in it has, after places were taken out
 * as Done. One rule for every reader (the code review of 666ea46..7d5c927, 2026-11-05: it was written out twice).
 */
import { describe, expect, it } from 'vitest';
import { appendPlaces, type LinePlace } from '../src/panels/PlacesToCheck.js';

const place = (id: number): LinePlace => ({ id, kind: 'end', at: [0, 0], text: `place ${id}` });

describe('places added to the list', () => {
  it('given places 0 and 2 left after 1 was done, two more get 3 and 4, not 2 and 3', () => {
    expect(appendPlaces([place(0), place(2)], [place(0), place(0)]).map((p) => p.id)).toEqual([0, 2, 3, 4]);
  });
  it('given an empty list, they are numbered from 0', () => {
    expect(appendPlaces([], [place(9), place(9)]).map((p) => p.id)).toEqual([0, 1]);
  });
});
