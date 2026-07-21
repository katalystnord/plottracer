// Minimal type declaration for the subset of window.electronAPI that ui/
// currently uses (see ui/electron-dev-preload.cjs). Intentionally not the
// full electron/preload.js surface -- extend as ui/ needs more of it.
export interface ElectronImageOpenResult {
  filePath: string;
  dataURL: string;
}

// Checkpoint 25 (project save/load). As of checkpoint 94 a project file is a
// binary `.zip` container, so it comes back base64 (decoded to a Uint8Array in
// the renderer, then routed to the zip reader or the legacy JSON path by
// engine/projectContainer.ts's isZipContainer).
export interface ElectronProjectOpenResult {
  filePath: string;
  base64: string;
}

// Checkpoint 88: a WebPlotDigitizer `.tar` is binary, so it comes back base64
// (decoded to a Uint8Array in the renderer for engine/tarRead.ts).
export interface ElectronWpdProjectOpenResult {
  filePath: string;
  base64: string;
}

export interface ElectronFileFilter {
  name: string;
  extensions: string[];
}

// Checkpoint 32 (native menu bar, see CLAUDE.md and ui/electron-menu.cjs).
// Kept in sync by hand with the allowlist in ui/electron-preload.cjs --
// that Set is the real runtime enforcement, this union is only a
// compile-time guard against typo'd channel names at call sites.
export type MenuEventChannel =
  | 'menu:open-image'
  | 'menu:open-project'
  | 'menu:open-wpd-project'
  | 'menu:save-project'
  | 'menu:save-csv'
  | 'menu:zoom-in'
  | 'menu:zoom-out'
  | 'menu:zoom-fit'
  | 'menu:zoom-100'
  | 'menu:undo'
  | 'menu:redo';

declare global {
  interface Window {
    electronAPI?: {
      openImage: () => Promise<ElectronImageOpenResult | null>;
      openProject: () => Promise<ElectronProjectOpenResult | null>;
      openWpdProject: () => Promise<ElectronWpdProjectOpenResult | null>;
      // `encoding: 'base64'` writes binary (the data string is base64-decoded
      // to bytes before writing) -- PNG snapshot export, checkpoint 93, and
      // the .zip container to come. Omitted/undefined writes UTF-8 text, which
      // is what every project/CSV caller has always done.
      saveFile: (data: string, defaultName?: string, filters?: ElectronFileFilter[], encoding?: 'utf8' | 'base64') => Promise<string | null>;
      /** Registers a callback for a native menu click; returns an
       * unsubscribe function -- call it from an effect's cleanup. */
      onMenuEvent: (channel: MenuEventChannel, callback: () => void) => () => void;
    };
  }
}
