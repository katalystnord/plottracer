/**
 * The sentences every import filter says about a FOREIGN project, in one place.
 *
 * ⚑⚑ ONE VOCABULARY FOR ONE FACT. The same sentence was written out in
 * `starryImport.ts` and `digImport.ts` and was ABSENT from `wpdImport.ts`,
 * which refused the whole project instead - so one vendor's files were held to
 * a rule the others were not, which is what tenet 5 refuses. A shared constant
 * is what stops the three drifting apart again, the way `CONVENTION_LABELS`
 * does for the tick convention.
 *
 * ⚑ A NOTE, NOT A REFUSAL. A project's readings are measured; its picture is
 * not part of them. Opening the figure without the image and saying so is a
 * true statement about the file, where refusing strands a calibration and every
 * curve behind it over something nobody is going to read a value off.
 */

/** The image named by the project could not be turned into a picture: absent,
 *  empty, or not an image format a canvas can decode. */
export const IMAGE_UNREADABLE_NOTE =
  "This project's image could not be read, so the figure opens without it.";

/** The project bundles a PDF where an image would be. Named separately because
 *  the file is perfectly readable and simply is not a picture yet: an `<img>`
 *  cannot decode it, and saying which of the two happened is what tells the
 *  user whether there is anything to fix. */
export const IMAGE_IS_A_PDF_NOTE =
  "This project's image is a PDF, which PlotTracer can't open yet, so the figure opens without it.";
