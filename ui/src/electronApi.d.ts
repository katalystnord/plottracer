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

/** The agent server's state (v2.7), pushed by ui/electron-mcp.cjs. */
export interface AgentStatus {
  /** The Settings switch is on, so the server should be listening. */
  enabled: boolean;
  listening: boolean;
  port: number | null;
  wantPort: number;
  host: string;
  token: string | null;
  client: { name: string; since: number } | null;
  /** Disconnected by the user and not yet let back (M3). */
  blocked: boolean;
  error: string | null;
}

/** One request from the agent for the window to answer. */
export interface AgentCall {
  callId: number;
  kind: 'list' | 'call';
  name?: string;
  args?: unknown;
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
      /**
       * Read the text in an already-cropped, already-turned region (v2.4).
       *
       * ⚑ The renderer takes the crop, because it holds the figure's pixels and
       * because `engine/ocrRegion.ts` can be tested without an OCR engine. This
       * hands over PNG bytes and nothing about WHERE they came from: the region
       * gesture, the axis's quarter turn and which category the answer belongs
       * to all stay on this side. See ui/electron-ocr.cjs.
       */
      readText: (pngBase64: string) => Promise<{
        text?: string;
        confidence?: number;
        /**
         * ⚑⚑ WHERE each word was found, in the submitted image's own frame
         * (v2.5). What lets a whole band be read ONCE and the results related to
         * the ticks afterwards, rather than cut into one crop per label - which
         * cannot work for rotated text, since an axis-aligned box does not
         * contain a diagonal label.
         */
        words?: {
          text: string;
          confidence: number;
          bbox: { x0: number; y0: number; x1: number; y1: number };
        }[];
        error?: string;
      }>;
      /** The stored Settings as a plain object (v2.7) - unvalidated; every read
       * goes through ui/src/settings.ts `parseSettings`. */
      getSettings?: () => unknown;
      /** Write the Settings back; resolves false when the file could not be written. */
      setSettings?: (value: Record<string, unknown>) => Promise<boolean>;
      /** Agents (v2.7) - see ui/electron-mcp.cjs and ui/src/agent/. */
      getAgentStatus?: () => Promise<AgentStatus>;
      onAgentStatus?: (callback: (status: AgentStatus) => void) => () => void;
      onAgentCall?: (callback: (call: AgentCall) => void) => () => void;
      answerAgent?: (callId: number, result: unknown, error?: string) => void;
      /** Tell the main process the window is (or no longer is) answering calls. */
      notifyAgentReady?: (ready: boolean) => void;
      disconnectAgent?: () => Promise<AgentStatus>;
      allowAgentReconnect?: () => Promise<AgentStatus>;
    };
  }
}
