/**
 * The user's Settings (v2.7) - preferences that outlive a session.
 * Cases: docs/v2.7-settings-cases.md.
 *
 * ⚑ A SETTING IS A PREFERENCE, NEVER PART OF THE RECORD (S12). Nothing here is
 * written into a project file; each one either sets a tool's STARTING value or
 * decides how an export is written.
 *
 * ⚑ The main process owns the file (ui/electron-settings.cjs), so a setting it
 * acts on is readable there before any window has a figure (the agent switch,
 * on the mcp-server branch). This side reads it once at start and writes each change
 * straight back. Outside Electron (a unit test, a plain browser) the same store
 * falls back to localStorage, the way panelWidth.ts already persists.
 */

export interface Settings {
  colourTolerance: number;
  floodFillThreshold: number;
  gridRemovalTolerance: number;
  pointsPerTrace: number;
  readContourLabels: boolean;
  labelConfidence: number;
  exportFullPrecision: boolean;
  decimalComma: boolean;
}

/** The values the app shipped with before Settings existed. */
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  colourTolerance: 60,
  floodFillThreshold: 40,
  gridRemovalTolerance: 40,
  pointsPerTrace: 500,
  readContourLabels: true,
  labelConfidence: 0.8,
  exportFullPrecision: false,
  decimalComma: false,
});

/** `under`: the row shows only while that switch is on. */
type SpecBase = { key: keyof Settings; group: string; label: string; explains: string; under?: keyof Settings };
export type SettingSpec =
  | (SpecBase & { kind: 'boolean' })
  | (SpecBase & { kind: 'number'; min: number; max: number; step: number; integer: boolean });

/**
 * Every setting, in the order the card shows them. The card renders from this
 * list and a test checks it covers every key, so a setting cannot exist without
 * being on screen.
 */
export const SETTING_SPECS: readonly SettingSpec[] = [
  {
    key: 'colourTolerance', group: 'Starting values', kind: 'number', min: 1, max: 255, step: 1, integer: true,
    label: 'By colour tolerance',
    explains: 'What Auto-extract ▸ By colour starts at. Changing it on the card changes it until the app closes.',
  },
  {
    key: 'floodFillThreshold', group: 'Starting values', kind: 'number', min: 1, max: 255, step: 1, integer: true,
    label: 'Flood fill threshold',
    explains: 'What Auto-extract ▸ Flood fill starts at. Changing it on the card changes it until the app closes.',
  },
  {
    key: 'gridRemovalTolerance', group: 'Starting values', kind: 'number', min: 1, max: 255, step: 1, integer: true,
    label: 'Grid removal tolerance',
    explains: 'What Grid Removal in the top bar starts at. Changing it there changes it until the app closes.',
  },
  {
    key: 'pointsPerTrace', group: 'Starting values', kind: 'number', min: 10, max: 5000, step: 10, integer: true,
    label: 'Points per traced curve',
    explains: 'The most points a By colour trace or a Flood fill records, spread evenly along the curve.',
  },
  {
    key: 'readContourLabels', group: 'Find lines', kind: 'boolean',
    label: 'Read contour labels',
    explains: 'On a contour plot, read each line’s printed label and offer it as the line’s level.',
  },
  {
    key: 'labelConfidence', group: 'Find lines', kind: 'number', min: 0.5, max: 0.99, step: 0.01, integer: false,
    label: 'Label confidence',
    explains: 'A label read less surely than this is refused, with the reason shown. Higher refuses more and offers fewer wrong levels.',
  },
  {
    key: 'exportFullPrecision', group: 'Export', kind: 'boolean',
    label: 'Full precision',
    explains: 'Start the Export menu with Full precision ticked: every computed digit instead of the figure’s own resolution.',
  },
  {
    key: 'decimalComma', group: 'Export', kind: 'boolean',
    label: 'Decimal comma',
    explains: 'CSV and TSV write 1,5 instead of 1.5, and CSV separates fields with a semicolon, which is what a spreadsheet set to Swedish or German expects. JSON, the workbooks and the code formats are unchanged.',
  },
];

/** Each key's value if it passes its spec's limits, else the default (S3). */
export function parseSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const spec of SETTING_SPECS) {
    const v = src[spec.key];
    if (spec.kind === 'boolean') {
      if (typeof v === 'boolean') (out[spec.key] as boolean) = v;
    } else if (
      typeof v === 'number' && Number.isFinite(v) && v >= spec.min && v <= spec.max && (!spec.integer || Number.isInteger(v))
    ) {
      (out[spec.key] as number) = v;
    }
  }
  return out;
}

const LOCAL_KEY = 'plottracer.settings';

/** The stored settings, or the defaults. Never throws. */
export function loadSettings(): Settings {
  try {
    if (window.electronAPI?.getSettings) return parseSettings(window.electronAPI.getSettings());
    const raw = localStorage.getItem(LOCAL_KEY);
    return parseSettings(raw === null ? undefined : JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Write the settings back. A failed write means this session's change does not
 * persist; it never stops the change taking effect. */
export function saveSettings(s: Settings): void {
  try {
    if (window.electronAPI?.setSettings) {
      void window.electronAPI.setSettings({ ...s }).catch(() => undefined);
      return;
    }
    localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
  } catch {
    /* private mode / quota */
  }
}
