/**
 * AN ASYNC HANDLER THAT CANNOT FAIL SILENTLY.
 *
 * ⚑⚑ THE DEFECT THIS EXISTS FOR IS SILENT DATA LOSS (v2.3 audit, F6). Every
 * file action in this app is an `async` function wired straight to `onClick` or
 * to a prop, and none of them caught anything. `dialog:saveFile` calls
 * `fs.writeFileSync` with no try/catch of its own, so a write that throws - a
 * read-only path, no permission, a full disk - rejects the IPC. The renderer
 * awaited that rejection with no catch, and a rejected promise returned to a
 * click handler goes nowhere: no dialog, no banner, nothing in the panel.
 *
 * ▶ **The user picked a path, saw the dialog close, and believed the project was
 * on disk.** Nothing anywhere said otherwise. That is the worst failure mode
 * this codebase can have - not a wrong number, which some other instrument might
 * still catch, but work that is simply gone with a normal-looking screen behind
 * it.
 *
 * ⚑ ONE MECHANISM, NOT FOUR TRY/CATCHES. Four sites had this shape (Save
 * Project, Open Project, Open Image, and the PDF hand-off), and four hand-rolled
 * catches would be four chances to word it differently or forget one. Reused,
 * they read the same on screen because they ARE the same.
 *
 * ⚑ IT DOES NOT SWALLOW. The point is to route a failure to the surface that
 * shows it, so `report` is required rather than optional - there is no version
 * of this that quietly drops the error, because that is the bug.
 */
export function reporting(
  /** What the user was trying to do, e.g. "Could not save the project". */
  what: string,
  run: () => Promise<unknown>,
  report: (message: string) => void
): () => void {
  return () => {
    void run().catch((cause: unknown) => {
      report(`${what} - ${messageOf(cause)}`);
    });
  };
}

/**
 * The readable half of whatever was thrown.
 *
 * ⚑ An Electron IPC rejection arrives as an Error whose message carries the
 * main-process text (`"Error invoking remote method 'dialog:saveFile': Error:
 * EACCES: permission denied..."`), which is ugly but TRUE and specific enough to
 * act on. Preferring it to a generic sentence is the same call the export and
 * import paths already make: name the cause, do not tidy it away.
 */
function messageOf(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === 'string' && cause) return cause;
  return 'the reason was not reported';
}
