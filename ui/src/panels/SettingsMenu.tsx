import { useState } from 'react';
import { theme } from '../theme.js';
import { FloatingPanel } from '../FloatingPanel.js';
import { SettingsIcon } from '../icons.js';
import { DEFAULT_SETTINGS, SETTING_SPECS, type SettingSpec, type Settings } from '../settings.js';

/**
 * The Settings card (v2.7, docs/v2.7-settings-cases.md) - the gear at the right
 * end of the top bar, in the same floating card as Help.
 *
 * ⚑ RENDERED FROM `SETTING_SPECS`, so a setting cannot exist without a row here
 * (S1), and every row says what it changes in words rather than leaving it to
 * the label. Each number shows its default beside it, so a changed value is
 * visible as changed without opening anything.
 */

export interface SettingsMenuProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

const caption = {
  fontSize: theme.font.size.small,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.4,
  color: theme.color.text.legend,
  margin: '8px 0 4px',
};

function NumberSetting({ spec, value, onChange }: {
  spec: Extract<SettingSpec, { kind: 'number' }>;
  value: number;
  onChange: (v: number) => void;
}) {
  // The typed text is kept apart from the value, so a half-typed "0." is not
  // thrown away; only a value inside the limits is ever applied.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const n = Number(shown);
  const valid = shown.trim() !== '' && Number.isFinite(n) && n >= spec.min && n <= spec.max && (!spec.integer || Number.isInteger(n));
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input
        type="number"
        data-testid={`setting-${spec.key}`}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={shown}
        aria-invalid={!valid}
        onChange={(e) => {
          const t = e.target.value;
          setDraft(t);
          const v = Number(t);
          if (t.trim() !== '' && Number.isFinite(v) && v >= spec.min && v <= spec.max && (!spec.integer || Number.isInteger(v))) onChange(v);
        }}
        onBlur={() => setDraft(null)}
        style={{
          width: 70,
          border: `1px solid ${valid ? theme.color.border.regular : theme.color.error}`,
          borderRadius: theme.border.radius.regular,
          padding: '2px 4px',
        }}
      />
      <span style={{ minWidth: 66, fontSize: theme.font.size.small, color: valid ? theme.color.text.legend : theme.color.error }}>
        {valid ? `default ${DEFAULT_SETTINGS[spec.key] as number}` : `${spec.min} to ${spec.max}`}
      </span>
    </span>
  );
}

export function SettingsMenu({ settings, onChange }: SettingsMenuProps) {
  const groups = [...new Set(SETTING_SPECS.map((s) => s.group))];
  const isDefault = SETTING_SPECS.every((s) => settings[s.key] === DEFAULT_SETTINGS[s.key]);
  return (
    <FloatingPanel label="Settings" icon={<SettingsIcon />} hideLabel testId="settings">
      <div style={{ width: 420, color: theme.color.text.primary, fontSize: theme.font.size.regular }}>
        {groups.map((g) => (
          <div key={g}>
            <div style={caption}>{g}</div>
            {SETTING_SPECS.filter((s) => s.group === g && (!s.under || settings[s.under] === true)).map((spec) => (
              <div key={spec.key} data-testid={`setting-row-${spec.key}`} style={{ padding: '4px 0 6px', ...(spec.under ? { marginLeft: 22 } : {}) }}>
                {spec.kind === 'boolean' ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      data-testid={`setting-${spec.key}`}
                      checked={settings[spec.key] as boolean}
                      onChange={(e) => onChange({ [spec.key]: e.target.checked })}
                    />
                    {spec.label}
                  </label>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{spec.label}</span>
                    <NumberSetting
                      spec={spec}
                      value={settings[spec.key] as number}
                      onChange={(v) => onChange({ [spec.key]: v })}
                    />
                  </div>
                )}
                <div style={{ fontSize: theme.font.size.small, color: theme.color.text.secondary, marginTop: 2, lineHeight: 1.35 }}>
                  {spec.explains}
                </div>
              </div>
            ))}
          </div>
        ))}
        <div style={{ height: 1, background: theme.color.border.regular, margin: '8px 0' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: theme.font.size.small, color: theme.color.text.legend }}>
            Settings are kept on this computer, never in a project file.
          </span>
          <button
            type="button"
            data-testid="settings-restore-defaults"
            disabled={isDefault}
            title={isDefault ? 'Every setting is at its default' : 'Put every setting back to its default'}
            onClick={() => onChange({ ...DEFAULT_SETTINGS })}
          >
            Restore defaults
          </button>
        </div>
      </div>
    </FloatingPanel>
  );
}
