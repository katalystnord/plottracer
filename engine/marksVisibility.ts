/**
 * HIDING EVERY OVERLAY MARK AT ONCE (v2.5, David 2026-09-02).
 *
 * ⚑⚑ WHY THIS EXISTS AND WHAT IT IS NOT. It began as defect #4 - the heatmap
 * divider grips sit over the figure's own tick marks and labels - and David
 * closed that as a NON-defect: our mark REPLACES the figure's mark, which is the
 * feature, and the slight overlap onto the label costs nothing because OCR still
 * reads it. What he asked for instead was one button that takes ALL our marks
 * off at once, so the figure underneath can be seen whole.
 *
 * ▶ So this is a VIEW control, not a tool. It is orthogonal to `mode`: you do
 * not leave Add points to hide the marks, you hide them and come back to the
 * same tool. That is why it lives in the top bar's View group beside the zoom
 * control - the other orthogonal view control - and NOT in the left rail, whose
 * buttons are a radio group of mutually exclusive modes. A checkbox dropped into
 * a row of radios would LOOK like them and MEAN something different, which is
 * the "matching, not mirroring" trap CLAUDE.md names.
 *
 * ⚑ ONE FUNCTION, TWO CALLERS, SO THEY CANNOT DISAGREE. The rail asks it to grey
 * a button; the canvas asks it to ignore a gesture. Asked here rather than at
 * each call site for the same reason `editsValuesInTable` is - a menu and a
 * table that answer differently is the drift that produced a live "Edit value…"
 * item with no editor behind it.
 */

/**
 * The one tool that still works while the marks are hidden.
 *
 * ⚑⚑ PAN IS LOOKING, NOT WORKING. David chose "nothing - hidden means inert"
 * for what a click does, and the option he picked spelled that out as *"no
 * placing, no grabbing, no selecting… you are looking at the figure, not working
 * on it."* Panning places nothing, grabs nothing and selects nothing: it moves
 * the eye, which is the entire point of hiding the marks. Freezing it would mean
 * you could uncover the figure and then not move around it - a look mode you
 * cannot look with.
 *
 * ⚠️ Zoom is not listed because it is not a mode - it lives in the top bar and
 * on the wheel, and it stays live for exactly the same reason.
 */
const WORKS_WHILE_MARKS_HIDDEN = ['pan'] as const;

/**
 * Why a greyed tool is greyed, in the words the user sees on hover.
 *
 * ⚑ A constant because `IconButton.disabledReason` is the only thing standing
 * between a greyed tool and the "invisible precondition" failure - a button that
 * looks dead with no sentence saying what would revive it. Every other
 * disabledReason in the rail names its unlock ("Calibrate the axes first"), so
 * this one names its own.
 */
export const MARKS_HIDDEN_REASON = 'Marks are hidden - show them to use this tool';

/**
 * Is this tool inert because the marks it works on are not on screen?
 *
 * ⚑⚑ THE GATE IS THE HIT GRAPH'S TWIN, AND BOTH HALVES ARE REQUIRED. Konva's
 * `listening={false}` stops a HIDDEN MARK being grabbed; this stops a click on
 * the bare STAGE placing a new one. Neither covers the other: the stage handler
 * fires whether or not any layer is listening, so without this you could hide
 * every mark and still stipple invisible points across the figure. That is the
 * defect family `canvasOverlays.ts`'s header memo exists for, arriving through
 * the one door it does not watch.
 */
export function inertWhileMarksHidden(mode: string, marksHidden: boolean): boolean {
  if (!marksHidden) return false;
  return !(WORKS_WHILE_MARKS_HIDDEN as readonly string[]).includes(mode);
}

/**
 * The button's own label, which has to say the STATE and the ACTION at once.
 *
 * ⚑ "Marks hidden" alone leaves the user hunting for how to get them back;
 * "Hide marks" alone, on a button that is already lit, reads as an offer to do
 * what it has plainly already done. Both halves, always, and the tooltip is
 * where a toggle can afford the words.
 */
export function marksToggleLabel(marksHidden: boolean): string {
  return marksHidden ? 'Marks hidden - click to show them' : 'Hide all marks on the figure';
}
