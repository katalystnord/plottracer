import { WorkRegister } from '../../engine/workRegister.js';

/**
 * The app's one register of work (engine/workRegister.ts). Every long-running operation reports here, at the
 * place every caller passes through (each read in ocrClient.ts, the Find lines worker, each PDF parse and render),
 * and the status bar's ring in the lower right corner runs while one does.
 */
export const work = new WorkRegister();
