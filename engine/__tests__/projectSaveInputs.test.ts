import { describe, expect, it } from 'vitest';
import { figureSaveInput, sharedProjectSource, sourceDescriptor, figuresForOpenedProject } from '../projectSaveInputs.js';

/**
 * THEME G: WHAT A SAVE ACTUALLY WRITES, where a test can reach it.
 *
 * ⚑⚑ TWENTY-SIX BRANCHES, NOTHING EXTRACTED. `saveProject` was the densest
 * decision block left in `Workspace.tsx` and none of it was reachable except by
 * driving Electron - and TWO of its rules exist because an audit found them
 * wrong once already (H1 and A3 below). A rule with a finding behind it is the
 * last thing that should live where no test can ask about it.
 *
 * ⚑ These are pure: the effects (writing bytes, clearing the unsaved flag) stay
 * in the component, which is where effects belong.
 */

const live = {
  session: 'LIVE-SESSION',
  imageDataURL: 'data:live',
  imageFileName: 'live.png',
  measurements: ['live-m'],
  measureScale: { unitPerPx: 2, unit: 'mm' },
  provenance: { crops: ['live'] },
};

const stashed = {
  session: 'STASHED-SESSION',
  imageDataURL: 'data:stashed',
  imageFileName: 'stashed.png',
  measurements: ['stashed-m'],
  measureScale: { unitPerPx: 9, unit: 'cm' },
  provenance: { crops: ['stashed'] },
};

describe('G - which copy of a figure gets saved', () => {
  it('an INACTIVE figure is saved from its own stash', () => {
    const out = figureSaveInput({ name: 'B', active: false, record: stashed, live });
    expect(out).toEqual({ name: 'B', ...stashed });
  });

  it('the ACTIVE figure is saved from the live state, not the stash it was put in', () => {
    // Its record's copy is a snapshot taken when it was last switched away from;
    // everything the user has done since lives in the refs.
    const out = figureSaveInput({ name: 'A', active: true, record: stashed, live });
    expect(out).toEqual({ name: 'A', ...live });
  });

  it('⚑⚑ AUDIT H1: the active figure\'s SESSION is read live even when the record holds another', () => {
    // A PDF page flip (`goToPdfPage`) swaps the live session WITHOUT re-stashing
    // it into the record, so the record's session is a different object entirely.
    // Saving the record's copy writes the wrong page's work, and only the active
    // figure can desync this way.
    const out = figureSaveInput({ name: 'A', active: true, record: stashed, live });
    expect(out.session).toBe('LIVE-SESSION');
  });

  it('⚑ a live value that is MISSING falls back to the record, never to nothing', () => {
    // The canvas can be mid-swap and hand back undefined; the figure still has
    // its last known image, and saving a blank one would be a silent loss.
    const out = figureSaveInput({
      name: 'A',
      active: true,
      record: stashed,
      live: { ...live, imageDataURL: undefined, imageFileName: undefined },
    });
    expect(out.imageDataURL).toBe('data:stashed');
    expect(out.imageFileName).toBe('stashed.png');
  });
});

describe('G - which source document a multi-figure project carries', () => {
  const withSrc = (name: string) => ({ sourcePdf: { name, bytes: new Uint8Array([1]) } });
  const without = { sourcePdf: null };

  it('the live source wins when there is one', () => {
    expect(sharedProjectSource([without, withSrc('other.pdf')], { name: 'live.pdf', bytes: new Uint8Array([9]) })?.name).toBe(
      'live.pdf'
    );
  });

  it('⚑⚑ AUDIT A3: ANY figure\'s source is taken when the active one has none', () => {
    // The document is a property of the PROJECT, threaded through whichever
    // figure happened to open it. Reading only the active figure's ref dropped
    // it on re-save - the project quietly lost the PDF it was made from.
    expect(sharedProjectSource([without, withSrc('paper.pdf')], null)?.name).toBe('paper.pdf');
  });

  it('and null when no figure has one', () => {
    expect(sharedProjectSource([without, without], null)).toBeNull();
  });
});

describe('G - how the source document is described in the file', () => {
  it('a TIFF says so, and a PDF says so', () => {
    // ⚑ Written out twice before this - once on the multi-figure path and once
    // on the single - which is two places for one rule about what the bytes are.
    expect(sourceDescriptor({ name: 'scan.tif', bytes: new Uint8Array([1]) }, () => 'tiff')?.mime).toBe('image/tiff');
    expect(sourceDescriptor({ name: 'paper.pdf', bytes: new Uint8Array([1]) }, () => 'pdf')?.mime).toBe(
      'application/pdf'
    );
  });

  it('no source, no descriptor - not an empty one', () => {
    expect(sourceDescriptor(null, () => 'pdf')).toBeUndefined();
  });
});

describe('G - what an opened multi-figure container installs', () => {
  const rec = (n: string) => ({ name: n });

  it('several figures install the jumper, and the file says which was active', () => {
    expect(figuresForOpenedProject([rec('a'), rec('b'), rec('c')], 2)).toEqual({
      figures: [rec('a'), rec('b'), rec('c')],
      active: 2,
      restore: rec('c'),
    });
  });

  it('⚑⚑ AUDIT B-F6: a ONE-figure container is a single-figure session, not a jumper of one', () => {
    // Only reachable from a hand-edited file - Save never writes one - and the
    // invariant it protects is design §0: `figuresRef` empty means single-figure,
    // which is what keeps the figure jumper hidden. Installing a list of one
    // would show a jumper with nothing to jump to.
    expect(figuresForOpenedProject([rec('only')], 0)).toEqual({
      figures: [],
      active: 0,
      restore: rec('only'),
    });
  });

  it('⚑ an out-of-range active index restores the FIRST figure rather than nothing', () => {
    // A hand-edited file can name a figure that is not there; opening to a blank
    // workspace would look like the project failed to load.
    expect(figuresForOpenedProject([rec('a'), rec('b')], 7).restore).toEqual(rec('a'));
  });
});
