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

export interface ElectronFileFilter {
  name: string;
  extensions: string[];
}

declare global {
  interface Window {
    electronAPI?: {
      openImage: () => Promise<ElectronImageOpenResult | null>;
      // ⚑ ONE Open Project (v1.4, `6a16f23`): a foreign digitizer's `.tar` arrives
      // through THIS call and is recognised from its bytes. The separate
      // openWpdProject/`menu:open-wpd-project` pair was removed with the rest of
      // that tool's first-class status; the declarations outlived the runtime by
      // three commits, promising a call that no longer existed in the preload.
      openProject: () => Promise<ElectronProjectOpenResult | null>;
      // `encoding: 'base64'` writes binary (the data string is base64-decoded
      // to bytes before writing) -- PNG snapshot export, checkpoint 93, and
      // the .zip container to come. Omitted/undefined writes UTF-8 text, which
      // is what every project/CSV caller has always done.
      saveFile: (data: string, defaultName?: string, filters?: ElectronFileFilter[], encoding?: 'utf8' | 'base64') => Promise<string | null>;
      /** Confirm-on-close guard (electron-close-guard.cjs). The main process
       * fires this before the window closes / Cmd+Q; the renderer runs its
       * unsaved-work confirm and replies with confirmClose. Returns an
       * unsubscribe function. */
      onCloseRequest: (callback: () => void) => () => void;
      /** Reply to onCloseRequest: true = discard and close, false = stay open. */
      confirmClose: (allow: boolean) => void;
      /** Tell the main process the close-request handler is mounted, so it only
       * intercepts a close once the renderer is actually handling it. */
      notifyCloseGuardReady: () => void;
    };
  }
}
