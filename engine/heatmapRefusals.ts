import type { ColorBarRefusal } from '../algorithms/colorBar.js';

/**
 * WHAT WE SAY WHEN A COLOUR KEY CANNOT BE READ - once, for every door that says
 * it.
 *
 * ⚑⚑ THERE WERE TWO TABLES AND THEY DISAGREED (v2.3 re-audit, F34). The
 * calibration's value check (`axesTypeConfigs.ts`) and the key sampler
 * (`heatmapRun.ts`) both refuse a banded key and both refuse a strip clicked
 * across its width, and each had written its own sentence for the same
 * situation. One of them had gone stale in a way only a user would ever see:
 * *"v2.2 reads continuous ramps only"* - a version number, in the middle of a
 * refusal, still shipping in v2.3.
 *
 * ⚑ A refusal is part of the model, not decoration: it is the ONLY thing the
 * user gets instead of the number they asked for, so which words they get must
 * not depend on which of two guards happened to fire first. Same reasoning as
 * `getErrorColumns` one floor down - one answer, read by everyone.
 *
 * ⚑ NO VERSION NUMBERS. A sentence that names a release is a promise about a
 * future the sentence cannot see, and it is wrong from the next tag onwards.
 * Say what the tool does and why, which stays true.
 */

/**
 * A colour key drawn as discrete bands.
 *
 * ⚑ NAMES WHY, AND WHAT IT WOULD HAVE COST. The user is being told the tool will
 * not do the thing they asked for, so the sentence has to carry the reason: a
 * banded key maps a colour to a RANGE, and the number we could invent for it -
 * the middle of that range - is one the figure does not contain. In a heatmap
 * the colour IS the value, so that invented number would arrive with no symptom
 * at all.
 */
export const DISCRETE_KEY_REFUSAL =
  'This colour key is drawn as a few discrete bands rather than a continuous ramp, so a cell’s colour identifies a BAND - a range - and not a value. PlotTracer will not report a number the figure does not contain: read these cells against the key by eye, or trace a figure whose key is a continuous ramp.';

/** The key's two ends too close together to read a ramp between them. */
export const STRIP_NOT_A_LINE_REFUSAL =
  'The colour key’s two ends are too close together to read a ramp between them - click where the coloured strip begins and where it ends, along its length, not across its width.';

/** The sentence for every way sampling the key can refuse. */
export function stripRefusalSentence(reason: ColorBarRefusal): string {
  switch (reason) {
    case 'not-a-line':
      return STRIP_NOT_A_LINE_REFUSAL;
    case 'off-image':
      return 'The colour key’s ends must both be on the image.';
    case 'no-pixels':
      return 'Nothing was found along the colour key - the strip is fully transparent there.';
    case 'no-ramp':
      return 'The colour key reads as one flat colour, so every cell would come out the same. Click along the strip’s LENGTH rather than across its width.';
    case 'discrete':
      return DISCRETE_KEY_REFUSAL;
  }
}
