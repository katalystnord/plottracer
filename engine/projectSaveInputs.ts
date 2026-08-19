/**
 * WHAT A SAVE WRITES - the choices, separated from the writing.
 *
 * ⚑⚑ TWENTY-SIX BRANCHES AND NOTHING EXTRACTED. `saveProject` was the densest
 * decision block left in `Workspace.tsx`, and none of it could be reached
 * except by driving Electron. Two of its rules exist because an audit found
 * them WRONG once already (H1 and A3 below) - and a rule with a finding behind
 * it is the last thing that should live where no test can ask about it.
 *
 * ⚑ Pure by design: the effects - writing bytes, clearing the unsaved flag,
 * showing a refusal - stay in the component, which is where effects belong.
 * This module only answers "which copy, which source, described how".
 */

/** A figure's stashed record - what was true when it was last switched away. */
export interface FigureState<S, M, Sc, P> {
  session: S;
  imageDataURL: string;
  imageFileName?: string | undefined;
  measurements: M;
  measureScale: Sc;
  provenance: P;
}

/** The live refs. ⚑ The two image fields are OPTIONAL here and required on the
 * record, which is the type saying what the fallback is for: the canvas can be
 * mid-swap and answer nothing, the figure always has its last known image. */
export interface LiveFigureState<S, M, Sc, P> extends Omit<FigureState<S, M, Sc, P>, 'imageDataURL'> {
  imageDataURL: string | undefined;
}

export interface FigureSaveInput<S, M, Sc, P> {
  name: string;
  /** True for the figure currently on screen, whose live refs are authoritative. */
  active: boolean;
  /** What was stashed into the figure's record when it was last switched away. */
  record: FigureState<S, M, Sc, P>;
  /** What the live refs hold right now. */
  live: LiveFigureState<S, M, Sc, P>;
}

/**
 * Which copy of a figure gets written.
 *
 * ⚑⚑ AUDIT H1 LIVES HERE. The ACTIVE figure's record is a snapshot taken when it
 * was last switched away from, and a PDF page flip (`goToPdfPage`) swaps the
 * live session WITHOUT re-stashing it - so the record can hold a different
 * session object entirely, and saving it writes the wrong page's work. Only the
 * active figure can desync this way; the inactive ones were stashed on switch
 * and their records are correct by construction.
 *
 * ⚑ A live value that is MISSING falls back to the record rather than to
 * nothing: the canvas can be mid-swap and answer undefined, and the figure still
 * has its last known image. Saving a blank one would be a silent loss.
 */
export function figureSaveInput<S, M, Sc, P>({
  name,
  active,
  record,
  live,
}: FigureSaveInput<S, M, Sc, P>): { name: string } & FigureState<S, M, Sc, P> {
  if (!active) return { name, ...record };
  return {
    name,
    session: live.session,
    imageDataURL: live.imageDataURL ?? record.imageDataURL,
    imageFileName: live.imageFileName ?? record.imageFileName,
    measurements: live.measurements,
    measureScale: live.measureScale,
    provenance: live.provenance,
  };
}

/**
 * The source document a multi-figure project carries.
 *
 * ⚑⚑ AUDIT A3 LIVES HERE. The document belongs to the PROJECT, threaded through
 * whichever figure happened to open it - so reading only the active figure's ref
 * dropped it on re-save, and the project quietly lost the PDF it was made from.
 * Any figure's counts.
 */
export function sharedProjectSource<T>(
  figures: readonly { sourcePdf: T | null | undefined }[],
  liveSource: T | null | undefined
): T | null {
  return liveSource ?? figures.map((f) => f.sourcePdf).find((s) => s != null) ?? null;
}

/**
 * How the source document is described in the file.
 *
 * ⚑ Written out twice before this - once on the multi-figure path and once on
 * the single - which is two homes for one rule about what the bytes are. The
 * FORMAT is sniffed from the bytes by the caller's own detector; what lives here
 * is the mapping to a mime type and the "no source, no descriptor" rule.
 */
export function sourceDescriptor<N extends string | undefined>(
  source: { name?: N; bytes: Uint8Array } | null | undefined,
  // ⚑ `string | null`, because the sniffer answers null for bytes it does not
  // recognise - and that case must reach the same branch as "not a tiff",
  // rather than being excluded by a type that never admitted it.
  formatOf: (bytes: Uint8Array) => string | null
): { name: N | undefined; mime: string; bytes: Uint8Array } | undefined {
  if (!source) return undefined;
  return {
    name: source.name,
    mime: formatOf(source.bytes) === 'tiff' ? 'image/tiff' : 'application/pdf',
    bytes: source.bytes,
  };
}

/**
 * What an opened multi-figure container installs.
 *
 * ⚑⚑ AUDIT B-F6 LIVES HERE. A container holding ONE figure is a SINGLE-figure
 * session: `figures` stays empty, which is design §0's invariant and what keeps
 * the figure jumper hidden. Installing a list of one would show a jumper with
 * nothing to jump to. Only a hand-edited file can produce it - Save never writes
 * one - which is exactly why no test could reach the rule before it moved here.
 *
 * ⚑ An active index the file names but does not have restores the FIRST figure.
 * Opening to a blank workspace would read as the project having failed to load.
 */
export function figuresForOpenedProject<T>(
  records: readonly T[],
  activeFigure: number
): { figures: T[]; active: number; restore: T | undefined } {
  const inRange = activeFigure >= 0 && activeFigure < records.length;
  if (records.length === 1) return { figures: [], active: 0, restore: records[0] };
  const active = inRange ? activeFigure : 0;
  return { figures: [...records], active, restore: records[active] };
}
